/**
 * Worker de résolution ALTCHA (protocole de `solveChallengeWorkers` d'altcha-lib).
 * Les workers fournis par la lib importent `node:crypto` : celui-ci utilise WebCrypto.
 */
import { solveChallenge, type Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';

interface MessageTravail {
  type: 'work' | 'abort';
  challenge: Challenge;
  counterStart?: number;
  counterStep?: number;
  timeout?: number;
}

let controleur: AbortController | undefined;

self.onmessage = async (evenement: MessageEvent<MessageTravail>) => {
  const { type, challenge, counterStart, counterStep, timeout } = evenement.data;
  if (type === 'abort') {
    controleur?.abort();
    return;
  }
  controleur = new AbortController();
  try {
    const solution = await solveChallenge({
      challenge,
      controller: controleur,
      deriveKey,
      ...(counterStart !== undefined && { counterStart }),
      ...(counterStep !== undefined && { counterStep }),
      ...(timeout !== undefined && { timeout }),
    });
    self.postMessage(solution);
  } catch (erreur) {
    self.postMessage({ error: erreur instanceof Error ? erreur.message : String(erreur) });
  }
};
