/**
 * La page et le sitemap sont servis par le serveur, depuis la base :
 * une manif créée après le build a sa page sans reconstruction.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerManif, retirerManif } from '../src/index';
import { demarrerBanc, type Banc } from './support';

const PARCOURS = {
  type: 'LineString' as const,
  coordinates: [
    [2.39, 48.85],
    [2.36, 48.83],
  ] as [number, number][],
};

const coque = readFileSync(join(import.meta.dirname, '../../client/index.html'), 'utf8');
const scriptCoque = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/.exec(coque)?.[1];

describe('page et sitemap servis', () => {
  let banc: Banc;

  beforeAll(async () => {
    banc = await demarrerBanc('2026-11-17T12:00:00.000Z');
    await creerManif(banc.sql, {
      id: 'paris-2026-11-17',
      intitule: 'Grève interprofessionnelle',
      ville: 'Paris',
      ouverture: new Date('2026-11-17T10:00:00.000Z'),
      depart: new Date('2026-11-17T13:00:00.000Z'),
      parcours: PARCOURS,
      sources: [{ libelle: 'Appel des organisateurs', url: 'https://exemple.org/appel?q=1&x=2' }],
      etapes: ['Nation', 'Italie'],
    });
    await creerManif(banc.sql, {
      id: 'ancienne-2020-01-01',
      intitule: 'Marche ancienne',
      ville: 'Lyon',
      ouverture: new Date('2020-01-01T08:00:00.000Z'),
      depart: new Date('2020-01-01T13:00:00.000Z'),
      parcours: PARCOURS,
      sources: [],
      etapes: [],
    });
    await creerManif(banc.sql, {
      id: 'retrait-2026-11-17',
      intitule: 'MOT-SECRET-RETIREE',
      ville: 'Marseille',
      ouverture: new Date('2026-11-17T10:00:00.000Z'),
      depart: new Date('2026-11-17T13:00:00.000Z'),
      parcours: PARCOURS,
      sources: [],
    });
    await retirerManif(banc.sql, banc.horloge, 'retrait-2026-11-17', 'arrêté de test');
    await banc.sql`update manif set modifiee = ${new Date('2026-11-16T18:00:00.000Z')} where id = 'paris-2026-11-17'`;
    await banc.sql`update manif set modifiee = ${new Date('2020-01-02T09:00:00.000Z')} where id = 'ancienne-2020-01-01'`;
  });

  afterAll(async () => {
    await banc?.arreter();
  });

  async function lire(chemin: string) {
    const reponse = await fetch(new URL(chemin, banc.serveur.url));
    return { statut: reponse.status, html: await reponse.text(), entetes: reponse.headers };
  }

  it('sert le HTML de la manif, avec le script de l’application', async () => {
    const { statut, html, entetes } = await lire('/manif/paris-2026-11-17');
    expect(statut).toBe(200);
    expect(entetes.get('content-type')).toContain('text/html');
    expect(entetes.get('cache-control')).toBe('public, max-age=60');
    expect(html).toContain('<title>Manif Paris 17 novembre 2026 : parcours Nation → Italie | Petit Cortège</title>');
    expect(html).toContain('content="Cortège virtuel à Paris le 17 novembre 2026, départ à 14 h 00, parcours Nation → Italie. Rejoins la manif en ligne, sans compte ni publicité."');
    expect(html).toContain('<h1>Manif Paris 17 novembre 2026 : parcours Nation → Italie</h1>');
    expect(html).toContain('href="https://petit-cortege.fr/manif/paris-2026-11-17"');
    expect(html).toContain('"@type":"Event"');
    expect(html).toContain('"startDate":"2026-11-17T14:00:00+01:00"');
    expect(html).toContain('href="https://exemple.org/appel?q=1&amp;x=2"');
    expect(html).toContain('<li>Nation</li>');
    expect(html).not.toContain('Ce cortège est terminé.');
    expect(scriptCoque).toBeTruthy();
    expect(html).toContain(`src="${scriptCoque}"`);
    expect(html).not.toContain('Petit Cortège : manif virtuelle en pixel art');
  });

  it('laisse une manif passée en ligne, en disant qu’elle est terminée', async () => {
    const { statut, html } = await lire('/manif/ancienne-2020-01-01');
    expect(statut).toBe(200);
    expect(html).toContain('<title>Manif Lyon 1 janvier 2020 | Petit Cortège</title>');
    expect(html).toContain('<p>Ce cortège est terminé.</p>');
    expect(html).not.toContain('eventStatus');
  });

  it('retire une manif de l’index : 410, noindex, sans son intitulé', async () => {
    const { statut, html, entetes } = await lire('/manif/retrait-2026-11-17');
    expect(statut).toBe(410);
    expect(entetes.get('x-robots-tag')).toBe('noindex');
    expect(entetes.get('cache-control')).toBe('no-store');
    expect(html).toContain('content="noindex"');
    expect(html).toContain('Cette manif a été retirée.');
    expect(html).not.toContain('MOT-SECRET-RETIREE');
  });

  it('répond 404 pour une manif inconnue, sans refléter l’adresse', async () => {
    const inconnue = await lire('/manif/inconnue');
    expect(inconnue.statut).toBe(404);
    expect(inconnue.html).toContain('Cette manif n’existe pas.');
    expect(inconnue.entetes.get('x-robots-tag')).toBe('noindex');

    const piege = await lire(`/manif/${encodeURIComponent('a<script>')}`);
    expect(piege.statut).toBe(404);
    expect(piege.html).not.toContain('a<script>');
  });

  it('liste dans le sitemap les manifs ouvertes et passées, pas la retirée', async () => {
    const reponse = await fetch(new URL('/sitemap.xml', banc.serveur.url));
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get('content-type')).toContain('xml');
    const xml = await reponse.text();
    expect(xml).toContain('<loc>https://petit-cortege.fr/</loc>');
    expect(xml).toContain('<loc>https://petit-cortege.fr/manif/paris-2026-11-17</loc>');
    expect(xml).toContain('<lastmod>2026-11-16T18:00:00.000Z</lastmod>');
    expect(xml).toContain('<loc>https://petit-cortege.fr/manif/ancienne-2020-01-01</loc>');
    expect(xml).toContain('<lastmod>2020-01-02T09:00:00.000Z</lastmod>');
    expect(xml).not.toContain('retrait-2026-11-17');
    expect(xml).not.toContain('#/');
  });
});
