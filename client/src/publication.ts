/**
 * Lecture des fichiers publiés. Les requêtes sont identiques pour tous les
 * clients : aucune ne contient d'identifiant de manif (ADR 0002).
 */
import {
  CHEMIN_LISTE_MANIFS,
  PREFIXE_PUBLICATION,
  cheminEntreesHeure,
  cheminEntreesMinute,
  fichiersPublies,
  lireEntreesHeure,
  lireEntreesMinute,
  lireListeManifs,
  type FichierEntrees,
  type ListeManifs,
  type ManifPubliee,
} from '@petit-cortege/shared';

const REQUETES_SIMULTANEES = 6;

/** Un fichier à télécharger et la fonction qui vérifie son format. */
type ATelecharger = [chemin: string, lire: (json: unknown) => FichierEntrees];

export class Publication {
  /** Fichiers d'entrées déjà chargés (immuables, par minute ou par heure), par chemin. */
  readonly #fichiers = new Map<string, FichierEntrees>();

  readonly base: string;

  constructor(base: string = PREFIXE_PUBLICATION) {
    this.base = base;
  }

  async listeManifs(): Promise<ListeManifs> {
    const reponse = await fetch(this.base + CHEMIN_LISTE_MANIFS, { cache: 'no-cache' });
    if (!reponse.ok) throw new Error(`Liste des manifs indisponible (${reponse.status})`);
    return lireListeManifs(await reponse.json());
  }

  /**
   * Charge les fichiers d'entrées de la manif publiés à `maintenant` qui ne sont
   * pas encore en mémoire, et renvoie tous ceux qu'on a : un fichier horaire par
   * heure terminée, les fichiers par minute de l'heure en cours.
   *
   * Pour une heure terminée dont on a déjà des minutes (soutien présent depuis
   * le début), on complète avec les minutes plutôt que de télécharger l'heure.
   * Si le fichier horaire n'est pas encore publié, on se rabat sur ses minutes.
   * Un fichier absent (404, horloge en avance) sera redemandé plus tard.
   */
  async entreesPour(manif: ManifPubliee, maintenant: Date): Promise<FichierEntrees[]> {
    const { heures, minutes } = fichiersPublies(manif, maintenant);
    const enMemoire = (chemin: string) => this.#fichiers.has(chemin);
    const parMinute = (liste: Date[]) => liste.map((m): ATelecharger => [cheminEntreesMinute(m), lireEntreesMinute]);

    const terminees = heures.map(({ heure, minutes: deLHeure }) => {
      const cheminHeure = cheminEntreesHeure(heure);
      const minutesDeLHeure = parMinute(deLHeure);
      const enMinutes = !enMemoire(cheminHeure) && minutesDeLHeure.some(([c]) => enMemoire(c));
      return { cheminHeure, minutesDeLHeure, enMinutes };
    });
    const heureEnCours = parMinute(minutes);

    await this.#telecharger([
      ...terminees.flatMap((h): ATelecharger[] => (h.enMinutes ? h.minutesDeLHeure : [[h.cheminHeure, lireEntreesHeure]])),
      ...heureEnCours,
    ]);
    // Fichier horaire pas encore publié : repli sur les minutes de cette heure.
    for (const h of terminees) if (!enMemoire(h.cheminHeure)) h.enMinutes = true;
    await this.#telecharger(terminees.filter((h) => h.enMinutes).flatMap((h) => h.minutesDeLHeure));

    return [
      ...terminees.flatMap((h) => (h.enMinutes ? h.minutesDeLHeure.map(([c]) => c) : [h.cheminHeure])),
      ...heureEnCours.map(([c]) => c),
    ]
      .map((c) => this.#fichiers.get(c))
      .filter((f): f is FichierEntrees => f !== undefined);
  }

  /** Télécharge les fichiers absents de la mémoire, quelques requêtes à la fois. */
  async #telecharger(fichiers: ATelecharger[]): Promise<void> {
    const manquants = fichiers.filter(([chemin]) => !this.#fichiers.has(chemin));
    let suivant = 0;
    const travailleur = async () => {
      while (suivant < manquants.length) {
        const [chemin, lire] = manquants[suivant++]!;
        const reponse = await fetch(this.base + chemin).catch(() => null);
        if (reponse?.ok) this.#fichiers.set(chemin, lire(await reponse.json()));
      }
    };
    await Promise.all(Array.from({ length: REQUETES_SIMULTANEES }, travailleur));
  }
}
