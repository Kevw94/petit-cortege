/**
 * Brouhaha de voix : des « gens qui parlent » autour de soi, **inintelligibles par
 * construction** (ADR 0003, ADR 0008). Aucun mot, aucune syllabe d'une langue, aucun
 * slogan : chaque « locuteur » enchaîne des syllabes tirées au hasard (durée, hauteur,
 * voyelles qui glissent d'une cible à l'autre), regroupées en phrases de 1 à 3 s
 * séparées de silences. Rien ne répète un motif : pas de rythme scandé, pas de note tenue.
 *
 * Module pur et déterministe à graine (même graine, mêmes phrases) : le moteur Web
 * Audio (`moteur-voix.ts`) ne fait que jouer ces données. Aucune voix enregistrée,
 * aucun échantillon, jamais de synthèse vocale du navigateur.
 */
import { aleaDepuis, combinerGraines, type Alea } from './alea';

/** Nombre maximal de locuteurs simultanés (coût borné sur téléphone modeste). */
export const LOCUTEURS_MAX = 8;

/** Bornes (secondes) de la structure : syllabes, phrases, silences entre phrases. */
export const SYLLABE_MIN_S = 0.08;
export const SYLLABE_MAX_S = 0.25;
export const PHRASE_MIN_S = 1;
export const PHRASE_MAX_S = 3;
export const SILENCE_MIN_S = 0.3;
export const SILENCE_MAX_S = 4;
/** Espace maximal entre deux syllabes d'une même phrase. */
export const ESPACE_MAX_S = 0.04;

/** Bornes (Hz) de la hauteur de la voix et des trois formants, tous locuteurs confondus. */
export const F0_MIN_HZ = 70;
export const F0_MAX_HZ = 400;
export const FORMANT_MIN_HZ = [200, 600, 1800] as const;
export const FORMANT_MAX_HZ = [1000, 2800, 3500] as const;

/** Part des réglages d'ambiance qui concerne les voix (voir `ambiance.ts`). */
export interface ReglagesVoix {
  /** Niveau général des voix, de 0 à 1. */
  voix: number;
  /** Nombre de locuteurs audibles, entier de 0 à LOCUTEURS_MAX. */
  locuteurs: number;
}

export type Formants = readonly [number, number, number];

export interface ProfilLocuteur {
  /** Hauteur de base de la voix (Hz) : de grave à aiguë. */
  hauteurHz: number;
  /** Position stéréo, de -1 (gauche) à 1 (droite). */
  pan: number;
  /** Proximité : 0,45 (loin) à 1 (plus proche). */
  poids: number;
  /** Facteur sur la durée des syllabes (débit). */
  vitesse: number;
  /** Facteur sur les formants (conduit plus ou moins court). */
  conduit: number;
  /** Facteur sur les silences entre phrases (bavard ou réservé). */
  pause: number;
}

export interface ConsonneVoix {
  type: 'souffle' | 'occlusive';
  /** Durée (s), très brève. */
  duree: number;
  /** Centre du filtre du bruit (Hz). */
  hz: number;
  /** Niveau relatif, de 0 à 1. */
  niveau: number;
}

export interface SyllabeVoix {
  /** Début, en secondes depuis le début de la phrase. */
  debut: number;
  /** Durée (s) : SYLLABE_MIN_S à SYLLABE_MAX_S. */
  duree: number;
  /** Hauteur au début et à la fin de la syllabe (Hz). */
  f0: readonly [number, number];
  /** Formants (F1, F2, F3) au début et à la fin de la syllabe (Hz). */
  formants: readonly [Formants, Formants];
  /** Niveau relatif de la syllabe, de 0 à 1 (accents). */
  niveau: number;
  consonne: ConsonneVoix | null;
}

