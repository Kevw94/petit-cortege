import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHEMIN_API_DEFI, CHEMIN_LISTE_MANIFS, lireListeManifs } from '@petit-cortege/shared';
import { configDepuisEnv, creerManif, lancer, type PassagePublication } from '../src/index';
import { creerAntiTriche } from '../src/anti-triche';
import { creerBaseDeTest, HorlogeControlee } from './support';

const ENV_MINIMAL = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/base',
  DOSSIER_PUBLICATION: '/srv/publie',
  ALTCHA_CLE_HMAC: 'cle-secrete',
  PROXYS_DE_CONFIANCE: '127.0.0.1,::1',
};

describe('configuration du point d’entrée de production', () => {
  it('lit la base, le dossier de publication et la clé ALTCHA, avec des défauts pour le reste', () => {
    const config = configDepuisEnv(ENV_MINIMAL);
    expect(config).toMatchObject({
      urlBase: ENV_MINIMAL.DATABASE_URL,
      dossierPublication: '/srv/publie',
      port: 8787,
      intervallePublicationMs: 5_000,
      servirPublication: false,
    });
    expect(config.antiTriche.cleHmac).toBe('cle-secrete');
    // Météo des manifs ouvertes : Open-Meteo par défaut (METEO=aucune pour s'en passer).
    expect(config.meteo).toBeTypeOf('function');
  });

  it.each(['DATABASE_URL', 'DOSSIER_PUBLICATION', 'ALTCHA_CLE_HMAC', 'PROXYS_DE_CONFIANCE'])(
    'refuse de démarrer sans %s',
    (nom) => {
      expect(() => configDepuisEnv({ ...ENV_MINIMAL, [nom]: '' })).toThrow(nom);
    },
  );

  it('les proxys de confiance (serveur web local, CDN) donnent la vraie IP de chaque soutien', () => {
    const config = configDepuisEnv(ENV_MINIMAL);
    const lireIp = creerAntiTriche(config.antiTriche).lireIp;
    // Derrière le serveur web local, chaque soutien a sa propre clé de limite.
    expect(lireIp('127.0.0.1', (nom) => (nom.toLowerCase() === 'x-forwarded-for' ? '203.0.113.7' : undefined))).toBe(
      lireIp('203.0.113.7', () => undefined),
    );
  });

  it('« aucun » : en-tête ignoré, choix explicite signalé au démarrage', () => {
    const avertissements: unknown[] = [];
    const avertir = vi.spyOn(console, 'warn').mockImplementation((...args) => void avertissements.push(...args));
    try {
      const config = configDepuisEnv({ ...ENV_MINIMAL, PROXYS_DE_CONFIANCE: 'aucun' });
      expect(config.antiTriche.proxysDeConfiance).toEqual([]);
      expect(avertissements.join(' ')).toMatch(/PROXYS_DE_CONFIANCE/);
    } finally {
      avertir.mockRestore();
    }
  });

  it('accepte le port, l’intervalle de publication et le service des fichiers publiés', () => {
    const config = configDepuisEnv({
      ...ENV_MINIMAL,
      PORT: '0',
      INTERVALLE_PUBLICATION_MS: '2000',
      SERVIR_PUBLICATION: '1',
      LIMITE_ENTREES_PAR_IP: '30',
    });
    expect(config).toMatchObject({ port: 0, intervallePublicationMs: 2_000, servirPublication: true });
    expect(config.antiTriche.limiteParIp?.requetes).toBe(30);
  });

  it('refuse un intervalle de publication invalide', () => {
    expect(() => configDepuisEnv({ ...ENV_MINIMAL, INTERVALLE_PUBLICATION_MS: 'vite' })).toThrow(
      'INTERVALLE_PUBLICATION_MS',
    );
  });
});

describe('lancement du serveur de production', () => {
  let base: Awaited<ReturnType<typeof creerBaseDeTest>>;
  let dossierPublication: string;

  beforeAll(async () => {
    base = await creerBaseDeTest();
    dossierPublication = await mkdtemp(join(tmpdir(), 'pc-lancement-'));
  });
  afterAll(async () => {
    await base.detruire();
    await rm(dossierPublication, { recursive: true, force: true });
  });

  it('sert le défi et fait tourner la tâche de publication toute seule, sans chevauchement', async () => {
    const horloge = new HorlogeControlee('2026-05-01T14:00:30Z');
    const passages: PassagePublication[] = [];
    const config = configDepuisEnv({
      ...ENV_MINIMAL,
      DATABASE_URL: base.url,
      DOSSIER_PUBLICATION: dossierPublication,
      PORT: '0',
      INTERVALLE_PUBLICATION_MS: '20',
      METEO: 'aucune',
    });
    const serveur = await lancer(config, { horloge, surPublication: (p) => passages.push(p) });
    try {
      await creerManif(base.sql, {
        id: 'manif-a',
        intitule: 'Marche',
        ville: 'Paris',
        ouverture: new Date('2026-05-01T13:55:00Z'),
        depart: new Date('2026-05-01T14:00:00Z'),
        parcours: { type: 'LineString', coordinates: [[2.35, 48.85], [2.35, 48.86]] },
        sources: [],
      });

      expect((await fetch(new URL(CHEMIN_API_DEFI, serveur.url))).status).toBe(200);

      await expect
        .poll(async () => {
          const texte = await readFile(join(dossierPublication, CHEMIN_LISTE_MANIFS), 'utf8').catch(() => null);
          return texte ? lireListeManifs(JSON.parse(texte)).manifs.map((m) => m.id) : [];
        })
        .toEqual(['manif-a']);
      expect(passages.length).toBeGreaterThan(1);
      expect(passages.every((p) => p.ok && p.dureeMs >= 0)).toBe(true);
      // Un passage ne commence qu'après la fin du précédent.
      for (let i = 1; i < passages.length; i++) {
        expect(passages[i]!.debut).toBeGreaterThanOrEqual(passages[i - 1]!.debut + passages[i - 1]!.dureeMs);
      }
    } finally {
      await serveur.arreter();
    }
    const apres = passages.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(passages.length).toBe(apres);
  });
});
