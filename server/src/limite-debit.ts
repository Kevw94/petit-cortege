/**
 * Limite de débit en mémoire uniquement (ADR 0001) : jamais écrite, ni en base ni
 * dans les journaux. Fenêtre fixe : toute la table est jetée à chaque nouvelle
 * fenêtre, une clé (IP) ne reste donc en mémoire qu'une fenêtre au plus.
 */
export interface Limite {
  requetes: number;
  fenetreMs: number;
}

export interface Limiteur {
  /** Compte une requête pour `cle` ; `null` si elle passe, sinon les secondes avant la prochaine fenêtre. */
  compter(cle: string): number | null;
}

export function creerLimiteur(limite: Limite, maintenantMs: () => number): Limiteur {
  let debutFenetre = -Infinity;
  let compteurs = new Map<string, number>();
  return {
    compter(cle) {
      const maintenant = maintenantMs();
      if (maintenant - debutFenetre >= limite.fenetreMs) {
        compteurs = new Map();
        debutFenetre = maintenant;
      }
      const n = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, n);
      if (n <= limite.requetes) return null;
      return Math.max(1, Math.ceil((debutFenetre + limite.fenetreMs - maintenant) / 1000));
    },
  };
}
