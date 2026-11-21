/**
 * Le Cortège : fonction pure, sans Phaser ni réseau (ADR 0004).
 * Manif + entrées publiées + heure courante → état de la manif et position de
 * chaque avatar le long du parcours. Tous les clients calculent la même foule.
 *
 * Le cortège est un bloc qui avance derrière sa tête (horaire annoncé, 2 km/h) : les
 * avatars y sont rangés dans l'ordre d'entrée, et qui rejoint en cours de route se place
 * à la queue. Au bout du parcours, chacun entre sur la place d'arrivée et va à sa place
 * dans le rassemblement ; quand la queue est arrivée, tout le monde danse 10 min, puis
 * vient la fin (image finale).
 */
import {
  COLONNES_FOULE,
  arriveeDeLaTete,
  debutDeLaDanse,
  PAS_FOULE_M,
  VITESSE_M_PAR_MS,
  type EntreePubliee,
  type FichierEntrees,
  type ManifPubliee,
} from '@petit-cortege/shared';
import { hacherIdentifiant } from './hachage';

export type EtatManif = 'ouverte' | 'terminee';

export { COLONNES_FOULE, PAS_FOULE_M };

export interface AvatarDuCortege {
  id: string;
  /**
   * Abscisse le long du parcours, en mètres depuis le départ. Négative pour les
   * rangées qui sont encore derrière la ligne de départ ; au-delà de la longueur sur la
   * place d'arrivée (dans le prolongement du dernier tronçon).
   */
  distanceM: number;
  /** Décalage latéral en mètres, perpendiculaire au parcours (positif à gauche du sens de marche). */
  decalageM: number;
  /** Entré sur la place d'arrivée : hors de la rue, il ne compte pas dans la densité de la rue. */
  surPlace: boolean;
  apparence: number;
  pancarte: number;
  /** Avatar du soutien sur cet appareil : mis en valeur, sur son écran seulement. */
  propre: boolean;
  /**
   * L'avatar avance en ce moment : dans la rue après le départ, ou sur la place tant qu'il
   * n'a pas rejoint sa place dans le rassemblement ; jamais pendant la danse ni une fois la
   * manif terminée. Sert seulement au rendu (animation de marche, `marche.ts`) ; n'entre
   * pas dans le calcul des positions.
   */
  enMarche: boolean;
}

export interface Cortege {
  etat: EtatManif;
  avatars: AvatarDuCortege[];
  /**
   * Position de la tête du cortège selon l'horaire annoncé : distance parcourue depuis le
   * départ à 2 km/h (au-delà de la longueur une fois la tête sur la place). Origine d'un
   * repère qui avance avec le cortège, où la foule de la rue garde sa forme (sert à
   * mesurer la densité, `composerFoule`).
   */
  avanceeM: number;
  /** On peut encore rejoindre : la tête n'est pas arrivée au bout du parcours. */
  entreesOuvertes: boolean;
  /** Danse finale : la queue est arrivée, tout le cortège danse sur la place jusqu'à la fin. */
  danse: boolean;
}

export interface EntreesDuCortege {
  manif: ManifPubliee;
  /** Fichiers d'entrées publiés, par minute ou par heure (toutes manifs confondues). */
  entrees: FichierEntrees[];
  /**
   * Avatars du soutien sur cet appareil (réponses à ses entrées), affichés tout
   * de suite sans attendre la publication, même avant leur heure d'entrée tirée.
   */
  propres?: EntreePubliee[];
  /**
   * Identifiants des avatars retirés (fichier des retraits, par le soutien ou par
   * modération), appliqués par-dessus les fichiers d'entrées immuables.
   */
  retraits?: readonly string[];
  maintenant: Date;
}

interface Marcheur {
  id: string;
  hachage: number;
  apparence: number;
  pancarte: number;
}

/** Place fixe d'un avatar : son rang dans le cortège et sa place sur la place d'arrivée. */
interface PlaceDAvatar {
  id: string;
  apparence: number;
  pancarte: number;
  propre: boolean;
  rang: number;
  decalageRueM: number;
  place: { avantM: number; coteM: number };
}

/**
 * Placement du cortège : la place de chaque avatar entré, dans l'ordre d'entrée. C'est la partie
 * coûteuse du calcul (hachage, tri, grille). Elle ne dépend de l'heure que par les avatars déjà
 * entrés : elle vaut telle quelle pour toute heure de `[valableDesMs, valableJusquAMs[`, où
 * personne n'entre.
 */
export interface PlacementDuCortege {
  readonly places: readonly PlaceDAvatar[];
  readonly valableDesMs: number;
  readonly valableJusquAMs: number;
}

/** Le Cortège à l'heure `maintenant`. Fonction pure : à chaque appel, tout est recalculé. */
export function calculerCortege(entrees: EntreesDuCortege): Cortege {
  return positionnerCortege(placerCortege(entrees), entrees.manif, entrees.maintenant);
}

