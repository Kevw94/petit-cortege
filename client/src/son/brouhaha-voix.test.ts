import { describe, expect, it } from 'vitest';
import { reglagesAmbiance } from './ambiance';
import {
  creerLocuteur,
  ESPACE_MAX_S,
  F0_MAX_HZ,
  F0_MIN_HZ,
  FORMANT_MAX_HZ,
  FORMANT_MIN_HZ,
  gainsLocuteurs,
  LOCUTEURS_MAX,
  nombreLocuteurs,
  PHRASE_MAX_S,
  PHRASE_MIN_S,
  profilsLocuteurs,
  SILENCE_MAX_S,
  SILENCE_MIN_S,
  SYLLABE_MAX_S,
  SYLLABE_MIN_S,
  type PhraseVoix,
} from './brouhaha-voix';

const phrases = (graine: number, indice: number, n: number): PhraseVoix[] => {
  const l = creerLocuteur(graine, indice);
  return Array.from({ length: n }, () => l.phraseSuivante());
};

describe('brouhaha de voix inintelligibles', () => {
  it('déterministe pour une graine, différent d’une graine ou d’un locuteur à l’autre', () => {
    expect(phrases(42, 3, 20)).toEqual(phrases(42, 3, 20));
    expect(phrases(42, 3, 5)).not.toEqual(phrases(43, 3, 5));
    expect(phrases(42, 3, 5)).not.toEqual(phrases(42, 4, 5));
  });

  it('durées de syllabes, de phrases et de silences dans les bornes', () => {
    for (let i = 0; i < LOCUTEURS_MAX; i++) {
      for (const p of phrases(7, i, 200)) {
        expect(p.silenceAvant).toBeGreaterThanOrEqual(SILENCE_MIN_S);
        expect(p.silenceAvant).toBeLessThanOrEqual(SILENCE_MAX_S);
        expect(p.duree).toBeGreaterThanOrEqual(PHRASE_MIN_S);
        expect(p.duree).toBeLessThanOrEqual(PHRASE_MAX_S);
        let fin = 0;
        for (const s of p.syllabes) {
          expect(s.duree).toBeGreaterThanOrEqual(SYLLABE_MIN_S);
          expect(s.duree).toBeLessThanOrEqual(SYLLABE_MAX_S);
          expect(s.debut - fin).toBeGreaterThanOrEqual(-1e-9);
          expect(s.debut - fin).toBeLessThanOrEqual(ESPACE_MAX_S + 1e-9);
          fin = s.debut + s.duree;
        }
        expect(p.duree).toBeCloseTo(fin, 9);
      }
    }
  });

  it('hauteurs et formants dans les bornes, consonnes brèves', () => {
    for (let i = 0; i < LOCUTEURS_MAX; i++) {
      for (const p of phrases(11, i, 100)) {
        for (const s of p.syllabes) {
          for (const f of s.f0) expect(f >= F0_MIN_HZ && f <= F0_MAX_HZ).toBe(true);
          for (const fs of s.formants) {
            fs.forEach((f, k) => expect(f >= FORMANT_MIN_HZ[k]! && f <= FORMANT_MAX_HZ[k]!).toBe(true));
          }
          expect(s.niveau > 0 && s.niveau <= 1).toBe(true);
          if (s.consonne) {
            expect(s.consonne.duree).toBeLessThan(0.1);
            expect(s.consonne.niveau).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('la hauteur descend en fin de phrase', () => {
    const ps = phrases(5, 2, 200);
    const baisse = ps.filter((p) => p.syllabes[p.syllabes.length - 1]!.f0[1] < p.syllabes[0]!.f0[0]);
    expect(baisse.length / ps.length).toBeGreaterThan(0.95);
  });

  it('voix graves et aiguës, réparties dans l’espace stéréo', () => {
    const profils = profilsLocuteurs(9);
    const hauteurs = profils.map((p) => p.hauteurHz);
    expect(Math.min(...hauteurs)).toBeLessThan(130);
    expect(Math.max(...hauteurs)).toBeGreaterThan(190);
    expect(profils.some((p) => p.pan < -0.3) && profils.some((p) => p.pan > 0.3)).toBe(true);
    for (const p of profils) expect(Math.abs(p.pan)).toBeLessThanOrEqual(1);
  });

  it('aucune périodicité stricte : durées, silences et rythmes irréguliers', () => {
    const ps = phrases(3, 1, 100);
    const durees = ps.flatMap((p) => p.syllabes.map((s) => s.duree));
    const moy = durees.reduce((a, b) => a + b, 0) / durees.length;
    const ecart = Math.sqrt(durees.reduce((a, b) => a + (b - moy) ** 2, 0) / durees.length);
    expect(ecart / moy).toBeGreaterThan(0.2);
    expect(new Set(durees.map((d) => d.toFixed(4))).size).toBeGreaterThan(durees.length * 0.6);
    expect(new Set(ps.map((p) => p.silenceAvant.toFixed(3))).size).toBeGreaterThan(60);
    expect(new Set(ps.map((p) => p.syllabes.length)).size).toBeGreaterThan(3);
    expect(new Set(ps.map((p) => p.duree.toFixed(2))).size).toBeGreaterThan(50);
    const rythmes = ps.map((p) => p.syllabes.map((s) => s.duree.toFixed(3)).join());
    expect(new Set(rythmes).size).toBe(ps.length);
  });

  it('nombre de locuteurs et gains selon les réglages d’ambiance', () => {
    const profils = profilsLocuteurs(1);
    for (const phase of ['avant', 'marche', 'fin'] as const) {
      let precedent = 0;
      for (const soutiens of [0, 5, 100, 1_000, 5_000, 1_000_000]) {
        const r = reglagesAmbiance({ soutiens, phase });
        const n = nombreLocuteurs(r);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(LOCUTEURS_MAX);
        expect(n).toBeGreaterThanOrEqual(precedent);
        precedent = n;
        const gains = gainsLocuteurs(r, profils);
        expect(gains.filter((g) => g > 0)).toHaveLength(n);
        for (const g of gains) expect(g >= 0 && g <= 1).toBe(true);
      }
    }
    expect(nombreLocuteurs(reglagesAmbiance({ soutiens: 3, phase: 'marche' }))).toBeLessThanOrEqual(2);
    expect(nombreLocuteurs(reglagesAmbiance({ soutiens: 1_000_000, phase: 'marche' }))).toBe(LOCUTEURS_MAX);
    expect(nombreLocuteurs(reglagesAmbiance({ soutiens: 0, phase: 'avant' }))).toBe(1);
    expect(nombreLocuteurs({ voix: 1, locuteurs: Number.NaN })).toBe(0);
    expect(nombreLocuteurs({ voix: 1, locuteurs: 99 })).toBe(LOCUTEURS_MAX);
  });

  it('plus de soutiens : plus de voix et un niveau plus haut, sans dépasser le brouhaha', () => {
    for (const phase of ['avant', 'marche'] as const) {
      const peu = reglagesAmbiance({ soutiens: 5, phase });
      const beaucoup = reglagesAmbiance({ soutiens: 3_000, phase });
      expect(beaucoup.locuteurs).toBeGreaterThan(peu.locuteurs);
      expect(beaucoup.voix).toBeGreaterThan(peu.voix);
      expect(beaucoup.voix).toBeLessThanOrEqual(beaucoup.brouhaha + 0.1);
    }
  });
});
