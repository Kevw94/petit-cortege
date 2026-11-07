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

/** 40 avatars entrés avant le départ : une seule rangée de groupe, 5 de front tous les 2 m (1 par tuile). */
const avantLeDepart = Array.from({ length: 40 }, (_, i) => entree(`tot-${i}`, '2026-05-01T13:58:00Z'));

/**
 * Une vague d'arrivées : 25 avatars par seconde pendant 20 s, tous en marche à 0,56 m d'écart
 * entre secondes ; les groupes se chevauchent, bien plus d'un avatar par tuile.
 */
function vague(prefixe: string, parSeconde = 25, secondes = 20): EntreePubliee[] {
  return Array.from({ length: parSeconde * secondes }, (_, i) =>
    entree(`${prefixe}-${i}`, `2026-05-01T14:05:${String(10 + Math.floor(i / parSeconde)).padStart(2, '0')}Z`),
  );
}

const cortegeDe = (entrees: EntreePubliee[], propres: EntreePubliee[] = [], retraits: string[] = []) =>
  calculerCortege({ manif, entrees: [fichier(entrees)], propres, retraits, maintenant }).avatars;
const idsDessines = (entrees: EntreePubliee[], propres: EntreePubliee[] = [], retraits: string[] = []) =>
  new Set(composerFoule(cortegeDe(entrees, propres, retraits)).dessines.map((a) => a.id));

describe('Cortège : masse de foule', () => {
  it("jusqu'à un avatar par tuile, tout le monde est dessiné, sans masse", () => {
    const foule = composerFoule(cortegeDe(avantLeDepart));

    expect(foule.dessines).toHaveLength(40);
    expect(foule.troncons.some((t) => t.enMasse)).toBe(false);
    expect(foule.enMasse).toBe(0);
  });

  it("au-delà d'un avatar par tuile, le tronçon passe en masse et seuls quelques avatars restent dessinés", () => {
    const foule = composerFoule(cortegeDe(vague('v')));

    expect(foule.troncons.some((t) => t.enMasse && t.densite > 1)).toBe(true);
    // Premier plan clairsemé : de l'ordre d'un avatar sur huit, ni personne ni tout le monde.
    expect(foule.dessines.length).toBeGreaterThan(500 / 16);
    expect(foule.dessines.length).toBeLessThan(500 / 4);
    expect(foule.dessines.length + foule.enMasse).toBe(500);
  });

  it('même entrée, même sortie : le tirage ne dépend pas de l’ordre des entrées', () => {
    const entrees = [...avantLeDepart, ...vague('v')];
    const melangees = [...entrees].reverse();

    expect([...idsDessines(melangees)].sort()).toEqual([...idsDessines(entrees)].sort());
  });

  it("le tirage est stable quand des avatars arrivent : personne d'autre n'apparaît ni ne disparaît", () => {
    const avant = idsDessines(vague('v'));
    const arrivants = vague('nouveau', 25, 4);
    const apres = idsDessines([...vague('v'), ...arrivants]);

    const anciensApres = [...apres].filter((id) => !id.startsWith('nouveau'));
    expect(new Set(anciensApres)).toEqual(avant);
    expect(anciensApres.length).toBeLessThan(apres.size); // des arrivants sont tirés aussi
  });

  it('le tirage est stable quand des avatars partent : les autres gardent leur place au premier plan ou dans la masse', () => {
    // Foule serrée sur un tronçon (400 avatars sur 20 m), placée directement.
    const tous = Array.from({ length: 400 }, (_, i) => ({ id: `s-${i}`, distanceM: 100 + (i % 40) / 2, propre: false }));
    const avant = new Set(composerFoule(tous).dessines.map((a) => a.id));
    const restants = tous.filter((_, i) => i % 10 !== 0);
    const apres = new Set(composerFoule(restants).dessines.map((a) => a.id));

    expect(apres).toEqual(new Set([...avant].filter((id) => restants.some((a) => a.id === id))));
    expect(apres.size).toBeGreaterThan(0);
  });

  it('pendant la marche, les mêmes avatars restent au premier plan (pas de clignotement)', () => {
    const entrees = [...avantLeDepart, ...vague('v')];
    const a = (iso: string) => {
      const cortege = calculerCortege({ manif, entrees: [fichier(entrees)], maintenant: new Date(iso) });
      return new Set(composerFoule(cortege.avatars, { repereM: cortege.avanceeM }).dessines.map((x) => x.id));
    };

    for (const minute of ['14:12', '14:14', '14:16', '14:18']) {
      for (const seconde of ['00', '11', '23', '37', '49']) {
        expect(a(`2026-05-01T${minute}:${seconde}Z`)).toEqual(a('2026-05-01T14:20:00Z'));
      }
    }
  });

  it('ses propres avatars sont toujours dessinés, même au cœur de la masse', () => {
    const tous = vague('v');
    const nonTire = tous.find((e) => !idsDessines(tous).has(e.a))!;
    const foule = composerFoule(cortegeDe(tous.filter((e) => e !== nonTire), [nonTire]));

    expect(foule.troncons.some((t) => t.enMasse)).toBe(true);
    expect(foule.dessines.find((a) => a.id === nonTire.a)?.propre).toBe(true);
  });
});

describe('Cortège : budget d’avatars dessinés', () => {
  /** 5 000 avatars clairsemés (un par tuile, rangées de 5 tous les 2 m) : aucune masse due à la densité. */
  const etendue = (n: number, prefixe = 'e', departM = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefixe}-${i}`, distanceM: departM - Math.floor(i / 5) * 2, propre: false }));

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
    const foule = composerFoule(tous.map((a, i) => ({ ...a, propre: i < 3 })), { budget: 2000 });

    expect(foule.dessines.filter((a) => a.propre)).toHaveLength(3);
  });
});
