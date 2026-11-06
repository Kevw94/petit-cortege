import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export type Sql = postgres.Sql;

const DOSSIER_MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function connecter(url: string): Sql {
  return postgres(url, { onnotice: () => {} });
}

/** Applique, dans l'ordre, les fichiers `migrations/NNN_*.sql` pas encore appliqués. */
export async function migrer(sql: Sql): Promise<void> {
  await sql`create table if not exists migration (nom text primary key, appliquee timestamptz not null default now())`;
  const fichiers = (await readdir(DOSSIER_MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  const appliquees = new Set((await sql<{ nom: string }[]>`select nom from migration`).map((r) => r.nom));
  for (const fichier of fichiers) {
    if (appliquees.has(fichier)) continue;
    const contenu = await readFile(join(DOSSIER_MIGRATIONS, fichier), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(contenu);
      await tx`insert into migration (nom) values (${fichier})`;
    });
  }
}
