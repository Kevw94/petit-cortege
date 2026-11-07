import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntreesHeure, EntreesMinute, ReponseEntree } from '@petit-cortege/shared';
import { creerManif, retirerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

describe('manif retirée par la modération', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:00:00Z');
    for (const id of ['manif-gardee', 'manif-retiree']) {
      await creerManif(banc.sql, {
        id,
        intitule: id,
        ville: 'Paris',
        ouverture: new Date('2026-06-01T09:00:00Z'),
        depart: new Date('2026-06-01T10:00:00Z'),
        parcours: PARCOURS,
        sources: [],
      });
    }
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it("les entrées d'une manif retirée avant la publication de leur minute ne sont pas publiées", async () => {
    banc.horloge.regler('2026-06-01T09:10:00Z');
    const gardee = await banc.entrer<ReponseEntree>({ manif: 'manif-gardee', apparence: 0, pancarte: 0 });
    const retiree = await banc.entrer<ReponseEntree>({ manif: 'manif-retiree', apparence: 0, pancarte: 0 });
    expect(retiree.statut).toBe(201);

    // Retrait de la manif dans la minute de l'entrée, avant que la tâche ne la publie.
    await retirerManif(banc.sql, banc.horloge, 'manif-retiree', 'Arrêté préfectoral');
    banc.horloge.regler('2026-06-01T10:00:30Z');
    await banc.serveur.publier();

    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-06-01T09-10.json');
    expect(minute.corps.entrees.map((e) => e.a)).toEqual([gardee.corps.avatar]);
    const heure = await banc.lire<EntreesHeure>('/publie/entrees/2026-06-01T09.json');
    expect(heure.corps.entrees.map((e) => e.a)).toEqual([gardee.corps.avatar]);
  });
});
