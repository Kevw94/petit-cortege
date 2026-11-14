/**
 * Panneau de composition, ouvert avant d'entrer dans le cortège.
 *
 * Fait de sections indépendantes (pancarte #11 ; apparence #10 ajoutera la
 * sienne) : chacune apporte son titre et son contenu, le panneau les empile,
 * défilable au doigt, avec les boutons « Annuler » et de validation en bas.
 */

export interface SectionComposition {
  /** Titre affiché en tête de section (ex. « Ta pancarte »). */
  titre: string;
  element: HTMLElement;
}

export interface OptionsPanneauComposition {
  sections: readonly SectionComposition[];
  libelleValider: string;
  surValider: () => void;
  surAnnuler: () => void;
}

export interface PanneauComposition {
  element: HTMLElement;
  /** Bloque les boutons pendant l'envoi. */
  occupe(occupe: boolean): void;
  /** Message d'état sous les sections (envoi, erreur) ; vide pour l'effacer. */
  annoncer(texte: string): void;
}

export function creerPanneauComposition(options: OptionsPanneauComposition): PanneauComposition {
  const panneau = document.createElement('section');
  panneau.className = 'composition';
  panneau.setAttribute('aria-label', 'Composer');

  const contenu = document.createElement('div');
  contenu.className = 'composition-contenu';
  for (const section of options.sections) {
    const bloc = document.createElement('div');
    bloc.className = 'composition-section';
    const titre = document.createElement('h2');
    titre.textContent = section.titre;
    bloc.append(titre, section.element);
    contenu.append(bloc);
  }

  const actions = document.createElement('div');
  actions.className = 'composition-actions';
  const annuler = bouton('Annuler', 'bouton bouton-secondaire', options.surAnnuler);
  const valider = bouton(options.libelleValider, 'bouton bouton-principal', options.surValider);
  actions.append(annuler, valider);
  const message = document.createElement('p');
  message.className = 'message';
  message.setAttribute('role', 'status');

  panneau.append(contenu, message, actions);
  return {
    element: panneau,
    occupe(occupe) {
      annuler.disabled = occupe;
      valider.disabled = occupe;
    },
    annoncer(texte) {
      message.textContent = texte;
    },
  };
}

function bouton(libelle: string, classe: string, auClic: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = classe;
  b.textContent = libelle;
  b.addEventListener('click', auClic);
  return b;
}

/**
 * Groupe de choix au doigt (un seul choisi à la fois), accessible : boutons
 * `aria-pressed` dans un groupe nommé.
 */
export function groupeDeChoix<T>(options: {
  nom: string;
  classe: string;
  choix: readonly T[];
  choisi: number;
  rendu: (choix: T, bouton: HTMLButtonElement) => void;
  surChoix: (indice: number) => void;
}): HTMLElement {
  const groupe = document.createElement('div');
  groupe.className = `choix ${options.classe}`;
  groupe.setAttribute('role', 'group');
  groupe.setAttribute('aria-label', options.nom);
  const boutons = options.choix.map((choix, indice) => {
    const b = document.createElement('button');
    b.type = 'button';
    options.rendu(choix, b);
    b.addEventListener('click', () => {
      boutons.forEach((autre, i) => autre.setAttribute('aria-pressed', String(i === indice)));
      options.surChoix(indice);
    });
    b.setAttribute('aria-pressed', String(indice === options.choisi));
    return b;
  });
  groupe.append(...boutons);
  return groupe;
}
