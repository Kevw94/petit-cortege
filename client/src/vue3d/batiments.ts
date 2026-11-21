/**
 * Bâtiments en volume pour la vue 3D, partie pure : à partir des couches de bâtiments de la
 * tilemap (#13 : emprises OSM rasterisées en pièces Kenney), des boîtes extrudées.
 *
 * Un bâtiment = un groupe de tuiles de bâtiment voisines (4-connexité). Il a une seule
 * hauteur, tirée de façon déterministe de sa première tuile (même rendu pour tout le monde),
 * et ses tuiles Kenney : la plus fréquente du toit, du mur et des fenêtres de sa façade en
 * vue 3/4, réutilisées pour habiller le toit et les murs des boîtes (ADR 0006 : rien de
 * dessiné à la main). Chaque bâtiment est découpé en rectangles (maillage glouton).
 */
import { TAILLE_BLOC, type Decor } from '@petit-cortege/shared';
import { tirageIdentifiant } from '../cortege/hachage';

/** Couches de la tilemap : toits et murs, puis fenêtres et portes (voir COUCHES_BATIMENTS). */
const COUCHE_BATIMENTS = 'batiments';
const COUCHE_FACADES = 'facades';
/** Façade en vue 3/4 : au plus 3 rangées de tuiles au bas d'un bâtiment (scripts/decor/batiments.ts). */
const RANGEES_FACADE_MAX = 3;

/** Hauteurs possibles (m) : 5 à 7 étages, comme les immeubles parisiens. */
const HAUTEURS_M = [15, 18, 18, 21, 21, 24] as const;
export const HAUTEUR_MIN_M = Math.min(...HAUTEURS_M);
export const HAUTEUR_MAX_M = Math.max(...HAUTEURS_M);

export interface Boite {
  /** Rectangle au sol, en tuiles (x1 et y1 exclus). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hauteurM: number;
  /** Gids des tuiles Kenney : toit, mur, fenêtre (0 : mur plein). */
  toit: number;
  mur: number;
  fenetre: number;
}

/** Valeur la plus fréquente (la plus petite en cas d'égalité), ou `undefined`. */
function plusFrequent(valeurs: number[]): number | undefined {
  const comptes = new Map<number, number>();
  for (const v of valeurs) comptes.set(v, (comptes.get(v) ?? 0) + 1);
  let meilleur: number | undefined;
  let n = 0;
  for (const [v, c] of comptes) if (c > n || (c === n && v < meilleur!)) [meilleur, n] = [v, c];
  return meilleur;
}

export function boitesDeBatiments(decor: Decor): Boite[] {
  const blocs = [...decor.blocs.values()].filter((b) => b.couches[COUCHE_BATIMENTS]?.some((g) => g !== 0));
  if (blocs.length === 0) return [];
  // Grille couvrant les blocs qui ont des bâtiments.
  const gx = Math.min(...blocs.map((b) => b.x));
  const gy = Math.min(...blocs.map((b) => b.y));
  const largeur = Math.max(...blocs.map((b) => b.x)) + TAILLE_BLOC - gx;
  const hauteur = Math.max(...blocs.map((b) => b.y)) + TAILLE_BLOC - gy;
  const batiment = new Uint32Array(largeur * hauteur);
  const facade = new Uint32Array(largeur * hauteur);
  for (const bloc of blocs) {
    const b = bloc.couches[COUCHE_BATIMENTS]!;
    const f = bloc.couches[COUCHE_FACADES];
    for (let i = 0; i < TAILLE_BLOC * TAILLE_BLOC; i++) {
      const k = (bloc.y - gy + Math.floor(i / TAILLE_BLOC)) * largeur + (bloc.x - gx + (i % TAILLE_BLOC));
      batiment[k] = b[i]!;
      facade[k] = f?.[i] ?? 0;
    }
  }

  // Groupes de tuiles voisines (parcours en largeur), numérotés dans l'ordre de lecture.
  const groupe = new Int32Array(largeur * hauteur).fill(-1);
  const groupes: number[][] = [];
  for (let k0 = 0; k0 < batiment.length; k0++) {
    if (batiment[k0] === 0 || groupe[k0] !== -1) continue;
    const n = groupes.length;
    const tuiles = [k0];
    groupe[k0] = n;
    for (let t = 0; t < tuiles.length; t++) {
      const k = tuiles[t]!;
      const x = k % largeur;
      for (const v of [x > 0 ? k - 1 : -1, x < largeur - 1 ? k + 1 : -1, k - largeur, k + largeur]) {
        if (v < 0 || v >= batiment.length || batiment[v] === 0 || groupe[v] !== -1) continue;
        groupe[v] = n;
        tuiles.push(v);
      }
    }
    groupes.push(tuiles);
  }

  const dans = (k: number, n: number) => k >= 0 && k < groupe.length && groupe[k] === n;
  const boites: Boite[] = [];
  const pris = new Uint8Array(largeur * hauteur);
  groupes.forEach((tuiles, n) => {
    const premiere = tuiles[0]!;
    const hauteurM =
      HAUTEURS_M[
        tirageIdentifiant(`${gx + (premiere % largeur)},${gy + Math.floor(premiere / largeur)}`) % HAUTEURS_M.length
      ]!;
    // Toit : tuiles qui ont au moins RANGEES_FACADE_MAX rangées du bâtiment en dessous (jamais la façade).
    const sousToit = (k: number) =>
      Array.from({ length: RANGEES_FACADE_MAX }, (_, r) => k + (r + 1) * largeur).every((v) => dans(v, n));
    const sansFenetre = tuiles.filter((k) => facade[k] === 0);
    const toit =
      plusFrequent(sansFenetre.filter(sousToit).map((k) => batiment[k]!)) ??
      plusFrequent(sansFenetre.filter((k) => dans(k + largeur, n)).map((k) => batiment[k]!)) ??
      plusFrequent(tuiles.map((k) => batiment[k]!))!;
    const avecFenetre = tuiles.filter((k) => facade[k] !== 0);
    const bas = tuiles.filter((k) => !dans(k + largeur, n));
    const mur = plusFrequent((avecFenetre.length > 0 ? avecFenetre : bas).map((k) => batiment[k]!))!;
    const fenetre = plusFrequent(avecFenetre.map((k) => facade[k]!)) ?? 0;

    // Maillage glouton : rectangles les plus larges possible, puis étendus vers le bas.
    for (const k of [...tuiles].sort((a, b) => a - b)) {
      if (pris[k]) continue;
      const x0 = k % largeur;
      const y0 = Math.floor(k / largeur);
      let x1 = x0 + 1;
      while (x1 < largeur && dans(y0 * largeur + x1, n) && !pris[y0 * largeur + x1]) x1++;
      let y1 = y0 + 1;
      const rangeeLibre = (y: number) => {
        for (let x = x0; x < x1; x++) if (!dans(y * largeur + x, n) || pris[y * largeur + x]) return false;
        return true;
      };
      while (y1 < hauteur && rangeeLibre(y1)) y1++;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pris[y * largeur + x] = 1;
      boites.push({ x0: gx + x0, y0: gy + y0, x1: gx + x1, y1: gy + y1, hauteurM, toit, mur, fenetre });
    }
  });
  return boites;
}
