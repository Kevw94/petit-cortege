/**
 * `npm run import-manifs -- publier` contre un vrai Postgres (base jetable),
 * sans réseau : les tracés relus sont ceux écrits par « tracer ».
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListeManifs } from '@petit-cortege/shared';
import { demarrerBanc, type Banc } from '../../server/test/support';
import { executerImport } from '../import-manifs';
import { empreinteTrace, lireJournee } from '../import/fichier';

const VERIFIE = {
  declaree: 'Déclarée en préfecture (source X, 14/11).',
  sansInterdiction: 'Aucun arrêté au recueil des actes administratifs (vérifié le 14/11 à 9 h).',
};
const manif = (id: string, verifie: object = VERIFIE) => ({
  id,
  intitule: 'Manifestation du 14 novembre',
  ville: 'Caen',
  depart: '2026-11-14T14:40',
  parcoursAnnonce: 'départ place Saint-Pierre, arrivée place Saint-Sauveur',
  etapes: [{ adresse: 'Place Saint-Pierre, Caen' }, { adresse: 'Place Saint-Sauveur, Caen' }],
  sources: [{ libelle: 'Carte des organisateurs', url: 'https://26septembre.org/carte' }],
  verifie,
});

describe('import-manifs : publier', () => {
  let banc: Banc;
  let dossier: string;
  let sorties: string[];

  beforeAll(async () => {
    banc = await demarrerBanc('2026-11-14T09:00:00Z');
    dossier = await mkdtemp(join(tmpdir(), 'pc-import-publier-'));
    const manifs = [
      manif('caen-2026-11-14'),
      manif('non-verifiee-2026-11-14', { declaree: 'oui (source)', sansInterdiction: null }),
      manif('perimee-2026-11-14'),
      manif('sans-trace-2026-11-14'),
      { ...manif('a-verifier-2026-11-14'), aVerifier: 'étape « quais » trop vague' },
    ];
    await writeFile(join(dossier, '2026-11-14.json'), JSON.stringify({ manifs }));
    const journee = lireJournee({ manifs }, '2026-11-14.json');
    // Tracé enregistré de Caen (sortie réelle de « tracer »), recopié pour chaque manif.
    const trace = JSON.parse(
      await readFile(join(import.meta.dirname, '../../donnees/manifs/2026-11-14/caen-2026-11-14.geojson'), 'utf8'),
    );
    await mkdir(join(dossier, '2026-11-14'));
    for (const m of journee.manifs.filter((x) => x.id !== 'sans-trace-2026-11-14')) {
      const empreinte = m.id === 'perimee-2026-11-14' ? 'etapes-modifiees' : empreinteTrace(m);
      await writeFile(
        join(dossier, '2026-11-14', `${m.id}.geojson`),
        JSON.stringify({ ...trace, properties: { ...trace.properties, empreinte } }),
      );
    }
  });
  afterAll(async () => {
    await banc?.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  const publier = (...options: string[]) => {
    sorties = [];
    return executerImport(['publier', '--fichier', '2026-11-14.json', ...options], {
      reseau: {
        recuperer: () => Promise.reject(new Error('aucun réseau pour publier')),
        dormir: async () => {},
      },
      maintenant: () => banc.horloge.maintenant(),
      ecrire: (l) => sorties.push(l),
      dossierCourant: dossier,
      racine: dossier,
      base: async () => ({
        sql: banc.sql,
        horloge: banc.horloge,
        dossierPublication: banc.dossierPublication,
        fermer: async () => {},
      }),
    });
  };
  const publiees = async () => (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs;

  it('crée et publie les manifs vérifiées et tracées ; refuse les autres en disant pourquoi', async () => {
    expect(await publier()).toBe(1);
    const texte = sorties.join('\n');
    expect(texte).toMatch(/Créée : caen-2026-11-14/);
    expect(texte).toMatch(
      /Refusée : non-verifiee-2026-11-14 : vérification humaine à faire : absence d'arrêté d'interdiction/,
    );
    expect(texte).toMatch(/Refusée : perimee-2026-11-14 : le tracé ne correspond plus aux étapes/);
    expect(texte).toMatch(/Refusée : sans-trace-2026-11-14 : pas de tracé/);
    expect(texte).toMatch(/Refusée : a-verifier-2026-11-14 : marquée « aVerifier »/);
    expect(texte).toMatch(/Bilan : 1 créée\(s\), 0 déjà créée\(s\), 4 refusée\(s\)/);

    const [caen, ...autres] = await publiees();
    expect(autres).toEqual([]);
    expect(caen).toMatchObject({
      id: 'caen-2026-11-14',
      intitule: 'Manifestation du 14 novembre',
      ville: 'Caen',
      depart: '2026-11-14T13:40:00.000Z',
      sources: [{ libelle: 'Carte des organisateurs', url: 'https://26septembre.org/carte' }],
    });
    expect(caen!.longueurM).toBeGreaterThan(700);
  });

  it('est idempotent : une manif déjà créée est signalée et sautée, sans erreur', async () => {
    expect(await publier('--manif', 'caen-2026-11-14')).toBe(0);
    expect(sorties.join('\n')).toMatch(/Déjà créée : caen-2026-11-14 \(sautée\)/);
    expect(sorties.join('\n')).toMatch(/Bilan : 0 créée\(s\), 1 déjà créée\(s\), 0 refusée\(s\)/);
    const [ligne] = await banc.sql<{ n: number }[]>`select count(*)::int as n from manif`;
    expect(ligne?.n).toBe(1);
  });

  it('refuse une manif inconnue du fichier du jour', async () => {
    expect(await publier('--manif', 'lyon-2026-11-14')).toBe(1);
    expect(sorties.join('\n')).toMatch(/manif inconnue dans 2026-11-14\.json : lyon-2026-11-14/);
  });
});
