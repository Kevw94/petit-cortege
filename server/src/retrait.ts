import { createHash, timingSafeEqual } from 'node:crypto';
import type { CodeErreurRetrait, ReponseRetrait, RequeteRetrait } from '@petit-cortege/shared';
import type { Sql } from './base';

/** Qui a retiré l'avatar. */
export type MotifRetrait = 'soutien' | 'moderation';

export type ResultatRetrait = { ok: true; reponse: ReponseRetrait } | { ok: false; erreur: CodeErreurRetrait };

/**
 * Retire un avatar du cortège : il est ajouté au fichier des retraits à la
 * prochaine publication. Idempotent (le premier motif est gardé).
 * Réutilisable par la modération (« supprimer un avatar précis », #9).
 * Renvoie `false` si l'avatar n'existe pas.
 */
export async function retirerAvatar(sql: Sql, avatarId: string, motif: MotifRetrait): Promise<boolean> {
  const [avatar] = await sql`select 1 from avatar where id = ${avatarId}`;
  if (!avatar) return false;
  await sql`insert into retrait (avatar_id, motif) values (${avatarId}, ${motif}) on conflict (avatar_id) do nothing`;
  return true;
}

const sha256 = (texte: string) => createHash('sha256').update(texte, 'utf8').digest();

/**
 * Retrait demandé par le soutien : le SHA-256 du jeton présenté doit être celui
 * reçu à l'entrée. Impossible sans hachage (jamais fourni, ou effacé après la fin).
 */
export async function retirerParLeSoutien(sql: Sql, requete: RequeteRetrait): Promise<ResultatRetrait> {
  const [avatar] = await sql<{ hachage_retrait: Buffer | null }[]>`
    select hachage_retrait from avatar where id = ${requete.avatar}`;
  const attendu = avatar?.hachage_retrait;
  if (attendu?.length !== 32 || !timingSafeEqual(attendu, sha256(requete.jeton))) {
    return { ok: false, erreur: 'retrait-refuse' };
  }
  await retirerAvatar(sql, requete.avatar, 'soutien');
  return { ok: true, reponse: { avatar: requete.avatar } };
}
