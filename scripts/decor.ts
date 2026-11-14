/**
 * Décor OSM d'une manif (semi-automatique, puis nettoyage éventuel dans Tiled).
 * Usage : `npm run decor -- <commande> [options]` ; `npm run decor -- aide`.
 *
 * Source OSM : `--overpass <url>` (API Overpass ou miroir) ou `--osm <fichier>`
 * (réponse JSON Overpass enregistrée, pour rejouer sans réseau).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { lireParcoursGeoJson } from '@petit-cortege/server';
import {
  CHEMIN_INDEX_DECORS,
  lireIndexDecors,
  VERSION_INDEX_DECORS,
  versPosition,
  type CarteTiled,
  type IndexDecors,
  type Parcours,
  type Position,
} from '@petit-cortege/shared';
import { DEMI_LARGEUR_PAR_DEFAUT_M, genererDecor } from './decor/carte';
import { itineraireLeLongDe } from './decor/itineraire';
import type { ExtraitOverpass } from './decor/osm';
import { RAYON_EXTRACTION_M, requeteBande, telechargerExtrait } from './decor/overpass';
import { RACINE } from './config';

export interface DependancesDecor {
  ecrire: (ligne: string) => void;
  /** Dossier contre lequel résoudre les chemins (dossier où la commande a été tapée). */
  dossierCourant: string;
}

const AIDE = `Commandes :
  extraire --parcours <geojson> --overpass <url> --sortie <extrait.json> [--rayon <m>]
      Enregistre la réponse Overpass brute (bande autour du parcours ; rues, verts, eau, bâtiments, places).
  tilemap --parcours <geojson> (--osm <extrait.json> | --overpass <url>) --sortie <carte.json>
          [--demi-largeur <m>] [--rayon <m>]
      Génère la tilemap Tiled (ODbL) et l'inscrit dans l'index.json de son dossier.
  parcours (--osm <extrait.json> | --overpass <url>) --rue <nom> [--rue <place traversée>…] --depart <lon,lat> --arrivee <lon,lat> --sortie <geojson>
      Trace un parcours le long des chemins OSM d'une rue (avec --overpass : chemins de ce nom autour des deux points).`;

const OPTIONS = {
  parcours: { type: 'string' },
  osm: { type: 'string' },
  overpass: { type: 'string' },
  sortie: { type: 'string' },
  rayon: { type: 'string' },
  'demi-largeur': { type: 'string' },
  rue: { type: 'string', multiple: true },
  depart: { type: 'string' },
  arrivee: { type: 'string' },
} as const;

