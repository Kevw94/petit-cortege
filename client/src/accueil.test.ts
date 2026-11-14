import { describe, expect, it } from 'vitest';
import { banniereCortege, etiquetteDepart, nombreDeSoutiens } from './accueil';

describe('carte d’une manif sur l’accueil', () => {
  const depart = Date.parse('2026-11-14T14:00:00Z');
  const fin = depart + 3 * 3_600_000;
  const avant = (ms: number) => etiquetteDepart(depart, fin, depart - ms);

  it('départ proche, en minutes puis en heures', () => {
    expect(avant(25 * 60_000)).toEqual({ etat: 'bientot', texte: 'Départ dans 25 min' });
    expect(avant(10_000)).toEqual({ etat: 'bientot', texte: 'Départ dans 1 min' });
    expect(avant(2 * 3_600_000)).toEqual({ etat: 'bientot', texte: 'Départ dans 2 h' });
    expect(avant(2 * 3_600_000 + 5 * 60_000)).toEqual({ etat: 'bientot', texte: 'Départ dans 2 h 05' });
    expect(avant(3 * 86_400_000).texte).toBe('À venir');
  });

  it('en marche entre le départ et la fin, puis terminée', () => {
    expect(etiquetteDepart(depart, fin, depart)).toEqual({ etat: 'en-marche', texte: 'En marche' });
    expect(etiquetteDepart(depart, fin, fin)).toEqual({ etat: 'terminee', texte: 'Terminée' });
  });

  it('compteur de soutiens au singulier et au pluriel', () => {
    expect(nombreDeSoutiens(0)).toBe('0 soutien');
    expect(nombreDeSoutiens(1)).toBe('1 soutien');
    expect(nombreDeSoutiens(2)).toBe('2 soutiens');
  });

  it('bandeau décoratif en SVG inline, sans ressource externe ni texte', () => {
    const svg = banniereCortege();
    expect(svg).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(svg).not.toMatch(/href|url\(|<text/);
  });
});
