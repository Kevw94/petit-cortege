import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntreesMinute, ListeManifs, ReponseEntree } from '@petit-cortege/shared';
import { creerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : fin = départ + ≈ 30 min + 1 h de marge.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

describe('rejoindre le cortège', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:00:00Z');
    await creerManif(banc.sql, {
      id: 'manif-paris',
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

  it("une entrée acceptée apparaît dans le fichier de sa minute, avec l'identifiant renvoyé", async () => {
    banc.horloge.regler('2026-06-01T09:10:20Z');
    const reponse = await banc.poster<ReponseEntree>('/api/entree', { manif: 'manif-paris', apparence: 5, pancarte: 3 });
    expect(reponse.statut).toBe(201);

    banc.horloge.regler('2026-06-01T09:11:00Z');
    await banc.serveur.publier();

    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-06-01T09-10.json');
    expect(minute.corps.entrees).toEqual([
      { a: reponse.corps.avatar, m: 'manif-paris', t: reponse.corps.entree, ap: 5, pa: 3 },
    ]);
  });

  it("l'heure d'entrée est la minute de réception plus un aléa, jamais l'instant exact (ADR 0001)", async () => {
    banc.horloge.regler('2026-06-01T09:20:45.500Z');
    const reponses = await Promise.all(
      Array.from({ length: 20 }, () =>
        banc.poster<ReponseEntree>('/api/entree', { manif: 'manif-paris', apparence: 0, pancarte: 0 }),
      ),
    );
    banc.horloge.regler('2026-06-01T09:21:00Z');
    await banc.serveur.publier();

    const debutMinute = Date.parse('2026-06-01T09:20:00Z') / 1000;
    const heures = reponses.map((r) => r.corps.entree);
    for (const t of heures) {
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(debutMinute);
      expect(t).toBeLessThan(debutMinute + 60);
    }
    // 20 tirages sur 60 secondes : tous identiques avec une probabilité de 60^-19.
    expect(new Set(heures).size).toBeGreaterThan(1);
    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-06-01T09-20.json');
    expect(minute.corps.entrees.map((e) => e.a).sort()).toEqual(reponses.map((r) => r.corps.avatar).sort());
  });

  it('chaque avatar reçoit un identifiant aléatoire distinct', async () => {
    banc.horloge.regler('2026-06-01T09:25:00Z');
    const a = await banc.poster<ReponseEntree>('/api/entree', { manif: 'manif-paris', apparence: 1, pancarte: 1 });
    const b = await banc.poster<ReponseEntree>('/api/entree', { manif: 'manif-paris', apparence: 1, pancarte: 1 });

    expect(a.corps.avatar).not.toBe(b.corps.avatar);
    // Au moins 96 bits d'aléa en base64url.
    expect(a.corps.avatar).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it('le compteur de soutiens de la liste des manifs grossit une fois la minute publiée', async () => {
    banc.horloge.regler('2026-06-01T09:30:00Z');
    await banc.serveur.publier();
    const avant = (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs[0]!.compteur;

    banc.horloge.regler('2026-06-01T09:30:30Z');
    await banc.poster('/api/entree', { manif: 'manif-paris', apparence: 2, pancarte: 2 });
    banc.horloge.regler('2026-06-01T09:31:00Z');
    await banc.serveur.publier();

    const apres = (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs[0]!.compteur;
    expect(apres).toBe(avant + 1);
  });

  it('entrée refusée pour une manif inconnue', async () => {
    banc.horloge.regler('2026-06-01T09:40:10Z');
    const reponse = await banc.poster('/api/entree', { manif: 'manif-fantome', apparence: 0, pancarte: 0 });
    banc.horloge.regler('2026-06-01T09:41:00Z');
    await banc.serveur.publier();

    expect(reponse).toEqual({ statut: 404, corps: { erreur: 'manif-inconnue' } });
    const minute = await banc.lire<EntreesMinute>('/publie/entrees/2026-06-01T09-40.json');
    expect(minute.corps.entrees).toEqual([]);
  });

  it('entrée refusée pour une manif pas encore ouverte, comme pour une inconnue', async () => {
    await creerManif(banc.sql, {
      id: 'manif-demain',
      intitule: 'Plus tard',
      ville: 'Lille',
      ouverture: new Date('2026-06-02T09:00:00Z'),
      depart: new Date('2026-06-02T10:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    banc.horloge.regler('2026-06-01T09:42:00Z');

    const reponse = await banc.poster('/api/entree', { manif: 'manif-demain', apparence: 0, pancarte: 0 });

    expect(reponse).toEqual({ statut: 404, corps: { erreur: 'manif-inconnue' } });
  });

  it('entrée refusée une fois la manif terminée', async () => {
    // Fin ≈ 10:00 + 30 min 1 s + 1 h = 11:30:01.
    banc.horloge.regler('2026-06-01T11:30:02Z');

    const reponse = await banc.poster('/api/entree', { manif: 'manif-paris', apparence: 0, pancarte: 0 });

    expect(reponse).toEqual({ statut: 409, corps: { erreur: 'manif-terminee' } });
  });

  it.each([
    ['corps non JSON', 'pas du json'],
    ['manif absente', { apparence: 0, pancarte: 0 }],
    ['indice négatif', { manif: 'manif-paris', apparence: -1, pancarte: 0 }],
    ['indice non entier', { manif: 'manif-paris', apparence: 1.5, pancarte: 0 }],
    ['corps trop gros', { manif: 'manif-paris', apparence: 0, pancarte: 0, bourrage: 'x'.repeat(20_000) }],
  ])('entrée refusée si la requête est invalide : %s', async (_cas, corps) => {
    banc.horloge.regler('2026-06-01T09:45:00Z');

    const reponse = await banc.poster('/api/entree', corps);

    expect(reponse).toEqual({ statut: 400, corps: { erreur: 'requete-invalide' } });
  });

  it('les champs supplémentaires sont ignorés (place pour le jeton de retrait et la preuve de travail)', async () => {
    banc.horloge.regler('2026-06-01T09:46:00Z');

    const reponse = await banc.poster('/api/entree', {
      manif: 'manif-paris',
      apparence: 0,
      pancarte: 0,
      champFutur: 'ignoré',
    });

    expect(reponse.statut).toBe(201);
  });
});
