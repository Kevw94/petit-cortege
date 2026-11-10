/**
 * Rendu Phaser du décor : une vue d'ensemble (1 pixel par tuile, couleur
 * moyenne de la tuile) toujours affichée, et, de près, les blocs de 32 × 32
 * tuiles visibles, dessinés à la demande dans une texture chacun (chargement
 * par blocs ; les blocs sortis de l'écran sont libérés au-delà d'un plafond).
 *
 * Les bâtiments (COUCHES_BATIMENTS) ne sont pas cuits avec le sol : chaque bloc
 * a une seconde texture, découpée en rangées de tuiles, et chaque rangée prend
 * la profondeur de son bord bas à l'écran (profondeur = y, comme les avatars) :
 * une façade passe devant ce qui est derrière elle. Les noms des places
 * traversées sont affichés par-dessus.
 *
 * Coordonnées : mètres depuis l'origine du décor, projetés à l'écran par le cadrage.
 */
import * as Phaser from 'phaser';
import {
  COUCHES_BATIMENTS,
  METRES_PAR_TUILE,
  TAILLE_BLOC,
  TAILLE_TUILE_PX,
  type BlocDecor,
  type Decor,
} from '@petit-cortege/shared';
import type { PointM, PointPx } from '../cadrage';
import { arbresAPlanter, dessinerArbres } from './arbres';
import { blocsVisibles, COTE_BLOC_M } from './blocs';
import { cuireBloc, dessinerVueDEnsemble, IMAGES_TILESETS, type ImagesTilesets } from './cuisson';
import { NomsDesPlaces } from './places';

const cleTexture = (nom: string) => `tileset-${nom}`;

/** En deçà (pixels par mètre), on n'affiche que la vue d'ensemble : une tuile y fait moins de 3 px. */
export const ECHELLE_MIN_BLOCS = 1.5;
/** Blocs gardés en texture (≈ 1 Mo chacun) ; au-delà, les moins récents hors de l'écran sont libérés. */
const BLOCS_EN_MEMOIRE_MAX = 64;
/** Blocs dessinés par image au plus, pour éviter les à-coups pendant un déplacement. */
const BLOCS_DESSINES_PAR_IMAGE = 4;
const PROFONDEUR_DECOR = -100;

export function prechargerDecor(scene: Phaser.Scene): void {
  for (const [nom, url] of Object.entries(IMAGES_TILESETS)) scene.load.image(cleTexture(nom), url);
}

interface BlocAffiche {
  image: Phaser.GameObjects.Image;
  cle: string;
  vu: number;
  /** Rangées de bâtiments (indice de rangée dans le bloc → image), sur la texture `cleBatiments`. */
  rangees: { rangee: number; image: Phaser.GameObjects.Image }[];
  cleBatiments: string | null;
}

/** Profondeur d'un objet selon la position y (écran) de sa base. */
export type ProfondeurSelonY = (y: number) => number;

export class DecorAffiche {
  readonly #scene: Phaser.Scene;
  readonly #decor: Decor;
  readonly #ensemble: Phaser.GameObjects.Image;
  readonly #blocs = new Map<BlocDecor, BlocAffiche>();
  readonly #couchesSol: string[];
  readonly #couchesBatiments: string[];
  readonly #places: NomsDesPlaces;
  readonly #images: ImagesTilesets;
  /** Arbres (OSM) : sprite, pied en mètres et taille en mètres. */
  readonly #arbres: { sprite: Phaser.GameObjects.Image; pied: PointM; largeurM: number; hauteurM: number }[] = [];
  #image = 0;
  #numeroTexture = 0;

