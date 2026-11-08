/**
 * Vue de la manif : rendu 2D (Phaser, vue de dessus 3/4) ou semi-3D (Three.js, caméra à
 * la troisième personne). Le choix est mémorisé sur l'appareil ; par défaut, la 3D si
 * WebGL est disponible (ADR 0007).
 */
export type ModeVue = '2d' | '3d';

const CLE = 'petit-cortege.vue';

/** Stockage minimal (localStorage), qui peut lever une exception (navigation privée, stockage bloqué). */
export interface StockageModeVue {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
}

export function choisirModeVue(memorise: string | null, webgl: boolean): ModeVue {
  if (!webgl) return '2d';
  return memorise === '2d' ? '2d' : '3d';
}

export function lireModeVue(stockage: StockageModeVue | undefined): string | null {
  try {
    return stockage?.getItem(CLE) ?? null;
  } catch {
    return null;
  }
}

export function memoriserModeVue(mode: ModeVue, stockage: StockageModeVue | undefined): void {
  try {
    stockage?.setItem(CLE, mode);
  } catch {
    // Choix non mémorisé : la vue par défaut reviendra à la prochaine visite.
  }
}

/** WebGL utilisable dans ce navigateur (contexte créé puis abandonné). */
export function webglDisponible(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** localStorage, ou undefined s'il est inaccessible. */
export function stockageLocal(): StockageModeVue | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
