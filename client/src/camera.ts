/**
 * Caméra à la troisième personne : la vue suit de près son propre avatar (ou la
 * tête du cortège tant que le soutien n'a pas rejoint), et on peut dézoomer
 * jusqu'à la vue d'ensemble du parcours. Fonctions pures ; la scène les branche.
 */
import { ECHELLE_MAX_PX_PAR_M, type Cadrage, type PointM } from './cadrage';

/** Zoom du suivi : un avatar (2 m) fait environ 48 px de haut. */
export const ECHELLE_SUIVI_PX_PAR_M = 24;

/** Part de l'écart à la cible rattrapée à chaque image : mouvement doux, sans à-coups. */
export const LISSAGE_SUIVI = 0.15;

export interface PositionSurParcours {
  distanceM: number;
  decalageM: number;
}

/**
 * Qui suivre : son propre avatar (le plus avancé s'il y en a plusieurs), sinon la
 * tête du cortège au milieu de la rue, sinon le point de départ.
 */
export function cibleDeSuivi(avatars: readonly (PositionSurParcours & { propre: boolean })[]): PositionSurParcours {
  let propre: PositionSurParcours | null = null;
  let tete: number | null = null;
  for (const a of avatars) {
    if (a.propre && (propre === null || a.distanceM > propre.distanceM))
      propre = { distanceM: a.distanceM, decalageM: a.decalageM };
    if (tete === null || a.distanceM > tete) tete = a.distanceM;
  }
  return propre ?? { distanceM: tete ?? 0, decalageM: 0 };
}

/** Cadrage de près centré sur la cible ; le dézoom reste possible jusqu'à la vue d'ensemble. */
export function cadrerEnTroisiemePersonne(ensemble: Cadrage, cible: PointM): Cadrage {
  return {
    echelle: Math.min(Math.max(ECHELLE_SUIVI_PX_PAR_M, ensemble.echelleMin), ECHELLE_MAX_PX_PAR_M),
    centre: { ...cible },
    echelleMin: ensemble.echelleMin,
  };
}

/** Rapproche le centre de la vue de la cible (facteur 1 : sur la cible), sans toucher au zoom. */
export function suivre(cadrage: Cadrage, cible: PointM, facteur: number): Cadrage {
  return {
    ...cadrage,
    centre: {
      x: cadrage.centre.x + (cible.x - cadrage.centre.x) * facteur,
      y: cadrage.centre.y + (cible.y - cadrage.centre.y) * facteur,
    },
  };
}
