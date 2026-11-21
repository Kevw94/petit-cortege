/**
 * Fichier déclaratif d'une journée de manifs (`donnees/manifs/<jour>.json`),
 * versionné : ce que les organisateurs ou la presse ont annoncé publiquement,
 * étape par étape, et ce que le porteur a vérifié avant publication (ADR 0003).
 *
 * Validation stricte : toute clé inconnue ou valeur douteuse est refusée, avec
 * un message qui dit quelle manif et quel champ corriger.
 */
import { createHash } from 'node:crypto';
import { FORMAT_ID_MANIF } from '@petit-cortege/server';
import type { Position, Source } from '@petit-cortege/shared';
import { enIdentifiant, jourAParis, lireHeure } from '../moderation';

/**
 * Étape annoncée, du départ vers l'arrivée :
 * - `adresse` : lieu à géocoder (« Place de la République, Paris ») ; le cortège y passe ;
 * - `rue` : rue annoncée (« Rue Stanislas ») ; le cortège la parcourt, entre ses
 *   raccords avec l'étape d'avant et celle d'après (géométrie OSM) ;
 * - `position` : [lon, lat] explicite, quand un lieu ne se géocode pas (avec un libellé).
 */
export type EtapeDeclaree =
  | { adresse: string; libelle?: string }
  | { rue: string; libelle?: string }
  | { position: Position; libelle: string };

/** Lieu que le tracé ne doit pas traverser (ex. périmètre interdit par arrêté). */
export interface ZoneEvitee {
  adresse: string;
  /** Rayon autour du point géocodé, en mètres. */
  rayonM: number;
}

/**
 * Vérification humaine (ADR 0003) : chaque champ dit comment et quand c'est
 * vérifié (« … le 14/11 sur … »). `null` = pas encore vérifié : la publication
 * est refusée tant qu'un champ est vide.
 */
export interface Verification {
  /** Manif déclarée (préfecture), et parcours validé s'il y a lieu. */
  declaree: string | null;
  /** Aucun arrêté d'interdiction (à vérifier juste avant le départ). */
  sansInterdiction: string | null;
}

export interface ManifDeclaree {
  id: string;
  intitule: string;
  ville: string;
  /** Départ, heure de Paris (même syntaxe que `npm run moderation`). */
  depart: string;
  /** Début des entrées (facultatif). */
  ouverture?: string;
  /** La phrase publiée, citée telle quelle. */
  parcoursAnnonce: string;
  etapes: EtapeDeclaree[];
  zonesEvitees: ZoneEvitee[];
  sources: Source[];
  verifie: Verification;
  /** Raison pour laquelle la manif n'est ni tracée ni publiée (ex. étape introuvable). */
  aVerifier?: string;
}

export interface JourneeDeclaree {
  jour: string;
  manifs: ManifDeclaree[];
}