export interface PhraseVoix {
  /** Silence qui précède la phrase (s). */
  silenceAvant: number;
  syllabes: readonly SyllabeVoix[];
  /** De 0 à la fin de la dernière syllabe : PHRASE_MIN_S à PHRASE_MAX_S. */
  duree: number;
}

export interface Locuteur {
  profil: ProfilLocuteur;
  /** Phrase suivante de ce locuteur (déterministe, sans fin). */
  phraseSuivante(): PhraseVoix;
}

/**
 * Cibles vocaliques génériques (F1, F2, F3 en Hz) : des timbres de voyelles, tirés au
 * sort et enchaînés sans ordre, qui ne forment aucun mot.
 */
const VOYELLES: readonly Formants[] = [
  [750, 1200, 2500],
  [450, 2000, 2650],
  [300, 2300, 3000],
  [480, 850, 2500],
  [330, 800, 2400],
  [550, 1750, 2550],
  [500, 1500, 2500],
  [580, 950, 2550],
];

const entre = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const melange = (a: number, b: number, t: number) => a + (b - a) * t;
const partFractionnaire = (x: number) => x - Math.floor(x);
/** Tirage triangulaire dans [0, 1] : plus de chances au milieu. */
const triangulaire = (alea: Alea) => (alea() + alea()) / 2;

/**
 * Profil du locuteur `indice` : hauteurs, positions stéréo et proximités réparties par
 * suite à faible discrépance (nombre d'or) pour varier voix graves et aiguës, à gauche
 * comme à droite, quel que soit le nombre de locuteurs retenus.
 */
export function profilLocuteur(graine: number, indice: number): ProfilLocuteur {
  const alea = aleaDepuis(combinerGraines(graine, 1000 + indice));
  const phi = 0.6180339887;
  const rang = partFractionnaire(indice * phi + alea() * 0.25);
  const hauteurHz = Math.exp(melange(Math.log(90), Math.log(260), rang));
  const pan = (partFractionnaire(indice * 0.381966 + 0.17 + alea() * 0.1) * 2 - 1) * 0.85;
  return {
    hauteurHz,
    pan,
    poids: 0.45 + 0.55 * alea() ** 1.5,
    vitesse: 0.85 + 0.35 * alea(),
    // Voix aiguë : conduit plus court, formants un peu plus hauts.
    conduit: entre((hauteurHz / 150) ** 0.15 * (0.97 + 0.06 * alea()), 0.9, 1.15),
    pause: 0.7 + 0.8 * alea(),
  };
}

export function profilsLocuteurs(graine: number): ProfilLocuteur[] {
  return Array.from({ length: LOCUTEURS_MAX }, (_, i) => profilLocuteur(graine, i));
}

function formantsAleatoires(alea: Alea, profil: ProfilLocuteur): Formants {
  const base = VOYELLES[Math.floor(alea() * VOYELLES.length)]!;
  const f = (i: 0 | 1 | 2) =>
    entre(base[i] * profil.conduit * (0.92 + 0.16 * alea()), FORMANT_MIN_HZ[i], FORMANT_MAX_HZ[i]);
  return [f(0), f(1), f(2)];
}

/** Point de départ d'une syllabe : la fin de la précédente, légèrement dérivée. */
function derives(precedents: Formants, alea: Alea): Formants {
  const f = (i: 0 | 1 | 2) => entre(precedents[i] * (0.97 + 0.06 * alea()), FORMANT_MIN_HZ[i], FORMANT_MAX_HZ[i]);
  return [f(0), f(1), f(2)];
}

function consonneAleatoire(alea: Alea): ConsonneVoix | null {
  const r = alea();
  if (r < 0.4) return null;
  if (r < 0.7) {
    return { type: 'souffle', duree: 0.04 + 0.06 * alea(), hz: 2200 + 1300 * alea(), niveau: 0.15 + 0.25 * alea() };
  }
  return { type: 'occlusive', duree: 0.012 + 0.03 * alea(), hz: 700 + 1800 * alea(), niveau: 0.25 + 0.4 * alea() };
}

