/**
 * Animation de marche, partie pure (sans Phaser ni Three.js) : un petit sautillement et un
 * léger balancement gauche-droite des avatars qui avancent, faute de cycle de marche dessiné
 * (sprites Kenney à une seule pose, aucun asset ajouté : ADR 0006).
 *
 * Purement visuel : s'ajoute au rendu sans toucher aux positions du Cortège (ADR 0004).
 * Le temps est injecté (secondes, horloge quelconque) ; chaque avatar a sa phase, tirée de
 * son identifiant, pour que la foule ne sautille pas à l'unisson. Rien n'est alloué par
 * avatar : `allureDeMarche` écrit dans un objet fourni, réutilisé d'un avatar à l'autre.
 */
import { LONGUEUR_TRONCON_M } from './foule';
import { tirageIdentifiant } from './hachage';

/** Cadence d'une marche lente, en pas par seconde (≈ 2 km/h, ADR 0004). */
export const CADENCE_PAS_PAR_S = 1.8;
/** Un pixel de l'atlas des avatars (16 px pour 2 m). */
export const METRES_PAR_PX_ATLAS = 2 / 16;
/** Hauteur du sautillement : un pixel de l'atlas au milieu de chaque pas. */
export const SAUT_PX_ATLAS = 1;
/** Part du pas passée en l'air quand le saut est calé sur le pixel : la moitié centrale. */
const SEUIL_SAUT = Math.SQRT1_2; // sin(π u) ≥ √½ ⇔ u ∈ [¼, ¾]
/** Inclinaison maximale du corps vers le pied d'appui (vue 3D). */
export const INCLINAISON_MAX_RAD = (2.5 * Math.PI) / 180;
/** Décalage latéral maximal du corps (vue 2D) : un demi-pixel de l'atlas. */
export const DECALAGE_MAX_PX_ATLAS = 0.5;
/** La pancarte suit son porteur avec ce retard, en pas (≈ 0,1 s). */
export const RETARD_PANCARTE_PAS = 0.2;
/**
 * En 3D, la pancarte s'incline comme le corps (en retard) : tournée autour des pieds, son
 * sommet (≈ 3 m) s'écarte déjà d'≈ 13 cm, assez pour se voir sans paraître arrachée.
 */
const AMPLEUR_PANCARTE = 1;

/** Allure d'un avatar à un instant : décalages à ajouter à son rendu (tous nuls à l'arrêt). */
export interface Allure {
  /** Sautillement continu, en mètres (vue 3D). */
  sautM: number;
  /** Sautillement calé sur un nombre entier de pixels de l'atlas (vue 2D, pixel art net). */
  sautPxAtlas: number;
  /** Inclinaison du corps, en radians, positive vers la droite de l'écran (vue 3D). */
  inclinaisonRad: number;
  /** Décalage latéral du corps, en pixels de l'atlas, par demi-pixel (vue 2D). */
  decalagePxAtlas: number;
  /** Inclinaison de la pancarte, en retard sur le corps (vue 3D). */
  inclinaisonPancarteRad: number;
  /** Décalage latéral de la pancarte, en retard sur le corps, par demi-pixel (vue 2D). */
  decalagePancartePxAtlas: number;
}

export function allureImmobile(): Allure {
  return {
    sautM: 0,
    sautPxAtlas: 0,
    inclinaisonRad: 0,
    decalagePxAtlas: 0,
    inclinaisonPancarteRad: 0,
    decalagePancartePxAtlas: 0,
  };
}

/** Phase propre d'un avatar, dans [0, 1[ (en pas) : stable, identique chez tous les clients. */
export function phaseDeMarche(id: string): number {
  return tirageIdentifiant(id) / 2 ** 32;
}

