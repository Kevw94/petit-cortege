import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireEntreesMinute, lireListeManifs, lireRetraits, type EntreesMinute, type ManifPubliee } from '@petit-cortege/shared';
import { calculerCortege } from './cortege';

// Fichiers publiés par les tests du serveur (server/test/publication.test.ts).
const FIXTURES = join(import.meta.dirname, '../../../fixtures/publication/manif-pre-remplie');

function chargerFixtures(): { manif: ManifPubliee; entrees: EntreesMinute[] } {
  const liste = lireListeManifs(JSON.parse(readFileSync(join(FIXTURES, 'manifs.json'), 'utf8')));
  const entrees = readdirSync(join(FIXTURES, 'entrees'))
    .sort()
    .map((f) => lireEntreesMinute(JSON.parse(readFileSync(join(FIXTURES, 'entrees', f), 'utf8'))));
  const manif = liste.manifs.find((m) => m.id === 'manif-a');
  if (!manif) throw new Error('fixture manif-a absente');
  return { manif, entrees };
}

const { manif, entrees } = chargerFixtures();
const distanceDe = (resultat: ReturnType<typeof calculerCortege>, id: string) =>
  resultat.avatars.find((a) => a.id === id)?.distanceM;

describe('Cortège', () => {
  it('un avatar entré avant le départ attend au point de départ', () => {
    // av-tot est entré à 13:56:12, départ à 14:00.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T13:59:00Z') });

    expect(distanceDe(cortege, 'av-tot')).toBe(0);
  });

  it('puis avance à 2 km/h à partir du départ', () => {
    // 30 min après le départ de 14:00 : 2 km/h × 0,5 h = 1000 m.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:00Z') });

    expect(distanceDe(cortege, 'av-tot')).toBeCloseTo(1000, 6);
  });

  it('plafonné à la longueur du parcours', () => {
    // 45 min après le départ : 1500 m de marche, mais le parcours fait ≈ 1000,75 m.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:45:00Z') });

    expect(distanceDe(cortege, 'av-tot')).toBeCloseTo(1000.75, 0);
  });

  it("ne contient que les avatars de la manif déjà entrés à l'heure courante", () => {
    // av-tard entre à 14:15:40 ; av-lyon est dans une autre manif.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:10:00Z') });

    expect(cortege.avatars.map((a) => a.id)).toEqual(['av-tot']);
  });

  it("un retardataire part du point de départ à son heure d'entrée", () => {
    // av-tard entré à 14:15:40 : à 14:30:00 il a marché 860 s à 2 km/h ≈ 477,78 m.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:00Z') });

    expect(distanceDe(cortege, 'av-tard')).toBeCloseTo(477.78, 1);
  });

  it('entrer tôt place près de la tête : devant le retardataire', () => {
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:20:00Z') });

    expect(distanceDe(cortege, 'av-tot')!).toBeGreaterThan(distanceDe(cortege, 'av-tard')!);
  });

  it('passe de Ouverte à Terminée à départ + longueur ÷ 2 km/h + 1 h de marge', () => {
    // 14:00 + 1000,75 m ÷ 2 km/h (≈ 30 min 1 s) + 1 h ≈ 15:30:01.
    const avant = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:29:30Z') });
    const apres = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:30:30Z') });

    expect(avant.etat).toBe('ouverte');
    expect(apres.etat).toBe('terminee');
  });
});

/** Fichier de minute fabriqué pour un test : avatars de manif-a entrés à `iso`. */
function minuteAvec(ids: string[], iso: string): EntreesMinute {
  const t = Date.parse(iso) / 1000;
  return {
    v: 1,
    minute: new Date(Math.floor(t / 60) * 60_000).toISOString(),
    entrees: ids.map((a) => ({ a, m: 'manif-a', t, ap: 0, pa: 0 })),
  };
}

const ecart = (a: { distanceM: number; decalageM: number }, b: { distanceM: number; decalageM: number }) =>
  Math.hypot(a.distanceM - b.distanceM, a.decalageM - b.decalageM);

