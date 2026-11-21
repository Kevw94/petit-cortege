/**
 * Import des manifs (`npm run import-manifs`), sans réseau : `fetch` est
 * remplacé par un faux qui rejoue des réponses enregistrées des vraies API
 * (fixtures/import/, Caen et Paris le 14 novembre 2026) ou fabrique des cas
 * d'erreur (service en panne, tracé invraisemblable…).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lireParcoursGeoJson } from '@petit-cortege/server';
import { decorDuParcours, distanceM, lireDecor, lireIndexDecors, type Position } from '@petit-cortege/shared';
import { executerImport, type DependancesImportManifs } from '../import-manifs';
import { controlerTrace, demiTours, nettoyerTrace } from '../import/controles';
import { reduireExtrait, texteExtrait } from '../decor/reduction';
import { zonesEntrees } from '../import/decors';
import { ErreurImport, lireJournee } from '../import/fichier';
import { geocoder } from '../import/geocodage';
import { calculerItineraire } from '../import/itineraire';
import type { Reseau } from '../import/reseau';
import { motifDeNom, raccorder, type GeometrieRue } from '../import/rues';

const FIXTURES = join(import.meta.dirname, 'fixtures/import');
const FIXTURES_DECOR = join(import.meta.dirname, 'fixtures/decor');
const fixture = (nom: string) => readFile(join(FIXTURES, nom), 'utf8');
const json = (corps: unknown, statut = 200) => new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status: statut });

type Repondre = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** Faux réseau : journal des URL demandées et des attentes entre réessais. */
function fauxReseau(repondre: Repondre): Reseau & { demandes: URL[]; attentes: number[]; entetes: Record<string, string>[] } {
  const demandes: URL[] = [];
  const attentes: number[] = [];
  const entetes: Record<string, string>[] = [];
  return {
    demandes,
    attentes,
    entetes,
    recuperer: async (url, init) => {
      const u = new URL(url);
      demandes.push(u);
      entetes.push((init?.headers ?? {}) as Record<string, string>);
      return repondre(u, init);
    },
    dormir: async (ms) => {
      attentes.push(ms);
    },
  };
}

/** Réponses enregistrées pour Caen (géocodage IGN, itinéraire IGN et OSRM). */
async function repondreCaen(url: URL): Promise<Response> {
  if (url.pathname === '/geocodage/search' || url.hostname === 'api-adresse.data.gouv.fr') {
    const q = url.searchParams.get('q') ?? '';
    if (q.startsWith('Place Saint-Pierre')) return json(await fixture('geocodage-caen-saint-pierre.json'));
    if (q.startsWith('Place Saint-Sauveur')) return json(await fixture('geocodage-caen-saint-sauveur.json'));
    return json({ type: 'FeatureCollection', features: [] });
  }
  if (url.pathname === '/navigation/itineraire') return json(await fixture('itineraire-ign-caen.json'));
  if (url.hostname === 'routing.openstreetmap.de') return json(await fixture('itineraire-osrm-caen.json'));
  return json('inconnu', 404);
}

/**
 * Faux itinéraire : la ligne droite par les points demandés (IGN : start,
 * intermediates, end ; OSRM : chemin de l'URL), éventuellement transformée.
 */
function itineraireDroit(url: URL, transformer: (p: Position[]) => Position[] = (p) => p): Response {
  const lire = (t: string) => t.split(',').map(Number) as Position;
  let points: Position[];
  if (url.hostname === 'routing.openstreetmap.de') {
    points = url.pathname.split('/').at(-1)!.split(';').map(lire);
    const coordinates = transformer(points);
    return json({ code: 'Ok', routes: [{ distance: 0, geometry: { coordinates }, legs: [{ steps: [] }] }] });
  }
  const inter = url.searchParams.get('intermediates');
  points = [lire(url.searchParams.get('start')!), ...(inter ? inter.split('|').map(lire) : []), lire(url.searchParams.get('end')!)];
  return json({ distance: 0, geometry: { type: 'LineString', coordinates: transformer(points) }, portions: [] });
}

