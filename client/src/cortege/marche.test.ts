import { describe, expect, it } from 'vitest';
import { LONGUEUR_TRONCON_M } from './foule';
import {
  allureDeMarche,
  allureImmobile,
  CADENCE_PAS_PAR_S,
  DECALAGE_MAX_PX_ATLAS,
  INCLINAISON_MAX_RAD,
  marquerTronconsEnMarche,
  METRES_PAR_PX_ATLAS,
  phaseDeMarche,
  phaseDeTampon,
  SAUT_PX_ATLAS,
  sautDeMasse,
  tronconEnMarche,
} from './marche';

/** Échantillonne l'allure d'un avatar sur `duree` secondes, toutes les `pas` secondes. */
function echantillons(phase: number, enMarche: boolean, duree = 3, pas = 1 / 60) {
  const sortie = allureImmobile();
  const resultat: ReturnType<typeof allureImmobile>[] = [];
  for (let t = 0; t <= duree; t += pas) resultat.push({ ...allureDeMarche(sortie, 1000 + t, phase, enMarche) });
  return resultat;
}

describe('Marche : phase propre à chaque avatar', () => {
  it('est déterministe et dans [0, 1[', () => {
    expect(phaseDeMarche('av-1')).toBe(phaseDeMarche('av-1'));
    for (const id of ['av-1', 'av-2', 'x', '']) {
      expect(phaseDeMarche(id)).toBeGreaterThanOrEqual(0);
      expect(phaseDeMarche(id)).toBeLessThan(1);
    }
  });

  it('varie d’un identifiant voisin à l’autre : la foule ne sautille pas à l’unisson', () => {
    const phases = Array.from({ length: 200 }, (_, i) => phaseDeMarche(`av-${i}`));
    // Réparties sur les quatre quarts du pas.
    for (let q = 0; q < 4; q++) expect(phases.filter((p) => Math.floor(p * 4) === q).length).toBeGreaterThan(25);
  });

  it('les tampons de masse ont aussi une phase stable et variée', () => {
    expect(phaseDeTampon(12.5, -3)).toBe(phaseDeTampon(12.5, -3));
    const phases = Array.from({ length: 100 }, (_, i) => phaseDeTampon(i * 2.5, (i % 4) - 2));
    expect(new Set(phases.map((p) => Math.floor(p * 4))).size).toBe(4);
  });
});

