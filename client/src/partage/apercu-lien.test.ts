/**
 * Aperçu de lien (Open Graph, Twitter) : une seule image et un seul texte génériques
 * pour tout le site (ADR 0002). Les réseaux sociaux ne voient pas le fragment, donc
 * pas la manif ; aucune balise ne doit dépendre de la manif ni être modifiée à l'exécution.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const racineClient = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(racineClient, 'index.html'), 'utf8');

function balises(source: string): Map<string, string> {
  const trouvees = new Map<string, string>();
  for (const [balise] of source.matchAll(/<meta\b[^>]*>/g)) {
    const cle = /\b(?:property|name)="([^"]+)"/.exec(balise)?.[1];
    const contenu = /\bcontent="([^"]*)"/.exec(balise)?.[1];
    if (cle && contenu !== undefined) trouvees.set(cle, contenu);
  }
  return trouvees;
}

/** URL canonique déclarée dans le `<head>`, s'il y en a une. */
function urlCanonique(source: string): string | undefined {
  const lien = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(source)?.[0];
  return lien ? /\bhref="([^"]*)"/.exec(lien)?.[1] : undefined;
}

/** Dimensions d'un PNG, lues dans son en-tête IHDR. */
function dimensionsPng(octets: Buffer): { largeur: number; hauteur: number } {
  expect(octets.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) };
}

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiersSource(chemin) : [chemin];
  });
}

describe('aperçu de lien', () => {
  const meta = balises(html);

  it('déclare titre, description et image Open Graph et Twitter, génériques', () => {
    expect(meta.get('og:type')).toBe('website');
    expect(meta.get('og:site_name')).toBe('Petit Cortège');
    expect(meta.get('og:title')).toBe('Petit Cortège');
    expect(meta.get('og:description')).toBeTruthy();
    expect(meta.get('description')).toBe(meta.get('og:description'));
    expect(meta.get('og:image:width')).toBe('1200');
    expect(meta.get('og:image:height')).toBe('630');
    expect(meta.get('og:image:type')).toBe('image/png');
    expect(meta.get('og:image:alt')).toBeTruthy();
    expect(meta.get('og:url')).toBe('https://petit-cortege.fr/');
    expect(urlCanonique(html)).toBe('https://petit-cortege.fr/');
    expect(meta.get('twitter:card')).toBe('summary_large_image');
    expect(meta.get('twitter:title')).toBe(meta.get('og:title'));
    expect(meta.get('twitter:description')).toBe(meta.get('og:description'));
    expect(meta.get('twitter:image')).toBe(meta.get('og:image'));
    expect(meta.get('twitter:image:alt')).toBe(meta.get('og:image:alt'));
  });

  it("pointe une image unique de 1200 × 630, servie telle quelle par le site", () => {
    const image = meta.get('og:image')!;
    expect(image).toBe('https://petit-cortege.fr/apercu.png');
    const chemin = new URL(image).pathname;
    expect(chemin).toMatch(/^\/[a-z0-9-]+\.png$/);
    const { largeur, hauteur } = dimensionsPng(readFileSync(join(racineClient, 'public', chemin)));
    expect({ largeur, hauteur }).toEqual({ largeur: 1200, hauteur: 630 });
  });

  it("ne contient aucune URL ni mention par manif (ADR 0002)", () => {
    for (const [cle, valeur] of meta) {
      if (!cle.startsWith('og:') && !cle.startsWith('twitter:')) continue;
      expect(valeur).not.toMatch(/manif\/|#/);
    }
    expect(meta.get('og:url')).toBe('https://petit-cortege.fr/');
    expect(urlCanonique(html)).toBe(meta.get('og:url'));
  });

  it("n'est jamais modifié par le code du client (identique pour toutes les pages du site)", () => {
    const sources = fichiersSource(join(racineClient, 'src')).filter(
      (f) => /\.ts$/.test(f) && !f.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const fichier of sources) {
      const contenu = readFileSync(fichier, 'utf8');
      expect(contenu, fichier).not.toMatch(/og:|twitter:|meta\[/);
    }
  });
});
