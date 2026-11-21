import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireListeManifs, type EntreePubliee, type EntreesMinute } from '@petit-cortege/shared';
import { composerImageFinale, type AvatarImageFinale, type ImageFinale } from './image-finale';

// Fichiers publiés par les tests du serveur (server/test/publication.test.ts) : manif-a, tête
// arrivée (entrées fermées) ≈ 14:30:01.
const FIXTURES = join(import.meta.dirname, '../../../fixtures/publication/manif-pre-remplie');
const manif = lireListeManifs(JSON.parse(readFileSync(join(FIXTURES, 'manifs.json'), 'utf8'))).manifs.find(
  (m) => m.id === 'manif-a',
)!;

/** `n` avatars de manif-a, entrés à partir de 14:05, au plus un par seconde pendant 20 min (entrées ouvertes). */
function avatars(prefixe: string, n: number): EntreePubliee[] {
  const debut = Date.parse('2026-05-01T14:05:00Z') / 1000;
  return Array.from({ length: n }, (_, i) => ({ a: `${prefixe}-${i}`, m: 'manif-a', t: debut + (i % 1200), ap: 0, pa: 0 }));
}
const fichier = (entrees: EntreePubliee[]): EntreesMinute => ({ v: 1, minute: '2026-05-01T14:05:00.000Z', entrees });

const tous = (image: ImageFinale): AvatarImageFinale[] => [...image.premierPlan, ...image.masse];
const parId = (image: ImageFinale) => new Map(tous(image).map((a) => [a.id, a]));
const distanceAuPointDArrivee = (a: AvatarImageFinale) => Math.hypot(a.xM, a.yM);

