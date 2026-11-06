import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  CHEMIN_LISTE_MANIFS,
  CHEMIN_RETRAITS,
  VERSION_FORMAT,
  MINUTE_MS,
  calculerFin,
  cheminEntreesMinute,
  debutDeMinute,
  longueurParcours,
  minutesPubliees,
  type EntreePubliee,
  type EntreesMinute,
  type ListeManifs,
  type ManifPubliee,
  type Parcours,
  type Retraits,
  type Source,
} from '@petit-cortege/shared';
import type postgres from 'postgres';
import type { Sql } from './base';
import type { Horloge } from './horloge';
import { verrouillerPourPublication } from './verrou';

export interface DependancesPublication {
  sql: Sql;
  horloge: Horloge;
  dossierPublication: string;
}

/** Écrit un fichier publié de façon atomique (jamais lu à moitié écrit). */
async function ecrire(dossier: string, chemin: string, contenu: unknown): Promise<void> {
  const destination = join(dossier, chemin);
  await mkdir(dirname(destination), { recursive: true });
  const temporaire = `${destination}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporaire, JSON.stringify(contenu));
  await rename(temporaire, destination);
}

type Requeteur = Sql | postgres.TransactionSql;

interface LigneManif {
  id: string;
  intitule: string;
  ville: string;
  ouverture: Date;
  depart: Date;
  parcours: Parcours;
  sources: Source[];
}

const existe = (chemin: string) =>
  access(chemin).then(
    () => true,
    () => false,
  );

/**
 * Tâche de publication, idempotente :
 * - écrit le fichier de chaque minute écoulée pas encore publiée (toutes manifs
 *   confondues, immuable, y compris vide pour que le client n'attende pas) ;
 * - réécrit la liste des manifs, avec le compteur des entrées publiées ;
 * - réécrit le fichier des retraits.
 */
export async function publier({ sql, horloge, dossierPublication }: DependancesPublication): Promise<void> {
  // Exclusif avec les entrées en cours (voir verrou.ts) ; l'horloge est lue une fois le verrou obtenu.
  await sql.begin(async (tx) => {
    await verrouillerPourPublication(tx);
    await publierSousVerrou(tx, horloge.maintenant(), dossierPublication);
  });
}

async function publierSousVerrou(sql: Requeteur, maintenant: Date, dossierPublication: string): Promise<void> {
  const minuteEnCours = debutDeMinute(maintenant);
  const lignes = await sql<LigneManif[]>`
    select id, intitule, ville, ouverture, depart, parcours, sources
    from manif where ouverture <= ${maintenant} order by depart, id`;
  const compteurs = await sql<{ manif_id: string; n: number }[]>`
    select manif_id, count(*)::int as n from avatar
    where entree < ${minuteEnCours} and not exists (select 1 from retrait where avatar_id = avatar.id)
    group by manif_id`;
  const compteurParManif = new Map(compteurs.map((c) => [c.manif_id, c.n]));

  const manifs: ManifPubliee[] = lignes.map((l) => {
    const longueurM = longueurParcours(l.parcours);
    return {
      id: l.id,
      intitule: l.intitule,
      ville: l.ville,
      ouverture: l.ouverture.toISOString(),
      depart: l.depart.toISOString(),
      fin: calculerFin(l.depart, longueurM).toISOString(),
      parcours: l.parcours,
      longueurM,
      sources: l.sources,
      compteur: compteurParManif.get(l.id) ?? 0,
    };
  });

  await publierMinutes(sql, dossierPublication, manifs, maintenant);

  const liste: ListeManifs = { v: VERSION_FORMAT, generee: maintenant.toISOString(), manifs };
  await ecrire(dossierPublication, CHEMIN_LISTE_MANIFS, liste);

  await publierRetraits(sql, dossierPublication, maintenant);
}

/** Retraits des avatars des manifs publiées (mêmes manifs que la liste). */
async function publierRetraits(sql: Requeteur, dossier: string, maintenant: Date): Promise<void> {
  const lignes = await sql<{ id: string }[]>`
    select r.avatar_id as id from retrait r
    join avatar a on a.id = r.avatar_id
    join manif m on m.id = a.manif_id
    where m.ouverture <= ${maintenant}
    order by r.avatar_id collate "C"`;
  const retraits: Retraits = { v: VERSION_FORMAT, generee: maintenant.toISOString(), retraits: lignes.map((l) => l.id) };
  await ecrire(dossier, CHEMIN_RETRAITS, retraits);
}

async function publierMinutes(sql: Requeteur, dossier: string, manifs: ManifPubliee[], maintenant: Date): Promise<void> {
  const attendues = new Set<number>();
  for (const manif of manifs) for (const m of minutesPubliees(manif, maintenant)) attendues.add(m.getTime());

  const aEcrire: number[] = [];
  for (const m of [...attendues].sort((a, b) => a - b)) {
    if (!(await existe(join(dossier, cheminEntreesMinute(new Date(m)))))) aEcrire.push(m);
  }
  if (aEcrire.length === 0) return;

  const debut = new Date(aEcrire[0]!);
  const fin = new Date(aEcrire[aEcrire.length - 1]! + MINUTE_MS);
  const avatars = await sql<{ id: string; manif_id: string; entree: Date; apparence: number; pancarte: number }[]>`
    select id, manif_id, entree, apparence, pancarte from avatar
    where entree >= ${debut} and entree < ${fin} order by entree, id`;
  const parMinute = new Map<number, EntreePubliee[]>();
  for (const a of avatars) {
    const m = debutDeMinute(a.entree).getTime();
    const liste = parMinute.get(m) ?? [];
    liste.push({ a: a.id, m: a.manif_id, t: Math.floor(a.entree.getTime() / 1000), ap: a.apparence, pa: a.pancarte });
    parMinute.set(m, liste);
  }

  for (const m of aEcrire) {
    const fichier: EntreesMinute = {
      v: VERSION_FORMAT,
      minute: new Date(m).toISOString(),
      entrees: parMinute.get(m) ?? [],
    };
    await ecrire(dossier, cheminEntreesMinute(new Date(m)), fichier);
  }
}
