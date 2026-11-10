/**
 * Génération du décor d'une manif : bande d'environ 200 m autour du parcours
 * → tilemap Tiled (carte infinie découpée en blocs de 32 × 32 tuiles) avec les
 * tilesets Kenney : sol (rues, verts, eau), garde-corps des ponts, bâtiments
 * (toits et murs, puis fenêtres et portes) ; en couches d'objets, le tracé du
 * parcours et les noms des places traversées.
 *
 * Données dérivées d'OpenStreetMap : la carte produite est sous ODbL.
 */
import { deflateSync } from 'node:zlib';
import {
  ATTRIBUTION_OSM,
  COUCHE_ARBRES,
  COUCHE_PLACES,
  FORMAT_DECOR,
  METRES_PAR_TUILE,
  TAILLE_BLOC,
  TAILLE_TUILE_PX,
  tracerParcours,
  VERSION_FORMAT_DECOR,
  versPosition,
  versTuiles,
  type BlocTiled,
  type CarteTiled,
  type CoucheObjetsTiled,
  type CoucheTuilesTiled,
  type Georeference,
  type ObjetTiled,
  type Parcours,
  type PointTuiles,
  type Position,
} from '@petit-cortege/shared';
import { autotilerBatiments } from './batiments';
import { classer, estBatiment, Terrain, type Classement } from './classement';
import { lireExtrait, type ExtraitOverpass, type ObjetOsm } from './osm';
import { placesTraversees } from './places';
import { Grille } from './raster';
import { tilesets, TUILES } from './tuiles';

export interface OptionsDecor {
  osm: ExtraitOverpass;
  parcours: Parcours;
  /** Demi-largeur de la bande autour du parcours, en mètres (bande ≈ 200 m → 100). */
  demiLargeurM: number;
  /** Espacement des flèches du tracé, en mètres. */
  espacementFlechesM?: number;
  /** Chemin du dossier assets/kenney relatif au fichier de la carte (pour Tiled). */
  dossierKenney?: string;
}

export const DEMI_LARGEUR_PAR_DEFAUT_M = 100;
const ESPACEMENT_FLECHES_M = 50;
/** Largeur du tablier posé là où le parcours franchit l'eau sans rue cartographiée. */
const LARGEUR_PASSAGE_PARCOURS_M = 8;
/** Une place est traversée si le parcours passe à moins de cette distance. */
const DISTANCE_PLACE_TRAVERSEE_M = 10;
/** Un arbre d'une rangée (`natural=tree_row`) tous les… */
const ESPACEMENT_RANGEE_ARBRES_M = 10;
/** Le cortège (5 colonnes de 2 m) passe : pas d'arbre à moins de cette distance du parcours. */
const DEGAGEMENT_CORTEGE_M = 6;
/** Un arbre pousse sur le trottoir, dans un vert, une cour ou une place piétonne (pas sur la chaussée ni dans l'eau). */
const TERRAINS_PLANTABLES: ReadonlySet<number> = new Set([Terrain.trottoir, Terrain.vert, Terrain.ilot, Terrain.pieton]);
/** Chemin de assets/kenney depuis client/public/decors/. */
const DOSSIER_KENNEY_PAR_DEFAUT = '../../../assets/kenney';

const enTuiles = (m: number) => m / METRES_PAR_TUILE;
/** Rayon minimal d’une ligne peinte : au-delà de √2/2 tuile, une diagonale reste continue. */
const RAYON_MIN_TUILES = 0.75;
const rayonDe = (largeurM: number) => Math.max(enTuiles(largeurM / 2), RAYON_MIN_TUILES);

