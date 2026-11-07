/**
 * Navigation entre les vues (liste, manif, pages légales). Chaque navigation crée
 * une nouvelle vue et périme la précédente : un travail asynchrone lancé par une vue
 * quittée (chargement de la liste, des entrées, du décor…) ne doit plus écrire dans
 * la page ni créer de jeu Phaser ou de minuterie.
 */

/** Levée par `Vue.attendre` quand la vue a été quittée pendant l'attente : à ignorer. */
export class VuePerimee extends Error {
  constructor() {
    super('Vue quittée pendant un chargement');
  }
}

export interface Vue {
  /** Vrai tant qu'aucune navigation n'a suivi. */
  readonly courante: boolean;
  /** Attend `promesse` ; lève `VuePerimee` si la vue a été quittée entre-temps. */
  attendre<T>(promesse: Promise<T> | T): Promise<T>;
  /** Arrêt à faire en quittant la vue (minuterie, jeu) ; aussitôt si elle est déjà quittée. */
  surQuitter(arreter: () => void): void;
}

export interface Navigation {
  /** Quitte la vue courante (ses arrêts sont appelés) et en crée une nouvelle. */
  nouvelleVue(): Vue;
}

export function creerNavigation(): Navigation {
  let courante: { quitter(): void } | null = null;
  return {
    nouvelleVue() {
      courante?.quitter();
      let active = true;
      const arrets: (() => void)[] = [];
      const vue: Vue = {
        get courante() {
          return active;
        },
        async attendre(promesse) {
          const valeur = await promesse;
          if (!active) throw new VuePerimee();
          return valeur;
        },
        surQuitter(arreter) {
          if (active) arrets.push(arreter);
          else arreter();
        },
      };
      courante = {
        quitter() {
          active = false;
          for (const arreter of arrets.splice(0)) arreter();
        },
      };
      return vue;
    },
  };
}