const MANIF_CAEN = {
  id: 'caen-2026-11-14',
  intitule: 'Manifestation du 14 novembre',
  ville: 'Caen',
  depart: '2026-11-14T14:40',
  parcoursAnnonce: 'départ place Saint-Pierre, arrivée place Saint-Sauveur',
  etapes: [{ adresse: 'Place Saint-Pierre, Caen' }, { adresse: 'Place Saint-Sauveur, Caen' }],
  sources: [{ libelle: 'Carte des organisateurs', url: 'https://26septembre.org/carte' }],
  verifie: { declaree: null, sansInterdiction: null },
};

describe('fichier du jour : validation stricte', () => {
  const journee = (manif: object) => ({ manifs: [{ ...MANIF_CAEN, ...manif }] });
  const erreur = (contenu: unknown, nom = '2026-11-14.json') => {
    try {
      lireJournee(contenu, nom);
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurImport);
      return (e as Error).message;
    }
    throw new Error('aucune erreur');
  };

  it('lit un fichier valide et dérive l’identifiant de la ville et du jour', () => {
    const { id: _id, ...sansId } = MANIF_CAEN;
    const lu = lireJournee({ manifs: [{ ...sansId, ville: 'Charleville-Mézières' }] }, '2026-11-14.json');
    expect(lu.jour).toBe('2026-11-14');
    expect(lu.manifs[0]!.id).toBe('charleville-mezieres-2026-11-14');
    expect(lu.manifs[0]!.zonesEvitees).toEqual([]);
  });

  it('refuse les erreurs avec un message qui dit quoi corriger', () => {
    expect(erreur(journee({ couleur: 'rouge' }))).toMatch(/caen-2026-11-14|clé inconnue « couleur »/);
    expect(erreur(journee({ sources: [] }))).toMatch(/sources.*obligatoire/);
    expect(erreur(journee({ sources: [{ libelle: 'x', url: 'ftp://a' }] }))).toMatch(/URL publique/);
    expect(erreur(journee({ depart: '2026-11-15T14:00' }))).toMatch(/départ le 2026-11-15, pas le 2026-11-14/);
    expect(erreur(journee({ depart: 'samedi 14h' }))).toMatch(/départ illisible/);
    expect(erreur(journee({ etapes: [{ adresse: 'A' }] }))).toMatch(/au moins le départ et l'arrivée/);
    expect(erreur(journee({ etapes: [{ rue: 'Rue X' }, { adresse: 'B' }] }))).toMatch(/étape n° 1 : le départ et l'arrivée sont des lieux/);
    expect(erreur(journee({ etapes: [{ adresse: 'A' }, { position: [-0.36, 49.18] }] }))).toMatch(/étape n° 2.*libelle/);
    expect(erreur(journee({ etapes: [{ adresse: 'A' }, { position: [49.18, -0.36], libelle: 'B' }] }))).toMatch(/inversées/);
    expect(erreur(journee({ etapes: [{ adresse: 'A', rue: 'B' }, { adresse: 'C' }] }))).toMatch(/exactement un/);
    expect(erreur(journee({ verifie: { declaree: true } }))).toMatch(/verifie/);
    expect(erreur(journee({ zonesEvitees: [{ adresse: 'Place X', rayonM: 0 }] }))).toMatch(/rayonM/);
    expect(erreur({ manifs: [MANIF_CAEN, MANIF_CAEN] })).toMatch(/en double/);
    expect(erreur({ manifs: [MANIF_CAEN] }, 'manifs.json')).toMatch(/AAAA-MM-JJ/);
  });
});

describe('géocodage des étapes', () => {
  it('retient le résultat de la ville de la manif, avec son libellé et son score', async () => {
    const reseau = fauxReseau(repondreCaen);
    const lieu = await geocoder(reseau, 'Place Saint-Pierre, Caen', 'Caen', 'étape n° 1');
    expect(lieu).toMatchObject({ libelle: 'Place Saint-Pierre 14000 Caen', position: [-0.361265, 49.183719], service: 'Géoplateforme IGN (géocodage)' });
    expect(lieu.score).toBeGreaterThan(0.9);
    expect(reseau.demandes[0]!.searchParams.get('q')).toBe('Place Saint-Pierre, Caen');
  });

  it('envoie un User-Agent neutre, sans donnée personnelle', async () => {
    const reseau = fauxReseau(repondreCaen);
    await geocoder(reseau, 'Place Saint-Pierre, Caen', 'Caen', 'étape n° 1');
    expect(reseau.entetes[0]!['user-agent']).toBe('petit-cortege-import/1');
  });

  it('prend le centre d’un lieu découpé entre arrondissements (place de la Bastille)', async () => {
    const reseau = fauxReseau(async () => json(await fixture('geocodage-paris-bastille.json')));
    const lieu = await geocoder(reseau, 'Place de la Bastille, Paris', 'Paris', 'étape n° 2');
    expect(lieu.fusionnes).toBe(3);
    // Près de la colonne de Juillet, pas sur un bord de la place.
    expect(distanceM(lieu.position, [2.369197, 48.853196])).toBeLessThan(40);
  });

  it('refuse un score faible en disant quelle étape corriger', async () => {
    const reseau = fauxReseau(async () => json(await fixture('geocodage-charleville-foret.json')));
    await expect(geocoder(reseau, 'Forêt, Charleville-Mézières', 'Charleville-Mézières', 'manif « c », étape n° 5')).rejects.toThrow(
      /étape n° 5 : « Forêt, Charleville-Mézières » donne au mieux « Rue Forest .* score de 0\.69/,
    );
  });

  it('refuse un résultat hors de la ville de la manif', async () => {
    const reseau = fauxReseau(async () => json(await fixture('geocodage-saint-pierre-sans-ville.json')));
    await expect(geocoder(reseau, 'Place Saint-Pierre', 'Caen', 'étape n° 1')).rejects.toThrow(/31000 Toulouse », hors de Caen/);
  });

  it('réessaie avec une attente croissante, puis se replie sur l’API Adresse', async () => {
    const reseau = fauxReseau(async (url) => (url.hostname === 'data.geopf.fr' ? json('surcharge', 503) : repondreCaen(url)));
    const lieu = await geocoder(reseau, 'Place Saint-Pierre, Caen', 'Caen', 'étape n° 1');
    expect(lieu.service).toBe('API Adresse (BAN)');
    expect(reseau.demandes.map((u) => u.hostname)).toEqual(['data.geopf.fr', 'data.geopf.fr', 'data.geopf.fr', 'api-adresse.data.gouv.fr']);
    expect(reseau.attentes).toEqual([1000, 2000]);
  });

  it('ne réessaie pas une requête refusée (HTTP 400)', async () => {
    const reseau = fauxReseau(async () => json('mauvaise requête', 400));
    await expect(geocoder(reseau, 'x', 'Caen', 'étape n° 1')).rejects.toThrow(/services indisponibles.*HTTP 400/);
    expect(reseau.demandes).toHaveLength(2);
  });
});

describe('itinéraire piéton', () => {
  const points: Position[] = [
    [-0.361265, 49.183719],
    [-0.369026, 49.182774],
  ];

  it('demande à la Géoplateforme un itinéraire piéton au format GeoJSON, et relève les voies', async () => {
    const reseau = fauxReseau(repondreCaen);
    const it = await calculerItineraire(reseau, points, 'caen', () => {});
    const u = reseau.demandes[0]!;
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      resource: 'bdtopo-osrm',
      profile: 'pedestrian',
      optimization: 'shortest',
      start: '-0.361265,49.183719',
      end: '-0.369026,49.182774',
      geometryFormat: 'geojson',
    });
    expect(it.service).toMatch(/Géoplateforme IGN/);
    expect(it.rues.map((r) => r.nom)).toEqual(['PL SAINT-PIERRE', 'R SAINT-PIERRE', 'R FROIDE', 'R SAINT-SAUVEUR', 'PL SAINT-SAUVEUR']);
  });

  it('se replie sur OSRM FOSSGIS quand la Géoplateforme est en panne', async () => {
    const journal: string[] = [];
    const reseau = fauxReseau(async (url) => (url.hostname === 'data.geopf.fr' ? json('panne', 502) : repondreCaen(url)));
    const it = await calculerItineraire(reseau, points, 'caen', (l) => journal.push(l));
    expect(it.service).toMatch(/OSRM/);
    expect(reseau.demandes.at(-1)!.pathname).toBe('/routed-foot/route/v1/foot/-0.361265,49.183719;-0.369026,49.182774');
    expect(journal.join('\n')).toMatch(/indisponible.*repli/);
  });

  it('erreur claire si aucun service ne répond', async () => {
    const reseau = fauxReseau(() => {
      throw new TypeError('fetch failed');
    });
    await expect(calculerItineraire(reseau, points, 'manif « caen »', () => {})).rejects.toThrow(/manif « caen » : aucun service d'itinéraire/);
  });
});

