import { describe, expect, it } from 'vitest';
import { reglagesAmbiance } from './ambiance';
import {
  creerLocuteur,
  ESPACE_GROUPE_MAX_S,
  ESPACE_MAX_S,
  F0_MAX_HZ,
  F0_MIN_HZ,
  FORMANT_MAX_HZ,
  FORMANT_MIN_HZ,
  gainsLocuteurs,
  LOCUTEURS_MAX,
  LOCUTEURS_PROCHES,
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

const phrases = (graine: number, indice: number, n: number, expressif = true): PhraseVoix[] => {
  const l = creerLocuteur(graine, indice, { expressif });
  return Array.from({ length: n }, () => l.phraseSuivante());
};

/** Beaucoup de phrases, de tous les locuteurs : pour les proportions. */
const corpus = (graine: number, parLocuteur: number, expressif = true) =>
  Array.from({ length: LOCUTEURS_MAX }, (_, i) => phrases(graine, i, parLocuteur, expressif)).flat();

const derniere = (p: PhraseVoix) => p.syllabes[p.syllabes.length - 1]!;

describe('brouhaha de voix inintelligibles', () => {
  it('déterministe pour une graine, différent d’une graine ou d’un locuteur à l’autre', () => {
    expect(phrases(42, 3, 20)).toEqual(phrases(42, 3, 20));
    expect(phrases(42, 3, 5)).not.toEqual(phrases(43, 3, 5));
    expect(phrases(42, 3, 5)).not.toEqual(phrases(42, 4, 5));
  });

  it('durées de syllabes, de phrases, d’espaces et de silences dans les bornes', () => {
    for (const p of corpus(7, 200)) {
      expect(p.silenceAvant).toBeGreaterThanOrEqual(SILENCE_MIN_S);
      expect(p.silenceAvant).toBeLessThanOrEqual(SILENCE_MAX_S);
      expect(p.duree).toBeGreaterThanOrEqual(PHRASE_MIN_S - 1e-9);
      expect(p.duree).toBeLessThanOrEqual(PHRASE_MAX_S);
      let fin = 0;
      p.syllabes.forEach((s, i) => {
        expect(s.duree).toBeGreaterThanOrEqual(SYLLABE_MIN_S);
        expect(s.duree).toBeLessThanOrEqual(SYLLABE_MAX_S);
        // La consonne d'attaque laisse toujours entendre la voyelle.
        expect(s.transition).toBeGreaterThanOrEqual(0);
        expect(s.transition).toBeLessThanOrEqual(s.duree * 0.4 + 1e-9);
        const espace = s.debut - fin;
        expect(espace).toBeGreaterThanOrEqual(-1e-9);
        expect(espace).toBeLessThanOrEqual(ESPACE_MAX_S + 1e-9);
        // Dans un groupe rythmique, la voix est liée (sauf dans un rire, fait de souffles détachés).
        if (i > 0 && !p.syllabes[i - 1]!.finDeGroupe && p.genre !== 'rire') {
          expect(espace).toBeLessThanOrEqual(ESPACE_GROUPE_MAX_S + 1e-9);
        }
        fin = s.debut + s.duree;
      });
      expect(p.duree).toBeCloseTo(fin, 9);
      expect(derniere(p).finDeGroupe).toBe(true);
    }
  });

  it('hauteurs et formants dans les bornes, consonnes brèves', () => {
    for (const p of corpus(11, 100)) {
      for (const s of p.syllabes) {
        for (const f of s.f0) expect(f >= F0_MIN_HZ && f <= F0_MAX_HZ).toBe(true);
        for (const fs of s.formants) {
          fs.forEach((f, k) => expect(f >= FORMANT_MIN_HZ[k]! && f <= FORMANT_MAX_HZ[k]!).toBe(true));
        }
        expect(s.niveau > 0 && s.niveau <= 1).toBe(true);
        if (s.attaque === 'voyelle') expect(s.consonne).toBeNull();
        if (s.consonne) {
          expect(s.consonne.duree).toBeLessThan(0.1);
          expect(s.consonne.niveau).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('prosodie : l’affirmation tombe, la question remonte, les groupes non finals montent (continuation)', () => {
    const ps = corpus(5, 150).filter((p) => p.genre !== 'rire');
    for (const p of ps) {
      const fin = derniere(p);
      if (p.genre === 'parole') {
        expect(fin.f0[1]).toBeLessThan(fin.f0[0]);
        expect(fin.f0[1]).toBeLessThan(p.syllabes[0]!.f0[0]);
      } else {
        expect(fin.f0[1]).toBeGreaterThan(fin.f0[0]);
      }
      // Fin d'un groupe rythmique qui n'est pas le dernier : la voix monte (sauf l'hésitation).
      p.syllabes.forEach((s, i) => {
        const hesitation = p.hesitation && i === 0;
        if (s.finDeGroupe && s !== fin && !hesitation) expect(s.f0[1]).toBeGreaterThan(s.f0[0]);
      });
    }
  });

  it('accent final : la dernière syllabe d’un groupe est allongée', () => {
    const ps = corpus(13, 150).filter((p) => p.genre !== 'rire');
    const durees = (finale: boolean) =>
      ps.flatMap((p) => p.syllabes.filter((s, i) => s.finDeGroupe === finale && !(p.hesitation && i === 0)));
    const moyenne = (xs: { duree: number }[]) => xs.reduce((a, s) => a + s.duree, 0) / xs.length;
    expect(moyenne(durees(true))).toBeGreaterThan(1.3 * moyenne(durees(false)));
  });

  it('des affirmations surtout, quelques questions, hésitations et rires chez les expressifs ; ni rire ni hésitation sinon', () => {
    const ps = corpus(17, 300);
    const part = (filtre: (p: PhraseVoix) => boolean) => ps.filter(filtre).length / ps.length;
    expect(part((p) => p.genre === 'parole')).toBeGreaterThan(0.7);
    expect(part((p) => p.genre === 'question')).toBeGreaterThan(0.06);
    expect(part((p) => p.genre === 'question')).toBeLessThan(0.22);
    expect(part((p) => p.hesitation)).toBeGreaterThan(0.02);
    expect(part((p) => p.hesitation)).toBeLessThan(0.12);
    expect(part((p) => p.genre === 'rire')).toBeGreaterThan(0.01);
    expect(part((p) => p.genre === 'rire')).toBeLessThan(0.07);
    const sobres = corpus(17, 300, false);
    expect(sobres.some((p) => p.genre === 'rire' || p.hesitation)).toBe(false);
  });

  it('un rire : des « ha » aspirés, plus aigus que la voix, qui descendent et s’éteignent', () => {
    const profils = profilsLocuteurs(19);
    const rires = Array.from({ length: LOCUTEURS_MAX }, (_, i) =>
      phrases(19, i, 400)
        .filter((p) => p.genre === 'rire')
        .map((p) => ({ p, profil: profils[i]! })),
    ).flat();
    expect(rires.length).toBeGreaterThan(10);
    for (const { p, profil } of rires) {
      expect(p.syllabes.length).toBeGreaterThanOrEqual(3);
      expect(p.syllabes.length).toBeLessThanOrEqual(7);
      for (const s of p.syllabes) expect(s.consonne?.type).toBe('aspiree');
      expect(p.syllabes[0]!.f0[0]).toBeGreaterThan(Math.min(F0_MAX_HZ - 1, profil.hauteurHz * 1.2));
      expect(derniere(p).f0[1]).toBeLessThan(p.syllabes[0]!.f0[0]);
      expect(derniere(p).niveau).toBeLessThan(p.syllabes[0]!.niveau);
    }
  });

  it('attaques variées : voyelles liées, consonnes voisées et sourdes', () => {
    const syllabes = corpus(23, 100).flatMap((p) => p.syllabes);
    const part = (a: string) => syllabes.filter((s) => s.attaque === a).length / syllabes.length;
    for (const a of ['voyelle', 'voisee', 'sourde']) expect(part(a)).toBeGreaterThan(0.12);
    // Une sourde coupe la voix : toujours un bruit (souffle, explosion ou aspiration).
    for (const s of syllabes.filter((x) => x.attaque === 'sourde')) expect(s.consonne).not.toBeNull();
  });

  it('voix graves et aiguës, réparties dans l’espace stéréo ; les premières sont proches', () => {
    const profils = profilsLocuteurs(9);
    const hauteurs = profils.map((p) => p.hauteurHz);
    expect(Math.min(...hauteurs)).toBeLessThan(130);
    expect(Math.max(...hauteurs)).toBeGreaterThan(190);
    expect(profils.some((p) => p.pan < -0.3) && profils.some((p) => p.pan > 0.3)).toBe(true);
    for (const p of profils) {
      expect(Math.abs(p.pan)).toBeLessThanOrEqual(1);
      expect(p.souffle > 0 && p.souffle < 0.2).toBe(true);
    }
    const proches = profils.slice(0, LOCUTEURS_PROCHES);
    const lointains = profils.slice(LOCUTEURS_PROCHES);
    for (const p of proches) expect(p.plan).toBe('proche');
    for (const p of lointains) expect(p.plan).toBe('lointain');
    expect(Math.min(...proches.map((p) => p.poids))).toBeGreaterThan(Math.max(...lointains.map((p) => p.poids)));
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
