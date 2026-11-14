/**
 * Musique d'accueil : composition originale générée par règles, mesure par mesure, à
 * partir d'une graine. Aucune mélodie existante n'est reprise : des accords tenus
 * (nappe + basse) qui s'enchaînent selon une chaîne de Markov, et un arpège en marche
 * aléatoire sur la gamme pentatonique de do (do ré mi sol la), plus ou moins dense
 * selon la phrase. Lent et doux (66 à la noire), sans fin : chaque mesure est tirée,
 * donc pas de boucle audible.
 *
 * Fonction pure (données seulement) : le moteur Web Audio (`moteur.ts`) joue les
 * événements, les tests les vérifient sans AudioContext.
 */
import { aleaDepuis, choisirPondere, combinerGraines } from './alea';

export const TEMPO_ACCUEIL = 66;
/** Durée d'une noire et d'une mesure (4 temps), en secondes. */
export const NOIRE_ACCUEIL_S = 60 / TEMPO_ACCUEIL;
export const MESURE_ACCUEIL_S = 4 * NOIRE_ACCUEIL_S;
const CROCHE_S = NOIRE_ACCUEIL_S / 2;
/** Un accord dure deux mesures. */
export const MESURES_PAR_ACCORD = 2;
/** Une phrase dure huit mesures ; sa dernière est une respiration (arpège clairsemé). */
export const MESURES_PAR_PHRASE = 8;

export type VoixAccueil = 'nappe' | 'basse' | 'arpege';

export interface NoteAccueil {
  /** Début, en secondes depuis le début de la mesure. */
  debut: number;
  /** Durée, en secondes (peut dépasser la mesure : notes tenues). */
  duree: number;
  /** Hauteur, en note MIDI. */
  note: number;
  voix: VoixAccueil;
  /** Force, de 0 à 1. */
  velocite: number;
}

type NomAccord = 'I' | 'ii' | 'IV' | 'V' | 'vi';

interface Accord {
  basse: number;
  nappe: readonly number[];
}

const ACCORDS: Record<NomAccord, Accord> = {
  I: { basse: 36, nappe: [55, 60, 62, 64] }, // do (sol do ré mi)
  ii: { basse: 38, nappe: [57, 60, 62, 65] }, // ré mineur 7
  IV: { basse: 41, nappe: [53, 57, 60, 64] }, // fa majeur 7
  V: { basse: 43, nappe: [55, 59, 62, 64] }, // sol 6
  vi: { basse: 45, nappe: [57, 60, 64, 67] }, // la mineur 7
};

/** Enchaînements possibles et leurs poids (jamais deux fois le même accord). */
const SUITES: Record<NomAccord, readonly (readonly [NomAccord, number])[]> = {
  I: [['vi', 3], ['IV', 3.5], ['ii', 1.5], ['V', 2]],
  ii: [['V', 5], ['IV', 3], ['vi', 2]],
  IV: [['I', 3.5], ['V', 2.5], ['vi', 2.5], ['ii', 1.5]],
  V: [['I', 5], ['vi', 3.5], ['IV', 1.5]],
  vi: [['IV', 4], ['ii', 2.5], ['I', 2], ['V', 1.5]],
};

/** Gamme pentatonique de do, sur deux octaves (do4 à la5) : hauteurs de l'arpège. */
export const PENTATONIQUE: readonly number[] = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
/** Classes de hauteur de la pentatonique (do, ré, mi, sol, la). */
export const CLASSES_PENTATONIQUES: readonly number[] = [0, 2, 4, 7, 9];

/** Densité de l'arpège (probabilité d'une note par croche) selon la phrase, en rotation. */
const DENSITES_PHRASE = [0.32, 0.5, 0.42, 0.26, 0.46, 0.36];

export interface PartitionAccueil {
  graine: number;
  /** Notes de la mesure `n` (n ≥ 0), toujours les mêmes pour une graine donnée. */
  mesure(n: number): NoteAccueil[];
  /** Nom de l'accord joué pendant la mesure `n`. */
  accord(n: number): NomAccord;
}

