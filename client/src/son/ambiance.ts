/**
 * Ambiance de manif : réglages du brouhaha, des pas, des percussions lointaines et des
 * événements (sifflet, applaudissements) selon le nombre de soutiens du cortège et sa
 * phase. Avant le départ, un murmure calme ; en marche, une foule plus dense. Fonction
 * pure, appliquée par le moteur Web Audio au plus une fois par seconde.
 */
import type { EtatManif } from '../cortege/cortege';
import { LOCUTEURS_MAX, type ReglagesVoix } from './brouhaha-voix';

export type PhaseAmbiance = 'avant' | 'marche' | 'danse' | 'fin';

/**
 * Phase de l'ambiance : avant le départ, en marche, pendant la danse finale (`danse` du
 * Cortège : tout le monde est sur la place), une fois terminée.
 */
export function phaseAmbiance(etat: EtatManif, departMs: number, maintenantMs: number, danse = false): PhaseAmbiance {
  if (etat === 'terminee') return 'fin';
  if (danse) return 'danse';
  return maintenantMs < departMs ? 'avant' : 'marche';
}

/**
 * Ce que font les pieds de la foule : on attend en piétinant, on marche (pas cadencés des
 * voisins), ou on saute en rythme (danse finale, calée sur l'animation).
 */
export type AllureFoule = 'arret' | 'marche' | 'danse';

export interface ReglagesAmbiance extends ReglagesVoix {
  allure: AllureFoule;
  /** Volume de la foule lointaine (rumeur de dizaines de voix, `foule-lointaine.ts`), de 0 à 1. */
  foule: number;
  /** Volume du brouhaha (bruit filtré), de 0 à 1. */
  brouhaha: number;
  /** Fréquence de coupure du filtre du brouhaha (Hz) : plus de monde, plus de brillance. */
  coupureHz: number;
  /** Pas (frottements discrets) par seconde. */
  pasParSeconde: number;
  /** Volume de la batucada, de 0 à 1 (0 : aucune). Pendant la marche, elle va et vient. */
  percussions: number;
  /** Événements (sifflet, applaudissements, clameur) par minute. */
  evenementsParMinute: number;
  /** Groupes qui scandent au loin (« hé / ho » sans paroles), par minute. */
  chantsLointainsParMinute: number;
  // `voix` (niveau, 0 à 1) et `locuteurs` (nombre, 0 à LOCUTEURS_MAX) : conversations
  // inintelligibles du fond sonore, voir `brouhaha-voix.ts`.
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
        allure: 'arret',
        chantsLointainsParMinute: 0.3 * f,
        foule: 0.25 + 0.45 * f,
        brouhaha: 0.18 + 0.32 * f,
        coupureHz: 600 + 500 * f,
        pasParSeconde: 0.3 + 0.9 * f,
        percussions: 0,
        evenementsParMinute: 0.5 + 1.5 * f,
        // Une ou deux voix lointaines avec peu de monde, jusqu'à cinq en foule dense.
        voix: 0.2 + 0.4 * f,
        locuteurs: Math.round(1 + 4 * f),
      };
    case 'marche':
      return {
        allure: 'marche',
        chantsLointainsParMinute: 0.4 + 1.2 * f,
        foule: 0.3 + 0.6 * f,
        brouhaha: 0.3 + 0.55 * f,
        coupureHz: 800 + 900 * f,
        pasParSeconde: 1.5 + 6.5 * f,
        percussions: 0.25 + 0.55 * f,
        evenementsParMinute: 2 + 5 * f,
        // Foule dense : un murmure continu de nombreuses voix (au plus LOCUTEURS_MAX).
        voix: 0.3 + 0.5 * f,
        locuteurs: Math.min(LOCUTEURS_MAX, Math.round(1 + (LOCUTEURS_MAX - 1) * f)),
      };
    case 'danse':
      // Tout le cortège sur la place : la batucada joue tout près, la foule saute, tape
      // dans ses mains et crie ; on parle moins.
      return {
        allure: 'danse',
        chantsLointainsParMinute: 0,
        foule: 0.35 + 0.55 * f,
        brouhaha: 0.35 + 0.5 * f,
        coupureHz: 900 + 900 * f,
        pasParSeconde: 0,
        percussions: 0.75 + 0.25 * f,
        evenementsParMinute: 3 + 5 * f,
        voix: 0.25 + 0.3 * f,
        locuteurs: Math.min(LOCUTEURS_MAX, Math.round(1 + 4 * f)),
      };
    case 'fin':
      return {
        allure: 'arret',
        chantsLointainsParMinute: 0,
        foule: 0.15,
        brouhaha: 0.12,
        coupureHz: 600,
        pasParSeconde: 0,
        percussions: 0,
        evenementsParMinute: 0.5,
        voix: 0.1,
        locuteurs: 1,
      };
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