describe('contrôles de vraisemblance', () => {
  // Une rue plein est, 1 km.
  const a: Position = [2.35, 48.85];
  const b: Position = [2.363642, 48.85];

  it('arrondit à 6 décimales et supprime les doublons consécutifs', () => {
    expect(nettoyerTrace([[2.1234564, 48.1], [2.1234561, 48.1000001], [2.2, 48.2]])).toEqual([
      [2.123456, 48.1],
      [2.2, 48.2],
    ]);
  });

  it('accepte un tracé plausible, et une boucle (départ = arrivée)', () => {
    const aller = { type: 'LineString' as const, coordinates: [a, b] };
    expect(controlerTrace({ parcours: aller, points: [a, b], rues: [], zones: [] }).erreurs).toEqual([]);
    const c: Position = [2.363642, 48.859];
    const boucle = { type: 'LineString' as const, coordinates: [a, b, c, a] };
    expect(controlerTrace({ parcours: boucle, points: [a, b, c, a], rues: [], zones: [] }).erreurs).toEqual([]);
  });

  it('refuse un détour invraisemblable, un tracé trop court ou trop long', () => {
    const detour = { type: 'LineString' as const, coordinates: [a, [2.3568, 48.865] as Position, b] };
    expect(controlerTrace({ parcours: detour, points: [a, b], rues: [], zones: [] }).erreurs.join()).toMatch(/détour invraisemblable/);
    const court = { type: 'LineString' as const, coordinates: [a, [2.351, 48.85] as Position] };
    expect(controlerTrace({ parcours: court, points: court.coordinates, rues: [], zones: [] }).erreurs.join()).toMatch(/trop court/);
    const loin: Position = [2.6, 48.85];
    const long = { type: 'LineString' as const, coordinates: [a, loin] };
    expect(controlerTrace({ parcours: long, points: [a, loin], rues: [], zones: [] }).erreurs.join()).toMatch(/trop long/);
  });

  it('refuse un tracé qui passe dans une zone à éviter, par la géométrie ou par le nom de la voie', () => {
    const parcours = { type: 'LineString' as const, coordinates: [a, b] };
    const zone = { nom: 'Place Stanislas', libelle: 'Place Stanislas 54000 Nancy', position: [2.357, 48.8502] as Position, rayonM: 50 };
    expect(controlerTrace({ parcours, points: [a, b], rues: [], zones: [zone] }).erreurs.join()).toMatch(/à 22 m de Place Stanislas/);
    const loin = { ...zone, position: [2.357, 48.86] as Position };
    expect(controlerTrace({ parcours, points: [a, b], rues: [{ nom: 'PL STANISLAS', m: 80 }], zones: [loin] }).erreurs.join()).toMatch(
      /emprunte « PL STANISLAS »/,
    );
  });

  it('repère un aller-retour (demi-tour)', () => {
    const c: Position = [2.357, 48.85];
    expect(demiTours([a, c, [2.357, 48.851], c, b])).toEqual([[2.357, 48.851]]);
    expect(demiTours([a, c, b])).toEqual([]);
  });
});

