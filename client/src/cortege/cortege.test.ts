import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireEntreesMinute, lireListeManifs, type EntreesMinute, type ManifPubliee } from '@petit-cortege/shared';
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

  it('passe de Ouverte à Terminée à départ + longueur ÷ 2 km/h + 1 h de marge', () => {
    // 14:00 + 1000,75 m ÷ 2 km/h (≈ 30 min 1 s) + 1 h ≈ 15:30:01.
    const avant = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:29:30Z') });
    const apres = calculerCortege({ manif, entrees, maintenant: new Date('2026-05-01T15:30:30Z') });

    expect(avant.etat).toBe('ouverte');
    expect(apres.etat).toBe('terminee');
  });
});
