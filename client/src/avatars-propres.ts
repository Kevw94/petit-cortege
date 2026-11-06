/**
 * Avatars du soutien sur cet appareil, gardés en localStorage pour les
 * retrouver (mise en valeur « toi ») après un rechargement.
 *
 * Ce sont des liens appareil ↔ manif : ils sont effacés au plus tard 1 h après
 * la fin de la manif (ADR 0001), à chaque lecture. Rien n'est envoyé au serveur.
 * Le retrait (#7) ajoutera son jeton à ces enregistrements.
 */
import { MARGE_FIN_MS, type EntreePubliee } from '@petit-cortege/shared';

const CLE = 'petit-cortege.avatars';

interface Enregistrement extends EntreePubliee {
  /** Instant (ms epoch) au-delà duquel l'enregistrement est effacé : fin de la manif + 1 h. */
  efface: number;
}

/** Délai d'effacement après la fin (ADR 0001 : au plus tard 1 h). */
const CONSERVATION_APRES_FIN_MS = MARGE_FIN_MS;

function lire(): Enregistrement[] {
  try {
    const brut: unknown = JSON.parse(localStorage.getItem(CLE) ?? '[]');
    return Array.isArray(brut) ? (brut as Enregistrement[]) : [];
  } catch {
    return [];
  }
}

function ecrire(enregistrements: Enregistrement[]): void {
  try {
    if (enregistrements.length === 0) localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, JSON.stringify(enregistrements));
  } catch {
    // stockage indisponible (navigation privée…) : la mise en valeur ne survivra pas au rechargement
  }
}

/** Avatars propres encore conservés ; efface au passage ceux des manifs finies depuis plus d'1 h. */
export function avatarsPropres(maintenant: Date): EntreePubliee[] {
  const tous = lire();
  const gardes = tous.filter((e) => e.efface > maintenant.getTime());
  if (gardes.length !== tous.length) ecrire(gardes);
  return gardes.map(({ a, m, t, ap, pa }) => ({ a, m, t, ap, pa }));
}

export function memoriserAvatarPropre(entree: EntreePubliee, finManif: string): void {
  const efface = Date.parse(finManif) + CONSERVATION_APRES_FIN_MS;
  ecrire([...lire().filter((e) => e.a !== entree.a), { ...entree, efface }]);
}
