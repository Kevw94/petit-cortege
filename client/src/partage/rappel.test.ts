import { describe, expect, it } from 'vitest';
import { rappelIcs, TITRE_RAPPEL } from './rappel';

const fin = new Date('2026-03-08T17:30:00Z');
const maintenant = new Date('2026-03-08T13:05:42Z');
const url = 'https://petit-cortege.example/#/manif/paris-2026-03-08';

const lignes = (ics: string) => ics.split('\r\n');
/** Déplie les lignes repliées (RFC 5545 §3.1) et renvoie la valeur d'une propriété. */
const propriete = (ics: string, nom: string) =>
  ics
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .find((l) => l.startsWith(`${nom}:`) || l.startsWith(`${nom};`))
    ?.replace(/^[^:]*:/, '');

describe('rappel .ics', () => {
  it("est un VCALENDAR valide : un VEVENT à l'heure de fin de la manif, au titre neutre exact", () => {
    const ics = rappelIcs({ fin, url, maintenant });
    const l = lignes(ics);
    expect(l[0]).toBe('BEGIN:VCALENDAR');
    expect(l).toContain('VERSION:2.0');
    expect(l.some((x) => x.startsWith('PRODID:'))).toBe(true);
    expect(l).toContain('BEGIN:VEVENT');
    expect(l).toContain('END:VEVENT');
    expect(l.at(-2)).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(propriete(ics, 'SUMMARY')).toBe('Petit Cortège – voir la photo finale');
    expect(TITRE_RAPPEL).toBe('Petit Cortège – voir la photo finale');
    expect(propriete(ics, 'DTSTART')).toBe('20260308T173000Z');
    expect(propriete(ics, 'DTSTAMP')).toBe('20260308T130542Z');
    expect(propriete(ics, 'URL')).toBe(url);
  });

  it('sépare les lignes par CRLF, sans LF isolé, et replie les lignes à 75 octets', () => {
    const longue = `https://petit-cortege.example/#/manif/${'x'.repeat(200)}`;
    const ics = rappelIcs({ fin, url: longue, maintenant });
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const ligne of lignes(ics)) expect(new TextEncoder().encode(ligne).length).toBeLessThanOrEqual(75);
    expect(propriete(ics, 'URL')).toBe(longue);
  });

  it('replie sans couper un caractère multi-octets (titre accentué, tiret long)', () => {
    const ics = rappelIcs({ fin, url: `https://ex.example/#/manif/${'é'.repeat(80)}`, maintenant });
    for (const ligne of lignes(ics)) {
      expect(new TextEncoder().encode(ligne).length).toBeLessThanOrEqual(75);
      expect(ligne).not.toContain('�');
    }
    expect(propriete(ics, 'URL')).toBe(`https://ex.example/#/manif/${'é'.repeat(80)}`);
  });

  it("donne un UID aléatoire, différent à chaque rappel, qui ne contient pas l'identifiant de la manif", () => {
    const a = propriete(rappelIcs({ fin, url, maintenant }), 'UID')!;
    const b = propriete(rappelIcs({ fin, url, maintenant }), 'UID')!;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}@petit-cortege$/);
    expect(a).not.toContain('paris');
  });

  it('échappe virgule, point-virgule et antislash dans le texte, pas dans la propriété URL', () => {
    const ics = rappelIcs({ fin, url: 'https://ex.example/a,b;c\\d#/manif/x', maintenant });
    expect(propriete(ics, 'URL')).toBe('https://ex.example/a,b;c\\d#/manif/x');
    expect(propriete(ics, 'DESCRIPTION')).toContain('https://ex.example/a\\,b\\;c\\\\d#/manif/x');
  });

  it("ne mentionne ni l'intitulé ni la cause : description neutre, sans lieu ni catégorie", () => {
    const ics = rappelIcs({ fin, url, maintenant });
    expect(propriete(ics, 'DESCRIPTION')).toBe(
      'L’image finale du cortège est prête sur Petit Cortège : https://petit-cortege.example/#/manif/paris-2026-03-08',
    );
    expect(ics).not.toMatch(/LOCATION|CATEGORIES|manifestation|grève/i);
  });
});
