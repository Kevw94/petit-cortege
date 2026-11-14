/**
 * Tirage pseudo-aléatoire déterministe (mulberry32) : la même graine donne la même
 * suite, ce qui rend la musique et les chants testables sans Web Audio.
 */
export type Alea = () => number;

export function aleaDepuis(graine: number): Alea {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange deux entiers en une graine (mesure n d'une musique de graine g, par exemple). */
export function combinerGraines(a: number, b: number): number {
  return (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
}

/** Choix pondéré : `poids[i]` relatif, au moins un poids > 0. */
export function choisirPondere<T>(alea: Alea, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((s, [, p]) => s + p, 0);
  let r = alea() * total;
  for (const [valeur, poids] of options) {
    r -= poids;
    if (r < 0) return valeur;
  }
  return options[options.length - 1]![0];
}

/** Fréquence (Hz) d'une note MIDI (69 = la 440 Hz). */
export const frequenceMidi = (note: number) => 440 * 2 ** ((note - 69) / 12);
