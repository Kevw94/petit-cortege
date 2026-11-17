/**
 * Texte d'accueil servi dans le HTML, avant le JavaScript : c'est ce que voit
 * un robot qui n'exécute pas la page. Le montage de l'app déplace ce bloc,
 * il ne le réécrit pas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const racineClient = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(racineClient, 'index.html'), 'utf8');
const main = readFileSync(join(racineClient, 'src', 'main.ts'), 'utf8');

const TITRE = 'Petit Cortège : manif virtuelle en pixel art';
const DESCRIPTION =
  'Soutenir une manif à distance : rejoins un cortège virtuel en pixel art qui suit le parcours réel, sans compte ni publicité, et repars avec l’image finale.';
const PARAGRAPHES = [
  'Tu rejoins une manif en pixel art : un cortège virtuel qui suit le parcours réel d’une manifestation, à l’horaire annoncé.',
  'Sans compte ni publicité, tu composes ta pancarte pour soutenir une manif à distance. La foule se remplit, puis tu repars avec l’image finale.',
  'Quand tu ne peux pas être sur place, ça permet de manifester sans se déplacer, et même de manifester de chez soi.',
];

describe("texte visible de l'accueil", () => {
  const entete = /<header\b[^>]*\bid="presentation"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0];

  it('est dans le HTML statique, visible, avec un h1 et trois paragraphes', () => {
    expect(entete, 'bloc #presentation').toBeTruthy();
    expect(entete).not.toMatch(/\bhidden\b|display\s*:\s*none|aria-hidden/);
    expect(entete).toContain(`<h1>${TITRE}</h1>`);
    for (const paragraphe of PARAGRAPHES) {
      expect(entete).toContain(`<p>${paragraphe}</p>`);
    }
    expect(entete?.match(/<p>/g)).toHaveLength(PARAGRAPHES.length);
  });

  it("n'est pas réécrit par le script : le montage déplace le même bloc", () => {
    expect(main).toContain("getElementById('presentation')");
    expect(main).not.toContain(TITRE);
    expect(main).not.toContain('class="accroche"');
    for (const paragraphe of PARAGRAPHES) expect(main).not.toContain(paragraphe);
  });
});

describe('données structurées', () => {
  const bloc = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);

  it('décrit un site et une application gratuite, sans identifiant de manif', () => {
    expect(bloc?.[1]).toBeTruthy();
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);
    const donnees = JSON.parse(bloc![1]!) as {
      '@context': string;
      '@graph': Array<Record<string, unknown>>;
    };
    expect(donnees['@context']).toBe('https://schema.org');
    const types = donnees['@graph'].map((entree) => entree['@type']);
    expect(types).toEqual(['WebSite', 'WebApplication']);
    for (const entree of donnees['@graph']) {
      expect(entree.name).toBe('Petit Cortège');
      expect(entree.alternateName).toBe('Manif virtuelle');
      expect(entree.url).toBe('https://petit-cortege.fr/');
      expect(entree.description).toBe(DESCRIPTION);
      expect(JSON.stringify(entree)).not.toMatch(/#\/|manif\//);
    }
    const application = donnees['@graph'][1]!;
    expect(application.isAccessibleForFree).toBe(true);
    expect(application.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'EUR' });
  });
});
