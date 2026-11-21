import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculerFin,
  lireEntreesMinute,
  lireListeManifs,
  lireRetraits,
  type EntreesMinute,
  type ManifPubliee,
} from '@petit-cortege/shared';
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

  it("au bout du parcours, il entre sur la place d'arrivée et y rejoint sa place", () => {
    // 45 min après le départ : 1500 m de marche, mais le parcours fait ≈ 1000,75 m.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:45:00Z') });
    const avatar = cortege.avatars.find((a) => a.id === 'av-tot')!;

    expect(avatar.surPlace).toBe(true);
    expect(avatar.enMarche).toBe(false);
    expect(avatar.distanceM).toBeGreaterThanOrEqual(manif.longueurM);
    expect(avatar.distanceM).toBeLessThan(manif.longueurM + 5);
  });

  it("ne contient que les avatars de la manif déjà entrés à l'heure courante", () => {
    // av-tard entre à 14:15:40 ; av-lyon est dans une autre manif.
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:10:00Z') });

    expect(cortege.avatars.map((a) => a.id)).toEqual(['av-tot']);
  });

  it('un retardataire rejoint le cortège là où il est, pas au point de départ', () => {
    // av-tard entré à 14:15:40, à côté d'av-tot (seul dans sa rangée) : à 14:30:00 tous deux
    // sont à 1000 m, là où l'aurait laissé un départ du point de départ (≈ 477,78 m).
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:00Z') });

    expect(distanceDe(cortege, 'av-tard')).toBeCloseTo(1000, 6);
    expect(distanceDe(cortege, 'av-tard')).toBe(distanceDe(cortege, 'av-tot'));
  });

  it('passe de Ouverte à Terminée à la fin publiée (arrivée de la queue + 10 min de danse)', () => {
    // Une seule rangée : la queue arrive avec la tête, ≈ 14:30:01 ; fin ≈ 14:40:01.
    expect(manif.fin).toBe(
      new Date(Date.parse(manif.depart) + manif.longueurM / (2000 / 3_600_000) + 600_000).toISOString(),
    );
    const fin = Date.parse(manif.fin);
    const avant = calculerCortege({ manif, entrees, maintenant: new Date(fin - 30_000) });
    const apres = calculerCortege({ manif, entrees, maintenant: new Date(fin + 30_000) });

    expect(avant.etat).toBe('ouverte');
    expect(apres.etat).toBe('terminee');
  });

  it('les entrées ferment quand la tête arrive au bout du parcours', () => {
    expect(calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:00Z') }).entreesOuvertes).toBe(
      true,
    );
    expect(calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T14:30:02Z') }).entreesOuvertes).toBe(
      false,
    );
  });

  it('une fois terminée, tout le cortège est rassemblé sur la place, immobile', () => {
    const cortege = calculerCortege({ manif, entrees, maintenant: new Date(Date.parse(manif.fin) + 30_000) });

    expect(cortege.avatars.length).toBeGreaterThan(0);
    for (const a of cortege.avatars) {
      expect(a).toMatchObject({ surPlace: true, enMarche: false });
      expect(a.distanceM).toBeGreaterThanOrEqual(manif.longueurM);
    }
  });
});

