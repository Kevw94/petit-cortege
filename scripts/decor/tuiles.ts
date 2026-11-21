/**
 * Tuiles Kenney (CC0) utilisées par le décor, et leurs tilesets Tiled.
 * Indices (colonne, rangée) relevés sur les planches ; voir docs/assets/planche-kenney.py.
 */
import type { TilesetTiled } from '@petit-cortege/shared';

/** Roguelike Modern City : rues, trottoirs, pelouse, bâtiments (#13). */
const VILLE = {
  name: 'roguelikeCity',
  colonnes: 37,
  rangees: 28,
  chemin: 'city/Spritesheet/roguelikeCity_transparent.png',
};
/** Roguelike RPG pack : eau, quais en pierre, berges naturelles. */
const RPG = {
  name: 'roguelikeSheet',
  colonnes: 57,
  rangees: 31,
  chemin: 'rpg/Spritesheet/roguelikeSheet_transparent.png',
};

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
  /** Cœur d'îlot hors bâtiments (cours, terrains non cartographiés) : gravier gris. */
  ilot: ville(8, 24),
  vert: ville(0, 24),
  /** Pâtés de maisons des alentours (sans bâtiments) : couleur moyenne du toit beige plein. */
  pateDeMaisons: ville(30, 0),
  /** Toits pleins d'ardoise claire et de zinc (teintes des îlots du plan de la ville). */
  toitArdoiseClaire: ville(22, 0),
  toitZinc: ville(14, 0),
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
  /** Garde-corps des ponts, posés par-dessus le tablier au bord de l'eau. */
  gardeCorps: {
    /** Lisses horizontales (bords nord et sud du tablier). */
    nord: rpg(52, 23),
    sud: rpg(52, 24),
    /** Poteaux le long du bord ouest / est. */
    ouest: rpg(51, 23),
    est: rpg(50, 23),
  },
} as const;

/** Toit en 9 morceaux et coins rentrants : planche Roguelike Modern City, 8 colonnes × 2 rangées par couleur. */
const toit = (c0: number) => ({
  hautGauche: ville(c0, 0),
  hautDroite: ville(c0 + 1, 0),
  haut: ville(c0 + 2, 0),
  gauche: ville(c0 + 3, 0),
  /** Coin rentrant : seule la case en diagonale (en bas à droite) n'est pas du toit. */
  creuxBasDroite: ville(c0 + 4, 0),
  creuxBasGauche: ville(c0 + 5, 0),
  plein: ville(c0 + 6, 0),
  /** Plusieurs coins rentrants. */
  creuxMultiples: ville(c0 + 7, 0),
  basGauche: ville(c0, 1),
  basDroite: ville(c0 + 1, 1),
  bas: ville(c0 + 2, 1),
  droite: ville(c0 + 3, 1),
  creuxHautDroite: ville(c0 + 4, 1),
  creuxHautGauche: ville(c0 + 5, 1),
});
export type PiecesToit = ReturnType<typeof toit>;

/** Rangée de façade : colonnes « seule » (pilastres des deux côtés), gauche, milieu, droite. */
const rangee = (c0: number, r: number) => ({
  seule: ville(c0, r),
  gauche: ville(c0 + 1, r),
  milieu: ville(c0 + 2, r),
  droite: ville(c0 + 3, r),
});
/** Façade : rangée sous le toit (haut), étages (milieu), soubassement (bas), ou rangée unique. */
const mur = (c0: number) => ({
  haut: rangee(c0, 9),
  milieu: rangee(c0, 5),
  bas: rangee(c0, 8),
  unique: rangee(c0, 10),
});
export type PiecesMur = ReturnType<typeof mur>;

export interface Materiau {
  nom: string;
  toit: PiecesToit;
  mur: PiecesMur;
  fenetre: number;
  porte: number;
}

const TOITS = { rouge: toit(0), zinc: toit(8), ardoiseClaire: toit(16), beige: toit(24) };
const MURS = { brique: mur(0), pierreGrise: mur(4), pierreBeige: mur(8) };
const FENETRES = { bois: ville(25, 16), boisLarge: ville(27, 16), grise: ville(25, 19), griseLarge: ville(27, 19) };
const PORTES = { brune: ville(20, 27), verte: ville(23, 27), orange: ville(26, 27) };

/** Matériaux des bâtiments (façades génériques) : pierre beige et zinc d'abord, comme à Paris. */
export const MATERIAUX: readonly Materiau[] = [
  { nom: 'pierre beige, zinc', toit: TOITS.zinc, mur: MURS.pierreBeige, fenetre: FENETRES.bois, porte: PORTES.brune },
  {
    nom: 'pierre beige, ardoise',
    toit: TOITS.ardoiseClaire,
    mur: MURS.pierreBeige,
    fenetre: FENETRES.grise,
    porte: PORTES.verte,
  },
  {
    nom: 'pierre grise, zinc',
    toit: TOITS.zinc,
    mur: MURS.pierreGrise,
    fenetre: FENETRES.griseLarge,
    porte: PORTES.brune,
  },
  { nom: 'brique, tuiles', toit: TOITS.rouge, mur: MURS.brique, fenetre: FENETRES.boisLarge, porte: PORTES.orange },
  {
    nom: 'pierre beige, toit beige',
    toit: TOITS.beige,
    mur: MURS.pierreBeige,
    fenetre: FENETRES.boisLarge,
    porte: PORTES.orange,
  },
];
/** Tirage pondéré des matériaux (indices dans MATERIAUX). */
export const TIRAGE_MATERIAUX: readonly number[] = [0, 0, 0, 1, 1, 2, 2, 3, 4];

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
