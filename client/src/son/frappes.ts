/**
 * Sons brefs synthétisés (ADR 0008) : bruit filtré et oscillateurs à enveloppe
 * percussive. Instruments de la batucada, pas des voisins, sauts et mains de la foule
 * pendant la danse, clameur (« ouais ! » sans paroles), déclencheur de la photo finale.
 *
 * Les instruments joués en rafale (caisse claire, hochet, cloches) gardent leurs nœuds
 * d'un coup à l'autre : on ne programme que leurs enveloppes. Les peaux (surdos,
 * repique) changent de hauteur à chaque coup : un oscillateur par coup, vite libéré.
 */
import type { Alea } from './alea';
import type { Frappe } from './batucada';
import type { Marcheur } from './rythme-foule';

export interface OptionsRafale {
  type: BiquadFilterType;
  frequence: number;
  q?: number;
  duree: number;
  volume: number;
}

/** Courte rafale de bruit filtré, enveloppe percussive : base des pas, des mains, des tambours. */
export function rafale(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  sortie: AudioNode,
  t: number,
  { type, frequence, q = 1, duree, volume }: OptionsRafale,
): void {
  const source = ctx.createBufferSource();
  source.buffer = bruit;
  const filtre = ctx.createBiquadFilter();
  filtre.type = type;
  filtre.frequency.value = frequence;
  filtre.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.006, duree / 4);
  source.connect(filtre);
  filtre.connect(g);
  g.connect(sortie);
  source.start(t, Math.random() * (bruit.duration - 1));
  source.stop(t + duree + 0.05);
  source.onended = () => g.disconnect();
}

/** Enveloppe percussive sur un gain partagé : montée quasi immédiate, puis extinction. */
function frapperGain(g: GainNode, t: number, crete: number, extinctionS: number, monteeS = 0.0008): void {
  g.gain.setTargetAtTime(crete, t, monteeS);
  g.gain.setTargetAtTime(0, t + monteeS * 4, extinctionS);
}

export interface Percussions {
  frapper(frappe: Frappe, t: number): void;
  readonly sources: AudioScheduledSourceNode[];
  readonly noeuds: AudioNode[];
}

/** Hauteurs (Hz) des peaux et des cloches : génériques, pas d'accord particulier. */
const SURDO1_HZ = 60;
const SURDO2_HZ = 78;
const REPIQUE_HZ = 510;
const AGOGO_HZ = { aigu: 930, grave: 700 } as const;

