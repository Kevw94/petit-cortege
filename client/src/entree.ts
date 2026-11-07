/**
 * Entrée dans un cortège : un POST, identifiant de manif dans le corps (ADR 0002),
 * avec une preuve de travail ALTCHA (#8).
 */
import {
  CHEMIN_API_ENTREE,
  type CodeErreurEntree,
  type EntreePubliee,
  type ReponseEntree,
  type RequeteEntree,
} from '@petit-cortege/shared';
import { produirePreuve } from './preuve-travail';

export class EntreeRefusee extends Error {
  readonly code: CodeErreurEntree | 'reseau';
  constructor(code: CodeErreurEntree | 'reseau') {
    super(`Entrée refusée : ${code}`);
    this.code = code;
  }
}

/**
 * Fait entrer un avatar ; renvoie l'entrée telle qu'elle sera publiée. La preuve de
 * travail est calculée d'abord (quelques secondes), puis redemandée une fois si le
 * serveur la refuse (défi expiré pendant un long calcul, redémarrage du serveur).
 */
export async function rejoindreLeCortege(requete: Omit<RequeteEntree, 'preuve'>): Promise<EntreePubliee> {
  try {
    return await envoyer(requete);
  } catch (erreur) {
    if (erreur instanceof EntreeRefusee && erreur.code === 'preuve-invalide') return envoyer(requete);
    throw erreur;
  }
}

async function envoyer(requete: Omit<RequeteEntree, 'preuve'>): Promise<EntreePubliee> {
  const preuve = await produirePreuve();
  if (!preuve) throw new EntreeRefusee('reseau');
  const reponse = await fetch(CHEMIN_API_ENTREE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...requete, preuve } satisfies RequeteEntree),
  }).catch(() => null);
  if (!reponse) throw new EntreeRefusee('reseau');
  const corps = (await reponse.json().catch(() => null)) as (ReponseEntree & { erreur?: CodeErreurEntree }) | null;
  if (!reponse.ok || !corps) throw new EntreeRefusee(corps?.erreur ?? 'reseau');
  return { a: corps.avatar, m: requete.manif, t: corps.entree, ap: requete.apparence, pa: requete.pancarte };
}
