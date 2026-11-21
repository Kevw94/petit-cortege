import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireListeManifs, type EntreePubliee, type EntreesMinute } from '@petit-cortege/shared';
import { calculerCortege } from './cortege';
import { composerFoule } from './foule';

const FIXTURES = join(import.meta.dirname, '../../../fixtures/publication/manif-pre-remplie');
const manif = lireListeManifs(JSON.parse(readFileSync(join(FIXTURES, 'manifs.json'), 'utf8'))).manifs.find(
  (m) => m.id === 'manif-a',
)!;
const maintenant = new Date('2026-05-01T14:20:00Z');

function entree(a: string, iso: string): EntreePubliee {
  return { a, m: 'manif-a', t: Date.parse(iso) / 1000, ap: 0, pa: 0 };
}
function fichier(entrees: EntreePubliee[]): EntreesMinute {
  return { v: 1, minute: '2026-05-01T13:58:00.000Z', entrees };
}

/** 40 avatars entrés avant le départ : 8 rangées de 5 de front tous les 2 m (1 par tuile). */
const avantLeDepart = Array.from({ length: 40 }, (_, i) => entree(`tot-${i}`, '2026-05-01T13:58:00Z'));

/** Retardataires : 25 avatars par seconde pendant 20 s, rangés à la queue du cortège. */
function vague(prefixe: string, parSeconde = 25, secondes = 20): EntreePubliee[] {
  return Array.from({ length: parSeconde * secondes }, (_, i) =>
    entree(`${prefixe}-${i}`, `2026-05-01T14:05:${String(10 + Math.floor(i / parSeconde)).padStart(2, '0')}Z`),
  );
}

/**
 * Foule plus serrée qu'un avatar par tuile, placée directement (le Cortège range ses avatars
 * à un par tuile ; la masse sert au-delà, ex. au point d'arrivée de l'image finale) :
 * `n` avatars sur un tronçon de 20 m (50 tuiles).
 */
