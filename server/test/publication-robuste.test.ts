import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreesHeure, ListeManifs, ReponseEntree, Retraits } from '@petit-cortege/shared';
import { creerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : départ 10:00, fin ≈ 11:30:01.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

const sha256 = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');

describe("publication : un incident sur un fichier n'arrête pas le reste du passage", () => {
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
  // Les incidents sont journalisés (sans IP) : on les tait pendant le test.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function entrer(): Promise<{ avatar: string; jeton: string }> {
    const jeton = randomBytes(16).toString('hex');
    const reponse = await banc.entrer<ReponseEntree>({
      manif: 'manif-paris',
      apparence: 0,
      pancarte: 0,
      hachageRetrait: sha256(jeton),
    });
    expect(reponse.statut).toBe(201);
    return { avatar: reponse.corps.avatar, jeton };
  }

  it("un fichier par minute illisible : l'heure est compactée depuis la base, la liste, les retraits et l'effacement des hachages ont lieu", async () => {
    banc.horloge.regler('2026-06-01T09:10:00Z');
    const avatar = await entrer();
    banc.horloge.regler('2026-06-01T09:30:00Z');
    await banc.serveur.publier();
    // Le fichier de la minute est abîmé sur le disque après sa publication.
    await writeFile(join(banc.dossierPublication, 'entrees/2026-06-01T09-10.json'), '{"v":1,');

    banc.horloge.regler('2026-06-01T11:31:00Z');
    await banc.serveur.publier();

    const heure = await banc.lire<EntreesHeure>('/publie/entrees/2026-06-01T09.json');
    expect(heure.corps.entrees.map((e) => e.a)).toEqual([avatar.avatar]);
    const liste = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(liste.corps.generee).toBe('2026-06-01T11:31:00.000Z');
    // Hachages effacés après la fin (ADR 0001) : le retrait est refusé.
    expect((await banc.poster('/api/retrait', avatar)).statut).toBe(403);
  });

  it("une écriture de la liste en échec : le passage échoue, mais les retraits sont publiés et les hachages effacés quand même", async () => {
    await creerManif(banc.sql, {
      id: 'manif-soir',
      intitule: 'Soir',
      ville: 'Paris',
      ouverture: new Date('2026-06-01T11:00:00Z'),
      depart: new Date('2026-06-01T12:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    banc.horloge.regler('2026-06-01T11:41:00Z');
    const jeton = randomBytes(16).toString('hex');
    const reponse = await banc.entrer<ReponseEntree>({
      manif: 'manif-soir',
      apparence: 0,
      pancarte: 0,
      hachageRetrait: sha256(jeton),
    });
    const autre = { avatar: reponse.corps.avatar, jeton };

    // La liste ne peut plus être écrite (un dossier occupe sa place).
    const cheminListe = join(banc.dossierPublication, 'manifs.json');
    await rm(cheminListe);
    await mkdir(cheminListe);

    banc.horloge.regler('2026-06-01T13:31:00Z');
    await expect(banc.serveur.publier()).rejects.toThrow();

    expect((await banc.lire<Retraits>('/publie/retraits.json')).corps.generee).toBe('2026-06-01T13:31:00.000Z');
    expect((await banc.poster('/api/retrait', autre)).statut).toBe(403);
    await rm(cheminListe, { recursive: true });
  });
});
