/**
 * Partage et téléchargement de l'image finale : le PNG est généré sur l'appareil et ne
 * passe jamais par le serveur. Partage natif du téléphone (`navigator.share` avec le
 * fichier) quand le navigateur le permet, sinon téléchargement.
 *
 * Nom de fichier neutre, et rien d'autre que le fichier n'est partagé (ni texte, ni
 * URL avec le fragment de la manif) : c'est le soutien qui choisit ce qu'il en dit.
 */

export const NOM_FICHIER_IMAGE = 'petit-cortege.png';

export type NavigateurPartage = Partial<Pick<Navigator, 'share' | 'canShare'>>;

export interface EnvironnementPartage {
  navigateur: NavigateurPartage;
  /** Propose le fichier au téléchargement (lien `download` dans le navigateur). */
  telecharger: (fichier: Blob, nom: string) => void;
}

export type IssuePartage = 'partage' | 'telechargement' | 'annule';

function fichierImage(png: Blob): File {
  return new File([png], NOM_FICHIER_IMAGE, { type: 'image/png' });
}

/** Le navigateur sait-il partager un fichier image (partage natif du téléphone) ? */
export function peutPartagerUneImage(navigateur: NavigateurPartage, png?: Blob): boolean {
  if (typeof navigateur.share !== 'function' || typeof navigateur.canShare !== 'function') return false;
  try {
    return navigateur.canShare({ files: [fichierImage(png ?? new Blob([], { type: 'image/png' }))] });
  } catch {
    return false;
  }
}

export function telechargerImage(png: Blob, { telecharger }: EnvironnementPartage): void {
  telecharger(png, NOM_FICHIER_IMAGE);
}

/** Partage natif si possible ; sinon (ou en cas d'échec) téléchargement. Fermer la feuille de partage n'est pas un échec. */
export async function partagerImage(png: Blob, environnement: EnvironnementPartage): Promise<IssuePartage> {
  if (peutPartagerUneImage(environnement.navigateur, png)) {
    try {
      await environnement.navigateur.share!({ files: [fichierImage(png)] });
      return 'partage';
    } catch (erreur) {
      if (erreur instanceof Error && erreur.name === 'AbortError') return 'annule';
    }
  }
  telechargerImage(png, environnement);
  return 'telechargement';
}

/** Téléchargement dans le navigateur : lien `download` sur une URL locale (`blob:`), rien n'est envoyé. */
export function telechargerDansLeNavigateur(fichier: Blob, nom: string): void {
  const url = URL.createObjectURL(fichier);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nom;
  lien.rel = 'noopener';
  document.body.append(lien);
  lien.click();
  lien.remove();
  // Laisse au navigateur le temps de lire le fichier avant de libérer l'URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