describe('rues annoncées : raccords', () => {
  const rue = (nom: string, points: [number, Position][]): GeometrieRue => ({ nom, noeuds: new Map(points) });

  it('raccorde deux rues à leur croisement, sinon à leurs points les plus proches', () => {
    const a = rue('Rue A', [[1, [6.17, 48.69]], [2, [6.18, 48.69]]]);
    const b = rue('Rue B', [[2, [6.18, 48.69]], [3, [6.18, 48.68]]]);
    const c = rue('Rue C', [[4, [6.19, 48.6801]], [5, [6.2, 48.6801]]]);
    expect(raccorder(a, b, [6.17, 48.69])).toEqual({ sortieA: [6.18, 48.69], entreeB: [6.18, 48.69], ecartM: 0 });
    const r = raccorder(b, c, [6.18, 48.69]);
    expect(r.sortieA).toEqual([6.18, 48.68]);
    expect(r.entreeB).toEqual([6.19, 48.6801]);
    expect(r.ecartM).toBeGreaterThan(700);
  });

  it('cherche les noms dans OSM sans tenir compte des accents ni des tirets', () => {
    const motif = new RegExp(`^${motifDeNom('rue des quatre eglises')}$`, 'i');
    expect(motif.test('Rue des Quatre-Églises')).toBe(true);
    expect(motif.test('Rue des Quatre Églises')).toBe(true);
    expect(motif.test('Rue des Quatre Vents')).toBe(false);
  });
});

