/**
 * API POST du serveur : contrat entre le client et le serveur.
 *
 * L'identifiant de manif voyage dans le corps, jamais dans l'URL (ADR 0002).
 * Les corps sont des objets JSON extensibles : le retrait (#7) ajoutera le
 * hachage du jeton de retrait, l'anti-triche (#8) la solution ALTCHA, sans
 * changer les champs existants.
 */
import { estIndicePancarte } from './catalogues/pancartes';

/** Entrée d'un avatar dans un cortège. */
export const CHEMIN_API_ENTREE = '/api/entree';

export interface RequeteEntree {
  /** Identifiant de la manif. */
  manif: string;
  /** Indice d'apparence (catalogue partagé). */
  apparence: number;
  /** Indice de pancarte (`encoderPancarte`, catalogue partagé). */
  pancarte: number;
}

/** Réponse 201 à une entrée acceptée. */
export interface ReponseEntree {
  /** Identifiant aléatoire de l'avatar, généré par le serveur. */
  avatar: string;
  /**
   * Heure d'entrée stockée (secondes epoch), arrondie à la minute + aléa (ADR 0001).
   * C'est celle qui sera publiée : le client place son avatar comme tout le monde le verra.
   */
  entree: number;
}

export type CodeErreurEntree = 'requete-invalide' | 'manif-inconnue' | 'manif-terminee';

/** Corps d'une réponse d'erreur (4xx). */
export interface ReponseErreur {
  erreur: CodeErreurEntree;
}

/** Plus grand indice d'apparence accepté (le catalogue d'apparence #10 resserrera). */
export const INDICE_MAX = 0xffff;

const estIndice = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= INDICE_MAX;

/** Valide un corps d'entrée reçu ; `null` s'il est invalide. Les champs inconnus sont ignorés. */
export function lireRequeteEntree(json: unknown): RequeteEntree | null {
  if (typeof json !== 'object' || json === null) return null;
  const { manif, apparence, pancarte } = json as Record<string, unknown>;
  if (typeof manif !== 'string' || manif.length === 0 || manif.length > 200) return null;
  if (!estIndice(apparence) || !estIndicePancarte(pancarte)) return null;
  return { manif, apparence, pancarte };
}
