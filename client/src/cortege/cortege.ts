/**
 * Le Cortège : fonction pure, sans Phaser ni réseau (ADR 0004).
 * Manif + entrées publiées + heure courante → état de la manif et position de
 * chaque avatar le long du parcours. Tous les clients calculent la même foule.
 *
 * Le cortège est un bloc qui avance derrière sa tête (horaire annoncé, 2 km/h) : les
 * avatars y sont rangés dans l'ordre d'entrée, et qui rejoint en cours de route se place
 * à la queue.
 */
import { VITESSE_M_PAR_MS, type EntreePubliee, type FichierEntrees, type ManifPubliee } from '@petit-cortege/shared';
import { hacherIdentifiant } from './hachage';

export type EtatManif = 'ouverte' | 'terminee';

/** Écart entre deux avatars voisins : une tuile de 16 px ≈ 2 m (ADR 0006). */
export const PAS_FOULE_M = 2;
/** Nombre d'avatars de front sur la largeur de la rue. */
export const COLONNES_FOULE = 5;

export interface AvatarDuCortege {
  id: string;
  /**
   * Abscisse le long du parcours, en mètres depuis le départ. Négative pour les
   * rangées qui sont encore derrière la ligne de départ.
   */
  distanceM: number;
  /** Décalage latéral en mètres, perpendiculaire au parcours (positif à gauche du sens de marche). */
  decalageM: number;
  apparence: number;
  pancarte: number;
  /** Avatar du soutien sur cet appareil : mis en valeur, sur son écran seulement. */
  propre: boolean;
  /**
   * L'avatar avance en ce moment : le cortège est parti (départ passé), sa tête n'est pas
   * encore arrivée au bout du parcours, manif ouverte ; tout le cortège marche ou s'arrête
   * d'un bloc. Sert seulement au rendu (animation de marche, `marche.ts`) ; n'entre pas
   * dans le calcul des positions.
   */
  enMarche: boolean;
}

export interface Cortege {
  etat: EtatManif;
  avatars: AvatarDuCortege[];
  /**
   * Position de la tête du cortège selon l'horaire annoncé : distance parcourue depuis le
   * départ à 2 km/h, plafonnée à la longueur. Origine d'un repère qui avance avec le
   * cortège, où la foule garde sa forme (sert à mesurer la densité, `composerFoule`).
   */
  avanceeM: number;
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

export function calculerCortege({ manif, entrees, propres = [], retraits = [], maintenant }: EntreesDuCortege): Cortege {
  const depart = Date.parse(manif.depart);
  const t = maintenant.getTime();
  const idsPropres = new Set(propres.filter((e) => e.m === manif.id).map((e) => e.a));

  // Regroupe par instant d'entrée dans le cortège (le départ pour qui est entré avant) :
  // un groupe prend place d'un bloc, ses avatars départagés par leur hachage.
  const groupes = new Map<number, Marcheur[]>();
  const vus = new Set<string>(retraits); // un avatar retiré est ignoré comme un doublon
  const ajouter = (e: EntreePubliee) => {
    if (e.m !== manif.id || vus.has(e.a)) return;
    if (e.t * 1000 > t && !idsPropres.has(e.a)) return; // pas encore entré
    vus.add(e.a);
    const entreeMs = Math.max(e.t * 1000, depart);
    const marcheur = { id: e.a, hachage: hacherIdentifiant(e.a), apparence: e.ap, pancarte: e.pa };
    const groupe = groupes.get(entreeMs);
    if (groupe) groupe.push(marcheur);
    else groupes.set(entreeMs, [marcheur]);
  };
  for (const fichier of entrees) for (const e of fichier.entrees) ajouter(e);
  for (const e of propres) ajouter(e);

  // Tout le cortège avance d'un bloc derrière sa tête, qui suit l'horaire annoncé (ADR 0004) :
  // partie au départ, à 2 km/h, arrêtée au bout du parcours. À la fin, tout le cortège est
  // considéré arrivé : la tête y est déjà (fin = arrivée de la tête + marge).
  const terminee = t >= Date.parse(manif.fin);
  const avanceeM = Math.min(manif.longueurM, Math.max(0, t - depart) * VITESSE_M_PAR_MS);
  const enMarche = !terminee && t > depart && avanceeM < manif.longueurM;

  // Places dans l'ordre d'entrée : qui rejoint le cortège en cours de route se range juste
  // derrière la queue, pas au point de départ. Une place ne dépend que des entrées
  // précédentes : elle ne bouge pas quand d'autres arrivent après.
  const places = new PlacesDuCortege();
  const avatars: AvatarDuCortege[] = [];
  for (const entreeMs of [...groupes.keys()].sort((a, b) => a - b)) {
    const groupe = groupes.get(entreeMs)!.sort((a, b) => a.hachage - b.hachage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const marcheur of groupe) {
      const { rang, colonne } = places.prendre(marcheur.hachage);
      avatars.push({
        id: marcheur.id,
        distanceM: avanceeM - rang * PAS_FOULE_M,
        decalageM: (colonne - (COLONNES_FOULE - 1) / 2) * PAS_FOULE_M,
        apparence: marcheur.apparence,
        pancarte: marcheur.pancarte,
        propre: idsPropres.has(marcheur.id),
        enMarche,
      });
    }
  }
  return { etat: terminee ? 'terminee' : 'ouverte', avatars, avanceeM };
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

  prendre(hachage: number): { rang: number; colonne: number } {
    let case_ = this.#libre - (this.#libre % COLONNES_FOULE) + (hachage % COLONNES_FOULE);
    while (this.#occupees.has(case_)) case_++;
    this.#occupees.add(case_);
    while (this.#occupees.has(this.#libre)) this.#libre++;
    return { rang: Math.floor(case_ / COLONNES_FOULE), colonne: case_ % COLONNES_FOULE };
  }
}
