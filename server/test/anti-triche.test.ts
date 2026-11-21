import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { antiTricheDepuisEnv, creerManif, type AlertePlafondGlobal } from '../src/index';
import { demarrerBanc, type Banc } from './support';

const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

const ENTREE = { manif: 'manif-paris', apparence: 0, pancarte: 0 };

async function creerManifParis(banc: Banc): Promise<void> {
  await creerManif(banc.sql, {
    id: 'manif-paris',
    intitule: 'Marche',
    ville: 'Paris',
    ouverture: new Date('2026-06-01T09:00:00Z'),
    depart: new Date('2026-06-01T10:00:00Z'),
    parcours: PARCOURS,
    sources: [],
  });
}

describe('preuve de travail à chaque entrée', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z');
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('entrée refusée sans preuve de travail', async () => {
    const reponse = await banc.poster('/api/entree', ENTREE);

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
  });

  it('entrée acceptée avec une preuve de travail résolue', async () => {
    const reponse = await banc.poster('/api/entree', { ...ENTREE, preuve: await banc.preuve() });

    expect(reponse.statut).toBe(201);
  });

  it('entrée refusée si la solution est fausse', async () => {
    const preuve = JSON.parse(Buffer.from(await banc.preuve(), 'base64').toString()) as {
      solution: { counter: number; derivedKey: string };
    };
    preuve.solution = { counter: preuve.solution.counter + 1, derivedKey: '00'.repeat(32) };

    const reponse = await banc.poster('/api/entree', {
      ...ENTREE,
      preuve: Buffer.from(JSON.stringify(preuve)).toString('base64'),
    });

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
  });

  it("entrée refusée si le défi n'a pas été signé par le serveur", async () => {
    const preuve = JSON.parse(Buffer.from(await banc.preuve(), 'base64').toString()) as {
      challenge: { parameters: { cost: number } };
    };
    preuve.challenge.parameters.cost = 2;

    const reponse = await banc.poster('/api/entree', {
      ...ENTREE,
      preuve: Buffer.from(JSON.stringify(preuve)).toString('base64'),
    });

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
  });

  it('entrée refusée si la preuve est illisible', async () => {
    const reponse = await banc.poster('/api/entree', { ...ENTREE, preuve: 'pas une preuve' });

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
  });

  it('une preuve ne sert qu’une fois, même envoyée deux fois en même temps', async () => {
    const preuve = await banc.preuve();
    const premiere = await banc.poster('/api/entree', { ...ENTREE, preuve });
    const rejeu = await banc.poster('/api/entree', { ...ENTREE, preuve });

    const autre = await banc.preuve();
    const simultanees = await Promise.all([
      banc.poster('/api/entree', { ...ENTREE, preuve: autre }),
      banc.poster('/api/entree', { ...ENTREE, preuve: autre }),
    ]);

    expect(premiere.statut).toBe(201);
    expect(rejeu).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
    expect(simultanees.map((r) => r.statut).sort()).toEqual([201, 403]);
  });

  it("le défi ne dépend d'aucune manif et n'est jamais mis en cache", async () => {
    const reponse = await fetch(new URL('/api/defi', banc.serveur.url));

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await reponse.json())).not.toContain('manif');
  });
});

describe('défi expiré', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', { dureeDefiMs: 1 });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('entrée refusée si le défi a expiré', async () => {
    const preuve = await banc.preuve();
    await new Promise((r) => setTimeout(r, 1100));

    const reponse = await banc.poster('/api/entree', { ...ENTREE, preuve });

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'preuve-invalide' } });
  });
});

