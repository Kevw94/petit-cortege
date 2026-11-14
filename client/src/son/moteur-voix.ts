/**
 * Moteur Web Audio du brouhaha de voix (ADR 0008). Joue les phrases de
 * `brouhaha-voix.ts` : par locuteur, une source glottale en dents de scie passée dans
 * trois filtres de formants en parallèle, une enveloppe en syllabes et un filet de bruit
 * pour les consonnes. Tous les nœuds sont créés une fois (au plus LOCUTEURS_MAX voix) :
 * ensuite on ne programme que des rampes de paramètres, à l'avance, comme le reste du moteur.
 *
 * Aucune voix enregistrée, aucun échantillon : seulement des oscillateurs et du bruit.
 */
import {
  creerLocuteur,
  gainsLocuteurs,
  LOCUTEURS_MAX,
  nombreLocuteurs,
  type Locuteur,
  type PhraseVoix,
  type ReglagesVoix,
} from './brouhaha-voix';
import { aleaDepuis } from './alea';

export interface BrouhahaVoix {
  /** Applique les réglages (niveau, nombre de locuteurs) avec une transition lente. */
  regler(reglages: ReglagesVoix): void;
  /** Programme les phrases qui commencent avant `horizon` (secondes du contexte). */
  programmer(maintenant: number, horizon: number): void;
  /** Baisse les voix pendant un chant (début en secondes du contexte, durée en secondes). */
  baisserPourChant(debut: number, duree: number): void;
  /** Sources à arrêter et nœuds à déconnecter quand la scène se ferme. */
  readonly sources: AudioScheduledSourceNode[];
  readonly noeuds: AudioNode[];
}

/** Niveau de départ : les voix restent sous le brouhaha, la musique et les chants. */
const GAIN_GENERAL = 0.8;
const COUPURE_LOINTAINE_HZ = 2800;
const BAISSE_CHANT = 0.5;
const Q_FORMANTS = [3, 5, 6] as const;
const PART_FORMANTS = [0.6, 0.85, 0.6] as const;

interface Voix {
  locuteur: Locuteur;
  niveau: GainNode;
  glotte: OscillatorNode;
  formants: BiquadFilterNode[];
  amplitude: GainNode;
  consonneFiltre: BiquadFilterNode;
  consonneGain: GainNode;
  /** Instant (contexte) où commence le silence qui précède la prochaine phrase. */
  libre: number;
}

/**
 * @param destination nœud (déjà relié à la sortie et à l'envoi de réverbération de la scène)
 * @param bruit tampon de bruit rose partagé du moteur
 */
