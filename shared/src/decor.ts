/**
 * Décor d'une manif : tilemap Tiled générée depuis OpenStreetMap (ODbL).
 * Défini une seule fois ici pour le script de génération et le client.
 *
 * Tuile de 16 px ≈ 2 m ; carte « infinie » au sens de Tiled, découpée en blocs
 * de 32 × 32 tuiles (seuls les blocs de la bande autour du parcours existent).
 */
import type { Position } from './format';

/** Mètres couverts par une tuile. */
export const METRES_PAR_TUILE = 2;
/** Côté d'une tuile, en pixels (taille Kenney). */
export const TAILLE_TUILE_PX = 16;
/** Côté d'un bloc, en tuiles. */
export const TAILLE_BLOC = 32;
/** Valeur de la propriété `format` d'une carte de décor (version : propriété `version_format`). */
export const FORMAT_DECOR = 'petit-cortege-decor';
/**
 * 3 : la couche `alentours` devient le plan de la ville (emprise couvrant le dézoom maximal),
 * en blocs de côté multiple de TAILLE_BLOC cases. Les cartes en version 2 (blocs de 32 cases)
 * et 1 (sans alentours) restent lues.
 */
export const VERSION_FORMAT_DECOR = 3;
export const ATTRIBUTION_OSM = '© les contributeurs d’OpenStreetMap';
/**
 * Couches de tuiles des bâtiments (toits et murs, puis fenêtres et portes) : le
 * client ne les cuit pas avec le sol, il les dessine par rangées, profondeur = y,
 * pour qu'une façade passe devant les avatars qui sont derrière elle.
 */
export const COUCHES_BATIMENTS: readonly string[] = ['batiments', 'facades'];
/**
 * Couche de tuiles des alentours : autour de la bande détaillée, une carte simplifiée (rues,
 * verts, eau, pâtés de maisons sans bâtiments) à résolution réduite. Chaque case couvre
 * `tuiles_par_case` × `tuiles_par_case` tuiles (propriété de la couche) ; ses blocs sont en
 * cases (TAILLE_BLOC × TAILLE_BLOC cases), comptées depuis la même origine que la carte, et
 * peuvent déborder de l'emprise de la bande (coordonnées négatives). Le gid d'une case est la
 * tuile Kenney dont la couleur moyenne la représente (0 : hors des alentours).
 */
export const COUCHE_ALENTOURS = 'alentours';
export const PROPRIETE_TUILES_PAR_CASE = 'tuiles_par_case';
/**
 * Propriété facultative de la couche des alentours : gids des teintes des pâtés de maisons,
 * séparés par des virgules. Le premier est celui des cases d'îlot ; chaque îlot (cases d'îlot
 * contiguës) prend l'une de ces teintes, choisie de façon déterministe : pas d'aplat uniforme.
 */
export const PROPRIETE_TEINTES_ILOTS = 'teintes_ilots';

/*
 * Emprise du plan de la ville (couche des alentours) : au dézoom maximal centré sur le
 * parcours, tout l'écran doit être couvert par le plan, du téléphone en portrait au
 * paysage 21:9, et son bord fondu doit rester hors champ.
 */
/** Formats d'écran couverts (largeur / hauteur) : du portrait 9:19,5 au paysage 21:9. */
export const ASPECT_ECRAN_MIN = 9 / 19.5;
export const ASPECT_ECRAN_MAX = 2560 / 1080; // « 21:9 » des écrans réels (64:27)
/**
 * Vue 3D de haut (client/src/vue3d) : marge ajoutée au rayon du parcours (m). Le champ de la
 * caméra n'entre pas dans le calcul : la vue de haut fait tenir ce cercle à l'écran quel qu'il soit.
 */
export const MARGE_RAYON_VUE_DE_HAUT_M = 40;
/** Largeur du fondu au bord du plan vers le fond (m). */
export const FONDU_PLAN_M = 240;
/** Marge du plan au-delà du champ et du fondu (perspective, arrondis) : part du rayon à voir. */
const MARGE_PLAN = 0.05;
/** Côté maximal du plan (m) : au-delà, poids et extraction OSM deviennent déraisonnables. */
export const COTE_MAX_PLAN_M = 12_000;

