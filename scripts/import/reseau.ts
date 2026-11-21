/**
 * Accès réseau de l'import des manifs : `fetch` et attente injectés (tests sans
 * réseau), délai d'attente, quelques réessais avec attente croissante, et un
 * User-Agent neutre (aucune donnée personnelle : ni nom, ni e-mail).
 */

export const USER_AGENT = 'petit-cortege-import/1';

/** Sous-ensemble de `fetch` utilisé ici. */
export type Recuperer = (url: string, init?: RequestInit) => Promise<Response>;

export interface Reseau {
  recuperer: Recuperer;
  /** Attente entre deux réessais (injectée : instantanée dans les tests). */
  dormir: (ms: number) => Promise<void>;
  /** Délai d'attente d'une requête, en ms. */
  delaiMs?: number;
  /** Nombre d'essais par requête (1 = pas de réessai). */
  essais?: number;
}

export const reseauReel = (): Reseau => ({
  recuperer: (url, init) => fetch(url, init),
  dormir: (ms) => new Promise((ok) => setTimeout(ok, ms)),
});

/** Échec d'un service distant (après réessais) : le repli éventuel prend le relais. */
export class ErreurService extends Error {
  override name = 'ErreurService';
}

const DELAI_PAR_DEFAUT_MS = 30_000;
const ESSAIS_PAR_DEFAUT = 3;
/** Attente avant le 2e essai ; doublée à chaque essai suivant. */
const ATTENTE_INITIALE_MS = 1_000;

/** Codes HTTP pour lesquels un nouvel essai a un sens (surcharge, panne passagère). */
const reessayable = (statut: number) => statut === 408 || statut === 429 || statut >= 500;

/**
 * Requête HTTP qui renvoie le corps en texte ; réessaie sur erreur réseau, délai
 * dépassé ou HTTP 408/429/5xx. Un autre code HTTP (ex. 400) est définitif.
 */
export async function requeteTexte(reseau: Reseau, url: string, init: RequestInit = {}): Promise<string> {
  const essais = reseau.essais ?? ESSAIS_PAR_DEFAUT;
  const hote = new URL(url).host;
  let derniere = '';
  for (let essai = 1; essai <= essais; essai++) {
    if (essai > 1) await reseau.dormir(ATTENTE_INITIALE_MS * 2 ** (essai - 2));
    let reponse: Response;
    try {
      reponse = await reseau.recuperer(url, {
        ...init,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(reseau.delaiMs ?? DELAI_PAR_DEFAUT_MS),
      });
    } catch (erreur) {
      const e = erreur as Error & { cause?: { message?: string } };
      derniere = `${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}${e.cause?.message ? ` (${e.cause.message})` : ''}`;
      continue;
    }
    const texte = await reponse.text();
    if (reponse.ok) return texte;
    derniere = `HTTP ${reponse.status} ${texte.slice(0, 200).replace(/\s+/g, ' ')}`;
    if (!reessayable(reponse.status)) break;
  }
  throw new ErreurService(`${hote} : ${derniere}`);
}

export async function requeteJson<T>(reseau: Reseau, url: string, init: RequestInit = {}): Promise<T> {
  const texte = await requeteTexte(reseau, url, init);
  try {
    return JSON.parse(texte) as T;
  } catch {
    throw new ErreurService(`${new URL(url).host} : réponse qui n'est pas du JSON (${texte.slice(0, 100)})`);
  }
}
