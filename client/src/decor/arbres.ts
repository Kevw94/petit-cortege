/**
 * Arbres du décor (OSM, couche `arbres`), partagés par les vues 2D et 3D : leur allure (feuillu
 * vert ou roux selon la saison, conifère), stable d'un client à l'autre, et leurs sprites
 * Kenney (planche RPG, CC0 : un arbre fait deux tuiles de haut).
 */
import type { ArbreDecor } from '@petit-cortege/shared';
import { tirageIdentifiant } from '../cortege/hachage';

/** Taille d'un arbre (sprite 16 × 32 px) à l'échelle 1, en mètres : un platane de boulevard en pixel art. */
export const ARBRE_M = { largeur: 6, hauteur: 12 } as const;

export const VARIANTES_ARBRE = ['feuillu-clair', 'feuillu-roux', 'feuillu-sombre', 'conifere-clair', 'conifere-sombre'] as const;
export type VarianteArbre = (typeof VARIANTES_ARBRE)[number];

/** Colonne de chaque variante dans la planche RPG (rangées 10 et 11 : houppier puis tronc). */
const COLONNES: Record<VarianteArbre, number> = {
  'feuillu-clair': 13,
  'feuillu-roux': 14,
  'feuillu-sombre': 15,
  'conifere-clair': 16,
  'conifere-sombre': 18,
};
const RANGEE_HAUT = 10;
const PAS_PLANCHE = 17; // tuiles de 16 px, 1 px d'espacement

/** Part des feuillus roussis selon le mois (0 = janvier) : l'automne parisien, de septembre à novembre. */
const ROUX_PAR_MOIS = [0, 0, 0, 0, 0, 0, 0, 0, 0.12, 0.45, 0.6, 0.2];

export function allureDArbre(arbre: ArbreDecor, date: Date): { variante: VarianteArbre; echelle: number } {
  const tirage = tirageIdentifiant(`${arbre.x.toFixed(2)},${arbre.y.toFixed(2)}`);
  const u = (tirage & 0xffff) / 0x10000;
  const v = (tirage >>> 16) / 0x10000;
  const echelle = 0.85 + 0.3 * v;
  if (arbre.resineux) return { variante: u < 0.5 ? 'conifere-clair' : 'conifere-sombre', echelle };
  if (u < ROUX_PAR_MOIS[date.getUTCMonth()]!) return { variante: 'feuillu-roux', echelle };
  return { variante: u < 0.6 ? 'feuillu-sombre' : 'feuillu-clair', echelle };
}

/**
 * Planche des sprites d'arbres, côte à côte dans l'ordre de `VARIANTES_ARBRE` (16 × 32 px
 * chacun) : les deux tuiles de chaque arbre recollées, sans l'espacement de la planche Kenney.
 */
export function dessinerArbres(planche: CanvasImageSource): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 16 * VARIANTES_ARBRE.length;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  VARIANTES_ARBRE.forEach((variante, i) => {
    const sx = COLONNES[variante] * PAS_PLANCHE;
    for (const r of [0, 1]) ctx.drawImage(planche, sx, (RANGEE_HAUT + r) * PAS_PLANCHE, 16, 16, i * 16, r * 16, 16, 16);
  });
  return canvas;
}