describe('limite de débit par IP', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', { limiteParIp: { requetes: 3, fenetreMs: 60_000 } });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('entrée refusée une fois la limite atteinte, même avec une preuve valide', async () => {
    const reponses = [];
    for (let i = 0; i < 4; i++) reponses.push(await banc.entrer(ENTREE));

    expect(reponses.map((r) => r.statut)).toEqual([201, 201, 201, 429]);
    expect(reponses[3]!.corps).toEqual({ erreur: 'trop-de-requetes' });
  });

  it('retrait refusé une fois la limite atteinte, avec un délai avant de réessayer', async () => {
    const corps = { avatar: 'inconnu', jeton: '0'.repeat(32) };
    const statuts = [];
    for (let i = 0; i < 3; i++) statuts.push((await banc.poster('/api/retrait', corps)).statut);
    const reponse = await fetch(new URL('/api/retrait', banc.serveur.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    });

    expect([...statuts, reponse.status]).toEqual([403, 403, 403, 429]);
    expect(await reponse.json()).toEqual({ erreur: 'trop-de-requetes' });
    expect(Number(reponse.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('vraie IP transmise par le CDN', () => {
  const limiteParIp = { requetes: 2, fenetreMs: 60_000 };
  const depuis = (ip: string) => ({ 'CDN-RequestClientIP': ip });
  let derriereCdn: Banc;
  let sansProxyDeConfiance: Banc;

  beforeAll(async () => {
    // Le banc se connecte depuis 127.0.0.1 : il joue le rôle du CDN.
    derriereCdn = await demarrerBanc('2026-06-01T09:10:00Z', {
      limiteParIp,
      enteteIp: 'CDN-RequestClientIP',
      proxysDeConfiance: ['127.0.0.1', '::1'],
    });
    sansProxyDeConfiance = await demarrerBanc('2026-06-01T09:10:00Z', {
      limiteParIp,
      enteteIp: 'CDN-RequestClientIP',
      proxysDeConfiance: ['192.0.2.1'],
    });
    await creerManifParis(derriereCdn);
    await creerManifParis(sansProxyDeConfiance);
  });
  afterAll(async () => {
    await derriereCdn?.arreter();
    await sansProxyDeConfiance?.arreter();
  });

  it("la limite s'applique à chaque soutien, pas à l'IP du CDN", async () => {
    const a = [];
    for (let i = 0; i < 3; i++) a.push((await derriereCdn.entrer(ENTREE, depuis('203.0.113.7'))).statut);
    const b = [];
    for (let i = 0; i < 2; i++) b.push((await derriereCdn.entrer(ENTREE, depuis('198.51.100.23'))).statut);

    expect(a).toEqual([201, 201, 429]);
    expect(b).toEqual([201, 201]);
  });

  it("l'en-tête est ignoré s'il ne vient pas d'un proxy de confiance (sinon chacun choisirait son IP)", async () => {
    const statuts = [];
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      statuts.push((await sansProxyDeConfiance.entrer(ENTREE, depuis(ip))).statut);
    }

    expect(statuts).toEqual([201, 201, 429]);
  });

  it('une IPv6 compte pour tout son /64 (sinon un abonné changerait d’adresse à volonté)', async () => {
    const statuts = [];
    for (const ip of ['2001:db8:1:2::a', '2001:db8:1:2::b', '2001:db8:1:2:ffff::1']) {
      statuts.push((await derriereCdn.entrer(ENTREE, depuis(ip))).statut);
    }
    const voisin = await derriereCdn.entrer(ENTREE, depuis('2001:db8:1:3::a'));

    expect(statuts).toEqual([201, 201, 429]);
    expect(voisin.statut).toBe(201);
  });
});

describe('vraie IP dans X-Forwarded-For', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', {
      limiteParIp: { requetes: 2, fenetreMs: 60_000 },
      proxysDeConfiance: ['127.0.0.0/8', '::1', '10.0.0.0/8'],
    });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('la partie gauche, forgeable par le client, ne permet pas d’échapper à la limite', async () => {
    const statuts = [];
    for (const forge of ['192.0.2.1', '192.0.2.2', '192.0.2.3']) {
      const xff = { 'X-Forwarded-For': `${forge}, 203.0.113.9, 10.1.2.3` };
      statuts.push((await banc.entrer(ENTREE, xff)).statut);
    }

    expect(statuts).toEqual([201, 201, 429]);
  });
});

