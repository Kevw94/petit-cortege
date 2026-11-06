/**
 * Preuve de travail ALTCHA auto-hébergée (ADR 0001) : le serveur signe des défis
 * avec sa clé HMAC, le client les résout, chaque entrée joint une preuve.
 *
 * Mode déterministe d'altcha-lib v2 : le serveur tire le compteur secret et signe la
 * clé dérivée, la vérification ne coûte donc qu'un HMAC. Une preuve ne sert qu'une
 * fois : les défis consommés sont retenus en mémoire jusqu'à leur expiration.
 */
import { createChallenge, randomInt, verifySolution, type Challenge, type Solution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';

export interface DifficultePreuve {
  /** Itérations PBKDF2 par essai. */
  cout: number;
  /** Bornes du compteur secret : le client fait en moyenne ≈ compteur essais. */
  compteurMin: number;
  compteurMax: number;
}

/** Quelques secondes sur un téléphone récent (WebCrypto, plusieurs workers). */
export const DIFFICULTE_PAR_DEFAUT: DifficultePreuve = { cout: 1_000, compteurMin: 2_000, compteurMax: 6_000 };

export const DUREE_DEFI_PAR_DEFAUT_MS = 10 * 60_000;

export interface OptionsPreuveTravail {
  cleHmac: string;
  difficulte: DifficultePreuve;
  dureeDefiMs: number;
  /** Heure réelle (ms) : l'expiration ALTCHA suit l'heure système, pas l'horloge métier. */
  maintenantMs: () => number;
}

export interface PreuveTravail {
  creerDefi(): Promise<Challenge>;
  /** Vérifie et consomme la preuve encodée : `true` une seule fois par défi résolu. */
  verifierEtConsommer(preuve: string | undefined): Promise<boolean>;
}

const ALGORITHME = 'PBKDF2/SHA-256';

export function creerPreuveTravail(options: OptionsPreuveTravail): PreuveTravail {
  const { cleHmac, difficulte, dureeDefiMs, maintenantMs } = options;
  // Clé de signature des clés dérivées, distincte de celle des défis.
  const cleSignatureCle = `${cleHmac}:cle-derivee`;
  /** Signature du défi consommé → expiration (ms). Purgé au fil de l'eau. */
  const consommes = new Map<string, number>();

  const purger = (maintenant: number) => {
    for (const [signature, expiration] of consommes) {
      if (expiration <= maintenant) consommes.delete(signature);
    }
  };

  return {
    creerDefi: () =>
      createChallenge({
        algorithm: ALGORITHME,
        cost: difficulte.cout,
        counter: randomInt(difficulte.compteurMax, difficulte.compteurMin),
        deriveKey,
        expiresAt: Math.floor((maintenantMs() + dureeDefiMs) / 1000),
        hmacSignatureSecret: cleHmac,
        hmacKeySignatureSecret: cleSignatureCle,
      }),

    async verifierEtConsommer(preuve) {
      const lue = decoder(preuve);
      if (!lue) return false;
      const { challenge, solution } = lue;
      if (challenge.parameters.algorithm !== ALGORITHME || typeof challenge.signature !== 'string') return false;
      const expiration = challenge.parameters.expiresAt;
      const maintenant = maintenantMs();
      if (typeof expiration !== 'number' || expiration * 1000 <= maintenant) return false;
      if (consommes.has(challenge.signature)) return false;
      const resultat = await verifySolution({
        challenge,
        solution,
        deriveKey,
        hmacSignatureSecret: cleHmac,
        hmacKeySignatureSecret: cleSignatureCle,
      }).catch(() => null);
      if (!resultat?.verified) return false;
      // Re-vérifié après l'attente : deux envois simultanés de la même preuve.
      if (consommes.has(challenge.signature)) return false;
      purger(maintenant);
      consommes.set(challenge.signature, expiration * 1000);
      return true;
    },
  };
}

function decoder(preuve: string | undefined): { challenge: Challenge; solution: Solution } | null {
  if (!preuve) return null;
  try {
    const json = JSON.parse(Buffer.from(preuve, 'base64').toString('utf8')) as unknown;
    if (typeof json !== 'object' || json === null) return null;
    const { challenge, solution } = json as Record<string, unknown>;
    if (typeof challenge !== 'object' || challenge === null) return null;
    if (typeof solution !== 'object' || solution === null) return null;
    const parametres = (challenge as Record<string, unknown>).parameters;
    if (typeof parametres !== 'object' || parametres === null) return null;
    return { challenge: challenge as Challenge, solution: solution as Solution };
  } catch {
    return null;
  }
}
