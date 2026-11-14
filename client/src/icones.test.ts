import { describe, expect, it } from 'vitest';
import { cheminPixels, icone } from './icones';

describe('icônes en pixels', () => {
  it('un rectangle par suite de pixels pleins, ligne par ligne', () => {
    expect(cheminPixels(['##.#', '....', '.###'])).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z');
    expect(cheminPixels(['....'])).toBe('');
  });

  it('SVG inline décoratif, sans ressource externe', () => {
    const svg = icone('son');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('viewBox="0 0 12 12"');
    expect(svg).not.toMatch(/href|url\(/);
  });
});
