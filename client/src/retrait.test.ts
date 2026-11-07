import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { avatarsPropres, jetonDeRetrait, memoriserAvatarPropre } from './avatars-propres';
import { hacherJetonRetrait, nouveauJetonRetrait, retirerMesAvatars } from './retrait';

// Contrat avec le serveur (server/test/retrait.test.ts) : jeton de 128 bits en
// hexadécimal, dont seul le SHA-256 (hex, du texte UTF-8) est envoyé à l'entrée.
describe('jeton de retrait', () => {
  it('128 bits aléatoires, en hexadécimal', () => {
    const jetons = Array.from({ length: 50 }, nouveauJetonRetrait);

    for (const jeton of jetons) expect(jeton).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(jetons).size).toBe(50);
  });

  it('son hachage est le SHA-256 hexadécimal du jeton', async () => {
    // Vecteur de test FIPS 180-2 : SHA-256("abc").
    expect(await hacherJetonRetrait('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

/** localStorage du navigateur (absent sous Node) : un simple dictionnaire. */
class StockageEnMemoire {
  readonly donnees = new Map<string, string>();
  getItem(cle: string) {
    return this.donnees.get(cle) ?? null;
  }
  setItem(cle: string, valeur: string) {
    this.donnees.set(cle, valeur);
  }
  removeItem(cle: string) {
    this.donnees.delete(cle);
  }
}

describe('retirer ses avatars depuis cet appareil', () => {
  const MAINTENANT = new Date('2026-05-01T15:00:00Z');
  const FIN = '2026-05-01T15:30:00.000Z';
  const avatar = (a: string) => ({ a, m: 'manif-a', t: Date.parse('2026-05-01T14:20:47Z') / 1000, ap: 4, pa: 1 });
  const JETON = '0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new StockageEnMemoire();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serveurRepond = (statut: number, corps: unknown) => {
    const appels: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      appels.push(JSON.parse(init.body));
      return new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
    });
    return appels;
  };

  it('retrait accepté : avatar et jeton oubliés', async () => {
    memoriserAvatarPropre(avatar('av-1'), FIN, JETON);
    const appels = serveurRepond(200, { avatar: 'av-1' });

    const resultat = await retirerMesAvatars(['av-1'], MAINTENANT);

    expect(resultat).toEqual({ retires: ['av-1'], refuses: [] });
    expect(appels).toEqual([{ avatar: 'av-1', jeton: JETON }]);
    expect(avatarsPropres(MAINTENANT)).toEqual([]);
  });

  it('retrait refusé pour de bon (hachage effacé côté serveur) : le jeton est oublié, l’avatar reste à soi', async () => {
    memoriserAvatarPropre(avatar('av-1'), FIN, JETON);
    serveurRepond(403, { erreur: 'retrait-refuse' });

    const resultat = await retirerMesAvatars(['av-1'], MAINTENANT);

    expect(resultat).toEqual({ retires: [], refuses: ['av-1'] });
    // Plus de jeton : le bouton « Retirer » ne réapparaît pas, l'avatar reste mis en valeur.
    expect(jetonDeRetrait('av-1', MAINTENANT)).toBeUndefined();
    expect(avatarsPropres(MAINTENANT).map((e) => e.a)).toEqual(['av-1']);
  });

  it('erreur passagère (réseau) : le jeton est gardé pour réessayer', async () => {
    memoriserAvatarPropre(avatar('av-1'), FIN, JETON);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('réseau coupé');
    });

    const resultat = await retirerMesAvatars(['av-1'], MAINTENANT);

    expect(resultat).toMatchObject({ retires: [], refuses: [], erreur: { code: 'reseau' } });
    expect(jetonDeRetrait('av-1', MAINTENANT)).toBe(JETON);
  });
});
