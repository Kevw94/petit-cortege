import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListeManifs, MeteoPubliee, Position } from '@petit-cortege/shared';
import { creerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : départ 10:00, fin ≈ 11:30:01.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as Position[],
};

const BEAU: MeteoPubliee = {
  releve: '2026-06-01T09:00:00.000Z',
  ciel: 'degage',
  precipitation: 'aucune',
  intensite: 0,
  temperatureC: 21,
};
const PLUIE: MeteoPubliee = { ...BEAU, releve: '2026-06-01T09:15:00.000Z', ciel: 'couvert', precipitation: 'pluie', intensite: 1, temperatureC: 14 };

/** Source météo factice : réponses programmées, appels enregistrés. */
function sourceFactice() {
  const appels: Position[] = [];
  let reponse: () => Promise<MeteoPubliee> = async () => BEAU;
  return {
    appels,
    repondre(r: () => Promise<MeteoPubliee>) {
      reponse = r;
    },
    source: (position: Position) => {
      appels.push(position);
      return reponse();
    },
  };
}

describe('météo des manifs ouvertes, publiée dans la liste des manifs', () => {
  let banc: Banc;
  const meteo = sourceFactice();
  const meteoDe = async (id: string) =>
    (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs.find((m) => m.id === id)?.meteo;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T08:00:00Z', {}, { meteo: meteo.source });
    await creerManif(banc.sql, {
      id: 'manif-ouverte',
      intitule: 'Marche',
      ville: 'Paris',
      ouverture: new Date('2026-06-01T09:00:00Z'),
      depart: new Date('2026-06-01T10:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
  });
  afterAll(async () => {
    await banc?.arreter();
  });
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publie le temps qu’il fait au départ du parcours', async () => {
    banc.horloge.regler('2026-06-01T09:00:30Z');
    await banc.serveur.publier();

    expect(await meteoDe('manif-ouverte')).toEqual(BEAU);
    expect(meteo.appels).toEqual([[2.35, 48.85]]);
  });

  it('ne redemande la météo qu’au bout de 15 minutes', async () => {
    meteo.repondre(async () => PLUIE);
    banc.horloge.regler('2026-06-01T09:10:00Z');
    await banc.serveur.publier();
    expect(await meteoDe('manif-ouverte')).toEqual(BEAU);
    expect(meteo.appels).toHaveLength(1);

    banc.horloge.regler('2026-06-01T09:16:00Z');
    await banc.serveur.publier();
    expect(await meteoDe('manif-ouverte')).toEqual(PLUIE);
    expect(meteo.appels).toHaveLength(2);
  });

  it('source en panne : la dernière météo connue reste publiée, la publication continue', async () => {
    meteo.repondre(async () => {
      throw new Error('Source météo injoignable');
    });
    banc.horloge.regler('2026-06-01T09:40:00Z');
    await expect(banc.serveur.publier()).resolves.toBeUndefined();
    expect(await meteoDe('manif-ouverte')).toEqual(PLUIE);
  });

  it('manif terminée : plus de météo demandée ni publiée', async () => {
    meteo.repondre(async () => BEAU);
    const appelsAvant = meteo.appels.length;
    banc.horloge.regler('2026-06-01T12:00:00Z');
    await banc.serveur.publier();
    expect(await meteoDe('manif-ouverte')).toBeUndefined();
    expect(meteo.appels).toHaveLength(appelsAvant);
  });
});

describe('sans source météo', () => {
  let banc: Banc;
  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:30:00Z');
    await creerManif(banc.sql, {
      id: 'manif-sans-meteo',
      intitule: 'Marche',
      ville: 'Paris',
      ouverture: new Date('2026-06-01T09:00:00Z'),
      depart: new Date('2026-06-01T10:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it('la manif est publiée sans champ météo', async () => {
    await banc.serveur.publier();
    const { corps } = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(corps.manifs[0]).not.toHaveProperty('meteo');
  });
});