/** Locuteur déterministe : la graine et l'indice fixent son profil et toute la suite de ses phrases. */
export function creerLocuteur(graine: number, indice: number): Locuteur {
  const profil = profilLocuteur(graine, indice);
  const alea = aleaDepuis(combinerGraines(graine, 5000 + indice));
  let formantsPrecedents = formantsAleatoires(alea, profil);

  const phraseSuivante = (): PhraseVoix => {
    // Silence au poids lourd à droite : surtout de courtes pauses, parfois un long silence.
    const silenceAvant = entre((SILENCE_MIN_S + 2.5 * alea() ** 2) * profil.pause, SILENCE_MIN_S, SILENCE_MAX_S);
    // Cible de durée ; la dernière syllabe dépasse d'au plus SYLLABE_MAX_S + ESPACE_MAX_S.
    const cible = PHRASE_MIN_S + (PHRASE_MAX_S - PHRASE_MIN_S - SYLLABE_MAX_S - ESPACE_MAX_S) * triangulaire(alea);
    const debutF0 = profil.hauteurHz * (0.9 + 0.25 * alea());
    const declinaison = 0.14 + 0.16 * alea();
    const syllabes: SyllabeVoix[] = [];
    let t = 0;
    while (t < cible) {
      const duree = entre(
        (SYLLABE_MIN_S + (SYLLABE_MAX_S - SYLLABE_MIN_S) * triangulaire(alea)) * profil.vitesse,
        SYLLABE_MIN_S,
        SYLLABE_MAX_S,
      );
      const progression = Math.min(1, t / cible);
      // Contour : décroît sur la phrase ; accents irréguliers ; chute de plus en fin de phrase.
      let f0 = debutF0 * (1 - declinaison * progression) * (0.93 + 0.14 * alea());
      if (alea() < 0.22) f0 *= 1.05 + 0.08 * alea();
      const derniere = t + duree + ESPACE_MAX_S >= cible;
      const f0Fin = f0 * (derniere ? 0.78 + 0.07 * alea() : 0.95 + 0.09 * alea());
      const cibleFormants = formantsAleatoires(alea, profil);
      const depart = derives(formantsPrecedents, alea);
      syllabes.push({
        debut: t,
        duree,
        f0: [entre(f0, F0_MIN_HZ, F0_MAX_HZ), entre(f0Fin, F0_MIN_HZ, F0_MAX_HZ)],
        formants: [depart, cibleFormants],
        niveau: 0.45 + 0.55 * alea() ** 0.8,
        consonne: consonneAleatoire(alea),
      });
      formantsPrecedents = cibleFormants;
      t += duree + ESPACE_MAX_S * alea() ** 2;
    }
    const derniere = syllabes[syllabes.length - 1]!;
    return { silenceAvant, syllabes, duree: derniere.debut + derniere.duree };
  };

  return { profil, phraseSuivante };
}

/**
 * Gain de chaque locuteur selon les réglages : les locuteurs au-delà du nombre voulu
 * sont à 0 ; les autres partagent le niveau (÷ √n : une foule dense ne couvre pas
 * le reste, elle devient un murmure plus continu), les plus proches un peu plus fort.
 */
export function gainsLocuteurs(reglages: ReglagesVoix, profils: readonly ProfilLocuteur[]): number[] {
  const n = nombreLocuteurs(reglages);
  const niveau = entre(reglages.voix, 0, 1);
  return profils.map((p, i) => (i < n ? (niveau * p.poids) / Math.sqrt(n) : 0));
}

/** Nombre de locuteurs audibles, borné à 0..LOCUTEURS_MAX. */
export function nombreLocuteurs(reglages: ReglagesVoix): number {
  const n = Number.isFinite(reglages.locuteurs) ? Math.round(reglages.locuteurs) : 0;
  return entre(n, 0, LOCUTEURS_MAX);
}
