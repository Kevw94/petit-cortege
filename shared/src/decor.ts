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
export const VERSION_FORMAT_DECOR = 1;
export const ATTRIBUTION_OSM = '© les contributeurs d’OpenStreetMap';
/**
 * Couches de tuiles des bâtiments (toits et murs, puis fenêtres et portes) : le
 * client ne les cuit pas avec le sol, il les dessine par rangées, profondeur = y,
 * pour qu'une façade passe devant les avatars qui sont derrière elle.
 */
export const COUCHES_BATIMENTS: readonly string[] = ['batiments', 'facades'];
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
  /** Plan de la ville autour du décor, vu quand on dézoome (ADR 0008). */
  plan?: PlanDecor;
}

/**
 * Plan de la ville autour du parcours : image PNG à basse résolution (rues, verts, eau sur
 * un fond d'îlots), bien plus large que la bande du décor, posée dessous. Dérivée d'OSM (ODbL).
 */
export interface PlanDecor {
  /** Image PNG, relative à l'index. */
  fichier: string;
  /** Position du coin nord-ouest du pixel (0, 0). */
  origine: Position;
  metresParPixel: number;
  /** Taille de l'image, en pixels. */
  largeur: number;
  hauteur: number;
}

/**
 * Couleurs du plan (0xRRGGBB), en sourdine par rapport au décor détaillé. Les îlots servent
 * aussi de sol au-delà du plan : son bord s'y fond sans coupure.
 */
export const COULEURS_PLAN = {
  ilot: 0xa49d92,
  trottoir: 0xbdb7ad,
  rue: 0x5e6266,
  pieton: 0xcdc5b4,
  vert: 0x75a35f,
  eau: 0x5f93c4,
  rail: 0x847a70,
} as const;

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

/** Le décor dont l'emprise contient tout le parcours, s'il y en a un. */
export function decorDuParcours(index: IndexDecors, parcours: Position[]): EntreeIndexDecors | undefined {
  return index.decors.find(({ emprise: [x0, y0, x1, y1] }) =>
    parcours.every(([lon, lat]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1),
  );
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
  const couches = carte.layers.filter((c): c is CoucheTuilesTiled => c.type === 'tilelayer');
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
  return {
    georef: { origine: [lon, lat] },
    largeur: carte.width,
    hauteur: carte.height,
    tilesets: carte.tilesets,
    nomsCouches: couches.map((c) => c.name),
    blocs,
    places,
  };
}

/** Gid de la tuile (x, y) d'une couche ; 0 si vide ou hors des blocs. */
export function tuileEn(decor: Decor, couche: string, x: number, y: number): number {
  const bx = Math.floor(x / TAILLE_BLOC);
  const by = Math.floor(y / TAILLE_BLOC);
  const gids = decor.blocs.get(cleBloc(bx, by))?.couches[couche];
  if (!gids) return 0;
  return gids[(y - by * TAILLE_BLOC) * TAILLE_BLOC + (x - bx * TAILLE_BLOC)] ?? 0;
}
