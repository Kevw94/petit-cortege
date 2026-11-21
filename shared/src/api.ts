/**
 * API POST du serveur : contrat entre le client et le serveur.
 *
 * L'identifiant de manif voyage dans le corps, jamais dans l'URL (ADR 0002).
 * Les corps sont des objets JSON extensibles : l'anti-triche (#8) ajoutera la
 * solution ALTCHA sans changer les champs existants.
 */
import { estIndiceApparence } from './catalogues/apparence';
import { estIndicePancarte } from './catalogues/pancartes';

/** Entrée d'un avatar dans un cortège. */
export const CHEMIN_API_ENTREE = '/api/entree';

/**
 * Défi de preuve de travail ALTCHA (GET, identique pour tous : aucun identifiant
 * de manif). La réponse est un défi ALTCHA v2 (`Challenge` d'altcha-lib), opaque
 * pour le module partagé ; le client le résout puis joint la preuve à son entrée.
 */
export const CHEMIN_API_DEFI = '/api/defi';

/** Longueur maximale de la preuve de travail encodée. */
export const TAILLE_MAX_PREUVE = 4096;

export interface RequeteEntree {
  /** Identifiant de la manif. */
  manif: string;
  /** Indice d'apparence (`encoderApparence`, catalogue partagé). */
  apparence: number;
  /** Indice de pancarte (`encoderPancarte`, catalogue partagé). */
  pancarte: number;
  /**
   * SHA-256 (hex) du jeton de retrait généré par le client (ADR 0001) : seul ce
   * hachage est stocké. Facultatif : sans lui, l'avatar ne peut pas être retiré
   * par le soutien (seulement par modération).
   */
  hachageRetrait?: string;
  /**
   * Preuve de travail ALTCHA, comme la produit le widget : `{ challenge, solution }` en JSON
   * encodé en base64 (le défi est de l'ASCII). Vérifiée par le serveur ; absente = refusée.
   */
  preuve?: string;
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

export type CodeErreurEntree =
  | 'requete-invalide'
  | 'manif-inconnue'
  | 'manif-terminee'
  /** La tête du cortège est arrivée : les entrées sont fermées, la fin approche. */
  | 'entrees-fermees'
  /** Preuve de travail absente, fausse, expirée ou déjà utilisée : redemander un défi. */
  | 'preuve-invalide'
  /** Limite de débit atteinte (429) : réessayer plus tard. */
  | 'trop-de-requetes';

/** Corps d'une réponse d'erreur (4xx). */
export interface ReponseErreur {
  erreur: CodeErreurEntree | CodeErreurRetrait;
}

/** Valide un corps d'entrée reçu ; `null` s'il est invalide. Les champs inconnus sont ignorés. */
export function lireRequeteEntree(json: unknown): RequeteEntree | null {
  if (typeof json !== 'object' || json === null) return null;
  const { manif, apparence, pancarte, preuve } = json as Record<string, unknown>;
  if (typeof manif !== 'string' || manif.length === 0 || manif.length > 200) return null;
  if (!estIndiceApparence(apparence) || !estIndicePancarte(pancarte)) return null;
  const { hachageRetrait } = json as Record<string, unknown>;
  const requete: RequeteEntree = { manif, apparence, pancarte };
  if (hachageRetrait !== undefined) {
    if (typeof hachageRetrait !== 'string' || !HACHAGE_RETRAIT.test(hachageRetrait)) return null;
    requete.hachageRetrait = hachageRetrait;
  }
  if (preuve !== undefined) {
    if (typeof preuve !== 'string' || preuve.length > TAILLE_MAX_PREUVE) return null;
    requete.preuve = preuve;
  }
  return requete;
}

/**
 * Retrait de son avatar par le soutien, depuis l'appareil qui l'a créé :
 * l'identifiant de l'avatar et le jeton de retrait en clair. Le serveur compare
 * son SHA-256 au hachage reçu à l'entrée.
 */
export const CHEMIN_API_RETRAIT = '/api/retrait';

export interface RequeteRetrait {
  /** Identifiant de l'avatar (réponse à l'entrée). */
  avatar: string;
  /** Jeton de retrait en clair : 128 bits en hexadécimal (32 caractères). */
  jeton: string;
}

/** Réponse 200 à un retrait accepté (rejouer un retrait déjà fait est aussi accepté). */
export interface ReponseRetrait {
  avatar: string;
}

/**
 * `retrait-refuse` couvre sans les distinguer le mauvais jeton, l'avatar
 * inconnu et le hachage déjà effacé (1 h après la fin) : la réponse ne dit
 * rien de l'existence d'un avatar.
 */
export type CodeErreurRetrait = 'requete-invalide' | 'retrait-refuse';

const JETON_RETRAIT = /^[0-9a-f]{32}$/;
const HACHAGE_RETRAIT = /^[0-9a-f]{64}$/;

/** Valide un corps de retrait reçu ; `null` s'il est invalide. Les champs inconnus sont ignorés. */
export function lireRequeteRetrait(json: unknown): RequeteRetrait | null {
  if (typeof json !== 'object' || json === null) return null;
  const { avatar, jeton } = json as Record<string, unknown>;
  if (typeof avatar !== 'string' || avatar.length === 0 || avatar.length > 200) return null;
  if (typeof jeton !== 'string' || !JETON_RETRAIT.test(jeton)) return null;
  return { avatar, jeton };
}
