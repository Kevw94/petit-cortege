import type { Parcours, Source } from '@petit-cortege/shared';
import type { Sql } from './base';

export interface ManifACreer {
  id: string;
  intitule: string;
  ville: string;
  /** Début des entrées. */
  ouverture: Date;
  depart: Date;
  parcours: Parcours;
  sources: Source[];
  /** Noms annoncés des étapes, du départ à l'arrivée. Vide si le tracé n'en porte pas. */
  etapes?: string[];
}

export async function creerManif(sql: Sql, manif: ManifACreer): Promise<void> {
  await sql`
    insert into manif (id, intitule, ville, ouverture, depart, parcours, sources, etapes)
    values (${manif.id}, ${manif.intitule}, ${manif.ville}, ${manif.ouverture}, ${manif.depart},
            ${sql.json(manif.parcours as never)}, ${sql.json(manif.sources as never)},
            ${sql.json((manif.etapes ?? []) as never)})`;
}

export interface AvatarPreRempli {
  id: string;
  manifId: string;
  entree: Date;
  apparence: number;
  pancarte: number;
}

/**
 * Insère des avatars sans passer par l'entrée publique (seed de dev et tests).
 * L'entrée par POST arrive avec le ticket « Rejoindre le cortège ».
 */
export async function preRemplirAvatars(sql: Sql, avatars: AvatarPreRempli[]): Promise<void> {
  if (avatars.length === 0) return;
  await sql`insert into avatar ${sql(
    avatars.map((a) => ({
      id: a.id,
      manif_id: a.manifId,
      entree: a.entree,
      apparence: a.apparence,
      pancarte: a.pancarte,
    })),
  )}`;
}
