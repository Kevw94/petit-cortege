/**
 * API POST du serveur : contrat entre le client et le serveur.
 *
 * L'identifiant de manif voyage dans le corps, jamais dans l'URL (ADR 0002).
 * Les corps sont des objets JSON extensibles : le retrait (#7) ajoutera le
 * hachage du jeton de retrait, l'anti-triche (#8) la solution ALTCHA, sans
 * changer les champs existants.
 */

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
  /** Indice d'apparence (catalogue partagé). */
  apparence: number;
  /** Indice de pancarte (catalogue partagé). */
  pancarte: number;
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
  /** Preuve de travail absente, fausse, expirée ou déjà utilisée : redemander un défi. */
  | 'preuve-invalide'
  /** Limite de débit atteinte (429) : réessayer plus tard. */
  | 'trop-de-requetes';

/** Corps d'une réponse d'erreur (4xx). */
export interface ReponseErreur {
  erreur: CodeErreurEntree;
}

/** Plus grand indice d'apparence ou de pancarte accepté (les catalogues #10, #11 resserreront). */
export const INDICE_MAX = 0xffff;

const estIndice = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= INDICE_MAX;

/** Valide un corps d'entrée reçu ; `null` s'il est invalide. Les champs inconnus sont ignorés. */
export function lireRequeteEntree(json: unknown): RequeteEntree | null {
  if (typeof json !== 'object' || json === null) return null;
  const { manif, apparence, pancarte, preuve } = json as Record<string, unknown>;
  if (typeof manif !== 'string' || manif.length === 0 || manif.length > 200) return null;
  if (!estIndice(apparence) || !estIndice(pancarte)) return null;
  if (preuve === undefined) return { manif, apparence, pancarte };
  if (typeof preuve !== 'string' || preuve.length > TAILLE_MAX_PREUVE) return null;
  return { manif, apparence, pancarte, preuve };
}