/** Instruments de la batucada, branchés sur `sortie` (le bus du groupe). */
export function creerPercussions(ctx: BaseAudioContext, bruit: AudioBuffer, sortie: AudioNode): Percussions {
  const sources: AudioScheduledSourceNode[] = [];
  const noeuds: AudioNode[] = [];
  const bruitEnBoucle = () => {
    const s = ctx.createBufferSource();
    s.buffer = bruit;
    s.loop = true;
    s.start(ctx.currentTime, Math.random() * (bruit.duration - 0.1));
    sources.push(s);
    return s;
  };
  const filtre = (type: BiquadFilterType, frequence: number, q: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequence;
    f.Q.value = q;
    noeuds.push(f);
    return f;
  };
  const gain = (valeur = 0) => {
    const g = ctx.createGain();
    g.gain.value = valeur;
    noeuds.push(g);
    return g;
  };

  // Caisse claire : timbre (bruit aigu) et fût (son bref, grave).
  const timbre = gain();
  bruitEnBoucle()
    .connect(filtre('highpass', 900, 0.7))
    .connect(filtre('bandpass', 3200, 0.6))
    .connect(timbre);
  timbre.connect(sortie);
  const fut = gain();
  const futOsc = ctx.createOscillator();
  futOsc.type = 'triangle';
  futOsc.frequency.value = 190;
  futOsc.connect(fut);
  futOsc.start();
  sources.push(futOsc);
  fut.connect(sortie);

  // Ganzá : hochet, bruit très aigu, attaque un peu molle (les grains roulent).
  const ganza = gain();
  bruitEnBoucle()
    .connect(filtre('highpass', 5500, 0.7))
    .connect(ganza);
  ganza.connect(sortie);

  // Agogô : deux cloches, chacune deux partiels inharmoniques.
  const cloches = Object.fromEntries(
    (['aigu', 'grave'] as const).map((variante) => {
      const g = gain();
      for (const [rapport, part] of [
        [1, 1],
        [2.71, 0.4],
      ] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = AGOGO_HZ[variante] * rapport;
        const p = gain(part);
        o.connect(p);
        p.connect(g);
        o.start();
        sources.push(o);
      }
      g.connect(sortie);
      return [variante, g];
    }),
  ) as Record<'aigu' | 'grave', GainNode>;

  /** Peau frappée : son grave qui chute en hauteur, harmonique de la peau, claquement de la mailloche. */
  const peau = (t: number, hz: number, crete: number, extinctionS: number, claquementHz: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(crete, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.01, extinctionS);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(hz * 1.45, t);
    o.frequency.exponentialRampToValueAtTime(hz, t + 0.07);
    const h = ctx.createOscillator();
    h.frequency.setValueAtTime(hz * 2.3 * 1.2, t);
    h.frequency.exponentialRampToValueAtTime(hz * 2.3, t + 0.05);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.35, t);
    hg.gain.setTargetAtTime(0, t + 0.01, extinctionS * 0.4);
    o.connect(g);
    h.connect(hg);
    hg.connect(g);
    g.connect(sortie);
    const fin = t + extinctionS * 6 + 0.05;
    for (const s of [o, h]) {
      s.start(t);
      s.stop(fin);
    }
    o.onended = () => {
      g.disconnect();
      hg.disconnect();
    };
    rafale(ctx, bruit, sortie, t, {
      type: 'bandpass',
      frequence: claquementHz,
      q: 0.8,
      duree: 0.03,
      volume: crete * 0.3,
    });
  };

  return {
    sources,
    noeuds,
    frapper(f, t) {
      switch (f.instrument) {
        case 'surdo1':
        case 'surdo2': {
          const etouffe = f.variante === 'etouffe';
          const hz = f.instrument === 'surdo1' ? SURDO1_HZ : SURDO2_HZ;
          peau(t, hz, 0.55 * f.force, etouffe ? 0.05 : 0.2, 400);
          return;
        }
        case 'repique':
          peau(t, REPIQUE_HZ, 0.2 * f.force, 0.05, 2600);
          return;
        case 'caixa':
          frapperGain(timbre, t, 0.42 * f.force, 0.04);
          frapperGain(fut, t, 0.06 * f.force, 0.025);
          return;
        case 'ganza':
          frapperGain(ganza, t, 0.14 * f.force, 0.022, 0.005);
          return;
        case 'agogo':
          frapperGain(cloches[f.variante === 'grave' ? 'grave' : 'aigu'], t, 0.07 * f.force, 0.09, 0.0005);
          return;
      }
    },
  };
}

/** Un pas : le talon (sourd), puis la semelle qui frotte l'asphalte. */
export function jouerPose(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  sortie: AudioNode,
  t: number,
  m: Marcheur,
  volume: number,
): void {
  const v = volume * m.niveau;
  rafale(ctx, bruit, sortie, t, { type: 'lowpass', frequence: m.talonHz, q: 0.8, duree: 0.06, volume: v });
  rafale(ctx, bruit, sortie, t + 0.07 + 0.03 * m.phase, {
    type: 'bandpass',
    frequence: 1400 + 900 * m.phase,
    q: 0.9,
    duree: 0.08,
    volume: v * 0.35,
  });
}

