/**
 * Catalogue d'apparence (V1) : la **liste blanche explicite** des pièces qui composent
 * un avatar (ADR 0003). Tout ce qui n'y figure pas est exclu : couvre-chefs, casques,
 * armures, armes, boucliers, drapeaux, symboles. Défini une seule fois ici, importé par
 * le client (composition, rendu), le serveur (validation de l'indice) et le script qui
 * génère les variantes (`scripts/apparence/`, ADR 0006).
 *
 * Pièces : tuiles 16 × 16 de la planche Kenney Roguelike Characters (CC0), repérées par
 * `[colonne, rangée]`. Couleurs : rampes de la palette Kenney (`0xRRGGBB`), de la plus
 * sombre à la plus claire ; le script remplace les couleurs de la pièce d'origine par
 * celles de la rampe (changement de palette), rien n'est dessiné à la main.
 *
 * Un avatar ne stocke qu'un **indice d'apparence** (entier compact, champ `ap` des
 * fichiers publiés) : sept champs de bits de capacité fixe (25 bits, 4 octets),
 * pour que le catalogue puisse grandir sans changer l'indice des apparences existantes.
 *
 *   bits 0-2   teint               (8 places)
 *   bits 3-5   couleur des cheveux (8 places)
 *   bits 6-9   coupe               (16 places)
 *   bits 10-13 haut                (16 places)
 *   bits 14-17 couleur du haut     (16 places)
 *   bits 18-21 couleur du bas      (16 places)
 *   bits 22-24 accessoire          (8 places)   → indice ≤ 0x1ffffff
 *
 * Règle de versionnement : on **ajoute en fin de liste**, on ne retire ni ne réordonne
 * jamais une entrée (les indices déjà publiés changeraient de sens). Toute évolution
 * incrémente `VERSION_CATALOGUE_APPARENCE` et demande de régénérer l'atlas
 * (`npm run generer-apparence`).
 */

export const VERSION_CATALOGUE_APPARENCE = 1;

/** Tuile de la planche Kenney Roguelike Characters : `[colonne, rangée]`. */
export type TuileKenney = readonly [colonne: number, rangee: number];

export interface Teinte {
  nom: string;
  /** Rampe de couleurs de la palette Kenney, de la plus sombre à la plus claire. */
  rampe: readonly number[];
}

export interface Piece {
  nom: string;
  /** Tuile Kenney d'origine ; `null` pour « rien » (ex. crâne rasé). */
  tuile: TuileKenney | null;
}

export interface Accessoire {
  nom: string;
}

/** Corps humain de la planche (avec bouche), teint clair : base des changements de teint. */
export const TUILE_CORPS: TuileKenney = [1, 0];
/** Pantalon de la planche (orange, même rampe que les hauts) : base des couleurs du bas. */
export const TUILE_BAS: TuileKenney = [3, 5];
/** Chaussures sombres, communes à tous les avatars. */
export const TUILE_CHAUSSURES: TuileKenney = [4, 0];

/**
 * Teints humains : les trois de la planche Kenney (clair, moyen, foncé) et trois
 * intermédiaires ou plus foncés pris dans la palette Kenney. Jamais le vert. Rampe :
 * `[contour, peau]`.
 */
export const TEINTS: readonly Teinte[] = [
  { nom: 'Très clair', rampe: [0xaa8f6f, 0xe5c49d] },
  { nom: 'Clair', rampe: [0xa58e72, 0xd2b08e] },
  { nom: 'Moyen', rampe: [0x9c7650, 0xc8a480] },
  { nom: 'Mat', rampe: [0x8d6640, 0xb98b5e] },
  { nom: 'Foncé', rampe: [0x6b5434, 0x9f7c4d] },
  { nom: 'Très foncé', rampe: [0x4d4d4d, 0x725839] },
];

/** Coupes : cheveux de la planche Kenney (bloc brun, colonnes 19-22), sans barbe. */
export const COUPES: readonly Piece[] = [
  { nom: 'Rasé', tuile: null },
  { nom: 'Court', tuile: [19, 0] },
  { nom: 'Long', tuile: [20, 0] },
  { nom: 'Mi-long', tuile: [21, 1] },
  { nom: 'Tresses', tuile: [22, 1] },
  { nom: 'Chignon', tuile: [20, 2] },
  { nom: 'Au bol', tuile: [21, 2] },
];

/** Couleurs des cheveux, rampe `[ombre, base]` (dont celles de la planche Kenney). */
export const COULEURS_CHEVEUX: readonly Teinte[] = [
  { nom: 'Brun', rampe: [0x725839, 0xa17d52] },
  { nom: 'Noir', rampe: [0x494949, 0x5c5c5c] },
  { nom: 'Châtain foncé', rampe: [0x6b5434, 0x8d6640] },
  { nom: 'Roux', rampe: [0x955c18, 0xc0751c] },
  { nom: 'Blond', rampe: [0xbfb183, 0xe2d4a8] },
  { nom: 'Gris', rampe: [0x878787, 0xb5b5b5] },
  { nom: 'Blanc', rampe: [0xcacaca, 0xe8e8e8] },
];

