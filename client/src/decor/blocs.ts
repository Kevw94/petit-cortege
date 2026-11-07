/** Chargement par blocs : quels blocs du décor touchent l'écran. */
import { cleBloc, METRES_PAR_TUILE, TAILLE_BLOC, type BlocDecor, type Decor } from '@petit-cortege/shared';
import type { Ecran, PointM } from '../cadrage';

/** Côté d'un bloc, en mètres. */
export const COTE_BLOC_M = TAILLE_BLOC * METRES_PAR_TUILE;

/** Blocs existants qui touchent l'écran ; mètres comptés depuis l'origine du décor. */
export function blocsVisibles(decor: Decor, cadrage: { centre: PointM; echelle: number }, ecran: Ecran): BlocDecor[] {
  const demiL = ecran.largeur / 2 / cadrage.echelle;
  const demiH = ecran.hauteur / 2 / cadrage.echelle;
  const bx0 = Math.floor((cadrage.centre.x - demiL) / COTE_BLOC_M);
  const bx1 = Math.floor((cadrage.centre.x + demiL) / COTE_BLOC_M);
  const by0 = Math.floor((cadrage.centre.y - demiH) / COTE_BLOC_M);
  const by1 = Math.floor((cadrage.centre.y + demiH) / COTE_BLOC_M);
  const blocs: BlocDecor[] = [];
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const bloc = decor.blocs.get(cleBloc(bx, by));
      if (bloc) blocs.push(bloc);
    }
  }
  return blocs;
}
