import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { solveChallenge, type Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import { CHEMIN_API_DEFI, CHEMIN_API_ENTREE } from '@petit-cortege/shared';
import { demarrerServeur, type Horloge, type OptionsAntiTriche, type Serveur, type Sql } from '../src/index';

export const URL_POSTGRES_ADMIN =
  process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

/** Horloge contrôlée par le test. */
export class HorlogeControlee implements Horloge {
  #maintenant: Date;
  constructor(depart: string) {
    this.#maintenant = new Date(depart);
  }
  maintenant(): Date {
    return new Date(this.#maintenant);
  }
  regler(instant: string): void {
    this.#maintenant = new Date(instant);
  }
}

/** Base Postgres jetable, propre à un fichier de test (les agents tournent en parallèle). */
export async function creerBaseDeTest(): Promise<{ sql: Sql; url: string; detruire: () => Promise<void> }> {
  const nom = `pc_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(URL_POSTGRES_ADMIN, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${nom}`);
  const url = new URL(URL_POSTGRES_ADMIN);
  url.pathname = `/${nom}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  return {
    sql,
    url: url.toString(),
    detruire: async () => {
      await sql.end();
      await admin.unsafe(`drop database if exists ${nom}`);
      await admin.end();
    },
  };
}

export interface Banc {
  sql: Sql;
  /** URL de la base jetable (ex. pour un pg_dump). */
  urlBase: string;
  horloge: HorlogeControlee;
  serveur: Serveur;
  dossierPublication: string;
  lire: <T = unknown>(chemin: string) => Promise<{ statut: number; corps: T }>;
  /** POST JSON, comme le client (une chaîne est envoyée telle quelle). */
  poster: <T = unknown>(
    chemin: string,
    corps: unknown,
    entetes?: Record<string, string>,
  ) => Promise<{ statut: number; corps: T }>;
  /** Demande un défi ALTCHA et le résout, comme le client : preuve prête à joindre à une entrée. */
  preuve: (entetes?: Record<string, string>) => Promise<string>;
  /** Entrée dans un cortège avec une preuve de travail valide. */
  entrer: <T = unknown>(corps: object, entetes?: Record<string, string>) => Promise<{ statut: number; corps: T }>;
  arreter: () => Promise<void>;
}

/**
 * Anti-triche des tests : preuve de travail quasi gratuite, limites hautes.
 * Un test qui vérifie une limite passe ses propres valeurs à `demarrerBanc`.
 */
export const ANTI_TRICHE_DE_TEST: OptionsAntiTriche = {
  cleHmac: 'cle-hmac-de-test',
  difficulte: { cout: 1, compteurMin: 1, compteurMax: 20 },
  limiteParIp: { requetes: 10_000, fenetreMs: 60_000 },
};

/** Démarre un vrai serveur HTTP sur une base jetable, avec une horloge contrôlée. */
export async function demarrerBanc(
  instantInitial: string,
  antiTriche: Partial<OptionsAntiTriche> = {},
): Promise<Banc> {
  const base = await creerBaseDeTest();
  const horloge = new HorlogeControlee(instantInitial);
  const dossierPublication = await mkdtemp(join(tmpdir(), 'pc-publie-'));
  const serveur = await demarrerServeur({
    sql: base.sql,
    horloge,
    dossierPublication,
    port: 0,
    antiTriche: { ...ANTI_TRICHE_DE_TEST, ...antiTriche },
  });
  const poster: Banc['poster'] = async (chemin, corps, entetes = {}) => {
    const reponse = await fetch(new URL(chemin, serveur.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: typeof corps === 'string' ? corps : JSON.stringify(corps),
    });
    const texte = await reponse.text();
    let corpsLu: unknown = texte;
    try {
      corpsLu = JSON.parse(texte);
    } catch {
      // corps non JSON (ex. 404 par défaut) : gardé en texte
    }
    return { statut: reponse.status, corps: corpsLu as never };
  };
  const preuve: Banc['preuve'] = async (entetes = {}) => {
    const reponse = await fetch(new URL(CHEMIN_API_DEFI, serveur.url), { headers: entetes });
    if (!reponse.ok) throw new Error(`défi refusé : ${reponse.status}`);
    const challenge = (await reponse.json()) as Challenge;
    const solution = await solveChallenge({ challenge, deriveKey });
    if (!solution) throw new Error('défi non résolu');
    return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
  };
  return {
    sql: base.sql,
    urlBase: base.url,
    horloge,
    serveur,
    dossierPublication,
    lire: async (chemin) => {
      const reponse = await fetch(new URL(chemin, serveur.url));
      const texte = await reponse.text();
      return { statut: reponse.status, corps: (reponse.ok ? JSON.parse(texte) : texte) as never };
    },
    poster,
    preuve,
    entrer: async (corps, entetes) =>
      poster(CHEMIN_API_ENTREE, { ...corps, preuve: await preuve(entetes) }, entetes),
    arreter: async () => {
      await serveur.fermer();
      await base.detruire();
      await rm(dossierPublication, { recursive: true, force: true });
    },
  };
}

const RACINE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/publication');

async function listerFichiers(dossier: string): Promise<string[]> {
  const entrees = await readdir(dossier, { withFileTypes: true, recursive: true }).catch(() => []);
  return entrees.filter((e) => e.isFile()).map((e) => relative(dossier, join(e.parentPath, e.name)));
}

/**
 * Copie les fichiers publiés dans `fixtures/publication/<scenario>/` (versionné),
 * où les tests du Cortège les relisent. Écriture atomique (fichier temporaire
 * puis renommage) et seulement si le contenu change, pour ne pas gêner les
 * tests du client qui lisent ces fixtures en parallèle.
 */
export async function enregistrerFixtures(dossierPublication: string, scenario: string): Promise<void> {
  const cible = join(RACINE_FIXTURES, scenario);
  const publies = await listerFichiers(dossierPublication);
  for (const chemin of publies) {
    const contenu = await readFile(join(dossierPublication, chemin), 'utf8');
    const destination = join(cible, chemin);
    const existant = await readFile(destination, 'utf8').catch(() => null);
    if (existant === contenu) continue;
    await mkdir(dirname(destination), { recursive: true });
    const temporaire = `${destination}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(temporaire, contenu);
    await rename(temporaire, destination);
  }
  for (const chemin of await listerFichiers(cible)) {
    if (!publies.includes(chemin)) await rm(join(cible, chemin));
  }
}