describe('Cortège : répartition de la foule', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `av-${i}`);
  // 40 avatars entrés avant le départ de 14:00 : tous à la même distance de marche.
  const groupe = [minuteAvec(ids, '2026-05-01T13:58:00Z')];

  it('les avatars à la même distance sont répartis sans se superposer (≥ 1 tuile de 2 m)', () => {
    const { avatars } = calculerCortege({ manif, entrees: groupe, maintenant: new Date('2026-05-01T14:10:00Z') });

    expect(avatars).toHaveLength(40);
    for (let i = 0; i < avatars.length; i++) {
      for (let j = i + 1; j < avatars.length; j++) {
        expect(ecart(avatars[i]!, avatars[j]!)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('la foule tient sur la largeur de la rue (5 de front, 10 m) et se range derrière', () => {
    const { avatars } = calculerCortege({ manif, entrees: groupe, maintenant: new Date('2026-05-01T14:10:00Z') });

    // 14:10 : 10 min de marche à 2 km/h ≈ 333,33 m pour la première rangée.
    for (const a of avatars) {
      expect(Math.abs(a.decalageM)).toBeLessThanOrEqual(4);
      expect(a.distanceM).toBeLessThanOrEqual(333.34);
    }
    // 40 avatars à 5 de front : 8 rangées, la dernière 14 m derrière la première.
    expect(Math.min(...avatars.map((a) => a.distanceM))).toBeCloseTo(333.33 - 14, 1);
  });

  it("même foule quel que soit l'ordre des fichiers et des entrées (même entrée, même sortie)", () => {
    const tard = minuteAvec(['av-x', 'av-y', 'av-z'], '2026-05-01T14:05:07Z');
    const melange = [
      tard,
      { ...groupe[0]!, entrees: [...groupe[0]!.entrees].reverse() },
    ];
    const maintenant = new Date('2026-05-01T14:10:00Z');

    const parId = (c: ReturnType<typeof calculerCortege>) =>
      Object.fromEntries(c.avatars.map((a) => [a.id, [a.distanceM, a.decalageM]]));
    expect(parId(calculerCortege({ manif, entrees: melange, maintenant }))).toEqual(
      parId(calculerCortege({ manif, entrees: [...groupe, tard], maintenant })),
    );
  });

  it("le décalage latéral d'un avatar seul dépend de son identifiant (pas tous au milieu)", () => {
    const seuls = ids.slice(0, 12).map((id, i) => minuteAvec([id], `2026-05-01T14:05:${String(10 + i)}Z`));
    const { avatars } = calculerCortege({ manif, entrees: seuls, maintenant: new Date('2026-05-01T14:10:00Z') });

    expect(new Set(avatars.map((a) => a.decalageM)).size).toBeGreaterThan(1);
  });

  it('un avatar en double dans les fichiers ne compte qu’une fois', () => {
    const { avatars } = calculerCortege({
      manif,
      entrees: [...groupe, ...groupe],
      maintenant: new Date('2026-05-01T14:10:00Z'),
    });

    expect(avatars).toHaveLength(40);
  });
});

describe('Cortège : avatars propres au soutien', () => {
  // Réponse du serveur à l'entrée faite à 14:20:10 : heure stockée 14:20:47 (minute + aléa).
  const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:20:47Z') / 1000, ap: 4, pa: 1 };
  const avant = new Date('2026-05-01T14:20:12Z');

  it("apparaît tout de suite, avant publication et avant même son heure d'entrée tirée, au point de départ", () => {
    const cortege = calculerCortege({ manif, entrees, propres: [propre], maintenant: avant });

    expect(cortege.avatars.find((a) => a.id === 'av-moi')).toMatchObject({ distanceM: 0, propre: true });
  });

  it('seuls ses propres avatars sont mis en valeur', () => {
    const cortege = calculerCortege({ manif, entrees, propres: [propre], maintenant: avant });

    expect(cortege.avatars.filter((a) => a.propre).map((a) => a.id)).toEqual(['av-moi']);
  });

  it("une fois publié, il n'est pas compté deux fois et reste mis en valeur", () => {
    const publie = { v: 1 as const, minute: '2026-05-01T14:20:00.000Z', entrees: [propre] };
    const maintenant = new Date('2026-05-01T14:25:00Z');

    const cortege = calculerCortege({ manif, entrees: [...entrees, publie], propres: [propre], maintenant });

    expect(cortege.avatars.filter((a) => a.id === 'av-moi')).toEqual([
      expect.objectContaining({ propre: true }),
    ]);
  });

  it('marche ensuite comme les autres le verront', () => {
    // 14:25:00 − 14:20:47 = 253 s à 2 km/h ≈ 140,56 m.
    const cortege = calculerCortege({ manif, entrees, propres: [propre], maintenant: new Date('2026-05-01T14:25:00Z') });

    expect(distanceDe(cortege, 'av-moi')).toBeCloseTo(140.56, 1);
  });

  it("un avatar propre d'une autre manif n'apparaît pas", () => {
    const ailleurs = { ...propre, a: 'av-moi-lyon', m: 'manif-b' };

    const cortege = calculerCortege({ manif, entrees, propres: [ailleurs], maintenant: avant });

    expect(cortege.avatars.map((a) => a.id)).not.toContain('av-moi-lyon');
  });
});

describe('Cortège : retraits', () => {
  // Fichiers publiés par les tests du serveur (server/test/retrait.test.ts) : av-reste,
  // av-retire (retiré par le soutien) et av-modere (supprimé par modération).
  const DOSSIER = join(import.meta.dirname, '../../../fixtures/publication/avec-retraits');
  const lireJson = (chemin: string): unknown => JSON.parse(readFileSync(join(DOSSIER, chemin), 'utf8'));
  const manifA = lireListeManifs(lireJson('manifs.json')).manifs.find((m) => m.id === 'manif-a')!;
  const entreesA = readdirSync(join(DOSSIER, 'entrees'))
    .sort()
    .map((f) => lireEntreesMinute(lireJson(join('entrees', f))));
  const { retraits } = lireRetraits(lireJson('retraits.json'));
  const maintenant = new Date('2026-05-01T14:05:00Z');

  it('les avatars retirés disparaissent du cortège, les autres restent', () => {
    const cortege = calculerCortege({ manif: manifA, entrees: entreesA, retraits, maintenant });

    expect(cortege.avatars.map((a) => a.id)).toEqual(['av-reste']);
  });

  it('sans retraits, tout le monde est là', () => {
    const cortege = calculerCortege({ manif: manifA, entrees: entreesA, maintenant });

    expect(cortege.avatars.map((a) => a.id).sort()).toEqual(['av-modere', 'av-reste', 'av-retire']);
  });

  it('son propre avatar retiré disparaît aussi, même avant publication', () => {
    const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:04:10Z') / 1000, ap: 0, pa: 0 };

    const cortege = calculerCortege({
      manif: manifA,
      entrees: entreesA,
      propres: [propre],
      retraits: [...retraits, 'av-moi'],
      maintenant,
    });

    expect(cortege.avatars.map((a) => a.id)).toEqual(['av-reste']);
  });
});
