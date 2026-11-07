/**
 * Retrait de son avatar (ADR 0001).
 *
 * Le jeton de retrait (128 bits aléatoires) est généré ici et gardé uniquement
 * dans le localStorage de l'appareil (voir avatars-propres.ts). À l'entrée, le
 * serveur n'en reçoit que le SHA-256 ; le jeton en clair ne voyage qu'au moment
 * du retrait. Il est distinct de tout jeton anti-triche.
 */
import { CHEMIN_API_RETRAIT, type CodeErreurRetrait, type RequeteRetrait } from '@petit-cortege/shared';
import { jetonDeRetrait, oublierAvatarPropre, oublierJetonDeRetrait } from './avatars-propres';

const hex = (octets: Uint8Array) => Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');

/** Nouveau jeton : 16 octets aléatoires en hexadécimal (32 caractères). */
export function nouveauJetonRetrait(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/** SHA-256 (hex) du jeton encodé en UTF-8 : envoyé à l'entrée, comparé par le serveur au retrait. */
export async function hacherJetonRetrait(jeton: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton))));
}

export class RetraitRefuse extends Error {
  readonly code: CodeErreurRetrait | 'reseau';
  constructor(code: CodeErreurRetrait | 'reseau') {
    super(`Retrait refusé : ${code}`);
    this.code = code;
  }
}

/** Demande le retrait de son avatar ; l'identifiant voyage dans le corps (ADR 0002). */
export async function retirerMonAvatar(requete: RequeteRetrait): Promise<void> {
  const reponse = await fetch(CHEMIN_API_RETRAIT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requete),
  }).catch(() => null);
  if (!reponse) throw new RetraitRefuse('reseau');
  if (reponse.ok) return;
  const corps = (await reponse.json().catch(() => null)) as { erreur?: CodeErreurRetrait } | null;
  throw new RetraitRefuse(corps?.erreur ?? 'reseau');
}

/**
 * Retire ses avatars depuis cet appareil. Retiré : avatar et jeton oubliés. Refusé pour
 * de bon (`retrait-refuse` : hachage effacé à la fin de la manif, ou jeton déjà effacé
 * ici) : seul le jeton est oublié, pour ne plus proposer un retrait voué à l'échec ;
 * l'avatar reste mis en valeur. Erreur passagère (réseau…) : on s'arrête, `erreur` la
 * porte et les jetons restants sont gardés pour réessayer.
 */
export async function retirerMesAvatars(
  avatars: readonly string[],
  maintenant: Date,
): Promise<{ retires: string[]; refuses: string[]; erreur?: unknown }> {
  const retires: string[] = [];
  const refuses: string[] = [];
  for (const avatar of avatars) {
    const jeton = jetonDeRetrait(avatar, maintenant);
    try {
      if (jeton === undefined) throw new RetraitRefuse('retrait-refuse');
      await retirerMonAvatar({ avatar, jeton });
    } catch (erreur) {
      if (!(erreur instanceof RetraitRefuse && erreur.code === 'retrait-refuse')) return { retires, refuses, erreur };
      oublierJetonDeRetrait(avatar);
      refuses.push(avatar);
      continue;
    }
    oublierAvatarPropre(avatar);
    retires.push(avatar);
  }
  return { retires, refuses };
}