describe('Cortège : avatars en marche (pour l’animation)', () => {
  const enMarche = (maintenant: string, id: string, autres = entrees) =>
    calculerCortege({ manif, entrees: autres, maintenant: new Date(maintenant) }).avatars.find((a) => a.id === id)
      ?.enMarche;

  it("n'avance pas avant le départ", () => {
    expect(enMarche('2026-05-01T13:59:00Z', 'av-tot')).toBe(false);
  });

  it('avance après le départ, jusqu’à l’arrivée', () => {
    expect(enMarche('2026-05-01T14:20:00Z', 'av-tot')).toBe(true);
    expect(enMarche('2026-05-01T14:20:00Z', 'av-tard')).toBe(true);
  });

  it("une fois à sa place sur la place d'arrivée, il ne marche plus", () => {
    // 14:45 : la tête est arrivée (≈ 14:30:01) ; av-tot et av-tard ont rejoint leur place.
    expect(enMarche('2026-05-01T14:45:00Z', 'av-tot')).toBe(false);
    expect(enMarche('2026-05-01T14:45:00Z', 'av-tard')).toBe(false);
  });

  it('ne marche plus une fois la manif terminée', () => {
    const retardataire = minuteAvec(['av-dernier'], '2026-05-01T14:20:00Z');
    expect(enMarche('2026-05-01T14:20:30Z', 'av-dernier', [...entrees, retardataire])).toBe(true);
    expect(
      enMarche(new Date(Date.parse(manif.fin) + 30_000).toISOString(), 'av-dernier', [...entrees, retardataire]),
    ).toBe(false);
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
    const melange = [tard, { ...groupe[0]!, entrees: [...groupe[0]!.entrees].reverse() }];
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

  it('une fois la tête arrivée, la queue continue de marcher et entre à son tour sur la place', () => {
    const tard = minuteAvec(['av-tard-1'], '2026-05-01T14:20:00Z');
    // Fin publiée pour ces 41 soutiens : 9 rangées, la queue arrive ≈ 29 s après la tête.
    const manif41 = { ...manif, fin: calculerFin(new Date(manif.depart), manif.longueurM, 41).toISOString() };
    // Tête arrivée ≈ 14:30:01 ; av-tard-1, 16 m derrière, arrive ≈ 29 s plus tard.
    const juste = calculerCortege({
      manif: manif41,
      entrees: [foule, tard],
      maintenant: new Date('2026-05-01T14:30:10Z'),
    });
    const apres = calculerCortege({
      manif: manif41,
      entrees: [foule, tard],
      maintenant: new Date('2026-05-01T14:32:00Z'),
    });

    expect(juste.avatars.find((a) => a.id === 'av-tard-1')).toMatchObject({ surPlace: false, enMarche: true });
    expect(apres.avatars.find((a) => a.id === 'av-tard-1')).toMatchObject({ surPlace: true });
  });
});

describe('Cortège : avatars propres au soutien', () => {
  // Réponse du serveur à l'entrée faite à 14:20:10 : heure stockée 14:20:47 (minute + aléa).
  const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:20:47Z') / 1000, ap: 4, pa: 1 };
  const avant = new Date('2026-05-01T14:20:12Z');

  it("apparaît tout de suite, avant publication et avant même son heure d'entrée tirée, à la queue du cortège", () => {
    // 40 avatars entrés avant le départ : 8 rangées complètes ; av-moi ouvre la 9e, 16 m derrière la tête.
    const foule = minuteAvec(
      Array.from({ length: 40 }, (_, i) => `av-${i}`),
      '2026-05-01T13:58:00Z',
    );
    const cortege = calculerCortege({ manif, entrees: [foule], propres: [propre], maintenant: avant });

    expect(cortege.avatars.find((a) => a.id === 'av-moi')).toMatchObject({
      distanceM: cortege.avanceeM - 16,
      propre: true,
    });
  });

  it('seuls ses propres avatars sont mis en valeur', () => {
    const cortege = calculerCortege({ manif, entrees, propres: [propre], maintenant: avant });

    expect(cortege.avatars.filter((a) => a.propre).map((a) => a.id)).toEqual(['av-moi']);
  });

  it("une fois publié, il n'est pas compté deux fois et reste mis en valeur", () => {
    const publie = { v: 1 as const, minute: '2026-05-01T14:20:00.000Z', entrees: [propre] };
    const maintenant = new Date('2026-05-01T14:25:00Z');

    const cortege = calculerCortege({ manif, entrees: [...entrees, publie], propres: [propre], maintenant });

    expect(cortege.avatars.filter((a) => a.id === 'av-moi')).toEqual([expect.objectContaining({ propre: true })]);
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

describe('Cortège : place d’arrivée et danse finale', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `av-${i}`);
  const foule = minuteAvec(ids, '2026-05-01T13:58:00Z');
  const manif60 = { ...manif, fin: calculerFin(new Date(manif.depart), manif.longueurM, 60).toISOString() };
  const a = (iso: string | number) => calculerCortege({ manif: manif60, entrees: [foule], maintenant: new Date(iso) });

  it('sur la place, chacun a sa propre place, devant le point d’arrivée, sans superposition', () => {
    const { avatars } = a(Date.parse(manif60.fin) - 60_000);

    for (const x of avatars) expect(x.distanceM).toBeGreaterThanOrEqual(manif60.longueurM);
    for (let i = 0; i < avatars.length; i++) {
      for (let j = i + 1; j < avatars.length; j++) {
        expect(ecart(avatars[i]!, avatars[j]!)).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it("entre sur la place par le point d'arrivée, puis marche jusqu'à sa place (sans saut)", () => {
    // Un avatar 10 m derrière la tête (6e rangée) : il atteint le point d'arrivée ≈ 18 s
    // après elle, avant que la queue n'arrive et que la danse commence.
    const tete = Date.parse(manif60.depart) + manif60.longueurM / (2000 / 3_600_000);
    const queue = a(tete).avatars.find((x) => Math.abs(x.distanceM - (manif60.longueurM - 10)) < 0.01)!;
    const arrivee = tete + (manif60.longueurM - queue.distanceM) / (2000 / 3_600_000);
    const avant = a(arrivee - 1000).avatars.find((x) => x.id === queue.id)!;
    const apres = a(arrivee + 1000).avatars.find((x) => x.id === queue.id)!;

    expect(avant.surPlace).toBe(false);
    expect(apres).toMatchObject({ surPlace: true, enMarche: true });
    // 2 s de marche à 2 km/h ≈ 1,1 m.
    expect(ecart(avant, apres)).toBeLessThan(1.2);
  });

  it('pendant les 10 dernières minutes, tout le monde danse à sa place', () => {
    const debutDanse = Date.parse(manif60.fin) - 10 * 60_000;
    const avant = a(debutDanse - 30_000);
    const pendant = a(debutDanse + 30_000);

    expect(avant.danse).toBe(false);
    expect(pendant.danse).toBe(true);
    for (const x of pendant.avatars) expect(x).toMatchObject({ surPlace: true, enMarche: false });
  });

  it('la danse ne déplace personne : la place pendant la danse est celle de la fin', () => {
    const pendant = a(Date.parse(manif60.fin) - 60_000);
    const fin = a(Date.parse(manif60.fin) + 1000);

    expect(fin.danse).toBe(false);
    const places = (c: ReturnType<typeof calculerCortege>) =>
      Object.fromEntries(c.avatars.map((x) => [x.id, [x.distanceM, x.decalageM]]));
    expect(places(fin)).toEqual(places(pendant));
  });

  it('une queue trop longue est considérée arrivée au début de la danse, 1 h après la tête', () => {
    const longue = minuteAvec(
      Array.from({ length: 12_000 }, (_, i) => `l-${i}`),
      '2026-05-01T13:58:00Z',
    );
    const manifLongue = { ...manif, fin: calculerFin(new Date(manif.depart), manif.longueurM, 12_000).toISOString() };
    const tete = Date.parse(manif.depart) + manif.longueurM / (2000 / 3_600_000);
    expect(Date.parse(manifLongue.fin)).toBeCloseTo(tete + 70 * 60_000, -2);

    const avant = calculerCortege({ manif: manifLongue, entrees: [longue], maintenant: new Date(tete + 59 * 60_000) });
    const danse = calculerCortege({ manif: manifLongue, entrees: [longue], maintenant: new Date(tete + 61 * 60_000) });

    expect(avant.avatars.some((x) => !x.surPlace)).toBe(true);
    expect(danse.avatars.every((x) => x.surPlace)).toBe(true);
  });
});
