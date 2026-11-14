/**
 * Le Cortège : fonction pure, sans Phaser ni réseau (ADR 0004).
 * Manif + entrées publiées + heure courante → état de la manif et position de
 * chaque avatar le long du parcours. Tous les clients calculent la même foule.
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
   * rangées qui attendent derrière la ligne de départ.
   */
  distanceM: number;
  /** Décalage latéral en mètres, perpendiculaire au parcours (positif à gauche du sens de marche). */
  decalageM: number;
  apparence: number;
  pancarte: number;
  /** Avatar du soutien sur cet appareil : mis en valeur, sur son écran seulement. */
  propre: boolean;
  /**
   * L'avatar avance en ce moment : parti (départ passé et entré), pas encore arrivé au bout
   * du parcours, manif ouverte. Sert seulement au rendu (animation de marche, `marche.ts`) ;
   * n'entre pas dans le calcul des positions.
   */
  enMarche: boolean;
}

export interface Cortege {
  etat: EtatManif;
  avatars: AvatarDuCortege[];
  /**
   * Distance parcourue depuis le départ par qui marche depuis le départ (plafonnée à la
   * longueur) : origine d'un repère qui avance avec le cortège, où la foule en marche
   * garde sa forme (sert à mesurer la densité, `composerFoule`).
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

  // Regroupe par instant de début de marche : un groupe marche à la même distance.
  const groupes = new Map<number, Marcheur[]>();
  const vus = new Set<string>(retraits); // un avatar retiré est ignoré comme un doublon
  const ajouter = (e: EntreePubliee) => {
    if (e.m !== manif.id || vus.has(e.a)) return;
    if (e.t * 1000 > t && !idsPropres.has(e.a)) return; // pas encore entré
    vus.add(e.a);
    const debutMarcheMs = Math.max(e.t * 1000, depart);
    const marcheur = { id: e.a, hachage: hacherIdentifiant(e.a), apparence: e.ap, pancarte: e.pa };
    const groupe = groupes.get(debutMarcheMs);
    if (groupe) groupe.push(marcheur);
    else groupes.set(debutMarcheMs, [marcheur]);
  };
  for (const fichier of entrees) for (const e of fichier.entrees) ajouter(e);
  for (const e of propres) ajouter(e);

  // À la fin, tout le cortège est considéré arrivé (ADR 0004), retardataires compris.
  const terminee = t >= Date.parse(manif.fin);
  const avatars: AvatarDuCortege[] = [];
  for (const [debutMarcheMs, groupe] of groupes) {
    const distanceM = terminee
      ? manif.longueurM
      : Math.min(manif.longueurM, Math.max(0, t - debutMarcheMs) * VITESSE_M_PAR_MS);
    // Tout le groupe marche ensemble : après son début de marche, avant d'atteindre l'arrivée.
    const enMarche = !terminee && t > debutMarcheMs && distanceM < manif.longueurM;
    for (const { marcheur, rang, colonne } of placerEnRangees(groupe)) {
      avatars.push({
        id: marcheur.id,
        distanceM: distanceM - rang * PAS_FOULE_M,
        decalageM: (colonne - (COLONNES_FOULE - 1) / 2) * PAS_FOULE_M,
        apparence: marcheur.apparence,
        pancarte: marcheur.pancarte,
        propre: idsPropres.has(marcheur.id),
        enMarche,
      });
    }
  }
  const avanceeM = Math.min(manif.longueurM, Math.max(0, t - depart) * VITESSE_M_PAR_MS);
  return { etat: terminee ? 'terminee' : 'ouverte', avatars, avanceeM };
}

/**
 * Répartit un groupe d'avatars à la même distance sur une grille de
 * `COLONNES_FOULE` de front, rangées vers l'arrière. Chaque avatar vise la
 * colonne donnée par le hachage de son identifiant (première rangée) et prend
 * la case libre suivante : déterministe, sans collision, indépendant de
 * l'ordre des fichiers.
 */
function placerEnRangees(groupe: Marcheur[]): { marcheur: Marcheur; rang: number; colonne: number }[] {
  const ordonnes = [...groupe].sort((a, b) => a.hachage - b.hachage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const occupees = new Set<number>();
  return ordonnes.map((marcheur) => {
    let case_ = marcheur.hachage % COLONNES_FOULE;
    while (occupees.has(case_)) case_++;
    occupees.add(case_);
    return { marcheur, rang: Math.floor(case_ / COLONNES_FOULE), colonne: case_ % COLONNES_FOULE };
  });
}
