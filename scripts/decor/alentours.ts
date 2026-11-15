/**
 * Plan de la ville (couche `alentours`) : autour de la bande détaillée, sur tout le carré que
 * l'écran peut montrer au dézoom maximal centré sur le parcours (`empriseDuPlan`), une carte
 * simplifiée et homogène : rues selon leur type, places piétonnes, espaces verts, eau, et
 * entre les rues des pâtés de maisons (aucun bâtiment individuel) dans les teintes des toits
 * et des cours de la bande. Résolution réduite, la même partout : cases de 8 m (4 m pour un petit plan).
 *
 * Données : requêtes Overpass sans bâtiments, une par pavé de COTE_PAVE_M, puis un extrait
 * simplifié (seuls les objets et les tags que le rendu utilise, géométrie arrondie et
 * simplifiée), lisible par `lireExtrait` (ODbL).
 */
import {
  COUCHE_ALENTOURS,
  empriseDuPlan,
  METRES_PAR_TUILE,
  PROPRIETE_TEINTES_ILOTS,
  PROPRIETE_TUILES_PAR_CASE,
  TAILLE_BLOC,
  versPosition,
  versTuiles,
  type EmpriseDuPlan,
  type CoucheTuilesTiled,
  type Georeference,
  type Parcours,
  type PointTuiles,
  type Position,
} from '@petit-cortege/shared';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coucheTuiles, RAYON_MIN_TUILES } from './carte';
import { classer, COURS_D_EAU, EAUX, RUES, Terrain, VERTS, type Classement } from './classement';
import { simplifierLigne } from './geometrie';
import { lireExtrait, type ElementOverpass, type ExtraitOverpass, type ObjetOsm } from './osm';
import { Grille } from './raster';
import { TUILES } from './tuiles';

/**
 * Côté d'une case du plan, en tuiles : 4 tuiles (8 m) pour un grand plan (au dézoom maximal
 * un pixel d'écran vaut plusieurs mètres ; une rue résidentielle fait encore une case), 2
 * tuiles (4 m) pour un petit plan, dont le dézoom maximal est plus proche : le poids reste
 * modeste et les cases ne se voient pas. Une seule résolution par plan (pas d'anneau).
 */
export const TUILES_PAR_CASE_ALENTOURS = 4;
export const TUILES_PAR_CASE_PETIT_PLAN = 2;
/** Côté maximal (en cases de 4 m) d'un plan à la résolution fine : ≈ 4 km. */
const CASES_MAX_PETIT_PLAN = 1024;

/** Tuiles par case du plan selon son demi-côté (m). */
export function tuilesParCasePour(demiCoteM: number): number {
  const fines = (2 * demiCoteM) / (METRES_PAR_TUILE * TUILES_PAR_CASE_PETIT_PLAN);
  return fines <= CASES_MAX_PETIT_PLAN ? TUILES_PAR_CASE_PETIT_PLAN : TUILES_PAR_CASE_ALENTOURS;
}
/** Côté des blocs de la couche (en cases) : bien moins d'en-têtes que des blocs de 32. */
export const CASES_PAR_BLOC_PLAN = 256;
/** Côté maximal d'un pavé de requête Overpass (m) : des réponses de quelques Mo. */
export const COTE_PAVE_M = 3000;
/** Un pavé refusé (délai dépassé) est redécoupé en quatre, jusqu'à cette taille. */
const COTE_PAVE_MIN_M = 700;
/** Objets qui touchent le plan sans que leur géométrie y entre (grandes surfaces) : marge de la requête. */
const MARGE_EXTRACTION_M = 60;
/** Simplification de la géométrie enregistrée : bien moins qu'une case (8 m). */
const TOLERANCE_GEOMETRIE_M = 2;
const DECIMALES = 1e5;

/** Rues retenues au plan : la voirie (pas les chemins, trottoirs, pistes ni voies de service), places piétonnes comprises. */
const TYPES_RUES = [...Object.keys(RUES).filter((t) => t !== 'service'), 'pedestrian'];

const motif = (valeurs: string[]) => JSON.stringify(`^(${valeurs.join('|')})$`);