describe('npm run import-manifs', () => {
  let dossier: string;
  let decors: string;
  let sorties: string[];
  const MAINTENANT = new Date('2026-11-14T09:00:00Z');

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'pc-import-'));
    decors = join(dossier, 'decors');
    sorties = [];
  });
  afterEach(async () => {
    await rm(dossier, { recursive: true, force: true });
  });

  const deps = (reseau: Reseau): DependancesImportManifs => ({
    reseau,
    maintenant: () => MAINTENANT,
    ecrire: (l) => sorties.push(l),
    dossierCourant: dossier,
    racine: dossier,
    dossierDecors: decors,
    base: () => Promise.reject(new Error('pas de base dans ces tests')),
  });
  const ecrireJournee = async (manifs: object[]) => {
    await writeFile(join(dossier, '2026-11-14.json'), JSON.stringify({ manifs }));
  };
  const lireTrace = async (id: string) => JSON.parse(await readFile(join(dossier, '2026-11-14', `${id}.geojson`), 'utf8'));

  it('tracer : écrit un GeoJSON relisible, lisible par lireParcoursGeoJson, avec étapes, service et date', async () => {
    await ecrireJournee([MANIF_CAEN]);
    const code = await executerImport(['tracer', '--fichier', '2026-11-14.json'], deps(fauxReseau(repondreCaen)));
    expect(sorties.join('\n')).not.toMatch(/Erreur/);
    expect(code).toBe(0);
    const trace = await lireTrace('caen-2026-11-14');
    const parcours = lireParcoursGeoJson(trace);
    expect(parcours.coordinates.length).toBeGreaterThan(10);
    for (const [lon, lat] of parcours.coordinates) {
      expect(Math.round(lon * 1e6) / 1e6).toBe(lon);
      expect(Math.round(lat * 1e6) / 1e6).toBe(lat);
    }
    expect(trace.properties).toMatchObject({
      manif: 'caen-2026-11-14',
      etapes: [
        { rang: 1, genre: 'adresse', libelle: 'Place Saint-Pierre 14000 Caen', service: 'Géoplateforme IGN (géocodage)' },
        { rang: 2, genre: 'adresse', libelle: 'Place Saint-Sauveur 14000 Caen' },
      ],
      itineraire: { service: expect.stringMatching(/Géoplateforme IGN/), versionDonnees: '2026-11-12' },
      calculeLe: '2026-11-14T09:00:00.000Z',
      avertissements: [],
    });
    expect(trace.properties.longueurM).toBeGreaterThan(700);
    expect(trace.properties.longueurM).toBeLessThan(750);
    expect(trace.properties.attribution.join(' ')).toMatch(/Licence Ouverte 2\.0/);
    expect(sorties.join('\n')).toMatch(/caen-2026-11-14 : 0\.7\d km .*R FROIDE/s);
  });

  it('tracer : un tracé invraisemblable est refusé et rien n’est écrit ; les autres manifs sont tracées', async () => {
    const detour = { ...MANIF_CAEN, id: 'detour-2026-11-14' };
    await ecrireJournee([detour, MANIF_CAEN]);
    const reseau = fauxReseau(async (url) => {
      // Pour la manif « detour », les deux services font passer le cortège 1 km au sud.
      if (url.pathname.includes('itineraire') || url.hostname === 'routing.openstreetmap.de') {
        if (reseau.demandes.filter((u) => u.pathname.includes('itineraire') || u.hostname === 'routing.openstreetmap.de').length <= 2) {
          return itineraireDroit(url, ([p, q]) => [p!, [-0.365, 49.174], q!]);
        }
      }
      return repondreCaen(url);
    });
    const code = await executerImport(['tracer', '--fichier', '2026-11-14.json'], deps(reseau));
    expect(code).toBe(1);
    expect(sorties.join('\n')).toMatch(/manif « detour-2026-11-14 » : tracé refusé .*détour invraisemblable/s);
    await expect(lireTrace('detour-2026-11-14')).rejects.toThrow(/ENOENT/);
    expect((await lireTrace('caen-2026-11-14')).properties.manif).toBe('caen-2026-11-14');
  });

  it('tracer : si le tracé revient sur ses pas, compare avec l’autre service et garde le meilleur', async () => {
    await ecrireJournee([MANIF_CAEN]);
    const reseau = fauxReseau(async (url) => {
      // La Géoplateforme accroche l'arrivée au mauvais tronçon : 60 m plus loin, puis demi-tour.
      if (url.pathname === '/navigation/itineraire') return itineraireDroit(url, ([p, q]) => [p!, [-0.3699, 49.18265], q!]);
      return repondreCaen(url);
    });
    expect(await executerImport(['tracer', '--fichier', '2026-11-14.json'], deps(reseau))).toBe(0);
    const { itineraire } = (await lireTrace('caen-2026-11-14')).properties;
    expect(itineraire.service).toMatch(/OSRM/);
    expect(itineraire.ecartes).toEqual([expect.objectContaining({ service: expect.stringMatching(/Géoplateforme/), demiTours: 1 })]);
  });

  it('tracer : une manif marquée « aVerifier » n’est pas tracée', async () => {
    await ecrireJournee([{ ...MANIF_CAEN, aVerifier: 'étape « quais » trop vague' }]);
    const reseau = fauxReseau(repondreCaen);
    expect(await executerImport(['tracer', '--fichier', '2026-11-14.json'], deps(reseau))).toBe(0);
    expect(reseau.demandes).toEqual([]);
    expect(sorties.join('\n')).toMatch(/non tracée, marquée « aVerifier » \(étape « quais » trop vague\)/);
  });

  it('tracer : les rues annoncées sont parcourues entre leurs croisements (géométrie OSM)', async () => {
    // Deux rues en L : rue Haute (ouest → est) puis rue Basse (nord → sud), qui se croisent au nœud 2.
    const manif = {
      ...MANIF_CAEN,
      etapes: [{ adresse: 'Place Saint-Pierre, Caen' }, { rue: 'Rue Haute' }, { rue: 'Rue Basse' }, { adresse: 'Place Saint-Sauveur, Caen' }],
    };
    await ecrireJournee([manif]);
    const croisement: Position = [-0.3650, 49.1840];
    const overpass = {
      elements: [
        { type: 'way', id: 10, tags: { highway: 'residential', name: 'Rue Haute' }, nodes: [1, 2], geometry: [{ lon: -0.3615, lat: 49.1839 }, { lon: croisement[0], lat: croisement[1] }] },
        { type: 'way', id: 11, tags: { highway: 'residential', name: 'Rue Basse' }, nodes: [2, 3], geometry: [{ lon: croisement[0], lat: croisement[1] }, { lon: -0.3655, lat: 49.1828 }] },
      ],
    };
    const ban = (nom: string, p: Position) => ({
      features: [{ geometry: { coordinates: p }, properties: { label: `${nom} 14000 Caen`, name: nom, score: 0.95, city: 'Caen', type: 'street' } }],
    });
    const requetes: string[] = [];
    const reseau = fauxReseau(async (url, init) => {
      const q = url.searchParams.get('q') ?? '';
      if (q.startsWith('Rue Haute')) return json(ban('Rue Haute', [-0.3632, 49.1839]));
      if (q.startsWith('Rue Basse')) return json(ban('Rue Basse', [-0.3652, 49.1834]));
      if (url.pathname.endsWith('/interpreter')) {
        requetes.push(new URLSearchParams(String(init?.body)).get('data') ?? '');
        return json(overpass);
      }
      if (url.pathname === '/navigation/itineraire') return itineraireDroit(url);
      return repondreCaen(url);
    });
    expect(await executerImport(['tracer', '--fichier', '2026-11-14.json', '--overpass', 'https://overpass.exemple/api/interpreter'], deps(reseau))).toBe(0);
    expect(requetes[0]).toContain('way["highway"]["name"~"^(r[uùûüUÙÛÜ][eéèêëEÉÈÊË]');
    const { properties } = await lireTrace('caen-2026-11-14');
    // Départ, entrée de la rue Haute (son point le plus proche du départ), croisement, sortie de la rue Basse, arrivée.
    expect(properties.pointsDePassage).toEqual([[-0.361265, 49.183719], [-0.3615, 49.1839], croisement, [-0.3655, 49.1828], [-0.369026, 49.182774]]);
    expect(properties.etapes[1]).toMatchObject({ genre: 'rue', entree: [-0.3615, 49.1839], sortie: croisement });
    expect(properties.attribution.join(' ')).toMatch(/OpenStreetMap/);
  });

  it('decors : extrait OSM (serveur suivant si le premier est en panne), tilemap et index ; rejoue sans réseau', async () => {
    const parcoursMini = JSON.parse(await readFile(join(FIXTURES_DECOR, 'parcours-mini.geojson'), 'utf8'));
    await ecrireJournee([{ ...MANIF_CAEN, id: 'mini-2026-11-14', ville: 'Paris' }]);
    await mkdir(join(dossier, '2026-11-14'), { recursive: true });
    await writeFile(join(dossier, '2026-11-14', 'mini-2026-11-14.geojson'), JSON.stringify(parcoursMini));
    const extrait = await readFile(join(FIXTURES_DECOR, 'extrait-mini.json'), 'utf8');
    const reseau = fauxReseau((url) => (url.hostname === 'premier.exemple' ? json('surcharge', 504) : json(extrait)));
    const argv = ['decors', '--fichier', '2026-11-14.json', '--overpass', 'https://premier.exemple/api/interpreter', '--overpass', 'https://second.exemple/api/interpreter'];

    expect(await executerImport(argv, deps(reseau))).toBe(0);
    // Bande puis alentours : chaque fois, le premier serveur (deux essais) puis le second.
    expect(reseau.demandes.map((u) => u.hostname)).toEqual([
      'premier.exemple', 'premier.exemple', 'second.exemple', 'premier.exemple', 'premier.exemple', 'second.exemple',
    ]);
    expect(await readFile(join(dossier, 'donnees/osm/mini-2026-11-14/extrait-overpass.json'), 'utf8')).toBe(texteExtrait(reduireExtrait(JSON.parse(extrait))));
    const alentours = await readFile(join(dossier, 'donnees/osm/mini-2026-11-14/plan-overpass.json'), 'utf8');
    expect(alentours).not.toMatch(/"building"|Boulangerie/);
    expect((await lireDecor(JSON.parse(await readFile(join(decors, 'mini-2026-11-14.json'), 'utf8')))).alentours).toBeDefined();
    const index = lireIndexDecors(JSON.parse(await readFile(join(decors, 'index.json'), 'utf8')));
    expect(index.decors).toEqual([expect.objectContaining({ fichier: 'mini-2026-11-14.json', demiLargeurM: 100, trace: [[2.36, 48.87], [2.365463, 48.87]] })]);
    expect(decorDuParcours(index, parcoursMini.geometry.coordinates)?.fichier).toBe('mini-2026-11-14.json');
    expect(sorties.join('\n')).toMatch(/décor .*mini-2026-11-14\.json \(\d+ Ko\), extrait OSM \d+ Ko, alentours \d+ Ko/);

    const avant = reseau.demandes.length;
    expect(await executerImport(argv, deps(reseau))).toBe(0);
    expect(reseau.demandes).toHaveLength(avant);
    expect(sorties.join('\n')).toMatch(/rejoué sans réseau/);
  });

  it('commande ou option inconnue : aide et code 1', async () => {
    expect(await executerImport(['tracerr'], deps(fauxReseau(repondreCaen)))).toBe(1);
    expect(sorties.join('\n')).toMatch(/Commande inconnue : tracerr/);
    expect(await executerImport(['tracer'], deps(fauxReseau(repondreCaen)))).toBe(1);
    expect(sorties.join('\n')).toMatch(/--fichier obligatoire/);
  });
});

