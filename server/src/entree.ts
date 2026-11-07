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
 * L'heure stockée est la minute de réception + un aléa de 0 à 59 s (ADR 0001) :
 * elle tombe toujours dans la minute en cours, jamais publiée. Le verrou partagé
 * avec la tâche de publication garantit qu'elle ne publie pas cette minute
 * pendant l'insertion (sinon l'entrée serait perdue : une minute publiée est immuable).
 */
export async function entrer(sql: Sql, horloge: Horloge, requete: RequeteEntree): Promise<ResultatEntree> {
  return sql.begin(async (tx) => {
    await verrouillerContrePublication(tx);
    const maintenant = horloge.maintenant();
    const [manif] = await tx<{ ouverture: Date; depart: Date; parcours: Parcours }[]>`
      select ouverture, depart, parcours from manif where id = ${requete.manif} and retiree is null`;
    // Une manif retirée par la modération est traitée comme inconnue.
    if (!manif || manif.ouverture > maintenant) return { ok: false, erreur: 'manif-inconnue' } as const;
    if (maintenant >= calculerFin(manif.depart, longueurParcours(manif.parcours))) {
      return { ok: false, erreur: 'manif-terminee' } as const;
    }

    const id = nouvelIdentifiant();
    const entree = new Date(debutDeMinute(maintenant).getTime() + randomInt(MINUTE_MS / 1000) * 1000);
    // Seul le hachage du jeton de retrait est stocké, jamais le jeton (ADR 0001).
    const hachageRetrait = requete.hachageRetrait ? Buffer.from(requete.hachageRetrait, 'hex') : null;
    await tx`
      insert into avatar (id, manif_id, entree, apparence, pancarte, hachage_retrait)
      values (${id}, ${requete.manif}, ${entree}, ${requete.apparence}, ${requete.pancarte}, ${hachageRetrait})`;
    return { ok: true, reponse: { avatar: id, entree: entree.getTime() / 1000 } } as const;
  });
}