/** Rectangle géographique (degrés). */
export interface Rectangle {
  sud: number;
  ouest: number;
  nord: number;
  est: number;
}

/** Emprise du plan d'un parcours, en mètres depuis l'origine `georef` (cf. `empriseDuPlan`). */
export function empriseDuParcours(parcours: Parcours, georef: Georeference): EmpriseDuPlan {
  return empriseDuPlan(parcours.coordinates.map((p) => {
    const t = versTuiles(georef, p);
    return { x: t.x * METRES_PAR_TUILE, y: t.y * METRES_PAR_TUILE };
  }));
}

/** Rectangle géographique couvert par l'emprise du plan (demi-côté imposé ou non), marge d'extraction comprise. */
export function rectangleDuPlan(parcours: Parcours, demiCoteM?: number): Rectangle {
  const georef: Georeference = { origine: parcours.coordinates[0]! };
  const emprise = empriseDuParcours(parcours, georef);
  const d = (demiCoteM ?? emprise.demiCote) + MARGE_EXTRACTION_M;
  const { centre } = emprise;
  const [ouest, nord] = versPosition(georef, { x: (centre.x - d) / METRES_PAR_TUILE, y: (centre.y - d) / METRES_PAR_TUILE });
  const [est, sud] = versPosition(georef, { x: (centre.x + d) / METRES_PAR_TUILE, y: (centre.y + d) / METRES_PAR_TUILE });
  return { sud, ouest, nord, est };
}

/** Découpe un rectangle en pavés d'au plus `coteM` de côté (requêtes séparées). */
export function paves(r: Rectangle, coteM = COTE_PAVE_M): Rectangle[] {
  const kx = 111_320 * Math.cos((((r.sud + r.nord) / 2) * Math.PI) / 180);
  const nx = Math.max(1, Math.ceil(((r.est - r.ouest) * kx) / coteM));
  const ny = Math.max(1, Math.ceil(((r.nord - r.sud) * 110_540) / coteM));
  const resultat: Rectangle[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      resultat.push({
        sud: r.sud + ((r.nord - r.sud) * j) / ny,
        nord: r.sud + ((r.nord - r.sud) * (j + 1)) / ny,
        ouest: r.ouest + ((r.est - r.ouest) * i) / nx,
        est: r.ouest + ((r.est - r.ouest) * (i + 1)) / nx,
      });
    }
  }
  return resultat;
}

/** Requête Overpass QL du plan sur un pavé : rues, verts, eau, places ; aucun bâtiment. */
export function requetePlan(pave: Rectangle): string {
  const bbox = [pave.sud, pave.ouest, pave.nord, pave.est].map((v) => v.toFixed(6)).join(',');
  const surfaces = new Map<string, string[]>();
  for (const table of [VERTS, EAUX]) {
    for (const [cle, valeurs] of Object.entries(table)) surfaces.set(cle, [...(surfaces.get(cle) ?? []), ...valeurs]);
  }
  const filtres = [...surfaces].map(([cle, valeurs]) => `[${JSON.stringify(cle)}~${motif(valeurs)}]`);
  return [
    `[out:json][timeout:240][bbox:${bbox}];`,
    '(',
    `  way["highway"~${JSON.stringify(`^(${TYPES_RUES.join('|')})(_link)?$`)}];`,
    '  way["place"="square"];',
    ...filtres.map((f) => `  way${f};`),
    `  way["waterway"~${motif(Object.keys(COURS_D_EAU))}];`,
    ...filtres.map((f) => `  relation["type"="multipolygon"]${f};`),
    ');',
    'out geom;',
  ].join('\n');
}

/** Requêtes du plan d'un parcours : une par pavé. */
export function requetesPlan(parcours: Parcours, demiCoteM?: number): string[] {
  return paves(rectangleDuPlan(parcours, demiCoteM)).map(requetePlan);
}

/** Pause entre deux pavés : pas de rafale sur les serveurs Overpass. */
export const PAUSE_ENTRE_PAVES_MS = 5000;

/**
 * Télécharge le plan pavé par pavé (chaque requête avec ses réessais et ses serveurs, cf.
 * `telecharger`), simplifie et fusionne : l'extrait simplifié du plan.
 */