/**
 * Demi-diagonale de l'écran au sol, en multiple du rayon du cercle que la vue de haut fait
 * tenir à l'écran, au pire des formats couverts : l'écran tient dans le cercle de ce rayon
 * quelle que soit l'orientation de la caméra. Paysage (aspect a ≥ 1) : le cercle tient en
 * hauteur, l'écran fait a × 1 rayons ; portrait : il tient en largeur, l'écran fait 1 × 1/a.
 */
export function facteurDiagonaleEcran(aspectMin = ASPECT_ECRAN_MIN, aspectMax = ASPECT_ECRAN_MAX): number {
  return Math.max(...[aspectMin, aspectMax].map((a) => Math.hypot(1, Math.max(a, 1 / a))));
}

export interface EmpriseDuPlan {
  /** Centre (m, depuis l'origine du décor : x vers l'est, y vers le sud) : centre du rectangle englobant du parcours. */
  centre: PointTuiles;
  /** Demi-côté du carré couvert (m), fondu compris. */
  demiCote: number;
  /** Vrai si la borne COTE_MAX_PLAN_M a réduit le plan. */
  borne: boolean;
}

/**
 * Emprise du plan pour un parcours (points en mètres) : le carré centré sur le parcours qui
 * contient l'écran entier au dézoom maximal de la vue 3D (vue de haut, cercle du parcours à
 * l'écran) dans tous les formats couverts, plus le fondu et une marge ; borné à COTE_MAX_PLAN_M.
 * La vue 2D borne son dézoom pour rester dans ce carré (client/src/scene-cortege.ts).
 */
export function empriseDuPlan(points: readonly PointTuiles[]): EmpriseDuPlan {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const rayon = Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) + MARGE_RAYON_VUE_DE_HAUT_M;
  const voulu = rayon * facteurDiagonaleEcran() * (1 + MARGE_PLAN) + FONDU_PLAN_M;
  const demiCote = Math.min(voulu, COTE_MAX_PLAN_M / 2);
  return { centre, demiCote, borne: demiCote < voulu };
}
/** Couche d'objets des noms de places traversées (objets ponctuels : `name` = nom, propriété `arrivee`). */
export const COUCHE_PLACES = 'places';

/** Géoréférencement : position du coin haut-gauche de la tuile (0, 0). */
export interface Georeference {
  origine: Position;
}

export interface PointTuiles {
  x: number;
  y: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** Mètres par degré (projection locale équirectangulaire, comme `positionDansLeCortege`). */
const metresParDegre = (geo: Georeference) => ({ kx: 111_320 * Math.cos(rad(geo.origine[1])), ky: 110_540 });

/** Position [lon, lat] → coordonnées en tuiles (fractionnaires), x vers l'est, y vers le sud. */
export function versTuiles(geo: Georeference, p: Position): PointTuiles {
  const { kx, ky } = metresParDegre(geo);
  return {
    x: ((p[0] - geo.origine[0]) * kx) / METRES_PAR_TUILE,
    y: ((geo.origine[1] - p[1]) * ky) / METRES_PAR_TUILE,
  };
}

/** Coordonnées en tuiles → position [lon, lat]. */
export function versPosition(geo: Georeference, t: PointTuiles): Position {
  const { kx, ky } = metresParDegre(geo);
  return [geo.origine[0] + (t.x * METRES_PAR_TUILE) / kx, geo.origine[1] - (t.y * METRES_PAR_TUILE) / ky];
}

/** Point orienté : angle en degrés, sens horaire depuis l'est (y vers le bas, comme la rotation Tiled). */
export interface PointOriente extends PointTuiles {
  angle: number;
}

export interface TraceParcours {
  ligne: PointTuiles[];
  fleches: PointOriente[];
  depart: PointOriente;
  arrivee: PointOriente;
}

const angleDe = (a: PointTuiles, b: PointTuiles) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/**
 * Tracé du parcours au sol : la ligne, une flèche tous les `espacementFleches`
 * (en tuiles, comptés depuis le départ, aucune sur l'arrivée), le départ et
 * l'arrivée, orientés dans le sens de marche.
 */
export function tracerParcours(ligne: PointTuiles[], options: { espacementFleches: number }): TraceParcours {
  // Tronçons de longueur non nulle (points doublés ignorés).
  const troncons: { a: PointTuiles; b: PointTuiles; debut: number; longueur: number }[] = [];
  let total = 0;
  for (let i = 1; i < ligne.length; i++) {
    const a = ligne[i - 1]!;
    const b = ligne[i]!;
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    if (longueur === 0) continue;
    troncons.push({ a, b, debut: total, longueur });
    total += longueur;
  }
  const premier = troncons[0];
  const dernier = troncons[troncons.length - 1];
  if (!premier || !dernier) throw new Error('Parcours sans longueur');

  const fleches: PointOriente[] = [];
  let t = 0;
  for (let d = options.espacementFleches; d < total; d += options.espacementFleches) {
    while (d > troncons[t]!.debut + troncons[t]!.longueur) t++;
    const { a, b, debut, longueur } = troncons[t]!;
    const f = (d - debut) / longueur;
    fleches.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: angleDe(a, b) });
  }
  return {
    ligne: ligne.map(({ x, y }) => ({ x, y })),
    fleches,
    depart: { x: premier.a.x, y: premier.a.y, angle: angleDe(premier.a, premier.b) },
    arrivee: { x: dernier.b.x, y: dernier.b.y, angle: angleDe(dernier.a, dernier.b) },
  };
}

