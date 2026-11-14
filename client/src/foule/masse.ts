/**
 * Rendu Phaser de la masse de foule : des paquets d'avatars précomposés à partir des
 * couches Kenney de l'atlas d'apparence (mêmes pièces et même palette que les avatars,
 * aucun dessin à la main), posés en tampons le long du parcours sous les avatars tirés.
 */
import * as Phaser from 'phaser';
import { CLE_COUCHES } from '../apparence/texture';
import type { TronconDeFoule } from '../cortege/foule';
import { COLONNES_FOULE, PAS_FOULE_M } from '../cortege/cortege';
import { dessinerPaquets, PAQUET, TEINTE_MASSE, VARIANTES_PAQUET } from './paquets';
import { tamponsDeMasse, type Tampon } from './tampons';

export interface VueMasse {
  /** Origine du repère qui avance avec la foule (`Cortege.avanceeM`). */
  repereM: number;
  /** Position à l'écran (pixels) d'un point du cortège. */
  placer: (distanceM: number, decalageM: number) => { x: number; y: number };
  /** Zoom de la vue, en pixels par mètre. */
  echelle: number;
  /** Échelle des sprites d'avatars (pixels écran par pixel de l'atlas). */
  echelleSprite: number;
  largeur: number;
  hauteur: number;
  /** Profondeurs de la masse : sous les avatars tirés. */
  profondeurMin: number;
  profondeurMax: number;
  /** Ondulation de marche d'un tampon, en pixels entiers de l'atlas (0 par défaut : immobile). */
  sautPxAtlas?: (tampon: Tampon) => number;
}

/** Largeur de la bande de foule : celle de la grille du Cortège, plus un demi-pas de chaque côté. */
const LARGEUR_BANDE_M = COLONNES_FOULE * PAS_FOULE_M;
/** Plafond de tampons calculés par image, avant élimination hors écran. */
const TAMPONS_MAX = 6000;

const CLE_PAQUETS = 'masse-paquets';

export class MasseDeFoule {
  readonly #scene: Phaser.Scene;
  readonly #images: Phaser.GameObjects.Image[] = [];

  /** À créer dans `create` (les couches d'apparence doivent être chargées). */
  constructor(scene: Phaser.Scene) {
    this.#scene = scene;
    if (scene.textures.exists(CLE_PAQUETS)) scene.textures.remove(CLE_PAQUETS);
    const texture = scene.textures.createCanvas(CLE_PAQUETS, PAQUET.largeur * VARIANTES_PAQUET, PAQUET.hauteur)!;
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const couches = scene.textures.get(CLE_COUCHES).getSourceImage() as CanvasImageSource;
    dessinerPaquets(texture.context, couches);
    for (let v = 0; v < VARIANTES_PAQUET; v++) texture.add(String(v), 0, v * PAQUET.largeur, 0, PAQUET.largeur, PAQUET.hauteur);
    texture.refresh();
  }

  /** Affiche la masse le long des tronçons en masse, tampons hors écran éliminés. */
  afficherLeLong(troncons: readonly TronconDeFoule[], vue: VueMasse): void {
    const { echelle, echelleSprite, largeur, hauteur } = vue;
    // Tampons à moitié recouverts le long du parcours et sur la largeur, jamais plus serrés que
    // le paquet à l'écran : de loin, le pas en mètres s'allonge.
    const largeurPx = PAQUET.largeur * echelleSprite;
    const hauteurPx = PAQUET.hauteur * echelleSprite;
    const pasM = (largeurPx * 0.5) / echelle;
    const rangees = Math.max(1, Math.ceil((LARGEUR_BANDE_M * echelle) / (Math.min(largeurPx, hauteurPx) * 0.5)));
    const tampons = tamponsDeMasse(troncons, {
      repereM: vue.repereM,
      pasM,
      largeurM: LARGEUR_BANDE_M,
      rangees,
      variantes: VARIANTES_PAQUET,
      maximum: TAMPONS_MAX,
    });
    const aLEcran: (Tampon & { x: number; y: number; saut: number })[] = [];
    for (const tampon of tampons) {
      const { x, y } = vue.placer(tampon.distanceM, tampon.decalageM);
      if (x + largeurPx / 2 < 0 || x - largeurPx / 2 > largeur || y < 0 || y - hauteurPx > hauteur) continue;
      // Ondulation : le paquet monte d'un pixel de l'atlas agrandi ; la profondeur reste celle du sol.
      const saut = vue.sautPxAtlas ? vue.sautPxAtlas(tampon) * echelleSprite : 0;
      aLEcran.push({ ...tampon, x, y, saut });
    }
    this.afficher(aLEcran, echelleSprite, vue.profondeurMin, vue.profondeurMax);
  }

  /**
   * Affiche les tampons (pieds en pixels écran, `saut` : ondulation de marche en pixels écran), à l'échelle des sprites d'avatars, entre
   * les profondeurs `profondeurMin` et `profondeurMax` selon y (les plus bas devant).
   */
  afficher(
    tampons: readonly (Tampon & { x: number; y: number; saut?: number })[],
    echelle: number,
    profondeurMin: number,
    profondeurMax: number,
  ): void {
    const hauteurEcran = Math.max(this.#scene.scale.gameSize.height, 1);
    tampons.forEach((tampon, i) => {
      let image = this.#images[i];
      if (!image) {
        image = this.#scene.add.image(0, 0, CLE_PAQUETS, '0').setOrigin(0.5, 1).setTint(TEINTE_MASSE);
        this.#images.push(image);
      }
      const relatif = Math.min(Math.max(tampon.y / hauteurEcran, 0), 1);
      image
        .setFrame(String(tampon.variante), false, false)
        .setPosition(tampon.x, tampon.y - (tampon.saut ?? 0))
        .setScale(echelle)
        .setDepth(profondeurMin + relatif * (profondeurMax - profondeurMin))
        .setVisible(true);
    });
    for (let i = tampons.length; i < this.#images.length; i++) this.#images[i]!.setVisible(false);
  }
}