/**
 * Calcule le même Cortège que `calculerCortege`, mais garde le placement d'un appel à l'autre :
 * à chaque image, seules les positions à l'heure courante sont recalculées. Le placement est
 * refait quand un avatar entre, ou quand les entrées, les propres, les retraits ou le départ
 * changent (listes comparées élément par élément : une liste recréée au même contenu suffit).
 */
export class CortegeMemorise {
  #placement: PlacementDuCortege | null = null;
  #cle: { manifId: string; depart: string; entrees: readonly unknown[]; propres: readonly unknown[]; retraits: readonly unknown[] } | null = null;

  calculer(entrees: EntreesDuCortege): Cortege {
    return positionnerCortege(this.placement(entrees), entrees.manif, entrees.maintenant);
  }

  placement(entrees: EntreesDuCortege): PlacementDuCortege {
    const { manif, propres = [], retraits = [], maintenant } = entrees;
    const t = maintenant.getTime();
    const cle = this.#cle;
    if (
      this.#placement &&
      cle &&
      t >= this.#placement.valableDesMs &&
      t < this.#placement.valableJusquAMs &&
      cle.manifId === manif.id &&
      cle.depart === manif.depart &&
      memesElements(cle.entrees, entrees.entrees) &&
      memesElements(cle.propres, propres) &&
      memesElements(cle.retraits, retraits)
    ) {
      return this.#placement;
    }
    this.#placement = placerCortege(entrees);
    this.#cle = { manifId: manif.id, depart: manif.depart, entrees: [...entrees.entrees], propres: [...propres], retraits: [...retraits] };
    return this.#placement;
  }
}