/** Danse finale : toute la foule retombe en même temps (bruit sourd, un peu étalé). */
export function jouerAtterrissage(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  sortie: AudioNode,
  t: number,
  ampleur: number,
): void {
  for (let i = 0; i < 3; i++) {
    rafale(ctx, bruit, sortie, t + (i - 1) * 0.018, {
      type: 'lowpass',
      frequence: 150 + 90 * i,
      q: 0.7,
      duree: 0.12,
      volume: 0.12 * ampleur,
    });
  }
}

/** Mains de la foule qui claquent ensemble (étalées sur quelques dizaines de millisecondes). */
export function jouerMainsFoule(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  sortie: AudioNode,
  t: number,
  ampleur: number,
  alea: Alea,
): void {
  for (let i = 0; i < 6; i++) {
    rafale(ctx, bruit, sortie, t + (alea() - 0.5) * 0.045, {
      type: 'bandpass',
      frequence: 1000 + 1500 * alea(),
      q: 1,
      duree: 0.045,
      volume: 0.05 * ampleur,
    });
  }
}

/**
 * Clameur : la foule pousse un « ouais ! » sans paroles. Quelques voix criées (dents de
 * scie), chacune à sa hauteur, qui montent puis retombent, passées dans les formants
 * d'une voyelle ouverte ; elles démarrent en ordre dispersé, comme une vague.
 */
export function jouerClameur(ctx: BaseAudioContext, sortie: AudioNode, t: number, ampleur: number, alea: Alea): void {
  const duree = 1.4 + 1.2 * alea();
  const f1 = ctx.createBiquadFilter();
  f1.type = 'lowpass';
  f1.frequency.value = 680 + 120 * alea();
  f1.Q.value = 12;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.value = 1250 + 500 * alea();
  f2.Q.value = 14;
  const presence = ctx.createBiquadFilter();
  presence.type = 'highshelf';
  presence.frequency.value = 1200;
  presence.gain.value = 8;
  const niveau = ctx.createGain();
  niveau.gain.value = 0.06 * ampleur;
  f1.connect(f2);
  f2.connect(presence);
  presence.connect(niveau);
  niveau.connect(sortie);
  const voix = 7;
  let derniere: { o: OscillatorNode; fin: number } | null = null;
  const gains: GainNode[] = [];
  for (let i = 0; i < voix; i++) {
    const debut = t + 0.35 * alea() ** 1.5;
    const fin = t + duree * (0.8 + 0.2 * alea());
    const hz = 150 + 200 * alea();
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(hz * 0.88, debut);
    o.frequency.linearRampToValueAtTime(hz * (1.12 + 0.1 * alea()), debut + 0.3 * (fin - debut));
    o.frequency.linearRampToValueAtTime(hz * 0.82, fin);
    o.detune.value = (alea() - 0.5) * 30;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, debut);
    g.gain.linearRampToValueAtTime(0.5 + 0.5 * alea(), debut + 0.18);
    g.gain.setTargetAtTime(0, debut + 0.4 * (fin - debut), (fin - debut) / 4);
    o.connect(g);
    g.connect(f1);
    o.start(debut);
    o.stop(fin + 0.6);
    gains.push(g);
    if (!derniere || fin > derniere.fin) derniere = { o, fin };
  }
  // Libéré quand la dernière voix s'arrête.
  derniere!.o.onended = () => {
    for (const n of [...gains, f1, f2, presence, niveau]) n.disconnect();
  };
}

/** Déclencheur de l'appareil photo : « clic-clac » mécanique, bref. */
export function jouerDeclencheur(ctx: BaseAudioContext, bruit: AudioBuffer, sortie: AudioNode, t: number): void {
  rafale(ctx, bruit, sortie, t, { type: 'highpass', frequence: 2500, q: 0.7, duree: 0.018, volume: 0.35 });
  rafale(ctx, bruit, sortie, t + 0.004, { type: 'bandpass', frequence: 900, q: 1.5, duree: 0.03, volume: 0.25 });
  rafale(ctx, bruit, sortie, t + 0.11, { type: 'bandpass', frequence: 1600, q: 1.2, duree: 0.035, volume: 0.3 });
}
