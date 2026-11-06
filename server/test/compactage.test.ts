import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntreesHeure, EntreesMinute, ReponseEntree } from '@petit-cortege/shared';
import { creerManif, preRemplirAvatars } from '../src/index';
import { demarrerBanc, enregistrerFixtures, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : fin = départ + ≈ 30 min + 1 h de marge.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

describe('compactage par heure', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:00:00Z');
    await creerManif(banc.sql, {
      id: 'manif-paris',
      intitule: 'Marche',
      ville: 'Paris',
      ouverture: new Date('2026-06-01T09:40:00Z'),
      depart: new Date('2026-06-01T10:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  it("une entrée apparaît dans le fichier de sa minute, puis dans le fichier de l'heure une fois l'heure terminée", async () => {
    banc.horloge.regler('2026-06-01T09:45:10Z');
    const reponse = await banc.entrer<ReponseEntree>({ manif: 'manif-paris', apparence: 5, pancarte: 3 });
    expect(reponse.statut).toBe(201);
    const attendue = { a: reponse.corps.avatar, m: 'manif-paris', t: reponse.corps.entree, ap: 5, pa: 3 };

    // Heure en cours : seulement le fichier de la minute.
    banc.horloge.regler('2026-06-01T09:59:30Z');
    await banc.serveur.publier();
    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-06-01T09-45.json');
    expect(minute.corps.entrees).toEqual([attendue]);
    expect((await banc.lire('/publie/entrees/2026-06-01T09.json')).statut).toBe(404);

    // L'heure de 9 h est terminée : son fichier horaire est publié.
    banc.horloge.regler('2026-06-01T10:00:05Z');
    await banc.serveur.publier();
    const heure = await banc.lire<EntreesHeure>('/publie/entrees/2026-06-01T09.json');
    expect(heure.statut).toBe(200);
    expect(heure.corps).toEqual({ v: 1, heure: '2026-06-01T09:00:00.000Z', entrees: [attendue] });
  });

  it('un fichier horaire publié est immuable (cache illimité)', async () => {
    banc.horloge.regler('2026-06-01T10:00:05Z');
    await banc.serveur.publier();
    const avant = await banc.lire<EntreesHeure>('/publie/entrees/2026-06-01T09.json');

    // Même une écriture tardive en base dans cette heure ne le modifie pas.
    await preRemplirAvatars(banc.sql, [
      { id: 'av-tardif', manifId: 'manif-paris', entree: new Date('2026-06-01T09:50:00Z'), apparence: 0, pancarte: 0 },
    ]);
    banc.horloge.regler('2026-06-01T10:20:00Z');
    await banc.serveur.publier();

    expect((await banc.lire<EntreesHeure>('/publie/entrees/2026-06-01T09.json')).corps).toEqual(avant.corps);
  });
});

/**
 * Scénario déterministe sur trois heures, enregistré en fixtures pour les tests
 * du client (même foule depuis les fichiers horaires ou par minute).
 */
describe('compactage par heure : scénario sur plusieurs heures', () => {
  let banc: Banc;
  const s = (iso: string) => Date.parse(iso) / 1000;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-05-01T12:00:00Z');
    await creerManif(banc.sql, {
      id: 'manif-a',
      intitule: 'Marche pour le climat',
      ville: 'Paris',
      ouverture: new Date('2026-05-01T13:58:00Z'),
      depart: new Date('2026-05-01T14:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    await creerManif(banc.sql, {
      id: 'manif-b',
      intitule: 'Rassemblement',
      ville: 'Lyon',
      ouverture: new Date('2026-05-01T14:20:00Z'),
      depart: new Date('2026-05-01T15:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    await preRemplirAvatars(banc.sql, [
      { id: 'av-13h58', manifId: 'manif-a', entree: new Date('2026-05-01T13:58:30Z'), apparence: 1, pancarte: 1 },
      { id: 'av-13h59', manifId: 'manif-a', entree: new Date('2026-05-01T13:59:59Z'), apparence: 2, pancarte: 2 },
      { id: 'av-14h00', manifId: 'manif-a', entree: new Date('2026-05-01T14:00:00Z'), apparence: 3, pancarte: 3 },
      { id: 'av-lyon', manifId: 'manif-b', entree: new Date('2026-05-01T14:30:00Z'), apparence: 4, pancarte: 4 },
      { id: 'av-14h30', manifId: 'manif-a', entree: new Date('2026-05-01T14:30:00Z'), apparence: 5, pancarte: 5 },
      { id: 'av-14h59', manifId: 'manif-a', entree: new Date('2026-05-01T14:59:59Z'), apparence: 6, pancarte: 6 },
      { id: 'av-15h00', manifId: 'manif-a', entree: new Date('2026-05-01T15:00:01Z'), apparence: 7, pancarte: 7 },
      { id: 'av-15h02', manifId: 'manif-a', entree: new Date('2026-05-01T15:02:10Z'), apparence: 8, pancarte: 8 },
      // Minute en cours au moment de la publication : publiée nulle part.
      { id: 'av-15h03', manifId: 'manif-a', entree: new Date('2026-05-01T15:03:05Z'), apparence: 9, pancarte: 9 },
    ]);
    banc.horloge.regler('2026-05-01T15:03:20Z');
    await banc.serveur.publier();
  });
  afterAll(async () => {
    if (!banc) return;
    await enregistrerFixtures(banc.dossierPublication, 'compactage-horaire');
    await banc.arreter();
  });

  it('compacte chaque heure terminée, toutes manifs confondues, dans l\'ordre des entrées', async () => {
    const h13 = await banc.lire<EntreesHeure>('/publie/entrees/2026-05-01T13.json');
    expect(h13.corps).toEqual({
      v: 1,
      heure: '2026-05-01T13:00:00.000Z',
      entrees: [
        { a: 'av-13h58', m: 'manif-a', t: s('2026-05-01T13:58:30Z'), ap: 1, pa: 1 },
        { a: 'av-13h59', m: 'manif-a', t: s('2026-05-01T13:59:59Z'), ap: 2, pa: 2 },
      ],
    });
    const h14 = await banc.lire<EntreesHeure>('/publie/entrees/2026-05-01T14.json');
    expect(h14.corps.entrees.map((e) => e.a)).toEqual(['av-14h00', 'av-14h30', 'av-lyon', 'av-14h59']);
  });

  it("ne compacte pas l'heure en cours : ses entrées restent dans les fichiers par minute", async () => {
    expect((await banc.lire('/publie/entrees/2026-05-01T15.json')).statut).toBe(404);
    const m15h02 = await banc.lire<EntreesMinute>('/publie/entrees/2026-05-01T15-02.json');
    expect(m15h02.corps.entrees.map((e) => e.a)).toEqual(['av-15h02']);
  });

});
