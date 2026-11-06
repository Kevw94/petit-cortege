/**
 * Dessin Phaser des pancartes calculées par `pancartesAffichees` : panneau
 * coloré sur un manche (comme la planche Kenney), slogan écrit au zoom.
 */
import type * as Phaser from 'phaser';
import type { PancarteAffichee } from './affichage';

const COULEUR_MANCHE = 0x7a5530;
const COULEUR_CONTOUR = 0x222222;

/** Dessine le manche et le panneau (forme + couleur), sans le slogan. */
export function dessinerPancarte(g: Phaser.GameObjects.Graphics, p: PancarteAffichee): void {
  const { x, y, largeur: l, hauteur: h } = p;
  g.lineStyle(Math.max(1, l * 0.07), COULEUR_MANCHE, 1);
  g.lineBetween(x, y, x, p.yManche);

  g.fillStyle(p.couleur.fond, 1);
  g.lineStyle(Math.max(1, Math.min(l * 0.04, 3)), COULEUR_CONTOUR, 0.7);
  switch (p.forme) {
    case 'rond':
      g.fillEllipse(x, y, l, h);
      g.strokeEllipse(x, y, l, h);
      break;
    case 'losange':
      g.beginPath();
      g.moveTo(x, y - h / 2);
      g.lineTo(x + l / 2, y);
      g.lineTo(x, y + h / 2);
      g.lineTo(x - l / 2, y);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
    default:
      g.fillRect(x - l / 2, y - h / 2, l, h);
      g.strokeRect(x - l / 2, y - h / 2, l, h);
  }
}

/** Part du panneau où le slogan peut s'écrire (le losange et le rond ont moins de place utile). */
const ZONE_TEXTE: Record<PancarteAffichee['forme'], [number, number]> = {
  rectangle: [0.88, 0.8],
  portrait: [0.86, 0.84],
  rond: [0.74, 0.68],
  losange: [0.66, 0.56],
};

/** Taille de police de référence ; le texte est ensuite mis à l'échelle du panneau. */
const POLICE_PX = 18;
/** Largeur de retour à la ligne, en pixels de référence. */
const LARGEUR_LIGNE_PX = 110;

/**
 * Slogans écrits sur les pancartes : un réservoir d'objets texte réutilisés
 * d'une image à l'autre (seules les pancartes à l'écran au zoom en ont besoin).
 */
export class SlogansAffiches {
  readonly #scene: Phaser.Scene;
  readonly #textes: { texte: Phaser.GameObjects.Text; cle: string }[] = [];

  constructor(scene: Phaser.Scene) {
    this.#scene = scene;
  }

  /** Affiche le slogan des pancartes qui en ont un ; cache les textes inutilisés. */
  afficher(pancartes: readonly PancarteAffichee[], profondeur: (p: PancarteAffichee) => number): void {
    let n = 0;
    for (const p of pancartes) {
      if (p.slogan === null) continue;
      const entree = this.#textes[n] ?? this.#nouveau();
      n += 1;
      const couleur = `#${p.couleur.texte.toString(16).padStart(6, '0')}`;
      const cle = `${p.slogan}|${couleur}`;
      if (entree.cle !== cle) {
        entree.texte.setColor(couleur).setText(p.slogan);
        entree.cle = cle;
      }
      const [zl, zh] = ZONE_TEXTE[p.forme];
      const echelle = Math.min((p.largeur * zl) / entree.texte.width, (p.hauteur * zh) / entree.texte.height);
      entree.texte.setPosition(p.x, p.y).setScale(echelle).setDepth(profondeur(p)).setVisible(true);
    }
    for (let i = n; i < this.#textes.length; i++) this.#textes[i]!.texte.setVisible(false);
  }

  #nouveau() {
    const texte = this.#scene.add
      .text(0, 0, '', {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: `${POLICE_PX}px`,
        fontStyle: 'bold',
        align: 'center',
        wordWrap: { width: LARGEUR_LIGNE_PX },
      })
      .setOrigin(0.5, 0.5)
      .setResolution(Math.min(window.devicePixelRatio || 1, 3));
    const entree = { texte, cle: '' };
    this.#textes.push(entree);
    return entree;
  }
}