function memesElements(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Places des avatars entrés à l'heure `maintenant`, dans l'ordre d'entrée (ADR 0004). */
export function placerCortege({ manif, entrees, propres = [], retraits = [], maintenant }: EntreesDuCortege): PlacementDuCortege {
  const depart = Date.parse(manif.depart);
  const t = maintenant.getTime();
  const idsPropres = new Set(propres.filter((e) => e.m === manif.id).map((e) => e.a));
  const retires = new Set(retraits);

  // Fenêtre où le placement vaut : entre la dernière entrée passée et la prochaine à venir.
  // Les avatars propres et retirés n'en dépendent pas (toujours là, ou jamais).
  let valableDesMs = -Infinity;
  let valableJusquAMs = Infinity;

  // Regroupe par instant d'entrée dans le cortège (le départ pour qui est entré avant) :
  // un groupe prend place d'un bloc, ses avatars départagés par leur hachage.
  const groupes = new Map<number, Marcheur[]>();
  const vus = new Set<string>(retraits); // un avatar retiré est ignoré comme un doublon
  const ajouter = (e: EntreePubliee) => {
    if (e.m !== manif.id) return;
    const ms = e.t * 1000;
    if (!idsPropres.has(e.a) && !retires.has(e.a)) {
      if (ms <= t) valableDesMs = Math.max(valableDesMs, ms);
      else valableJusquAMs = Math.min(valableJusquAMs, ms);
    }
    if (vus.has(e.a)) return;
    if (ms > t && !idsPropres.has(e.a)) return; // pas encore entré
    vus.add(e.a);
    const entreeMs = Math.max(ms, depart);
    const marcheur = { id: e.a, hachage: hacherIdentifiant(e.a), apparence: e.ap, pancarte: e.pa };
    const groupe = groupes.get(entreeMs);
    if (groupe) groupe.push(marcheur);
    else groupes.set(entreeMs, [marcheur]);
  };
  for (const fichier of entrees) for (const e of fichier.entrees) ajouter(e);
  for (const e of propres) ajouter(e);

  // Places dans l'ordre d'entrée : qui rejoint le cortège en cours de route se range juste
  // derrière la queue, pas au point de départ. Une place ne dépend que des entrées
  // précédentes : elle ne bouge pas quand d'autres arrivent après.
  const grille = new PlacesDuCortege();
  const places: PlaceDAvatar[] = [];
  for (const entreeMs of [...groupes.keys()].sort((a, b) => a - b)) {
    const groupe = groupes.get(entreeMs)!.sort((a, b) => a.hachage - b.hachage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const marcheur of groupe) {
      const { rang, colonne, case_ } = grille.prendre(marcheur.hachage);
      places.push({
        id: marcheur.id,
        apparence: marcheur.apparence,
        pancarte: marcheur.pancarte,
        propre: idsPropres.has(marcheur.id),
        rang,
        decalageRueM: (colonne - (COLONNES_FOULE - 1) / 2) * PAS_FOULE_M,
        place: placeSurLaPlace(case_),
      });
    }
  }
  return { places, valableDesMs, valableJusquAMs };
}

/** Positions des avatars placés, à l'heure `maintenant` : peu coûteux, à refaire à chaque image. */
export function positionnerCortege(placement: PlacementDuCortege, manif: ManifPubliee, maintenant: Date): Cortege {
  const depart = Date.parse(manif.depart);
  const t = maintenant.getTime();

  // Tout le cortège avance d'un bloc derrière sa tête, qui suit l'horaire annoncé (ADR 0004) :
  // partie au départ, à 2 km/h. Au bout du parcours, chacun entre sur la place. La danse
  // commence 10 min avant la fin (la queue est alors arrivée) : tout le monde est à sa place.
  const terminee = t >= Date.parse(manif.fin);
  const danse = !terminee && t >= debutDeLaDanse(new Date(manif.fin)).getTime();
  const entreesOuvertes = t < arriveeDeLaTete(new Date(depart), manif.longueurM).getTime();
  const avanceeM = Math.max(0, t - depart) * VITESSE_M_PAR_MS;
  const rassembles = terminee || danse;

  const avatars: AvatarDuCortege[] = placement.places.map((p) => {
    const position = positionDansLaFoule(
      rassembles ? Infinity : avanceeM - p.rang * PAS_FOULE_M,
      p.decalageRueM,
      p.place,
      manif.longueurM,
    );
    return {
      id: p.id,
      ...position,
      enMarche: position.enMarche && !rassembles && t > depart,
      apparence: p.apparence,
      pancarte: p.pancarte,
      propre: p.propre,
    };
  });
  return { etat: terminee ? 'terminee' : 'ouverte', avatars, avanceeM, entreesOuvertes, danse };
}

/** Aire d'une place dans le rassemblement : un avatar par tuile de 2 m × 2 m. */
export const AIRE_PLACE_RASSEMBLEMENT_M2 = PAS_FOULE_M * PAS_FOULE_M;
/**
 * Rayon maximal du rassemblement sur la place, en mètres. Au-delà de sa contenance, les
 * avatars se serrent (plusieurs par tuile), sans déborder sur les rues alentour.
 */
export const RAYON_MAX_RASSEMBLEMENT_M = 60;
const ANGLE_D_OR = Math.PI * (3 - Math.sqrt(5));
const CONTENANCE_RASSEMBLEMENT = Math.floor(
  (Math.PI * RAYON_MAX_RASSEMBLEMENT_M ** 2) / 2 / AIRE_PLACE_RASSEMBLEMENT_M2,
);

/**
 * Place d'un avatar dans le rassemblement, par rapport au point d'arrivée : un demi-disque
 * devant lui, dans le prolongement du parcours, rempli du centre vers le bord dans l'ordre
 * d'arrivée (spirale de Vogel : chaque place couvre la même aire, sans rangées visibles).
 * `avantM` le long du parcours (≥ 0), `cote` en décalage latéral.
 */
export function placeSurLaPlace(numero: number): { avantM: number; coteM: number } {
  // Au-delà de la contenance, une nouvelle couche, décalée d'une demi-place.
  const indice = (numero % CONTENANCE_RASSEMBLEMENT) + 0.5 * Math.floor(numero / CONTENANCE_RASSEMBLEMENT);
  const rayon = Math.sqrt(((indice + 0.5) * 2 * AIRE_PLACE_RASSEMBLEMENT_M2) / Math.PI);
  const angle = (((indice * ANGLE_D_OR) % (2 * Math.PI)) / 2) - Math.PI / 2;
  return { avantM: rayon * Math.cos(angle), coteM: rayon * Math.sin(angle) };
}

/**
 * Position d'un avatar à `rueM` mètres le long du parcours (sa position s'il était resté
 * dans la rue) : dans la rue avant le point d'arrivée ; au-delà, il a parcouru `rueM −
 * longueur` mètres sur la place, en ligne droite du point d'arrivée vers sa place.
 */
function positionDansLaFoule(
  rueM: number,
  decalageRueM: number,
  place: { avantM: number; coteM: number },
  longueurM: number,
): { distanceM: number; decalageM: number; surPlace: boolean; enMarche: boolean } {
  if (rueM < longueurM) return { distanceM: rueM, decalageM: decalageRueM, surPlace: false, enMarche: true };
  const trajetM = Math.hypot(place.avantM, place.coteM - decalageRueM);
  const fait = trajetM === 0 ? 1 : Math.min(1, (rueM - longueurM) / trajetM);
  return {
    distanceM: longueurM + place.avantM * fait,
    decalageM: decalageRueM + (place.coteM - decalageRueM) * fait,
    surPlace: true,
    enMarche: fait < 1,
  };
}

/**
 * Grille du cortège, `COLONNES_FOULE` de front, rangées numérotées depuis la tête. Chaque
 * nouvel avatar vise, dans la première rangée incomplète, la colonne donnée par le hachage
 * de son identifiant, et prend la case libre suivante (quitte à déborder sur la rangée
 * d'après) : déterministe, sans collision, et la queue se complète avant de s'allonger.
 */
class PlacesDuCortege {
  readonly #occupees = new Set<number>();
  /** Première case libre : toutes celles d'avant sont prises. */
  #libre = 0;

  prendre(hachage: number): { rang: number; colonne: number; case_: number } {
    let case_ = this.#libre - (this.#libre % COLONNES_FOULE) + (hachage % COLONNES_FOULE);
    while (this.#occupees.has(case_)) case_++;
    this.#occupees.add(case_);
    while (this.#occupees.has(this.#libre)) this.#libre++;
    return { rang: Math.floor(case_ / COLONNES_FOULE), colonne: case_ % COLONNES_FOULE, case_ };
  }
}