describe('zones à éviter : emprise OSM des places', () => {
  // Une place d'environ 100 m de côté au sud d'une rue est-ouest.
  const place = {
    type: 'way' as const,
    id: 1,
    tags: { highway: 'pedestrian', area: 'yes', name: 'Place Charles III' },
    nodes: [1, 2, 3, 4, 1],
    geometry: [
      { lon: 6.18, lat: 48.689 },
      { lon: 6.18137, lat: 48.689 },
      { lon: 6.18137, lat: 48.6881 },
      { lon: 6.18, lat: 48.6881 },
      { lon: 6.18, lat: 48.689 },
    ],
  };
  const manif = lireJournee(
    { manifs: [{ ...MANIF_CAEN, ville: 'Nancy', zonesEvitees: [{ adresse: 'Place Charles III, Nancy', rayonM: 50 }] }] },
    '2026-11-14.json',
  ).manifs[0]!;

  it('signale un tracé qui entre dans la place, pas un tracé qui longe son bord', () => {
    const longe = { type: 'LineString' as const, coordinates: [[6.179, 48.68905], [6.183, 48.68905]] as Position[] };
    const traverse = { type: 'LineString' as const, coordinates: [[6.179, 48.6885], [6.183, 48.6885]] as Position[] };
    expect(zonesEntrees(manif, longe, { elements: [place] })).toEqual([]);
    expect(zonesEntrees(manif, traverse, { elements: [place] })).toEqual(['Place Charles III']);
  });
});
