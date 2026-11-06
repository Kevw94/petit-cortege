import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerManif } from '../src/index';
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