// ---------------------------------------------------------------------------
// Format de fichier : sous-ensemble du format JSON de Tiled (carte infinie).

export interface ProprieteTiled {
  name: string;
  type: 'string' | 'float' | 'int' | 'bool';
  value: string | number | boolean;
}

export interface TilesetTiled {
  firstgid: number;
  name: string;
  /** Chemin de l'image relatif au fichier de la carte (pour l'ouvrir dans Tiled). */
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  margin: number;
  spacing: number;
  columns: number;
  tilecount: number;
}

/** Bloc d'une couche de tuiles : gids en uint32 little-endian, compressés zlib, en base64. */
export interface BlocTiled {
  x: number;
  y: number;
  width: number;
  height: number;
  data: string;
}

export interface CoucheTuilesTiled {
  type: 'tilelayer';
  id: number;
  name: string;
  x: 0;
  y: 0;
  startx: number;
  starty: number;
  width: number;
  height: number;
  opacity: 1;
  visible: true;
  encoding: 'base64';
  compression: 'zlib';
  chunks: BlocTiled[];
  properties?: ProprieteTiled[];
}

export interface ObjetTiled {
  id: number;
  name: string;
  type: string;
  /** Position en pixels de la carte. */
  x: number;
  y: number;
  width: 0;
  height: 0;
  /** Degrés, sens horaire. */
  rotation: number;
  visible: true;
  point?: true;
  polyline?: { x: number; y: number }[];
  properties?: ProprieteTiled[];
}

export interface CoucheObjetsTiled {
  type: 'objectgroup';
  id: number;
  name: string;
  x: 0;
  y: 0;
  opacity: 1;
  visible: true;
  draworder: 'topdown';
  objects: ObjetTiled[];
}

export interface CarteTiled {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  infinite: true;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  nextlayerid: number;
  nextobjectid: number;
  properties: ProprieteTiled[];
  tilesets: TilesetTiled[];
  layers: (CoucheTuilesTiled | CoucheObjetsTiled)[];
}

// ---------------------------------------------------------------------------
// Index des décors publiés (`decors/index.json`).
//
// ADR 0002 : demander le décor d'une manif révélerait la manif consultée. Le
// client charge donc l'index puis tous les décors qu'il liste (1 à 3 en V1),
// par des requêtes identiques pour tous, et choisit celui qui couvre le parcours.

export const VERSION_INDEX_DECORS = 1;
export const CHEMIN_INDEX_DECORS = 'index.json';

