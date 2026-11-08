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
  /**
   * Temps qu'il fait au départ du parcours, relevé par le serveur (au plus toutes les
   * 15 min) tant que la manif est ouverte. Absent si inconnu ou après la fin.
   */
  meteo?: MeteoPubliee;
}

/** État du ciel, du plus clair au plus bouché. */
export type Ciel = 'degage' | 'peu-nuageux' | 'nuageux' | 'couvert' | 'brouillard';
export type Precipitation = 'aucune' | 'bruine' | 'pluie' | 'neige' | 'orage';

/**
 * Météo publiée d'une manif. Relevée par le serveur, jamais par le client : aucun service
 * tiers ne voit l'IP d'un soutien avec le lieu d'une manif (ADR 0002, ADR 0008).
 */
export interface MeteoPubliee {
  /** Heure du relevé par la source. */
  releve: Instant;
  ciel: Ciel;
  precipitation: Precipitation;
  /** Force de la précipitation : 0 faible, 1 modérée, 2 forte (0 sans précipitation). */
  intensite: 0 | 1 | 2;
  temperatureC: number;
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

/**
 * Fichier « entrées d'une heure » (immuable) : les fichiers par minute d'une
 * heure terminée, compactés en un seul, toutes manifs confondues. Mêmes
 * entrées, dans le même ordre, que les fichiers par minute de cette heure.
 */
export interface EntreesHeure {
  v: typeof VERSION_FORMAT;
  /** Début de l'heure couverte. */
  heure: Instant;
  entrees: EntreePubliee[];
}

/** Un fichier d'entrées publié, par minute ou par heure : le Cortège lit les deux. */
export type FichierEntrees = EntreesMinute | EntreesHeure;

/**
 * Fichier « retraits » (cache court) : identifiants des avatars retirés, par le
 * soutien ou par modération, toutes manifs publiées confondues. Le client les
 * applique par-dessus les fichiers d'entrées, qui sont immuables.
 */
export interface Retraits {
  v: typeof VERSION_FORMAT;
  generee: Instant;
  /** Identifiants d'avatars, triés. */
  retraits: string[];
}

export const CHEMIN_LISTE_MANIFS = 'manifs.json';
export const CHEMIN_RETRAITS = 'retraits.json';

/**
 * Durée de cache (s) des fichiers réécrits à chaque publication (liste des
 * manifs, retraits) : un retrait ou un départ corrigé se propage en moins d'une minute.
 */
export const DUREE_CACHE_COURT_S = 30;

const deuxChiffres = (n: number) => String(n).padStart(2, '0');

/** Chemin daté du fichier des entrées de la minute qui commence à `minute`. */
export function cheminEntreesMinute(minute: Date): string {
  const d = minute;
  return (
    `entrees/${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}` +
    `T${deuxChiffres(d.getUTCHours())}-${deuxChiffres(d.getUTCMinutes())}.json`
  );
}

/** Chemin daté du fichier des entrées de l'heure qui commence à `heure` (`entrees/AAAA-MM-JJTHH.json`). */
export function cheminEntreesHeure(heure: Date): string {
  const d = heure;
  return (
    `entrees/${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}` +
    `T${deuxChiffres(d.getUTCHours())}.json`
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

export function lireEntreesHeure(json: unknown): EntreesHeure {
  verifierVersion(json, 'Entrées par heure');
  return json as EntreesHeure;
}

export function lireRetraits(json: unknown): Retraits {
  verifierVersion(json, 'Retraits');
  return json as Retraits;
}
