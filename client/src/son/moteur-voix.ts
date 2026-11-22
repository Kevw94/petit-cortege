/**
 * Moteur Web Audio du brouhaha de voix (ADR 0008). Joue les phrases de
 * `brouhaha-voix.ts` avec un petit synthétiseur de formants par locuteur :
 *
 * - une source glottale (onde périodique dont les harmoniques décroissent comme celles
 *   d'une vraie voix), avec un léger tremblement de hauteur (jitter) et un filet de souffle ;
 * - le conduit vocal : trois résonateurs en **cascade** (F1, F2, F3), qui donnent
 *   d'eux-mêmes l'équilibre naturel des formants d'une voyelle à l'autre ;
 * - une enveloppe qui suit les attaques : voix liée, consonne voisée (la voix continue,
 *   plus sourde : F1 descend), consonne sourde (la voix s'arrête, un bruit la remplace) ;
 * - un bruit de friction filtré pour les consonnes (souffle, explosion, aspiration).
 *
 * Tous les nœuds sont créés une fois (au plus LOCUTEURS_MAX voix) : ensuite on ne
 * programme que des rampes de paramètres, à l'avance, comme le reste du moteur.
 * Aucune voix enregistrée, aucun échantillon : seulement des oscillateurs et du bruit.
 */
import {
  creerLocuteur,
  F1_CONSTRICTION_HZ,
  gainsLocuteurs,
  LOCUTEURS_MAX,
  nombreLocuteurs,
  type Locuteur,
  type OptionsLocuteur,
  type PhraseVoix,
  type ReglagesVoix,
} from './brouhaha-voix';
import { aleaDepuis } from './alea';

export interface BrouhahaVoix {
  /** Applique les réglages (niveau, nombre de locuteurs) avec une transition lente, ou tout de suite. */
  regler(reglages: ReglagesVoix, immediat?: boolean): void;
  /** Programme les phrases qui commencent avant `horizon` (secondes du contexte). */
  programmer(maintenant: number, horizon: number): void;
  /** Baisse les voix pendant un chant (début en secondes du contexte, durée en secondes). */
  baisserPourChant(debut: number, duree: number): void;
  /** Sources à arrêter et nœuds à déconnecter quand la scène se ferme. */
  readonly sources: AudioScheduledSourceNode[];
  readonly noeuds: AudioNode[];
}

/** Où vont les voix : proches (nettes) et lointaines (la scène les assourdit davantage). */
export interface SortiesVoix {
  proche: AudioNode;
  lointain: AudioNode;
}

/** Niveau de sortie d'une voix : la cascade de résonateurs amplifie autour de F1. */
const NORMALISATION = 0.085;
const BAISSE_CHANT = 0.4;
/** Résonance des formants, en dB (le Q d'un passe-bas Web Audio est en dB) : ≈ F / largeur de bande. */
const RESONANCE_DB = [10, 20, 17] as const;
/** Étagère d'aigus (dB au-dessus de 1,2 kHz) : voix proches présentes, lointaines plus ternes. */
const PRESENCE_PROCHE_DB = 10;
const PRESENCE_LOINTAINE_DB = 6;
/** Tremblement de hauteur, en cents (écart type ≈) : une voix n'est jamais parfaitement stable. */
const JITTER_CENTS = 14;
const JITTER_COUPURE_HZ = 24;
/** Niveau du bruit de friction des consonnes, avant le niveau de la voix. */
const FRICTION = 0.28;

interface Voix {
  locuteur: Locuteur;
  niveau: GainNode;
  glotte: OscillatorNode;
  voisement: GainNode;
  formants: BiquadFilterNode[];
  frictionFiltre: BiquadFilterNode;
  friction: GainNode;
  /** Instant (contexte) où commence le silence qui précède la prochaine phrase. */
  libre: number;
}

const ondes = new WeakMap<BaseAudioContext, PeriodicWave>();

/**
 * Onde glottale : harmoniques en 1/n^1,2 (un peu plus douce qu'une dent de scie, comme
 * une voix parlée sans effort), fondamental légèrement renforcé. Une par contexte.
 */
