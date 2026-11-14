/**
 * Ambiance de manif : réglages du brouhaha, des pas, des percussions lointaines et des
 * événements (sifflet, applaudissements) selon le nombre de soutiens du cortège et sa
 * phase. Avant le départ, un murmure calme ; en marche, une foule plus dense. Fonction
 * pure, appliquée par le moteur Web Audio au plus une fois par seconde.
 */
import type { EtatManif } from '../cortege/cortege';

export type PhaseAmbiance = 'avant' | 'marche' | 'fin';

export function phaseAmbiance(etat: EtatManif, departMs: number, maintenantMs: number): PhaseAmbiance {
  if (etat === 'terminee') return 'fin';
  return maintenantMs < departMs ? 'avant' : 'marche';
}

export interface ReglagesAmbiance {
  /** Volume du brouhaha (bruit filtré), de 0 à 1. */
  brouhaha: number;
  /** Fréquence de coupure du filtre du brouhaha (Hz) : plus de monde, plus de brillance. */
  coupureHz: number;
  /** Pas (frottements discrets) par seconde. */
  pasParSeconde: number;
  /** Volume des percussions lointaines, de 0 à 1 (0 : aucune). */
  percussions: number;
  /** Événements doux (sifflet lointain, applaudissements) par minute. */
  evenementsParMinute: number;
}

/** Au-delà, la foule ne s'entend pas plus fort : l'échelle sature doucement. */
export const SOUTIENS_SATURATION = 5_000;

/** Taille ressentie de la foule, de 0 (personne) à 1 (≥ SOUTIENS_SATURATION), en échelle log. */
export function tailleRessentie(soutiens: number): number {
  const n = Number.isFinite(soutiens) ? Math.max(0, soutiens) : 0;
  return Math.min(1, Math.log10(1 + n) / Math.log10(1 + SOUTIENS_SATURATION));
}

export function reglagesAmbiance({ soutiens, phase }: { soutiens: number; phase: PhaseAmbiance }): ReglagesAmbiance {
  const f = tailleRessentie(soutiens);
  switch (phase) {
    case 'avant':
      return {
        brouhaha: 0.18 + 0.32 * f,
        coupureHz: 600 + 500 * f,
        pasParSeconde: 0.3 + 0.9 * f,
        percussions: 0,
        evenementsParMinute: 0.5 + 1.5 * f,
      };
    case 'marche':
      return {
        brouhaha: 0.3 + 0.55 * f,
        coupureHz: 800 + 900 * f,
        pasParSeconde: 1.5 + 6.5 * f,
        percussions: 0.25 + 0.55 * f,
        evenementsParMinute: 2 + 5 * f,
      };
    case 'fin':
      return { brouhaha: 0.12, coupureHz: 600, pasParSeconde: 0, percussions: 0, evenementsParMinute: 0.5 };
  }
}

/**
 * Limiteur de cadence : vrai au plus une fois par `intervalleMs` (le rappel du Cortège
 * arrive à chaque image ; l'ambiance n'a besoin que d'≈ 1 mise à jour par seconde).
 */
export function creerLimiteur(intervalleMs: number): (maintenantMs: number) => boolean {
  let dernier = -Infinity;
  return (maintenantMs) => {
    if (maintenantMs - dernier < intervalleMs) return false;
    dernier = maintenantMs;
    return true;
  };
}