export async function telechargerPlan(
  parcours: Parcours,
  telecharger: (requete: string) => Promise<{ extrait: ExtraitOverpass; url: string }>,
  journal: (ligne: string) => void,
  options: {
    demiCoteM?: number | undefined;
    pauseMs?: number | undefined;
    /** Pavés déjà téléchargés (par requête) : une panne en cours de route ne fait pas tout reprendre. */
    cache?: CachePaves | undefined;
  } = {},
): Promise<ExtraitOverpass> {
  const liste = paves(rectangleDuPlan(parcours, options.demiCoteM));
  const morceaux: ExtraitOverpass[] = [];
  let premier = true;
  const pause = () => new Promise((r) => setTimeout(r, options.pauseMs ?? PAUSE_ENTRE_PAVES_MS));
  const unPave = async (pave: Rectangle, nom: string, coteM: number): Promise<void> => {
    const requete = requetePlan(pave);
    const enCache = await options.cache?.lire(requete);
    if (enCache) {
      journal(`  plan, pavé ${nom} déjà téléchargé.`);
      morceaux.push(enCache);
      return;
    }
    if (!premier) await pause();
    premier = false;
    let reponse: { extrait: ExtraitOverpass; url: string };
    try {
      reponse = await telecharger(requete);
    } catch (erreur) {
      // Trop lourd pour les serveurs (délai dépassé, 504) : en quatre pavés plus petits.
      if (coteM / 2 < COTE_PAVE_MIN_M) throw erreur;
      journal(`  plan, pavé ${nom} refusé : découpé en quatre.`);
      for (const [k, sous] of paves(pave, coteM / 2).entries()) await unPave(sous, `${nom}.${k + 1}`, coteM / 2);
      return;
    }
    const simplifie = simplifierExtraitAlentours(reponse.extrait);
    journal(`  plan, pavé ${nom} (${new URL(reponse.url).host}) : ${reponse.extrait.elements.length} éléments OSM, ${simplifie.elements.length} gardés.`);
    await options.cache?.ecrire(requete, simplifie);
    morceaux.push(simplifie);
  };
  for (const [i, pave] of liste.entries()) await unPave(pave, `${i + 1}/${liste.length}`, COTE_PAVE_M);
  return fusionnerExtraits(morceaux);
}

export interface CachePaves {
  lire: (requete: string) => Promise<ExtraitOverpass | null>;
  ecrire: (requete: string, extrait: ExtraitOverpass) => Promise<void>;
}

/** Cache des pavés à côté de l'extrait du plan : `<dossier>/.paves-plan/<empreinte de la requête>.json` (ignoré par git). */
export function cacheDePaves(fichierPlan: string): CachePaves {
  const dossier = join(dirname(fichierPlan), '.paves-plan');
  const fichier = (requete: string) => join(dossier, `${createHash('sha1').update(requete).digest('hex').slice(0, 16)}.json`);
  return {
    lire: async (requete) => {
      try {
        return JSON.parse(await readFile(fichier(requete), 'utf8')) as ExtraitOverpass;
      } catch {
        return null;
      }
    },
    ecrire: async (requete, extrait) => {
      await mkdir(dossier, { recursive: true });
      await writeFile(fichier(requete), texteExtraitAlentours(extrait));
    },
  };
}

