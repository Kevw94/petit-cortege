/**
 * Cuisson des tuiles du décor sur un canvas 2D, sans moteur de rendu : partagée par la vue
 * 2D (Phaser, decor/rendu.ts) et la vue 3D (Three.js, vue3d/).
 */
import { TAILLE_BLOC, TAILLE_TUILE_PX, type BlocDecor, type Decor, type TilesetTiled } from '@petit-cortege/shared';
import urlRpg from '../../../assets/kenney/rpg/Spritesheet/roguelikeSheet_transparent.png';
import urlVille from '../../../assets/kenney/city/Spritesheet/roguelikeCity_transparent.png';

/** Images des tilesets Kenney (CC0), par nom de tileset Tiled. */
export const IMAGES_TILESETS: Record<string, string> = { roguelikeCity: urlVille, roguelikeSheet: urlRpg };

/** Image d'un tileset par son nom (undefined : pas encore chargée). */
export type ImagesTilesets = (nom: string) => CanvasImageSource | undefined;

export interface SourceTuile {
  image: CanvasImageSource;
  sx: number;
  sy: number;
}

/** Image et position dans la planche d'un gid (0 = vide). */
export function sourceDeTuile(tilesets: readonly TilesetTiled[], images: ImagesTilesets, gid: number): SourceTuile | null {
  if (gid === 0) return null;
  const tileset = tilesets.reduce<TilesetTiled | null>((t, c) => (gid >= c.firstgid ? c : t), null);
  const image = tileset && images(tileset.name);
  if (!tileset || !image) return null;
  const i = gid - tileset.firstgid;
  const pas = tileset.tilewidth + tileset.spacing;
  return { image, sx: tileset.margin + (i % tileset.columns) * pas, sy: tileset.margin + Math.floor(i / tileset.columns) * pas };
}

/** Dessine les couches d'un bloc dans un canvas (16 px par tuile) ; renvoie aussi les rangées non vides. */
export function cuireBloc(
  decor: Decor,
  images: ImagesTilesets,
  bloc: BlocDecor,
  couches: readonly string[],
): { canvas: HTMLCanvasElement; rangees: number[] } {
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
      const source = sourceDeTuile(decor.tilesets, images, gid);
      if (!source) return;
      const rangee = Math.floor(i / TAILLE_BLOC);
      pleines.add(rangee);
      const x = (i % TAILLE_BLOC) * TAILLE_TUILE_PX;
      ctx.drawImage(source.image, source.sx, source.sy, TAILLE_TUILE_PX, TAILLE_TUILE_PX, x, rangee * TAILLE_TUILE_PX, TAILLE_TUILE_PX, TAILLE_TUILE_PX);
    });
  }
  return { canvas, rangees: [...pleines].sort((a, b) => a - b) };
}

/** Vue d'ensemble : un pixel par tuile, de la couleur moyenne de la tuile la plus haute des `couches`. */
export function dessinerVueDEnsemble(decor: Decor, images: ImagesTilesets, couches: readonly string[] = decor.nomsCouches): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, decor.largeur);
  canvas.height = Math.max(1, decor.hauteur);
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  const couleurs = new Map<number, number[]>();
  const echantillon = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const couleur = (gid: number) => {
    let c = couleurs.get(gid);
    if (!c) {
      c = [0, 0, 0, 0];
      const s = sourceDeTuile(decor.tilesets, images, gid);
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
  for (const bloc of decor.blocs.values()) {
    for (let i = 0; i < TAILLE_BLOC * TAILLE_BLOC; i++) {
      const x = bloc.x + (i % TAILLE_BLOC);
      const y = bloc.y + Math.floor(i / TAILLE_BLOC);
      if (x >= canvas.width || y >= canvas.height) continue;
      let gid = 0;
      for (const nom of couches) gid = bloc.couches[nom]?.[i] || gid;
      if (gid === 0) continue;
      pixels.data.set(couleur(gid), (y * canvas.width + x) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

/** Charge les images des tilesets (pour la vue 3D ; la vue 2D passe par le chargeur Phaser). */
export async function chargerImagesTilesets(): Promise<ImagesTilesets> {
  const charger = (url: string) =>
    new Promise<HTMLImageElement>((resoudre, rejeter) => {
      const image = new Image();
      image.onload = () => resoudre(image);
      image.onerror = () => rejeter(new Error(`Image introuvable : ${url}`));
      image.src = url;
    });
  const images = new Map(await Promise.all(Object.entries(IMAGES_TILESETS).map(async ([nom, url]) => [nom, await charger(url)] as const)));
  return (nom) => images.get(nom);
}
