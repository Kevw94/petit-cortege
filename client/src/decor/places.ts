/**
 * Noms des places traversées par le parcours, dont la place d'arrivée (ADR
 * 0006 : place générique du tileset, avec son nom affiché ; aucun monument,
 * aucun nom de rue). Libellé sous le centre de la place (les libellés « Départ » et
 * « Arrivée » sont au-dessus de leur point), au-dessus de la foule, gardé dans l'écran.
 */
import * as Phaser from 'phaser';
import { METRES_PAR_TUILE, type Decor } from '@petit-cortege/shared';
import type { PointM, PointPx } from '../cadrage';

/** Au-dessus des avatars et de leurs pancartes (voir PROFONDEUR dans scene-cortege.ts). */
const PROFONDEUR_NOMS = 9;
const ECART_PX = 6;
const MARGE_PX = 4;

export class NomsDesPlaces {
  readonly #libelles: { texte: Phaser.GameObjects.Text; position: PointM }[];

  constructor(scene: Phaser.Scene, decor: Decor) {
    this.#libelles = decor.places.map((place) => ({
      position: { x: place.x * METRES_PAR_TUILE, y: place.y * METRES_PAR_TUILE },
      texte: scene.add
        .text(0, 0, place.nom, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: place.arrivee ? '14px' : '12px',
          fontStyle: place.arrivee ? 'bold italic' : 'italic',
          color: '#2b2b2b',
        })
        .setBackgroundColor('rgba(255, 255, 255, 0.82)')
        .setPadding(5, 2, 5, 2)
        .setOrigin(0.5, 0)
        .setDepth(PROFONDEUR_NOMS),
    }));
  }

  afficher(vers: (p: PointM) => PointPx, ecran: { largeur: number; hauteur: number }): void {
    for (const { texte, position } of this.#libelles) {
      const p = vers(position);
      const demi = texte.width / 2;
      const x = Math.min(Math.max(p.x, demi + MARGE_PX), Math.max(ecran.largeur - demi - MARGE_PX, demi + MARGE_PX));
      texte.setPosition(Math.round(x), Math.round(p.y + ECART_PX));
    }
  }
}
