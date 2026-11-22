/**
 * Acoustique de la rue : réponse impulsionnelle synthétique d'une rue bordée de façades,
 * pour la réverbération à convolution de l'ambiance de manif (ADR 0008 : rien
 * d'enregistré, tout est calculé ici).
 *
 * - Premières réflexions : les façades de part et d'autre renvoient le son, à gauche puis
 *   à droite, de plus en plus tard et de plus en plus faiblement (léger écho « flottant »
 *   entre deux murs parallèles).
 * - Queue diffuse : du bruit qui décroît exponentiellement, les aigus plus vite que les
 *   graves (l'air et les façades les absorbent), décorrélé entre gauche et droite.
 *
 * Fonction pure et déterministe à graine : le moteur en fait un tampon de ConvolverNode.
 */
import { aleaDepuis } from './alea';

export interface OptionsRue {
  /** Taux d'échantillonnage du contexte audio (Hz). */
  taux: number;
  graine: number;
  /** Durée de la réponse (s). */
  duree?: number;
  /** Temps de réverbération des graves (s, décroissance de 60 dB). */
  rt60Graves?: number;
  /** Temps de réverbération des aigus (s). */
  rt60Aigus?: number;
  /** Largeur de la rue (m) : fixe l'intervalle entre réflexions d'une façade à l'autre. */
  largeurM?: number;
}

export const VITESSE_SON_M_S = 343;

/** Réponse impulsionnelle stéréo [gauche, droite] d'une rue. */
export function reponseRue({
  taux,
  graine,
  duree = 1.6,
  rt60Graves = 1.3,
  rt60Aigus = 0.55,
  largeurM = 18,
}: OptionsRue): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(1, Math.round(duree * taux));
  const alea = aleaDepuis(graine);
  const canaux: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  // Décroissance de 60 dB en rt60 secondes : amplitude × 10^(-3 t / rt60).
  const decroissance = (t: number, rt60: number) => 10 ** ((-3 * t) / rt60);

  // Queue diffuse : bruit blanc (aigus, décroissance rapide) + bruit filtré (graves, lente).
  const debutQueue = 0.012;
  const coupure = Math.exp((-2 * Math.PI * 1200) / taux);
  for (const canal of canaux) {
    let grave = 0;
    let filtre = 0;
    for (let i = 0; i < n; i++) {
      const t = i / taux;
      const blanc = alea() * 2 - 1;
      // Deux pôles : la queue s'assombrit nettement (−12 dB par octave au-dessus de 1,2 kHz).
      filtre = coupure * filtre + (1 - coupure) * (alea() * 2 - 1);
      grave = coupure * grave + (1 - coupure) * filtre;
      // Montée douce : la queue se construit en quelques dizaines de millisecondes.
      const montee = t < debutQueue ? 0 : Math.min(1, (t - debutQueue) / 0.04);
      canal[i] = montee * (0.3 * blanc * decroissance(t, rt60Aigus) + 4 * grave * decroissance(t, rt60Graves));
    }
  }

  // Premières réflexions : façade gauche, façade droite, puis allers-retours entre elles.
  const intervalle = largeurM / VITESSE_SON_M_S;
  for (let k = 0; k < 10; k++) {
    for (const [cote, decalage] of [
      [0, 0.18],
      [1, 0.62],
    ] as const) {
      const t = intervalle * (k + decalage) * (0.94 + 0.12 * alea());
      const i = Math.round(t * taux);
      if (i >= n) continue;
      const amplitude = 0.55 * 0.62 ** k * decroissance(t, rt60Graves);
      // La réflexion d'un côté s'entend surtout de ce côté.
      canaux[cote]![i]! += amplitude;
      canaux[1 - cote]![Math.min(n - 1, i + Math.round(0.0006 * taux))]! += amplitude * 0.45;
    }
  }
  return canaux;
}

/** Instant (s) où l'enveloppe de `canal` (fenêtres de 10 ms) passe sous `seuilDb` sous son maximum. */
export function instantSousLeSeuil(canal: Float32Array, taux: number, seuilDb: number): number {
  const fenetre = Math.max(1, Math.round(0.01 * taux));
  const energies: number[] = [];
  for (let i = 0; i < canal.length; i += fenetre) {
    let e = 0;
    for (let j = i; j < Math.min(canal.length, i + fenetre); j++) e += canal[j]! ** 2;
    energies.push(e / fenetre);
  }
  const max = Math.max(...energies);
  const seuil = max * 10 ** (seuilDb / 10);
  let dernier = 0;
  energies.forEach((e, k) => {
    if (e >= seuil) dernier = k;
  });
  return ((dernier + 1) * fenetre) / taux;
}