export function genererDecor(options: OptionsDecor): CarteTiled {
  const { georef, largeur, hauteur } = cadrer(options.parcours.coordinates, enTuiles(options.demiLargeurM));
  const projeter = (l: Position[]) => l.map((p) => versTuiles(georef, p));
  const parcours = projeter(options.parcours.coordinates);

  const grille = new Grille(largeur, hauteur);
  // La bande : îlots partout à moins de demiLargeurM du parcours ; rien ne se peint en dehors.
  grille.peindreLigne(parcours, enTuiles(options.demiLargeurM), Terrain.ilot, false);

  const objetsOsm = lireExtrait(options.osm);
  const classes = objetsOsm
    .map((objet) => ({ objet, classe: classer(objet) }))
    .filter((c): c is { objet: ObjetOsm; classe: Classement } => c.classe !== null);
  const surfaces = (terrain: Terrain) => {
    for (const { objet, classe } of classes) {
      if (classe.sorte === 'surface' && classe.terrain === terrain) grille.peindrePolygone(objet.anneaux.map(projeter), terrain);
    }
  };
  const rues = (terrain: Terrain, avecTrottoirs: boolean) => {
    // Les plus étroites d'abord : une rue large recouvre l'amorce d'une rue étroite.
    const choisies = classes
      .flatMap(({ objet, classe }) => (classe.sorte === 'rue' && classe.terrain === terrain ? [{ objet, classe }] : []))
      .sort((a, b) => a.classe.largeurM - b.classe.largeurM);
    for (const { objet, classe } of choisies) {
      const largeur = avecTrottoirs ? classe.largeurM + 2 * classe.trottoirM : classe.largeurM;
      if (avecTrottoirs && classe.trottoirM === 0) continue;
      grille.peindreLigne(projeter(objet.ligne), rayonDe(largeur), avecTrottoirs ? Terrain.trottoir : terrain);
    }
  };

  surfaces(Terrain.vert);
  surfaces(Terrain.eau);
  for (const { objet, classe } of classes) {
    if (classe.sorte === 'cours-d-eau') grille.peindreLigne(projeter(objet.ligne), rayonDe(classe.largeurM), Terrain.eau);
  }
  const eauAvantLesRues = grille.cases.map((t) => (t === Terrain.eau ? 1 : 0));
  rues(Terrain.chaussee, true);
  surfaces(Terrain.trottoir);
  rues(Terrain.trottoir, false);
  surfaces(Terrain.pieton);
  rues(Terrain.pieton, false);
  rues(Terrain.chaussee, false);
  // Le parcours passe toujours : là où il franchit l'eau sans rue cartographiée, un passage piéton.
  const avantPassage = grille.cases.slice();
  grille.peindreLigne(parcours, rayonDe(LARGEUR_PASSAGE_PARCOURS_M), Terrain.pieton);
  grille.cases.forEach((t, i) => {
    if (avantPassage[i] !== Terrain.eau) grille.cases[i] = avantPassage[i]!;
  });
  // Ponts : ce qui a été peint par-dessus l'eau (rues, parcours) en est le tablier.
  const pont = grille.cases.map((t, i) => (eauAvantLesRues[i] && t !== Terrain.eau ? 1 : 0));
  const estPont = (x: number, y: number) => x >= 0 && y >= 0 && x < largeur && y < hauteur && pont[y * largeur + x] === 1;

  const { batiments, facades } = autotilerBatiments({
    largeur,
    hauteur,
    emprises: objetsOsm.filter(estBatiment).map((o) => ({ id: o.id, anneaux: o.anneaux.map(projeter) })),
    constructible: (x, y) => grille.lire(x, y) === Terrain.ilot,
  });
  const places = placesTraversees(
    objetsOsm.map((o) => ({ tags: o.tags, ligne: projeter(o.ligne), anneaux: o.anneaux.map(projeter) })),
    parcours,
    enTuiles(DISTANCE_PLACE_TRAVERSEE_M),
  );

  // Arbres OSM : isolés ou en rangée, gardés s'ils poussent hors chaussée, hors bâtiment et hors du passage du cortège.
  const arbres = objetsOsm
    .flatMap((o) => {
      const resineux = o.tags.leaf_type === 'needleleaved';
      if (o.tags.natural === 'tree' && o.ligne.length === 1) return [{ p: projeter(o.ligne)[0]!, resineux }];
      if (o.tags.natural === 'tree_row' && o.ligne.length > 1) {
        return jalonner(projeter(o.ligne), enTuiles(ESPACEMENT_RANGEE_ARBRES_M)).map((p) => ({ p, resineux }));
      }
      return [];
    })
    .filter(({ p }) => {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= largeur || y >= hauteur || !TERRAINS_PLANTABLES.has(grille.lire(x, y))) return false;
      if (batiments[y * largeur + x] || facades[y * largeur + x]) return false;
      return distanceALaLigne(p, parcours) >= enTuiles(DEGAGEMENT_CORTEGE_M);
    });

  const trace = tracerParcours(parcours, { espacementFleches: enTuiles(options.espacementFlechesM ?? ESPACEMENT_FLECHES_M) });
  const depuis = (gids: Uint32Array) => (_g: Grille, x: number, y: number) =>
    x < largeur && y < hauteur ? gids[y * largeur + x]! : 0;
  const couches: (CoucheTuilesTiled | CoucheObjetsTiled)[] = [
    coucheTuiles(1, 'sol', grille, (g, x, y) => tuileDuSol(g, x, y, estPont)),
    coucheTuiles(2, 'ponts', grille, (g, x, y) => (estPont(x, y) ? gardeCorps(g, x, y) : 0)),
    coucheTuiles(3, 'batiments', grille, depuis(batiments)),
    coucheTuiles(4, 'facades', grille, depuis(facades)),
  ];
  let idObjet = 1;
  const objet = (name: string, p: PointTuiles, rotation = 0, polyline?: PointTuiles[], type = name): ObjetTiled => ({
    id: idObjet++,
    name,
    type,
    x: p.x * TAILLE_TUILE_PX,
    y: p.y * TAILLE_TUILE_PX,
    width: 0,
    height: 0,
    rotation,
    visible: true,
    ...(polyline
      ? { polyline: polyline.map((q) => ({ x: (q.x - p.x) * TAILLE_TUILE_PX, y: (q.y - p.y) * TAILLE_TUILE_PX })) }
      : { point: true as const }),
  });
  couches.push({
    type: 'objectgroup',
    id: couches.length + 1,
    name: 'parcours',
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: 'topdown',
    objects: [
      objet('trace', trace.ligne[0]!, 0, trace.ligne),
      objet('depart', trace.depart, trace.depart.angle),
      ...trace.fleches.map((f) => objet('fleche', f, f.angle)),
      objet('arrivee', trace.arrivee, trace.arrivee.angle),
    ],
  });
  couches.push({
    type: 'objectgroup',
    id: couches.length + 1,
    name: COUCHE_PLACES,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: 'topdown',
    objects: places.map((p) => ({
      ...objet(p.nom, p, 0, undefined, 'place'),
      properties: [{ name: 'arrivee', type: 'bool' as const, value: p.arrivee }],
    })),
  });

  couches.push({
    type: 'objectgroup',
    id: couches.length + 1,
    name: COUCHE_ARBRES,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    draworder: 'topdown',
    objects: arbres.map(({ p, resineux }) => ({
      ...objet('arbre', p),
      properties: [{ name: 'resineux', type: 'bool' as const, value: resineux }],
    })),
  });

  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: true,
    width: largeur,
    height: hauteur,
    tilewidth: TAILLE_TUILE_PX,
    tileheight: TAILLE_TUILE_PX,
    nextlayerid: couches.length + 1,
    nextobjectid: idObjet,
    properties: [
      { name: 'attribution', type: 'string', value: ATTRIBUTION_OSM },
      { name: 'format', type: 'string', value: FORMAT_DECOR },
      { name: 'licence', type: 'string', value: 'ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)' },
      { name: 'metres_par_tuile', type: 'float', value: METRES_PAR_TUILE },
      { name: 'origine_lat', type: 'float', value: georef.origine[1] },
      { name: 'origine_lon', type: 'float', value: georef.origine[0] },
      { name: 'version_format', type: 'int', value: VERSION_FORMAT_DECOR },
    ],
    tilesets: tilesets(options.dossierKenney ?? DOSSIER_KENNEY_PAR_DEFAUT),
    layers: couches,
  };
}

