/**
 * Référencement statique de la page d'accueil. `robots.txt` et le sitemap de
 * repli sont dans `public/` (copiés à la racine du build). Le sitemap servi en
 * production est celui de Node, qui y ajoute les manifs (`/sitemap.xml` relayé).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dossierPublic = join(import.meta.dirname, '..', '..', 'public');

describe('référencement', () => {
  it('autorise le site, écarte /api et indique le sitemap', () => {
    const robots = readFileSync(join(dossierPublic, 'robots.txt'), 'utf8');
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/petit-cortege\.fr\/sitemap\.xml$/m);
    expect(robots).not.toMatch(/#\//);
  });

  it("ne liste que la page d'accueil dans le sitemap", () => {
    const sitemap = readFileSync(join(dossierPublic, 'sitemap.xml'), 'utf8');
    const adresses = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((correspondance) => correspondance[1]);
    expect(adresses).toEqual(['https://petit-cortege.fr/']);
    expect(sitemap).not.toMatch(/#\//);
  });
});
