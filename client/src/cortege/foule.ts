/**
 * Masse de foule (partie pure du Cortège, sans Phaser) : densité par tronçon du
 * parcours, passage en masse au-delà du seuil, tirage des avatars dessinés au
 * premier plan par hachage de l'identifiant.
 *
 * Réutilisable pour l'image finale (#15) : lui passer les avatars placés au point
 * d'arrivée, avec un budget.
 */
import { COLONNES_FOULE, PAS_FOULE_M } from './cortege';
import { tirageIdentifiant } from './hachage';

/** Longueur d'un tronçon du parcours sur lequel la densité est mesurée (10 rangées de 2 m). */
export const LONGUEUR_TRONCON_M = 20;
/**
 * Seuil de densité, en avatars par tuile (2 m × 2 m) : au-delà, le tronçon passe en
 * masse de foule (docs/perf-prototype.md : ≈ 1 avatar par tuile, lisibilité).
 */
export const SEUIL_DENSITE_PAR_TUILE = 1;
/**
 * Part des avatars d'un tronçon en masse dessinés au premier plan : ceux dont le hachage
 * de l'identifiant (32 bits) est sous `FRACTION_PREMIER_PLAN × 2³²`. Le seuil ne dépend
 * pas du nombre d'avatars : un avatar qui arrive ou part ne change le tirage de personne.
 */
export const FRACTION_PREMIER_PLAN = 1 / 8;

/** Tuiles d'un tronçon : sa longueur × la largeur de la rue (`COLONNES_FOULE` de front). */
const TUILES_PAR_TRONCON = (LONGUEUR_TRONCON_M / PAS_FOULE_M) * COLONNES_FOULE;

export interface AvatarAComposer {
  id: string;
  distanceM: number;
  propre: boolean;
}

export interface TronconDeFoule {
  /** Étendue réellement occupée par les avatars du tronçon, en mètres le long du parcours. */
  debutM: number;
  finM: number;
  nombre: number;
  /** Avatars par tuile. */
  densite: number;
  /** Rendu en masse texturée (les avatars non tirés n'y sont pas dessinés). */
  enMasse: boolean;
}

export interface FouleComposee<A> {
  /** Tronçons occupés, de l'arrière vers la tête. */
  troncons: TronconDeFoule[];
  /** Avatars dessinés individuellement, dans l'ordre reçu. */
  dessines: A[];
  /** Nombre d'avatars non dessinés individuellement (masse ou hors écran). */
  enMasse: number;
}

export interface OptionsFoule<A> {
  /**
   * Origine des tronçons, en mètres le long du parcours : `Cortege.avanceeM` pour que les
   * tronçons avancent avec la foule en marche (sa densité, donc son rendu, ne change pas
   * pendant la marche). 0 par défaut (tronçons fixes, ex. image finale).
   */
  repereM?: number;
  /**
   * Nombre maximal d'avatars de la foule dessinés individuellement (ses propres avatars
   * en plus). Au-delà, la part tirée est divisée par 2 jusqu'à tenir dans le budget, et
   * tout le cortège passe en masse. Illimité par défaut.
   */
  budget?: number;
  /** Avatars comptés dans le budget et dessinés (ex. à l'écran) ; la densité se mesure sur tous. */
  visible?: (avatar: A) => boolean;
}

export function composerFoule<A extends AvatarAComposer>(
  avatars: readonly A[],
  { repereM = 0, budget = Infinity, visible = () => true }: OptionsFoule<A> = {},
): FouleComposee<A> {
  const numeroDe = (avatar: A) => Math.floor((avatar.distanceM - repereM) / LONGUEUR_TRONCON_M);
  const parTroncon = new Map<number, TronconDeFoule>();
  for (const avatar of avatars) {
    const numero = numeroDe(avatar);
    const troncon = parTroncon.get(numero);
    if (troncon) {
      troncon.nombre++;
      troncon.debutM = Math.min(troncon.debutM, avatar.distanceM);
      troncon.finM = Math.max(troncon.finM, avatar.distanceM);
    } else {
      parTroncon.set(numero, { debutM: avatar.distanceM, finM: avatar.distanceM, nombre: 1, densite: 0, enMasse: false });
    }
  }
  for (const troncon of parTroncon.values()) {
    troncon.densite = troncon.nombre / TUILES_PAR_TRONCON;
    troncon.enMasse = troncon.densite > SEUIL_DENSITE_PAR_TUILE;
  }
  const troncons = [...parTroncon.entries()].sort(([a], [b]) => a - b).map(([, t]) => t);
  // Candidats au premier plan : tout le monde hors masse, les tirés dans la masse.
  const seuilPremierPlan = FRACTION_PREMIER_PLAN * 2 ** 32;
  const propres: A[] = [];
  const candidats: { avatar: A; tirage: number }[] = [];
  for (const avatar of avatars) {
    if (!visible(avatar)) continue;
    if (avatar.propre) {
      propres.push(avatar);
      continue;
    }
    const tirage = tirageIdentifiant(avatar.id);
    if (!parTroncon.get(numeroDe(avatar))!.enMasse || tirage < seuilPremierPlan) candidats.push({ avatar, tirage });
  }

  // Budget : seuil de tirage divisé par 2 jusqu'à tenir. Par paliers, pour que le tirage reste
  // stable tant que le nombre d'avatars ne double pas ou ne diminue pas de moitié.
  let seuil = 2 ** 32;
  let retenus = candidats;
  while (retenus.length > budget) {
    seuil /= 2;
    retenus = retenus.filter((c) => c.tirage < seuil);
  }
  if (seuil < 2 ** 32) for (const troncon of troncons) troncon.enMasse = true;

  const tires = new Set<A>(propres);
  for (const { avatar } of retenus) tires.add(avatar);
  const dessines = avatars.filter((avatar) => tires.has(avatar));
  return { troncons, dessines, enMasse: avatars.length - dessines.length };
}