export function ondeGlottale(ctx: BaseAudioContext): PeriodicWave {
  let onde = ondes.get(ctx);
  if (!onde) {
    const n = 48;
    const reel = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (k === 1 ? 1.3 : 1) / k ** 1.2;
    onde = ctx.createPeriodicWave(reel, imag);
    ondes.set(ctx, onde);
  }
  return onde;
}

/** Écart type du bruit `bruit` une fois passé dans un passe-bas à `coupureHz` (pour doser le jitter). */
function ecartTypeBasses(bruit: AudioBuffer, coupureHz: number): number {
  const d = bruit.getChannelData(0);
  const a = Math.exp((-2 * Math.PI * coupureHz) / bruit.sampleRate);
  let y = 0;
  let somme = 0;
  for (let i = 0; i < d.length; i++) {
    y = a * y + (1 - a) * d[i]!;
    somme += y * y;
  }
  return Math.sqrt(somme / d.length) || 1;
}

/**
 * Courbe d'un paramètre : des rampes linéaires toujours dans l'ordre du temps (un
 * événement programmé avant le précédent ferait sauter la valeur).
 */
class Courbe {
  #dernier = 0;
  constructor(readonly param: AudioParam) {}
  poser(valeur: number, t: number): void {
    const instant = Math.max(t, this.#dernier);
    this.param.setValueAtTime(valeur, instant);
    this.#dernier = instant;
  }
  vers(valeur: number, t: number): void {
    const instant = Math.max(t, this.#dernier);
    this.param.linearRampToValueAtTime(valeur, instant);
    this.#dernier = instant;
  }
}

/**
 * @param sorties nœuds (déjà reliés à la scène) des voix proches et lointaines
 * @param bruit tampon de bruit rose partagé du moteur
 */
export function creerBrouhahaVoix(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  sorties: SortiesVoix,
  graine: number,
  options: OptionsLocuteur = {},
): BrouhahaVoix {
  const sources: AudioScheduledSourceNode[] = [];
  const noeuds: AudioNode[] = [];
  const alea = aleaDepuis(graine ^ 0x5bd1e995);
  const onde = ondeGlottale(ctx);

  // Par plan (proche, lointain) : correction des formants supérieurs, puis baisse pendant un chant.
  const baisses = (
    [
      [sorties.proche, PRESENCE_PROCHE_DB],
      [sorties.lointain, PRESENCE_LOINTAINE_DB],
    ] as const
  ).map(([sortie, presenceDb]) => {
    // Trois formants seulement assombrissent la voix : sans les suivants (F4, F5…), il
    // manque de l'aigu. Une étagère le rend, pour approcher le spectre moyen de la parole.
    const presence = ctx.createBiquadFilter();
    presence.type = 'highshelf';
    presence.frequency.value = 1200;
    presence.gain.value = presenceDb;
    const g = ctx.createGain();
    presence.connect(g);
    g.connect(sortie);
    noeuds.push(presence, g);
    return { entree: presence, baisse: g };
  });
  const [planProche, planLointain] = baisses as [(typeof baisses)[0], (typeof baisses)[0]];

  // Tremblement de hauteur : deux bruits très graves partagés, chaque voix en prend un
  // (signe et profondeur à elle) : les voix ne tremblent pas ensemble.
  const profondeurJitter = JITTER_CENTS / ecartTypeBasses(bruit, JITTER_COUPURE_HZ);
  const jitters = [0, 1].map(() => {
    const source = ctx.createBufferSource();
    source.buffer = bruit;
    source.loop = true;
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = JITTER_COUPURE_HZ;
    filtre.Q.value = 0;
    source.connect(filtre);
    source.start(ctx.currentTime, alea() * (bruit.duration - 0.1));
    sources.push(source);
    noeuds.push(filtre);
    return filtre;
  });

  const voix: Voix[] = Array.from({ length: LOCUTEURS_MAX }, (_, i) => {
    const locuteur = creerLocuteur(graine, i, options);
    const { profil } = locuteur;
    const niveau = ctx.createGain();
    niveau.gain.value = 0;
    // Source glottale et souffle, sous la même enveloppe (le voisement).
    const voisement = ctx.createGain();
    voisement.gain.value = 0;
    const glotte = ctx.createOscillator();
    glotte.setPeriodicWave(onde);
    glotte.frequency.value = profil.hauteurHz;
    glotte.connect(voisement);
    const tremblement = ctx.createGain();
    tremblement.gain.value = profondeurJitter * (0.7 + 0.6 * alea()) * (i % 2 === 0 ? 1 : -1);
    jitters[(i >> 1) % 2]!.connect(tremblement);
    tremblement.connect(glotte.detune);
    const bruitVoix = ctx.createBufferSource();
    bruitVoix.buffer = bruit;
    bruitVoix.loop = true;
    const souffle = ctx.createGain();
    souffle.gain.value = profil.souffle * 2.5;
    bruitVoix.connect(souffle);
    souffle.connect(voisement);
    // Conduit vocal : trois résonateurs en cascade.
    const formants = RESONANCE_DB.map((resonance, k) => {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = resonance;
      f.frequency.value = [500, 1500, 2500][k]!;
      return f;
    });
    voisement.connect(formants[0]!);
    formants[0]!.connect(formants[1]!);
    formants[1]!.connect(formants[2]!);
    const sortieVoix = ctx.createGain();
    sortieVoix.gain.value = NORMALISATION;
    formants[2]!.connect(sortieVoix);
    sortieVoix.connect(niveau);
    // Consonnes : un bruit filtré, hors du conduit (il ne résonne pas comme une voyelle).
    const frictionFiltre = ctx.createBiquadFilter();
    frictionFiltre.type = 'bandpass';
    frictionFiltre.Q.value = 1.4;
    frictionFiltre.frequency.value = 3000;
    const friction = ctx.createGain();
    friction.gain.value = 0;
    bruitVoix.connect(frictionFiltre);
    frictionFiltre.connect(friction);
    friction.connect(niveau);
    // Chaque voix à sa place dans l'espace stéréo, dans son plan (proche ou lointain).
    const plan = (profil.plan === 'proche' ? planProche : planLointain).entree;
    if (ctx.createStereoPanner) {
      const panneau = ctx.createStereoPanner();
      panneau.pan.value = profil.pan;
      niveau.connect(panneau);
      panneau.connect(plan);
      noeuds.push(panneau);
    } else niveau.connect(plan);
    glotte.start();
    bruitVoix.start(ctx.currentTime, alea() * (bruit.duration - 0.1));
    sources.push(glotte, bruitVoix);
    noeuds.push(niveau, voisement, tremblement, souffle, ...formants, sortieVoix, frictionFiltre, friction);
    return { locuteur, niveau, glotte, voisement, formants, frictionFiltre, friction, libre: -1 };
  });
  const courbes = new Map<AudioParam, Courbe>();
  const courbe = (p: AudioParam) => {
    let c = courbes.get(p);
    if (!c) courbes.set(p, (c = new Courbe(p)));
    return c;
  };

  let voulus = 0;

  const programmerPhrase = (v: Voix, phrase: PhraseVoix, t0: number) => {
    const a = courbe(v.voisement.gain);
    const f0 = courbe(v.glotte.frequency);
    const fs = v.formants.map((f) => courbe(f.frequency));
    const fr = courbe(v.friction.gain);
    const frHz = courbe(v.frictionFiltre.frequency);
    let picPrecedent = 0;
    phrase.syllabes.forEach((s, i) => {
      const t = t0 + s.debut;
      const fin = t + s.duree;
      const c = s.transition;
      const voyelle = t + c;
      const tenue = fin - voyelle;
      const pic = 0.9 * s.niveau;
      const suivante = phrase.syllabes[i + 1];
      // Après la dernière syllabe, ou avant une vraie pause, la voix s'éteint ; sinon elle reste liée.
      const finLiee = suivante !== undefined && t0 + suivante.debut - fin < 0.06;
      const debutLie = i > 0 && picPrecedent > 0;
      // Hauteur : rampe pendant la consonne vers le début de la voyelle, puis le contour.
      if (!debutLie) f0.poser(s.f0[0], t);
      f0.vers(s.f0[0], voyelle);
      f0.vers(s.f0[1], fin);
      // Formants : la voyelle part de la coarticulation et va vers sa cible.
      for (let k = 0; k < 3; k++) {
        // Consonne voisée : le conduit se resserre (F1 descend), puis s'ouvre sur la voyelle.
        const resserre = s.attaque === 'voisee' && k === 0;
        if (!debutLie) fs[k]!.poser(resserre ? F1_CONSTRICTION_HZ : s.formants[0][k]!, t);
        else if (resserre) fs[0]!.vers(F1_CONSTRICTION_HZ, t + c * 0.5);
        fs[k]!.vers(s.formants[0][k]!, voyelle);
        fs[k]!.vers(s.formants[1][k]!, fin);
      }
      // Enveloppe du voisement selon l'attaque.
      if (!debutLie) {
        a.poser(0, t);
        if (s.attaque === 'voisee') a.vers(pic * 0.3, t + c * 0.6);
        else if (s.attaque === 'sourde') a.poser(0, voyelle);
      } else if (s.attaque === 'voisee') {
        a.vers(picPrecedent * 0.28, t + c * 0.5);
        a.vers(picPrecedent * 0.28, voyelle);
      } else if (s.attaque === 'sourde') {
        a.vers(0, t + Math.min(0.012, c * 0.5));
        a.poser(0, voyelle);
      }
      a.vers(pic, voyelle + Math.max(0.015, 0.22 * tenue));
      a.vers(pic * 0.85, fin - 0.2 * tenue);
      a.vers(finLiee ? pic * 0.7 : 0, fin);
      picPrecedent = finLiee ? pic * 0.7 : 0;
      // Bruit de la consonne.
      const k = s.consonne;
      if (k) {
        const crete = k.niveau * FRICTION;
        if (k.type === 'occlusive') {
          // Explosion brève à la fin de la tenue, juste avant la voyelle.
          const debut = Math.max(t, voyelle - k.duree);
          frHz.poser(k.hz, debut);
          fr.poser(0, debut);
          fr.vers(crete, debut + 0.003);
          fr.vers(0, voyelle + 0.008);
        } else {
          frHz.poser(k.hz, t);
          fr.poser(0, t);
          fr.vers(crete, t + k.duree * (k.type === 'aspiree' ? 0.3 : 0.5));
          fr.vers(0, t + k.duree + 0.01);
        }
      }
    });
  };

  return {
    sources,
    noeuds,
    regler(reglages, immediat = false) {
      voulus = nombreLocuteurs(reglages);
      const gains = gainsLocuteurs(
        reglages,
        voix.map((v) => v.locuteur.profil),
      );
      const t = ctx.currentTime;
      voix.forEach((v, i) => {
        if (immediat) v.niveau.gain.setValueAtTime(gains[i]!, t);
        else v.niveau.gain.setTargetAtTime(gains[i]!, t, 1.5);
      });
    },
    programmer(maintenant, horizon) {
      for (let i = 0; i < voulus; i++) {
        const v = voix[i]!;
        // Voix (re)lancée, ou onglet ralenti : un silence tiré au sort, pour ne pas parler tous ensemble.
        if (v.libre < maintenant - 0.5) v.libre = maintenant + alea() * 3;
        while (v.libre < horizon) {
          const phrase = v.locuteur.phraseSuivante();
          const t0 = v.libre + phrase.silenceAvant;
          programmerPhrase(v, phrase, t0);
          v.libre = t0 + phrase.duree;
        }
      }
    },
    baisserPourChant(debut, duree) {
      for (const { baisse } of baisses) {
        baisse.gain.cancelScheduledValues(debut);
        baisse.gain.setTargetAtTime(BAISSE_CHANT, debut, 0.12);
        baisse.gain.setTargetAtTime(1, debut + duree + 0.2, 0.5);
      }
    },
  };
}
