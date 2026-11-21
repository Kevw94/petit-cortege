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
    .filter((f) => /T\d\d-\d\d\.json$/.test(f)) // fichiers par minute (sans les fichiers horaires)
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

  it("un retardataire rejoint le cortège là où il est, pas au point de départ", () => {
    // av-tard entré à 14:15:40, à côté d'av-tot (seul dans sa rangée) : à 14:30:00 tous deux
    // sont à 1000 m, là où l'aurait laissé un départ du point de départ (≈ 477,78 m).
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:00Z') });

    expect(distanceDe(cortege, 'av-tard')).toBeCloseTo(1000, 6);
    expect(distanceDe(cortege, 'av-tard')).toBe(distanceDe(cortege, 'av-tot'));
  });

  it('passe de Ouverte à Terminée à départ + longueur ÷ 2 km/h + 1 h de marge', () => {
    // 14:00 + 1000,75 m ÷ 2 km/h (≈ 30 min 1 s) + 1 h ≈ 15:30:01.
    const avant = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:29:30Z') });
    const apres = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:30:30Z') });

    expect(avant.etat).toBe('ouverte');
    expect(apres.etat).toBe('terminee');
  });

  it("une fois terminée, tout le cortège est arrivé, même un retardataire entré juste avant la fin", () => {
    // Entré à 15:29:00, une minute avant la fin (≈ 15:30:01) : il n'aurait marché que ≈ 33 m.
    const retardataire = minuteAvec(['av-dernier'], '2026-05-01T15:29:00Z');

    const cortege = calculerCortege({
      manif,
      entrees: [...entrees, retardataire],
      maintenant: new Date('2026-05-01T15:30:30Z'),
    });

    expect(distanceDe(cortege, 'av-dernier')).toBeCloseTo(1000.75, 0);
    expect(distanceDe(cortege, 'av-tard')).toBeCloseTo(1000.75, 0);
  });
});

