import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListeManifs, ReponseEntree, Retraits } from '@petit-cortege/shared';
import { creerManif, retirerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : fin = départ + ≈ 30 min 1 s + 1 h de marge.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

const nouveauJeton = () => randomBytes(16).toString('hex');
const sha256 = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');

describe('fin de la manif : effacement des hachages de jetons de retrait', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-06-01T09:00:00Z');
    // manif-tot : départ 10:00, fin ≈ 11:30:01. manif-tard : départ 12:00, fin ≈ 13:30:01.
    for (const [id, depart] of [
      ['manif-tot', '2026-06-01T10:00:00Z'],
      ['manif-tard', '2026-06-01T12:00:00Z'],
      ['manif-retiree', '2026-06-01T10:00:00Z'],
    ] as const) {
      await creerManif(banc.sql, {
        id,
        intitule: id,
        ville: 'Paris',
        ouverture: new Date('2026-06-01T09:00:00Z'),
        depart: new Date(depart),
        parcours: PARCOURS,
        sources: [],
      });
    }
  });
  afterAll(async () => {
    await banc?.arreter();
  });

  // Entré avant toute publication (les tests suivants font avancer la tâche de publication).
  let avatarManifRetiree: { avatar: string; jeton: string };
  beforeAll(async () => {
    banc.horloge.regler('2026-06-01T09:05:00Z');
    avatarManifRetiree = await entrer('manif-retiree');
  });

  async function entrer(manif: string): Promise<{ avatar: string; jeton: string }> {
    const jeton = nouveauJeton();
    const reponse = await banc.entrer<ReponseEntree>({ manif, apparence: 0, pancarte: 0, hachageRetrait: sha256(jeton) });
    expect(reponse.statut).toBe(201);
    return { avatar: reponse.corps.avatar, jeton };
  }
  const hachagesRestants = async (manif: string) =>
    (await banc.sql<{ n: number }[]>`
      select count(*)::int as n from avatar where manif_id = ${manif} and hachage_retrait is not null`)[0]!.n;

  it("le retrait reste possible jusqu'à la fin ; dans l'heure qui suit, les hachages sont effacés et le retrait devient impossible", async () => {
    banc.horloge.regler('2026-06-01T09:10:00Z');
    const avantFin = await entrer('manif-tot');
    const apresFin = await entrer('manif-tot');

    // Une minute avant la fin, la tâche de publication tourne : rien n'est effacé.
    banc.horloge.regler('2026-06-01T11:29:00Z');
    await banc.serveur.publier();
    expect((await banc.poster('/api/retrait', avantFin)).statut).toBe(200);

    // La tâche tourne après la fin (toutes les minutes) : moins d'une heure plus tard, plus rien.
    banc.horloge.regler('2026-06-01T11:31:00Z');
    await banc.serveur.publier();

    expect(await banc.poster('/api/retrait', apresFin)).toEqual({ statut: 403, corps: { erreur: 'retrait-refuse' } });
    expect(await hachagesRestants('manif-tot')).toBe(0);
    // Le retrait fait avant la fin reste publié, l'avatar anonyme reste dans le cortège.
    expect((await banc.lire<Retraits>('/publie/retraits.json')).corps.retraits).toContain(avantFin.avatar);
  });

  it("les hachages d'une manif encore ouverte ne sont pas touchés", async () => {
    banc.horloge.regler('2026-06-01T11:40:00Z');
    const ouvert = await entrer('manif-tard');

    banc.horloge.regler('2026-06-01T11:45:00Z');
    await banc.serveur.publier();

    expect((await banc.poster('/api/retrait', ouvert)).statut).toBe(200);
  });

  it('une manif retirée par modération perd aussi ses hachages après sa fin', async () => {
    const avatar = avatarManifRetiree;
    await retirerManif(banc.sql, banc.horloge, 'manif-retiree', 'Arrêté préfectoral');

    banc.horloge.regler('2026-06-01T11:31:00Z');
    await banc.serveur.publier();

    expect(await hachagesRestants('manif-retiree')).toBe(0);
    expect((await banc.poster('/api/retrait', avatar)).statut).toBe(403);
  });
});

describe("fin de la manif : consultation de l'image finale", () => {
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

  const ids = async () => (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs.map((m) => m.id);
  const retraits = async () => (await banc.lire<Retraits>('/publie/retraits.json')).corps.retraits;

  it('une manif terminée reste dans la liste publiée 30 jours après sa fin, puis en sort avec ses retraits', async () => {
    banc.horloge.regler('2026-06-01T09:10:00Z');
    const jeton = nouveauJeton();
    const entree = await banc.entrer<ReponseEntree>({
      manif: 'manif-paris',
      apparence: 0,
      pancarte: 0,
      hachageRetrait: sha256(jeton),
    });
    await banc.poster('/api/retrait', { avatar: entree.corps.avatar, jeton });

    // Fin ≈ 2026-06-01T11:30:01 : encore listée 29 jours plus tard.
    banc.horloge.regler('2026-06-30T11:00:00Z');
    await banc.serveur.publier();
    expect(await ids()).toEqual(['manif-paris']);
    expect(await retraits()).toEqual([entree.corps.avatar]);

    banc.horloge.regler('2026-07-01T11:31:00Z');
    await banc.serveur.publier();
    expect(await ids()).toEqual([]);
    expect(await retraits()).toEqual([]);
  });
});
