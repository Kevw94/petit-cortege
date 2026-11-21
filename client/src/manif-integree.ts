/**
 * Manif inscrite dans le HTML de sa page (`#donnees-manif`), pour ouvrir le
 * cortège quand elle n'est plus dans la liste publiée (ADR 0010).
 */
import type { ManifPubliee, Position } from '@petit-cortege/shared';

function estPosition(valeur: unknown): valeur is Position {
  return Array.isArray(valeur) && valeur.length >= 2 && typeof valeur[0] === 'number' && typeof valeur[1] === 'number';
}

function estInstant(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && Number.isFinite(Date.parse(valeur));
}

/** Lit l'objet publié embarqué. `undefined` si le texte est absent, illisible, ou d'une autre manif. */
export function lireManifIntegree(texte: string | null | undefined, idAttendu: string): ManifPubliee | undefined {
  if (!texte) return;
  let json: unknown;
  try {
    json = JSON.parse(texte);
  } catch {
    return;
  }
  if (typeof json !== 'object' || json === null) return;
  const m = json as Record<string, unknown>;
  if (m.id !== idAttendu) return;
  if (typeof m.intitule !== 'string' || typeof m.ville !== 'string') return;
  if (!estInstant(m.ouverture) || !estInstant(m.depart) || !estInstant(m.fin)) return;
  if (typeof m.longueurM !== 'number' || typeof m.compteur !== 'number') return;
  if (!Array.isArray(m.sources)) return;
  const parcours = m.parcours as { type?: unknown; coordinates?: unknown } | null;
  if (parcours?.type !== 'LineString' || !Array.isArray(parcours.coordinates) || parcours.coordinates.length < 2) {
    return;
  }
  if (!parcours.coordinates.every(estPosition)) return;
  return json as ManifPubliee;
}
