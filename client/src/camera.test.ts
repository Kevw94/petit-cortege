import { describe, expect, it } from 'vitest';
import { cadrerSur, ECHELLE_MAX_PX_PAR_M } from './cadrage';
import { cadrerEnTroisiemePersonne, cibleDeSuivi, ECHELLE_SUIVI_PX_PAR_M, suivre } from './camera';

const ecran = { largeur: 400, hauteur: 800 };
const ensemble = cadrerSur({ minX: 0, maxX: 4000, minY: 0, maxY: 100 }, ecran, 32);

describe('caméra à la troisième personne', () => {
  it('suit son propre avatar quand le soutien a rejoint', () => {
    const cible = cibleDeSuivi([
      { distanceM: 900, decalageM: 2, propre: false },
      { distanceM: 300, decalageM: -1, propre: true },
    ]);
    expect(cible).toEqual({ distanceM: 300, decalageM: -1 });
  });

  it('avec plusieurs avatars à soi, suit le plus avancé', () => {
    const cible = cibleDeSuivi([
      { distanceM: 100, decalageM: 0, propre: true },
      { distanceM: 400, decalageM: 1, propre: true },
    ]);
    expect(cible).toEqual({ distanceM: 400, decalageM: 1 });
  });

  it('sans avatar à soi, suit la tête du cortège, au milieu de la rue', () => {
    const cible = cibleDeSuivi([
      { distanceM: 120, decalageM: 2, propre: false },
      { distanceM: 800, decalageM: -2, propre: false },
    ]);
    expect(cible).toEqual({ distanceM: 800, decalageM: 0 });
  });

  it('sans personne, regarde le point de départ', () => {
    expect(cibleDeSuivi([])).toEqual({ distanceM: 0, decalageM: 0 });
  });

  it('cadre de près sur la cible, en gardant le dézoom jusqu’à la vue d’ensemble', () => {
    const cadrage = cadrerEnTroisiemePersonne(ensemble, { x: 1200, y: 40 });
    expect(cadrage.centre).toEqual({ x: 1200, y: 40 });
    expect(cadrage.echelle).toBe(ECHELLE_SUIVI_PX_PAR_M);
    expect(cadrage.echelle).toBeGreaterThan(ensemble.echelle);
    expect(cadrage.echelle).toBeLessThanOrEqual(ECHELLE_MAX_PX_PAR_M);
    expect(cadrage.echelleMin).toBe(ensemble.echelleMin);
  });

  it('suivre rapproche le centre de la cible sans changer le zoom', () => {
    const cadrage = { echelle: 10, centre: { x: 0, y: 0 }, echelleMin: 1 };
    const suivi = suivre(cadrage, { x: 100, y: -40 }, 0.25);
    expect(suivi.centre).toEqual({ x: 25, y: -10 });
    expect(suivi.echelle).toBe(10);
    expect(suivre(cadrage, { x: 100, y: -40 }, 1).centre).toEqual({ x: 100, y: -40 });
  });
});