export function creerPartitionAccueil(graine: number): PartitionAccueil {
  const progression: NomAccord[] = ['I'];
  const accordDuBloc = (bloc: number): NomAccord => {
    while (progression.length <= bloc) {
      const alea = aleaDepuis(combinerGraines(graine, 1_000_000 + progression.length));
      progression.push(choisirPondere(alea, SUITES[progression[progression.length - 1]!]));
    }
    return progression[bloc]!;
  };
  /** Position de départ de l'arpège dans la gamme, à chaque mesure (marche continue). */
  const positions: number[] = [];
  const positionDepart = (n: number): number => {
    while (positions.length <= n) {
      const k = positions.length;
      if (k === 0) positions.push(4);
      else positions.push(arpege(k - 1).fin);
    }
    return positions[n]!;
  };

  const arpege = (n: number): { notes: NoteAccueil[]; fin: number } => {
    const alea = aleaDepuis(combinerGraines(graine, n));
    const accord = ACCORDS[accordDuBloc(Math.floor(n / MESURES_PAR_ACCORD))];
    const phrase = Math.floor(n / MESURES_PAR_PHRASE);
    let densite = DENSITES_PHRASE[phrase % DENSITES_PHRASE.length]!;
    if (n % MESURES_PAR_PHRASE === MESURES_PAR_PHRASE - 1) densite *= 0.4; // respiration
    if (n < 2) densite *= 0.4; // entrée en douceur
    let position = n === 0 ? 4 : positionDepart(n);
    const notes: NoteAccueil[] = [];
    let croche = 0;
    while (croche < 8) {
      const premierTemps = croche === 0;
      if (alea() < (premierTemps ? densite + 0.2 : densite)) {
        // Sur le premier temps, on glisse vers une note de l'accord quand c'est possible.
        if (premierTemps) position = noteDAccordProche(position, accord);
        const longueur = choisirPondere(alea, [
          [1, 4],
          [2, 3],
          [3, 1],
        ] as const);
        notes.push({
          debut: croche * CROCHE_S,
          duree: Math.min(longueur, 8 - croche) * CROCHE_S * 1.6, // légère tenue, comme une harpe
          note: PENTATONIQUE[position]!,
          voix: 'arpege',
          velocite: (croche % 4 === 0 ? 0.42 : 0.3) + alea() * 0.12,
        });
        croche += longueur;
        // Marche aléatoire : surtout des pas conjoints, rarement un saut.
        const pas = choisirPondere(alea, [
          [-2, 1],
          [-1, 4],
          [1, 4],
          [2, 1.2],
          [3, 0.4],
        ] as const);
        position = rebondir(position + pas);
      } else croche += 1;
    }
    return { notes, fin: position };
  };

  return {
    graine,
    accord: (n) => accordDuBloc(Math.floor(n / MESURES_PAR_ACCORD)),
    mesure(n) {
      if (!Number.isInteger(n) || n < 0) return [];
      const notes: NoteAccueil[] = [];
      if (n % MESURES_PAR_ACCORD === 0) {
        const accord = ACCORDS[accordDuBloc(n / MESURES_PAR_ACCORD)];
        const tenue = MESURES_PAR_ACCORD * MESURE_ACCUEIL_S;
        for (const note of accord.nappe) notes.push({ debut: 0, duree: tenue, note, voix: 'nappe', velocite: 0.5 });
        notes.push({ debut: 0, duree: tenue * 0.95, note: accord.basse, voix: 'basse', velocite: 0.55 });
      }
      notes.push(...arpege(n).notes);
      return notes;
    },
  };
}

/** Garde la position dans la gamme : rebondit sur les bords au lieu de sortir. */
function rebondir(position: number): number {
  const max = PENTATONIQUE.length - 1;
  if (position < 0) return -position;
  if (position > max) return 2 * max - position;
  return position;
}

/** Position de la gamme la plus proche dont la note appartient à l'accord (sinon, inchangée). */
function noteDAccordProche(position: number, accord: Accord): number {
  const classes = new Set(accord.nappe.map((n) => n % 12));
  for (const ecart of [0, 1, -1, 2, -2]) {
    const p = position + ecart;
    if (p >= 0 && p < PENTATONIQUE.length && classes.has(PENTATONIQUE[p]! % 12)) return p;
  }
  return position;
}
