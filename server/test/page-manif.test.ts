/**
 * HTML initial d'une page de manif et sitemap : ce qu'un robot lit sans
 * exécuter le JavaScript. Les chaînes attendues sont des littéraux, pas
 * recalculées comme le ferait le rendu.
 */
import { describe, expect, it } from 'vitest';
import type { ManifPubliee } from '@petit-cortege/shared';
import {
  assetsDeLaCoque,
  instantParis,
  rendrePageAbsente,
  rendrePageManif,
  rendreSitemap,
  textesManif,
} from '../src/page-manif';

const COQUE = `<!doctype html>
<html><head>
<title>ACCUEIL-NE-DOIT-PAS-FUITER</title>
<meta name="description" content="DESC-ACCUEIL" />
<link rel="canonical" href="https://petit-cortege.fr/" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/assets/index-abc.css" />
<script type="application/ld+json">{ "@type": "WebSite" }</script>
</head><body>
<div id="interface">accueil</div>
<script type="module" src="/assets/index-abc.js"></script>
</body></html>`;

function manif(surcharge: Partial<ManifPubliee> = {}): ManifPubliee {
  return {
    id: 'paris-2026-11-17',
    intitule: 'Grève interprofessionnelle',
    ville: 'Paris',
    ouverture: '2026-11-17T10:00:00.000Z',
    depart: '2026-11-17T13:00:00.000Z',
    fin: '2026-11-17T15:30:00.000Z',
    parcours: { type: 'LineString', coordinates: [[2.39, 48.85], [2.36, 48.83]] },
    longueurM: 1000,
    sources: [{ libelle: 'Appel des organisateurs', url: 'https://exemple.org/appel?q=1&x=2' }],
    compteur: 3,
    ...surcharge,
  };
}

function jsonLd(html: string): Record<string, unknown> {
  const bloc = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!bloc) throw new Error('JSON-LD absent');
  return JSON.parse(bloc) as Record<string, unknown>;
}

describe('heure de Paris', () => {
  it('écrit l’heure d’hiver et l’heure d’été avec leur décalage', () => {
    expect(instantParis(new Date('2026-11-17T13:00:00.000Z'))).toBe('2026-11-17T14:00:00+01:00');
    expect(instantParis(new Date('2026-07-14T12:00:00.000Z'))).toBe('2026-07-14T14:00:00+02:00');
  });
});

