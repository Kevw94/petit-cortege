/**
 * Rendu Phaser de la masse de foule : des paquets d'avatars précomposés à partir des
 * couches Kenney de l'atlas d'apparence (mêmes pièces et même palette que les avatars,
 * aucun dessin à la main), posés en tampons le long du parcours sous les avatars tirés.
 */
import * as Phaser from 'phaser';
import { apparenceAuHasard, encoderApparence } from '@petit-cortege/shared';
import { CELLULE_APPARENCE, dessinerApparence } from '../apparence/dessin';
import { CLE_COUCHES } from '../apparence/texture';
import type { TronconDeFoule } from '../cortege/foule';
import { COLONNES_FOULE, PAS_FOULE_M } from '../cortege/cortege';
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
}

/** Largeur de la bande de foule : celle de la grille du Cortège, plus un demi-pas de chaque côté. */
const LARGEUR_BANDE_M = COLONNES_FOULE * PAS_FOULE_M;
/** Plafond de tampons calculés par image, avant élimination hors écran. */
const TAMPONS_MAX = 6000;

const CLE_PAQUETS = 'masse-paquets';
/** Un paquet : quelques avatars serrés sur trois rangs (pixels de l'atlas, 5 m × 3,25 m). */
export const PAQUET = { largeur: 40, hauteur: 26 } as const;
export const VARIANTES_PAQUET = 8;
/** Rangs d'un paquet : hauteur des pieds et nombre d'avatars, du fond vers l'avant. */
const RANGS = [
  { pieds: 14, nombre: 4 },
  { pieds: 20, nombre: 5 },
  { pieds: 26, nombre: 4 },
] as const;
/** La masse est un peu assombrie : les avatars tirés au premier plan s'en détachent. */
const TEINTE_MASSE = 0xb4b4bc;

/** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes paquets chez tout le monde. */
function alea(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    for (let v = 0; v < VARIANTES_PAQUET; v++) {
      const hasard = alea(0x5eed + v);
      const x0 = v * PAQUET.largeur;
      texture.context.save();
      texture.context.beginPath();
      texture.context.rect(x0, 0, PAQUET.largeur, PAQUET.hauteur);
      texture.context.clip();
      for (const { pieds, nombre } of RANGS) {
        const ecart = PAQUET.largeur / nombre;
        for (let i = 0; i < nombre; i++) {
          const centre = Math.round(x0 + (i + 0.5) * ecart + (hasard() - 0.5) * ecart * 0.5);
          const indice = encoderApparence(apparenceAuHasard(hasard));
          dessinerApparence(
            texture.context,
            couches,
            indice,
            centre - CELLULE_APPARENCE.largeur / 2,
            pieds - CELLULE_APPARENCE.hauteur - Math.round(hasard()),
          );
        }
      }
      texture.context.restore();
      texture.add(String(v), 0, x0, 0, PAQUET.largeur, PAQUET.hauteur);
    }
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
    const aLEcran: (Tampon & { x: number; y: number })[] = [];
    for (const tampon of tampons) {
      const { x, y } = vue.placer(tampon.distanceM, tampon.decalageM);
      if (x + largeurPx / 2 < 0 || x - largeurPx / 2 > largeur || y < 0 || y - hauteurPx > hauteur) continue;
      aLEcran.push({ ...tampon, x, y });
    }
    this.afficher(aLEcran, echelleSprite, vue.profondeurMin, vue.profondeurMax);
  }

  /**
   * Affiche les tampons (pieds en pixels écran), à l'échelle des sprites d'avatars, entre
   * les profondeurs `profondeurMin` et `profondeurMax` selon y (les plus bas devant).
   */
  afficher(
    tampons: readonly (Tampon & { x: number; y: number })[],
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
        .setPosition(tampon.x, tampon.y)
        .setScale(echelle)
        .setDepth(profondeurMin + relatif * (profondeurMax - profondeurMin))
        .setVisible(true);
    });
    for (let i = tampons.length; i < this.#images.length; i++) this.#images[i]!.setVisible(false);
  }
}
