/**
 * Catalogue des pancartes (V1) : slogan + couleur + forme, sans picto (ADR 0006),
 * sans texte libre ni image importée. Défini une seule fois ici, importé par le
 * client (composition, rendu), le serveur (validation de l'indice) et les scripts.
 *
 * Un avatar ne stocke qu'un **indice de pancarte** (entier compact, champ `pa` des
 * fichiers publiés) : trois champs de bits de capacité fixe, pour que le catalogue
 * puisse grandir sans changer l'indice des pancartes existantes.
 *
 *   bits 0-3  couleur (16 places)
 *   bits 4-5  forme   (4 places)
 *   bits 6-13 slogan  (256 places)    → indice ≤ 0x3fff
 *
 * Règle de versionnement : on **ajoute en fin de liste**, on ne retire ni ne
 * réordonne jamais une entrée (les indices déjà publiés changeraient de sens).
 * Toute évolution incrémente `VERSION_CATALOGUE_PANCARTES`.
 */

export const VERSION_CATALOGUE_PANCARTES = 1;

/**
 * Slogans génériques et neutres, écrits par le porteur : ils disent le soutien
 * sans parler à la place du mouvement ni prendre parti pour une cause (ADR 0003).
 */
export const SLOGANS: readonly string[] = [
  'On est là',
  'Avec vous',
  'Solidarité',
  'Je soutiens',
  'Ensemble',
  'Je marche avec vous',
  'Même de loin',
  'De tout cœur avec vous',
  'Pas seuls',
  'Tous ensemble',
  'Merci',
  'Courage',
  'Ici aussi',
  'Toujours là',
];

export interface CouleurPancarte {
  nom: string;
  /** Couleur du panneau, `0xRRGGBB`. */
  fond: number;
  /** Couleur du slogan, contrastée avec le fond. */
  texte: number;
}

/** Couleurs vives et distinctes de loin, dans l'esprit de la palette Kenney. */
export const COULEURS_PANCARTE: readonly CouleurPancarte[] = [
  { nom: 'blanc', fond: 0xf5f2e8, texte: 0x222222 },
  { nom: 'rouge', fond: 0xd2463c, texte: 0xffffff },
  { nom: 'orange', fond: 0xee8a2f, texte: 0x222222 },
  { nom: 'jaune', fond: 0xf3cf3d, texte: 0x222222 },
  { nom: 'vert', fond: 0x4f9b47, texte: 0xffffff },
  { nom: 'turquoise', fond: 0x3fb3b0, texte: 0x222222 },
  { nom: 'bleu', fond: 0x3b6fc4, texte: 0xffffff },
  { nom: 'violet', fond: 0x8456b8, texte: 0xffffff },
  { nom: 'rose', fond: 0xee8fb5, texte: 0x222222 },
  { nom: 'noir', fond: 0x2b2b2b, texte: 0xffffff },
];

export type FormePancarte = 'rectangle' | 'portrait' | 'rond' | 'losange';

/** Formes du panneau (sur un manche), reconnaissables de loin. */
export const FORMES_PANCARTE: readonly FormePancarte[] = ['rectangle', 'portrait', 'rond', 'losange'];

/** Une pancarte composée : trois positions dans les listes du catalogue. */
export interface CompositionPancarte {
  slogan: number;
  couleur: number;
  forme: number;
}

const BITS_COULEUR = 4;
const BITS_FORME = 2;
const BITS_SLOGAN = 8;
const masque = (bits: number) => (1 << bits) - 1;
/** Plus grand indice représentable (capacité des champs, pas taille actuelle du catalogue). */
export const INDICE_PANCARTE_MAX = masque(BITS_COULEUR + BITS_FORME + BITS_SLOGAN);

/** Indice compact d'une pancarte composée (stocké par l'avatar, publié en `pa`). */
export function encoderPancarte({ slogan, couleur, forme }: CompositionPancarte): number {
  return couleur | (forme << BITS_COULEUR) | (slogan << (BITS_COULEUR + BITS_FORME));
}

/** Pancarte d'un indice ; `null` si l'indice ne désigne pas une pancarte du catalogue. */
export function decoderPancarte(indice: number): CompositionPancarte | null {
  if (!Number.isInteger(indice) || indice < 0 || indice > INDICE_PANCARTE_MAX) return null;
  const composition = {
    couleur: indice & masque(BITS_COULEUR),
    forme: (indice >> BITS_COULEUR) & masque(BITS_FORME),
    slogan: (indice >> (BITS_COULEUR + BITS_FORME)) & masque(BITS_SLOGAN),
  };
  const dansLeCatalogue =
    composition.couleur < COULEURS_PANCARTE.length &&
    composition.forme < FORMES_PANCARTE.length &&
    composition.slogan < SLOGANS.length;
  return dansLeCatalogue ? composition : null;
}

/** Vrai si l'indice désigne une pancarte du catalogue (validation côté serveur). */
export const estIndicePancarte = (x: unknown): x is number => typeof x === 'number' && decoderPancarte(x) !== null;
