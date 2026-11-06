import { describe, expect, it } from 'vitest';
import { hacherJetonRetrait, nouveauJetonRetrait } from './retrait';

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
