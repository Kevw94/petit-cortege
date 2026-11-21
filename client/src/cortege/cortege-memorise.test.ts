import { describe, expect, it } from 'vitest';
import { lireListeManifs, type EntreePubliee, type EntreesMinute } from '@petit-cortege/shared';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculerCortege, CortegeMemorise, type EntreesDuCortege } from './cortege';

const FIXTURES = join(import.meta.dirname, '../../../fixtures/publication/manif-pre-remplie');
const manif = lireListeManifs(JSON.parse(readFileSync(join(FIXTURES, 'manifs.json'), 'utf8'))).manifs.find(
  (m) => m.id === 'manif-a',
)!;
const DEPART = Date.parse(manif.depart);

function entree(a: string, ms: number, m = 'manif-a'): EntreePubliee {
  return { a, m, t: Math.floor(ms / 1000), ap: a.length % 7, pa: a.length % 3 };
}
function fichier(entrees: EntreePubliee[]): EntreesMinute {
  return { v: 1, minute: '2026-05-01T13:58:00.000Z', entrees };
}

// Avant le départ (un seul groupe, départagé par hachage), puis des retardataires toutes les
// 7 s, quelques doublons, une autre manif, un avatar propre pas encore publié et des retraits.
const avant = Array.from({ length: 23 }, (_, i) => entree(`tot-${i}`, DEPART - 600_000 + i * 20_000));
const apres = Array.from({ length: 60 }, (_, i) => entree(`tard-${i}`, DEPART + 60_000 + i * 7_000));
const doublons = [entree('tard-3', DEPART + 3_000_000), entree('tot-2', DEPART - 900_000)];
const ailleurs = [entree('lyon-1', DEPART + 70_000, 'manif-b')];
const entrees = [fichier(avant), fichier([...apres, ...ailleurs]), fichier(doublons)];
const propres = [entree('moi', DEPART + 300_000), entree('moi-lyon', DEPART, 'manif-b')];
const retraits = ['tard-10', 'tot-5'];
const base: Omit<EntreesDuCortege, 'maintenant'> = { manif, entrees, propres, retraits };

describe('Cortège mémorisé', () => {
  it('donne exactement le même Cortège que calculerCortege, à toute heure (avant, pendant, danse, fin)', () => {
    const memorise = new CortegeMemorise();
    const fin = Date.parse(manif.fin);
    for (let t = DEPART - 900_000; t <= fin + 60_000; t += 3_500) {
      const maintenant = new Date(t);
      expect(memorise.calculer({ ...base, maintenant })).toEqual(calculerCortege({ ...base, maintenant }));
    }
  });

  it("reste juste si l'heure recule", () => {
    const memorise = new CortegeMemorise();
    for (const t of [DEPART + 400_000, DEPART - 100_000, DEPART + 200_000, DEPART + 199_000]) {
      const maintenant = new Date(t);
      expect(memorise.calculer({ ...base, maintenant })).toEqual(calculerCortege({ ...base, maintenant }));
    }
  });

  it("ne refait pas les rangs quand seule l'heure change", () => {
    const memorise = new CortegeMemorise();
    // tard-2 entre à départ + 74 s, tard-3 à départ + 81 s : rien n'entre entre les deux.
    const rangs = memorise.rangs({ ...base, maintenant: new Date(DEPART + 74_000) });

    expect(memorise.rangs({ ...base, maintenant: new Date(DEPART + 75_500) })).toBe(rangs);
    expect(memorise.rangs({ ...base, maintenant: new Date(DEPART + 80_999) })).toBe(rangs);
  });

  it('refait les rangs quand un nouvel avatar entre', () => {
    const memorise = new CortegeMemorise();
    const rangs = memorise.rangs({ ...base, maintenant: new Date(DEPART + 80_000) });

    expect(memorise.rangs({ ...base, maintenant: new Date(DEPART + 81_000) })).not.toBe(rangs);
  });

  it('après la dernière entrée, les rangs ne bougent plus jusqu’à la fin', () => {
    const memorise = new CortegeMemorise();
    const rangs = memorise.rangs({ ...base, maintenant: new Date(DEPART + 3_000_000) });

    expect(memorise.rangs({ ...base, maintenant: new Date(Date.parse(manif.fin) + 3_600_000) })).toBe(rangs);
  });

  it('refait les rangs quand les entrées, les propres ou les retraits changent', () => {
    const memorise = new CortegeMemorise();
    const maintenant = new Date(DEPART + 75_000);
    const rangs = memorise.rangs({ ...base, maintenant });

    const autresEntrees = memorise.rangs({
      ...base,
      entrees: [...entrees, fichier([entree('x', DEPART)])],
      maintenant,
    });
    expect(autresEntrees).not.toBe(rangs);
    const autresPropres = memorise.rangs({ ...base, propres: [], maintenant });
    expect(autresPropres).not.toBe(autresEntrees);
    const autresRetraits = memorise.rangs({ ...base, propres: [], retraits: ['tard-1'], maintenant });
    expect(autresRetraits).not.toBe(autresPropres);
  });

  it('garde les rangs pour des listes recréées au même contenu (ex. retraits recomposés à chaque image)', () => {
    const memorise = new CortegeMemorise();
    const maintenant = new Date(DEPART + 75_000);
    const rangs = memorise.rangs({ ...base, maintenant });

    expect(
      memorise.rangs({
        manif: { ...manif },
        entrees: [...entrees],
        propres: [...propres],
        retraits: [...retraits],
        maintenant,
      }),
    ).toBe(rangs);
  });

  it('refait les rangs si le départ de la manif est décalé', () => {
    const memorise = new CortegeMemorise();
    const maintenant = new Date(DEPART + 75_000);
    const rangs = memorise.rangs({ ...base, maintenant });
    const decalee = { ...manif, depart: new Date(DEPART + 60_000).toISOString() };

    expect(memorise.rangs({ ...base, manif: decalee, maintenant })).not.toBe(rangs);
    expect(memorise.calculer({ ...base, manif: decalee, maintenant })).toEqual(
      calculerCortege({ ...base, manif: decalee, maintenant }),
    );
  });
});
