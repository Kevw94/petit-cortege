import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { demarrerServeur, type Horloge, type Serveur, type Sql } from '../src/index';

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
export async function creerBaseDeTest(): Promise<{ sql: Sql; detruire: () => Promise<void> }> {
  const nom = `pc_test_${randomBytes(6).toString('hex')}`;
  const admin = postgres(URL_POSTGRES_ADMIN, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${nom}`);
  const url = new URL(URL_POSTGRES_ADMIN);
  url.pathname = `/${nom}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  return {
    sql,
    detruire: async () => {
      await sql.end();
      await admin.unsafe(`drop database if exists ${nom}`);
      await admin.end();
    },
  };
}

export interface Banc {
  sql: Sql;
  horloge: HorlogeControlee;
  serveur: Serveur;
  dossierPublication: string;
  lire: <T = unknown>(chemin: string) => Promise<{ statut: number; corps: T }>;
  /** POST JSON, comme le client (une chaîne est envoyée telle quelle). */
  poster: <T = unknown>(chemin: string, corps: unknown) => Promise<{ statut: number; corps: T }>;
  arreter: () => Promise<void>;
}

/** Démarre un vrai serveur HTTP sur une base jetable, avec une horloge contrôlée. */
export async function demarrerBanc(instantInitial: string): Promise<Banc> {
  const base = await creerBaseDeTest();
  const horloge = new HorlogeControlee(instantInitial);
  const dossierPublication = await mkdtemp(join(tmpdir(), 'pc-publie-'));
  const serveur = await demarrerServeur({ sql: base.sql, horloge, dossierPublication, port: 0 });
  return {
    sql: base.sql,
    horloge,
    serveur,
    dossierPublication,
    lire: async (chemin) => {
      const reponse = await fetch(new URL(chemin, serveur.url));
      const texte = await reponse.text();
      return { statut: reponse.status, corps: (reponse.ok ? JSON.parse(texte) : texte) as never };
    },
    poster: async (chemin, corps) => {
      const reponse = await fetch(new URL(chemin, serveur.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    },
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
