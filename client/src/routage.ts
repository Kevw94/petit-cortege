/**
 * Routage par fragment (ADR 0002) : l'identifiant de manif reste dans le
 * fragment (`#/manif/<id>`), jamais envoyé au serveur.
 * Ne pas « corriger » vers un routage par chemin ou des paramètres de requête.
 */
export const IDS_PAGES_LEGALES = ['mentions-legales', 'vie-privee', 'charte', 'cgu'] as const;
export type IdPageLegale = (typeof IDS_PAGES_LEGALES)[number];

export type Route = { page: 'liste' } | { page: 'manif'; id: string } | { page: 'legale'; id: IdPageLegale };

export function lireRoute(fragment: string): Route {
  const correspondance = /^#\/manif\/([^/?#]+)$/.exec(fragment);
  if (correspondance) return { page: 'manif', id: decodeURIComponent(correspondance[1]!) };
  const pageLegale = IDS_PAGES_LEGALES.find((id) => fragment === lienPageLegale(id));
  if (pageLegale) return { page: 'legale', id: pageLegale };
  return { page: 'liste' };
}

/** Pages légales et de confiance (mentions légales, vie privée, charte, CGU). */
export function lienPageLegale(id: IdPageLegale): string {
  return `#/${id}`;
}

export function lienManif(id: string): string {
  return `#/manif/${encodeURIComponent(id)}`;
}
