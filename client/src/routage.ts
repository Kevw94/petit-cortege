/**
 * Routage.
 *
 * La page publique d'une manif est `/manif/<id>` (ADR 0010) : c'est l'adresse
 * indexable, demandée au serveur. Les liens déjà partagés restent des fragments
 * (`#/manif/<id>`), et les pages légales aussi (`/#/vie-privee`).
 */
export const IDS_PAGES_LEGALES = ['mentions-legales', 'vie-privee', 'charte', 'cgu'] as const;
export type IdPageLegale = (typeof IDS_PAGES_LEGALES)[number];

export type Route = { page: 'liste' } | { page: 'manif'; id: string } | { page: 'legale'; id: IdPageLegale };

function decoder(id: string): string | undefined {
  try {
    return decodeURIComponent(id);
  } catch {
    return;
  }
}

/**
 * `adresse` est un fragment (`#/…`), un chemin (`/manif/…`) ou les deux
 * (`/manif/…#/…`, ou `/#/vie-privee`). Un fragment qui nomme une page gagne
 * sur le chemin : `#/` revient à la liste, `#/vie-privee` ouvre la page légale.
 */
export function lireRoute(adresse: string): Route {
  const diese = adresse.indexOf('#');
  const chemin = (diese >= 0 ? adresse.slice(0, diese) : adresse).split('?')[0] ?? '';
  const hash = diese >= 0 ? adresse.slice(diese) : '';
  if (hash === '#/') return { page: 'liste' };
  const pageLegale = IDS_PAGES_LEGALES.find((id) => hash === `#/${id}`);
  if (pageLegale) return { page: 'legale', id: pageLegale };
  const hashManif = /^#\/manif\/([^/?#]+)$/.exec(hash);
  if (hashManif) {
    const id = decoder(hashManif[1]!);
    if (id) return { page: 'manif', id };
  }
  const cheminManif = /^\/manif\/([^/?#]+)\/?$/.exec(chemin);
  if (cheminManif && (hash === '' || hash === '#')) {
    const id = decoder(cheminManif[1]!);
    if (id) return { page: 'manif', id };
  }
  return { page: 'liste' };
}

/** Pages légales et de confiance (mentions légales, vie privée, charte, CGU). */
export function lienPageLegale(id: IdPageLegale): string {
  return `/#/${id}`;
}

/** Page publique de la manif. Absolue depuis la racine, pour marcher aussi depuis `/manif/…`. */
export function lienManif(id: string): string {
  return `/manif/${encodeURIComponent(id)}`;
}
