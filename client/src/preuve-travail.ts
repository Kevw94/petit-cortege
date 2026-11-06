/**
 * Preuve de travail ALTCHA (#8) : demande un défi au serveur (requête identique pour
 * tous, sans identifiant de manif) et le résout en parallèle dans des workers.
 * Quelques secondes de calcul : l'interface affiche l'attente.
 */
import { solveChallengeWorkers, type Challenge } from 'altcha-lib';
import { CHEMIN_API_DEFI } from '@petit-cortege/shared';

/** Preuve encodée comme le widget ALTCHA (JSON en base64), `null` si impossible. */
export async function produirePreuve(): Promise<string | null> {
  const reponse = await fetch(CHEMIN_API_DEFI, { cache: 'no-store' }).catch(() => null);
  if (!reponse?.ok) return null;
  const challenge = (await reponse.json().catch(() => null)) as Challenge | null;
  if (!challenge?.parameters) return null;
  const solution = await solveChallengeWorkers({
    challenge,
    concurrency: Math.min(4, navigator.hardwareConcurrency || 2),
    createWorker: () => new Worker(new URL('./preuve-travail.worker.ts', import.meta.url), { type: 'module' }),
    timeout: 120_000,
  }).catch(() => null);
  if (!solution) return null;
  // Le défi est de l'ASCII (hexadécimal, nombres) : btoa suffit.
  return btoa(JSON.stringify({ challenge, solution }));
}
