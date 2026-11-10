import { describe, expect, it } from 'vitest';
import { cleBloc, TAILLE_BLOC, type BlocDecor, type Decor } from '@petit-cortege/shared';
import { boitesDeBatiments, HAUTEUR_MAX_M, HAUTEUR_MIN_M, type Boite } from './batiments';

const TOIT = 10;
const MUR = 20;
const FENETRE = 30;

/**
 * Décor de test dessiné en caractères (une ligne par rangée de tuiles, à partir de (x0, y0)) :
 * « . » rien, « T » toit, « M » mur avec fenêtre (couche `facades`), « P » mur plein.
 */
function decorDepuis(lignes: string[], x0 = 0, y0 = 0): Decor {
  const blocs = new Map<string, BlocDecor>();
  const poser = (couche: string, x: number, y: number, gid: number) => {
    const [bx, by] = [Math.floor(x / TAILLE_BLOC), Math.floor(y / TAILLE_BLOC)];
    let bloc = blocs.get(cleBloc(bx, by));
    if (!bloc) blocs.set(cleBloc(bx, by), (bloc = { x: bx * TAILLE_BLOC, y: by * TAILLE_BLOC, couches: {} }));
    const gids = (bloc.couches[couche] ??= new Uint32Array(TAILLE_BLOC * TAILLE_BLOC));
    gids[(y - bloc.y) * TAILLE_BLOC + (x - bloc.x)] = gid;
  };
  lignes.forEach((ligne, j) =>
    [...ligne].forEach((c, i) => {
      const [x, y] = [x0 + i, y0 + j];
      poser('sol', x, y, 1);
      if (c === 'T') poser('batiments', x, y, TOIT);
      if (c === 'M' || c === 'P') poser('batiments', x, y, MUR);
      if (c === 'M') poser('facades', x, y, FENETRE);
    }),
  );
  return {
    georef: { origine: [2.36, 48.87] },
    largeur: x0 + Math.max(...lignes.map((l) => l.length)),
    hauteur: y0 + lignes.length,
    tilesets: [],
    nomsCouches: ['sol', 'batiments', 'facades'],
    blocs,
    places: [],
    arbres: [],
  };
}

/** Tuiles couvertes par les boîtes (chacune une seule fois, sinon le test échoue). */
function tuilesCouvertes(boites: Boite[]): Set<string> {
  const couvertes = new Set<string>();
  for (const b of boites) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const cle = `${x},${y}`;
        expect(couvertes.has(cle), `tuile ${cle} couverte deux fois`).toBe(false);
        couvertes.add(cle);
      }
    }
  }
  return couvertes;
}

function tuilesDe(lignes: string[], x0 = 0, y0 = 0): Set<string> {
  const tuiles = new Set<string>();
  lignes.forEach((l, j) => [...l].forEach((c, i) => c !== '.' && tuiles.add(`${x0 + i},${y0 + j}`)));
  return tuiles;
}

describe('bâtiments en volume depuis la tilemap', () => {
  it('sans bâtiment, aucune boîte', () => {
    expect(boitesDeBatiments(decorDepuis(['....', '....']))).toEqual([]);
  });

  it('les boîtes couvrent exactement l’emprise du bâtiment, en peu de morceaux', () => {
    const plan = ['.TTTT...', '.TTTT...', '.TTTTTT.', '.MMMMPM.', '........'];
    const boites = boitesDeBatiments(decorDepuis(plan));
    expect(tuilesCouvertes(boites)).toEqual(tuilesDe(plan));
    expect(boites.length).toBeLessThanOrEqual(2);
  });

  it('un bâtiment a une seule hauteur, déterministe et plausible', () => {
    const plan = ['TTT..', 'TTTTT', 'MMMMM'];
    const boites = boitesDeBatiments(decorDepuis(plan));
    const hauteurs = new Set(boites.map((b) => b.hauteurM));
    expect(hauteurs.size).toBe(1);
    const [h] = hauteurs;
    expect(h).toBeGreaterThanOrEqual(HAUTEUR_MIN_M);
    expect(h).toBeLessThanOrEqual(HAUTEUR_MAX_M);
    expect(boitesDeBatiments(decorDepuis(plan))).toEqual(boites);
  });

  it('deux bâtiments séparés donnent des boîtes séparées', () => {
    const plan = ['TT..TT', 'MM..PP'];
    const boites = boitesDeBatiments(decorDepuis(plan));
    expect(boites.length).toBe(2);
    expect(tuilesCouvertes(boites)).toEqual(tuilesDe(plan));
  });

  it('les hauteurs varient d’un bâtiment à l’autre', () => {
    // Vingt petits bâtiments isolés.
    const ligne = 'TT.'.repeat(20);
    const boites = boitesDeBatiments(decorDepuis([ligne, ligne.replaceAll('T', 'M')]));
    expect(new Set(boites.map((b) => b.hauteurM)).size).toBeGreaterThan(1);
  });

  it('un bâtiment à cheval sur deux blocs de la carte reste un seul bâtiment', () => {
    const plan = ['TTTTTT', 'MMMMMM'];
    // Commence 3 tuiles avant la limite de bloc (x = 32).
    const boites = boitesDeBatiments(decorDepuis(plan, TAILLE_BLOC - 3, 5));
    expect(tuilesCouvertes(boites)).toEqual(tuilesDe(plan, TAILLE_BLOC - 3, 5));
    expect(new Set(boites.map((b) => b.hauteurM)).size).toBe(1);
  });

  it('garde les tuiles Kenney du bâtiment pour habiller toit et façades', () => {
    const boites = boitesDeBatiments(decorDepuis(['TTTT', 'TTTT', 'MMPM']));
    for (const b of boites) expect(b).toMatchObject({ toit: TOIT, mur: MUR, fenetre: FENETRE });
  });

  it('un bâtiment sans fenêtre garde un mur plein', () => {
    const boites = boitesDeBatiments(decorDepuis(['TT', 'PP']));
    for (const b of boites) expect(b).toMatchObject({ toit: TOIT, mur: MUR, fenetre: 0 });
  });
});
