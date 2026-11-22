/**
 * Banc d'écoute (outil de développement, hors du bundle du jeu) : joue l'ambiance d'une
 * phase de manif sans attendre une vraie manif (la danse finale n'arrive qu'au bout du
 * parcours), et enregistre ce qui sort, pour `npm run ecouter-son` (scripts/ecouter-son.ts).
 *
 * Le moteur ne livre pas son contexte audio : la page pose une prise sur chaque
 * connexion à la sortie (ScriptProcessorNode, déprécié mais simple, suffisant ici).
 */
import { reglagesAmbiance, type PhaseAmbiance } from '../son/ambiance';
import { programmeChant } from '../son/chants';
import { creerMoteurSon } from '../son/moteur';

export interface ScenarioEcoute {
  phase: PhaseAmbiance;
  soutiens: number;
  /** Proximité du point d'écoute (1 : dans la foule, 0 : vue d'ensemble). */
  proximite: number;
  dureeS: number;
  /** Lance un chant local à cet instant (s), s'il est donné. */
  chantS?: number;
}

export interface EnregistrementEcoute {
  taux: number;
  /** Échantillons gauche et droite, en Float32 encodés en base 64. */
  canaux: [string, string];
}

const blocs: [Float32Array[], Float32Array[]] = [[], []];
let enregistrer = false;
/** Taux d'échantillonnage du contexte enregistré. */
let taux = 44_100;
const connecter = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
const prises = new WeakMap<BaseAudioContext, ScriptProcessorNode>();
AudioNode.prototype.connect = function (this: AudioNode, cible: unknown, ...reste: unknown[]) {
  const resultat = connecter.call(this, cible, ...reste);
  const ctx = this.context;
  if (cible === ctx.destination && ctx instanceof AudioContext && !(this instanceof ScriptProcessorNode)) {
    let prise = prises.get(ctx);
    if (!prise) {
      prise = ctx.createScriptProcessor(4096, 2, 2);
      taux = ctx.sampleRate;
      prise.onaudioprocess = (e) => {
        if (!enregistrer) return;
        for (const c of [0, 1] as const) blocs[c].push(new Float32Array(e.inputBuffer.getChannelData(c)));
      };
      connecter.call(prise, ctx.destination);
      prises.set(ctx, prise);
    }
    connecter.call(this, prise);
  }
  return resultat;
} as typeof AudioNode.prototype.connect;

const enBase64 = (morceaux: Float32Array[]) => {
  const n = morceaux.reduce((s, b) => s + b.length, 0);
  const tout = new Float32Array(n);
  let o = 0;
  for (const b of morceaux) {
    tout.set(b, o);
    o += b.length;
  }
  const octets = new Uint8Array(tout.buffer);
  let texte = '';
  for (let i = 0; i < octets.length; i += 0x8000) texte += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(texte);
};

async function jouer(s: ScenarioEcoute): Promise<EnregistrementEcoute> {
  blocs[0].length = blocs[1].length = 0;
  const moteur = creerMoteurSon(true);
  moteur.debloquer();
  moteur.reglerAmbiance(reglagesAmbiance({ soutiens: s.soutiens, phase: s.phase, proximite: s.proximite }));
  moteur.scene('manif');
  enregistrer = true;
  if (s.chantS !== undefined) setTimeout(() => moteur.jouerChant(programmeChant(0)), s.chantS * 1000);
  await new Promise((r) => setTimeout(r, s.dureeS * 1000));
  enregistrer = false;
  moteur.scene('silence');
  return { taux, canaux: [enBase64(blocs[0]), enBase64(blocs[1])] };
}

(globalThis as { __ecoute?: unknown }).__ecoute = { pret: true, jouer };
