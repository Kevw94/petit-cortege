/**
 * Tuiles Kenney (CC0) utilisées par le décor, et leurs tilesets Tiled.
 * Indices (colonne, rangée) relevés sur les planches ; voir docs/assets/planche-kenney.py.
 */
import type { TilesetTiled } from '@petit-cortege/shared';

/** Roguelike Modern City : rues, trottoirs, pelouse, bâtiments (#13). */
const VILLE = { name: 'roguelikeCity', colonnes: 37, rangees: 28, chemin: 'city/Spritesheet/roguelikeCity_transparent.png' };
/** Roguelike RPG pack : eau, quais en pierre, berges naturelles. */
const RPG = { name: 'roguelikeSheet', colonnes: 57, rangees: 31, chemin: 'rpg/Spritesheet/roguelikeSheet_transparent.png' };

const PREMIER_GID_VILLE = 1;
const PREMIER_GID_RPG = PREMIER_GID_VILLE + VILLE.colonnes * VILLE.rangees;

const ville = (c: number, r: number) => PREMIER_GID_VILLE + r * VILLE.colonnes + c;
const rpg = (c: number, r: number) => PREMIER_GID_RPG + r * RPG.colonnes + c;

export const TUILES = {
  chaussee: ville(11, 19),
  trottoir: ville(1, 20),
  /** Trottoir dont le bord inférieur donne sur la chaussée : bordure visible en vue 3/4. */
  trottoirBordure: ville(1, 22),
  pieton: ville(4, 20),
  pietonBordure: ville(4, 22),
  /** Cœur d'îlot : toit gris uni (zinc), en attendant les bâtiments (#13). */
  ilot: ville(10, 3),
  vert: ville(0, 24),
  eau: rpg(3, 4),
  /** Quais en pierre autour de l'eau (pièce en 9 morceaux). */
  quai: {
    haut: rpg(3, 3),
    bas: rpg(3, 5),
    gauche: rpg(2, 4),
    droite: rpg(4, 4),
    hautGauche: rpg(2, 3),
    hautDroite: rpg(4, 3),
    basGauche: rpg(2, 5),
    basDroite: rpg(4, 5),
  },
} as const;

/** Tilesets de la carte ; `dossierKenney` : chemin de assets/kenney relatif au fichier de la carte. */
export function tilesets(dossierKenney: string): TilesetTiled[] {
  return [
    { ...VILLE, firstgid: PREMIER_GID_VILLE },
    { ...RPG, firstgid: PREMIER_GID_RPG },
  ].map(({ name, colonnes, rangees, chemin, firstgid }) => ({
    firstgid,
    name,
    image: `${dossierKenney}/${chemin}`,
    imagewidth: colonnes * 17 - 1,
    imageheight: rangees * 17 - 1,
    tilewidth: 16,
    tileheight: 16,
    margin: 0,
    spacing: 1,
    columns: colonnes,
    tilecount: colonnes * rangees,
  }));
}