export function creerBrouhahaVoix(
  ctx: BaseAudioContext,
  bruit: AudioBuffer,
  destination: AudioNode,
  graine: number,
): BrouhahaVoix {
  const sources: AudioScheduledSourceNode[] = [];
  const noeuds: AudioNode[] = [];
  const alea = aleaDepuis(graine ^ 0x5bd1e995);

  // Les voix s'additionnent, puis s'éloignent : passe-bas, baisse pendant les chants, niveau.
  const melange = ctx.createGain();
  const lointain = ctx.createBiquadFilter();
  lointain.type = 'lowpass';
  lointain.frequency.value = COUPURE_LOINTAINE_HZ;
  lointain.Q.value = 0.4;
  const baisse = ctx.createGain();
  const general = ctx.createGain();
  general.gain.value = GAIN_GENERAL;
  melange.connect(lointain);
  lointain.connect(baisse);
  baisse.connect(general);
  general.connect(destination);
  noeuds.push(melange, lointain, baisse, general);

  const voix: Voix[] = Array.from({ length: LOCUTEURS_MAX }, (_, i) => {
    const locuteur = creerLocuteur(graine, i);
    const niveau = ctx.createGain();
    niveau.gain.value = 0;
    const amplitude = ctx.createGain();
    amplitude.gain.value = 0;
    const glotte = ctx.createOscillator();
    glotte.type = 'sawtooth';
    glotte.frequency.value = locuteur.profil.hauteurHz;
    const formants = PART_FORMANTS.map((part, k) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = Q_FORMANTS[k]!;
      f.frequency.value = [500, 1500, 2500][k]!;
      const g = ctx.createGain();
      g.gain.value = part;
      glotte.connect(f);
      f.connect(g);
      g.connect(amplitude);
      noeuds.push(g);
      return f;
    });
    amplitude.connect(niveau);
    // Consonnes : un souffle de bruit filtré, hors de l'enveloppe de la voyelle.
    const consonne = ctx.createBufferSource();
    consonne.buffer = bruit;
    consonne.loop = true;
    const consonneFiltre = ctx.createBiquadFilter();
    consonneFiltre.type = 'bandpass';
    consonneFiltre.Q.value = 1.2;
    const consonneGain = ctx.createGain();
    consonneGain.gain.value = 0;
    consonne.connect(consonneFiltre);
    consonneFiltre.connect(consonneGain);
    consonneGain.connect(niveau);
    // Chaque voix à sa place dans l'espace stéréo.
    if (ctx.createStereoPanner) {
      const panneau = ctx.createStereoPanner();
      panneau.pan.value = locuteur.profil.pan;
      niveau.connect(panneau);
      panneau.connect(melange);
      noeuds.push(panneau);
    } else niveau.connect(melange);
    glotte.start();
    consonne.start(ctx.currentTime, alea() * (bruit.duration - 0.1));
    sources.push(glotte, consonne);
    noeuds.push(niveau, amplitude, ...formants, consonneFiltre, consonneGain);
    return { locuteur, niveau, glotte, formants, amplitude, consonneFiltre, consonneGain, libre: -1 };
  });

  let voulus = 0;

  const programmerPhrase = (v: Voix, phrase: PhraseVoix, t0: number) => {
    const a = v.amplitude.gain;
    const f0 = v.glotte.frequency;
    for (const s of phrase.syllabes) {
      const t = t0 + s.debut;
      const fin = t + s.duree;
      // Hauteur et formants : rampes depuis la valeur précédente (lisses, même à travers un silence).
      f0.linearRampToValueAtTime(s.f0[0], t);
      f0.linearRampToValueAtTime(s.f0[1], fin);
      for (let k = 0; k < 3; k++) {
        const p = v.formants[k]!.frequency;
        p.linearRampToValueAtTime(s.formants[0][k]!, t);
        p.linearRampToValueAtTime(s.formants[1][k]!, fin);
      }
      // Enveloppe de syllabe : attaque, léger plateau, extinction.
      const pic = 0.9 * s.niveau;
      a.setValueAtTime(0, t);
      a.linearRampToValueAtTime(pic, t + 0.3 * s.duree);
      a.linearRampToValueAtTime(pic * 0.8, t + 0.7 * s.duree);
      a.linearRampToValueAtTime(0, fin);
      if (s.consonne) {
        const c = s.consonne;
        v.consonneFiltre.frequency.setValueAtTime(c.hz, t);
        v.consonneGain.gain.setValueAtTime(0, t);
        v.consonneGain.gain.linearRampToValueAtTime(c.niveau * 0.35, t + c.duree * 0.3);
        v.consonneGain.gain.linearRampToValueAtTime(0, t + c.duree);
      }
    }
  };

  return {
    sources,
    noeuds,
    regler(reglages) {
      voulus = nombreLocuteurs(reglages);
      const gains = gainsLocuteurs(
        reglages,
        voix.map((v) => v.locuteur.profil),
      );
      const t = ctx.currentTime;
      voix.forEach((v, i) => v.niveau.gain.setTargetAtTime(gains[i]!, t, 1.5));
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
      baisse.gain.cancelScheduledValues(debut);
      baisse.gain.setTargetAtTime(BAISSE_CHANT, debut, 0.12);
      baisse.gain.setTargetAtTime(1, debut + duree + 0.2, 0.5);
    },
  };
}
