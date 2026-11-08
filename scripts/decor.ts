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
  type PlanDecor,
  type Position,
} from '@petit-cortege/shared';
import { ecrirePng } from './apparence/atlas';
import { DEMI_LARGEUR_PAR_DEFAUT_M, genererDecor } from './decor/carte';
import { itineraireLeLongDe } from './decor/itineraire';
import type { ExtraitOverpass } from './decor/osm';
import { RAYON_EXTRACTION_M, requeteBande, requetePlan, telechargerExtrait, type BoiteGeo } from './decor/overpass';
import { genererPlan, METRES_PAR_PIXEL_PAR_DEFAUT, RAYON_PLAN_PAR_DEFAUT_M } from './decor/plan';
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
  plan --parcours <geojson> (--osm <extrait.json>… | --overpass <url>) --decor <carte.json>
       [--rayon <m>] [--metres-par-pixel <m>] [--morceaux <n>]
      Génère le plan de la ville autour du parcours (PNG à côté de la carte, ODbL) et l'attache au
      décor dans index.json. Plusieurs --osm s'assemblent ; avec --overpass, --morceaux <n> découpe
      la zone en n × n requêtes (un serveur Overpass expire souvent sur plusieurs kilomètres).
  parcours (--osm <extrait.json> | --overpass <url>) --rue <nom> [--rue <place traversée>…] --depart <lon,lat> --arrivee <lon,lat> --sortie <geojson>
      Trace un parcours le long des chemins OSM d'une rue (avec --overpass : chemins de ce nom autour des deux points).`;

const OPTIONS = {
  parcours: { type: 'string' },
  osm: { type: 'string', multiple: true },
  decor: { type: 'string' },
  'metres-par-pixel': { type: 'string' },
  morceaux: { type: 'string' },
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
  type OptionTexte = Exclude<keyof typeof OPTIONS, 'rue' | 'osm'>;
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
  /** Extraits assemblés (morceaux d'une grande zone) : éléments mis bout à bout, doublons ignorés. */
  const assembler = (extraits: ExtraitOverpass[]): ExtraitOverpass => {
    const vus = new Set<string>();
    const elements: ExtraitOverpass['elements'] = [];
    for (const extrait of extraits) {
      for (const e of extrait.elements) {
        const cle = `${e.type}/${e.id}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        elements.push(e);
      }
    }
    return { elements };
  };
  const extraitOsm = async (requete: () => string): Promise<ExtraitOverpass> => {
    if (v.osm?.length) {
      const extraits: ExtraitOverpass[] = [];
      for (const fichier of v.osm) extraits.push(JSON.parse(await readFile(resolve(deps.dossierCourant, fichier), 'utf8')) as ExtraitOverpass);
      return assembler(extraits);
    }
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
      const carte = genererDecor({
        osm,
        parcours,
        demiLargeurM: nombre('demi-largeur', DEMI_LARGEUR_PAR_DEFAUT_M),
        dossierKenney: relative(dirname(sortie), join(RACINE, 'assets/kenney')).split('\\').join('/'),
      });
      await ecrireFichier(sortie, `${JSON.stringify(carte)}\n`);
      await inscrireDansIndex(join(dirname(sortie), CHEMIN_INDEX_DECORS), basename(sortie), carte, ecrireFichier);
      return;
    }
    case 'plan': {
      const parcours = await lireParcours();
      const rayonM = nombre('rayon', RAYON_PLAN_PAR_DEFAUT_M);
      const carte = chemin('decor');
      const fichierIndex = join(dirname(carte), CHEMIN_INDEX_DECORS);
      const index = lireIndexDecors(JSON.parse(await readFile(fichierIndex, 'utf8')));
      const entree = index.decors.find((d) => d.fichier === basename(carte));
      if (!entree) throw new Error(`${basename(carte)} n'est pas dans ${relative(deps.dossierCourant, fichierIndex)} : générer d'abord sa tilemap.`);
      const boite = boiteElargie(parcours, rayonM);
      const morceaux = Math.round(nombre('morceaux', 1));
      const osm =
        v.overpass && !v.osm?.length && morceaux > 1
          ? assembler(await telechargerParMorceaux(v.overpass, boite, morceaux, deps.ecrire))
          : await extraitOsm(() => requetePlan(boite));
      const { image, plan } = genererPlan({ osm, parcours, rayonM, metresParPixel: nombre('metres-par-pixel', METRES_PAR_PIXEL_PAR_DEFAUT) });
      const fichierPlan = `${basename(carte, '.json')}-plan.png`;
      await mkdir(dirname(carte), { recursive: true });
      await writeFile(join(dirname(carte), fichierPlan), ecrirePng(image));
      deps.ecrire(`Écrit : ${relative(deps.dossierCourant, join(dirname(carte), fichierPlan))} (${image.largeur} × ${image.hauteur} px)`);
      const avecPlan: PlanDecor = { fichier: fichierPlan, ...plan };
      index.decors = index.decors.map((d) => (d === entree ? { ...d, plan: avecPlan } : d));
      await ecrireFichier(fichierIndex, `${JSON.stringify(index, null, 1)}\n`);
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

/** Télécharge la zone en n × n boîtes, l'une après l'autre (un serveur Overpass partagé n'aime pas les rafales). */
async function telechargerParMorceaux(url: string, { sud, ouest, nord, est }: BoiteGeo, n: number, ecrire: (l: string) => void): Promise<ExtraitOverpass[]> {
  const extraits: ExtraitOverpass[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const boite = {
        sud: sud + ((nord - sud) * i) / n,
        nord: sud + ((nord - sud) * (i + 1)) / n,
        ouest: ouest + ((est - ouest) * j) / n,
        est: ouest + ((est - ouest) * (j + 1)) / n,
      };
      extraits.push((await telechargerExtrait(url, requetePlan(boite))).extrait);
      ecrire(`Morceau ${i * n + j + 1}/${n * n} téléchargé.`);
    }
  }
  return extraits;
}

/** Boîte géographique du parcours élargie de `rayonM`. */
function boiteElargie(parcours: Parcours, rayonM: number): BoiteGeo {
  const lons = parcours.coordinates.map((p) => p[0]);
  const lats = parcours.coordinates.map((p) => p[1]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = rayonM / 110_540;
  const dLon = rayonM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { sud: Math.min(...lats) - dLat, ouest: Math.min(...lons) - dLon, nord: Math.max(...lats) + dLat, est: Math.max(...lons) + dLon };
}

/** Ajoute (ou remplace) la carte dans l'index des décors de son dossier. */
async function inscrireDansIndex(
  fichierIndex: string,
  fichier: string,
  carte: CarteTiled,
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
  // Le plan de la ville déjà attaché au décor est gardé.
  const plan = index.decors.find((d) => d.fichier === fichier)?.plan;
  index.decors = [...index.decors.filter((d) => d.fichier !== fichier), { fichier, emprise, ...(plan ? { plan } : {}) }];
  await ecrireFichier(fichierIndex, `${JSON.stringify(index, null, 1)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    await executerDecor(process.argv.slice(2), { ecrire: console.log, dossierCourant: process.env.INIT_CWD ?? process.cwd() });
  } catch (erreur) {
    console.error(`Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  }
}