const serree = (n: number, prefixe = 's') =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefixe}-${i}`, distanceM: 100 + (i % 40) / 2, propre: false }));

const cortegeDe = (entrees: EntreePubliee[], propres: EntreePubliee[] = [], retraits: string[] = []) =>
  calculerCortege({ manif, entrees: [fichier(entrees)], propres, retraits, maintenant }).avatars;
const idsDessines = <A extends { id: string; distanceM: number; propre: boolean }>(avatars: readonly A[]) =>
  new Set(composerFoule(avatars).dessines.map((a) => a.id));

describe('Cortège : masse de foule', () => {
  it("jusqu'à un avatar par tuile, tout le monde est dessiné, sans masse", () => {
    const foule = composerFoule(cortegeDe(avantLeDepart));

    expect(foule.dessines).toHaveLength(40);
    expect(foule.troncons.some((t) => t.enMasse)).toBe(false);
    expect(foule.enMasse).toBe(0);
  });

  it('le Cortège ne dépasse jamais un avatar par tuile, même quand une vague de retardataires arrive', () => {
    const foule = composerFoule(cortegeDe([...avantLeDepart, ...vague('v')]));

    expect(foule.troncons.every((t) => !t.enMasse && t.densite <= 1)).toBe(true);
    expect(foule.dessines).toHaveLength(540);
  });

  it("au-delà d'un avatar par tuile, le tronçon passe en masse et seuls quelques avatars restent dessinés", () => {
    const foule = composerFoule(serree(500));

    expect(foule.troncons.some((t) => t.enMasse && t.densite > 1)).toBe(true);
    // Premier plan clairsemé : ni personne, ni tout le monde.
    expect(foule.dessines.length).toBeGreaterThan(0);
    expect(foule.dessines.length).toBeLessThan(500 / 8);
    expect(foule.dessines.length + foule.enMasse).toBe(500);
  });

  it('plus la foule est serrée, plus le premier plan est clairsemé : il ne devient jamais plus dense que hors masse', () => {
    const dessinesParTuile = (n: number) => composerFoule(serree(n)).dessines.length / 50;

    expect(dessinesParTuile(200)).toBeGreaterThan(0.1);
    expect(dessinesParTuile(200)).toBeLessThanOrEqual(0.6);
    expect(dessinesParTuile(2000)).toBeGreaterThan(0.1);
    expect(dessinesParTuile(2000)).toBeLessThanOrEqual(0.6);
  });

  it('même entrée, même sortie : le tirage ne dépend pas de l’ordre des avatars', () => {
    const avatars = serree(500);

    expect([...idsDessines([...avatars].reverse())].sort()).toEqual([...idsDessines(avatars)].sort());
  });

  it("le tirage est stable quand des avatars arrivent : personne d'autre n'apparaît ni ne disparaît", () => {
    const avant = idsDessines(serree(500));
    for (const n of [1, 3, 5]) {
      const apres = idsDessines([...serree(500), ...serree(n, 'nouveau')]);

      expect(new Set([...apres].filter((id) => !id.startsWith('nouveau')))).toEqual(avant);
    }
  });

  it('une vague qui serre beaucoup la foule éclaircit le premier plan sans le rebattre', () => {
    const avant = idsDessines(serree(500));
    const apres = idsDessines([...serree(500), ...serree(1000, 'nouveau')]);

    const anciensApres = [...apres].filter((id) => !id.startsWith('nouveau'));
    expect(anciensApres.every((id) => avant.has(id))).toBe(true);
    expect(apres.size).toBeGreaterThan(0);
  });

  it('le tirage est stable quand des avatars partent : les autres gardent leur place au premier plan ou dans la masse', () => {
    // Foule serrée sur un tronçon (400 avatars sur 20 m), placée directement.
    const tous = serree(400);
    const avant = idsDessines(tous);
    const restants = tous.filter((_, i) => i % 10 !== 0);
    const apres = idsDessines(restants);

    expect(apres).toEqual(new Set([...avant].filter((id) => restants.some((a) => a.id === id))));
    expect(apres.size).toBeGreaterThan(0);
  });

  it('pendant la marche, les mêmes avatars restent au premier plan (pas de clignotement)', () => {
    const entrees = [...avantLeDepart, ...vague('v')];
    const a = (iso: string) => {
      const cortege = calculerCortege({ manif, entrees: [fichier(entrees)], maintenant: new Date(iso) });
      const foule = composerFoule(cortege.avatars, { repereM: cortege.avanceeM, budget: 100 });
      return new Set(foule.dessines.map((x) => x.id));
    };

    for (const minute of ['14:12', '14:14', '14:16', '14:18']) {
      for (const seconde of ['00', '11', '23', '37', '49']) {
        expect(a(`2026-05-01T${minute}:${seconde}Z`)).toEqual(a('2026-05-01T14:20:00Z'));
      }
    }
  });

  it('ses propres avatars sont toujours dessinés, même au cœur de la masse', () => {
    const tous = serree(500);
    const nonTire = tous.find((a) => !idsDessines(tous).has(a.id))!;
    const foule = composerFoule(tous.map((a) => (a === nonTire ? { ...a, propre: true } : a)));

    expect(foule.troncons.some((t) => t.enMasse)).toBe(true);
    expect(foule.dessines.find((a) => a.id === nonTire.id)?.propre).toBe(true);
  });
});

describe('Cortège : budget d’avatars dessinés', () => {
  /** 5 000 avatars clairsemés (un par tuile, rangées de 5 tous les 2 m) : aucune masse due à la densité. */
  const etendue = (n: number, prefixe = 'e', departM = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefixe}-${i}`,
      distanceM: departM - Math.floor(i / 5) * 2,
      propre: false,
    }));

  it('au-delà du budget, seuls les avatars tirés sont dessinés et tout le reste passe en masse', () => {
    const foule = composerFoule(etendue(5000), { budget: 2000 });

    expect(foule.dessines.length).toBeLessThanOrEqual(2000);
    expect(foule.dessines.length).toBeGreaterThan(500);
    expect(foule.troncons.every((t) => t.enMasse)).toBe(true);
  });

  it('sous le budget, rien ne change', () => {
    expect(composerFoule(etendue(1500), { budget: 2000 }).dessines).toHaveLength(1500);
  });

  it("le budget ne compte que les avatars à l'écran, mais la densité se mesure sur tout le cortège", () => {
    const tous = etendue(5000);
    const aLEcran = (a: { distanceM: number }) => a.distanceM > -400; // 1 000 avatars
    const foule = composerFoule(tous, { budget: 2000, visible: aLEcran });

    expect(foule.dessines).toHaveLength(1000);
    expect(foule.dessines.every(aLEcran)).toBe(true);
  });

  it('le tirage sous budget reste stable quand quelques avatars arrivent', () => {
    const avant = new Set(composerFoule(etendue(5000), { budget: 2000 }).dessines.map((a) => a.id));
    const apres = new Set(
      composerFoule([...etendue(5000), ...etendue(30, 'nouveau', -10_100)], { budget: 2000 }).dessines.map((a) => a.id),
    );

    expect(new Set([...apres].filter((id) => !id.startsWith('nouveau')))).toEqual(avant);
  });

  it('ses propres avatars sont dessinés en plus du budget', () => {
    const tous = etendue(5000);
    const foule = composerFoule(
      tous.map((a, i) => ({ ...a, propre: i < 3 })),
      { budget: 2000 },
    );

    expect(foule.dessines.filter((a) => a.propre)).toHaveLength(3);
  });
});
