/**
 * Alentours du décor : autour de la bande détaillée (≈ 100 m de part et d'autre du parcours),
 * une carte simplifiée sur `RAYON_ALENTOURS_PAR_DEFAUT_M` : rues selon leur type, espaces
 * verts, eau, et entre les rues des pâtés de maisons d'une seule teinte (aucun bâtiment
 * individuel). Résolution réduite : une case de 2 × 2 tuiles (4 m), assez pour la vue
 * d'ensemble (≈ 1 pixel d'écran par case) et l'horizon de la vue rapprochée.
 *
 * Données : une requête Overpass sans bâtiments, puis un extrait simplifié (seuls les objets
 * et les tags que le rendu utilise, géométrie arrondie et simplifiée) versionné dans
 * `donnees/osm/<id>/alentours-overpass.json` (ODbL), lisible par `lireExtrait`.
 */
import {
  COUCHE_ALENTOURS,
  METRES_PAR_TUILE,
  PROPRIETE_TUILES_PAR_CASE,
  TAILLE_BLOC,
  versTuiles,
  type CoucheTuilesTiled,
  type Georeference,
  type Parcours,
  type PointTuiles,
  type Position,
} from '@petit-cortege/shared';
import { coucheTuiles, RAYON_MIN_TUILES } from './carte';
import { classer, COURS_D_EAU, EAUX, RUES, Terrain, VERTS, type Classement } from './classement';
import { simplifierLigne } from './geometrie';
import { lireExtrait, type ElementOverpass, type ExtraitOverpass, type ObjetOsm } from './osm';
import { Grille } from './raster';
import { TUILES } from './tuiles';

/** Rayon des alentours autour du parcours (m) : bande détaillée comprise. */
export const RAYON_ALENTOURS_PAR_DEFAUT_M = 700;
/** Côté d'une case des alentours, en tuiles (2 tuiles = 4 m). */
export const TUILES_PAR_CASE_ALENTOURS = 2;
/** Le parcours est simplifié pour la requête (moins de points dans `around`), marge ajoutée au rayon. */
const TOLERANCE_PARCOURS_REQUETE_M = 20;
const MARGE_EXTRACTION_M = 60;
/** Simplification de la géométrie enregistrée : bien moins qu'une case (4 m). */
const TOLERANCE_GEOMETRIE_M = 1.5;
const DECIMALES = 1e5;

/** Rues retenues aux alentours : la voirie (pas les chemins, trottoirs, pistes ni voies de service). */
const TYPES_RUES = [...Object.keys(RUES).filter((t) => t !== 'service'), 'pedestrian'];

const motif = (valeurs: string[]) => JSON.stringify(`^(${valeurs.join('|')})$`);

/** Requête Overpass QL des alentours : rues, verts, eau, places ; aucun bâtiment. */
export function requeteAlentours(parcours: Parcours, rayonM: number): string {
  const ligne = simplifierLigne(parcours.coordinates, TOLERANCE_PARCOURS_REQUETE_M);
  const r = Math.round(rayonM + TOLERANCE_PARCOURS_REQUETE_M + MARGE_EXTRACTION_M);
  const autour = `(around:${r},${ligne.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(',')})`;
  const surfaces = new Map<string, string[]>();
  for (const table of [VERTS, EAUX]) {
    for (const [cle, valeurs] of Object.entries(table)) surfaces.set(cle, [...(surfaces.get(cle) ?? []), ...valeurs]);
  }
  const filtres = [...surfaces].map(([cle, valeurs]) => `[${JSON.stringify(cle)}~${motif(valeurs)}]`);
  return [
    '[out:json][timeout:180];',
    '(',
    `  way${autour}["highway"~${JSON.stringify(`^(${TYPES_RUES.join('|')})(_link)?$`)}];`,
    `  way${autour}["place"="square"];`,
    ...filtres.map((f) => `  way${autour}${f};`),
    `  way${autour}["waterway"~${motif(Object.keys(COURS_D_EAU))}];`,
    ...filtres.map((f) => `  relation${autour}["type"="multipolygon"]${f};`),
    ');',
    'out geom;',
  ].join('\n');
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

/** Gid Kenney qui représente une case des alentours (couleur moyenne de la tuile). */
const GID_DU_TERRAIN: Record<number, number> = {
  [Terrain.vide]: 0,
  [Terrain.ilot]: TUILES.pateDeMaisons,
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
  rayonM: number;
  tuilesParCase?: number;
}

/** Couche `alentours` : cases à moins de `rayonM` du parcours, en blocs alignés de TAILLE_BLOC cases. */
export function genererAlentours(options: OptionsAlentours): CoucheTuilesTiled {
  const k = options.tuilesParCase ?? TUILES_PAR_CASE_ALENTOURS;
  const metresParCase = METRES_PAR_TUILE * k;
  const enCases = (p: Position): PointTuiles => {
    const t = versTuiles(options.georef, p);
    return { x: t.x / k, y: t.y / k };
  };
  const parcours = options.parcours.coordinates.map(enCases);
  const rayon = options.rayonM / metresParCase;
  const aligner = (v: number) => Math.floor(v / TAILLE_BLOC) * TAILLE_BLOC;
  const ox = aligner(Math.min(...parcours.map((p) => p.x)) - rayon - 1);
  const oy = aligner(Math.min(...parcours.map((p) => p.y)) - rayon - 1);
  const largeur = Math.ceil(Math.max(...parcours.map((p) => p.x)) + rayon + 1) - ox;
  const hauteur = Math.ceil(Math.max(...parcours.map((p) => p.y)) + rayon + 1) - oy;
  const projeter = (l: Position[]) => l.map((p) => {
    const c = enCases(p);
    return { x: c.x - ox, y: c.y - oy };
  });
  const rayonDe = (largeurM: number) => Math.max(largeurM / 2 / metresParCase, RAYON_MIN_TUILES);

  const grille = new Grille(largeur, hauteur);
  grille.peindreLigne(projeter(options.parcours.coordinates), rayon, Terrain.ilot, false);
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

  const couche = coucheTuiles(options.id, COUCHE_ALENTOURS, grille, (g, x, y) => GID_DU_TERRAIN[g.lire(x, y)] ?? 0, { x: ox, y: oy });
  return { ...couche, properties: [{ name: PROPRIETE_TUILES_PAR_CASE, type: 'int', value: k }] };
}
