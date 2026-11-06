/**
 * Quelles pancartes dessiner, où, à quelle taille et avec ou sans slogan.
 * Fonction pure, sans Phaser : la scène se contente de dessiner le résultat.
 *
 * De loin, seules la couleur et la forme se voient ; le slogan apparaît au zoom,
 * et toujours sur son propre avatar (docs/perimetre-v1.md).
 */
import {
  COULEURS_PANCARTE,
  decoderPancarte,
  FORMES_PANCARTE,
  SLOGANS,
  type CouleurPancarte,
  type FormePancarte,
} from '@petit-cortege/shared';

/** À partir de ce zoom (pixels par mètre), le slogan est écrit sur les pancartes. */
export const SEUIL_SLOGAN_PX_PAR_M = 36;
/** De loin, une pancarte garde au moins cette échelle pour que couleur et forme restent visibles. */
const ECHELLE_MIN_PX_PAR_M = 5;

/** Taille réelle du panneau selon sa forme, en mètres (largeur, hauteur). */
const DIMENSIONS_M: Record<FormePancarte, [number, number]> = {
  rectangle: [1.6, 1],
  portrait: [1.1, 1.4],
  rond: [1.3, 1.3],
  losange: [1.5, 1.5],
};
/** Hauteur du manche entre la tête de l'avatar et le bas du panneau. */
const MANCHE_M = 0.6;

export interface PorteurDePancarte {
  /** Position de l'avatar à l'écran (pixels). */
  x: number;
  y: number;
  pancarte: number;
  propre: boolean;
}

export interface PancarteAffichee {
  /** Centre du panneau à l'écran. */
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  /** Bas du manche (là où l'avatar le tient). */
  yManche: number;
  forme: FormePancarte;
  couleur: CouleurPancarte;
  /** Slogan à écrire, ou `null` quand la pancarte est vue de loin. */
  slogan: string | null;
  propre: boolean;
}

export interface Vue {
  /** Zoom courant, en pixels par mètre. */
  echelle: number;
  largeur: number;
  hauteur: number;
}

export function pancartesAffichees(porteurs: readonly PorteurDePancarte[], vue: Vue): PancarteAffichee[] {
  const affichees: PancarteAffichee[] = [];
  for (const porteur of porteurs) {
    const composition = decoderPancarte(porteur.pancarte);
    if (!composition) continue;
    const forme = FORMES_PANCARTE[composition.forme]!;
    // Sa propre pancarte est toujours dessinée au moins à la taille où le slogan se lit.
    const lisible = porteur.propre || vue.echelle >= SEUIL_SLOGAN_PX_PAR_M;
    const echelle = Math.max(vue.echelle, porteur.propre ? SEUIL_SLOGAN_PX_PAR_M : ECHELLE_MIN_PX_PAR_M);
    const [l, h] = DIMENSIONS_M[forme];
    const largeur = l * echelle;
    const hauteur = h * echelle;
    const y = porteur.y - MANCHE_M * echelle - hauteur / 2;
    const horsEcran =
      porteur.x + largeur / 2 < 0 ||
      porteur.x - largeur / 2 > vue.largeur ||
      porteur.y < 0 ||
      y - hauteur / 2 > vue.hauteur;
    if (horsEcran) continue;
    affichees.push({
      x: porteur.x,
      y,
      largeur,
      hauteur,
      yManche: porteur.y,
      forme,
      couleur: COULEURS_PANCARTE[composition.couleur]!,
      slogan: lisible ? SLOGANS[composition.slogan]! : null,
      propre: porteur.propre,
    });
  }
  // Les siennes en dernier : dessinées par-dessus la foule.
  return [...affichees.filter((p) => !p.propre), ...affichees.filter((p) => p.propre)];
}
