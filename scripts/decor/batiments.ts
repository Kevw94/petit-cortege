/**
 * Autotiling des emprises de bâtiments OSM (polygones quelconques) vers les
 * pièces de bâtiment Kenney, en vue 3/4 :
 *
 * - l'emprise est rasterisée (centre de tuile), seulement là où le sol est
 *   constructible (une rue l'emporte sur un bâtiment qui déborde), puis ouverte
 *   (on ne garde que les tuiles couvertes par un carré 2 × 2 du même bâtiment :
 *   les pièces à taille fixe ne savent pas dessiner un bâtiment d'une tuile de large) ;
 * - façade sur le bord sud : là où la tuile du dessous n'est pas un bâtiment
 *   (rue, cour), sur 3 rangées au plus, en laissant au moins 2 rangées de toit ;
 * - toit en 9 morceaux sur le reste, avec coins rentrants ;
 * - fenêtres et porte dans une couche de détails, par-dessus la façade ;
 * - matériau (toit, mur, fenêtres, porte) tiré par bâtiment, d'après son identifiant OSM.
 */
import type { PointTuiles } from '@petit-cortege/shared';
import { parcourirPolygone } from './raster';
import { MATERIAUX, TIRAGE_MATERIAUX, type Materiau } from './tuiles';

export interface Emprise {
  /** Identifiant OSM (ex. `way/123`) : fixe le matériau du bâtiment. */
  id: string;
  /** Anneaux en tuiles (extérieurs et cours intérieures, remplis pair-impair). */
  anneaux: PointTuiles[][];
}

export interface OptionsBatiments {
  largeur: number;
  hauteur: number;
  emprises: Emprise[];
  /** Vrai si la tuile peut porter un bâtiment (cœur d'îlot, pas une rue ni de l'eau). */
  constructible: (x: number, y: number) => boolean;
}

export interface Batiments {
  /** Gids des toits et des murs, ligne par ligne (largeur × hauteur), 0 hors bâtiment. */
  batiments: Uint32Array;
  /** Gids des fenêtres et portes, par-dessus les murs. */
  facades: Uint32Array;
}

/** Façade : 3 rangées au plus (≈ 6 m) ; le toit garde au moins 2 rangées. */
const RANGEES_FACADE_MAX = 3;
const RANGEES_TOIT_MIN = 2;

/** Hachage FNV-1a 32 bits : même identifiant, même matériau, d'une génération à l'autre. */
function hacher(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function materiauDe(id: string): Materiau {
  return MATERIAUX[TIRAGE_MATERIAUX[hacher(id) % TIRAGE_MATERIAUX.length]!]!;
}

export function autotilerBatiments({ largeur, hauteur, emprises, constructible }: OptionsBatiments): Batiments {
  const n = largeur * hauteur;
  // Numéro de bâtiment par tuile (1 + indice de l'emprise), 0 = aucun.
  const brut = new Int32Array(n);
  emprises.forEach((e, k) =>
    parcourirPolygone(e.anneaux, largeur, hauteur, (x, y) => {
      if (constructible(x, y)) brut[y * largeur + x] = k + 1;
    }),
  );

  // Ouverture 2 × 2.
  const num = new Int32Array(n);
  for (let y = 0; y + 1 < hauteur; y++) {
    for (let x = 0; x + 1 < largeur; x++) {
      const i = y * largeur + x;
      const b = brut[i]!;
      if (b !== 0 && brut[i + 1] === b && brut[i + largeur] === b && brut[i + largeur + 1] === b) {
        num[i] = num[i + 1] = num[i + largeur] = num[i + largeur + 1] = b;
      }
    }
  }
  const bat = (x: number, y: number) => (x < 0 || y < 0 || x >= largeur || y >= hauteur ? 0 : num[y * largeur + x]!);
  const materiaux = emprises.map((e) => materiauDe(e.id));

  const batiments = new Uint32Array(n);
  const facades = new Uint32Array(n);
  const estFacade = new Uint8Array(n);

  // Façades : par tronçon horizontal de tuiles du même bâtiment dont le dessous est libre.
  for (let y = 0; y < hauteur; y++) {
    let x = 0;
    while (x < largeur) {
      const b = bat(x, y);
      if (b === 0 || bat(x, y + 1) !== 0) {
        x++;
        continue;
      }
      const debut = x;
      while (x < largeur && bat(x, y) === b && bat(x, y + 1) === 0) x++;
      const fin = x - 1;
      let rangees = RANGEES_FACADE_MAX;
      for (let cx = debut; cx <= fin; cx++) {
        let colonne = 0;
        while (bat(cx, y - colonne) === b) colonne++;
        rangees = Math.min(rangees, colonne - RANGEES_TOIT_MIN);
      }
      if (rangees <= 0) continue;
      const m = materiaux[b - 1]!;
      const porte = fin - debut >= 2 ? debut + Math.floor((fin - debut + 1) / 2) : -1;
      for (let cx = debut; cx <= fin; cx++) {
        const colonne = debut === fin ? 'seule' : cx === debut ? 'gauche' : cx === fin ? 'droite' : 'milieu';
        for (let j = 0; j < rangees; j++) {
          const i = (y - j) * largeur + cx;
          const rangee =
            rangees === 1 ? m.mur.unique : j === 0 ? m.mur.bas : j === rangees - 1 ? m.mur.haut : m.mur.milieu;
          batiments[i] = rangee[colonne];
          estFacade[i] = 1;
          if (j === 0 && cx === porte) facades[i] = m.porte;
          else if (cx > debut && cx < fin && (cx - debut) % 2 === 1) facades[i] = m.fenetre;
        }
      }
    }
  }

  // Toits : 9 morceaux autour de ce qui n'est pas du toit du même bâtiment.
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const i = y * largeur + x;
      const b = num[i]!;
      if (b === 0 || estFacade[i]) continue;
      const toit = (dx: number, dy: number) => {
        const [vx, vy] = [x + dx, y + dy];
        return bat(vx, vy) === b && !estFacade[vy * largeur + vx];
      };
      batiments[i] = pieceDeToit(materiaux[b - 1]!, toit);
    }
  }
  return { batiments, facades };
}

function pieceDeToit(m: Materiau, toit: (dx: number, dy: number) => boolean): number {
  const t = m.toit;
  const [h, b, g, d] = [!toit(0, -1), !toit(0, 1), !toit(-1, 0), !toit(1, 0)];
  if (h) return g ? t.hautGauche : d ? t.hautDroite : t.haut;
  if (b) return g ? t.basGauche : d ? t.basDroite : t.bas;
  if (g) return t.gauche;
  if (d) return t.droite;
  const creux = [
    [!toit(-1, -1), t.creuxHautGauche],
    [!toit(1, -1), t.creuxHautDroite],
    [!toit(-1, 1), t.creuxBasGauche],
    [!toit(1, 1), t.creuxBasDroite],
  ] as const;
  const ouverts = creux.filter(([ouvert]) => ouvert);
  if (ouverts.length > 1) return t.creuxMultiples;
  return ouverts[0]?.[1] ?? t.plein;
}
