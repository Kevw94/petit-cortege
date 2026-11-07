/**
 * Avatars du soutien sur cet appareil, gardés en localStorage pour les
 * retrouver (mise en valeur « toi ») après un rechargement, avec le jeton qui
 * permet de les retirer.
 *
 * Ce sont des liens appareil ↔ manif (ADR 0001), purgés à chaque lecture :
 * - le jeton de retrait est effacé à la fin de la manif (story 34) ;
 * - l'avatar lui-même au plus tard 1 h après la fin (mise en valeur dans l'image finale).
 * Rien de tout cela n'est envoyé au serveur, sauf le jeton au moment du retrait.
 */
import { MARGE_FIN_MS, type EntreePubliee } from '@petit-cortege/shared';

const CLE = 'petit-cortege.avatars';

interface Enregistrement extends EntreePubliee {
  /** Instant (ms epoch) au-delà duquel l'enregistrement est effacé : fin de la manif + 1 h. */
  efface: number;
  /** Jeton de retrait en clair (jamais envoyé avant le retrait). */
  jeton?: string;
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

/** Relit et purge : avatars des manifs finies depuis plus d'1 h, jetons des manifs finies. */
function lirePurge(maintenant: Date): Enregistrement[] {
  const t = maintenant.getTime();
  const tous = lire();
  let change = false;
  const gardes: Enregistrement[] = [];
  for (const e of tous) {
    if (e.efface <= t) {
      change = true;
      continue;
    }
    const finManif = e.efface - CONSERVATION_APRES_FIN_MS;
    if (e.jeton !== undefined && finManif <= t) {
      const { jeton: _efface, ...sansJeton } = e;
      gardes.push(sansJeton);
      change = true;
    } else gardes.push(e);
  }
  if (change) ecrire(gardes);
  return gardes;
}

/** Avatars propres encore conservés. */
export function avatarsPropres(maintenant: Date): EntreePubliee[] {
  return lirePurge(maintenant).map(({ a, m, t, ap, pa }) => ({ a, m, t, ap, pa }));
}

/** Jeton de retrait de cet avatar, s'il est encore conservé (avant la fin de la manif). */
export function jetonDeRetrait(avatar: string, maintenant: Date): string | undefined {
  return lirePurge(maintenant).find((e) => e.a === avatar)?.jeton;
}

export function memoriserAvatarPropre(entree: EntreePubliee, finManif: string, jeton: string): void {
  const efface = Date.parse(finManif) + CONSERVATION_APRES_FIN_MS;
  ecrire([...lire().filter((e) => e.a !== entree.a), { ...entree, efface, jeton }]);
}

/**
 * Recale les effacements sur la fin publiée de chaque manif (départ corrigé par un
 * modérateur, #9), puis purge : jamais plus d'1 h après la vraie fin (ADR 0001).
 * À appeler à chaque lecture de la liste des manifs.
 */
export function suivreFinsDesManifs(manifs: readonly { id: string; fin: string }[], maintenant: Date): void {
  const fins = new Map(manifs.map((m) => [m.id, Date.parse(m.fin)]));
  const enregistrements = lire();
  let change = false;
  for (const e of enregistrements) {
    const fin = fins.get(e.m);
    if (fin === undefined || e.efface === fin + CONSERVATION_APRES_FIN_MS) continue;
    e.efface = fin + CONSERVATION_APRES_FIN_MS;
    change = true;
  }
  if (change) ecrire(enregistrements);
  lirePurge(maintenant);
}

/** Oublie un avatar retiré : plus de mise en valeur, plus de jeton. */
export function oublierAvatarPropre(avatar: string): void {
  ecrire(lire().filter((e) => e.a !== avatar));
}

/** Oublie le jeton de retrait d'un avatar (retrait refusé pour de bon) ; l'avatar reste mis en valeur. */
export function oublierJetonDeRetrait(avatar: string): void {
  ecrire(
    lire().map((e) => {
      if (e.a !== avatar) return e;
      const { jeton: _oublie, ...sansJeton } = e;
      return sansJeton;
    }),
  );
}
