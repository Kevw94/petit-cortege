/**
 * Paramètres de la page de prototype (`prototype-perf.html?n=20000&technique=blitter&vue=rue&maj=250`).
 * Page de mesure uniquement : pas de manif ni d'identifiant dans l'URL (ADR 0002 non concerné).
 */
export const TECHNIQUES = ['sprites', 'blitter', 'gpulayer'] as const;
export type Technique = (typeof TECHNIQUES)[number];

/**
 * - `tout` : tout le cortège cadré à l'écran (pire cas : chaque avatar est dessiné) ;
 * - `rue` : échelle de jeu (16 px = 2 m), caméra sur le milieu du cortège, seuls les avatars visibles comptent.
 */
export const VUES = ['tout', 'rue'] as const;
export type Vue = (typeof VUES)[number];

export interface ParametresPerf {
  n: number;
  technique: Technique;
  vue: Vue;
  /** Intervalle minimal entre deux recalculs des positions, en ms (0 = à chaque image). */
  majMs: number;
}

const parmi = <T extends string>(valeurs: readonly T[], valeur: string | null, defaut: T): T =>
  (valeurs as readonly string[]).includes(valeur ?? '') ? (valeur as T) : defaut;

export function lireParametres(requete: string): ParametresPerf {
  const p = new URLSearchParams(requete);
  const n = Number(p.get('n'));
  const majMs = Number(p.get('maj'));
  return {
    n: Number.isInteger(n) && n > 0 ? n : 20_000,
    technique: parmi(TECHNIQUES, p.get('technique'), 'sprites'),
    vue: parmi(VUES, p.get('vue'), 'tout'),
    majMs: Number.isFinite(majMs) && majMs > 0 ? majMs : 0,
  };
}
