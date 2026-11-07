import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntreesMinute, ListeManifs } from '@petit-cortege/shared';
import { creerManif, preRemplirAvatars } from '../src/index';
import { readdir } from 'node:fs/promises';
import { demarrerBanc, enregistrerFixtures, type Banc } from './support';

// Parcours plein nord le long d'un méridien : 0,009° de latitude ≈ 1000,75 m.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.854],
    [2.35, 48.859],
  ] as [number, number][],
};

describe('tâche de publication', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-05-01T12:00:00Z');
    await creerManif(banc.sql, {
      id: 'manif-a',
      intitule: 'Marche pour le climat',
      ville: 'Paris',
      ouverture: new Date('2026-05-01T13:55:00Z'),
      depart: new Date('2026-05-01T14:00:00Z'),
      parcours: PARCOURS,
      sources: [{ libelle: 'Organisateurs', url: 'https://exemple.org/appel' }],
    });
    await creerManif(banc.sql, {
      id: 'manif-b',
      intitule: 'Rassemblement',
      ville: 'Lyon',
      ouverture: new Date('2026-05-01T13:55:00Z'),
      depart: new Date('2026-05-01T15:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    await preRemplirAvatars(banc.sql, [
      { id: 'av-tot', manifId: 'manif-a', entree: new Date('2026-05-01T13:56:12Z'), apparence: 3, pancarte: 7 },
      { id: 'av-tard', manifId: 'manif-a', entree: new Date('2026-05-01T14:15:40Z'), apparence: 1, pancarte: 2 },
      { id: 'av-lyon', manifId: 'manif-b', entree: new Date('2026-05-01T14:15:05Z'), apparence: 0, pancarte: 0 },
      { id: 'av-en-cours', manifId: 'manif-a', entree: new Date('2026-05-01T14:30:05Z'), apparence: 2, pancarte: 4 },
    ]);
  });
  afterAll(async () => {
    if (!banc) return;
    // Les fichiers publiés servent d'entrée aux tests du Cortège (client).
    await enregistrerFixtures(banc.dossierPublication, 'manif-pre-remplie');
    await banc.arreter();
  });

  it('publie la manif avec son parcours, sa longueur et sa fin', async () => {
    banc.horloge.regler('2026-05-01T14:30:20Z');
    await banc.serveur.publier();

    const { statut, corps } = await banc.lire<ListeManifs>('/publie/manifs.json');

    expect(statut).toBe(200);
    expect(corps.v).toBe(1);
    const manif = corps.manifs.find((m) => m.id === 'manif-a')!;
    expect(manif).toMatchObject({
      id: 'manif-a',
      intitule: 'Marche pour le climat',
      ville: 'Paris',
      ouverture: '2026-05-01T13:55:00.000Z',
      depart: '2026-05-01T14:00:00.000Z',
      parcours: PARCOURS,
      sources: [{ libelle: 'Organisateurs', url: 'https://exemple.org/appel' }],
    });
    expect(manif.longueurM).toBeCloseTo(1000.75, 0);
    // Fin = départ + 1000,75 m ÷ 2 km/h (1801 s) + marge d'1 h.
    const dureeS = (Date.parse(manif.fin) - Date.parse(manif.depart)) / 1000;
    expect(dureeS).toBeCloseTo(3600 + 1801.35, 0);
  });

  it('publie les entrées de chaque minute écoulée, toutes manifs confondues', async () => {
    banc.horloge.regler('2026-05-01T14:30:20Z');
    await banc.serveur.publier();

    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-05-01T14-15.json');
    expect(minute.statut).toBe(200);
    expect(minute.corps).toEqual({
      v: 1,
      minute: '2026-05-01T14:15:00.000Z',
      entrees: [
        { a: 'av-lyon', m: 'manif-b', t: Date.parse('2026-05-01T14:15:05Z') / 1000, ap: 0, pa: 0 },
        { a: 'av-tard', m: 'manif-a', t: Date.parse('2026-05-01T14:15:40Z') / 1000, ap: 1, pa: 2 },
      ],
    });

    const vide = await banc.lire<EntreesMinute>('/publie/entrees/2026-05-01T13-57.json');
    expect(vide.corps).toEqual({ v: 1, minute: '2026-05-01T13:57:00.000Z', entrees: [] });
  });

  it("ne publie pas la minute en cours, et le compteur ne compte que les entrées publiées", async () => {
    banc.horloge.regler('2026-05-01T14:30:20Z');
    await banc.serveur.publier();

    expect((await banc.lire('/publie/entrees/2026-05-01T14-30.json')).statut).toBe(404);
    const { corps } = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(corps.manifs.find((m) => m.id === 'manif-a')?.compteur).toBe(2);

    banc.horloge.regler('2026-05-01T14:31:00Z');
    await banc.serveur.publier();

    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-05-01T14-30.json');
    expect(minute.corps.entrees.map((e) => e.a)).toEqual(['av-en-cours']);
    const apres = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(apres.corps.manifs.find((m) => m.id === 'manif-a')?.compteur).toBe(3);
  });

  it("aucun chemin publié ne contient d'identifiant de manif (ADR 0002)", async () => {
    banc.horloge.regler('2026-05-01T14:31:00Z');
    await banc.serveur.publier();

    const chemins = await readdir(banc.dossierPublication, { recursive: true });
    expect(chemins).toContain('manifs.json');
    for (const chemin of chemins) {
      expect(chemin).not.toMatch(/manif-a|manif-b/);
    }
  });
});
