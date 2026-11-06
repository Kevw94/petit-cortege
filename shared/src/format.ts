/**
 * Format v1 des fichiers publiés : le contrat entre le serveur et le client.
 *
 * Tous les fichiers sont identiques pour tous les clients et aucun chemin ne
 * contient d'identifiant de manif (ADR 0002). Les chemins sont relatifs à la
 * racine de publication, servie sous `PREFIXE_PUBLICATION` (CDN en prod,
 * serveur de dev en local).
 */

export const VERSION_FORMAT = 1 as const;

/** Préfixe d'URL sous lequel les fichiers publiés sont servis. */
export const PREFIXE_PUBLICATION = '/publie/';

/** Instant UTC au format ISO 8601 (`2026-11-06T14:00:00.000Z`). */
export type Instant = string;

/** Position GeoJSON : [longitude, latitude]. */
export type Position = [number, number];

/** Tracé GeoJSON du parcours, du départ vers l'arrivée. */
export interface Parcours {
  type: 'LineString';
  coordinates: Position[];
}

export interface Source {
  libelle: string;
  url: string;
}

export interface ManifPubliee {
  id: string;
  intitule: string;
  ville: string;
  /** Début des entrées : premier fichier par minute à charger pour cette manif. */
  ouverture: Instant;
  /** Départ effectif (annoncé, ou corrigé par un modérateur). */
  depart: Instant;
  /** Fin = départ + longueur ÷ 2 km/h + marge. */
  fin: Instant;
  parcours: Parcours;
  longueurM: number;
  sources: Source[];
  /** Nombre de soutiens publiés (entrées des minutes déjà publiées). */
  compteur: number;
}

/** Fichier « liste des manifs » (cache court). */
export interface ListeManifs {
  v: typeof VERSION_FORMAT;
  generee: Instant;
  manifs: ManifPubliee[];
}

/** Une entrée d'avatar, format compact. */
export interface EntreePubliee {
  /** Identifiant aléatoire de l'avatar. */
  a: string;
  /** Identifiant de la manif. */
  m: string;
  /** Heure d'entrée, en secondes depuis l'epoch Unix. */
  t: number;
  /** Indice d'apparence (catalogue partagé). */
  ap: number;
  /** Indice de pancarte (catalogue partagé). */
  pa: number;
}

/** Fichier « entrées d'une minute », toutes manifs confondues (immuable). */
export interface EntreesMinute {
  v: typeof VERSION_FORMAT;
  /** Début de la minute couverte. */
  minute: Instant;
  entrees: EntreePubliee[];
}

export const CHEMIN_LISTE_MANIFS = 'manifs.json';

const deuxChiffres = (n: number) => String(n).padStart(2, '0');

/** Chemin daté du fichier des entrées de la minute qui commence à `minute`. */
export function cheminEntreesMinute(minute: Date): string {
  const d = minute;
  return (
    `entrees/${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}` +
    `T${deuxChiffres(d.getUTCHours())}-${deuxChiffres(d.getUTCMinutes())}.json`
  );
}

function verifierVersion(json: unknown, quoi: string): void {
  if (typeof json !== 'object' || json === null || (json as { v?: unknown }).v !== VERSION_FORMAT) {
    throw new Error(`${quoi} : version de format inconnue (attendu v${VERSION_FORMAT})`);
  }
}

export function lireListeManifs(json: unknown): ListeManifs {
  verifierVersion(json, 'Liste des manifs');
  return json as ListeManifs;
}

export function lireEntreesMinute(json: unknown): EntreesMinute {
  verifierVersion(json, 'Entrées par minute');
  return json as EntreesMinute;
}
