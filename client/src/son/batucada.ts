/**
 * Batucada : un groupe de percussions qui défile dans le cortège, comme dans beaucoup de
 * manifs. Rythmes génériques écrits ici (marquage des surdos sur les temps, caisse claire
 * en doubles croches, cloches, hochet), sans reprendre aucun morceau (ADR 0008) : les
 * motifs varient d'une mesure à l'autre, avec des relances avant chaque nouvelle
 * section et, de temps en temps, un « break » où seul l'appel du repique reste.
 *
 * Fonction pure et déterministe à graine (même graine, même mesure) : le moteur Web
 * Audio (`moteur.ts`) joue les frappes, les tests les vérifient sans AudioContext.
 *
 * Le temps est compté en **temps** (noires) : le moteur décide de leur durée (tempo
 * libre pendant la marche, calé sur l'animation pendant la danse finale).
 */
import { aleaDepuis, combinerGraines } from './alea';

/** Surdos (grave, plus grave), caisse claire, repique (aigu), agogô (deux cloches), ganzá (hochet). */
export type Instrument = 'surdo1' | 'surdo2' | 'caixa' | 'repique' | 'agogo' | 'ganza';

export interface Frappe {
  /** Position dans la mesure, en temps (0 à 4, par doubles croches : 0, 0,25…). */
  temps: number;
  instrument: Instrument;
  /** Force, de 0 à 1. */
  force: number;
  /** Variante de timbre : surdo étouffé, cloche aiguë ou grave. */
  variante?: 'etouffe' | 'aigu' | 'grave';
}

export type GenreMesure = 'groove' | 'relance' | 'break' | 'reprise';

export interface MesureBatucada {
  genre: GenreMesure;
  frappes: Frappe[];
}

/** Une mesure = 4 temps = 16 doubles croches. */
export const TEMPS_PAR_MESURE = 4;
const DOUBLES = 16;
/** Une section dure 8 mesures ; sa dernière est une relance (montée de caisse claire, surdos). */
export const MESURES_PAR_SECTION = 8;
/** Tempo de marche (noires par minute) : un pas tranquille de cortège. */
export const TEMPO_MARCHE = 100;

/** Accents de caisse claire (doubles croches 0 à 15), plusieurs motifs génériques. */
const ACCENTS_CAIXA: readonly (readonly number[])[] = [
  [0, 3, 6, 10, 12],
  [2, 6, 10, 14],
  [0, 4, 7, 10, 13],
  [3, 6, 8, 11, 14],
];
/** Cloches de l'agogô : [double croche, aiguë ?]. */
const MOTIFS_AGOGO: readonly (readonly (readonly [number, boolean])[])[] = [
  [
    [0, true],
    [2, true],
    [3, false],
    [6, true],
    [8, true],
    [11, false],
    [14, true],
  ],
  [
    [0, false],
    [3, true],
    [6, true],
    [8, false],
    [10, true],
    [12, true],
  ],
];
/** Coups du repique dans le groove (léger, en contrepoint). */
const MOTIFS_REPIQUE: readonly (readonly number[])[] = [
  [2, 5, 7, 10, 13, 15],
  [3, 6, 11, 14],
  [1, 4, 9, 12, 15],
];
/** Appel du repique pendant un break : quatre coups forts, puis le groupe repart. */
const APPEL: readonly number[] = [0, 3, 6, 8, 10, 12];

const d = (double: number) => double / 4;

export interface Batucada {
  /** Frappes de la mesure `n` (entier ≥ 0), triées ; vide hors limites. */
  mesure(n: number): MesureBatucada;
}

/**
 * Batucada déterministe : la graine fixe les motifs de chaque section et la place des
 * breaks. `breaks` : faux pour un groupe qui ne s'arrête jamais (aucun silence).
 */
