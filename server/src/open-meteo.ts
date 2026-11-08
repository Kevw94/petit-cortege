/**
 * Source météo Open-Meteo (https://open-meteo.com, données CC BY 4.0, sans clé) : relevé
 * actuel à une position, traduit des codes WMO vers la météo publiée (ADR 0008).
 */
import type { Ciel, MeteoPubliee, Precipitation, Position } from '@petit-cortege/shared';
import type { SourceMeteo } from './meteo';

export const URL_OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
/** Une source lente ne retient pas la publication plus longtemps. */
const DELAI_MAX_MS = 5_000;

interface ReponseOpenMeteo {
  current?: { time?: unknown; temperature_2m?: unknown; weather_code?: unknown; cloud_cover?: unknown };
}

type Intensite = MeteoPubliee['intensite'];

/** Codes WMO de précipitation : nature et force. */
const PRECIPITATIONS: Record<number, [Precipitation, Intensite]> = {
  51: ['bruine', 0], 53: ['bruine', 1], 55: ['bruine', 2], 56: ['bruine', 0], 57: ['bruine', 2],
  61: ['pluie', 0], 63: ['pluie', 1], 65: ['pluie', 2], 66: ['pluie', 0], 67: ['pluie', 2],
  71: ['neige', 0], 73: ['neige', 1], 75: ['neige', 2], 77: ['neige', 0],
  80: ['pluie', 0], 81: ['pluie', 1], 82: ['pluie', 2],
  85: ['neige', 0], 86: ['neige', 2],
  95: ['orage', 1], 96: ['orage', 2], 99: ['orage', 2],
};
const CIELS_SANS_PRECIPITATION: Record<number, Ciel> = { 0: 'degage', 1: 'peu-nuageux', 2: 'nuageux', 3: 'couvert', 45: 'brouillard', 48: 'brouillard' };

/** Ciel d'après la couverture nuageuse (%), quand le code WMO ne le dit pas. */
function cielSelonNuages(pourcent: number): Ciel {
  if (pourcent <= 10) return 'degage';
  if (pourcent <= 40) return 'peu-nuageux';
  if (pourcent <= 85) return 'nuageux';
  return 'couvert';
}

const nombre = (v: unknown, quoi: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Open-Meteo : ${quoi} illisible`);
  return v;
};

/** Traduit une réponse Open-Meteo (`current`, heures en GMT) ; lève si elle est illisible. */
export function lireReponseOpenMeteo(json: unknown): MeteoPubliee {
  const actuel = (json as ReponseOpenMeteo | null)?.current;
  if (!actuel || typeof actuel.time !== 'string') throw new Error('Open-Meteo : réponse sans relevé actuel');
  const releve = new Date(`${actuel.time}Z`);
  if (Number.isNaN(releve.getTime())) throw new Error('Open-Meteo : heure du relevé illisible');
  const code = nombre(actuel.weather_code, 'code météo');
  const temperatureC = nombre(actuel.temperature_2m, 'température');
  const nuages = typeof actuel.cloud_cover === 'number' ? actuel.cloud_cover : 100;
  const [precipitation, intensite] = PRECIPITATIONS[code] ?? ['aucune', 0];
  const ciel = CIELS_SANS_PRECIPITATION[code] ?? cielSelonNuages(nuages);
  return { releve: releve.toISOString(), ciel, precipitation, intensite, temperatureC };
}

export interface OptionsOpenMeteo {
  url: string;
  charger?: (url: string) => Promise<Response>;
}

export function sourceOpenMeteo({ url, charger = (u) => fetch(u, { signal: AbortSignal.timeout(DELAI_MAX_MS) }) }: OptionsOpenMeteo): SourceMeteo {
  return async ([lon, lat]: Position) => {
    const demande = new URL(url);
    demande.searchParams.set('latitude', String(lat));
    demande.searchParams.set('longitude', String(lon));
    demande.searchParams.set('current', 'temperature_2m,weather_code,cloud_cover');
    demande.searchParams.set('timezone', 'GMT');
    const reponse = await charger(demande.toString());
    if (!reponse.ok) throw new Error(`Open-Meteo : HTTP ${reponse.status}`);
    return lireReponseOpenMeteo(await reponse.json());
  };
}

/**
 * Source météo selon `METEO` : absente = Open-Meteo public ; `aucune` = pas de météo ;
 * une URL = autre point d'accès au format Open-Meteo (instance hébergée, offre commerciale) ;
 * `fictive:<code WMO>` = météo fixe sans réseau, pour une démonstration en local.
 */
export function meteoDepuisEnv(
  env: Record<string, string | undefined>,
  charger?: (url: string) => Promise<Response>,
): SourceMeteo | null {
  const valeur = env.METEO?.trim() || URL_OPEN_METEO;
  if (valeur === 'aucune') return null;
  const fictive = /^fictive:(\d+)$/.exec(valeur);
  if (fictive) {
    const code = Number(fictive[1]);
    return async () =>
      lireReponseOpenMeteo({
        current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 12, weather_code: code, cloud_cover: code === 0 ? 0 : 100 },
      });
  }
  if (!/^https?:\/\//.test(valeur)) {
    throw new Error(`METEO : « aucune », une URL ou « fictive:<code WMO> » attendu, reçu « ${valeur} »`);
  }
  return sourceOpenMeteo({ url: valeur, ...(charger ? { charger } : {}) });
}
