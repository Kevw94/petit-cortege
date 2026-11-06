/**
 * Lecture des fichiers publiés. Les requêtes sont identiques pour tous les
 * clients : aucune ne contient d'identifiant de manif (ADR 0002).
 */
import {
  CHEMIN_LISTE_MANIFS,
  CHEMIN_RETRAITS,
  PREFIXE_PUBLICATION,
  cheminEntreesMinute,
  lireEntreesMinute,
  lireListeManifs,
  lireRetraits,
  minutesPubliees,
  type EntreesMinute,
  type ListeManifs,
  type ManifPubliee,
} from '@petit-cortege/shared';

const REQUETES_SIMULTANEES = 6;

export class Publication {
  /** Fichiers par minute déjà chargés (immuables), par chemin. */
  readonly #minutes = new Map<string, EntreesMinute>();

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
   * Identifiants des avatars retirés (cache court), à appliquer par-dessus les
   * entrées. Pas encore publié (404) : aucun retrait.
   */
  async retraits(): Promise<string[]> {
    const reponse = await fetch(this.base + CHEMIN_RETRAITS, { cache: 'no-cache' });
    if (reponse.status === 404) return [];
    if (!reponse.ok) throw new Error(`Retraits indisponibles (${reponse.status})`);
    return lireRetraits(await reponse.json()).retraits;
  }

  /**
   * Charge les fichiers par minute de la manif publiés à `maintenant` qui ne
   * sont pas encore en mémoire, et renvoie tous ceux qu'on a.
   * Un fichier pas encore publié (404, horloge en avance) sera redemandé plus tard.
   */
  async entreesPour(manif: ManifPubliee, maintenant: Date): Promise<EntreesMinute[]> {
    const manquants = minutesPubliees(manif, maintenant)
      .map(cheminEntreesMinute)
      .filter((chemin) => !this.#minutes.has(chemin));

    let suivant = 0;
    const travailleur = async () => {
      while (suivant < manquants.length) {
        const chemin = manquants[suivant++]!;
        const reponse = await fetch(this.base + chemin).catch(() => null);
        if (reponse?.ok) this.#minutes.set(chemin, lireEntreesMinute(await reponse.json()));
      }
    };
    await Promise.all(Array.from({ length: REQUETES_SIMULTANEES }, travailleur));

    return minutesPubliees(manif, maintenant)
      .map((m) => this.#minutes.get(cheminEntreesMinute(m)))
      .filter((f): f is EntreesMinute => f !== undefined);
  }
}