export interface EntreeIndexDecors {
  /** Fichier de la carte, relatif à l'index. */
  fichier: string;
  /** Emprise géographique : [lon min, lat min, lon max, lat max]. */
  emprise: [number, number, number, number];
  /**
   * Parcours autour duquel la bande du décor a été générée (simplifié), et
   * demi-largeur de cette bande en mètres : seule la bande est dessinée, pas
   * toute l'emprise. Absents des index anciens (choix sur la seule emprise).
   */
  trace?: Position[];
  demiLargeurM?: number;
}

export interface IndexDecors {
  v: typeof VERSION_INDEX_DECORS;
  decors: EntreeIndexDecors[];
}

export function lireIndexDecors(json: unknown): IndexDecors {
  const index = json as Partial<IndexDecors> | null;
  if (index?.v !== VERSION_INDEX_DECORS || !Array.isArray(index.decors)) {
    throw new Error(`Index des décors : version ${String(index?.v)} inattendue (${VERSION_INDEX_DECORS} attendue)`);
  }
  return index as IndexDecors;
}

/**
 * Part de la demi-largeur de la bande que le parcours peut s'écarter du tracé
 * d'un décor : le cortège et ses abords restent dans la partie dessinée.
 */
export const COUVERTURE_DEMI_BANDE = 0.5;
/** Pas d'échantillonnage du parcours pour mesurer la couverture, en mètres. */
const PAS_COUVERTURE_M = 20;

/** Points du parcours tous les `pasM` mètres environ (sommets compris), en projection locale. */
function echantillonsParcours(parcours: Position[], pasM: number): Position[] {
  const points: Position[] = [];
  for (let i = 0; i < parcours.length; i++) {
    const b = parcours[i]!;
    const a = parcours[i - 1];
    if (a) {
      const { kx, ky } = metresParDegre({ origine: a });
      const n = Math.floor(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) / pasM);
      for (let k = 1; k <= n; k++) points.push([a[0] + ((b[0] - a[0]) * k) / (n + 1), a[1] + ((b[1] - a[1]) * k) / (n + 1)]);
    }
    points.push(b);
  }
  return points;
}

