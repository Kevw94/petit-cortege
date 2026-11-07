/**
 * Image finale (partie pure du Cortège, sans Phaser ni réseau) : tout le cortège
 * d'une manif terminée rassemblé au point d'arrivée, avec ses avatars dessinés au
 * premier plan, la masse de foule et le compteur.
 *
 * Répartition sur la place : un disque centré sur le point d'arrivée, découpé en
 * places disposées en tournesol (spirale de Vogel : chaque place couvre la même
 * aire, sans rangées visibles). Chaque avatar vise la place donnée par le tirage de
 * son identifiant, et prend la suivante (en bouclant) si elle est prise (dans l'ordre des
 * tirages) : déterministe, sans collision, indépendant de l'ordre des fichiers, et
 * un avatar ajouté ou retiré ne déplace que ses voisins de grappe.
 */
import type { EntreePubliee, FichierEntrees, ManifPubliee } from '@petit-cortege/shared';
import { BUDGET_AVATARS_DESSINES } from '../apparence/affichage';
import { calculerCortege } from './cortege';
import { DENSITE_PREMIER_PLAN, SEUIL_DENSITE_PAR_TUILE } from './foule';
import { tirageIdentifiant } from './hachage';

/**
 * Aire d'une place de la spirale, en m². Avec au moins deux fois plus de places que
 * d'avatars, la foule tient entre ½ et 1 avatar par tuile de 4 m² : le seuil de
 * lisibilité du cortège (au-delà, masse de foule).
 */
const AIRE_PLACE_M2 = 2;
/**
 * Rayon maximal du rassemblement, en mètres (une grande place parisienne fait
 * ≈ 100 à 250 m de diamètre). Au-delà, la foule se resserre : sa densité dépasse le
 * seuil et elle est rendue en masse, avec des avatars tirés au premier plan.
 */
export const RAYON_MAX_M = 50;
/** Avatars de la masse dessinés au plus par tuile (au-delà, ils seraient cachés les uns par les autres). */
const MASSE_DESSINEE_PAR_TUILE = 3;
const ANGLE_D_OR = Math.PI * (3 - Math.sqrt(5));
const AIRE_TUILE_M2 = 4;
const DEUX_32 = 2 ** 32;

export interface AvatarImageFinale {
  id: string;
  /** Position par rapport au point d'arrivée, en mètres : x vers l'est, y vers le sud (comme l'écran). */
  xM: number;
  yM: number;
  apparence: number;
  pancarte: number;
  /** Avatar du soutien sur cet appareil : toujours au premier plan, mis en valeur. */
  propre: boolean;
}

export interface ImageFinale {
  /** Soutiens dans le cortège : entrées publiées et propres, retraits appliqués. */
  compteur: number;
  /** Rayon du rassemblement autour du point d'arrivée, en mètres. */
  rayonM: number;
  /** Avatars dessinés individuellement (avec leur pancarte), du fond vers l'avant (y croissant). */
  premierPlan: AvatarImageFinale[];
  /**
   * Avatars de la masse de foule à dessiner (atténués, sans pancarte), du fond vers l'avant.
   * Échantillon tiré, au plus `MASSE_DESSINEE_PAR_TUILE` par tuile : les autres seraient cachés.
   */
  masse: AvatarImageFinale[];
  /** Avatars non dessinés au premier plan (dans la masse, dessinés ou non). */
  enMasse: number;
}

export interface EntreesImageFinale {
  manif: ManifPubliee;
  entrees: FichierEntrees[];
  /** Avatars du soutien sur cet appareil, mis en valeur. */
  propres?: EntreePubliee[];
  retraits?: readonly string[];
}

export interface OptionsImageFinale {
  /** Nombre maximal d'avatars de la foule au premier plan (ses propres avatars en plus). */
  budget?: number;
}

export function composerImageFinale(
  { manif, entrees, propres = [], retraits = [] }: EntreesImageFinale,
  { budget = BUDGET_AVATARS_DESSINES }: OptionsImageFinale = {},
): ImageFinale {
  // Tout le cortège, tel qu'il est à la fin : entrées publiées, propres, retraits appliqués.
  const { avatars } = calculerCortege({ manif, entrees, propres, retraits, maintenant: new Date(manif.fin) });
  const n = avatars.length;

  // Places : une puissance de 2, au moins deux fois le nombre d'avatars (grappes courtes).
  const nombrePlaces = Math.max(16, 2 ** Math.ceil(Math.log2(2 * n)));
  const rayonNaturel = Math.sqrt((nombrePlaces * AIRE_PLACE_M2) / Math.PI);
  const rayonM = Math.min(rayonNaturel, RAYON_MAX_M);
  const airePlace = (Math.PI * rayonM * rayonM) / nombrePlaces;
  const place = (i: number) => {
    const r = Math.sqrt(((i + 0.5) * airePlace) / Math.PI);
    return { xM: r * Math.cos(i * ANGLE_D_OR), yM: r * Math.sin(i * ANGLE_D_OR) };
  };

  // Place visée : un second tirage, indépendant de celui du premier plan (sinon les avatars
  // tirés au premier plan, aux plus petits tirages, seraient tous au centre de la spirale).
  const tires = avatars
    .map((avatar) => ({ avatar, tirage: tirageIdentifiant(avatar.id), visee: tirageIdentifiant(`place:${avatar.id}`) }))
    .sort((a, b) => a.visee - b.visee || (a.avatar.id < b.avatar.id ? -1 : a.avatar.id > b.avatar.id ? 1 : 0));
  const occupees = new Set<number>();
  const places = tires.map(({ avatar, tirage, visee }) => {
    let i = Math.floor((visee / DEUX_32) * nombrePlaces);
    while (occupees.has(i)) i = (i + 1) % nombrePlaces;
    occupees.add(i);
    const { id, apparence, pancarte, propre } = avatar;
    return { tirage, avatar: { id, ...place(i), apparence, pancarte, propre } };
  });

  // Premier plan : tout le monde jusqu'au seuil de densité et dans le budget ; au-delà, les
  // avatars dont le tirage est sous une fraction (puissance de 2) : stable, ensembles emboîtés.
  const densite = (n * AIRE_TUILE_M2) / (Math.PI * rayonM * rayonM);
  let fraction = 1;
  if (densite > SEUIL_DENSITE_PAR_TUILE || n > budget) {
    fraction = 0.5;
    while (densite * fraction > DENSITE_PREMIER_PLAN || n * fraction > budget) fraction /= 2;
  }
  const fractionMasse = Math.min(1, MASSE_DESSINEE_PAR_TUILE / densite);
  const premierPlan: AvatarImageFinale[] = [];
  const masse: AvatarImageFinale[] = [];
  for (const { tirage, avatar } of places) {
    if (avatar.propre || tirage < fraction * DEUX_32) premierPlan.push(avatar);
    else if (tirage < fractionMasse * DEUX_32) masse.push(avatar);
  }
  const versLAvant = (a: AvatarImageFinale, b: AvatarImageFinale) => a.yM - b.yM || a.xM - b.xM;
  return {
    compteur: n,
    rayonM,
    premierPlan: premierPlan.sort(versLAvant),
    masse: masse.sort(versLAvant),
    enMasse: n - premierPlan.length,
  };
}
