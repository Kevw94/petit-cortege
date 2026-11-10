/**
 * Mode immersif de la vue d'une manif : l'interface s'efface (classe `immersif` sur le body,
 * voir style.css), seuls restent la vue, la mention OpenStreetMap et un bouton pour revenir.
 * Plein écran en plus quand le navigateur le permet (pas sur iPhone : l'interface s'efface
 * quand même). On en sort par le bouton, par Échap hors plein écran, ou en quittant le plein écran
 * (dans ce mode, c'est le navigateur qui prend Échap et le quitte).
 */
export interface Immersion {
  readonly active: boolean;
  entrer(): void;
  sortir(): void;
  detruire(): void;
}

export function creerImmersion(surChangement: (active: boolean) => void): Immersion {
  let active = false;
  /** Plein écran demandé par l'immersion : en sortir (Échap du navigateur) termine l'immersion. */
  let pleinEcranDemande = false;
  const corps = document.body;

  const changer = (voulu: boolean) => {
    if (voulu === active) return;
    active = voulu;
    corps.classList.toggle('immersif', active);
    surChangement(active);
  };
  const surTouche = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && active) immersion.sortir();
  };
  const surPleinEcran = () => {
    if (!document.fullscreenElement && pleinEcranDemande) {
      pleinEcranDemande = false;
      changer(false);
    }
  };
  document.addEventListener('keydown', surTouche);
  document.addEventListener('fullscreenchange', surPleinEcran);

  const immersion: Immersion = {
    get active() {
      return active;
    },
    entrer() {
      changer(true);
      const racine = document.documentElement;
      if (!document.fullscreenElement && racine.requestFullscreen) {
        racine.requestFullscreen({ navigationUI: 'hide' }).then(
          () => {
            pleinEcranDemande = true;
            // Sortie demandée pendant que le navigateur passait en plein écran : on le quitte aussitôt.
            if (!active) immersion.sortir();
          },
          () => {}, // refusé (iPhone, iframe) : l'interface est masquée quand même
        );
      }
    },
    sortir() {
      changer(false);
      if (pleinEcranDemande && document.fullscreenElement) {
        pleinEcranDemande = false;
        void document.exitFullscreen().catch(() => {});
      }
    },
    detruire() {
      immersion.sortir();
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('fullscreenchange', surPleinEcran);
    },
  };
  return immersion;
}
