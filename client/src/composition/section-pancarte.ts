/**
 * Section « Ta pancarte » du panneau de composition : un slogan du catalogue,
 * une couleur, une forme. Pas de texte libre, rien d'importé (ADR 0006).
 */
import {
  COULEURS_PANCARTE,
  encoderPancarte,
  FORMES_PANCARTE,
  SLOGANS,
  type CompositionPancarte,
  type FormePancarte,
} from '@petit-cortege/shared';
import { groupeDeChoix, type SectionComposition } from './panneau';

const NOMS_FORMES: Record<FormePancarte, string> = {
  rectangle: 'Rectangle',
  portrait: 'En hauteur',
  rond: 'Rond',
  losange: 'Losange',
};

const enCss = (couleur: number) => `#${couleur.toString(16).padStart(6, '0')}`;

/** Une pancarte tirée au hasard, point de départ de la composition (variété dans la foule). */
export function pancarteAuHasard(alea: () => number = Math.random): CompositionPancarte {
  const tirer = (n: number) => Math.floor(alea() * n);
  return { slogan: tirer(SLOGANS.length), couleur: tirer(COULEURS_PANCARTE.length), forme: tirer(FORMES_PANCARTE.length) };
}

export interface SectionPancarte {
  section: SectionComposition;
  /** Indice de la pancarte composée, à envoyer à l'entrée. */
  indice(): number;
}

export function sectionPancarte(initiale: CompositionPancarte): SectionPancarte {
  const composition = { ...initiale };
  const element = document.createElement('div');
  element.className = 'section-pancarte';

  // Aperçu tel que les autres le verront au zoom (et soi-même sur son avatar).
  const apercu = document.createElement('div');
  apercu.className = 'apercu-pancarte';
  apercu.setAttribute('aria-hidden', 'true');
  const panneau = document.createElement('div');
  panneau.className = 'pancarte';
  const texte = document.createElement('span');
  panneau.append(texte);
  apercu.append(panneau);
  const actualiser = () => {
    const couleur = COULEURS_PANCARTE[composition.couleur]!;
    panneau.dataset['forme'] = FORMES_PANCARTE[composition.forme]!;
    panneau.style.setProperty('--fond', enCss(couleur.fond));
    panneau.style.setProperty('--texte', enCss(couleur.texte));
    texte.textContent = SLOGANS[composition.slogan]!;
  };

  const slogans = groupeDeChoix({
    nom: 'Slogan',
    classe: 'choix-slogans',
    choix: SLOGANS,
    choisi: composition.slogan,
    rendu: (slogan, b) => (b.textContent = slogan),
    surChoix: (i) => {
      composition.slogan = i;
      actualiser();
    },
  });
  const couleurs = groupeDeChoix({
    nom: 'Couleur',
    classe: 'choix-couleurs',
    choix: COULEURS_PANCARTE,
    choisi: composition.couleur,
    rendu: (couleur, b) => {
      b.style.setProperty('--fond', enCss(couleur.fond));
      b.setAttribute('aria-label', couleur.nom);
      b.title = couleur.nom;
    },
    surChoix: (i) => {
      composition.couleur = i;
      actualiser();
    },
  });
  const formes = groupeDeChoix({
    nom: 'Forme',
    classe: 'choix-formes',
    choix: FORMES_PANCARTE,
    choisi: composition.forme,
    rendu: (forme, b) => {
      const mini = document.createElement('span');
      mini.className = 'pancarte mini';
      mini.dataset['forme'] = forme;
      b.append(mini);
      b.setAttribute('aria-label', NOMS_FORMES[forme]);
      b.title = NOMS_FORMES[forme];
    },
    surChoix: (i) => {
      composition.forme = i;
      actualiser();
    },
  });

  element.append(apercu, sousTitre('Slogan'), slogans, sousTitre('Couleur'), couleurs, sousTitre('Forme'), formes);
  actualiser();
  return {
    section: { titre: 'Ta pancarte', element },
    indice: () => encoderPancarte(composition),
  };
}

function sousTitre(texte: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = texte;
  return h;
}