describe('page de manif', () => {
  const html = rendrePageManif({ manif: manif(), etapes: ['Nation', 'Italie'], terminee: false, coque: COQUE });

  it('porte un titre, une description et un h1 propres à la manif', () => {
    expect(textesManif(manif(), ['Nation', 'Italie'], false)).toEqual({
      h1: 'Manif Paris 17 novembre 2026 : parcours Nation → Italie',
      titre: 'Manif Paris 17 novembre 2026 : parcours Nation → Italie | Petit Cortège',
      description:
        'Cortège virtuel à Paris le 17 novembre 2026, départ à 14 h 00, parcours Nation → Italie. Rejoins la manif en ligne, sans compte ni publicité.',
      chapeau:
        'Grève interprofessionnelle. Cortège virtuel en pixel art, à Paris, départ le mardi 17 novembre 2026 à 14 h 00 (heure de Paris).',
    });
    expect(html).toContain('<title>Manif Paris 17 novembre 2026 : parcours Nation → Italie | Petit Cortège</title>');
    expect(html).toContain(
      'content="Cortège virtuel à Paris le 17 novembre 2026, départ à 14 h 00, parcours Nation → Italie. Rejoins la manif en ligne, sans compte ni publicité."',
    );
    expect(html).toContain('<h1>Manif Paris 17 novembre 2026 : parcours Nation → Italie</h1>');
    expect(html).toContain('départ le mardi 17 novembre 2026 à 14 h 00');
    expect(html).toContain('<li>Nation</li>');
    expect(html).toContain('<li>Italie</li>');
    expect(html).toContain('>Appel des organisateurs</a>');
    expect(html).toContain('href="https://exemple.org/appel?q=1&amp;x=2"');
    expect(html).not.toContain('Ce cortège est terminé.');
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });

  it('déclare l’URL canonique, Open Graph et un Event en présence mixte', () => {
    expect(html).toContain('<link rel="canonical" href="https://petit-cortege.fr/manif/paris-2026-11-17" />');
    expect(html).toContain('<meta property="og:url" content="https://petit-cortege.fr/manif/paris-2026-11-17" />');
    expect(html).toContain(
      '<meta property="og:title" content="Manif Paris 17 novembre 2026 : parcours Nation → Italie | Petit Cortège" />',
    );
    expect(html).toContain('<meta property="og:image" content="https://petit-cortege.fr/apercu.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
    const evenement = jsonLd(html);
    expect(evenement['@type']).toBe('Event');
    expect(evenement.startDate).toBe('2026-11-17T14:00:00+01:00');
    expect(evenement.endDate).toBe('2026-11-17T16:30:00+01:00');
    expect(evenement.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode');
    expect(evenement.eventStatus).toBe('https://schema.org/EventScheduled');
    expect(evenement.url).toBe('https://petit-cortege.fr/manif/paris-2026-11-17');
    expect(evenement.location).toEqual([
      { '@type': 'Place', name: 'Paris', address: { '@type': 'PostalAddress', addressLocality: 'Paris' } },
      { '@type': 'VirtualLocation', url: 'https://petit-cortege.fr/manif/paris-2026-11-17' },
    ]);
    expect(html).not.toContain('ACCUEIL-NE-DOIT-PAS-FUITER');
    expect(html).not.toContain('DESC-ACCUEIL');
    expect(html).not.toContain('"@type":"WebSite"');
    expect(html).not.toContain('WebSite');
  });

  it('garde le script et la feuille de style de la coque, pour ouvrir l’application', () => {
    expect(assetsDeLaCoque(COQUE)).toEqual({
      liens: '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />\n    <link rel="stylesheet" href="/assets/index-abc.css" />',
      scripts: '<script type="module" src="/assets/index-abc.js"></script>',
    });
    expect(html).toContain('<script type="module" src="/assets/index-abc.js"></script>');
    expect(
      assetsDeLaCoque(
        '<script type="module" crossorigin src="/assets/index-NabNGpTn.js"></script>\n<link rel="stylesheet" crossorigin href="/assets/index-DQ3nBGTQ.css">',
      ),
    ).toEqual({
      liens: '<link rel="stylesheet" crossorigin href="/assets/index-DQ3nBGTQ.css">',
      scripts: '<script type="module" crossorigin src="/assets/index-NabNGpTn.js"></script>',
    });
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css" />');
    expect(html).toContain('"id":"paris-2026-11-17"');
  });

  it('dit qu’une manif passée est terminée et ne la marque pas comme à venir', () => {
    const passee = rendrePageManif({ manif: manif(), etapes: ['Nation', 'Italie'], terminee: true, coque: COQUE });
    expect(passee).toContain('<p>Ce cortège est terminé.</p>');
    expect(passee).toContain(
      'content="Cortège virtuel terminé : manif à Paris le 17 novembre 2026, départ à 14 h 00, parcours Nation → Italie. L’image finale reste consultable en ligne."',
    );
    expect(jsonLd(passee).eventStatus).toBeUndefined();
    expect(jsonLd(passee).startDate).toBe('2026-11-17T14:00:00+01:00');
  });

  it('omet le parcours du titre s’il n’y a pas deux étapes, et le garde dans la page s’il y en a une', () => {
    const sans = rendrePageManif({ manif: manif(), etapes: [], terminee: false, coque: '' });
    expect(sans).toContain('<title>Manif Paris 17 novembre 2026 | Petit Cortège</title>');
    expect(sans).not.toContain('<h2>Parcours annoncé</h2>');
    const une = rendrePageManif({ manif: manif(), etapes: ['Nation'], terminee: false, coque: '' });
    expect(une).toContain('<title>Manif Paris 17 novembre 2026 | Petit Cortège</title>');
    expect(une).toContain('<li>Nation</li>');
  });

  it('raccourcit le titre quand les lieux sont trop longs, sans les retirer du texte', () => {
    const long = 'Place de la Nation, douzième arrondissement de Paris';
    const page = rendrePageManif({ manif: manif(), etapes: [long, 'Place d’Italie, treizième arrondissement'], terminee: false, coque: '' });
    expect(page).toContain('<title>Manif Paris 17 novembre 2026 | Petit Cortège</title>');
    expect(page).toContain(`<li>${long}</li>`);
    expect(page).toContain('<li>Place d’Italie, treizième arrondissement</li>');
  });

  it('échappe l’intitulé, les étapes et les sources, et refuse une URL qui n’est pas http', () => {
    const piege = rendrePageManif({
      manif: manif({
        intitule: '</title><script>alert(1)</script>',
        ville: 'Paris',
        sources: [
          { libelle: 'src<img onerror=alert(1)>', url: 'javascript:alert(1)' },
          { libelle: 'Appel "officiel"', url: 'https://exemple.org/a?q=1&x=2' },
        ],
      }),
      etapes: ['A<script>', 'B'],
      terminee: false,
      coque: COQUE,
    });
    expect(piege).not.toContain('<script>alert');
    expect(piege).not.toContain('</title><script>');
    expect(piege).not.toContain('href="javascript:');
    expect(piege).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(piege).toContain('<li>A&lt;script&gt;</li>');
    expect(piege).toContain('<li>src&lt;img onerror=alert(1)&gt;</li>');
    expect(piege).toContain('href="https://exemple.org/a?q=1&amp;x=2"');
    expect(piege).toContain('Appel &quot;officiel&quot;');
    expect(piege.match(/<title>/g)).toHaveLength(1);
    const embarque = /<script type="application\/json" id="donnees-manif">([\s\S]*?)<\/script>/.exec(piege)?.[1] ?? '';
    expect(embarque).not.toContain('<');
    expect(JSON.parse(embarque).intitule).toBe('</title><script>alert(1)</script>');
  });
});

describe('page absente', () => {
  it('répond introuvable ou retirée, en noindex, sans reprendre un intitulé', () => {
    const absente = rendrePageAbsente(404, COQUE);
    expect(absente).toContain('<title>Manif introuvable | Petit Cortège</title>');
    expect(absente).toContain('<meta name="robots" content="noindex" />');
    expect(absente).toContain('<h1>Manif introuvable</h1>');
    expect(absente).not.toContain('rel="canonical"');
    expect(absente).toContain('src="/assets/index-abc.js"');

    const retiree = rendrePageAbsente(410, COQUE);
    expect(retiree).toContain('<title>Manif retirée | Petit Cortège</title>');
    expect(retiree).toContain('Cette manif a été retirée.');
    expect(retiree).toContain('content="noindex"');
    expect(retiree).not.toContain('Grève');
  });
});

describe('sitemap', () => {
  it('liste l’accueil et les manifs, avec lastmod, et écarte un identifiant invalide', () => {
    expect(
      rendreSitemap([
        { id: 'paris-2026-11-17', modifiee: new Date('2026-11-16T18:00:00.000Z') },
        { id: 'a<b', modifiee: new Date('2026-11-16T18:00:00.000Z') },
        { id: 'lyon-2026-03-08', modifiee: new Date('2026-03-01T08:30:00.000Z') },
      ]),
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://petit-cortege.fr/</loc>
  </url>
  <url>
    <loc>https://petit-cortege.fr/manif/paris-2026-11-17</loc>
    <lastmod>2026-11-16T18:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://petit-cortege.fr/manif/lyon-2026-03-08</loc>
    <lastmod>2026-03-01T08:30:00.000Z</lastmod>
  </url>
</urlset>
`);
  });
});