  /** `date` : celle de la manif, pour la saison des arbres. */
  constructor(scene: Phaser.Scene, decor: Decor, date: Date) {
    this.#scene = scene;
    this.#decor = decor;
    this.#couchesSol = decor.nomsCouches.filter((c) => !COUCHES_BATIMENTS.includes(c));
    this.#couchesBatiments = decor.nomsCouches.filter((c) => COUCHES_BATIMENTS.includes(c));
    this.#images = (nom) =>
      scene.textures.exists(cleTexture(nom)) ? (scene.textures.get(cleTexture(nom)).getSourceImage() as CanvasImageSource) : undefined;
    this.#places = new NomsDesPlaces(scene, decor);
    const cle = `decor-ensemble-${Phaser.Math.RND.uuid()}`;
    scene.textures.addCanvas(cle, dessinerVueDEnsemble(decor, this.#images))!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.#ensemble = scene.add.image(0, 0, cle).setOrigin(0, 0).setDepth(PROFONDEUR_DECOR);
    this.#planterArbres(date);
  }

  #planterArbres(date: Date): void {
    const planche = this.#images('roguelikeSheet');
    if (!planche || this.#decor.arbres.length === 0) return;
    const cle = `arbres-${Phaser.Math.RND.uuid()}`;
    const texture = this.#scene.textures.addCanvas(cle, dessinerArbres(planche))!;
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    for (const { pied, largeurM, hauteurM, cadre } of arbresAPlanter(this.#decor.arbres, date)) {
      const nom = `${cadre.x},${cadre.y}`;
      if (!texture.has(nom)) texture.add(nom, 0, cadre.x, cadre.y, cadre.largeur, cadre.hauteur);
      this.#arbres.push({ sprite: this.#scene.add.image(0, 0, cle, nom).setOrigin(0.5, 1).setVisible(false), pied, largeurM, hauteurM });
    }
  }

  /**
   * Place le décor pour ce cadrage (à appeler à chaque image : dessine les blocs manquants peu à peu).
   * `profondeur` : celle des avatars selon leur y à l'écran, appliquée aux rangées de bâtiments.
   */
  afficher(
    cadrage: { centre: PointM; echelle: number },
    ecran: { largeur: number; hauteur: number },
    vers: (p: PointM) => PointPx,
    profondeur: ProfondeurSelonY = () => PROFONDEUR_DECOR + 2,
  ): void {
    this.#image++;
    placer(this.#ensemble, vers({ x: 0, y: 0 }), vers({ x: this.#decor.largeur * METRES_PAR_TUILE, y: this.#decor.hauteur * METRES_PAR_TUILE }));

    const visibles = cadrage.echelle >= ECHELLE_MIN_BLOCS ? blocsVisibles(this.#decor, cadrage, ecran) : [];
    let aDessiner = BLOCS_DESSINES_PAR_IMAGE;
    for (const bloc of visibles) {
      let affiche = this.#blocs.get(bloc);
      if (!affiche) {
        if (aDessiner-- <= 0) continue;
        affiche = this.#dessinerBloc(bloc);
        this.#blocs.set(bloc, affiche);
      }
      affiche.vu = this.#image;
      const coin = { x: bloc.x * METRES_PAR_TUILE, y: bloc.y * METRES_PAR_TUILE };
      placer(affiche.image.setVisible(true), vers(coin), vers({ x: coin.x + COTE_BLOC_M, y: coin.y + COTE_BLOC_M }));
      for (const { rangee, image } of affiche.rangees) {
        const haut = coin.y + rangee * METRES_PAR_TUILE;
        const b = vers({ x: coin.x + COTE_BLOC_M, y: haut + METRES_PAR_TUILE });
        placer(image.setVisible(true), vers({ x: coin.x, y: haut }), b);
        image.setDepth(profondeur(b.y));
      }
    }
    for (const affiche of this.#blocs.values()) {
      if (affiche.vu === this.#image) continue;
      affiche.image.setVisible(false);
      for (const { image } of affiche.rangees) image.setVisible(false);
    }
    if (this.#blocs.size > BLOCS_EN_MEMOIRE_MAX) this.#liberer();
    // Arbres : à l'écran seulement, profondeur selon le pied (comme les avatars et les façades) ;
    // de loin (sous le seuil des blocs détaillés), ils s'effacent avec le reste du détail.
    const arbresVisibles = cadrage.echelle >= ECHELLE_MIN_BLOCS;
    for (const { sprite, pied, largeurM, hauteurM } of this.#arbres) {
      if (!arbresVisibles) {
        sprite.setVisible(false);
        continue;
      }
      const p = vers(pied);
      const l = largeurM * cadrage.echelle;
      const h = hauteurM * cadrage.echelle;
      const visible = p.x > -l && p.x < ecran.largeur + l && p.y > 0 && p.y < ecran.hauteur + h;
      sprite.setVisible(visible);
      if (visible) sprite.setPosition(Math.round(p.x), Math.round(p.y)).setDisplaySize(l, h).setDepth(profondeur(p.y));
    }
    this.#places.afficher(vers, ecran);
  }

  #liberer(): void {
    const anciens = [...this.#blocs].filter(([, a]) => a.vu !== this.#image).sort(([, a], [, b]) => a.vu - b.vu);
    for (const [bloc, affiche] of anciens.slice(0, this.#blocs.size - BLOCS_EN_MEMOIRE_MAX)) {
      affiche.image.destroy();
      this.#scene.textures.remove(affiche.cle);
      for (const { image } of affiche.rangees) image.destroy();
      if (affiche.cleBatiments) this.#scene.textures.remove(affiche.cleBatiments);
      this.#blocs.delete(bloc);
    }
  }

  #dessinerBloc(bloc: BlocDecor): BlocAffiche {
    const sol = this.#cuire(bloc, this.#couchesSol);
    const image = this.#scene.add.image(0, 0, sol.cle).setOrigin(0, 0).setDepth(PROFONDEUR_DECOR + 1);
    const affiche: BlocAffiche = { image, cle: sol.cle, vu: 0, rangees: [], cleBatiments: null };
    if (!this.#couchesBatiments.some((nom) => bloc.couches[nom]?.some((gid) => gid !== 0))) return affiche;
    const batiments = this.#cuire(bloc, this.#couchesBatiments);
    const texture = this.#scene.textures.get(batiments.cle);
    affiche.cleBatiments = batiments.cle;
    for (const rangee of batiments.rangees) {
      const cadre = `r${rangee}`;
      texture.add(cadre, 0, 0, rangee * TAILLE_TUILE_PX, TAILLE_BLOC * TAILLE_TUILE_PX, TAILLE_TUILE_PX);
      affiche.rangees.push({ rangee, image: this.#scene.add.image(0, 0, batiments.cle, cadre).setOrigin(0, 0) });
    }
    return affiche;
  }

  /** Dessine les couches d'un bloc dans une texture ; renvoie sa clé et les rangées non vides. */
  #cuire(bloc: BlocDecor, couches: string[]): { cle: string; rangees: number[] } {
    const { canvas, rangees } = cuireBloc(this.#decor, this.#images, bloc, couches);
    const cle = `decor-bloc-${this.#numeroTexture++}-${Phaser.Math.RND.uuid()}`;
    this.#scene.textures.addCanvas(cle, canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return { cle, rangees };
  }
}

/** Étire une image entre deux coins à l'écran, arrondis au pixel (pas de joint entre blocs voisins). */
export function placer(image: Phaser.GameObjects.Image, a: PointPx, b: PointPx): void {
  const x0 = Math.round(a.x);
  const y0 = Math.round(a.y);
  image.setPosition(x0, y0).setDisplaySize(Math.round(b.x) - x0, Math.round(b.y) - y0);
}