describe('Cortège : avatars en marche (pour l’animation)', () => {
  const enMarche = (maintenant: string, id: string, autres = entrees) =>
    calculerCortege({ manif, entrees: autres, maintenant: new Date(maintenant) }).avatars.find((a) => a.id === id)?.enMarche;

  it("n'avance pas avant le départ", () => {
    expect(enMarche('2026-05-01T13:59:00Z', 'av-tot')).toBe(false);
  });

  it('avance après le départ, jusqu’à l’arrivée', () => {
    expect(enMarche('2026-05-01T14:20:00Z', 'av-tot')).toBe(true);
    expect(enMarche('2026-05-01T14:20:00Z', 'av-tard')).toBe(true);
  });

  it("tout le cortège s'arrête quand sa tête arrive au bout du parcours, queue comprise", () => {
    // 14:45 : la tête est arrivée (≈ 14:30:01) ; av-tard, entré à 14:15:40, s'arrête avec elle.
    expect(enMarche('2026-05-01T14:45:00Z', 'av-tot')).toBe(false);
    expect(enMarche('2026-05-01T14:45:00Z', 'av-tard')).toBe(false);
  });

  it('ne marche plus une fois la manif terminée', () => {
    const retardataire = minuteAvec(['av-dernier'], '2026-05-01T14:20:00Z');
    expect(enMarche('2026-05-01T14:20:30Z', 'av-dernier', [...entrees, retardataire])).toBe(true);
    expect(enMarche('2026-05-01T15:30:30Z', 'av-dernier', [...entrees, retardataire])).toBe(false);
  });

  it('ne change pas les positions', () => {
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:20:00Z') });
    expect(distanceDe(cortege, 'av-tot')).toBeCloseTo(666.67, 1);
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

describe('Cortège : retardataires à la queue', () => {
  // 40 avatars entrés avant le départ de 14:00 : 8 rangées complètes de 5.
  const tot = Array.from({ length: 40 }, (_, i) => `av-${i}`);
  const foule = minuteAvec(tot, '2026-05-01T13:58:00Z');
  const maintenant = new Date('2026-05-01T14:30:00Z');

  it('se range juste derrière la dernière rangée, et avance avec le cortège', () => {
    const tard = minuteAvec(['av-tard-1'], '2026-05-01T14:15:40Z');

    const cortege = calculerCortege({ manif, entrees: [foule, tard], maintenant });

    // Tête à 1000 m (30 min à 2 km/h), dernière rangée à 14 m derrière, le retardataire 2 m plus loin.
    expect(Math.min(...tot.map((id) => distanceDe(cortege, id)!))).toBeCloseTo(986, 6);
    expect(distanceDe(cortege, 'av-tard-1')).toBeCloseTo(984, 6);
  });

  it('entrer tôt place près de la tête : devant tous les retardataires', () => {
    const tard = minuteAvec(['av-tard-1', 'av-tard-2'], '2026-05-01T14:15:40Z');

    const cortege = calculerCortege({ manif, entrees: [foule, tard], maintenant });

    const queue = Math.max(distanceDe(cortege, 'av-tard-1')!, distanceDe(cortege, 'av-tard-2')!);
    for (const id of tot) expect(distanceDe(cortege, id)!).toBeGreaterThan(queue);
  });

  it("les retardataires complètent la dernière rangée avant d'en ouvrir une autre", () => {
    const tard = Array.from({ length: 7 }, (_, i) => minuteAvec([`av-tard-${i}`], `2026-05-01T14:1${i}:00Z`));

    const cortege = calculerCortege({ manif, entrees: [foule, ...tard], maintenant });

    // 47 avatars à 5 de front : 10 rangées, la dernière 18 m derrière la tête, aucune superposition.
    expect(Math.min(...cortege.avatars.map((a) => a.distanceM))).toBeCloseTo(1000 - 18, 6);
    const places = new Set(cortege.avatars.map((a) => `${a.distanceM}:${a.decalageM}`));
    expect(places.size).toBe(47);
  });

  it("garde sa place quand d'autres entrent après lui", () => {
    const tard = minuteAvec(['av-tard-1'], '2026-05-01T14:15:40Z');
    const plusTard = minuteAvec(['av-x', 'av-y', 'av-z'], '2026-05-01T14:20:00Z');
    const place = (c: ReturnType<typeof calculerCortege>) => c.avatars.find((a) => a.id === 'av-tard-1');

    const avant = calculerCortege({ manif, entrees: [foule, tard], maintenant });
    const apres = calculerCortege({ manif, entrees: [foule, tard, plusTard], maintenant });

    expect(place(apres)).toEqual(place(avant));
  });

  it("dans un cortège encore vide, le premier rejoint la tête là où l'horaire la place", () => {
    const seul = minuteAvec(['av-seul'], '2026-05-01T14:15:00Z');

    const cortege = calculerCortege({ manif, entrees: [seul], maintenant });

    expect(distanceDe(cortege, 'av-seul')).toBeCloseTo(1000, 6);
  });

  it('une fois la tête arrivée, les retardataires attendent derrière la queue, arrêtés', () => {
    const tard = minuteAvec(['av-tard-1'], '2026-05-01T14:50:00Z');

    const cortege = calculerCortege({ manif, entrees: [foule, tard], maintenant: new Date('2026-05-01T15:00:00Z') });

    expect(distanceDe(cortege, 'av-tard-1')).toBeCloseTo(manif.longueurM - 16, 6);
    expect(cortege.avatars.every((a) => !a.enMarche)).toBe(true);
  });
});

describe('Cortège : avatars propres au soutien', () => {
  // Réponse du serveur à l'entrée faite à 14:20:10 : heure stockée 14:20:47 (minute + aléa).
  const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:20:47Z') / 1000, ap: 4, pa: 1 };
  const avant = new Date('2026-05-01T14:20:12Z');

  it("apparaît tout de suite, avant publication et avant même son heure d'entrée tirée, à la queue du cortège", () => {
    // 40 avatars entrés avant le départ : 8 rangées complètes ; av-moi ouvre la 9e, 16 m derrière la tête.
    const foule = minuteAvec(Array.from({ length: 40 }, (_, i) => `av-${i}`), '2026-05-01T13:58:00Z');
    const cortege = calculerCortege({ manif, entrees: [foule], propres: [propre], maintenant: avant });

    expect(cortege.avatars.find((a) => a.id === 'av-moi')).toMatchObject({ distanceM: cortege.avanceeM - 16, propre: true });
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

  it('marche ensuite à la place où les autres le verront', () => {
    const maintenant = new Date('2026-05-01T14:25:00Z');
    const publie = { v: 1 as const, minute: '2026-05-01T14:20:00.000Z', entrees: [propre] };
    const place = (c: ReturnType<typeof calculerCortege>) => {
      const { distanceM, decalageM } = c.avatars.find((a) => a.id === 'av-moi')!;
      return { distanceM, decalageM };
    };

    const surCetAppareil = calculerCortege({ manif, entrees, propres: [propre], maintenant });
    const chezLesAutres = calculerCortege({ manif, entrees: [...entrees, publie], maintenant });

    expect(place(surCetAppareil)).toEqual(place(chezLesAutres));
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
