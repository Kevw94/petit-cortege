/**
 * Brouhaha de voix : des « gens qui parlent » autour de soi, **inintelligibles par
 * construction** (ADR 0003, ADR 0008). Aucun mot, aucune syllabe d'une langue, aucun
 * slogan : chaque « locuteur » enchaîne des syllabes tirées au hasard (consonne d'attaque,
 * voyelle qui glisse d'une cible à l'autre), sans jamais répéter un motif.
 *
 * Ce qui rend ces voix crédibles, c'est la **prosodie**, calquée sur celle du français
 * parlé sans en reprendre un seul mot :
 * - les syllabes se groupent en « groupes rythmiques » de 2 à 6, dont la dernière est
 *   allongée (accent final) et monte (continuation) quand la phrase continue ;
 * - la phrase descend en fin d'énoncé (affirmation), parfois remonte (question) ;
 * - des attaques variées : voyelle liée, consonne voisée (la voix continue, plus faible),
 *   consonne sourde (la voix s'arrête, un souffle ou une explosion de bruit) ;
 * - parfois une hésitation (« euh » tenu sur une voyelle neutre) ou un petit rire
 *   (« ha ha » aspirés qui descendent), seulement chez les locuteurs « expressifs ».
 *
 * Module pur et déterministe à graine (même graine, mêmes phrases) : le moteur Web
 * Audio (`moteur-voix.ts`) ne fait que jouer ces données. Aucune voix enregistrée,
 * aucun échantillon, jamais de synthèse vocale du navigateur.
 */
import { aleaDepuis, choisirPondere, combinerGraines, type Alea } from './alea';

/** Nombre maximal de locuteurs simultanés (coût borné sur téléphone modeste). */
export const LOCUTEURS_MAX = 8;
/** Les premiers locuteurs sont proches (voix nettes) ; les suivants, lointains (assourdis). */
export const LOCUTEURS_PROCHES = 3;

/** Bornes (secondes) de la structure : syllabes, phrases, silences entre phrases. */
export const SYLLABE_MIN_S = 0.07;
/** Une hésitation (« euh ») peut durer jusque-là ; une syllabe ordinaire allongée, ≈ 0,35 s. */
export const SYLLABE_MAX_S = 0.5;
export const PHRASE_MIN_S = 0.4;
export const PHRASE_MAX_S = 3.5;
export const SILENCE_MIN_S = 0.25;
export const SILENCE_MAX_S = 4;
/** Espace maximal entre deux syllabes d'une phrase (pause entre groupes, après un « euh »). */
export const ESPACE_MAX_S = 0.25;
/** Espace maximal entre deux syllabes d'un même groupe rythmique : la voix est liée. */
export const ESPACE_GROUPE_MAX_S = 0.03;
/** Pause maximale après un groupe rythmique, avant le suivant. */
const PAUSE_GROUPE_MAX_S = 0.12;
/** Durée maximale d'une syllabe finale allongée (hors hésitation). */
const FINALE_MAX_S = 0.38;

/** Bornes (Hz) de la hauteur de la voix et des trois formants, tous locuteurs confondus. */
export const F0_MIN_HZ = 55;
export const F0_MAX_HZ = 420;
export const FORMANT_MIN_HZ = [200, 600, 1700] as const;
export const FORMANT_MAX_HZ = [1000, 2800, 3500] as const;
/** F1 pendant une consonne voisée (constriction du conduit) : la voix « s'assourdit ». */
export const F1_CONSTRICTION_HZ = 280;

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
  /** Proximité : 0,45 (loin) à 1 (tout près). */
  poids: number;
  /** Proche (voix nette, peu de réverbération) ou lointain (assourdi, plus de réverbération). */
  plan: 'proche' | 'lointain';
  /** Facteur sur la durée des syllabes (débit). */
  vitesse: number;
  /** Facteur sur les formants (conduit plus ou moins court). */
  conduit: number;
  /** Facteur sur les silences entre phrases (bavard ou réservé). */
  pause: number;
  /** Part de souffle dans la voix, de 0 (voix pleine) à 1 (chuchotée) : 0,04 à 0,16. */
  souffle: number;
}

/** Comment commence une syllabe. */
export type Attaque = 'voyelle' | 'voisee' | 'sourde';

