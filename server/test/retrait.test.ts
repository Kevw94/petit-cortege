import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListeManifs, ReponseEntree, Retraits } from '@petit-cortege/shared';
import { creerManif, preRemplirAvatars, retirerAvatar } from '../src/index';
import { demarrerBanc, enregistrerFixtures, type Banc } from './support';

// Parcours plein nord ≈ 1000,75 m : fin = départ + ≈ 30 min + 1 h de marge.
const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.35, 48.85],
    [2.35, 48.859],
  ] as [number, number][],
};

/** Jeton de retrait comme le client le génère : 128 bits aléatoires en hexadécimal. */
const nouveauJeton = () => randomBytes(16).toString('hex');
/** Contrat : le client envoie à l'entrée le SHA-256 (hex) du jeton, jamais le jeton. */
const sha256 = (jeton: string) => createHash('sha256').update(jeton, 'utf8').digest('hex');

describe('retrait de son avatar', () => {
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

  async function entrerAvecJeton(jeton: string): Promise<string> {
    const reponse = await banc.entrer<ReponseEntree>({
      manif: 'manif-paris',
      apparence: 1,
      pancarte: 1,
      hachageRetrait: sha256(jeton),
    });
    expect(reponse.statut).toBe(201);
    return reponse.corps.avatar;
  }

  async function retraitsPublies(): Promise<string[]> {
    await banc.serveur.publier();
    const { statut, corps } = await banc.lire<Retraits>('/publie/retraits.json');
    expect(statut).toBe(200);
    expect(corps.v).toBe(1);
    return corps.retraits;
  }

  it("retrait avec le bon jeton : l'avatar apparaît dans le fichier des retraits", async () => {
    banc.horloge.regler('2026-06-01T09:10:20Z');
    const jeton = nouveauJeton();
    const avatar = await entrerAvecJeton(jeton);

    const reponse = await banc.poster('/api/retrait', { avatar, jeton });

    expect(reponse.statut).toBe(200);
    banc.horloge.regler('2026-06-01T09:12:00Z');
    expect(await retraitsPublies()).toContain(avatar);
  });

  it("mauvais jeton : retrait refusé, l'avatar reste dans le cortège", async () => {
    banc.horloge.regler('2026-06-01T09:13:20Z');
    const avatar = await entrerAvecJeton(nouveauJeton());

    const reponse = await banc.poster('/api/retrait', { avatar, jeton: nouveauJeton() });

    expect(reponse).toEqual({ statut: 403, corps: { erreur: 'retrait-refuse' } });
    banc.horloge.regler('2026-06-01T09:14:00Z');
    expect(await retraitsPublies()).not.toContain(avatar);
  });

  it("avatar inconnu ou entré sans jeton : même refus, qui ne dit rien de l'existence de l'avatar", async () => {
    banc.horloge.regler('2026-06-01T09:15:20Z');
    const sansJeton = await banc.entrer<ReponseEntree>({ manif: 'manif-paris', apparence: 0, pancarte: 0 });

    const inconnu = await banc.poster('/api/retrait', { avatar: 'avatar-fantome', jeton: nouveauJeton() });
    const nonRetirable = await banc.poster('/api/retrait', { avatar: sansJeton.corps.avatar, jeton: nouveauJeton() });

    expect(inconnu).toEqual({ statut: 403, corps: { erreur: 'retrait-refuse' } });
    expect(nonRetirable).toEqual(inconnu);
  });

  it('rejouer un retrait déjà fait est accepté, et l’avatar n’est publié qu’une fois', async () => {
    banc.horloge.regler('2026-06-01T09:16:20Z');
    const jeton = nouveauJeton();
    const avatar = await entrerAvecJeton(jeton);

    await banc.poster('/api/retrait', { avatar, jeton });
    const rejoue = await banc.poster('/api/retrait', { avatar, jeton });

    expect(rejoue.statut).toBe(200);
    banc.horloge.regler('2026-06-01T09:17:00Z');
    expect((await retraitsPublies()).filter((id) => id === avatar)).toHaveLength(1);
  });

  it.each([
    ['corps non JSON', 'pas du json'],
    ['avatar absent', { jeton: 'a'.repeat(32) }],
    ['jeton trop court', { avatar: 'x', jeton: 'a'.repeat(31) }],
    ['jeton non hexadécimal', { avatar: 'x', jeton: 'z'.repeat(32) }],
  ])('retrait refusé si la requête est invalide : %s', async (_cas, corps) => {
    const reponse = await banc.poster('/api/retrait', corps);

    expect(reponse).toEqual({ statut: 400, corps: { erreur: 'requete-invalide' } });
  });

  it("entrée refusée si le hachage du jeton de retrait n'est pas un SHA-256 hexadécimal", async () => {
    banc.horloge.regler('2026-06-01T09:18:00Z');

    const reponse = await banc.poster('/api/entree', {
      manif: 'manif-paris',
      apparence: 0,
      pancarte: 0,
      hachageRetrait: 'pas-un-hachage',
    });

    expect(reponse).toEqual({ statut: 400, corps: { erreur: 'requete-invalide' } });
  });

  it('le compteur de soutiens ne compte plus un avatar retiré', async () => {
    banc.horloge.regler('2026-06-01T09:20:20Z');
    const jeton = nouveauJeton();
    const avatar = await entrerAvecJeton(jeton);
    banc.horloge.regler('2026-06-01T09:21:00Z');
    await banc.serveur.publier();
    const avant = (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs[0]!.compteur;

    await banc.poster('/api/retrait', { avatar, jeton });
    await banc.serveur.publier();

    const apres = (await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs[0]!.compteur;
    expect(apres).toBe(avant - 1);
  });

  it('un avatar supprimé par modération apparaît aussi dans le fichier des retraits', async () => {
    banc.horloge.regler('2026-06-01T09:22:20Z');
    const avatar = await entrerAvecJeton(nouveauJeton());

    expect(await retirerAvatar(banc.sql, avatar, 'moderation')).toBe(true);
    expect(await retirerAvatar(banc.sql, 'avatar-fantome', 'moderation')).toBe(false);

    banc.horloge.regler('2026-06-01T09:23:00Z');
    expect(await retraitsPublies()).toContain(avatar);
  });

  it("le jeton en clair n'est jamais écrit en base, seul son SHA-256 l'est", async () => {
    banc.horloge.regler('2026-06-01T09:24:20Z');
    const jeton = nouveauJeton();
    const avatar = await entrerAvecJeton(jeton);
    await banc.poster('/api/retrait', { avatar, jeton });

    const contenu = JSON.stringify(
      await Promise.all(
        ['manif', 'avatar', 'retrait'].map((table) => banc.sql.unsafe(`select * from ${table}`)),
      ),
      (_cle, valeur: unknown) =>
        valeur && typeof valeur === 'object' && (valeur as { type?: unknown }).type === 'Buffer'
          ? Buffer.from((valeur as { data: number[] }).data).toString('hex')
          : valeur,
    );
    expect(contenu).not.toContain(jeton);
    expect(contenu).toContain(sha256(jeton));
  });

  it('le fichier des retraits est servi avec un cache court', async () => {
    const reponse = await fetch(new URL('/publie/retraits.json', banc.serveur.url));

    const cache = reponse.headers.get('cache-control') ?? '';
    expect(cache).toMatch(/max-age=(\d+)/);
    expect(Number(/max-age=(\d+)/.exec(cache)![1])).toBeLessThanOrEqual(60);
  });
});

describe('fichier des retraits (scénario partagé avec le Cortège)', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-05-01T13:00:00Z');
    await creerManif(banc.sql, {
      id: 'manif-a',
      intitule: 'Marche pour le climat',
      ville: 'Paris',
      ouverture: new Date('2026-05-01T13:55:00Z'),
      depart: new Date('2026-05-01T14:00:00Z'),
      parcours: PARCOURS,
      sources: [],
    });
    await preRemplirAvatars(banc.sql, [
      { id: 'av-reste', manifId: 'manif-a', entree: new Date('2026-05-01T13:56:12Z'), apparence: 3, pancarte: 7 },
      { id: 'av-retire', manifId: 'manif-a', entree: new Date('2026-05-01T13:57:40Z'), apparence: 1, pancarte: 2 },
      { id: 'av-modere', manifId: 'manif-a', entree: new Date('2026-05-01T13:58:05Z'), apparence: 2, pancarte: 4 },
    ]);
  });
  afterAll(async () => {
    if (!banc) return;
    // Fichiers publiés réutilisés par les tests du Cortège (client).
    await enregistrerFixtures(banc.dossierPublication, 'avec-retraits');
    await banc.arreter();
  });

  it('liste, triés, les avatars retirés par le soutien et par modération, et seulement eux', async () => {
    await retirerAvatar(banc.sql, 'av-retire', 'soutien');
    await retirerAvatar(banc.sql, 'av-modere', 'moderation');
    banc.horloge.regler('2026-05-01T14:05:00Z');
    await banc.serveur.publier();

    const { corps } = await banc.lire<Retraits>('/publie/retraits.json');

    expect(corps).toEqual({ v: 1, generee: '2026-05-01T14:05:00.000Z', retraits: ['av-modere', 'av-retire'] });
  });
});