describe('Marche : allure d’un avatar qui avance', () => {
  const allures = echantillons(0.3, true);

  it('sautille d’un pixel de l’atlas, calé sur le pixel (2D) ou continu (3D)', () => {
    expect(new Set(allures.map((a) => a.sautPxAtlas))).toEqual(new Set([0, SAUT_PX_ATLAS]));
    expect(Math.max(...allures.map((a) => a.sautM))).toBeCloseTo(METRES_PAR_PX_ATLAS, 2);
    expect(Math.min(...allures.map((a) => a.sautM))).toBeGreaterThanOrEqual(0);
    expect(METRES_PAR_PX_ATLAS).toBe(0.125);
  });

  it('en l’air la moitié du temps environ', () => {
    const enLAir = allures.filter((a) => a.sautPxAtlas > 0).length / allures.length;
    expect(enLAir).toBeGreaterThan(0.4);
    expect(enLAir).toBeLessThan(0.6);
  });

  it('à une cadence de marche lente (1,5 à 2 pas par seconde)', () => {
    expect(CADENCE_PAS_PAR_S).toBeGreaterThanOrEqual(1.5);
    expect(CADENCE_PAS_PAR_S).toBeLessThanOrEqual(2);
    // Un saut par pas : compte les décollages sur 10 s.
    const longues = echantillons(0.3, true, 10, 1 / 120);
    let decollages = 0;
    for (let i = 1; i < longues.length; i++) if (longues[i]!.sautPxAtlas > longues[i - 1]!.sautPxAtlas) decollages++;
    expect(decollages).toBeGreaterThanOrEqual(Math.floor(10 * CADENCE_PAS_PAR_S) - 1);
    expect(decollages).toBeLessThanOrEqual(Math.ceil(10 * CADENCE_PAS_PAR_S) + 1);
  });

  it('se balance de quelques degrés à gauche puis à droite, par demi-pixel en 2D', () => {
    const inclinaisons = allures.map((a) => a.inclinaisonRad);
    expect(Math.max(...inclinaisons)).toBeCloseTo(INCLINAISON_MAX_RAD, 2);
    expect(Math.min(...inclinaisons)).toBeCloseTo(-INCLINAISON_MAX_RAD, 2);
    expect((INCLINAISON_MAX_RAD * 180) / Math.PI).toBeLessThanOrEqual(5);
    expect(new Set(allures.map((a) => a.decalagePxAtlas))).toEqual(
      new Set([-DECALAGE_MAX_PX_ATLAS, 0, DECALAGE_MAX_PX_ATLAS]),
    );
  });

  it('la pancarte suit avec un petit retard', () => {
    const sortie = allureImmobile();
    // Quand le corps passe au plus penché, la pancarte n'y est pas encore.
    const pas = 0.5; // sin(π·½) = 1 : corps au plus penché
    const t = (pas - 0.3) / CADENCE_PAS_PAR_S;
    allureDeMarche(sortie, t, 0.3, true);
    expect(sortie.inclinaisonRad).toBeCloseTo(INCLINAISON_MAX_RAD, 6);
    const pancarteMaintenant = sortie.inclinaisonPancarteRad;
    allureDeMarche(sortie, t + 0.1, 0.3, true);
    expect(sortie.inclinaisonPancarteRad).toBeGreaterThan(pancarteMaintenant);
  });

  it('deux avatars de phases différentes ne sautent pas en même temps', () => {
    const a = echantillons(phaseDeMarche('av-1'), true);
    const b = echantillons(phaseDeMarche('av-7'), true);
    expect(a.some((x, i) => x.sautPxAtlas !== b[i]!.sautPxAtlas)).toBe(true);
  });
});

describe('Marche : immobile quand l’avatar n’avance pas', () => {
  it('aucun décalage, à tout instant', () => {
    for (const a of echantillons(0.3, false)) expect(a).toEqual(allureImmobile());
  });

  it('remet à zéro un objet réutilisé (aucune allocation par avatar)', () => {
    const sortie = allureImmobile();
    allureDeMarche(sortie, 0.15, 0, true);
    expect(sortie.sautM).toBeGreaterThan(0);
    expect(allureDeMarche(sortie, 0.15, 0, false)).toBe(sortie);
    expect(sortie).toEqual(allureImmobile());
  });

  it('la masse de foule n’ondule pas là où personne n’avance', () => {
    for (let t = 0; t < 2; t += 0.05) expect(sautDeMasse(t, 0.4, false)).toBe(0);
    const valeurs = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) valeurs.add(sautDeMasse(t, 0.4, true));
    expect(valeurs).toEqual(new Set([0, SAUT_PX_ATLAS]));
  });
});

describe('Marche : tronçons de foule en marche', () => {
  it('marque les tronçons où au moins un avatar avance, dans le repère qui avance', () => {
    const repereM = 100;
    const sortie = new Set<number>([42]);
    marquerTronconsEnMarche(
      [
        { distanceM: 105, enMarche: true },
        { distanceM: 70, enMarche: false },
        { distanceM: 100 - LONGUEUR_TRONCON_M + 1, enMarche: true },
      ],
      repereM,
      sortie,
    );
    expect([...sortie].sort()).toEqual([-1, 0]);
    expect(tronconEnMarche(sortie, 110, repereM)).toBe(true);
    expect(tronconEnMarche(sortie, 70, repereM)).toBe(false);
  });
});