export interface ConsonneVoix {
  /**
   * `souffle` : friction (s, ch, f ; ou v, z, j sur une attaque voisée) ;
   * `occlusive` : explosion brève à la fin d'une tenue (p, t, k) ;
   * `aspiree` : souffle large qui précède la voyelle (le « h » d'un rire).
   */
  type: 'souffle' | 'occlusive' | 'aspiree';
  /** Durée du bruit (s), très brève. */
  duree: number;
  /** Centre du filtre du bruit (Hz). */
  hz: number;
  /** Niveau relatif, de 0 à 1. */
  niveau: number;
}

export interface SyllabeVoix {
  /** Début, en secondes depuis le début de la phrase. */
  debut: number;
  /** Durée (s) : SYLLABE_MIN_S à SYLLABE_MAX_S, consonne d'attaque comprise. */
  duree: number;
  attaque: Attaque;
  /** Durée de la consonne d'attaque (s), avant la voyelle ; 0 pour une attaque vocalique. */
  transition: number;
  /** Hauteur au début et à la fin de la voyelle (Hz). */
  f0: readonly [number, number];
  /** Formants (F1, F2, F3) au début et à la fin de la voyelle (Hz). */
  formants: readonly [Formants, Formants];
  /** Niveau relatif de la syllabe, de 0 à 1 (accents). */
  niveau: number;
  consonne: ConsonneVoix | null;
  /** Dernière syllabe de son groupe rythmique (allongée, contour final). */
  finDeGroupe: boolean;
}

/** `parole` affirme (finit en descendant), `question` remonte, `rire` est une suite de « ha » aspirés. */
export type GenrePhrase = 'parole' | 'question' | 'rire';

