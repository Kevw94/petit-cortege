/**
 * Entrée dans un cortège : un POST, identifiant de manif dans le corps (ADR 0002).
 */
import {
  CHEMIN_API_ENTREE,
  type CodeErreurEntree,
  type EntreePubliee,
  type ReponseEntree,
  type RequeteEntree,
} from '@petit-cortege/shared';

export class EntreeRefusee extends Error {
  readonly code: CodeErreurEntree | 'reseau';
  constructor(code: CodeErreurEntree | 'reseau') {
    super(`Entrée refusée : ${code}`);
    this.code = code;
  }
}

/** Fait entrer un avatar ; renvoie l'entrée telle qu'elle sera publiée. */
export async function rejoindreLeCortege(requete: RequeteEntree): Promise<EntreePubliee> {
  const reponse = await fetch(CHEMIN_API_ENTREE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requete),
  }).catch(() => null);
  if (!reponse) throw new EntreeRefusee('reseau');
  const corps = (await reponse.json().catch(() => null)) as (ReponseEntree & { erreur?: CodeErreurEntree }) | null;
  if (!reponse.ok || !corps) throw new EntreeRefusee(corps?.erreur ?? 'reseau');
  return { a: corps.avatar, m: requete.manif, t: corps.entree, ap: requete.apparence, pa: requete.pancarte };
}