export async function executerDecor(argv: string[], deps: DependancesDecor): Promise<void> {
  const [commande, ...reste] = argv;
  const { values: v } = parseArgs({ args: reste, options: OPTIONS, strict: true });
  type OptionTexte = Exclude<keyof typeof OPTIONS, 'rue'>;
  const chemin = (nom: OptionTexte) => {
    const valeur = v[nom];
    if (!valeur) throw new Error(`option --${nom} manquante.\n\n${AIDE}`);
    return resolve(deps.dossierCourant, valeur);
  };
  const nombre = (nom: OptionTexte, defaut: number) => {
    const n = v[nom] === undefined ? defaut : Number(v[nom]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${nom} illisible : « ${v[nom]} ».`);
    return n;
  };
  const lireParcours = async (): Promise<Parcours> => lireParcoursGeoJson(JSON.parse(await readFile(chemin('parcours'), 'utf8')));
  const ecrireFichier = async (fichier: string, contenu: string) => {
    await mkdir(dirname(fichier), { recursive: true });
    await writeFile(fichier, contenu);
    deps.ecrire(`Écrit : ${relative(deps.dossierCourant, fichier) || fichier}`);
  };
  const extraitOsm = async (requete: () => string): Promise<ExtraitOverpass> => {
    if (v.osm) return JSON.parse(await readFile(chemin('osm'), 'utf8')) as ExtraitOverpass;
    if (v.overpass) return (await telechargerExtrait(v.overpass, requete())).extrait;
    throw new Error(`donner --osm ou --overpass.\n\n${AIDE}`);
  };

  switch (commande) {
    case 'extraire': {
      const parcours = await lireParcours();
      if (!v.overpass) throw new Error(`option --overpass manquante.\n\n${AIDE}`);
      const { texte, extrait } = await telechargerExtrait(v.overpass, requeteBande(parcours, nombre('rayon', RAYON_EXTRACTION_M)));
      await ecrireFichier(chemin('sortie'), texte);
      deps.ecrire(`${extrait.elements.length} éléments OSM.`);
      return;
    }
    case 'tilemap': {
      const parcours = await lireParcours();
      const osm = await extraitOsm(() => requeteBande(parcours, nombre('rayon', RAYON_EXTRACTION_M)));
      const sortie = chemin('sortie');
      const demiLargeurM = nombre('demi-largeur', DEMI_LARGEUR_PAR_DEFAUT_M);
      const carte = genererDecor({
        osm,
        parcours,
        demiLargeurM,
        dossierKenney: relative(dirname(sortie), join(RACINE, 'assets/kenney')).split('\\').join('/'),
      });
      await ecrireFichier(sortie, `${JSON.stringify(carte)}\n`);
      await inscrireDansIndex(join(dirname(sortie), CHEMIN_INDEX_DECORS), basename(sortie), carte, parcours, demiLargeurM, ecrireFichier);
      return;
    }
    case 'parcours': {
      const depart = lirePosition(v.depart, 'depart');
      const arrivee = lirePosition(v.arrivee, 'arrivee');
      const rues = v.rue ?? [];
      if (rues.length === 0) throw new Error(`option --rue manquante.\n\n${AIDE}`);
      const osm = await extraitOsm(() => requeteRues(rues, depart, arrivee));
      const parcours = itineraireLeLongDe(osm, { rues, depart, arrivee });
      const geojson = { type: 'Feature', properties: { name: rues.join(', '), source: '© les contributeurs d’OpenStreetMap (ODbL)' }, geometry: parcours };
      await ecrireFichier(chemin('sortie'), `${JSON.stringify(geojson, null, 1)}\n`);
      return;
    }
    case 'aide':
    case undefined:
      deps.ecrire(AIDE);
      return;
    default:
      throw new Error(`commande inconnue : « ${commande} ».\n\n${AIDE}`);
  }
}

function lirePosition(texte: string | undefined, nom: string): Position {
  const [lon, lat] = (texte ?? '').split(',').map(Number);
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`--${nom} attendu sous la forme <longitude,latitude>.`);
  }
  return [lon, lat];
}

/** Chemins des rues nommées dans le rectangle des deux points (marge ≈ 500 m). */
function requeteRues(rues: string[], a: Position, b: Position): string {
  const marge = 0.005;
  const sud = Math.min(a[1], b[1]) - marge;
  const nord = Math.max(a[1], b[1]) + marge;
  const ouest = Math.min(a[0], b[0]) - marge;
  const est = Math.max(a[0], b[0]) + marge;
  const filtre = rues.map((r) => r.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&')).join('|');
  return `[out:json][timeout:60];way["highway"]["name"~${JSON.stringify(`^(${filtre})$`)}](${sud},${ouest},${nord},${est});out geom;`;
}

/** Ajoute (ou remplace) la carte dans l'index des décors de son dossier, avec son tracé simplifié. */
export async function inscrireDansIndex(
  fichierIndex: string,
  fichier: string,
  carte: CarteTiled,
  parcours: Parcours,
  demiLargeurM: number,
  ecrireFichier: (f: string, c: string) => Promise<void>,
): Promise<void> {
  let index: IndexDecors = { v: VERSION_INDEX_DECORS, decors: [] };
  try {
    index = lireIndexDecors(JSON.parse(await readFile(fichierIndex, 'utf8')));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur;
  }
  const valeur = (nom: string) => Number(carte.properties.find((p) => p.name === nom)?.value);
  const georef = { origine: [valeur('origine_lon'), valeur('origine_lat')] as Position };
  const [lonMax, latMin] = versPosition(georef, { x: carte.width, y: carte.height });
  const emprise: [number, number, number, number] = [georef.origine[0], latMin, lonMax, georef.origine[1]];
  const trace = simplifierLigne(parcours.coordinates, TOLERANCE_TRACE_INDEX_M).map(
    ([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as Position,
  );
  index.decors = [...index.decors.filter((d) => d.fichier !== fichier), { fichier, emprise, trace, demiLargeurM }];
  await ecrireFichier(fichierIndex, `${JSON.stringify(index, null, 1)}\n`);
}

/** Tolérance de simplification du tracé inscrit dans l'index (m) : négligeable devant la demi-bande. */
const TOLERANCE_TRACE_INDEX_M = 3;

/** Douglas-Peucker en projection locale : garde les sommets qui s'écartent de plus de `toleranceM`. */
export function simplifierLigne(ligne: Position[], toleranceM: number): Position[] {
  if (ligne.length <= 2) return [...ligne];
  const origine = ligne[0]!;
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180);
  const ky = 110_540;
  const plan = ligne.map(([lon, lat]) => [(lon - origine[0]) * kx, (lat - origine[1]) * ky] as const);
  const garder = new Array<boolean>(ligne.length).fill(false);
  garder[0] = garder[ligne.length - 1] = true;
  const pile: [number, number][] = [[0, ligne.length - 1]];
  while (pile.length > 0) {
    const [i, j] = pile.pop()!;
    const [ax, ay] = plan[i]!;
    const [bx, by] = plan[j]!;
    const l = Math.hypot(bx - ax, by - ay);
    let [kMax, dMax] = [-1, 0];
    for (let k = i + 1; k < j; k++) {
      const [px, py] = plan[k]!;
      const d = l === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / l;
      if (d > dMax) [kMax, dMax] = [k, d];
    }
    if (kMax >= 0 && dMax > toleranceM) {
      garder[kMax] = true;
      pile.push([i, kMax], [kMax, j]);
    }
  }
  return ligne.filter((_, k) => garder[k]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await executerDecor(process.argv.slice(2), { ecrire: console.log, dossierCourant: process.env.INIT_CWD ?? process.cwd() });
  } catch (erreur) {
    console.error(`Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  }
}
