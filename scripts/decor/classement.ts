/**
 * Ce que le décor retient d'un objet OSM : rues selon leur type, espaces
 * verts, eau ; les emprises de bâtiments (`estBatiment`). Tout le reste
 * (commerces, POI, noms, mobilier) est ignoré.
 */
import type { ObjetOsm } from './osm';

/** Nature du sol d'une tuile, dans l'ordre où on la peint (une valeur plus haute recouvre). */
export const Terrain = {
  vide: 0,
  ilot: 1,
  vert: 2,
  eau: 3,
  trottoir: 4,
  pieton: 5,
  chaussee: 6,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export type Classement =
  /** Rue : chaussée (ou voie piétonne) de `largeurM`, bordée de trottoirs de `trottoirM` de chaque côté. */
  | { sorte: 'rue'; terrain: Terrain; largeurM: number; trottoirM: number }
  /** Surface (polygone) : espace vert, eau, place piétonne. */
  | { sorte: 'surface'; terrain: Terrain }
  /** Cours d'eau tracé en ligne. */
  | { sorte: 'cours-d-eau'; largeurM: number };

/** Largeurs par défaut selon le type de rue : [chaussée, trottoir] en mètres. */
const RUES: Record<string, [number, number]> = {
  motorway: [14, 0],
  trunk: [14, 4],
  primary: [12, 4],
  secondary: [10, 4],
  tertiary: [8, 3],
  unclassified: [6, 3],
  residential: [6, 3],
  living_street: [6, 2],
  service: [4, 0],
};
const LARGEUR_PIETONNE_M = 8;
const LARGEUR_CHEMIN_M = 2;
const LARGEUR_PISTE_CYCLABLE_M = 2;
const LARGEUR_VOIE_M = 3.5;

const VERTS: Record<string, string[]> = {
  leisure: ['park', 'garden', 'playground', 'pitch', 'dog_park'],
  landuse: ['grass', 'recreation_ground', 'village_green', 'cemetery', 'forest', 'meadow', 'allotments', 'flowerbed'],
  natural: ['wood', 'scrub', 'grassland', 'heath'],
};
const EAUX: Record<string, string[]> = {
  natural: ['water'],
  waterway: ['riverbank', 'dock'],
  landuse: ['basin', 'reservoir'],
};
const COURS_D_EAU: Record<string, number> = { river: 30, canal: 20, stream: 3, ditch: 2 };

const correspond = (tags: Record<string, string>, table: Record<string, string[]>) =>
  Object.entries(table).some(([cle, valeurs]) => valeurs.includes(tags[cle] ?? ''));

/** Souterrain, couvert ou à l'intérieur : invisible depuis la rue. */
const estCache = (t: Record<string, string>) =>
  (t.tunnel !== undefined && t.tunnel !== 'no') ||
  (t.covered !== undefined && t.covered !== 'no') ||
  t.location === 'underground' ||
  t.indoor === 'yes' ||
  Number(t.layer ?? 0) < 0;

const nombre = (v: string | undefined) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function classer(objet: ObjetOsm): Classement | null {
  const t = objet.tags;
  if (estCache(t)) return null;
  const surface = objet.anneaux.length > 0;

  if (t.highway !== undefined) {
    const enSurface = surface && (t.area === 'yes' || objet.ligne.length === 0);
    if (t.highway === 'pedestrian' || t.place === 'square') {
      return enSurface
        ? { sorte: 'surface', terrain: Terrain.pieton }
        : { sorte: 'rue', terrain: Terrain.pieton, largeurM: nombre(t.width) ?? LARGEUR_PIETONNE_M, trottoirM: 0 };
    }
    // Trottoir ou parvis dessiné en surface.
    if (enSurface) return t.highway === 'footway' ? { sorte: 'surface', terrain: Terrain.trottoir } : null;
    if (['footway', 'path', 'steps', 'bridleway', 'track'].includes(t.highway)) {
      if (t.footway === 'crossing') return null;
      // Trottoir cartographié à part : même dalle que les trottoirs déduits des rues.
      const terrain = t.footway === 'sidewalk' ? Terrain.trottoir : Terrain.pieton;
      return { sorte: 'rue', terrain, largeurM: nombre(t.width) ?? LARGEUR_CHEMIN_M, trottoirM: 0 };
    }
    if (t.highway === 'cycleway') {
      return { sorte: 'rue', terrain: Terrain.chaussee, largeurM: nombre(t.width) ?? LARGEUR_PISTE_CYCLABLE_M, trottoirM: 0 };
    }
    const type = t.highway.replace(/_link$/, '');
    const defaut = RUES[type];
    if (!defaut) return null; // construction, proposed, platform, bus_stop…
    const voies = nombre(t.lanes);
    const largeurM = nombre(t.width) ?? (voies !== undefined ? Math.max(voies * LARGEUR_VOIE_M, defaut[0]) : defaut[0]);
    return { sorte: 'rue', terrain: Terrain.chaussee, largeurM, trottoirM: t.sidewalk === 'no' ? 0 : defaut[1] };
  }

  if (surface && correspond(t, EAUX)) return { sorte: 'surface', terrain: Terrain.eau };
  if (surface && correspond(t, VERTS)) return { sorte: 'surface', terrain: Terrain.vert };
  if (surface && t.place === 'square') return { sorte: 'surface', terrain: Terrain.pieton };
  // Emprises de voirie dessinées à part (area:highway) : trottoirs, places piétonnes.
  const emprise = t['area:highway'];
  if (surface && (emprise === 'footway' || emprise === 'pedestrian')) {
    return { sorte: 'surface', terrain: emprise === 'footway' ? Terrain.trottoir : Terrain.pieton };
  }
  if (!surface && t.waterway !== undefined && COURS_D_EAU[t.waterway] !== undefined) {
    return { sorte: 'cours-d-eau', largeurM: nombre(t.width) ?? COURS_D_EAU[t.waterway]! };
  }
  return null;
}

/** Emprise de bâtiment visible depuis la rue (les auvents `building=roof` et le souterrain sont exclus). */
export function estBatiment(objet: ObjetOsm): boolean {
  const b = objet.tags.building;
  return objet.anneaux.length > 0 && b !== undefined && b !== 'no' && b !== 'roof' && !estCache(objet.tags);
}
