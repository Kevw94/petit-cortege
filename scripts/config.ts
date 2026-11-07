import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const URL_BASE_DEV = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/petit_cortege_dev';
export const DOSSIER_PUBLICATION_DEV = process.env.DOSSIER_PUBLICATION ?? join(RACINE, 'var/publie');
export const PORT_SERVEUR = Number(process.env.PORT_SERVEUR ?? 8787);
export const PORT_CLIENT = Number(process.env.PORT_CLIENT ?? 5173);

/** Crée la base de dev si elle n'existe pas encore. */
export async function assurerBase(url: string): Promise<void> {
  const cible = new URL(url);
  const nom = cible.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existe] = await sql`select 1 from pg_database where datname = ${nom}`;
    if (!existe) await sql.unsafe(`create database "${nom.replaceAll('"', '""')}"`);
  } catch (erreur) {
    if ((erreur as { code?: string }).code === 'ECONNREFUSED') {
      throw new Error(
        `Postgres ne répond pas sur ${cible.host}. Lance-le avec \`npm run db:start\` (Docker), ` +
          'ou indique un Postgres existant avec DATABASE_URL. Voir « Prérequis » dans le README.',
        { cause: erreur },
      );
    }
    throw erreur;
  } finally {
    await sql.end();
  }
}
