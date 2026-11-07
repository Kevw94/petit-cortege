import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  CHEMIN_LISTE_MANIFS,
  CHEMIN_RETRAITS,
  VERSION_FORMAT,
  CONSULTATION_APRES_FIN_MS,
  MINUTE_MS,
  calculerFin,
  cheminEntreesHeure,
  cheminEntreesMinute,
  debutDeMinute,
  fichiersPublies,
  lireEntreesMinute,
  longueurParcours,
  minutesPubliees,
  type EntreePubliee,
  type EntreesHeure,
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
 * - compacte chaque heure terminée en un fichier horaire (immuable) ;
 * - réécrit la liste des manifs, avec le compteur des entrées publiées ;
 * - réécrit le fichier des retraits ;
 * - efface les hachages de jetons de retrait des manifs terminées (ADR 0001).
 *
 * La liste garde les manifs terminées depuis moins de `CONSULTATION_APRES_FIN_MS`
 * (image finale consultable plus tard) ; le fichier des retraits, les mêmes manifs.
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
    from manif where ouverture <= ${maintenant} and retiree is null order by depart, id`;
  const compteurs = await sql<{ manif_id: string; n: number }[]>`
    select manif_id, count(*)::int as n from avatar
    where entree < ${minuteEnCours} and not exists (select 1 from retrait where avatar_id = avatar.id)
    group by manif_id`;
  const compteurParManif = new Map(compteurs.map((c) => [c.manif_id, c.n]));

  const toutes: ManifPubliee[] = lignes.map((l) => {
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
  const manifs = toutes.filter((m) => Date.parse(m.fin) + CONSULTATION_APRES_FIN_MS > maintenant.getTime());

  await publierMinutes(sql, dossierPublication, manifs, maintenant);
  await compacterHeures(dossierPublication, manifs, maintenant);

  const liste: ListeManifs = { v: VERSION_FORMAT, generee: maintenant.toISOString(), manifs };
  await ecrire(dossierPublication, CHEMIN_LISTE_MANIFS, liste);

  await publierRetraits(sql, dossierPublication, manifs, maintenant);
  await effacerHachagesDesManifsTerminees(sql, maintenant);
}

/** Retraits des avatars des manifs publiées (mêmes manifs que la liste). */
async function publierRetraits(sql: Requeteur, dossier: string, manifs: ManifPubliee[], maintenant: Date): Promise<void> {
  const ids = manifs.map((m) => m.id);
  const lignes = await sql<{ id: string }[]>`
    select r.avatar_id as id from retrait r
    join avatar a on a.id = r.avatar_id
    where a.manif_id = any(${ids}::text[])
    order by r.avatar_id collate "C"`;
  const retraits: Retraits = { v: VERSION_FORMAT, generee: maintenant.toISOString(), retraits: lignes.map((l) => l.id) };
  await ecrire(dossier, CHEMIN_RETRAITS, retraits);
}

/**
 * Efface les hachages de jetons de retrait des manifs terminées, retirées comprises
 * (ADR 0001 : au plus tard 1 h après la fin ; la tâche tourne chaque minute, donc dès la
 * première publication après la fin). Le retrait devient impossible ; l'avatar anonyme
 * reste. Le client, lui, efface son jeton à la fin.
 */
async function effacerHachagesDesManifsTerminees(sql: Requeteur, maintenant: Date): Promise<void> {
  const avecHachages = await sql<{ id: string; depart: Date; parcours: Parcours }[]>`
    select id, depart, parcours from manif m
    where exists (select 1 from avatar a where a.manif_id = m.id and a.hachage_retrait is not null)`;
  const terminees = avecHachages
    .filter((m) => calculerFin(m.depart, longueurParcours(m.parcours)) <= maintenant)
    .map((m) => m.id);
  if (terminees.length === 0) return;
  await sql`
    update avatar set hachage_retrait = null
    where manif_id = any(${terminees}::text[]) and hachage_retrait is not null`;
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

/**
 * Écrit le fichier de chaque heure terminée pas encore compactée : la
 * concaténation, dans l'ordre, des fichiers par minute publiés de cette heure.
 * Construit depuis les fichiers déjà publiés (et non depuis la base), il
 * contient exactement les mêmes entrées : le client voit la même foule.
 */
async function compacterHeures(dossier: string, manifs: ManifPubliee[], maintenant: Date): Promise<void> {
  const heures = new Map<number, Set<number>>();
  for (const manif of manifs) {
    for (const { heure, minutes } of fichiersPublies(manif, maintenant).heures) {
      const deLHeure = heures.get(heure.getTime()) ?? new Set<number>();
      for (const m of minutes) deLHeure.add(m.getTime());
      heures.set(heure.getTime(), deLHeure);
    }
  }

  for (const [heure, minutes] of [...heures].sort(([a], [b]) => a - b)) {
    const chemin = cheminEntreesHeure(new Date(heure));
    if (await existe(join(dossier, chemin))) continue;
    const entrees: EntreePubliee[] = [];
    for (const m of [...minutes].sort((a, b) => a - b)) {
      const contenu = await readFile(join(dossier, cheminEntreesMinute(new Date(m))), 'utf8');
      entrees.push(...lireEntreesMinute(JSON.parse(contenu)).entrees);
    }
    const fichier: EntreesHeure = { v: VERSION_FORMAT, heure: new Date(heure).toISOString(), entrees };
    await ecrire(dossier, chemin, fichier);
  }
}
