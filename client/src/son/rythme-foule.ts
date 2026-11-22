/**
 * Rythme de la foule, partie pure : les pas des voisins pendant la marche (à la cadence
 * de l'animation, ≈ 1,8 pas par seconde) et les temps de la danse finale, calés sur les
 * sauts des avatars (`marche.ts`). Le moteur Web Audio joue ces instants.
 */
import { CADENCE_PAS_PAR_S, TEMPO_DANSE_PAR_S, VARIETE_DANSE } from '../cortege/marche';
import { aleaDepuis, combinerGraines } from './alea';

/** Nombre maximal de voisins dont on entend les pas un à un. */
export const MARCHEURS_MAX = 4;

export interface Marcheur {
  /** Pas par seconde, autour de la cadence de l'animation. */
  cadence: number;
  /** Décalage de son pas, de 0 à 1 (en pas). */
  phase: number;
  /** Position stéréo, de -1 à 1. */
  pan: number;
  /** Niveau relatif, de 0 à 1. */
  niveau: number;
  /** Timbre du talon (Hz) : semelle souple ou chaussure plus dure. */
  talonHz: number;
}

/** Voisins qui marchent autour de soi : chacun sa cadence, sa phase, sa place, son pas. */
export function marcheursProches(graine: number): Marcheur[] {
  return Array.from({ length: MARCHEURS_MAX }, (_, i) => {
    const alea = aleaDepuis(combinerGraines(graine, 300 + i));
    return {
      cadence: CADENCE_PAS_PAR_S * (0.94 + 0.12 * alea()),
      phase: alea(),
      pan: (i % 2 === 0 ? -1 : 1) * (0.2 + 0.6 * alea()),
      niveau: 0.5 + 0.5 * alea(),
      talonHz: 180 + 160 * alea(),
    };
  });
}

/**
 * Instants (s) où le marcheur pose le pied dans [debut, fin[ : réguliers à sa cadence,
 * avec une petite irrégularité humaine (au plus 15 ms), stable pour un même pas.
 */
export function posesDePied(m: Marcheur, debut: number, fin: number): number[] {
  const instants: number[] = [];
  const periode = 1 / m.cadence;
  for (let k = Math.ceil(debut * m.cadence - m.phase) - 1; ; k++) {
    const regulier = (k + m.phase) * periode;
    const t = regulier + (aleaDepuis(combinerGraines(k, Math.round(m.phase * 1e6)))() - 0.5) * 0.03;
    if (regulier - 0.02 >= fin) break;
    if (t >= debut && t < fin) instants.push(t);
  }
  return instants;
}

/**
 * Décalage moyen des sauts de la danse (en temps) : chaque avatar garde un quart de temps
 * de sa phase propre (`VARIETE_DANSE`), soit un huitième en moyenne. Le son vise le milieu.
 */
export const DECALAGE_DANSE_TEMPS = VARIETE_DANSE / 2;

/**
 * Instant (s, horloge de l'animation : `performance.now() / 1000`) du temps `k` de la
 * danse finale, quand la foule retombe au sol : c'est là que frappent les surdos.
 */
export function instantDuTempsDeDanse(k: number): number {
  return (k - DECALAGE_DANSE_TEMPS) / TEMPO_DANSE_PAR_S;
}

/** Premier temps de danse (entier) qui tombe à `tempsS` ou après (horloge de l'animation). */
export function premierTempsDeDanse(tempsS: number): number {
  return Math.ceil(tempsS * TEMPO_DANSE_PAR_S + DECALAGE_DANSE_TEMPS - 1e-9);
}
