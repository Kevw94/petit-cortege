/**
 * Routage par fragment (ADR 0002) : l'identifiant de manif reste dans le
 * fragment (`#/manif/<id>`), jamais envoyé au serveur ni au CDN.
 * Ne pas « corriger » vers un routage par chemin ou des paramètres de requête.
 */
export type Route = { page: 'liste' } | { page: 'manif'; id: string };

export function lireRoute(fragment: string): Route {
  const correspondance = /^#\/manif\/([^/?#]+)$/.exec(fragment);
  if (correspondance) return { page: 'manif', id: decodeURIComponent(correspondance[1]!) };
  return { page: 'liste' };
}

export function lienManif(id: string): string {
  return `#/manif/${encodeURIComponent(id)}`;
}
