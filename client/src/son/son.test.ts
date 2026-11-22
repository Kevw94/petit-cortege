import { describe, expect, it } from 'vitest';
import { aleaDepuis, frequenceMidi } from './alea';
import { creerLimiteur, phaseAmbiance, reglagesAmbiance, tailleRessentie } from './ambiance';
import { MESURE_CHANT_S, MOTIFS_CHANT, programmeChant } from './chants';
import {
  CLASSES_PENTATONIQUES,
  creerPartitionAccueil,
  MESURE_ACCUEIL_S,
  MESURES_PAR_ACCORD,
  MESURES_PAR_PHRASE,
} from './partition-accueil';
import { lireSonActive, memoriserSonActive } from './preference';

describe('préférence de son', () => {
  const stockage = () => {
    const valeurs = new Map<string, string>();
    return {
      getItem: (cle: string) => valeurs.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
    };
  };

  it('son activé par défaut', () => {
    expect(lireSonActive(stockage())).toBe(true);
    expect(lireSonActive(undefined)).toBe(true);
  });

  it('relit le choix de couper le son, puis de le remettre', () => {
    const s = stockage();
    memoriserSonActive(false, s);
    expect(lireSonActive(s)).toBe(false);
    memoriserSonActive(true, s);
    expect(lireSonActive(s)).toBe(true);
  });

  it('sans stockage utilisable (navigation privée, stockage bloqué), rien ne casse et le son reste activé', () => {
    const casse = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => memoriserSonActive(false, casse)).not.toThrow();
    expect(lireSonActive(casse)).toBe(true);
  });
});

describe('tirage déterministe', () => {
  it('la même graine donne la même suite, entre 0 et 1', () => {
    const a = aleaDepuis(42);
    const b = aleaDepuis(42);
    const suite = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(suite);
    for (const x of suite) expect(x >= 0 && x < 1).toBe(true);
    expect(aleaDepuis(43)()).not.toBe(suite[0]);
  });

  it('la 440 Hz', () => {
    expect(frequenceMidi(69)).toBe(440);
    expect(frequenceMidi(57)).toBeCloseTo(220);
  });
});

describe('musique d’accueil', () => {
  const partition = creerPartitionAccueil(7);
  const mesures = Array.from({ length: 64 }, (_, n) => partition.mesure(n));

  it('est déterministe pour une graine donnée, et change avec la graine', () => {
    expect(creerPartitionAccueil(7).mesure(13)).toEqual(mesures[13]);
    const autre = creerPartitionAccueil(8);
    const signature = (p: typeof partition) => JSON.stringify(Array.from({ length: 8 }, (_, n) => p.mesure(n)));
    expect(signature(autre)).not.toBe(signature(partition));
  });

  it('l’arpège reste dans la gamme pentatonique, dans un registre doux', () => {
    for (const note of mesures.flat().filter((n) => n.voix === 'arpege')) {
      expect(CLASSES_PENTATONIQUES).toContain(note.note % 12);
      expect(note.note).toBeGreaterThanOrEqual(60);
      expect(note.note).toBeLessThanOrEqual(81);
    }
  });

  it('chaque note commence dans sa mesure, avec une force modérée', () => {
    for (const note of mesures.flat()) {
      expect(note.debut).toBeGreaterThanOrEqual(0);
      expect(note.debut).toBeLessThan(MESURE_ACCUEIL_S);
      expect(note.duree).toBeGreaterThan(0);
      expect(note.velocite).toBeGreaterThan(0);
      expect(note.velocite).toBeLessThanOrEqual(0.6);
    }
  });

  it('les accords sont tenus deux mesures et changent à chaque fois', () => {
    mesures.forEach((notes, n) => {
      const nappe = notes.filter((x) => x.voix === 'nappe');
      expect(nappe.length > 0).toBe(n % MESURES_PAR_ACCORD === 0);
    });
    for (let n = MESURES_PAR_ACCORD; n < 64; n += MESURES_PAR_ACCORD) {
      expect(partition.accord(n)).not.toBe(partition.accord(n - MESURES_PAR_ACCORD));
    }
  });

  it('sans répétition évidente : aucune phrase de huit mesures ne revient à l’identique', () => {
    const phrases = new Set<string>();
    for (let p = 0; p < 64 / MESURES_PAR_PHRASE; p++) {
      const arpege = mesures
        .slice(p * MESURES_PAR_PHRASE, (p + 1) * MESURES_PAR_PHRASE)
        .map((notes) => notes.filter((x) => x.voix === 'arpege').map((x) => `${x.debut.toFixed(2)}:${x.note}`));
      phrases.add(JSON.stringify(arpege));
    }
    expect(phrases.size).toBe(64 / MESURES_PAR_PHRASE);
    // Plusieurs minutes de musique : 64 mesures ≈ 3 min 53 s.
    expect(64 * MESURE_ACCUEIL_S).toBeGreaterThan(180);
  });

  it('une mesure hors limites ne joue rien', () => {
    expect(partition.mesure(-1)).toEqual([]);
    expect(partition.mesure(1.5)).toEqual([]);
  });
});

