import { randomBytes, randomInt } from 'node:crypto';
import {
  calculerFin,
  debutDeMinute,
  longueurParcours,
  MINUTE_MS,
  type CodeErreurEntree,
  type Parcours,
  type ReponseEntree,
  type RequeteEntree,
} from '@petit-cortege/shared';
import type { Sql } from './base';
import type { Horloge } from './horloge';
import { verrouillerContrePublication } from './verrou';

export type ResultatEntree = { ok: true; reponse: ReponseEntree } | { ok: false; erreur: CodeErreurEntree };

/** Identifiant d'avatar : 96 bits aléatoires, sans lien avec la personne (ADR 0001). */
const nouvelIdentifiant = () => randomBytes(12).toString('base64url');

/**
 * Fait entrer un avatar dans le cortège d'une manif.
 *
 * L'heure stockée est la minute de réception + un aléa de 0 à 59 s (ADR 0001).
 * Elle doit tomber dans une minute pas encore publiée (une minute publiée est
 * immuable : l'entrée serait perdue). Le verrou partagé avec la tâche de publication
 * l'empêche de publier pendant l'insertion ; et la minute est au plus tôt la marque
 * haute de la publication (`publication_etat.avant`, lue en base sous ce verrou) :
 * un processus dont l'horloge retarde sur celle du processus qui publie repousse
 * l'entrée à la première minute non publiée au lieu de la perdre.
 */
export async function entrer(sql: Sql, horloge: Horloge, requete: RequeteEntree): Promise<ResultatEntree> {
  return sql.begin(async (tx) => {
    await verrouillerContrePublication(tx);
    const maintenant = horloge.maintenant();
    const [manif] = await tx<{ ouverture: Date; depart: Date; parcours: Parcours }[]>`
      select ouverture, depart, parcours from manif where id = ${requete.manif} and retiree is null`;
    // Une manif retirée par la modération est traitée comme inconnue.
    if (!manif || manif.ouverture > maintenant) return { ok: false, erreur: 'manif-inconnue' } as const;
    const fin = calculerFin(manif.depart, longueurParcours(manif.parcours));
    if (maintenant >= fin) return { ok: false, erreur: 'manif-terminee' } as const;

    const [etat] = await tx<{ avant: Date }[]>`select avant from publication_etat`;
    const minute = Math.max(debutDeMinute(maintenant).getTime(), etat?.avant.getTime() ?? 0);
    // Minute repoussée au-delà de la fin : elle ne serait jamais publiée.
    if (minute >= fin.getTime()) return { ok: false, erreur: 'manif-terminee' } as const;

    const id = nouvelIdentifiant();
    const entree = new Date(minute + randomInt(MINUTE_MS / 1000) * 1000);
    // Seul le hachage du jeton de retrait est stocké, jamais le jeton (ADR 0001).
    const hachageRetrait = requete.hachageRetrait ? Buffer.from(requete.hachageRetrait, 'hex') : null;
    await tx`
      insert into avatar (id, manif_id, entree, apparence, pancarte, hachage_retrait)
      values (${id}, ${requete.manif}, ${entree}, ${requete.apparence}, ${requete.pancarte}, ${hachageRetrait})`;
    return { ok: true, reponse: { avatar: id, entree: entree.getTime() / 1000 } } as const;
  });
}