/** Distance (m) d'un point à une ligne brisée (projection locale autour du point). */
function distanceALaLigne(p: Position, ligne: Position[]): number {
  const { kx, ky } = metresParDegre({ origine: p });
  const plan = ligne.map(([lon, lat]) => [(lon - p[0]) * kx, (lat - p[1]) * ky] as const);
  let min = plan.length === 1 ? Math.hypot(plan[0]![0], plan[0]![1]) : Infinity;
  for (let i = 1; i < plan.length; i++) {
    const [ax, ay] = plan[i - 1]!;
    const [bx, by] = plan[i]!;
    const [dx, dy] = [bx - ax, by - ay];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}

/** Plus grand écart (m) entre le parcours et le tracé d'un décor. */
export function ecartAuTraceDuDecor(entree: EntreeIndexDecors, parcours: Position[]): number {
  if (!entree.trace || entree.trace.length === 0) return Infinity;
  return Math.max(...echantillonsParcours(parcours, PAS_COUVERTURE_M).map((p) => distanceALaLigne(p, entree.trace!)));
}

/**
 * Le décor qui couvre réellement le parcours. Une emprise rectangulaire ne
 * suffit pas : un décor République → Nation par le boulevard Voltaire a une
 * emprise qui contient la place de la Bastille, mais sa bande de tuiles n'y
 * passe pas. Parmi les décors dont l'emprise contient le parcours, on garde
 * celui dont la bande (tracé ± demi-largeur) le couvre avec le plus de marge ;
 * un décor d'un index ancien, sans tracé, n'est choisi que faute de mieux.
 */
export function decorDuParcours(index: IndexDecors, parcours: Position[]): EntreeIndexDecors | undefined {
  const candidats = index.decors.filter(({ emprise: [x0, y0, x1, y1] }) =>
    parcours.every(([lon, lat]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1),
  );
  let choisi: EntreeIndexDecors | undefined;
  let meilleurEcart = Infinity;
  for (const entree of candidats) {
    if (!entree.trace || !entree.demiLargeurM) continue;
    const ecart = ecartAuTraceDuDecor(entree, parcours);
    if (ecart <= entree.demiLargeurM * COUVERTURE_DEMI_BANDE && ecart < meilleurEcart) [choisi, meilleurEcart] = [entree, ecart];
  }
  return choisi ?? candidats.find((e) => !e.trace || !e.demiLargeurM);
}

// ---------------------------------------------------------------------------
// Lecture (client et tests).

export interface BlocDecor {
  /** Coin haut-gauche du bloc, en tuiles. */
  x: number;
  y: number;
  /** Gids par couche de tuiles, ligne par ligne (TAILLE_BLOC × TAILLE_BLOC). */
  couches: Record<string, Uint32Array>;
}

export interface Decor {
  georef: Georeference;
  /** Emprise de la carte, en tuiles (de 0 à largeur, de 0 à hauteur). */
  largeur: number;
  hauteur: number;
  tilesets: TilesetTiled[];
  /** Noms des couches de tuiles, de la plus basse à la plus haute. */
  nomsCouches: string[];
  /** Blocs existants (ceux qui touchent la bande autour du parcours), indexés par `cleBloc`. */
  blocs: Map<string, BlocDecor>;
  /** Noms des places traversées par le parcours, à afficher (dont la place d'arrivée). */
  places: PlaceDecor[];
  /** Alentours simplifiés (absents des cartes anciennes). */
  alentours?: AlentoursDecor;
}

/** Grille dense des alentours, en cases de `tuilesParCase` tuiles de côté. */
export interface AlentoursDecor {
  tuilesParCase: number;
  /** Case du coin haut-gauche de la grille (en cases depuis l'origine de la carte, peut être négative). */
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  /** Gids, ligne par ligne (largeur × hauteur) ; 0 hors des alentours. */
  gids: Uint32Array;
  /** Teintes des pâtés de maisons (gids ; le premier est celui des cases d'îlot), absentes des cartes anciennes. */
  teintesIlots?: number[];
}

export interface PlaceDecor {
  nom: string;
  /** Centre de la place, en tuiles. */
  x: number;
  y: number;
  /** Vrai pour la place d'arrivée du parcours. */
  arrivee: boolean;
}

/** Clé d'un bloc à partir de ses indices (coin en tuiles ÷ TAILLE_BLOC). */
export const cleBloc = (bx: number, by: number) => `${bx},${by}`;

const propriete = (carte: CarteTiled, nom: string) => carte.properties.find((p) => p.name === nom)?.value;

async function decompresser(base64: string): Promise<Uint32Array> {
  const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('deflate'));
  const brut = new Uint8Array(await new Response(flux).arrayBuffer());
  const vue = new DataView(brut.buffer, brut.byteOffset, brut.byteLength);
  const gids = new Uint32Array(brut.byteLength / 4);
  for (let i = 0; i < gids.length; i++) gids[i] = vue.getUint32(i * 4, true);
  return gids;
}

/** Lit une carte de décor (format ci-dessus) et décode ses blocs. */
export async function lireDecor(carte: CarteTiled): Promise<Decor> {
  const lon = propriete(carte, 'origine_lon');
  const lat = propriete(carte, 'origine_lat');
  if (propriete(carte, 'format') !== FORMAT_DECOR || typeof lon !== 'number' || typeof lat !== 'number') {
    throw new Error('Carte de décor illisible');
  }
  const tuilesParCase = (c: CoucheTuilesTiled) => c.properties?.find((p) => p.name === PROPRIETE_TUILES_PAR_CASE)?.value;
  const toutes = carte.layers.filter((c): c is CoucheTuilesTiled => c.type === 'tilelayer');
  const couches = toutes.filter((c) => c.name !== COUCHE_ALENTOURS);
  const coucheAlentours = toutes.find((c) => c.name === COUCHE_ALENTOURS);
  const blocs = new Map<string, BlocDecor>();
  for (const couche of couches) {
    for (const bloc of couche.chunks) {
      if (bloc.width !== TAILLE_BLOC || bloc.height !== TAILLE_BLOC || bloc.x % TAILLE_BLOC || bloc.y % TAILLE_BLOC) {
        throw new Error(`Bloc mal aligné (${bloc.x}, ${bloc.y})`);
      }
      const cle = cleBloc(bloc.x / TAILLE_BLOC, bloc.y / TAILLE_BLOC);
      let b = blocs.get(cle);
      if (!b) blocs.set(cle, (b = { x: bloc.x, y: bloc.y, couches: {} }));
      b.couches[couche.name] = await decompresser(bloc.data);
    }
  }
  const places = carte.layers
    .filter((c): c is CoucheObjetsTiled => c.type === 'objectgroup' && c.name === COUCHE_PLACES)
    .flatMap((c) => c.objects)
    .map((o) => ({
      nom: o.name,
      x: o.x / TAILLE_TUILE_PX,
      y: o.y / TAILLE_TUILE_PX,
      arrivee: o.properties?.find((p) => p.name === 'arrivee')?.value === true,
    }));
  const alentours = coucheAlentours ? await lireAlentours(coucheAlentours, Number(tuilesParCase(coucheAlentours))) : undefined;
  return {
    georef: { origine: [lon, lat] },
    largeur: carte.width,
    hauteur: carte.height,
    tilesets: carte.tilesets,
    nomsCouches: couches.map((c) => c.name),
    blocs,
    places,
    ...(alentours ? { alentours } : {}),
  };
}

/** Assemble les blocs de la couche des alentours en une grille dense. */
async function lireAlentours(couche: CoucheTuilesTiled, tuilesParCase: number): Promise<AlentoursDecor | undefined> {
  if (!Number.isInteger(tuilesParCase) || tuilesParCase < 1) throw new Error('Alentours : tuiles_par_case illisible');
  if (couche.chunks.length === 0) return undefined;
  // Version 2 : blocs de 32 cases ; version 3 : blocs plus grands (côté multiple de 32).
  const multiple = (v: number) => Number.isInteger(v) && v > 0 && v % TAILLE_BLOC === 0;
  for (const bloc of couche.chunks) {
    if (!multiple(bloc.width) || !multiple(bloc.height) || bloc.x % TAILLE_BLOC || bloc.y % TAILLE_BLOC) {
      throw new Error(`Bloc des alentours mal aligné (${bloc.x}, ${bloc.y})`);
    }
  }
  const x = Math.min(...couche.chunks.map((b) => b.x));
  const y = Math.min(...couche.chunks.map((b) => b.y));
  const largeur = Math.max(...couche.chunks.map((b) => b.x + b.width)) - x;
  const hauteur = Math.max(...couche.chunks.map((b) => b.y + b.height)) - y;
  const gids = new Uint32Array(largeur * hauteur);
  for (const bloc of couche.chunks) {
    const donnees = await decompresser(bloc.data);
    if (donnees.length !== bloc.width * bloc.height) throw new Error(`Bloc des alentours tronqué (${bloc.x}, ${bloc.y})`);
    for (let r = 0; r < bloc.height; r++) {
      gids.set(donnees.subarray(r * bloc.width, (r + 1) * bloc.width), (bloc.y - y + r) * largeur + (bloc.x - x));
    }
  }
  const teintes = String(couche.properties?.find((p) => p.name === PROPRIETE_TEINTES_ILOTS)?.value ?? '')
    .split(',')
    .map(Number)
    .filter((g) => Number.isInteger(g) && g > 0);
  return { tuilesParCase, x, y, largeur, hauteur, gids, ...(teintes.length ? { teintesIlots: teintes } : {}) };
}

/** Gid de la tuile (x, y) d'une couche ; 0 si vide ou hors des blocs. */
export function tuileEn(decor: Decor, couche: string, x: number, y: number): number {
  const bx = Math.floor(x / TAILLE_BLOC);
  const by = Math.floor(y / TAILLE_BLOC);
  const gids = decor.blocs.get(cleBloc(bx, by))?.couches[couche];
  if (!gids) return 0;
  return gids[(y - by * TAILLE_BLOC) * TAILLE_BLOC + (x - bx * TAILLE_BLOC)] ?? 0;
}
