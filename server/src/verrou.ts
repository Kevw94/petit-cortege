/**
 * Verrou consultatif Postgres entre les entrées et la tâche de publication
 * (valable aussi entre plusieurs processus serveur).
 *
 * Une entrée prend le verrou en partage (les entrées ne se bloquent pas entre
 * elles), la publication le prend en exclusif. Chacune lit l'horloge APRÈS
 * l'avoir obtenu : une entrée validée avant la publication est vue par elle.
 *
 * Les horloges sont celles des processus Node, pas celle de la base : le verrou
 * seul ne suffit pas si elles diffèrent. La publication écrit donc sous le verrou
 * une marque haute en base (`publication_etat.avant`, première minute non publiée)
 * et l'entrée ne descend jamais en dessous (voir entree.ts) : une entrée arrivée
 * après une publication tombe toujours dans une minute que celle-ci n'a pas publiée,
 * quel que soit l'écart d'horloge.
 */
import type postgres from 'postgres';

const CLE_VERROU_PUBLICATION = 0x70_63_70_75; // « pcpu »

type Transaction = postgres.TransactionSql;

export async function verrouillerContrePublication(tx: Transaction): Promise<void> {
  await tx`select pg_advisory_xact_lock_shared(${CLE_VERROU_PUBLICATION})`;
}

export async function verrouillerPourPublication(tx: Transaction): Promise<void> {
  await tx`select pg_advisory_xact_lock(${CLE_VERROU_PUBLICATION})`;
}