export function creerBatucada(graine: number, { breaks = true }: { breaks?: boolean } = {}): Batucada {
  const section = (s: number) => {
    const alea = aleaDepuis(combinerGraines(graine, 7000 + s));
    return {
      accents: ACCENTS_CAIXA[Math.floor(alea() * ACCENTS_CAIXA.length)]!,
      agogo: alea() < 0.75 ? MOTIFS_AGOGO[Math.floor(alea() * MOTIFS_AGOGO.length)]! : null,
      repique: MOTIFS_REPIQUE[Math.floor(alea() * MOTIFS_REPIQUE.length)]!,
      // Une section sur trois environ se termine par un break plutôt qu'une relance.
      finitParUnBreak: breaks && s > 0 && alea() < 0.35,
    };
  };

  return {
    mesure(n) {
      if (!Number.isInteger(n) || n < 0) return { genre: 'groove', frappes: [] };
      const s = Math.floor(n / MESURES_PAR_SECTION);
      const rang = n % MESURES_PAR_SECTION;
      const sec = section(s);
      const precedente = s > 0 ? section(s - 1) : null;
      const alea = aleaDepuis(combinerGraines(graine, 100_000 + n));
      const frappes: Frappe[] = [];
      const ajouter = (double: number, instrument: Instrument, force: number, variante?: Frappe['variante']) => {
        const frappe: Frappe = { temps: d(double), instrument, force: Math.min(1, Math.max(0.05, force)) };
        if (variante) frappe.variante = variante;
        frappes.push(frappe);
      };
      const humain = () => 0.92 + 0.16 * alea();

      let genre: GenreMesure = 'groove';
      if (rang === MESURES_PAR_SECTION - 1) genre = sec.finitParUnBreak ? 'break' : 'relance';
      else if (rang === 0 && precedente?.finitParUnBreak) genre = 'reprise';

      if (genre === 'break') {
        // Tout le monde s'arrête ; le repique appelle, les surdos répondent sur le dernier temps.
        for (const double of APPEL) ajouter(double, 'repique', 0.95 * humain());
        ajouter(14, 'surdo1', 0.9);
        ajouter(14, 'surdo2', 0.9);
        return { genre, frappes: trier(frappes) };
      }

      // Surdos : le marquage (étouffé, puis ouvert, en alternance grave / plus grave).
      ajouter(0, 'surdo2', 0.45 * humain(), 'etouffe');
      ajouter(4, 'surdo1', 0.95 * humain());
      ajouter(8, 'surdo2', 0.8 * humain());
      ajouter(12, 'surdo1', 0.95 * humain());
      if (genre === 'reprise' || alea() < 0.3) ajouter(14, 'surdo2', 0.5 * humain());
      if (genre === 'relance') {
        ajouter(10, 'surdo1', 0.85);
        ajouter(14, 'surdo1', 0.9);
        ajouter(15, 'surdo2', 0.9);
      }

      // Caisse claire : doubles croches continues, accents du motif ; en relance, crescendo.
      for (let i = 0; i < DOUBLES; i++) {
        const accent = sec.accents.includes(i);
        let force = accent ? 0.85 : 0.32 + 0.1 * alea();
        if (genre === 'relance') force = 0.4 + (0.6 * i) / (DOUBLES - 1);
        ajouter(i, 'caixa', force * humain());
      }

      // Repique : contrepoint léger ; il marque la reprise d'un coup fort.
      if (genre === 'reprise') ajouter(0, 'repique', 1);
      for (const i of sec.repique) ajouter(i, 'repique', 0.45 * humain());

      // Agogô : deux cloches, selon la section (certaines sections s'en passent).
      if (sec.agogo && genre !== 'relance') {
        for (const [i, aigu] of sec.agogo) ajouter(i, 'agogo', 0.6 * humain(), aigu ? 'aigu' : 'grave');
      }

      // Ganzá : hochet en doubles croches, appuyé sur la deuxième de chaque temps.
      for (let i = 0; i < DOUBLES; i++) ajouter(i, 'ganza', (i % 4 === 2 ? 0.7 : i % 2 === 1 ? 0.35 : 0.45) * humain());

      return { genre, frappes: trier(frappes) };
    },
  };
}

const trier = (frappes: Frappe[]) => frappes.sort((a, b) => a.temps - b.temps);

/**
 * Léger décalage d'une double croche (en temps) : les deuxième et quatrième doubles de
 * chaque temps traînent un peu, comme jouées à la main (balancement de la samba).
 */
export function balancementDouble(temps: number): number {
  const double = Math.round(temps * 4) % 4;
  return double === 1 || double === 3 ? 0.03 : 0;
}

/**
 * Présence du groupe de percussions pendant la marche, de 0 (hors de portée) à 1 (tout
 * près), selon le temps (s) : il remonte le cortège, passe à côté, s'éloigne, puis se
 * tait un moment. Cycle de 3 à 4 minutes, déterministe à graine.
 */
export function presenceBatucada(tempsS: number, graine: number): number {
  const cycle = 180 + (combinerGraines(graine, 1) % 60);
  const decalage = combinerGraines(graine, 2) % cycle;
  const u = (((tempsS + decalage) % cycle) + cycle) % cycle;
  // Approche (60 s), passage (50 s), éloignement (60 s), puis silence (reste du cycle).
  if (u < 60) return lisse(u / 60);
  if (u < 110) return 1;
  if (u < 170) return 1 - lisse((u - 110) / 60);
  return 0;
}

/** Courbe en S de 0 à 1 (smoothstep). */
const lisse = (x: number) => x * x * (3 - 2 * x);