describe('chants', () => {
  it('au moins trois motifs, tous de rythmes différents', () => {
    expect(MOTIFS_CHANT.length).toBeGreaterThanOrEqual(3);
    const rythmes = MOTIFS_CHANT.map((m) =>
      JSON.stringify([m.appel.map((x) => x.croche), m.reponse.map((x) => x.croche)]),
    );
    expect(new Set(rythmes).size).toBe(MOTIFS_CHANT.length);
  });

  it('les motifs tournent d’un chant à l’autre', () => {
    const noms = Array.from({ length: MOTIFS_CHANT.length * 2 }, (_, i) => programmeChant(i).motif.nom);
    expect(new Set(noms.slice(0, MOTIFS_CHANT.length)).size).toBe(MOTIFS_CHANT.length);
    expect(noms.slice(MOTIFS_CHANT.length)).toEqual(noms.slice(0, MOTIFS_CHANT.length));
  });

  it('dure de 8 à 12 secondes, événements triés dans cette durée', () => {
    for (let i = 0; i < 8; i++) {
      const { duree, evenements } = programmeChant(i);
      expect(duree).toBeGreaterThanOrEqual(8);
      expect(duree).toBeLessThanOrEqual(12);
      const instants = evenements.map((e) => e.t);
      expect(instants).toEqual([...instants].sort((a, b) => a - b));
      for (const t of instants) expect(t >= 0 && t < duree).toBe(true);
    }
  });

  it('appel puis réponse, sans paroles : seulement les voyelles « hé » et « ho », un tambour et des mains', () => {
    const { evenements } = programmeChant(2);
    const types = new Set(evenements.map((e) => e.type));
    expect([...types].sort()).toEqual(['mains', 'tambour', 'voix']);
    const voyelles = evenements.flatMap((e) =>
      e.type === 'voix' ? [{ v: e.voyelle, mesure: Math.floor(e.t / MESURE_CHANT_S) }] : [],
    );
    expect(voyelles.length).toBeGreaterThan(0);
    for (const { v, mesure } of voyelles) expect(v).toBe(mesure % 2 === 1 ? 'he' : 'ho');
    // Rien avant la fin de l'introduction au tambour.
    expect(Math.min(...voyelles.map((x) => x.mesure))).toBe(1);
  });

  it('le slogan pulse sur l’introduction puis sur chaque syllabe', () => {
    const { evenements, pulsations } = programmeChant(1);
    const syllabes = evenements.filter((e) => e.type === 'voix').map((e) => e.t);
    const apresIntro = pulsations.filter((p) => p.t >= MESURE_CHANT_S).map((p) => p.t);
    expect(apresIntro).toEqual(syllabes);
    expect(pulsations.filter((p) => p.t < MESURE_CHANT_S)).toHaveLength(4);
    expect(pulsations.some((p) => p.fort)).toBe(true);
  });
});

describe('ambiance de manif', () => {
  it('phase : avant le départ, en marche, après la fin', () => {
    expect(phaseAmbiance('ouverte', 1_000, 500)).toBe('avant');
    expect(phaseAmbiance('ouverte', 1_000, 1_000)).toBe('marche');
    expect(phaseAmbiance('terminee', 1_000, 500)).toBe('fin');
  });

  it('la taille ressentie croît avec les soutiens, de 0 à 1', () => {
    expect(tailleRessentie(0)).toBe(0);
    expect(tailleRessentie(-3)).toBe(0);
    expect(tailleRessentie(Number.NaN)).toBe(0);
    expect(tailleRessentie(10)).toBeLessThan(tailleRessentie(100));
    expect(tailleRessentie(100)).toBeLessThan(tailleRessentie(1_000));
    expect(tailleRessentie(1_000_000)).toBe(1);
  });

  it('plus de soutiens : rumeur de foule et brouhaha plus forts, plus de pas', () => {
    for (const phase of ['avant', 'marche'] as const) {
      const peu = reglagesAmbiance({ soutiens: 5, phase });
      const beaucoup = reglagesAmbiance({ soutiens: 3_000, phase });
      expect(beaucoup.foule).toBeGreaterThan(peu.foule);
      expect(beaucoup.brouhaha).toBeGreaterThan(peu.brouhaha);
      expect(beaucoup.pasParSeconde).toBeGreaterThan(peu.pasParSeconde);
      expect(beaucoup.coupureHz).toBeGreaterThan(peu.coupureHz);
    }
  });

  it('avant le départ, un murmure calme : moins dense qu’en marche, sans percussions', () => {
    for (const soutiens of [0, 50, 2_000, 100_000]) {
      const avant = reglagesAmbiance({ soutiens, phase: 'avant' });
      const marche = reglagesAmbiance({ soutiens, phase: 'marche' });
      expect(avant.percussions).toBe(0);
      expect(marche.percussions).toBeGreaterThan(0);
      expect(avant.brouhaha).toBeLessThan(marche.brouhaha);
      expect(avant.pasParSeconde).toBeLessThan(marche.pasParSeconde);
      expect(avant.evenementsParMinute).toBeLessThan(marche.evenementsParMinute);
    }
  });

  it('volumes toujours entre 0 et 1', () => {
    for (const phase of ['avant', 'marche', 'fin'] as const) {
      for (const soutiens of [0, 1, 10_000_000]) {
        const r = reglagesAmbiance({ soutiens, phase });
        for (const v of [r.foule, r.brouhaha, r.percussions]) expect(v >= 0 && v <= 1).toBe(true);
      }
    }
  });

  it('limiteur : au plus une mise à jour par seconde, quel que soit le nombre d’images', () => {
    const limiter = creerLimiteur(1_000);
    const acceptees = Array.from({ length: 300 }, (_, i) => i * 16.7).filter((t) => limiter(t));
    // 300 images à 60 i/s ≈ 5 s : cinq mises à jour, espacées d'au moins une seconde.
    expect(acceptees).toHaveLength(5);
    for (let i = 1; i < acceptees.length; i++) expect(acceptees[i]! - acceptees[i - 1]!).toBeGreaterThanOrEqual(1_000);
  });
});