/** Fichier du jour invalide, ou tracé refusé : message lisible par le porteur. */
export class ErreurImport extends Error {
  override name = 'ErreurImport';
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const estTexte = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function clesConnues(o: Objet, permises: string[], ou: string): void {
  const inconnues = Object.keys(o).filter((c) => !permises.includes(c));
  if (inconnues.length > 0) {
    throw new ErreurImport(`${ou} : clé inconnue « ${inconnues.join(' », « ')} » (attendu : ${permises.join(', ')}).`);
  }
}

function texte(o: Objet, cle: string, ou: string): string {
  const v = o[cle];
  if (!estTexte(v)) throw new ErreurImport(`${ou} : « ${cle} » obligatoire (texte non vide).`);
  return v.trim();
}

function texteFacultatif(o: Objet, cle: string, ou: string): string | undefined {
  return o[cle] === undefined ? undefined : texte(o, cle, ou);
}

function lirePosition(v: unknown, ou: string): Position {
  const [lon, lat] = Array.isArray(v) && v.length === 2 ? v : [];
  if (typeof lon !== 'number' || typeof lat !== 'number' || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    throw new ErreurImport(`${ou} : « position » attendue sous la forme [longitude, latitude].`);
  }
  // En France métropolitaine, une inversion lon/lat se voit tout de suite.
  if (lat < lon)
    throw new ErreurImport(`${ou} : position [${lon}, ${lat}] suspecte (longitude et latitude inversées ?).`);
  return [lon, lat];
}

function lireEtape(v: unknown, ou: string): EtapeDeclaree {
  if (!estObjet(v))
    throw new ErreurImport(`${ou} : objet attendu ({ "adresse": … }, { "rue": … } ou { "position": … }).`);
  const genres = ['adresse', 'rue', 'position'].filter((c) => v[c] !== undefined);
  if (genres.length !== 1)
    throw new ErreurImport(`${ou} : donner exactement un de « adresse », « rue », « position ».`);
  const libelle = texteFacultatif(v, 'libelle', ou);
  const avecLibelle = libelle === undefined ? {} : { libelle };
  switch (genres[0]) {
    case 'adresse':
      clesConnues(v, ['adresse', 'libelle'], ou);
      return { adresse: texte(v, 'adresse', ou), ...avecLibelle };
    case 'rue':
      clesConnues(v, ['rue', 'libelle'], ou);
      return { rue: texte(v, 'rue', ou), ...avecLibelle };
    default:
      clesConnues(v, ['position', 'libelle'], ou);
      if (libelle === undefined)
        throw new ErreurImport(`${ou} : une « position » explicite demande un « libelle » (ce qu'elle désigne).`);
      return { position: lirePosition(v.position, ou), libelle };
  }
}

function lireSource(v: unknown, ou: string): Source {
  if (!estObjet(v)) throw new ErreurImport(`${ou} : objet { "libelle", "url" } attendu.`);
  clesConnues(v, ['libelle', 'url'], ou);
  const url = texte(v, 'url', ou);
  let protocole = '';
  try {
    protocole = new URL(url).protocol;
  } catch {
    // traité ci-dessous
  }
  if (protocole !== 'https:' && protocole !== 'http:')
    throw new ErreurImport(`${ou} : URL publique http(s) attendue, pas « ${url} ».`);
  return { libelle: texte(v, 'libelle', ou), url };
}

function lireVerification(v: unknown, ou: string): Verification {
  if (!estObjet(v)) {
    throw new ErreurImport(
      `${ou} : objet { "declaree": …, "sansInterdiction": … } attendu (texte, ou null si pas encore vérifié).`,
    );
  }
  clesConnues(v, ['declaree', 'sansInterdiction'], ou);
  const champ = (cle: 'declaree' | 'sansInterdiction') => {
    const valeur = v[cle];
    if (valeur === null) return null;
    if (!estTexte(valeur)) throw new ErreurImport(`${ou}.${cle} : texte (comment et quand c'est vérifié) ou null.`);
    return valeur.trim();
  };
  return { declaree: champ('declaree'), sansInterdiction: champ('sansInterdiction') };
}

function lireManif(v: unknown, rang: number, jour: string): ManifDeclaree {
  let ou = `manif n° ${rang + 1}`;
  if (!estObjet(v)) throw new ErreurImport(`${ou} : objet attendu.`);
  clesConnues(
    v,
    [
      'id',
      'intitule',
      'ville',
      'depart',
      'ouverture',
      'parcoursAnnonce',
      'etapes',
      'zonesEvitees',
      'sources',
      'verifie',
      'aVerifier',
    ],
    ou,
  );
  const ville = texte(v, 'ville', ou);
  ou = `manif n° ${rang + 1} (${ville})`;
  const departTexte = texte(v, 'depart', ou);
  const depart = enErreurImport(() => lireHeure(departTexte, `${ou} : départ`));
  if (jourAParis(depart) !== jour) {
    throw new ErreurImport(`${ou} : départ le ${jourAParis(depart)}, pas le ${jour} (jour du fichier).`);
  }
  const ouverture = texteFacultatif(v, 'ouverture', ou);
  if (ouverture !== undefined && enErreurImport(() => lireHeure(ouverture, `${ou} : ouverture`)) > depart) {
    throw new ErreurImport(`${ou} : l'ouverture des entrées doit précéder le départ.`);
  }
  const id = texteFacultatif(v, 'id', ou) ?? `${enIdentifiant(ville)}-${jour}`;
  if (!FORMAT_ID_MANIF.test(id))
    throw new ErreurImport(`${ou} : identifiant « ${id} » invalide (minuscules, chiffres et tirets).`);
  ou = `manif « ${id} »`;

  if (!Array.isArray(v.etapes) || v.etapes.length < 2) {
    throw new ErreurImport(`${ou} : « etapes » doit lister au moins le départ et l'arrivée.`);
  }
  const etapes = v.etapes.map((e, i) => lireEtape(e, `${ou}, étape n° ${i + 1}`));
  for (const extremite of [0, etapes.length - 1]) {
    if ('rue' in etapes[extremite]!) {
      throw new ErreurImport(
        `${ou}, étape n° ${extremite + 1} : le départ et l'arrivée sont des lieux (« adresse » ou « position »), pas une « rue ».`,
      );
    }
  }
  const zones = v.zonesEvitees === undefined ? [] : v.zonesEvitees;
  if (!Array.isArray(zones)) throw new ErreurImport(`${ou} : « zonesEvitees » doit être une liste.`);
  const zonesEvitees = zones.map((z, i) => {
    const ouZ = `${ou}, zone évitée n° ${i + 1}`;
    if (!estObjet(z)) throw new ErreurImport(`${ouZ} : objet { "adresse", "rayonM" } attendu.`);
    clesConnues(z, ['adresse', 'rayonM'], ouZ);
    const rayonM = z.rayonM;
    if (typeof rayonM !== 'number' || !(rayonM > 0 && rayonM <= 1000))
      throw new ErreurImport(`${ouZ} : « rayonM » entre 0 et 1000 m.`);
    return { adresse: texte(z, 'adresse', ouZ), rayonM };
  });
  if (!Array.isArray(v.sources) || v.sources.length === 0) {
    throw new ErreurImport(`${ou} : « sources » obligatoire (au moins une source publique du parcours).`);
  }
  const aVerifier = texteFacultatif(v, 'aVerifier', ou);
  return {
    id,
    intitule: texte(v, 'intitule', ou),
    ville,
    depart: departTexte,
    ...(ouverture === undefined ? {} : { ouverture }),
    parcoursAnnonce: texte(v, 'parcoursAnnonce', ou),
    etapes,
    zonesEvitees,
    sources: v.sources.map((s, i) => lireSource(s, `${ou}, source n° ${i + 1}`)),
    verifie: lireVerification(v.verifie, `${ou}, verifie`),
    ...(aVerifier === undefined ? {} : { aVerifier }),
  };
}

function enErreurImport<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    throw new ErreurImport((e as Error).message);
  }
}

