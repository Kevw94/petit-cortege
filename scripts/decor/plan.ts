/**
 * Plan de la ville autour du parcours (ADR 0008) : un extrait OSM large (rues, verts, eau,
 * voies ferrées) rasterisé en image à basse résolution. Le client le pose sous la bande du
 * décor détaillé : quand on dézoome, la ville continue au lieu de s'arrêter sur un fond uni.
 * Mêmes règles de classement que le décor (`classer`) ; bords fondus dans la couleur des îlots.
 *
 * Données dérivées d'OpenStreetMap : l'image produite est sous ODbL.
 */
import { COULEURS_PLAN, METRES_PAR_TUILE, versTuiles, type Parcours, type PlanDecor, type PointTuiles, type Position } from '@petit-cortege/shared';
import type { ImageRGBA } from '../apparence/atlas';
import { classer, Terrain } from './classement';
import { lireExtrait, type ExtraitOverpass } from './osm';
import { Grille } from './raster';

export interface OptionsPlan {
  osm: ExtraitOverpass;
  parcours: Parcours;
  /** Marge autour de l'emprise du parcours, en mètres. */
  rayonM: number;
  metresParPixel: number;
}

export const RAYON_PLAN_PAR_DEFAUT_M = 1500;
export const METRES_PAR_PIXEL_PAR_DEFAUT = 4;
/** Largeur maximale du fondu sur les bords du plan, en mètres. */
const FONDU_MAX_M = 250;
const LARGEUR_RAIL_M = 4;
/** Une ligne garde au moins ce rayon (pixels) : une petite rue reste continue. */
const RAYON_MIN_PX = 0.6;

/** Valeurs de la grille propres au plan, au-dessus des terrains du décor. */
const RAIL = 7;
const COULEUR_DE: Record<number, number> = {
  [Terrain.vide]: COULEURS_PLAN.ilot,
  [Terrain.ilot]: COULEURS_PLAN.ilot,
  [Terrain.vert]: COULEURS_PLAN.vert,
  [Terrain.eau]: COULEURS_PLAN.eau,
  [Terrain.trottoir]: COULEURS_PLAN.trottoir,
  [Terrain.pieton]: COULEURS_PLAN.pieton,
  [Terrain.chaussee]: COULEURS_PLAN.rue,
  [RAIL]: COULEURS_PLAN.rail,
};

const estCache = (t: Record<string, string>) => (t.tunnel !== undefined && t.tunnel !== 'no') || Number(t.layer ?? 0) < 0;

export function genererPlan({ osm, parcours, rayonM, metresParPixel }: OptionsPlan): { image: ImageRGBA; plan: Omit<PlanDecor, 'fichier'> } {
  // Emprise : celle du parcours, élargie de `rayonM` ; origine au coin nord-ouest.
  const lons = parcours.coordinates.map((p) => p[0]);
  const lats = parcours.coordinates.map((p) => p[1]);
  const centre: Position = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const coin = versTuiles({ origine: centre }, [Math.min(...lons), Math.max(...lats)]);
  const oppose = versTuiles({ origine: centre }, [Math.max(...lons), Math.min(...lats)]);
  const enPx = METRES_PAR_TUILE / metresParPixel;
  const rayonTuiles = rayonM / METRES_PAR_TUILE;
  // Coin nord-ouest, en tuiles depuis le centre, ramené en position.
  const nordOuest = { x: coin.x - rayonTuiles, y: coin.y - rayonTuiles };
  const kx = (111_320 * Math.cos((centre[1] * Math.PI) / 180)) / METRES_PAR_TUILE;
  const ky = 110_540 / METRES_PAR_TUILE;
  const origine: Position = [centre[0] + nordOuest.x / kx, centre[1] - nordOuest.y / ky];
  const largeur = Math.ceil((oppose.x - coin.x + 2 * rayonTuiles) * enPx);
  const hauteur = Math.ceil((oppose.y - coin.y + 2 * rayonTuiles) * enPx);

  const georef = { origine };
  const projeter = (ligne: Position[]): PointTuiles[] =>
    ligne.map((p) => {
      const t = versTuiles(georef, p);
      return { x: t.x * enPx, y: t.y * enPx };
    });
  const rayon = (largeurM: number) => Math.max(largeurM / 2 / metresParPixel, RAYON_MIN_PX);

  const grille = new Grille(largeur, hauteur);
  grille.cases.fill(Terrain.ilot);
  const objets = lireExtrait(osm).map((objet) => ({ objet, classe: classer(objet) }));

  // Surfaces d'abord (verts, eau, places), puis cours d'eau, voies ferrées, rues par-dessus.
  for (const terrain of [Terrain.vert, Terrain.eau, Terrain.trottoir, Terrain.pieton]) {
    for (const { objet, classe } of objets) {
      if (classe?.sorte === 'surface' && classe.terrain === terrain) grille.peindrePolygone(objet.anneaux.map(projeter), terrain);
    }
  }
  for (const { objet, classe } of objets) {
    if (classe?.sorte === 'cours-d-eau') grille.peindreLigne(projeter(objet.ligne), rayon(classe.largeurM), Terrain.eau, false);
  }
  for (const { objet } of objets) {
    if (objet.tags.railway === 'rail' && !estCache(objet.tags) && objet.ligne.length > 1) {
      grille.peindreLigne(projeter(objet.ligne), rayon(LARGEUR_RAIL_M), RAIL, false);
    }
  }
  const rues = objets.flatMap(({ objet, classe }) => (classe?.sorte === 'rue' && objet.ligne.length > 1 ? [{ ligne: projeter(objet.ligne), classe }] : []));
  // Trottoirs sous toutes les chaussées, pour que les carrefours restent nets.
  for (const { ligne, classe } of rues) {
    if (classe.trottoirM > 0) grille.peindreLigne(ligne, rayon(classe.largeurM + 2 * classe.trottoirM), Terrain.trottoir, false);
  }
  for (const { ligne, classe } of rues) grille.peindreLigne(ligne, rayon(classe.largeurM), classe.terrain, false);

  // Couleurs, fondues dans celle des îlots près des bords.
  const fonduPx = Math.min(rayonM * 0.3, FONDU_MAX_M) / metresParPixel;
  const ilot = COULEURS_PLAN.ilot;
  const donnees = new Uint8Array(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = y * largeur + x;
      const c = COULEUR_DE[grille.cases[i]!] ?? ilot;
      const bord = Math.min(x, y, largeur - 1 - x, hauteur - 1 - y);
      const t = Math.min(1, bord / fonduPx);
      const f = t * t * (3 - 2 * t);
      for (let k = 0; k < 3; k++) {
        const decalage = 16 - 8 * k;
        const a = (ilot >> decalage) & 255;
        donnees[i * 4 + k] = Math.round(a + (((c >> decalage) & 255) - a) * f);
      }
      donnees[i * 4 + 3] = 255;
    }
  }
  return { image: { largeur, hauteur, donnees }, plan: { origine, metresParPixel, largeur, hauteur } };
}
