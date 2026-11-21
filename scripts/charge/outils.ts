/**
 * Outils purs du test de charge (#19) : horloge accélérée, profil d'affluence,
 * centiles, coût CDN. Testés dans `scripts/test/charge.test.ts`.
 */
import type { Horloge } from '@petit-cortege/server';

/**
 * Horloge métier accélérée, partagée entre processus (même machine) :
 * virtuel = t0Virtuel + (réel − t0Reel) × facteur.
 */
export class HorlogeAcceleree implements Horloge {
  constructor(
    readonly t0Reel: number,
    readonly t0Virtuel: number,
    readonly facteur: number,
    private readonly maintenantReel: () => number = Date.now,
  ) {}

  maintenant(): Date {
    return new Date(this.virtuelPour(this.maintenantReel()));
  }

  virtuelPour(reelMs: number): number {
    return this.t0Virtuel + (reelMs - this.t0Reel) * this.facteur;
  }

  reelPour(virtuelMs: number): number {
    return this.t0Reel + (virtuelMs - this.t0Virtuel) / this.facteur;
  }
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : simulations reproductibles. */
export function aleaAGraine(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Densité d'affluence linéaire par morceaux ; `minute` relative au départ de la manif. */
export interface Noeud {
  minute: number;
  densite: number;
}

/**
 * Profil d'une grosse manif : quelques entrées dès l'ouverture, montée jusqu'au
 * départ, pic pendant le premier quart d'heure, puis décrue jusqu'à la fin
 * (entrées fermées). Hypothèse, pas une mesure : à recaler sur une vraie manif.
 */
export function profilParDefaut(ouvertureAvantMin: number, finApresMin: number): Noeud[] {
  const noeuds: Noeud[] = [
    { minute: -ouvertureAvantMin, densite: 1 },
    { minute: 0, densite: 10 },
    { minute: 15, densite: 10 },
    { minute: 45, densite: 3 },
    { minute: finApresMin, densite: 0.5 },
  ];
  // Parcours court : les nœuds au-delà de la fin sont coupés.
  return noeuds.filter((n, i) => i === noeuds.length - 1 || n.minute < finApresMin);
}

/** Densité au point `minute` (0 hors du profil). */
function densiteA(noeuds: readonly Noeud[], minute: number): number {
  for (let i = 1; i < noeuds.length; i++) {
    const a = noeuds[i - 1]!;
    const b = noeuds[i]!;
    if (minute >= a.minute && minute <= b.minute) {
      return b.minute === a.minute
        ? a.densite
        : a.densite + ((b.densite - a.densite) * (minute - a.minute)) / (b.minute - a.minute);
    }
  }
  return 0;
}

/**
 * Tire `n` instants (en ms, relatifs au départ) selon le profil, triés : inverse
 * de la fonction de répartition discrétisée à la seconde.
 */
export function tirerInstants(n: number, noeuds: readonly Noeud[], alea: () => number): number[] {
  const debutS = Math.round(noeuds[0]!.minute * 60);
  const finS = Math.round(noeuds[noeuds.length - 1]!.minute * 60);
  const cumul = new Float64Array(finS - debutS);
  let total = 0;
  for (let s = debutS; s < finS; s++) {
    total += densiteA(noeuds, (s + 0.5) / 60);
    cumul[s - debutS] = total;
  }
  const instants: number[] = [];
  for (let i = 0; i < n; i++) {
    const cible = alea() * total;
    let bas = 0;
    let haut = cumul.length - 1;
    while (bas < haut) {
      const milieu = (bas + haut) >> 1;
      if (cumul[milieu]! < cible) bas = milieu + 1;
      else haut = milieu;
    }
    instants.push((debutS + bas + alea()) * 1000);
  }
  return instants.sort((a, b) => a - b);
}

export interface Centiles {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  moyenne: number;
}

/** Centiles par rang le plus proche (valeurs dans n'importe quel ordre). */
export function centiles(valeurs: readonly number[]): Centiles {
  if (valeurs.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0, moyenne: 0 };
  const tries = Float64Array.from(valeurs).sort();
  const rang = (p: number) => tries[Math.min(tries.length - 1, Math.max(0, Math.ceil((p / 100) * tries.length) - 1))]!;
  let somme = 0;
  for (const v of tries) somme += v;
  return {
    n: tries.length,
    p50: rang(50),
    p95: rang(95),
    p99: rang(99),
    max: tries[tries.length - 1]!,
    moyenne: somme / tries.length,
  };
}

/** Tarif CDN : prix par Go (10⁹ octets), facturation minimale mensuelle. */
export interface Tarif {
  nom: string;
  prixParGo: number;
  minimumMensuel: number;
}

export function coutCdn(octets: number, tarif: Tarif): number {
  return (octets / 1e9) * tarif.prixParGo;
}
