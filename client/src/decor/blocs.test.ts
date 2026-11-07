import { describe, expect, it } from 'vitest';
import { cleBloc, type BlocDecor, type Decor } from '@petit-cortege/shared';
import { blocsVisibles } from './blocs';

/** Décor de 4 × 3 blocs de 32 tuiles (64 m de côté), sans le bloc (3, 0). */
function decor(): Decor {
  const blocs = new Map<string, BlocDecor>();
  for (let by = 0; by < 3; by++) {
    for (let bx = 0; bx < 4; bx++) {
      if (bx === 3 && by === 0) continue;
      blocs.set(cleBloc(bx, by), { x: bx * 32, y: by * 32, couches: {} });
    }
  }
  return { georef: { origine: [2.36, 48.87] }, largeur: 128, hauteur: 96, tilesets: [], nomsCouches: ['sol'], blocs };
}
const cles = (blocs: BlocDecor[]) => blocs.map((b) => cleBloc(b.x / 32, b.y / 32)).sort();

describe('blocs du décor à afficher', () => {
  it('ne garde que les blocs qui touchent l’écran (cadrage en mètres)', () => {
    // Écran de 100 × 100 px à 1 px/m centré sur (96 m, 32 m) : de 46 à 146 m en x, de -18 à 82 m en y.
    const visibles = blocsVisibles(decor(), { centre: { x: 96, y: 32 }, echelle: 1 }, { largeur: 100, hauteur: 100 });
    expect(cles(visibles)).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1'].sort());
  });

  it('ignore les blocs absents (hors de la bande autour du parcours)', () => {
    const visibles = blocsVisibles(decor(), { centre: { x: 224, y: 32 }, echelle: 4 }, { largeur: 40, hauteur: 40 });
    expect(visibles).toEqual([]);
  });
});