/** Points tous les `pas` le long d'une ligne, extrémités comprises (à un dixième de pas près). */
function jalonner(ligne: PointTuiles[], pas: number): PointTuiles[] {
  const points: PointTuiles[] = [];
  let reste = 0;
  for (let i = 1; i < ligne.length; i++) {
    const a = ligne[i - 1]!;
    const b = ligne[i]!;
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    let d = reste;
    for (; d <= longueur + pas * 0.1; d += pas) {
      const f = longueur === 0 ? 0 : Math.min(1, d / longueur);
      points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    reste = d - longueur;
  }
  return points;
}

/** Distance d'un point à une polyligne (mêmes unités). */
function distanceALaLigne(p: PointTuiles, ligne: PointTuiles[]): number {
  let min = Infinity;
  for (let i = 1; i < ligne.length; i++) {
    const a = ligne[i - 1]!;
    const b = ligne[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    min = Math.min(min, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return min;
}

/** Origine et taille de la carte : emprise de la bande, coin haut-gauche sur une tuile entière. */
function cadrer(points: Position[], rayon: number): { georef: Georeference; largeur: number; hauteur: number } {
  if (points.length < 2) throw new Error('Parcours : au moins deux points');
  const provisoire: Georeference = { origine: [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))] };
  const t = points.map((p) => versTuiles(provisoire, p));
  // Une tuile de marge : l'échelle est-ouest dépend (à peine) de la latitude de l'origine.
  const minX = Math.floor(Math.min(...t.map((p) => p.x)) - rayon) - 1;
  const minY = Math.floor(Math.min(...t.map((p) => p.y)) - rayon) - 1;
  const maxX = Math.ceil(Math.max(...t.map((p) => p.x)) + rayon) + 1;
  const maxY = Math.ceil(Math.max(...t.map((p) => p.y)) + rayon) + 1;
  return {
    georef: { origine: versPosition(provisoire, { x: minX, y: minY }) },
    largeur: maxX - minX,
    hauteur: maxY - minY,
  };
}

/** Garde-corps d'une case de tablier, du côté où elle touche l'eau. */
function gardeCorps(g: Grille, x: number, y: number): number {
  const eau = (dx: number, dy: number) => g.lire(x + dx, y + dy) === Terrain.eau;
  if (eau(0, -1)) return TUILES.gardeCorps.nord;
  if (eau(0, 1)) return TUILES.gardeCorps.sud;
  if (eau(-1, 0)) return TUILES.gardeCorps.ouest;
  if (eau(1, 0)) return TUILES.gardeCorps.est;
  return 0;
}

/** Tuile Kenney d'une case du sol, selon son terrain et ses voisines. */
function tuileDuSol(g: Grille, x: number, y: number, estPont: (x: number, y: number) => boolean): number {
  const terrain = g.lire(x, y);
  switch (terrain) {
    case Terrain.vide:
      return 0;
    case Terrain.ilot:
      return TUILES.ilot;
    case Terrain.vert:
      return TUILES.vert;
    case Terrain.chaussee:
      return TUILES.chaussee;
    case Terrain.trottoir:
      return g.lire(x, y + 1) === Terrain.chaussee ? TUILES.trottoirBordure : TUILES.trottoir;
    case Terrain.pieton:
      return g.lire(x, y + 1) === Terrain.chaussee ? TUILES.pietonBordure : TUILES.pieton;
    case Terrain.eau: {
      // Quai en pierre là où l'eau touche la terre (ni le bord de la carte ni un pont ne sont des quais).
      const terre = (dx: number, dy: number) => {
        const voisin = g.lire(x + dx, y + dy);
        return voisin !== Terrain.eau && voisin !== Terrain.vide && !estPont(x + dx, y + dy);
      };
      const [h, b, gauche, d] = [terre(0, -1), terre(0, 1), terre(-1, 0), terre(1, 0)];
      const q = TUILES.quai;
      if (h) return gauche ? q.hautGauche : d ? q.hautDroite : q.haut;
      if (b) return gauche ? q.basGauche : d ? q.basDroite : q.bas;
      if (gauche) return q.gauche;
      if (d) return q.droite;
      return TUILES.eau;
    }
    default:
      throw new Error(`Terrain inconnu : ${terrain}`);
  }
}

/** Couche de tuiles découpée en blocs alignés de TAILLE_BLOC ; les blocs entièrement vides sont omis. */
export function coucheTuiles(
  id: number,
  nom: string,
  grille: Grille,
  tuile: (g: Grille, x: number, y: number) => number,
): CoucheTuilesTiled {
  const chunks: BlocTiled[] = [];
  for (let by = 0; by * TAILLE_BLOC < grille.hauteur; by++) {
    for (let bx = 0; bx * TAILLE_BLOC < grille.largeur; bx++) {
      const gids = new Uint32Array(TAILLE_BLOC * TAILLE_BLOC);
      let plein = false;
      for (let y = 0; y < TAILLE_BLOC; y++) {
        for (let x = 0; x < TAILLE_BLOC; x++) {
          const gid = tuile(grille, bx * TAILLE_BLOC + x, by * TAILLE_BLOC + y);
          gids[y * TAILLE_BLOC + x] = gid;
          if (gid !== 0) plein = true;
        }
      }
      if (!plein) continue;
      const octets = Buffer.alloc(gids.length * 4);
      gids.forEach((gid, i) => octets.writeUInt32LE(gid, i * 4));
      chunks.push({
        x: bx * TAILLE_BLOC,
        y: by * TAILLE_BLOC,
        width: TAILLE_BLOC,
        height: TAILLE_BLOC,
        data: deflateSync(octets, { level: 9 }).toString('base64'),
      });
    }
  }
  const largeurBlocs = Math.ceil(grille.largeur / TAILLE_BLOC) * TAILLE_BLOC;
  const hauteurBlocs = Math.ceil(grille.hauteur / TAILLE_BLOC) * TAILLE_BLOC;
  return {
    type: 'tilelayer',
    id,
    name: nom,
    x: 0,
    y: 0,
    startx: 0,
    starty: 0,
    width: largeurBlocs,
    height: hauteurBlocs,
    opacity: 1,
    visible: true,
    encoding: 'base64',
    compression: 'zlib',
    chunks,
  };
}
