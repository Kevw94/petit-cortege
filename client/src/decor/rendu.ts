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
  type TilesetTiled,
} from '@petit-cortege/shared';
import urlRpg from '../../../assets/kenney/rpg/Spritesheet/roguelikeSheet_transparent.png';
import urlVille from '../../../assets/kenney/city/Spritesheet/roguelikeCity_transparent.png';
import type { PointM, PointPx } from '../cadrage';
import { blocsVisibles, COTE_BLOC_M } from './blocs';
import { NomsDesPlaces } from './places';

/** Images des tilesets Kenney (CC0), par nom de tileset Tiled. */
const IMAGES_TILESETS: Record<string, string> = { roguelikeCity: urlVille, roguelikeSheet: urlRpg };
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
  #image = 0;
  #numeroTexture = 0;

  constructor(scene: Phaser.Scene, decor: Decor) {
    this.#scene = scene;
    this.#decor = decor;
    this.#couchesSol = decor.nomsCouches.filter((c) => !COUCHES_BATIMENTS.includes(c));
    this.#couchesBatiments = decor.nomsCouches.filter((c) => COUCHES_BATIMENTS.includes(c));
    this.#places = new NomsDesPlaces(scene, decor);
    const cle = `decor-ensemble-${Phaser.Math.RND.uuid()}`;
    scene.textures.addCanvas(cle, this.#dessinerEnsemble())!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.#ensemble = scene.add.image(0, 0, cle).setOrigin(0, 0).setDepth(PROFONDEUR_DECOR);
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
    const cote = TAILLE_BLOC * TAILLE_TUILE_PX;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = cote;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const pleines = new Set<number>();
    for (const nom of couches) {
      const gids = bloc.couches[nom];
      if (!gids) continue;
      gids.forEach((gid, i) => {
        const source = this.#source(gid);
        if (!source) return;
        const rangee = Math.floor(i / TAILLE_BLOC);
        pleines.add(rangee);
        const x = (i % TAILLE_BLOC) * TAILLE_TUILE_PX;
        ctx.drawImage(source.image, source.sx, source.sy, TAILLE_TUILE_PX, TAILLE_TUILE_PX, x, rangee * TAILLE_TUILE_PX, TAILLE_TUILE_PX, TAILLE_TUILE_PX);
      });
    }
    const cle = `decor-bloc-${this.#numeroTexture++}-${Phaser.Math.RND.uuid()}`;
    this.#scene.textures.addCanvas(cle, canvas)!.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return { cle, rangees: [...pleines].sort((a, b) => a - b) };
  }

  /** Tileset, image et position dans la planche d'un gid (0 = vide). */
  #source(gid: number): { image: CanvasImageSource; sx: number; sy: number; tileset: TilesetTiled } | null {
    if (gid === 0) return null;
    const tileset = this.#decor.tilesets.reduce<TilesetTiled | null>((t, c) => (gid >= c.firstgid ? c : t), null);
    if (!tileset || !this.#scene.textures.exists(cleTexture(tileset.name))) return null;
    const i = gid - tileset.firstgid;
    const pas = tileset.tilewidth + tileset.spacing;
    return {
      image: this.#scene.textures.get(cleTexture(tileset.name)).getSourceImage() as CanvasImageSource,
      sx: tileset.margin + (i % tileset.columns) * pas,
      sy: tileset.margin + Math.floor(i / tileset.columns) * pas,
      tileset,
    };
  }

  /** Vue d'ensemble : un pixel par tuile, de la couleur moyenne de la tuile la plus haute. */
  #dessinerEnsemble(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, this.#decor.largeur);
    canvas.height = Math.max(1, this.#decor.hauteur);
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    const couleurs = new Map<number, number[]>();
    const echantillon = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const couleur = (gid: number) => {
      let c = couleurs.get(gid);
      if (!c) {
        c = [0, 0, 0, 0];
        const s = this.#source(gid);
        if (s) {
          echantillon.canvas.width = echantillon.canvas.height = TAILLE_TUILE_PX;
          echantillon.clearRect(0, 0, TAILLE_TUILE_PX, TAILLE_TUILE_PX);
          echantillon.drawImage(s.image, s.sx, s.sy, TAILLE_TUILE_PX, TAILLE_TUILE_PX, 0, 0, TAILLE_TUILE_PX, TAILLE_TUILE_PX);
          const d = echantillon.getImageData(0, 0, TAILLE_TUILE_PX, TAILLE_TUILE_PX).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3]! < 128) continue;
            c[0]! += d[i]!;
            c[1]! += d[i + 1]!;
            c[2]! += d[i + 2]!;
            n++;
          }
          c = n ? [c[0]! / n, c[1]! / n, c[2]! / n, 255] : c;
        }
        couleurs.set(gid, c);
      }
      return c;
    };
    for (const bloc of this.#decor.blocs.values()) {
      for (let i = 0; i < TAILLE_BLOC * TAILLE_BLOC; i++) {
        const x = bloc.x + (i % TAILLE_BLOC);
        const y = bloc.y + Math.floor(i / TAILLE_BLOC);
        if (x >= canvas.width || y >= canvas.height) continue;
        let gid = 0;
        for (const nom of this.#decor.nomsCouches) gid = bloc.couches[nom]?.[i] || gid;
        if (gid === 0) continue;
        pixels.data.set(couleur(gid), (y * canvas.width + x) * 4);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }
}

/** Étire une image entre deux coins à l'écran, arrondis au pixel (pas de joint entre blocs voisins). */
function placer(image: Phaser.GameObjects.Image, a: PointPx, b: PointPx): void {
  const x0 = Math.round(a.x);
  const y0 = Math.round(a.y);
  image.setPosition(x0, y0).setDisplaySize(Math.round(b.x) - x0, Math.round(b.y) - y0);
}
