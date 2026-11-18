/**
 * Mesure d'audience Umami, auto-hébergée sur stats.petit-cortege.fr.
 *
 * Le script n'est chargé qu'en production, et seulement si l'identifiant de site
 * a été fourni au build (`VITE_UMAMI_WEBSITE_ID`). Aucun identifiant n'est écrit
 * dans le code. Une page de manif est un chemin (`/manif/…`, ADR 0010) : le
 * premier affichage est compté par le script. Les pages légales et les anciens
 * liens restent des fragments (`#/…`) : le script Umami déployé n'écoute pas
 * `hashchange`, donc chaque changement de fragment est compté ici.
 */

const ID_SITE_UMAMI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Script du tracker. L'identifiant de site, lui, vient de l'environnement. */
export const SCRIPT_MESURE_AUDIENCE = 'https://stats.petit-cortege.fr/script.js';

export interface OptionsMesureAudience {
  /** Vrai pour un build de production (`import.meta.env.PROD`). */
  production: boolean;
  /** `VITE_UMAMI_WEBSITE_ID`, tel que Vite l'a inscrit au build. */
  identifiant: string | undefined;
}

export interface BaliseMesureAudience {
  src: typeof SCRIPT_MESURE_AUDIENCE;
  defer: true;
  /** Attribut `data-website-id`. */
  websiteId: string;
  /** Attribut `data-do-not-track` : Umami s'abstient si le navigateur l'envoie. */
  doNotTrack: 'true';
}

export interface EmplacementPage {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface ProprietesUmami {
  url?: string;
  referrer?: string;
}

declare global {
  interface Window {
    umami?: {
      track(evenement: (props: ProprietesUmami) => ProprietesUmami): void;
    };
  }
}

/** UUID Umami, ou null si la variable est absente, vide ou inutilisable. */
export function identifiantMesureAudience(valeur: string | undefined): string | null {
  const id = valeur?.trim() ?? '';
  return ID_SITE_UMAMI.test(id) ? id : null;
}

/**
 * Balise à insérer, ou null : pas de production, ou pas d'identifiant.
 * Dans ce cas aucun script n'est chargé.
 */
export function scriptMesureAudience(options: OptionsMesureAudience): BaliseMesureAudience | null {
  if (!options.production) return null;
  const websiteId = identifiantMesureAudience(options.identifiant);
  if (!websiteId) return null;
  return { src: SCRIPT_MESURE_AUDIENCE, defer: true, websiteId, doNotTrack: 'true' };
}

/** Adresse comptée : chemin, requête, et fragment (les pages du site sont dans le fragment). */
export function urlDePage(emplacement: EmplacementPage): string {
  return `${emplacement.pathname}${emplacement.search}${emplacement.hash}`;
}

/**
 * À appeler à chaque `hashchange`. La première page n'est pas renvoyée :
 * le script Umami la compte déjà au chargement.
 */
export function creerSuiviDeFragment(lireUrl: () => string): () => { url: string; referrer: string } {
  let precedente = lireUrl();
  return () => {
    const url = lireUrl();
    const referrer = precedente;
    precedente = url;
    return { url, referrer };
  };
}

/** Insère le script et compte les changements de fragment. Ne fait rien si la mesure est inactive. */
export function brancherMesureAudience(doc: Document, fenetre: Window, options: OptionsMesureAudience): void {
  const balise = scriptMesureAudience(options);
  if (!balise || !doc.head) return;
  const script = doc.createElement('script');
  script.defer = balise.defer;
  script.src = balise.src;
  script.dataset.websiteId = balise.websiteId;
  script.dataset.doNotTrack = balise.doNotTrack;
  doc.head.appendChild(script);

  const changement = creerSuiviDeFragment(() => urlDePage(fenetre.location));
  fenetre.addEventListener('hashchange', () => {
    const page = changement();
    fenetre.umami?.track((props) => ({ ...props, url: page.url, referrer: page.referrer }));
  });
}