describe("Cortège : image finale", () => {
  it("rassemble tout le cortège au point d'arrivée, chacun à sa place, sans superposition", () => {
    const image = composerImageFinale({ manif, entrees: [fichier(avatars('av', 300))] });

    const places = tous(image);
    expect(places).toHaveLength(300);
    for (const a of places) expect(distanceAuPointDArrivee(a)).toBeLessThanOrEqual(image.rayonM);
    // Moins de 2000 avatars : au moins 1 m entre deux avatars (un avatar fait une tuile de 2 m).
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        expect(Math.hypot(places[i]!.xM - places[j]!.xM, places[i]!.yM - places[j]!.yM)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("même entrée, même image, quel que soit l'ordre des fichiers et des entrées", () => {
    const liste = avatars('av', 200);
    const a = composerImageFinale({ manif, entrees: [fichier(liste)] });
    const b = composerImageFinale({ manif, entrees: [fichier(liste.slice(100).reverse()), fichier(liste.slice(0, 100))] });

    expect(b).toEqual(a);
  });

  it('compteur juste : entrées de la manif seulement, sans doublon, retraits appliqués, avatars propres compris', () => {
    const liste = avatars('av', 50);
    const autreManif = { a: 'av-lyon', m: 'manif-b', t: liste[0]!.t, ap: 0, pa: 0 };
    const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:30:00Z') / 1000, ap: 3, pa: 1 };

    const image = composerImageFinale({
      manif,
      entrees: [fichier([...liste, autreManif]), fichier(liste.slice(0, 10))],
      propres: [propre],
      retraits: ['av-0', 'av-1', 'av-2'],
    });

    // 50 − 3 retirés + le sien.
    expect(image.compteur).toBe(48);
    expect(parId(image).has('av-0')).toBe(false);
    expect(parId(image).has('av-lyon')).toBe(false);
  });

  it('ses propres avatars sont toujours au premier plan et mis en valeur, même dans une très grande foule', () => {
    const propre = { a: 'av-moi', m: 'manif-a', t: Date.parse('2026-05-01T14:30:00Z') / 1000, ap: 3, pa: 1 };

    const image = composerImageFinale({ manif, entrees: [fichier(avatars('av', 20_000))], propres: [propre] });

    expect(image.premierPlan.filter((a) => a.propre).map((a) => a.id)).toEqual(['av-moi']);
    expect(tous(image).filter((a) => a.propre)).toHaveLength(1);
  });

  it('une petite foule est entièrement au premier plan ; une grande passe en masse avec des avatars tirés', () => {
    const petite = composerImageFinale({ manif, entrees: [fichier(avatars('av', 300))] });
    const grande = composerImageFinale({ manif, entrees: [fichier(avatars('av', 20_000))] });

    expect(petite.premierPlan).toHaveLength(300);
    expect(petite.enMasse).toBe(0);
    expect(grande.compteur).toBe(20_000);
    expect(grande.premierPlan.length).toBeGreaterThan(100);
    expect(grande.premierPlan.length).toBeLessThanOrEqual(2000);
    expect(grande.enMasse).toBe(20_000 - grande.premierPlan.length);
    // La masse dessinée est un échantillon : pas 20 000 sprites cachés les uns par les autres.
    expect(grande.masse.length).toBeLessThan(grande.enMasse);
    expect(grande.masse.length).toBeGreaterThan(1000);
  });

  it('les avatars du premier plan sont répartis sur toute la place, pas regroupés au centre', () => {
    const image = composerImageFinale({ manif, entrees: [fichier(avatars('av', 20_000))] });

    // Sur un disque uniforme, la moitié des avatars est au-delà de R/√2 ≈ 0,71 R.
    const auBord = image.premierPlan.filter((a) => distanceAuPointDArrivee(a) > image.rayonM / Math.SQRT2);
    expect(auBord.length / image.premierPlan.length).toBeGreaterThan(0.4);
    expect(auBord.length / image.premierPlan.length).toBeLessThan(0.6);
  });

  it('le premier plan respecte le budget', () => {
    const image = composerImageFinale({ manif, entrees: [fichier(avatars('av', 300))] }, { budget: 100 });

    expect(image.premierPlan.length).toBeLessThanOrEqual(100);
    expect(image.premierPlan.length).toBeGreaterThan(30);
  });

  it("tirage stable : ajouter ou retirer quelques avatars ne change le premier plan de personne d'autre", () => {
    const liste = avatars('av', 20_000);
    const retires = ['av-5', 'av-77', 'av-1234'];
    const avant = composerImageFinale({ manif, entrees: [fichier(liste)] });
    const apres = composerImageFinale({
      manif,
      entrees: [fichier([...liste, ...avatars('nouveau', 20)])],
      retraits: retires,
    });

    const ids = (image: ImageFinale) => new Set(image.premierPlan.map((a) => a.id).filter((id) => id.startsWith('av-')));
    expect(ids(apres)).toEqual(new Set([...ids(avant)].filter((id) => !retires.includes(id))));
  });

  it("l'image ne « saute » pas : un avatar ajouté ou retiré ne déplace presque personne", () => {
    const liste = avatars('av', 1000);
    const avant = parId(composerImageFinale({ manif, entrees: [fichier(liste)] }));
    const apres = parId(
      composerImageFinale({ manif, entrees: [fichier([...liste, ...avatars('nouveau', 1)])], retraits: ['av-500'] }),
    );

    let deplaces = 0;
    for (const [id, a] of avant) {
      const b = apres.get(id);
      if (b && (b.xM !== a.xM || b.yM !== a.yM)) deplaces++;
    }
    // Seuls les voisins de grappe de l'arrivant et du partant bougent (quelques-uns sur 1000).
    expect(deplaces).toBeLessThanOrEqual(10);
  });

  it('une très grande foule reste sur la place (rayon plafonné)', () => {
    const image = composerImageFinale({ manif, entrees: [fichier(avatars('av', 20_000))] });

    expect(image.rayonM).toBeLessThanOrEqual(50);
    for (const a of tous(image)) expect(distanceAuPointDArrivee(a)).toBeLessThanOrEqual(image.rayonM);
  });
});
