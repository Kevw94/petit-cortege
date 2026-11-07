/**
 * Disposition de la masse de foule le long du parcours, partie pure (sans Phaser) :
 * des « tampons » (paquets d'avatars précomposés) posés en quinconce sur la largeur
 * de la rue, le long des tronçons en masse du Cortège.
 *
 * La grille est ancrée sur le repère qui avance avec la foule (`Cortege.avanceeM`) :
 * les tampons avancent avec elle, sans sauter d'une image à l'autre.
 */
import type { TronconDeFoule } from '../cortege/foule';

export interface Tampon {
  /** Pieds du tampon : abscisse le long du parcours et décalage latéral, en mètres. */
  distanceM: number;
  decalageM: number;
  /** Variante de paquet (texture), stable pour un même tampon. */
  variante: number;
}

export interface OptionsTampons {
  /** Origine de la grille le long du parcours (repère qui avance avec la foule). */
  repereM: number;
  /** Écart entre deux tampons le long du parcours, en mètres. */
  pasM: number;
  /** Largeur de la bande de foule, en mètres (centrée sur le parcours). */
  largeurM: number;
  /** Nombre de rangées de tampons sur la largeur. */
  rangees: number;
  variantes: number;
  /** Plafond de tampons : au-delà, le pas est élargi. */
  maximum: number;
}

/** Deux tronçons en masse plus proches que ça forment une seule bande continue. */
const JOINTURE_M = 4;

/** Bandes continues de masse : tronçons en masse voisins réunis. */
export function bandesDeMasse(troncons: readonly TronconDeFoule[]): { debutM: number; finM: number }[] {
  const bandes: { debutM: number; finM: number }[] = [];
  for (const t of [...troncons].filter((t) => t.enMasse).sort((a, b) => a.debutM - b.debutM)) {
    const derniere = bandes.at(-1);
    if (derniere && t.debutM - derniere.finM <= JOINTURE_M) derniere.finM = Math.max(derniere.finM, t.finM);
    else bandes.push({ debutM: t.debutM, finM: t.finM });
  }
  return bandes;
}

export function tamponsDeMasse(troncons: readonly TronconDeFoule[], options: OptionsTampons): Tampon[] {
  const { repereM, largeurM, rangees, variantes, maximum } = options;
  const bandes = bandesDeMasse(troncons);
  const longueur = bandes.reduce((total, b) => total + b.finM - b.debutM, 0);
  const pasM = Math.max(options.pasM, (longueur * rangees) / Math.max(maximum, 1));
  const ecartRangees = largeurM / rangees;

  const tampons: Tampon[] = [];
  for (const { debutM, finM } of bandes) {
    for (let rangee = 0; rangee < rangees; rangee++) {
      // Quinconce : une rangée sur deux décalée d'un demi-pas.
      const decale = (rangee % 2) * 0.5;
      const premier = Math.ceil((debutM - repereM) / pasM - decale);
      const dernier = Math.floor((finM - repereM) / pasM - decale);
      const numeros = premier <= dernier ? range(premier, dernier) : [Math.round((debutM + finM) / 2 / pasM)];
      for (const k of numeros) {
        const h = melanger(k, rangee);
        const distanceM =
          premier <= dernier ? repereM + (k + decale + ((h & 0xff) / 255 - 0.5) * 0.4) * pasM : (debutM + finM) / 2;
        const decalageM = -largeurM / 2 + (rangee + 0.5 + (((h >>> 8) & 0xff) / 255 - 0.5) * 0.4) * ecartRangees;
        tampons.push({ distanceM, decalageM, variante: (h >>> 16) % variantes });
      }
    }
  }
  return tampons;
}

function range(de: number, a: number): number[] {
  return Array.from({ length: a - de + 1 }, (_, i) => de + i);
}

/** Petit hachage entier de (numéro, rangée) : décalages et variante d'un tampon, stables. */
function melanger(k: number, rangee: number): number {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(rangee + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