/** Valide le contenu d'un fichier du jour (`nomFichier` : `2026-11-14.json`, qui donne le jour). */
export function lireJournee(json: unknown, nomFichier: string): JourneeDeclaree {
  const jour = /(\d{4}-\d{2}-\d{2})\.json$/.exec(nomFichier)?.[1];
  if (!jour) throw new ErreurImport(`${nomFichier} : le fichier du jour se nomme <AAAA-MM-JJ>.json.`);
  if (!estObjet(json)) throw new ErreurImport(`${nomFichier} : objet { "manifs": [...] } attendu.`);
  clesConnues(json, ['$commentaire', 'manifs'], nomFichier);
  if (!Array.isArray(json.manifs) || json.manifs.length === 0)
    throw new ErreurImport(`${nomFichier} : « manifs » doit être une liste non vide.`);
  const manifs = json.manifs.map((m, i) => lireManif(m, i, jour));
  const vus = new Set<string>();
  for (const m of manifs) {
    if (vus.has(m.id))
      throw new ErreurImport(`${nomFichier} : identifiant « ${m.id} » en double (donner un « id » à l'une des deux).`);
    vus.add(m.id);
  }
  return { jour, manifs };
}

/**
 * Empreinte de ce qui détermine le tracé (étapes, zones évitées, ville) :
 * inscrite dans le GeoJSON tracé ; la publication refuse un tracé périmé.
 */
export function empreinteTrace(manif: ManifDeclaree): string {
  const contenu = JSON.stringify({ ville: manif.ville, etapes: manif.etapes, zonesEvitees: manif.zonesEvitees });
  return createHash('sha256').update(contenu).digest('hex').slice(0, 16);
}

/** Texte de l'étape tel qu'écrit dans le fichier du jour. */
export function decrireEtape(etape: EtapeDeclaree): string {
  if ('adresse' in etape) return etape.adresse;
  if ('rue' in etape) return etape.rue;
  return `${etape.libelle} [${etape.position.join(', ')}]`;
}
