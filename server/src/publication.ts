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
  debutDHeure,
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
 * - efface les hachages de jetons de retrait des manifs terminées (ADR 0001) ;
 * - écrit le fichier de chaque minute écoulée pas encore publiée (toutes manifs
 *   confondues, immuable, y compris vide pour que le client n'attende pas) ;
 * - compacte chaque heure terminée en un fichier horaire (immuable) ;
 * - réécrit la liste des manifs, avec le compteur des entrées publiées ;
 * - réécrit le fichier des retraits.
 * Un incident sur une étape n'empêche pas les suivantes ; le passage échoue ensuite
 * (`AggregateError`) pour être journalisé et retenté au passage suivant.
 *
 * La liste garde les manifs terminées depuis moins de `CONSULTATION_APRES_FIN_MS`
 * (image finale consultable plus tard) ; le fichier des retraits, les mêmes manifs.
 */
export async function publier({ sql, horloge, dossierPublication }: DependancesPublication): Promise<void> {
  // Exclusif avec les entrées en cours (voir verrou.ts) ; l'horloge est lue une fois le verrou obtenu.
  const incidents = await sql.begin(async (tx) => {
    await verrouillerPourPublication(tx);
    return publierSousVerrou(tx, horloge.maintenant(), dossierPublication);
  });
  // Signalé après la validation de la transaction : l'effacement des hachages est gardé.
  if (incidents.length > 0) throw new AggregateError(incidents, 'Publication incomplète');
}

/**
 * Chaque étape est isolée : un incident sur un fichier (disque, fichier abîmé) est
 * journalisé et n'empêche pas les suivantes. L'effacement des hachages (ADR 0001)
 * passe en premier. Renvoie les incidents.
 */
async function publierSousVerrou(sql: Requeteur, maintenant: Date, dossierPublication: string): Promise<unknown[]> {
  const incidents: unknown[] = [];
  const etape = async (nom: string, faire: () => Promise<void>) => {
    try {
      await faire();
    } catch (e) {
      incidents.push(e);
      console.error(`Publication, ${nom} en échec :`, e instanceof Error ? e.message : e);
    }
  };

  const minuteEnCours = debutDeMinute(maintenant);
  // Marque haute, avant d'écrire la moindre minute : les entrées reçues ensuite, même par
  // un processus à l'horloge en retard, tombent après (voir entree.ts).
  await sql`
    insert into publication_etat (avant) values (${minuteEnCours})
    on conflict (unique_ligne) do update set avant = greatest(publication_etat.avant, excluded.avant)`;

  await etape('effacement des hachages', () => effacerHachagesDesManifsTerminees(sql, maintenant));

  // Fin de chaque manif : elle dépend du nombre de soutiens entrés, retirés compris (ADR 0004).
  const lignes = (
    await sql<(LigneManif & { entres: number })[]>`
      select id, intitule, ville, ouverture, depart, parcours, sources,
        (select count(*)::int from avatar a where a.manif_id = manif.id) as entres
      from manif where ouverture <= ${maintenant} and retiree is null order by depart, id`
  )
    .map((l) => ({ ...l, fin: calculerFin(l.depart, longueurParcours(l.parcours), l.entres) }))
    .filter((l) => l.fin.getTime() + CONSULTATION_APRES_FIN_MS > maintenant.getTime());
  // Compteurs des seules manifs listées (index avatar_manif), pas de toute la table.
  const ids = lignes.map((l) => l.id);
  const compteurs = await sql<{ manif_id: string; n: number }[]>`
    select manif_id, count(*)::int as n from avatar
    where manif_id = any(${ids}::text[]) and entree < ${minuteEnCours}
      and not exists (select 1 from retrait where avatar_id = avatar.id)
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
      fin: l.fin.toISOString(),
      parcours: l.parcours,
      longueurM,
      sources: l.sources,
      compteur: compteurParManif.get(l.id) ?? 0,
    };
  });

  await etape('fichiers par minute', () => publierMinutes(sql, dossierPublication, manifs, maintenant));
  await etape('compactage par heure', () => compacterHeures(sql, dossierPublication, manifs, maintenant));
  await etape('liste des manifs', () =>
    ecrire(dossierPublication, CHEMIN_LISTE_MANIFS, {
      v: VERSION_FORMAT,
      generee: maintenant.toISOString(),
      manifs,
    } satisfies ListeManifs),
  );
  await etape('retraits', () => publierRetraits(sql, dossierPublication, manifs, maintenant));
  return incidents;
}

/** Retraits des avatars des manifs publiées (mêmes manifs que la liste). */
async function publierRetraits(
  sql: Requeteur,
  dossier: string,
  manifs: ManifPubliee[],
  maintenant: Date,
): Promise<void> {
  const ids = manifs.map((m) => m.id);
  const lignes = await sql<{ id: string }[]>`
    select r.avatar_id as id from retrait r
    join avatar a on a.id = r.avatar_id
    where a.manif_id = any(${ids}::text[])
    order by r.avatar_id collate "C"`;
  const retraits: Retraits = {
    v: VERSION_FORMAT,
    generee: maintenant.toISOString(),
    retraits: lignes.map((l) => l.id),
  };
  await ecrire(dossier, CHEMIN_RETRAITS, retraits);
}

/**
 * Efface les hachages de jetons de retrait des manifs terminées, retirées comprises
 * (ADR 0001 : au plus tard 1 h après la fin ; la tâche tourne chaque minute, donc dès la
 * première publication après la fin). Le retrait devient impossible ; l'avatar anonyme
 * reste. Le client, lui, efface son jeton à la fin.
 */
async function effacerHachagesDesManifsTerminees(sql: Requeteur, maintenant: Date): Promise<void> {
  const avecHachages = await sql<{ id: string; depart: Date; parcours: Parcours; entres: number }[]>`
    select id, depart, parcours, (select count(*)::int from avatar a where a.manif_id = m.id) as entres from manif m
    where exists (select 1 from avatar a where a.manif_id = m.id and a.hachage_retrait is not null)`;
  const terminees = avecHachages
    .filter((m) => calculerFin(m.depart, longueurParcours(m.parcours), m.entres) <= maintenant)
    .map((m) => m.id);
  if (terminees.length === 0) return;
  await sql`
    update avatar set hachage_retrait = null
    where manif_id = any(${terminees}::text[]) and hachage_retrait is not null`;
}

/**
 * Entrées en base de `[debut, fin[` (ms), regroupées par minute, dans l'ordre de publication.
 * Seulement les manifs publiées : une manif retirée par la modération ne publie plus d'entrées.
 */
async function entreesParMinute(
  sql: Requeteur,
  manifs: ManifPubliee[],
  debut: number,
  fin: number,
): Promise<Map<number, EntreePubliee[]>> {
  const ids = manifs.map((m) => m.id);
  const avatars = await sql<{ id: string; manif_id: string; entree: Date; apparence: number; pancarte: number }[]>`
    select id, manif_id, entree, apparence, pancarte from avatar
    where entree >= ${new Date(debut)} and entree < ${new Date(fin)} and manif_id = any(${ids}::text[])
    order by entree, id`;
  const parMinute = new Map<number, EntreePubliee[]>();
  for (const a of avatars) {
    const m = debutDeMinute(a.entree).getTime();
    const liste = parMinute.get(m) ?? [];
    liste.push({ a: a.id, m: a.manif_id, t: Math.floor(a.entree.getTime() / 1000), ap: a.apparence, pa: a.pancarte });
    parMinute.set(m, liste);
  }
  return parMinute;
}

async function publierMinutes(
  sql: Requeteur,
  dossier: string,
  manifs: ManifPubliee[],
  maintenant: Date,
): Promise<void> {
  const attendues = new Set<number>();
  for (const manif of manifs) for (const m of minutesPubliees(manif, maintenant)) attendues.add(m.getTime());

  // Une heure compactée a toutes ses minutes publiées (le compactage suit leur écriture) :
  // un seul accès disque par heure passée, puis seulement les minutes des autres heures.
  const heureEnCours = debutDHeure(maintenant).getTime();
  const heuresPassees = [...new Set([...attendues].map((m) => debutDHeure(new Date(m)).getTime()))].filter(
    (h) => h < heureEnCours,
  );
  const compactees = new Set(
    (
      await Promise.all(
        heuresPassees.map(async (h) => ((await existe(join(dossier, cheminEntreesHeure(new Date(h))))) ? h : null)),
      )
    ).filter((h) => h !== null),
  );
  const aVerifier = [...attendues]
    .filter((m) => !compactees.has(debutDHeure(new Date(m)).getTime()))
    .sort((a, b) => a - b);
  const manquantes = await Promise.all(
    aVerifier.map(async (m) => !(await existe(join(dossier, cheminEntreesMinute(new Date(m)))))),
  );
  const aEcrire = aVerifier.filter((_, i) => manquantes[i]);
  if (aEcrire.length === 0) return;

  const parMinute = await entreesParMinute(sql, manifs, aEcrire[0]!, aEcrire[aEcrire.length - 1]! + MINUTE_MS);

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
 * contient exactement les mêmes entrées : le client voit la même foule. Un fichier
 * par minute manquant ou abîmé est reconstitué depuis la base (même requête que
 * sa publication), avec une ligne de journal.
 */
async function compacterHeures(
  sql: Requeteur,
  dossier: string,
  manifs: ManifPubliee[],
  maintenant: Date,
): Promise<void> {
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
    for (const m of [...minutes].sort((a, b) => a - b))
      entrees.push(...(await entreesDeLaMinute(sql, dossier, manifs, m)));
    const fichier: EntreesHeure = { v: VERSION_FORMAT, heure: new Date(heure).toISOString(), entrees };
    await ecrire(dossier, chemin, fichier);
  }
}

async function entreesDeLaMinute(
  sql: Requeteur,
  dossier: string,
  manifs: ManifPubliee[],
  minute: number,
): Promise<EntreePubliee[]> {
  const chemin = cheminEntreesMinute(new Date(minute));
  try {
    return lireEntreesMinute(JSON.parse(await readFile(join(dossier, chemin), 'utf8'))).entrees;
  } catch (e) {
    console.error(`Fichier ${chemin} illisible, reconstitué depuis la base :`, e instanceof Error ? e.message : e);
    return (await entreesParMinute(sql, manifs, minute, minute + MINUTE_MS)).get(minute) ?? [];
  }
}