describe("aucune IP n'est écrite (ADR 0001)", () => {
  const IPS = ['203.0.113.77', '198.51.100.201', '192.0.2.150', '2001:db8:abcd:12::99'];
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', {
      limiteParIp: { requetes: 4, fenetreMs: 60_000 },
      enteteIp: 'CDN-RequestClientIP',
      proxysDeConfiance: ['127.0.0.1', '::1'],
    });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
    vi.restoreAllMocks();
  });

  it("après une série d'entrées acceptées, refusées et limitées, aucune IP en base ni dans les journaux", async () => {
    const journaux: string[] = [];
    const capter = (...args: unknown[]) => {
      journaux.push(args.map(String).join(' '));
      return true;
    };
    for (const methode of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, methode).mockImplementation(capter);
    }
    vi.spyOn(process.stdout, 'write').mockImplementation(capter);
    vi.spyOn(process.stderr, 'write').mockImplementation(capter);

    const statuts = new Set<number>();
    for (const ip of IPS) {
      const entete = { 'CDN-RequestClientIP': ip };
      statuts.add((await banc.poster('/api/entree', { ...ENTREE, preuve: 'faux' }, entete)).statut);
      statuts.add((await banc.entrer({ ...ENTREE, manif: 'manif-fantome' }, entete)).statut);
      for (let i = 0; i < 3; i++) statuts.add((await banc.entrer(ENTREE, entete)).statut);
    }
    banc.horloge.regler('2026-06-01T09:11:00Z');
    await banc.serveur.publier();
    vi.restoreAllMocks();

    const dump = execFileSync('pg_dump', ['--data-only', '--inserts', banc.urlBase], { encoding: 'utf8' });
    expect([...statuts].sort()).toEqual([201, 403, 404, 429]);
    expect(dump).toContain("'manif-paris'");
    for (const ip of [...IPS, '127.0.0.1', '::1', '2001:db8:abcd:12::']) {
      expect(dump).not.toContain(ip);
      expect(journaux.join('\n')).not.toContain(ip);
    }
  });
});

describe("alerte au porteur sur le plafond global d'entrées", () => {
  let banc: Banc;
  const alertes: AlertePlafondGlobal[] = [];

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', {
      plafondGlobal: { entrees: 3, fenetreMs: 60_000 },
      alerte: { plafondGlobalDepasse: (a) => void alertes.push(a) },
    });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('une seule alerte quand le plafond est dépassé, sans bloquer les entrées', async () => {
    const statuts = [];
    for (let i = 0; i < 3; i++) statuts.push((await banc.entrer(ENTREE)).statut);
    const avantDepassement = alertes.length;
    for (let i = 0; i < 3; i++) statuts.push((await banc.entrer(ENTREE)).statut);

    expect(statuts).toEqual([201, 201, 201, 201, 201, 201]);
    expect(avantDepassement).toBe(0);
    expect(alertes).toEqual([{ plafond: 3, fenetreMs: 60_000 }]);
  });
});

describe('alerte par webhook configurée par variable d’environnement', () => {
  let banc: Banc;
  let recepteur: Server;
  const recus: unknown[] = [];

  beforeAll(async () => {
    recepteur = createServer((req, res) => {
      let corps = '';
      req.on('data', (morceau: Buffer) => (corps += morceau.toString()));
      req.on('end', () => {
        recus.push(JSON.parse(corps));
        res.end();
      });
    });
    await new Promise<void>((r) => recepteur.listen(0, '127.0.0.1', r));
    const { port } = recepteur.address() as AddressInfo;
    const { alerte, plafondGlobal } = antiTricheDepuisEnv({
      ALTCHA_CLE_HMAC: 'cle',
      PLAFOND_ENTREES_GLOBAL: '1',
      ALERTE_WEBHOOK_URL: `http://127.0.0.1:${port}/alerte`,
    });
    banc = await demarrerBanc('2026-06-01T09:10:00Z', {
      ...(alerte && { alerte }),
      ...(plafondGlobal && { plafondGlobal }),
    });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
    await new Promise((r) => recepteur?.close(r));
    vi.restoreAllMocks();
  });

  it('le webhook reçoit un message lisible, sans IP ni manif', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await banc.entrer(ENTREE, { 'X-Forwarded-For': '203.0.113.5' });
    await banc.entrer(ENTREE, { 'X-Forwarded-For': '203.0.113.5' });
    await vi.waitFor(() => expect(recus).toHaveLength(1));

    expect(recus[0]).toMatchObject({ plafond: 1, fenetreMs: 60_000, text: expect.stringContaining('plafond') });
    expect(JSON.stringify(recus[0])).not.toMatch(/203\.0\.113\.5|127\.0\.0\.1|manif-paris/);
  });
});

describe('limite de débit par IP, fenêtre suivante', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:10:00Z', { limiteParIp: { requetes: 1, fenetreMs: 1_500 } });
    await creerManifParis(banc);
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('la limite se relâche à la fenêtre suivante', async () => {
    const premiere = await banc.entrer(ENTREE);
    const refusee = await banc.entrer(ENTREE);
    await new Promise((r) => setTimeout(r, 1_600));
    const apres = await banc.entrer(ENTREE);

    expect([premiere.statut, refusee.statut, apres.statut]).toEqual([201, 429, 201]);
  });
});
