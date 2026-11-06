/**
 * Anti-triche (ADR 0001) : fabriquer de faux avatars doit coûter cher, sans compte
 * et sans jamais écrire d'IP.
 */
import { randomBytes } from 'node:crypto';
import {
  creerPreuveTravail,
  DIFFICULTE_PAR_DEFAUT,
  DUREE_DEFI_PAR_DEFAUT_MS,
  type DifficultePreuve,
  type PreuveTravail,
} from './preuve-travail';

export interface OptionsAntiTriche {
  /** Clé HMAC qui signe les défis ALTCHA (secrète, partagée entre instances). */
  cleHmac: string;
  difficulte?: DifficultePreuve;
  /** Durée de validité d'un défi, et donc de la mémoire anti-rejeu. */
  dureeDefiMs?: number;
}

export interface AntiTriche {
  preuve: PreuveTravail;
}

export function creerAntiTriche(options: OptionsAntiTriche): AntiTriche {
  return {
    preuve: creerPreuveTravail({
      cleHmac: options.cleHmac,
      difficulte: options.difficulte ?? DIFFICULTE_PAR_DEFAUT,
      dureeDefiMs: options.dureeDefiMs ?? DUREE_DEFI_PAR_DEFAUT_MS,
      maintenantMs: Date.now,
    }),
  };
}

const entier = (texte: string | undefined): number | undefined => {
  if (texte === undefined || texte.trim() === '') return undefined;
  const n = Number(texte);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Entier positif attendu, reçu « ${texte} »`);
  return n;
};

/**
 * Configuration depuis l'environnement (dev, et point d'entrée de prod #18) :
 * - `ALTCHA_CLE_HMAC` : clé de signature des défis ; absente, une clé éphémère est tirée
 *   (les défis en cours deviennent invalides au redémarrage, et plusieurs instances ne s'entendent pas).
 * - `ALTCHA_COUT`, `ALTCHA_COMPTEUR_MIN`, `ALTCHA_COMPTEUR_MAX` : difficulté.
 */
export function antiTricheDepuisEnv(env: Record<string, string | undefined>): OptionsAntiTriche {
  const cleHmac = env.ALTCHA_CLE_HMAC || randomBytes(32).toString('hex');
  if (!env.ALTCHA_CLE_HMAC) console.warn('ALTCHA_CLE_HMAC absente : clé de signature éphémère.');
  const cout = entier(env.ALTCHA_COUT) ?? DIFFICULTE_PAR_DEFAUT.cout;
  const compteurMin = entier(env.ALTCHA_COMPTEUR_MIN) ?? DIFFICULTE_PAR_DEFAUT.compteurMin;
  const compteurMax = entier(env.ALTCHA_COMPTEUR_MAX) ?? Math.max(compteurMin, DIFFICULTE_PAR_DEFAUT.compteurMax);
  return { cleHmac, difficulte: { cout, compteurMin, compteurMax } };
}
