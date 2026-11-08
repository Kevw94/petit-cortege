import { describe, expect, it } from 'vitest';
import { lireReponseOpenMeteo, meteoDepuisEnv, sourceOpenMeteo, URL_OPEN_METEO } from '../src/open-meteo';

/** Réponse réelle d'Open-Meteo (`current=temperature_2m,weather_code,cloud_cover`), abrégée. */
const REPONSE = {
  latitude: 48.86,
  longitude: 2.36,
  current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°C', weather_code: 'wmo code', cloud_cover: '%' },
  current: { time: '2026-11-08T01:45', interval: 900, temperature_2m: 7.4, weather_code: 61, cloud_cover: 100 },
};

const avecCode = (weather_code: number, cloud_cover = 50) => ({ ...REPONSE, current: { ...REPONSE.current, weather_code, cloud_cover } });

describe('adaptateur Open-Meteo', () => {
  it('lit le relevé : heure UTC, température, pluie faible sous un ciel couvert', () => {
    expect(lireReponseOpenMeteo(REPONSE)).toEqual({
      releve: '2026-11-08T01:45:00.000Z',
      ciel: 'couvert',
      precipitation: 'pluie',
      intensite: 0,
      temperatureC: 7.4,
    });
  });

  it.each([
    [0, 5, { ciel: 'degage', precipitation: 'aucune', intensite: 0 }],
    [1, 20, { ciel: 'peu-nuageux', precipitation: 'aucune', intensite: 0 }],
    [2, 50, { ciel: 'nuageux', precipitation: 'aucune', intensite: 0 }],
    [3, 100, { ciel: 'couvert', precipitation: 'aucune', intensite: 0 }],
    [45, 100, { ciel: 'brouillard', precipitation: 'aucune', intensite: 0 }],
    [53, 100, { ciel: 'couvert', precipitation: 'bruine', intensite: 1 }],
    [65, 100, { ciel: 'couvert', precipitation: 'pluie', intensite: 2 }],
    [81, 80, { ciel: 'nuageux', precipitation: 'pluie', intensite: 1 }],
    [71, 100, { ciel: 'couvert', precipitation: 'neige', intensite: 0 }],
    [86, 100, { ciel: 'couvert', precipitation: 'neige', intensite: 2 }],
    [95, 100, { ciel: 'couvert', precipitation: 'orage', intensite: 1 }],
  ])('code WMO %i (nuages %i %%)', (code, nuages, attendu) => {
    expect(lireReponseOpenMeteo(avecCode(code, nuages))).toMatchObject(attendu);
  });

  it('refuse une réponse sans relevé', () => {
    expect(() => lireReponseOpenMeteo({ error: true, reason: 'Invalid' })).toThrow(/Open-Meteo/);
  });

  it('demande la position en latitude, longitude, heure UTC', async () => {
    const demandes: string[] = [];
    const source = sourceOpenMeteo({
      url: 'https://api.open-meteo.com/v1/forecast',
      charger: async (url) => {
        demandes.push(url);
        return Response.json(REPONSE);
      },
    });
    await expect(source([2.3637, 48.8676])).resolves.toMatchObject({ precipitation: 'pluie' });
    const url = new URL(demandes[0]!);
    expect(url.searchParams.get('latitude')).toBe('48.8676');
    expect(url.searchParams.get('longitude')).toBe('2.3637');
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.get('current')).toBe('temperature_2m,weather_code,cloud_cover');
  });

  it('une erreur HTTP est une panne de la source', async () => {
    const source = sourceOpenMeteo({ url: 'https://exemple.test/meteo', charger: async () => new Response('', { status: 503 }) });
    await expect(source([2.35, 48.85])).rejects.toThrow(/503/);
  });
});

describe('choix de la source météo par variable d’environnement', () => {
  const demandesVers = async (env: Record<string, string | undefined>) => {
    const demandes: string[] = [];
    const source = meteoDepuisEnv(env, async (url) => {
      demandes.push(url);
      return Response.json(REPONSE);
    });
    await source?.([2.35, 48.85]);
    return { source, demandes };
  };

  it('Open-Meteo par défaut', async () => {
    const { demandes } = await demandesVers({});
    expect(new URL(demandes[0]!).origin + new URL(demandes[0]!).pathname).toBe(URL_OPEN_METEO);
  });

  it('METEO=aucune : pas de météo', async () => {
    expect(meteoDepuisEnv({ METEO: 'aucune' })).toBeNull();
  });

  it('METEO=<url> : autre point d’accès compatible (instance Open-Meteo hébergée, offre commerciale)', async () => {
    const { demandes } = await demandesVers({ METEO: 'https://meteo.exemple.org/v1/forecast' });
    expect(demandes[0]).toMatch(/^https:\/\/meteo\.exemple\.org\/v1\/forecast\?/);
  });

  it('METEO=fictive:<code WMO> : météo fixe, sans réseau (démonstration en local)', async () => {
    const { source, demandes } = await demandesVers({ METEO: 'fictive:71' });
    await expect(source!([2.35, 48.85])).resolves.toMatchObject({ precipitation: 'neige', intensite: 0 });
    expect(demandes).toEqual([]);
  });

  it('refuse une valeur illisible', () => {
    expect(() => meteoDepuisEnv({ METEO: 'soleil' })).toThrow('METEO');
  });
});
