/**
 * Point d'entrée de production (ADR 0005) : un serveur Node (POST d'entrée et de
 * retrait, défi ALTCHA) et la tâche de publication qui tourne en boucle dans le
 * même processus. La configuration vient de l'environnement ; l'exécutable est
 * `principal.ts` (`npm run serveur`).
 */
import { performance } from 'node:perf_hooks';
import { antiTricheDepuisEnv, type OptionsAntiTriche } from './anti-triche';
import { connecter } from './base';
import { horlogeSysteme, type Horloge } from './horloge';
import type { SourceMeteo } from './meteo';
import { meteoDepuisEnv } from './open-meteo';
import { demarrerServeur } from './serveur';

export interface ConfigPrincipale {
  urlBase: string;
  dossierPublication: string;
  /** 0 = port libre. Le serveur écoute sur 127.0.0.1 (derrière le serveur web). */
  port: number;
  /** Pause entre la fin d'un passage de publication et le début du suivant. */
  intervallePublicationMs: number;
  /** Servir le dossier de publication sous /publie/ (origine du CDN) ; sinon le serveur web s'en charge. */
  servirPublication: boolean;
  antiTriche: OptionsAntiTriche;
  /** Météo publiée des manifs ouvertes (`METEO`, voir `meteoDepuisEnv`) ; null = aucune. */
  meteo: SourceMeteo | null;
}

export const PORT_PAR_DEFAUT = 8787;
export const INTERVALLE_PUBLICATION_PAR_DEFAUT_MS = 5_000;

const obligatoire = (env: Record<string, string | undefined>, nom: string): string => {
  const valeur = env[nom];
  if (!valeur) throw new Error(`Variable d'environnement ${nom} obligatoire`);
  return valeur;
};

const entierPositifOuNul = (env: Record<string, string | undefined>, nom: string, defaut: number): number => {
  const texte = env[nom];
  if (texte === undefined || texte.trim() === '') return defaut;
  const n = Number(texte);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${nom} : entier positif attendu, reçu « ${texte} »`);
  return n;
};

/**
 * Variables : `DATABASE_URL`, `DOSSIER_PUBLICATION`, `ALTCHA_CLE_HMAC`, `PROXYS_DE_CONFIANCE`
 * (obligatoires ; pour ce dernier, typiquement `127.0.0.1,::1` + les plages du CDN si les
 * POST passent par lui, ou `aucun`),
 * `PORT` (8787), `INTERVALLE_PUBLICATION_MS` (5000), `SERVIR_PUBLICATION` (`1` pour servir
 * /publie/), `METEO` (source météo, voir `meteoDepuisEnv`) et celles de l'anti-triche
 * (voir `antiTricheDepuisEnv`).
 */
export function configDepuisEnv(env: Record<string, string | undefined>): ConfigPrincipale {
  const urlBase = obligatoire(env, 'DATABASE_URL');
  const dossierPublication = obligatoire(env, 'DOSSIER_PUBLICATION');
  // En production la clé est partagée et stable : pas de clé éphémère.
  obligatoire(env, 'ALTCHA_CLE_HMAC');
  // Le serveur écoute sur 127.0.0.1 derrière le serveur web : sans proxys de confiance,
  // toutes les requêtes viennent de 127.0.0.1 et tous les soutiens partagent la même
  // limite par IP. Choix explicite obligatoire (« aucun » pour ignorer l'en-tête).
  if (obligatoire(env, 'PROXYS_DE_CONFIANCE').trim() === 'aucun') {
    console.warn(
      "PROXYS_DE_CONFIANCE=aucun : l'en-tête d'IP est ignoré, la limite par IP porte sur l'adresse de connexion " +
        '(derrière un serveur web local, tous les soutiens la partagent).',
    );
  }
  return {
    urlBase,
    dossierPublication,
    port: entierPositifOuNul(env, 'PORT', PORT_PAR_DEFAUT),
    intervallePublicationMs: entierPositifOuNul(env, 'INTERVALLE_PUBLICATION_MS', INTERVALLE_PUBLICATION_PAR_DEFAUT_MS),
    servirPublication: env.SERVIR_PUBLICATION === '1',
    antiTriche: antiTricheDepuisEnv(env),
    meteo: meteoDepuisEnv(env),
  };
}

/** Un passage de la tâche de publication (heures en ms, `performance.timeOrigin` + `performance.now()`). */
export interface PassagePublication {
  debut: number;
  dureeMs: number;
  ok: boolean;
}

export interface OptionsLancement {
  /** Horloge métier (défaut : heure système). */
  horloge?: Horloge;
  /** Appelé après chaque passage de publication (supervision, test de charge). */
  surPublication?: (passage: PassagePublication) => void;
}

export interface ServeurLance {
  url: string;
  arreter(): Promise<void>;
}

export async function lancer(config: ConfigPrincipale, options: OptionsLancement = {}): Promise<ServeurLance> {
  const horloge = options.horloge ?? horlogeSysteme;
  const sql = connecter(config.urlBase);
  const serveur = await demarrerServeur({
    sql,
    horloge,
    dossierPublication: config.dossierPublication,
    port: config.port,
    servirPublication: config.servirPublication,
    antiTriche: config.antiTriche,
    ...(config.meteo ? { meteo: config.meteo } : {}),
  });

  // Passages successifs, jamais simultanés : le suivant part `intervalle` après la fin du précédent.
  let arrete = false;
  let minuterie: NodeJS.Timeout | undefined;
  let passageEnCours: Promise<void> = Promise.resolve();
  const passer = async () => {
    const debut = performance.timeOrigin + performance.now();
    let ok = true;
    try {
      await serveur.publier();
    } catch (e) {
      ok = false;
      console.error('Publication en échec :', e instanceof Error ? e.message : e);
    }
    const dureeMs = performance.timeOrigin + performance.now() - debut;
    if (dureeMs > config.intervallePublicationMs && config.intervallePublicationMs >= 1_000) {
      console.warn(`Publication lente : ${Math.round(dureeMs)} ms`);
    }
    options.surPublication?.({ debut, dureeMs, ok });
  };
  const planifier = () => {
    if (arrete) return;
    minuterie = setTimeout(() => {
      passageEnCours = passer().then(planifier);
    }, config.intervallePublicationMs);
  };
  passageEnCours = passer().then(planifier);

  return {
    url: serveur.url,
    async arreter() {
      arrete = true;
      clearTimeout(minuterie);
      await passageEnCours;
      await serveur.fermer();
      await sql.end();
    },
  };
}