/** Hauts : pièces civiles de la planche Kenney (bloc orange), ni épaulières ni armures. */
export const HAUTS: readonly Piece[] = [
  { nom: 'Tee-shirt', tuile: [8, 2] },
  { nom: 'Maillot rayé', tuile: [6, 0] },
  { nom: 'Tunique ceinturée', tuile: [7, 0] },
  { nom: 'Chemise', tuile: [8, 0] },
  { nom: 'Salopette', tuile: [9, 0] },
  { nom: 'Gilet, chemise blanche', tuile: [8, 1] },
  { nom: 'Gilet, chemise crème', tuile: [9, 1] },
  { nom: 'Blouse', tuile: [9, 2] },
];

/**
 * Couleurs des vêtements (haut et bas), rampe `[ombre, base, clair]` prise dans la
 * palette Kenney : celles des vêtements de la planche puis d'autres de la palette.
 * Pas de jaune fluo (gilets jaunes, ADR 0003).
 */
export const COULEURS_VETEMENTS: readonly Teinte[] = [
  { nom: 'Orange', rampe: [0xa35422, 0xc66527, 0xd97a3c] },
  { nom: 'Bleu canard', rampe: [0x1f6360, 0x2e8d89, 0x37aaa5] },
  { nom: 'Lavande', rampe: [0xa084c4, 0xc7b6dc, 0xd5c9e4] },
  { nom: 'Vert', rampe: [0x648c32, 0x7bad2c, 0x95ce3e] },
  { nom: 'Beige', rampe: [0x7e7258, 0x9c9178, 0xb4a78c] },
  { nom: 'Anthracite', rampe: [0x404040, 0x4f4f4f, 0x646464] },
  { nom: 'Blanc', rampe: [0xafaeae, 0xd2d2d2, 0xebebeb] },
  { nom: 'Moutarde', rampe: [0xb46c16, 0xcb942a, 0xe9ac35] },
  { nom: 'Rose', rampe: [0xc2729a, 0xeb7eaf, 0xff99cc] },
  { nom: 'Violet', rampe: [0x854679, 0x9c53b5, 0xae72c2] },
  { nom: 'Vert sapin', rampe: [0x307e4d, 0x409c62, 0x57b57a] },
  { nom: 'Brique', rampe: [0x875146, 0x9e5f52, 0xb97467] },
  { nom: 'Ciel', rampe: [0x2f9fa6, 0x63c5cf, 0x99dee3] },
];

/** Accessoires inclusifs, dessinés par script dans la palette Kenney (ADR 0006). */
export const ACCESSOIRES: readonly Accessoire[] = [
  { nom: 'Aucun' },
  { nom: 'Fauteuil roulant' },
  { nom: 'Poussette' },
  { nom: 'Canne' },
];

/** Une apparence composée : une position dans chaque liste du catalogue. */
export interface CompositionApparence {
  teint: number;
  couleurCheveux: number;
  coupe: number;
  haut: number;
  couleurHaut: number;
  couleurBas: number;
  accessoire: number;
}

/** Champs de l'indice, du bit de poids faible au plus fort, avec la liste qui les borne. */
const CHAMPS: readonly { cle: keyof CompositionApparence; bits: number; liste: readonly unknown[] }[] = [
  { cle: 'teint', bits: 3, liste: TEINTS },
  { cle: 'couleurCheveux', bits: 3, liste: COULEURS_CHEVEUX },
  { cle: 'coupe', bits: 4, liste: COUPES },
  { cle: 'haut', bits: 4, liste: HAUTS },
  { cle: 'couleurHaut', bits: 4, liste: COULEURS_VETEMENTS },
  { cle: 'couleurBas', bits: 4, liste: COULEURS_VETEMENTS },
  { cle: 'accessoire', bits: 3, liste: ACCESSOIRES },
];

const BITS_TOTAL = CHAMPS.reduce((total, champ) => total + champ.bits, 0);
/** Plus grand indice représentable (capacité des champs, pas taille actuelle du catalogue). */
export const INDICE_APPARENCE_MAX = 2 ** BITS_TOTAL - 1;

/** Indice compact d'une apparence composée (stocké par l'avatar, publié en `ap`). */
export function encoderApparence(apparence: CompositionApparence): number {
  let indice = 0;
  let decalage = 0;
  for (const { cle, bits } of CHAMPS) {
    indice += apparence[cle] * 2 ** decalage;
    decalage += bits;
  }
  return indice;
}

/** Apparence d'un indice ; `null` si l'indice ne désigne pas une apparence du catalogue. */
export function decoderApparence(indice: number): CompositionApparence | null {
  if (!Number.isInteger(indice) || indice < 0 || indice > INDICE_APPARENCE_MAX) return null;
  const apparence = {} as CompositionApparence;
  let reste = indice;
  for (const { cle, bits, liste } of CHAMPS) {
    const valeur = reste % 2 ** bits;
    if (valeur >= liste.length) return null;
    apparence[cle] = valeur;
    reste = Math.floor(reste / 2 ** bits);
  }
  return apparence;
}

/** Vrai si l'indice désigne une apparence du catalogue (validation côté serveur). */
export const estIndiceApparence = (x: unknown): x is number => typeof x === 'number' && decoderApparence(x) !== null;

/** Toutes les tuiles Kenney que le catalogue autorise (contrôle de la liste blanche). */
export function tuilesKenneyUtilisees(): TuileKenney[] {
  const pieces = [...COUPES, ...HAUTS].flatMap((p) => (p.tuile ? [p.tuile] : []));
  return [TUILE_CORPS, TUILE_BAS, TUILE_CHAUSSURES, ...pieces];
}
