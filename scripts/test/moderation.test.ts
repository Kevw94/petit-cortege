import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListeManifs } from '@petit-cortege/shared';
import { demarrerBanc, type Banc } from '../../server/test/support';
import { executerModeration } from '../moderation';

/** Export uMap typique : une FeatureCollection avec le tracé et des options uMap. */
const EXPORT_UMAP = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Parcours' },
      // Plein nord, ≈ 1000,75 m : fin = départ + ≈ 30 min + 1 h de marge.
      geometry: {
        type: 'LineString',
        coordinates: [
          [2.35, 48.85],
          [2.35, 48.859],
        ],
      },
    },
  ],
  _umap_options: { name: 'Marche' },
};

describe('modération en ligne de commande', () => {
  let banc: Banc;
  let dossier: string;
  let sorties: string[];

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T08:00:00Z');
    dossier = await mkdtemp(join(tmpdir(), 'pc-moderation-'));
  });
  afterAll(async () => {
    await banc?.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  async function fichier(nom: string, contenu: unknown): Promise<string> {
    const chemin = join(dossier, nom);
    await writeFile(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
    return chemin;
  }

  /** Lance une commande comme en SSH ; renvoie le code de sortie. */
  async function moderer(...argv: string[]): Promise<number> {
    sorties = [];
    return executerModeration(argv, {
      sql: banc.sql,
      horloge: banc.horloge,
      dossierPublication: banc.dossierPublication,
      ecrire: (ligne) => sorties.push(ligne),
    });
  }

  async function manifsPubliees(): Promise<ListeManifs['manifs']> {
    const { statut, corps } = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(statut).toBe(200);
    return corps.manifs;
  }

  it('créer une manif depuis un export uMap : elle est publiée dans la liste', async () => {
    const geojson = await fichier('parcours.geojson', EXPORT_UMAP);

    const code = await moderer(
      'creer-manif',
      '--id', 'marche-paris',
      '--geojson', geojson,
      '--intitule', 'Marche pour le climat',
      '--ville', 'Paris',
      '--depart', '2026-06-01T10:00:00Z',
      '--source', 'Préfecture de police|https://www.prefecturedepolice.interieur.gouv.fr/',
      '--source', 'Collectif organisateur|https://example.org/appel',
    );

    expect(code).toBe(0);
    const manif = (await manifsPubliees()).find((m) => m.id === 'marche-paris');
    expect(manif).toMatchObject({
      intitule: 'Marche pour le climat',
      ville: 'Paris',
      depart: '2026-06-01T10:00:00.000Z',
      parcours: { type: 'LineString', coordinates: [[2.35, 48.85], [2.35, 48.859]] },
      sources: [
        { libelle: 'Préfecture de police', url: 'https://www.prefecturedepolice.interieur.gouv.fr/' },
        { libelle: 'Collectif organisateur', url: 'https://example.org/appel' },
      ],
      compteur: 0,
    });
    // 1000,754 m à 2 km/h = 30 min 1,357 s, plus 1 h de marge.
    expect(manif?.fin).toBe('2026-06-01T11:30:01.357Z');
  });

  describe('le GeoJSON uMap est validé', () => {
    const ligne = (coordinates: unknown) => ({ type: 'LineString', coordinates });
    const feature = (geometry: unknown) => ({ type: 'Feature', properties: {}, geometry });
    const collection = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
    const TRACE = [
      [2.35, 48.85],
      [2.35, 48.859],
    ];
    const MARQUEUR = feature({ type: 'Point', coordinates: [2.35, 48.85] });

    async function creerDepuis(id: string, geojson: unknown): Promise<number> {
      return moderer(
        'creer-manif',
        '--id', id,
        '--geojson', await fichier(`${id}.geojson`, geojson),
        '--intitule', 'Marche',
        '--ville', 'Lyon',
        '--depart', '2026-06-01T10:00:00Z',
        '--source', 'Préfecture|https://example.org/',
      );
    }

    it.each([
      ['pas du JSON', '{"type": "FeatureCollection", ', /JSON/],
      ['aucune LineString (seulement des marqueurs)', collection(MARQUEUR), /aucune LineString/],
      ['plusieurs LineString', collection(feature(ligne(TRACE)), feature(ligne(TRACE))), /plusieurs LineString/],
      ['un seul point', collection(feature(ligne([[2.35, 48.85]]))), /au moins 2 points/],
      ['coordonnées hors limites', ligne([[2.35, 48.85], [2.35, 148.85]]), /coordonnées/],
      ['coordonnées non numériques', ligne([[2.35, 48.85], ['2.35', 48.86]]), /coordonnées/],
    ])('refusé : %s', async (_cas, geojson, message) => {
      const id = `refus-${Math.random().toString(36).slice(2, 8)}`;

      expect(await creerDepuis(id, geojson)).toBe(1);

      expect(sorties.join('\n')).toMatch(message);
      await banc.serveur.publier();
      expect((await manifsPubliees()).map((m) => m.id)).not.toContain(id);
    });

    it.each([
      ['une LineString seule', ligne(TRACE)],
      ['une Feature', feature(ligne(TRACE))],
      ['une FeatureCollection avec des marqueurs en plus du tracé', collection(MARQUEUR, feature(ligne(TRACE)), MARQUEUR)],
      [
        'des positions avec altitude (ignorée)',
        ligne([
          [2.35, 48.85, 35],
          [2.35, 48.859, 40],
        ]),
      ],
    ])('accepté : %s', async (_cas, geojson) => {
      const id = `accepte-${Math.random().toString(36).slice(2, 8)}`;

      expect(await creerDepuis(id, geojson)).toBe(0);

      const manif = (await manifsPubliees()).find((m) => m.id === id);
      expect(manif?.parcours).toEqual({ type: 'LineString', coordinates: TRACE });
    });
  });

  describe('saisie de la manif', () => {
    let geojson: string;
    beforeAll(async () => {
      geojson = await fichier('saisie.geojson', EXPORT_UMAP);
    });

    /** Options complètes et valides, à surcharger. */
    function options(surcharges: Record<string, string | string[] | null> = {}): string[] {
      const valeurs: Record<string, string | string[] | null> = {
        id: `saisie-${Math.random().toString(36).slice(2, 8)}`,
        geojson,
        intitule: 'Marche',
        ville: 'Lyon',
        depart: '2026-06-01T10:00:00Z',
        source: 'Préfecture du Rhône|https://www.rhone.gouv.fr/',
        ...surcharges,
      };
      return Object.entries(valeurs).flatMap(([nom, v]) =>
        v === null ? [] : (Array.isArray(v) ? v : [v]).flatMap((x) => [`--${nom}`, x]),
      );
    }

    it.each([
      ['intitulé manquant', { intitule: null }, /--intitule/],
      ['ville manquante', { ville: null }, /--ville/],
      ['départ manquant', { depart: null }, /--depart/],
      ['GeoJSON manquant', { geojson: null }, /--geojson/],
      ['aucune source', { source: null }, /--source/],
      ['source sans URL', { source: 'Préfecture' }, /source/i],
      ['source dont l’URL n’est pas http(s)', { source: 'Préfecture|javascript:alert(1)' }, /source/i],
      ['départ illisible', { depart: 'demain 14h' }, /départ/i],
      ['option inconnue', { parcours: 'x' }, /parcours/],
    ])('refusée : %s', async (_cas, surcharges, message) => {
      expect(await moderer('creer-manif', ...options(surcharges))).toBe(1);
      expect(sorties.join('\n')).toMatch(message);
    });

    it('fichier GeoJSON introuvable : refusée', async () => {
      expect(await moderer('creer-manif', ...options({ geojson: join(dossier, 'absent.geojson') }))).toBe(1);
      expect(sorties.join('\n')).toMatch(/absent\.geojson/);
    });

    it("identifiant déjà pris : refusée, la manif existante n'est pas modifiée", async () => {
      expect(await moderer('creer-manif', ...options({ id: 'doublon', intitule: 'Première' }))).toBe(0);

      expect(await moderer('creer-manif', ...options({ id: 'doublon', intitule: 'Seconde' }))).toBe(1);

      expect(sorties.join('\n')).toMatch(/doublon.*existe déjà/);
      expect((await manifsPubliees()).find((m) => m.id === 'doublon')?.intitule).toBe('Première');
    });

    it("sans --id, l'identifiant est tiré de la ville et de la date du départ", async () => {
      expect(await moderer('creer-manif', ...options({ id: null, ville: 'Saint-Étienne', depart: '2026-06-03T10:00:00Z' }))).toBe(0);

      expect(sorties.join('\n')).toMatch(/saint-etienne-2026-06-03/);
      expect((await manifsPubliees()).map((m) => m.id)).toContain('saint-etienne-2026-06-03');
    });

    it("départ sans fuseau : heure de Paris (14:00 en juin = 12:00 UTC)", async () => {
      expect(await moderer('creer-manif', ...options({ id: 'heure-paris', depart: '2026-06-01T14:00' }))).toBe(0);

      expect((await manifsPubliees()).find((m) => m.id === 'heure-paris')?.depart).toBe('2026-06-01T12:00:00.000Z');
    });

    it('manif déjà terminée : refusée', async () => {
      banc.horloge.regler('2026-06-01T12:00:00Z');
      try {
        expect(await moderer('creer-manif', ...options({ id: 'trop-tard', depart: '2026-06-01T09:00:00Z' }))).toBe(1);
        expect(sorties.join('\n')).toMatch(/terminée/);
      } finally {
        banc.horloge.regler('2026-06-01T08:00:00Z');
      }
    });

    it("--ouverture : la manif n'est listée et ouverte aux entrées qu'à partir de cette heure", async () => {
      expect(await moderer('creer-manif', ...options({ id: 'plus-tard', ouverture: '2026-06-01T09:00:00Z' }))).toBe(0);
      expect((await manifsPubliees()).map((m) => m.id)).not.toContain('plus-tard');
      expect((await banc.poster('/api/entree', { manif: 'plus-tard', apparence: 0, pancarte: 0 })).statut).toBe(404);

      banc.horloge.regler('2026-06-01T09:00:00Z');
      try {
        await banc.serveur.publier();
        expect((await manifsPubliees()).find((m) => m.id === 'plus-tard')?.ouverture).toBe('2026-06-01T09:00:00.000Z');
        expect((await banc.poster('/api/entree', { manif: 'plus-tard', apparence: 0, pancarte: 0 })).statut).toBe(201);
      } finally {
        banc.horloge.regler('2026-06-01T08:00:00Z');
      }
    });
  });

  it('commande inconnue : aide et code 1', async () => {
    expect(await moderer('effacer-tout')).toBe(1);
    expect(sorties.join('\n')).toMatch(/creer-manif/);
  });
});
