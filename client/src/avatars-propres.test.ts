import { beforeEach, describe, expect, it } from 'vitest';
import { avatarsPropres, jetonDeRetrait, memoriserAvatarPropre, suivreFinsDesManifs } from './avatars-propres';

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

let stockage: StockageEnMemoire;
beforeEach(() => {
  stockage = new StockageEnMemoire();
  (globalThis as { localStorage?: unknown }).localStorage = stockage;
});

const entree = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:20:47Z') / 1000, ap: 4, pa: 1 };
const FIN = '2026-05-01T15:30:00.000Z';
const JETON = '0123456789abcdef0123456789abcdef';

describe('avatars propres sur cet appareil (ADR 0001)', () => {
  it("le jeton de retrait est gardé jusqu'à la fin de la manif, puis effacé du stockage", () => {
    memoriserAvatarPropre(entree, FIN, JETON);

    expect(jetonDeRetrait('av-moi', new Date('2026-05-01T15:29:59Z'))).toBe(JETON);
    expect(jetonDeRetrait('av-moi', new Date('2026-05-01T15:30:00Z'))).toBeUndefined();
    expect([...stockage.donnees.values()].join()).not.toContain(JETON);
  });

  it("l'avatar reste mis en valeur dans l'image finale jusqu'à 1 h après la fin, puis plus rien n'est gardé", () => {
    memoriserAvatarPropre(entree, FIN, JETON);

    expect(avatarsPropres(new Date('2026-05-01T16:29:00Z'))).toEqual([entree]);
    expect(avatarsPropres(new Date('2026-05-01T16:30:00Z'))).toEqual([]);
    expect(stockage.donnees.size).toBe(0);
  });

  it('départ avancé par un modérateur : jeton et avatar sont effacés selon la nouvelle fin', () => {
    memoriserAvatarPropre(entree, FIN, JETON);

    // Départ avancé de 30 min : la fin passe à 15:00.
    suivreFinsDesManifs([{ id: 'manif-a', fin: '2026-05-01T15:00:00.000Z' }], new Date('2026-05-01T14:40:00Z'));

    expect(jetonDeRetrait('av-moi', new Date('2026-05-01T15:00:00Z'))).toBeUndefined();
    expect(avatarsPropres(new Date('2026-05-01T16:00:00Z'))).toEqual([]);
  });

  it("départ retardé : le jeton reste utilisable jusqu'à la nouvelle fin", () => {
    memoriserAvatarPropre(entree, FIN, JETON);

    suivreFinsDesManifs([{ id: 'manif-a', fin: '2026-05-01T16:00:00.000Z' }], new Date('2026-05-01T14:40:00Z'));

    expect(jetonDeRetrait('av-moi', new Date('2026-05-01T15:45:00Z'))).toBe(JETON);
  });

  it('sans stockage disponible (navigation privée), rien ne casse', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('bloqué');
      },
      setItem: () => {
        throw new Error('bloqué');
      },
      removeItem: () => {
        throw new Error('bloqué');
      },
    };

    expect(() => memoriserAvatarPropre(entree, FIN, JETON)).not.toThrow();
    expect(() => suivreFinsDesManifs([{ id: 'manif-a', fin: FIN }], new Date())).not.toThrow();
    expect(avatarsPropres(new Date('2026-05-01T15:00:00Z'))).toEqual([]);
  });
});