/** Réunit les réponses des pavés (un objet présent dans plusieurs pavés n'est gardé qu'une fois). */
export function fusionnerExtraits(extraits: ExtraitOverpass[]): ExtraitOverpass {
  const vus = new Set<string>();
  const elements: ElementOverpass[] = [];
  for (const e of extraits.flatMap((x) => x.elements)) {
    const cle = `${e.type}/${e.id}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    elements.push(e);
  }
  return { elements };
}

/** Ce que les alentours dessinent d'un objet OSM (null : ignoré). */
function classerAuxAlentours(objet: ObjetOsm): Classement | null {
  const classe = classer(objet);
  if (!classe) return null;
  if (classe.sorte !== 'rue') return classe;
  const type = (objet.tags.highway ?? '').replace(/_link$/, '');
  return TYPES_RUES.includes(type) || objet.tags.place === 'square' ? classe : null;
}

/** Tags lus par le classement (le reste, noms compris, n'est pas gardé). */
const TAGS_UTILES = [
  'highway', 'area', 'place', 'width', 'lanes', 'sidewalk', 'footway', 'tunnel', 'covered', 'location', 'indoor',
  'layer', 'waterway', 'natural', 'landuse', 'leisure', 'area:highway', 'type',
];

const arrondir = (v: number) => Math.round(v * DECIMALES) / DECIMALES;
const geometrie = (points: Position[]) =>
  simplifierLigne(points, TOLERANCE_GEOMETRIE_M).map(([lon, lat]) => ({ lat: arrondir(lat), lon: arrondir(lon) }));

/**
 * Extrait réduit à ce que les alentours dessinent : objets retenus, tags utiles, géométrie
 * arrondie (≈ 1 m) et simplifiée. Les extrémités des chemins sont gardées telles quelles
 * (arrondies) : les anneaux des multipolygones se recollent toujours.
 */
export function simplifierExtraitAlentours(extrait: ExtraitOverpass): ExtraitOverpass {
  const elements: ElementOverpass[] = [];
  for (const e of extrait.elements) {
    if (e.type === 'node') continue;
    const [objet] = lireExtrait({ elements: [e] });
    if (!objet || !classerAuxAlentours(objet)) continue;
    const tags = Object.fromEntries(Object.entries(e.tags ?? {}).filter(([cle]) => TAGS_UTILES.includes(cle)));
    if (e.type === 'way') {
      elements.push({ type: 'way', id: e.id, tags, geometry: geometrie(objet.ligne) });
    } else {
      const membres = (e.members ?? [])
        .filter((m) => m.type === 'way' && m.geometry?.some((p) => p !== null))
        .map((m) => ({
          type: 'way',
          ref: m.ref,
          role: m.role,
          geometry: geometrie(m.geometry!.filter((p) => p !== null).map((p) => [p.lon, p.lat] as Position)),
        }));
      elements.push({ type: 'relation', id: e.id, tags, members: membres });
    }
  }
  return { elements };
}

/** Texte de l'extrait simplifié : un élément par ligne (diffs lisibles), mention ODbL. */
export function texteExtraitAlentours(extrait: ExtraitOverpass): string {
  return [
    '{"copyright":"© les contributeurs d’OpenStreetMap, ODbL 1.0 (alentours simplifiés par petit-cortège)","elements":[',
    extrait.elements.map((e) => JSON.stringify(e)).join(',\n'),
    ']}',
    '',
  ].join('\n');
}

/**
 * Teintes des pâtés de maisons du plan, comme la bande vue de loin (toits et cours) : gravier
 * des cours (cases d'îlot, une fois sur deux), toits d'ardoise claire et de zinc pleins (Kenney
 * Roguelike Modern City ; le zinc, sombre, plus rare pour que les rues restent lisibles). Le
 * client en donne une à chaque îlot (cf. PROPRIETE_TEINTES_ILOTS).
 */
export const TEINTES_ILOTS = [TUILES.ilot, TUILES.toitArdoiseClaire, TUILES.ilot, TUILES.toitZinc];

/** Gid Kenney qui représente une case du plan (couleur moyenne de la tuile). */
const GID_DU_TERRAIN: Record<number, number> = {
  [Terrain.vide]: 0,
  [Terrain.ilot]: TEINTES_ILOTS[0]!,
  [Terrain.vert]: TUILES.vert,
  [Terrain.eau]: TUILES.eau,
  [Terrain.trottoir]: TUILES.trottoir,
  [Terrain.pieton]: TUILES.pieton,
  [Terrain.chaussee]: TUILES.chaussee,
};

export interface OptionsAlentours {
  /** Identifiant de la couche dans la carte. */
  id: number;
  osm: ExtraitOverpass;
  parcours: Parcours;
  /** Géoréférence de la carte (la bande) : les cases partent de la même origine. */
  georef: Georeference;
  tuilesParCase?: number;
  /** Demi-côté imposé du plan (m) ; défaut : `empriseDuPlan`. */
  demiCoteM?: number;
}

/**
 * Couche `alentours` : le plan de la ville sur le carré `empriseDuPlan` (cases de 8 m), îlots
 * entre les rues, en blocs de CASES_PAR_BLOC_PLAN cases (cases hors du carré : 0, vide).
 */
export function genererAlentours(options: OptionsAlentours): CoucheTuilesTiled {
  const emprise = empriseDuParcours(options.parcours, options.georef);
  const demiCoteM = options.demiCoteM ?? emprise.demiCote;
  const k = options.tuilesParCase ?? tuilesParCasePour(demiCoteM);
  const metresParCase = METRES_PAR_TUILE * k;
  const enCases = (p: Position): PointTuiles => {
    const t = versTuiles(options.georef, p);
    return { x: t.x / k, y: t.y / k };
  };
  const demi = demiCoteM / metresParCase;
  const centre = { x: emprise.centre.x / metresParCase, y: emprise.centre.y / metresParCase };
  const aligner = (v: number) => Math.floor(v / TAILLE_BLOC) * TAILLE_BLOC;
  const ox = aligner(centre.x - demi);
  const oy = aligner(centre.y - demi);
  const largeur = Math.ceil(centre.x + demi) - ox;
  const hauteur = Math.ceil(centre.y + demi) - oy;
  const projeter = (l: Position[]) => l.map((p) => {
    const c = enCases(p);
    return { x: c.x - ox, y: c.y - oy };
  });
  const rayonDe = (largeurM: number) => Math.max(largeurM / 2 / metresParCase, RAYON_MIN_TUILES);

  const grille = new Grille(largeur, hauteur);
  // Tout le carré (centres de cases dedans) en îlots, puis les rues, verts et eau par-dessus.
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      if (Math.abs(ox + x + 0.5 - centre.x) <= demi && Math.abs(oy + y + 0.5 - centre.y) <= demi) grille.cases[y * largeur + x] = Terrain.ilot;
    }
  }
  const classes = lireExtrait(options.osm)
    .map((objet) => ({ objet, classe: classerAuxAlentours(objet) }))
    .filter((c): c is { objet: ObjetOsm; classe: Classement } => c.classe !== null);
  const surfaces = (terrain: Terrain) => {
    for (const { objet, classe } of classes) {
      if (classe.sorte === 'surface' && classe.terrain === terrain) grille.peindrePolygone(objet.anneaux.map(projeter), terrain);
    }
  };
  const rues = (terrain: Terrain, avecTrottoirs: boolean) => {
    const choisies = classes
      .flatMap(({ objet, classe }) => (classe.sorte === 'rue' && classe.terrain === terrain ? [{ objet, classe }] : []))
      .sort((a, b) => a.classe.largeurM - b.classe.largeurM);
    for (const { objet, classe } of choisies) {
      if (avecTrottoirs && classe.trottoirM === 0) continue;
      const l = avecTrottoirs ? classe.largeurM + 2 * classe.trottoirM : classe.largeurM;
      grille.peindreLigne(projeter(objet.ligne), rayonDe(l), avecTrottoirs ? Terrain.trottoir : terrain);
    }
  };
  // Même ordre que la bande : une valeur peinte plus tard recouvre.
  surfaces(Terrain.vert);
  surfaces(Terrain.eau);
  for (const { objet, classe } of classes) {
    if (classe.sorte === 'cours-d-eau') grille.peindreLigne(projeter(objet.ligne), rayonDe(classe.largeurM), Terrain.eau);
  }
  rues(Terrain.chaussee, true);
  surfaces(Terrain.pieton);
  rues(Terrain.pieton, false);
  rues(Terrain.chaussee, false);

  const couche = coucheTuiles(
    options.id,
    COUCHE_ALENTOURS,
    grille,
    (g, x, y) => GID_DU_TERRAIN[g.lire(x, y)] ?? 0,
    { x: ox, y: oy },
    CASES_PAR_BLOC_PLAN,
  );
  return {
    ...couche,
    properties: [
      { name: PROPRIETE_TUILES_PAR_CASE, type: 'int', value: k },
      { name: PROPRIETE_TEINTES_ILOTS, type: 'string', value: TEINTES_ILOTS.join(',') },
    ],
  };
}
