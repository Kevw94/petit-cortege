/**
 * Anti-triche (ADR 0001) : fabriquer de faux avatars doit coûter cher, sans compte
 * et sans jamais écrire d'IP.
 */
import { randomBytes } from 'node:crypto';
import { alerteJournal, alerteWebhook, type Alerte } from './alerte';
import { creerLecteurIp, type LireIpClient } from './ip-client';
import { creerLimiteur, type Limite, type Limiteur } from './limite-debit';
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
  /**
   * Requêtes d'entrée par IP et par fenêtre. Généreux : une IP peut être partagée
   * (box familiale, réseau d'entreprise, CGNAT mobile). La route de défi a droit au double.
   */
  limiteParIp?: Limite;
  /**
   * En-tête où le CDN transmet la vraie IP (ex. `CDN-RequestClientIP` chez Bunny).
   * Défaut : `X-Forwarded-For`. Lu seulement si la connexion vient d'un proxy de confiance.
   */
  enteteIp?: string;
  /** Adresses ou CIDR du CDN. Vide (défaut) : l'en-tête est ignoré, on prend l'adresse de connexion. */
  proxysDeConfiance?: readonly string[];
  /** Plafond global d'entrées acceptées par fenêtre, au-delà duquel le porteur est alerté. */
  plafondGlobal?: { entrees: number; fenetreMs: number };
  /** Défaut : une ligne de journal (sans IP). */
  alerte?: Alerte;
}

export const LIMITE_PAR_IP_PAR_DEFAUT: Limite = { requetes: 60, fenetreMs: 60_000 };
export const PLAFOND_GLOBAL_PAR_DEFAUT = { entrees: 1_000, fenetreMs: 60_000 };

export interface AntiTriche {
  preuve: PreuveTravail;
  lireIp: LireIpClient;
  /** Limites par IP des routes d'entrée et de défi (clé = IP, en mémoire seulement). */
  limiteEntree: Limiteur;
  limiteDefi: Limiteur;
  /** À appeler pour chaque entrée acceptée : alerte une fois par fenêtre au-delà du plafond. */
  compterEntreeAcceptee(): void;
}

export function creerAntiTriche(options: OptionsAntiTriche): AntiTriche {
  const limite = options.limiteParIp ?? LIMITE_PAR_IP_PAR_DEFAUT;
  const plafond = options.plafondGlobal ?? PLAFOND_GLOBAL_PAR_DEFAUT;
  const alerte = options.alerte ?? alerteJournal;
  // Même compteur à fenêtre fixe, une seule clé ; seul le premier dépassement de la fenêtre alerte.
  const global = creerLimiteur({ requetes: plafond.entrees, fenetreMs: plafond.fenetreMs }, Date.now);
  let fenetreAlertee = false;
  return {
    compterEntreeAcceptee() {
      if (global.compter('tout') === null) {
        fenetreAlertee = false;
        return;
      }
      if (fenetreAlertee) return;
      fenetreAlertee = true;
      void Promise.resolve()
        .then(() => alerte.plafondGlobalDepasse({ plafond: plafond.entrees, fenetreMs: plafond.fenetreMs }))
        .catch((e: unknown) => console.error('Alerte en échec :', e instanceof Error ? e.message : e));
    },
    lireIp: creerLecteurIp({
      enteteIp: options.enteteIp ?? 'X-Forwarded-For',
      proxysDeConfiance: options.proxysDeConfiance ?? [],
    }),
    limiteEntree: creerLimiteur(limite, Date.now),
    limiteDefi: creerLimiteur({ ...limite, requetes: 2 * limite.requetes }, Date.now),
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
 * - `LIMITE_ENTREES_PAR_IP` : entrées par IP et par minute (défaut 60).
 * - `PLAFOND_ENTREES_GLOBAL` : entrées acceptées par minute avant alerte (défaut 1000).
 * - `ENTETE_IP_CLIENT` : en-tête de la vraie IP (ex. `CDN-RequestClientIP` ; défaut `X-Forwarded-For`).
 * - `PROXYS_DE_CONFIANCE` : adresses ou CIDR du CDN, séparés par des virgules (défaut : aucun).
 * - `ALERTE_WEBHOOK_URL` : webhook appelé en plus du journal quand le plafond est dépassé.
 */
export function antiTricheDepuisEnv(env: Record<string, string | undefined>): OptionsAntiTriche {
  const cleHmac = env.ALTCHA_CLE_HMAC || randomBytes(32).toString('hex');
  if (!env.ALTCHA_CLE_HMAC) console.warn('ALTCHA_CLE_HMAC absente : clé de signature éphémère.');
  const cout = entier(env.ALTCHA_COUT) ?? DIFFICULTE_PAR_DEFAUT.cout;
  const compteurMin = entier(env.ALTCHA_COMPTEUR_MIN) ?? DIFFICULTE_PAR_DEFAUT.compteurMin;
  const compteurMax = entier(env.ALTCHA_COMPTEUR_MAX) ?? Math.max(compteurMin, DIFFICULTE_PAR_DEFAUT.compteurMax);
  const parIp = entier(env.LIMITE_ENTREES_PAR_IP);
  const global = entier(env.PLAFOND_ENTREES_GLOBAL);
  const proxys = (env.PROXYS_DE_CONFIANCE ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return {
    cleHmac,
    difficulte: { cout, compteurMin, compteurMax },
    ...(parIp ? { limiteParIp: { ...LIMITE_PAR_IP_PAR_DEFAUT, requetes: parIp } } : {}),
    ...(global ? { plafondGlobal: { ...PLAFOND_GLOBAL_PAR_DEFAUT, entrees: global } } : {}),
    ...(env.ENTETE_IP_CLIENT ? { enteteIp: env.ENTETE_IP_CLIENT } : {}),
    proxysDeConfiance: proxys,
    ...(env.ALERTE_WEBHOOK_URL ? { alerte: alerteWebhook(env.ALERTE_WEBHOOK_URL) } : {}),
  };
}
