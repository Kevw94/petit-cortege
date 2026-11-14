/**
 * Chants : courtes séquences rythmiques **sans paroles** (ADR 0003, ADR 0008), jouées
 * seulement sur l'appareil du soutien (rien n'est envoyé, aucun temps réel).
 *
 * Un chant est un appel-réponse : une mesure d'introduction au tambour, puis quatre
 * mesures où un chœur synthétique lance un appel (voyelle « hé ») et répond (voyelle
 * « ho »), sur un tambour et des claquements de mains. Les rythmes sont génériques
 * (croches et noires régulières), écrits pour ce jeu : ils ne reprennent aucun slogan
 * ni chant de manif existant. Quatre motifs tournent d'un chant à l'autre.
 *
 * Fonction pure : le moteur Web Audio joue les événements, l'interface fait pulser le
 * slogan de sa pancarte sur les `pulsations`.
 */

export const TEMPO_CHANT = 120;
export const CROCHE_CHANT_S = 60 / TEMPO_CHANT / 2;
/** Une mesure = 8 croches (4 temps). */
export const MESURE_CHANT_S = 8 * CROCHE_CHANT_S;

/** Voyelles du chœur : des formants, jamais des mots. */
export type Voyelle = 'he' | 'ho';

export interface Syllabe {
  /** Position dans la mesure, en croches (0 à 7). */
  croche: number;
  /** Durée, en croches. */
  duree: number;
  /** Degré relatif à la note de base du chant (en demi-tons). */
  degre: number;
}

export interface MotifChant {
  nom: string;
  appel: readonly Syllabe[];
  reponse: readonly Syllabe[];
  /** Croches où claquent les mains, à chaque mesure. */
  mains: readonly number[];
  /** Croches du tambour, à chaque mesure. */
  tambour: readonly number[];
}

const s = (croche: number, duree = 1, degre = 0): Syllabe => ({ croche, duree, degre });

/** Quatre motifs génériques, en rotation. */
export const MOTIFS_CHANT: readonly MotifChant[] = [
  {
    nom: 'trois appuis',
    appel: [s(0), s(2), s(4, 3, 2)],
    reponse: [s(0), s(2), s(4, 3, -3)],
    mains: [2, 6],
    tambour: [0, 4],
  },
  {
    nom: 'galop',
    appel: [s(0), s(1), s(2, 2, 2)],
    reponse: [s(0, 2), s(4, 3, -5)],
    mains: [2, 3, 6],
    tambour: [0, 3, 4],
  },
  {
    nom: 'décalé',
    appel: [s(0, 2), s(3, 2, 2), s(6, 2)],
    reponse: [s(0, 2, -3), s(3, 2), s(6, 2, -5)],
    mains: [2, 6, 7],
    tambour: [0, 3, 6],
  },
  {
    nom: 'cascade',
    appel: [s(0), s(2), s(3), s(4, 2, 4)],
    reponse: [s(0), s(2), s(4, 3, -1)],
    mains: [1, 3, 5, 7],
    tambour: [0, 2, 4, 6],
  },
];

/** Notes de base possibles (MIDI) : registre médium, confortable pour un chœur. */
const BASES = [55, 57, 58, 60] as const;

export type EvenementChant =
  | { t: number; type: 'tambour'; force: number }
  | { t: number; type: 'mains'; force: number }
  | { t: number; type: 'voix'; voyelle: Voyelle; note: number; duree: number; force: number };

export interface Pulsation {
  t: number;
  /** Temps fort (début de phrase) : pulsation plus marquée. */
  fort: boolean;
}

export interface ProgrammeChant {
  motif: MotifChant;
  /** Durée totale, en secondes (fin de la dernière note comprise). */
  duree: number;
  /** Événements triés par instant (secondes depuis le début du chant). */
  evenements: EvenementChant[];
  /** Instants où le slogan affiché pulse (coups d'intro puis chaque syllabe). */
  pulsations: Pulsation[];
}

/** Mesures après l'introduction : appel, réponse, appel, réponse. */
const MESURES_CHANTEES = 4;

/** Programme du `numero`-ième chant lancé sur l'appareil (motifs en rotation). */
export function programmeChant(numero: number): ProgrammeChant {
  const n = Math.max(0, Math.floor(numero));
  const motif = MOTIFS_CHANT[n % MOTIFS_CHANT.length]!;
  const base = BASES[Math.floor(n / MOTIFS_CHANT.length) % BASES.length]!;
  const evenements: EvenementChant[] = [];
  const pulsations: Pulsation[] = [];
  const instant = (mesure: number, croche: number) => mesure * MESURE_CHANT_S + croche * CROCHE_CHANT_S;

  // Introduction : quatre coups de tambour qui montent.
  for (let temps = 0; temps < 4; temps++) {
    const t = instant(0, temps * 2);
    evenements.push({ t, type: 'tambour', force: 0.55 + temps * 0.12 });
    pulsations.push({ t, fort: false });
  }
  let fin = MESURE_CHANT_S;
  for (let m = 1; m <= MESURES_CHANTEES; m++) {
    const appel = m % 2 === 1;
    const derniere = m === MESURES_CHANTEES;
    for (const c of motif.tambour) evenements.push({ t: instant(m, c), type: 'tambour', force: c === 0 ? 0.9 : 0.6 });
    if (derniere) evenements.push({ t: instant(m, 7), type: 'tambour', force: 0.8 });
    for (const c of motif.mains) evenements.push({ t: instant(m, c), type: 'mains', force: 0.7 });
    (appel ? motif.appel : motif.reponse).forEach((syllabe, i) => {
      const t = instant(m, syllabe.croche);
      const duree = syllabe.duree * CROCHE_CHANT_S * 0.9;
      evenements.push({
        t,
        type: 'voix',
        voyelle: appel ? 'he' : 'ho',
        note: base + syllabe.degre,
        duree,
        force: i === 0 ? 1 : 0.8,
      });
      pulsations.push({ t, fort: i === 0 });
      fin = Math.max(fin, t + duree);
    });
    fin = Math.max(fin, instant(m + 1, 0));
  }
  evenements.sort((a, b) => a.t - b.t);
  return { motif, duree: fin, evenements, pulsations };
}
