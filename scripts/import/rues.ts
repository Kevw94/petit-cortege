/**
 * Rues annoncées (« passera par la rue Stanislas, le boulevard Joffre… ») :
 * leur géométrie vient d'OpenStreetMap (Overpass, ODbL), et le cortège les
 * parcourt entre leurs **raccords** avec l'étape d'avant et celle d'après :
 * le croisement des deux rues quand elles se croisent, sinon leurs points les
 * plus proches (l'itinéraire piéton relie alors les deux par des rues non
 * annoncées, ce qui est signalé).
 */
import { distanceM, type Position } from '@petit-cortege/shared';
import { ErreurImport } from './fichier';
import { normaliser } from './geocodage';
import { interrogerOverpass } from './overpass';
import type { Reseau } from './reseau';

/** Une rue : ses nœuds OSM (identifiant → position). */
export interface GeometrieRue {
  nom: string;
  noeuds: Map<number, Position>;
}

/** Marge autour des étapes pour chercher les rues dans OSM (m). */
const MARGE_RECHERCHE_M = 800;
/** Le point BAN d'une rue doit être à moins de cette distance de sa géométrie OSM. */
const ECART_BAN_OSM_MAX_M = 150;
/** Au-delà, un raccord non annoncé entre deux rues est signalé. */
export const RACCORD_SIGNALE_M = 30;

const CLASSES: Record<string, string> = {
  a: 'aàâäAÀÂÄ',
  e: 'eéèêëEÉÈÊË',
  i: 'iîïIÎÏ',
  o: 'oôöOÔÖ',
  u: 'uùûüUÙÛÜ',
  c: 'cçCÇ',
  y: 'yÿYŸ',
};

/** Motif Overpass d'un nom normalisé, insensible aux accents, à la casse, aux tirets et apostrophes. */
export function motifDeNom(nomNormalise: string): string {
  return [...nomNormalise]
    .map((c) => (c === ' ' ? "[-  '’.]+" : CLASSES[c] ? `[${CLASSES[c]}]` : c))
    .join('');
}

export function requeteRues(noms: string[], autour: Position[]): string {
  const lats = autour.map((p) => p[1]);
  const lons = autour.map((p) => p[0]);
  const dLat = MARGE_RECHERCHE_M / 111_000;
  const dLon = MARGE_RECHERCHE_M / (111_000 * Math.cos((Math.max(...lats) * Math.PI) / 180));
  const boite = [Math.min(...lats) - dLat, Math.min(...lons) - dLon, Math.max(...lats) + dLat, Math.max(...lons) + dLon]
    .map((x) => x.toFixed(5))
    .join(',');
  const motifs = [...new Set(noms.map(normaliser))].map(motifDeNom).join('|');
  return `[out:json][timeout:60];\nway["highway"]["name"~"^(${motifs})$",i](${boite});\nout geom;`;
}

/**
 * Géométries OSM des rues `noms` (noms BAN), près des points `autour`. Chaque
 * rue doit exister dans OSM près de son point BAN (`pointsBan`, même ordre).
 */
export async function geometriesRues(
  reseau: Reseau,
  urlsOverpass: string[],
  noms: string[],
  pointsBan: Position[],
  autour: Position[],
  quoi: (rang: number) => string,
  journal?: (ligne: string) => void,
): Promise<GeometrieRue[]> {
  const { extrait } = await interrogerOverpass(reseau, urlsOverpass, requeteRues(noms, autour), journal);
  return noms.map((nom, rang) => {
    const noeuds = new Map<number, Position>();
    for (const e of extrait.elements) {
      if (e.type !== 'way' || normaliser(e.tags?.name ?? '') !== normaliser(nom)) continue;
      (e.nodes ?? []).forEach((id, i) => {
        const g = e.geometry?.[i];
        if (g) noeuds.set(id, [g.lon, g.lat]);
      });
    }
    if (noeuds.size === 0) throw new ErreurImport(`${quoi(rang)} : rue « ${nom} » introuvable dans OpenStreetMap près des autres étapes.`);
    const ecart = Math.min(...[...noeuds.values()].map((p) => distanceM(p, pointsBan[rang]!)));
    if (ecart > ECART_BAN_OSM_MAX_M) {
      throw new ErreurImport(
        `${quoi(rang)} : la rue « ${nom} » d'OpenStreetMap est à ${Math.round(ecart)} m du point de la Base Adresse ; homonyme ? Donner des « position ».`,
      );
    }
    return { nom, noeuds };
  });
}

/** Point de la rue le plus proche de `p`. */
export function pointLePlusProche(rue: GeometrieRue, p: Position): Position {
  let meilleur: Position = p;
  let d = Infinity;
  for (const q of rue.noeuds.values()) {
    const dq = distanceM(p, q);
    if (dq < d) [meilleur, d] = [q, dq];
  }
  return meilleur;
}

/**
 * Raccord entre deux rues consécutives : leur croisement (nœud commun ; s'il y
 * en a plusieurs, le plus proche de `reference`), sinon le couple de points les
 * plus proches. Renvoie le point de sortie de `a` et le point d'entrée de `b`.
 */
export function raccorder(a: GeometrieRue, b: GeometrieRue, reference: Position): { sortieA: Position; entreeB: Position; ecartM: number } {
  const communs = [...a.noeuds.keys()].filter((id) => b.noeuds.has(id)).map((id) => a.noeuds.get(id)!);
  if (communs.length > 0) {
    const croisement = communs.reduce((m, p) => (distanceM(p, reference) < distanceM(m, reference) ? p : m));
    return { sortieA: croisement, entreeB: croisement, ecartM: 0 };
  }
  let meilleur = { sortieA: reference, entreeB: reference, ecartM: Infinity };
  for (const pa of a.noeuds.values()) {
    for (const pb of b.noeuds.values()) {
      const d = distanceM(pa, pb);
      if (d < meilleur.ecartM) meilleur = { sortieA: pa, entreeB: pb, ecartM: d };
    }
  }
  return meilleur;
}