export interface PhraseVoix {
  genre: GenrePhrase;
  /** Commence par une hésitation (« euh » tenu sur une voyelle neutre). */
  hesitation: boolean;
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

export interface OptionsLocuteur {
  /**
   * Rires et hésitations (vrai par défaut). Faux pour une foule lointaine jouée en
   * boucle : un rire reconnaissable qui reviendrait au même endroit trahirait la boucle.
   */
  expressif?: boolean;
}

/**
 * Cibles vocaliques génériques (F1, F2, F3 en Hz), dont des voyelles arrondies et
 * antérieures qui donnent une couleur « française » : des timbres tirés au sort et
 * enchaînés sans ordre, qui ne forment aucun mot.
 */
const VOYELLES: readonly Formants[] = [
  [750, 1250, 2550],
  [450, 2000, 2650],
  [300, 2250, 3000],
  [480, 900, 2500],
  [330, 800, 2400],
  [580, 1750, 2550],
  [500, 1500, 2500],
  [600, 1000, 2550],
  [290, 1750, 2150],
  [400, 1500, 2300],
];
/** Voyelle neutre de l'hésitation (« euh ») et voyelle ouverte du rire. */
const VOYELLE_NEUTRE: Formants = [500, 1450, 2450];
const VOYELLE_RIRE: Formants = [720, 1250, 2500];

const entre = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
const melange = (a: number, b: number, t: number) => a + (b - a) * t;
const partFractionnaire = (x: number) => x - Math.floor(x);
/** Tirage triangulaire dans [0, 1] : plus de chances au milieu. */
const triangulaire = (alea: Alea) => (alea() + alea()) / 2;
const bornerF0 = (f: number) => entre(f, F0_MIN_HZ, F0_MAX_HZ);
const bornerFormants = (fs: readonly number[]): Formants => [
  entre(fs[0]!, FORMANT_MIN_HZ[0], FORMANT_MAX_HZ[0]),
  entre(fs[1]!, FORMANT_MIN_HZ[1], FORMANT_MAX_HZ[1]),
  entre(fs[2]!, FORMANT_MIN_HZ[2], FORMANT_MAX_HZ[2]),
];

/**
 * Profil du locuteur `indice` : hauteurs et positions stéréo réparties par suite à faible
 * discrépance (nombre d'or) pour varier voix graves et aiguës, à gauche comme à droite,
 * quel que soit le nombre de locuteurs retenus. Les premiers sont proches : quand la
 * foule grossit, les voix qui s'ajoutent viennent de plus loin.
 */
export function profilLocuteur(graine: number, indice: number): ProfilLocuteur {
  const alea = aleaDepuis(combinerGraines(graine, 1000 + indice));
  const phi = 0.6180339887;
  const rang = partFractionnaire(indice * phi + alea() * 0.25);
  const hauteurHz = Math.exp(melange(Math.log(95), Math.log(260), rang));
  const pan = (partFractionnaire(indice * 0.381966 + 0.17 + alea() * 0.1) * 2 - 1) * 0.85;
  const proche = indice < LOCUTEURS_PROCHES;
  return {
    hauteurHz,
    // Proches un peu moins écartés : on parle avec ses voisins, pas avec le bord de la rue.
    pan: proche ? pan * 0.7 : pan,
    poids: proche ? 0.85 + 0.15 * alea() : 0.45 + 0.25 * alea(),
    plan: proche ? 'proche' : 'lointain',
    vitesse: 0.85 + 0.35 * alea(),
    // Voix aiguë : conduit plus court, formants un peu plus hauts.
    conduit: entre((hauteurHz / 150) ** 0.15 * (0.97 + 0.06 * alea()), 0.9, 1.15),
    pause: 0.7 + 0.8 * alea(),
    souffle: 0.04 + 0.12 * alea() ** 1.5,
  };
}

export function profilsLocuteurs(graine: number): ProfilLocuteur[] {
  return Array.from({ length: LOCUTEURS_MAX }, (_, i) => profilLocuteur(graine, i));
}

function formantsAleatoires(alea: Alea, profil: ProfilLocuteur): Formants {
  const base = VOYELLES[Math.floor(alea() * VOYELLES.length)]!;
  return bornerFormants(base.map((f) => f * profil.conduit * (0.93 + 0.14 * alea())));
}

/** Point de départ d'une voyelle : la fin de la précédente, légèrement dérivée (coarticulation). */
function derives(precedents: Formants, cible: Formants, alea: Alea): Formants {
  // Le conduit part de la voyelle précédente et va déjà un peu vers la suivante.
  const t = 0.25 + 0.25 * alea();
  return bornerFormants(precedents.map((f, i) => melange(f, cible[i]!, t) * (0.97 + 0.06 * alea())));
}

interface Attaquee {
  attaque: Attaque;
  transition: number;
  consonne: ConsonneVoix | null;
}

/** Consonne d'attaque d'une syllabe : liée, voisée ou sourde, avec son bruit éventuel. */
function attaqueAleatoire(alea: Alea, duree: number): Attaquee {
  const attaque = choisirPondere<Attaque>(alea, [
    ['voyelle', 0.2],
    ['voisee', 0.38],
    ['sourde', 0.42],
  ]);
  // La consonne n'occupe jamais plus de 40 % de la syllabe : la voyelle reste audible.
  const plafond = duree * 0.4;
  if (attaque === 'voyelle') return { attaque, transition: 0, consonne: null };
  if (attaque === 'voisee') {
    const transition = Math.min(plafond, 0.03 + 0.03 * alea());
    // Un tiers des voisées frottent (v, z, j) : un souffle léger sous la voix.
    const consonne: ConsonneVoix | null =
      alea() < 0.33
        ? { type: 'souffle', duree: transition, hz: 2400 + 1800 * alea(), niveau: 0.12 + 0.1 * alea() }
        : null;
    return { attaque, transition, consonne };
  }
  if (alea() < 0.45) {
    const transition = Math.min(plafond, 0.045 + 0.045 * alea());
    return {
      attaque,
      transition,
      consonne: { type: 'souffle', duree: transition, hz: 2600 + 2400 * alea(), niveau: 0.25 + 0.3 * alea() },
    };
  }
  const transition = Math.min(plafond, 0.03 + 0.03 * alea());
  return {
    attaque,
    transition,
    consonne: {
      type: 'occlusive',
      duree: 0.012 + 0.015 * alea(),
      hz: 700 + 2300 * alea(),
      niveau: 0.35 + 0.4 * alea(),
    },
  };
}

/**
 * Locuteur déterministe : la graine et l'indice fixent son profil et toute la suite de
 * ses phrases.
 */
export function creerLocuteur(graine: number, indice: number, options: OptionsLocuteur = {}): Locuteur {
  const expressif = options.expressif ?? true;
  const profil = profilLocuteur(graine, indice);
  const alea = aleaDepuis(combinerGraines(graine, 5000 + indice));
  let formantsPrecedents = formantsAleatoires(alea, profil);

  const silenceAvant = () =>
    // Poids lourd à droite : surtout de courtes pauses, parfois un long silence.
    entre((SILENCE_MIN_S + 2.5 * alea() ** 2) * profil.pause, SILENCE_MIN_S, SILENCE_MAX_S);

  /** Un petit rire : 3 à 7 « ha » aspirés, aigus, qui descendent et s'éteignent (≈ 5 par seconde). */
  const rire = (): PhraseVoix => {
    const n = 3 + Math.floor(alea() * 5);
    const syllabes: SyllabeVoix[] = [];
    const voyelle = bornerFormants(VOYELLE_RIRE.map((f) => f * profil.conduit * (0.95 + 0.1 * alea())));
    let f0 = profil.hauteurHz * (1.45 + 0.35 * alea());
    let t = 0;
    for (let i = 0; i < n; i++) {
      const duree = 0.1 + 0.04 * alea();
      const fin = f0 * (0.9 + 0.05 * alea());
      const souffle = 0.025 + 0.015 * alea();
      syllabes.push({
        debut: t,
        duree,
        attaque: 'sourde',
        transition: souffle,
        f0: [bornerF0(f0), bornerF0(fin)],
        formants: [voyelle, voyelle],
        niveau: entre(0.95 - (0.45 * i) / n, 0, 1) * (0.85 + 0.15 * alea()),
        consonne: { type: 'aspiree', duree: souffle, hz: 1100 + 700 * alea(), niveau: 0.55 + 0.25 * alea() },
        finDeGroupe: i === n - 1,
      });
      t += duree + 0.07 + 0.03 * alea();
      f0 *= 0.92 + 0.04 * alea();
    }
    const derniere = syllabes[syllabes.length - 1]!;
    return {
      genre: 'rire',
      hesitation: false,
      silenceAvant: silenceAvant(),
      syllabes,
      duree: derniere.debut + derniere.duree,
    };
  };

  const phraseSuivante = (): PhraseVoix => {
    if (expressif && alea() < 0.035) return rire();
    const genre: GenrePhrase = alea() < 0.14 ? 'question' : 'parole';
    const hesitation = expressif && alea() < 0.07;
    // Registre de la phrase ; la déclinaison fait descendre les groupes successifs.
    const base = profil.hauteurHz * (0.92 + 0.2 * alea());
    const declinaison = 0.08 + 0.1 * alea();
    const syllabes: SyllabeVoix[] = [];
    let t = 0;
    if (hesitation) {
      const duree = 0.28 + 0.2 * alea();
      const neutre = bornerFormants(VOYELLE_NEUTRE.map((f) => f * profil.conduit));
      const f0 = base * 0.9;
      syllabes.push({
        debut: 0,
        duree,
        attaque: 'voyelle',
        transition: 0,
        f0: [bornerF0(f0), bornerF0(f0 * 0.97)],
        formants: [neutre, neutre],
        niveau: 0.5 + 0.1 * alea(),
        consonne: null,
        finDeGroupe: true,
      });
      formantsPrecedents = neutre;
      t = duree + 0.08 + 0.12 * alea();
    }
    // Plan des groupes rythmiques (taille, débit), borné pour que la phrase ne dépasse
    // jamais PHRASE_MAX_S même au pire : le dernier groupe retenu porte le contour final.
    const voulus = choisirPondere(alea, [
      [1, 0.35],
      [2, 0.45],
      [3, 0.2],
    ]);
    const plan: { n: number; debitS: number }[] = [];
    let auPire = t;
    for (let g = 0; g < voulus; g++) {
      const n = choisirPondere(alea, [
        [2, 0.15],
        [3, 0.3],
        [4, 0.3],
        [5, 0.17],
        [6, 0.08],
      ]);
      const debitS = 0.11 + 0.06 * alea();
      const ordinaireMax = (debitS + 0.035) * profil.vitesse;
      const dureeMax = (n - 1) * (ordinaireMax + ESPACE_GROUPE_MAX_S) + FINALE_MAX_S + PAUSE_GROUPE_MAX_S;
      if (g > 0 && auPire + dureeMax > PHRASE_MAX_S) break;
      plan.push({ n, debitS });
      auPire += dureeMax;
    }
    const etalement = Math.max(1, plan.length - 1);
    plan.forEach(({ n, debitS }, g) => {
      const dernierGroupe = g === plan.length - 1;
      const niveauGroupe = base * (1 - (declinaison * g) / etalement);
      const accentInitial = alea() < 0.3;
      for (let i = 0; i < n; i++) {
        const finale = i === n - 1;
        // Syllabe ordinaire ; la finale du groupe est allongée (accent final du français).
        const ordinaire = (debitS + 0.07 * (triangulaire(alea) - 0.5)) * profil.vitesse;
        const duree = entre(finale ? ordinaire * (1.4 + 0.4 * alea()) : ordinaire, SYLLABE_MIN_S, FINALE_MAX_S);
        const { attaque, transition, consonne } = attaqueAleatoire(alea, duree);
        let f0Debut = niveauGroupe * (0.96 + 0.08 * alea());
        if (i === 0 && accentInitial) f0Debut *= 1.08 + 0.08 * alea();
        let f0Fin = f0Debut * (0.97 + 0.05 * alea());
        if (finale && !dernierGroupe)
          f0Fin = f0Debut * (1.15 + 0.2 * alea()); // continuation
        else if (finale && genre === 'question') f0Fin = f0Debut * (1.25 + 0.2 * alea());
        else if (finale) f0Fin = f0Debut * (0.72 + 0.12 * alea()); // affirmation : la voix tombe
        const cible = formantsAleatoires(alea, profil);
        syllabes.push({
          debut: t,
          duree,
          attaque,
          transition,
          f0: [bornerF0(f0Debut), bornerF0(f0Fin)],
          formants: [derives(formantsPrecedents, cible, alea), cible],
          // Les finales portent l'accent ; quelques syllabes ressortent au hasard.
          niveau: entre((finale ? 0.75 : 0.5) + 0.35 * alea() ** 1.5, 0, 1),
          consonne,
          finDeGroupe: finale,
        });
        formantsPrecedents = cible;
        t += duree + (finale ? 0.03 + (PAUSE_GROUPE_MAX_S - 0.03) * alea() ** 2 : ESPACE_GROUPE_MAX_S * alea() ** 3);
      }
    });
    const derniere = syllabes[syllabes.length - 1]!;
    let duree = derniere.debut + derniere.duree;
    // Phrase trop courte (un seul petit groupe) : on allonge la dernière syllabe.
    if (duree < PHRASE_MIN_S) {
      const allongee = { ...derniere, duree: derniere.duree + (PHRASE_MIN_S - duree) };
      syllabes[syllabes.length - 1] = allongee;
      duree = allongee.debut + allongee.duree;
    }
    return { genre, hesitation, silenceAvant: silenceAvant(), syllabes, duree };
  };

  return { profil, phraseSuivante };
}

/**
 * Gain de chaque locuteur selon les réglages : les locuteurs au-delà du nombre voulu
 * sont à 0. Les voisins proches gardent leur voix quand la foule grossit (on les entend
 * toujours, et ils parlent plus fort dans le bruit : le niveau monte avec la foule) ; les
 * voix lointaines se partagent le reste (÷ √n : elles deviennent un murmure continu).
 */
export function gainsLocuteurs(reglages: ReglagesVoix, profils: readonly ProfilLocuteur[]): number[] {
  const n = nombreLocuteurs(reglages);
  const niveau = entre(reglages.voix, 0, 1);
  const lointains = Math.max(1, n - LOCUTEURS_PROCHES);
  return profils.map((p, i) => {
    if (i >= n) return 0;
    return p.plan === 'proche' ? niveau * p.poids : (niveau * p.poids) / Math.sqrt(lointains);
  });
}

/** Nombre de locuteurs audibles, borné à 0..LOCUTEURS_MAX. */
export function nombreLocuteurs(reglages: ReglagesVoix): number {
  const n = Number.isFinite(reglages.locuteurs) ? Math.round(reglages.locuteurs) : 0;
  return entre(n, 0, LOCUTEURS_MAX);
}
