import { describe, expect, it } from 'vitest';
import type { MeteoPubliee, Position } from '@petit-cortege/shared';
import { ambiance, hauteurDuSoleil, resumeMeteo } from './ambiance';

const PARIS: Position = [2.35, 48.85];
const MIDI_ETE = new Date('2026-06-21T11:51:00Z'); // midi solaire à Paris (≈ 11 h 51 UTC)
const MINUIT_ETE = new Date('2026-06-21T23:51:00Z');
const COUCHER_ETE = new Date('2026-06-21T19:58:00Z'); // soleil juste au-dessus de l'horizon

const meteo = (m: Partial<MeteoPubliee>): MeteoPubliee => ({
  releve: '2026-06-21T11:45:00.000Z',
  ciel: 'degage',
  precipitation: 'aucune',
  intensite: 0,
  temperatureC: 24,
  ...m,
});

const rgb = (c: number) => ({ r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 });
const luminance = (c: number) => {
  const { r, g, b } = rgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const estBleu = (c: number) => {
  const { r, g, b } = rgb(c);
  return b > r + 0.2 && b > g;
};
const estGris = (c: number) => {
  const { r, g, b } = rgb(c);
  return Math.max(r, g, b) - Math.min(r, g, b) < 0.12;
};

describe('hauteur du soleil', () => {
  it('à Paris, au solstice d’été, ≈ 64,6° à midi et ≈ −17,7° à minuit (90° − 48,85° ± 23,44°)', () => {
    expect(hauteurDuSoleil(PARIS, MIDI_ETE)).toBeCloseTo(64.6, 0);
    expect(hauteurDuSoleil(PARIS, MINUIT_ETE)).toBeCloseTo(-17.7, 0);
  });

  it('à Paris, au solstice d’hiver, ≈ 17,7° à midi', () => {
    expect(hauteurDuSoleil(PARIS, new Date('2026-12-21T11:49:00Z'))).toBeCloseTo(17.7, 0);
  });
});

describe('ambiance de la vue selon la météo et l’heure', () => {
  it('beau temps en journée : ciel bleu, soleil franc, pas de précipitation', () => {
    const a = ambiance(meteo({ ciel: 'degage' }), PARIS, MIDI_ETE);
    expect(estBleu(a.zenith)).toBe(true);
    expect(estBleu(a.horizon)).toBe(true);
    expect(a.soleil.intensite).toBeGreaterThan(1);
    expect(a.precipitation).toBeNull();
    expect(a.nuit).toBe(false);
  });

  it('ciel couvert en journée : ciel gris, soleil voilé, brume plus proche', () => {
    const beau = ambiance(meteo({ ciel: 'degage' }), PARIS, MIDI_ETE);
    const couvert = ambiance(meteo({ ciel: 'couvert' }), PARIS, MIDI_ETE);
    expect(estGris(couvert.zenith)).toBe(true);
    expect(couvert.soleil.intensite).toBeLessThan(beau.soleil.intensite / 2);
    expect(couvert.portee).toBeLessThan(beau.portee);
  });

  it('pluie : gouttes d’autant plus denses qu’elle est forte, ciel plus sombre et brume plus proche que couvert', () => {
    const couvert = ambiance(meteo({ ciel: 'couvert' }), PARIS, MIDI_ETE);
    const faible = ambiance(meteo({ ciel: 'couvert', precipitation: 'pluie', intensite: 0 }), PARIS, MIDI_ETE);
    const forte = ambiance(meteo({ ciel: 'couvert', precipitation: 'pluie', intensite: 2 }), PARIS, MIDI_ETE);
    expect(faible.precipitation?.sorte).toBe('pluie');
    expect(forte.precipitation!.densite).toBeGreaterThan(faible.precipitation!.densite);
    expect(luminance(forte.zenith)).toBeLessThan(luminance(couvert.zenith));
    expect(forte.portee).toBeLessThan(couvert.portee);
  });

  it('orage : pluie forte et éclairs', () => {
    const a = ambiance(meteo({ ciel: 'couvert', precipitation: 'orage', intensite: 2 }), PARIS, MIDI_ETE);
    expect(a.precipitation?.sorte).toBe('pluie');
    expect(a.eclairs).toBe(true);
  });

  it('neige : flocons', () => {
    const a = ambiance(meteo({ ciel: 'couvert', precipitation: 'neige', intensite: 1 }), PARIS, MIDI_ETE);
    expect(a.precipitation?.sorte).toBe('neige');
    expect(a.eclairs).toBe(false);
  });

  it('brouillard : la ville disparaît à courte distance', () => {
    const couvert = ambiance(meteo({ ciel: 'couvert' }), PARIS, MIDI_ETE);
    const brouillard = ambiance(meteo({ ciel: 'brouillard' }), PARIS, MIDI_ETE);
    expect(brouillard.portee).toBeLessThan(couvert.portee / 2);
  });

  it('la nuit : ciel sombre, décor assombri sans devenir illisible', () => {
    const jour = ambiance(meteo({ ciel: 'degage' }), PARIS, MIDI_ETE);
    const nuit = ambiance(meteo({ ciel: 'degage' }), PARIS, MINUIT_ETE);
    expect(nuit.nuit).toBe(true);
    expect(luminance(nuit.zenith)).toBeLessThan(0.15);
    expect(nuit.lumiere).toBeLessThan(jour.lumiere);
    expect(nuit.lumiere).toBeGreaterThanOrEqual(0.4);
  });

  it('au coucher du soleil par beau temps : horizon chaud (orangé)', () => {
    const { horizon } = ambiance(meteo({ ciel: 'degage' }), PARIS, COUCHER_ETE);
    const { r, b } = rgb(horizon);
    expect(r).toBeGreaterThan(b);
  });

  it('météo inconnue : ciel pâle de jour, sans précipitation', () => {
    const a = ambiance(undefined, PARIS, MIDI_ETE);
    expect(a.precipitation).toBeNull();
    expect(luminance(a.horizon)).toBeGreaterThan(0.6);
  });
});

describe('résumé de la météo pour la liste des manifs', () => {
  it.each([
    [meteo({ ciel: 'degage' }), 'Ensoleillé, 24 °C'],
    [meteo({ ciel: 'peu-nuageux', temperatureC: 18.6 }), 'Éclaircies, 19 °C'],
    [meteo({ ciel: 'couvert', temperatureC: -0.4 }), 'Couvert, 0 °C'],
    [meteo({ ciel: 'couvert', precipitation: 'pluie', intensite: 2, temperatureC: 9 }), 'Forte pluie, 9 °C'],
    [meteo({ ciel: 'couvert', precipitation: 'neige', intensite: 0, temperatureC: -2 }), 'Faible neige, −2 °C'],
    [meteo({ ciel: 'brouillard', temperatureC: 4 }), 'Brouillard, 4 °C'],
  ])('%o → %s', (m, texte) => {
    expect(resumeMeteo(m, PARIS, MIDI_ETE).texte).toBe(texte);
  });

  it('la nuit, un ciel dégagé se dit « Nuit claire »', () => {
    expect(resumeMeteo(meteo({ ciel: 'degage', temperatureC: 15 }), PARIS, MINUIT_ETE).texte).toBe('Nuit claire, 15 °C');
  });
});
