/**
 * Texture Phaser des apparences précomposées : chaque indice d'apparence rencontré est
 * dessiné une fois (toutes ses couches) dans un emplacement d'une grande texture
 * canvas ; les avatars sont ensuite de simples `Image` sur cet emplacement (un quad).
 */
import * as Phaser from 'phaser';
import { Emplacements } from './affichage';
import { CELLULE_APPARENCE, dessinerApparence, URL_COUCHES_APPARENCE } from './dessin';

const CLE_COUCHES = 'apparence-couches';
export const CLE_APPARENCES = 'apparences';
/** 64 × 64 emplacements (1600 × 1088 px) : bien plus que les apparences visibles à la fois. */
const COLONNES = 64;
const RANGEES = 64;
/** Pixel transparent entre deux emplacements : sinon, à l'échelle non entière, le bord voisin déborde. */
const ESPACE = 1;

/** À appeler dans `preload` de la scène. */
export function chargerCouchesApparence(scene: Phaser.Scene): void {
  scene.load.image(CLE_COUCHES, URL_COUCHES_APPARENCE);
}

export class TextureApparences {
  readonly #texture: Phaser.Textures.CanvasTexture;
  readonly #couches: CanvasImageSource;
  readonly #emplacements = new Emplacements(COLONNES * RANGEES);
  #aRafraichir = false;

  /** À créer dans `create` (les couches doivent être chargées). */
  constructor(scene: Phaser.Scene) {
    const { largeur, hauteur } = CELLULE_APPARENCE;
    if (scene.textures.exists(CLE_APPARENCES)) scene.textures.remove(CLE_APPARENCES);
    this.#texture = scene.textures.createCanvas(
      CLE_APPARENCES,
      COLONNES * (largeur + ESPACE),
      RANGEES * (hauteur + ESPACE),
    )!;
    this.#texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.#couches = scene.textures.get(CLE_COUCHES).getSourceImage() as CanvasImageSource;
  }

  /** Nom du cadre de la texture qui montre cette apparence (dessinée au besoin). */
  cadre(indice: number): string {
    const { numero, nouveau, reinitialise } = this.#emplacements.prendre(indice);
    const nom = String(numero);
    if (!nouveau) return nom;
    const { largeur, hauteur } = CELLULE_APPARENCE;
    const x = (numero % COLONNES) * (largeur + ESPACE);
    const y = Math.floor(numero / COLONNES) * (hauteur + ESPACE);
    const contexte = this.#texture.context;
    if (reinitialise) contexte.clearRect(0, 0, this.#texture.width, this.#texture.height);
    else contexte.clearRect(x, y, largeur, hauteur);
    dessinerApparence(contexte, this.#couches, indice, x, y);
    if (!this.#texture.has(nom)) this.#texture.add(nom, 0, x, y, largeur, hauteur);
    this.#aRafraichir = true;
    return nom;
  }

  /** Envoie au GPU les apparences dessinées depuis la dernière image. */
  actualiser(): void {
    if (!this.#aRafraichir) return;
    this.#aRafraichir = false;
    this.#texture.refresh();
  }
}
