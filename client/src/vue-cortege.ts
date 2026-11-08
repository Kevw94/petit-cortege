/**
 * Vue de la manif, quel que soit le rendu (2D Phaser ou 3D Three.js) : ce que l'interface
 * HTML (main.ts) pilote avec ses boutons.
 */
export interface VueCortege {
  /** Rattache la caméra à son avatar (ou à la tête du cortège). */
  suivreLeCortege(): void;
  /** Tout le parcours à l'écran ; la caméra ne suit plus. */
  vueDEnsemble(): void;
  /** Zoom d'un facteur (> 1 : rapproche), autour du centre de l'écran. */
  zoomer(facteur: number): void;
  detruire(): void;
}