/** Phase d'un tampon de masse de foule, dans [0, 1[, à partir de sa place dans le repère qui avance. */
export function phaseDeTampon(distanceRelativeM: number, decalageM: number): number {
  let h =
    Math.imul(Math.round(distanceRelativeM * 4) ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(Math.round(decalageM * 4) + 7, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 2 ** 32;
}

/** Nombre de pas faits à l'instant `tempsS` (secondes) : la partie entière compte les pas. */
export function pasFaits(tempsS: number, phase: number): number {
  return tempsS * CADENCE_PAS_PAR_S + phase;
}

/** Hauteur relative du corps (0 à 1) : au sol à chaque pose de pied, en haut au milieu du pas. */
export function sautillement(pas: number): number {
  return Math.abs(Math.sin(Math.PI * pas));
}

/** Balancement (−1 à 1) : vers un pied puis vers l'autre, une période pour deux pas. */
export function balancement(pas: number): number {
  return Math.sin(Math.PI * pas);
}

/** Arrondi au demi-pixel de l'atlas (−½, 0 ou ½ pour le balancement du corps). */
const auDemiPixel = (px: number) => Math.round(px * 2) / 2;

/**
 * Écrit dans `sortie` l'allure d'un avatar à l'instant `tempsS`. À l'arrêt (`enMarche` faux :
 * pas encore parti, arrivé, manif terminée, ou mouvement réduit demandé), tout est nul :
 * l'avatar ne fait pas de pas.
 */
export function allureDeMarche(sortie: Allure, tempsS: number, phase: number, enMarche: boolean): Allure {
  if (!enMarche) {
    sortie.sautM = sortie.sautPxAtlas = sortie.inclinaisonRad = sortie.decalagePxAtlas = 0;
    sortie.inclinaisonPancarteRad = sortie.decalagePancartePxAtlas = 0;
    return sortie;
  }
  const pas = pasFaits(tempsS, phase);
  const haut = sautillement(pas);
  const cote = balancement(pas);
  const coteRetarde = balancement(pas - RETARD_PANCARTE_PAS);
  sortie.sautM = haut * SAUT_PX_ATLAS * METRES_PAR_PX_ATLAS;
  sortie.sautPxAtlas = haut >= SEUIL_SAUT ? SAUT_PX_ATLAS : 0;
  sortie.inclinaisonRad = cote * INCLINAISON_MAX_RAD;
  sortie.decalagePxAtlas = auDemiPixel(cote * DECALAGE_MAX_PX_ATLAS);
  sortie.inclinaisonPancarteRad = coteRetarde * INCLINAISON_MAX_RAD * AMPLEUR_PANCARTE;
  sortie.decalagePancartePxAtlas = auDemiPixel(coteRetarde * DECALAGE_MAX_PX_ATLAS);
  return sortie;
}

/** Tempo de la danse finale, en temps par seconde (≈ 120 battements par minute). */
export const TEMPO_DANSE_PAR_S = 2;
/** Saut de la danse : trois pixels de l'atlas, bien plus haut que le pas de marche. */
export const SAUT_DANSE_PX_ATLAS = 3;
/** Inclinaison maximale du corps en dansant (vue 3D). */
export const INCLINAISON_DANSE_RAD = (9 * Math.PI) / 180;
/** Déhanché latéral maximal en dansant (vue 2D) : un pixel et demi de l'atlas. */
export const DECALAGE_DANSE_PX_ATLAS = 1.5;
/** Part de la phase propre gardée en dansant : la foule danse presque ensemble, en légère vague. */
export const VARIETE_DANSE = 0.25;

/**
 * Écrit dans `sortie` l'allure d'un avatar qui danse (danse finale sur la place) : un saut
 * par temps, un déhanché d'un côté puis de l'autre tous les deux temps, la pancarte agitée
 * à contretemps. Presque à l'unisson (un quart de temps d'écart au plus), pour que la foule
 * danse ensemble.
 */
export function allureDeDanse(sortie: Allure, tempsS: number, phase: number): Allure {
  const temps = tempsS * TEMPO_DANSE_PAR_S + phase * VARIETE_DANSE;
  const haut = sautillement(temps);
  const cote = Math.sin((Math.PI * temps) / 2);
  const pancarte = Math.sin((Math.PI * temps) / 2 - Math.PI / 2);
  sortie.sautM = haut * SAUT_DANSE_PX_ATLAS * METRES_PAR_PX_ATLAS;
  sortie.sautPxAtlas = Math.round(haut * SAUT_DANSE_PX_ATLAS);
  sortie.inclinaisonRad = cote * INCLINAISON_DANSE_RAD;
  sortie.decalagePxAtlas = auDemiPixel(cote * DECALAGE_DANSE_PX_ATLAS);
  sortie.inclinaisonPancarteRad = pancarte * INCLINAISON_DANSE_RAD * 1.5;
  sortie.decalagePancartePxAtlas = auDemiPixel(pancarte * DECALAGE_DANSE_PX_ATLAS * 1.5);
  return sortie;
}

/**
 * Allure d'un avatar du cortège à l'instant `tempsS` : danse pendant la danse finale, pas de
 * marche s'il avance, immobile sinon ou si le mouvement réduit est demandé (`animer` faux).
 */
export function allureDuCortege(
  sortie: Allure,
  tempsS: number,
  id: string,
  { animer, danse, enMarche }: { animer: boolean; danse: boolean; enMarche: boolean },
): Allure {
  if (animer && danse) return allureDeDanse(sortie, tempsS, phaseDeMarche(id));
  return allureDeMarche(sortie, tempsS, phaseDeMarche(id), animer && enMarche);
}

/**
 * Sautillement de la masse de foule (pixels de l'atlas, entier) : chaque paquet ondule
 * à sa phase, seulement là où la foule avance.
 */
export function sautDeMasse(tempsS: number, phase: number, enMarche: boolean): number {
  return enMarche && sautillement(pasFaits(tempsS, phase)) >= SEUIL_SAUT ? SAUT_PX_ATLAS : 0;
}

/**
 * Tronçons de la foule (numérotés comme dans `composerFoule`, depuis `repereM`) où au moins
 * un avatar avance : la masse n'y ondule que là. Écrit dans `sortie` (vidé d'abord).
 */
export function marquerTronconsEnMarche(
  avatars: readonly { distanceM: number; enMarche: boolean }[],
  repereM: number,
  sortie: Set<number>,
): Set<number> {
  sortie.clear();
  for (const a of avatars) if (a.enMarche) sortie.add(Math.floor((a.distanceM - repereM) / LONGUEUR_TRONCON_M));
  return sortie;
}

/** Le point `distanceM` est-il dans un tronçon marqué en marche ? */
export function tronconEnMarche(tronconsEnMarche: ReadonlySet<number>, distanceM: number, repereM: number): boolean {
  return tronconsEnMarche.has(Math.floor((distanceM - repereM) / LONGUEUR_TRONCON_M));
}

/** `prefers-reduced-motion: reduce` : pas d'animation de marche (lu à chaque image, sans allocation). */
export function requeteMouvementReduit(): { readonly matches: boolean } {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
}
