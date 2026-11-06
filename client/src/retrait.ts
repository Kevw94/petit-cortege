/**
 * Retrait de son avatar (ADR 0001).
 *
 * Le jeton de retrait (128 bits aléatoires) est généré ici et gardé uniquement
 * dans le localStorage de l'appareil (voir avatars-propres.ts). À l'entrée, le
 * serveur n'en reçoit que le SHA-256 ; le jeton en clair ne voyage qu'au moment
 * du retrait. Il est distinct de tout jeton anti-triche.
 */
import { CHEMIN_API_RETRAIT, type CodeErreurRetrait, type RequeteRetrait } from '@petit-cortege/shared';

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
