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
 * Densité visée pour le premier plan d'un tronçon en masse, en avatars dessinés par tuile.
 * Les avatars dessinés sont ceux dont le tirage (hachage de l'identifiant, 32 bits) est sous
 * `fraction × 2³²`, la fraction étant la puissance de 2 qui ramène la densité du tronçon à
 * cette cible (entre la moitié et la cible). Par paliers : un avatar qui arrive ou part ne
 * change le tirage de personne, sauf si la densité du tronçon double ou diminue de moitié ;
 * même alors, les ensembles tirés restent emboîtés (on retire ou ajoute, on ne rebat pas).
 */
export const DENSITE_PREMIER_PLAN = 0.5;

/** Part tirée au premier plan pour un tronçon de cette densité (puissance de 2). */
function fractionPremierPlan(densite: number): number {
  return 2 ** -Math.max(1, Math.ceil(Math.log2(densite / DENSITE_PREMIER_PLAN)));
}

/** Tuiles d'un tronçon : sa longueur × la largeur de la rue (`COLONNES_FOULE` de front). */
const TUILES_PAR_TRONCON = (LONGUEUR_TRONCON_M / PAS_FOULE_M) * COLONNES_FOULE;

export interface AvatarAComposer {
  id: string;
  distanceM: number;
  propre: boolean;
  /**
   * Sur la place d'arrivée (`Cortege`) : hors de la bande de la rue, il ne compte pas dans
   * la densité des tronçons ; le rassemblement est à un avatar par tuile, il n'est en masse
   * que par le budget.
   */
  surPlace?: boolean;
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
    if (avatar.surPlace) continue;
    const numero = numeroDe(avatar);
    const troncon = parTroncon.get(numero);
    if (troncon) {
      troncon.nombre++;
      troncon.debutM = Math.min(troncon.debutM, avatar.distanceM);
      troncon.finM = Math.max(troncon.finM, avatar.distanceM);
    } else {
      parTroncon.set(numero, {
        debutM: avatar.distanceM,
        finM: avatar.distanceM,
        nombre: 1,
        densite: 0,
        enMasse: false,
      });
    }
  }
  for (const troncon of parTroncon.values()) {
    troncon.densite = troncon.nombre / TUILES_PAR_TRONCON;
    troncon.enMasse = troncon.densite > SEUIL_DENSITE_PAR_TUILE;
  }
  const troncons = [...parTroncon.entries()].sort(([a], [b]) => a - b).map(([, t]) => t);
  // Candidats au premier plan : tout le monde hors masse, les tirés dans la masse.
  const propres: A[] = [];
  const candidats: { avatar: A; tirage: number }[] = [];
  for (const avatar of avatars) {
    if (!visible(avatar)) continue;
    if (avatar.propre) {
      propres.push(avatar);
      continue;
    }
    const tirage = tirageIdentifiant(avatar.id);
    const troncon = avatar.surPlace ? undefined : parTroncon.get(numeroDe(avatar))!;
    if (!troncon?.enMasse || tirage < fractionPremierPlan(troncon.densite) * 2 ** 32)
      candidats.push({ avatar, tirage });
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
