/**
 * Section « Ton avatar » du panneau de composition : teint, coupe et couleur des
 * cheveux, haut et sa couleur, couleur du bas, accessoire. Uniquement des éléments du
 * catalogue partagé (liste blanche, ADR 0003) ; aperçu en pixels Kenney, tel que les
 * autres le verront dans le cortège.
 */
import {
  ACCESSOIRES,
  COUPES,
  COULEURS_CHEVEUX,
  COULEURS_VETEMENTS,
  encoderApparence,
  HAUTS,
  TEINTS,
  type CompositionApparence,
  type Teinte,
} from '@petit-cortege/shared';
import { CELLULE_APPARENCE, dessinerApparence, URL_COUCHES_APPARENCE } from '../apparence/dessin';
import { groupeDeChoix, type SectionComposition } from './panneau';

export interface SectionApparence {
  section: SectionComposition;
  /** Indice de l'apparence composée, à envoyer à l'entrée. */
  indice(): number;
}

const enCss = (couleur: number) => `#${couleur.toString(16).padStart(6, '0')}`;

/** Image des couches, chargée une fois pour tous les aperçus. */
let couches: Promise<HTMLImageElement> | null = null;
function chargerCouches(): Promise<HTMLImageElement> {
  couches ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL_COUCHES_APPARENCE;
  });
  return couches;
}

/** Un canvas à la taille d'une apparence, agrandi en CSS sans lissage. */
function canvasApparence(classe: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELLULE_APPARENCE.largeur;
  canvas.height = CELLULE_APPARENCE.hauteur;
  canvas.className = classe;
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

function peindre(canvas: HTMLCanvasElement, image: HTMLImageElement | null, indice: number): void {
  const contexte = canvas.getContext('2d');
  if (!contexte || !image) return;
  contexte.clearRect(0, 0, canvas.width, canvas.height);
  dessinerApparence(contexte, image, indice, 0, 0);
}

type Champ = keyof CompositionApparence;

export function sectionApparence(initiale: CompositionApparence): SectionApparence {
  const composition = { ...initiale };
  const element = document.createElement('div');
  element.className = 'section-apparence';
  let image: HTMLImageElement | null = null;

  const apercu = canvasApparence('apercu-apparence');
  /** Vignettes : l'avatar actuel avec une autre valeur d'un champ. */
  const vignettes: { canvas: HTMLCanvasElement; champ: Champ; valeur: number }[] = [];
  const actualiser = () => {
    peindre(apercu, image, encoderApparence(composition));
    for (const v of vignettes) peindre(v.canvas, image, encoderApparence({ ...composition, [v.champ]: v.valeur }));
  };
  void chargerCouches().then((chargee) => {
    image = chargee;
    actualiser();
  });

  const choisir = (champ: Champ) => (valeur: number) => {
    composition[champ] = valeur;
    actualiser();
  };

  /** Choix par pastilles de couleur (teint, couleurs). */
  const nuancier = (nom: string, champ: Champ, teintes: readonly Teinte[], rang: number) =>
    groupeDeChoix({
      nom,
      classe: 'choix-couleurs',
      choix: teintes,
      choisi: composition[champ],
      rendu: (teinte, b) => {
        b.style.setProperty('--fond', enCss(teinte.rampe[Math.min(rang, teinte.rampe.length - 1)]!));
        b.setAttribute('aria-label', teinte.nom);
        b.title = teinte.nom;
      },
      surChoix: choisir(champ),
    });

  /** Choix par vignettes de l'avatar (coupe, haut, accessoire). */
  const galerie = (nom: string, champ: Champ, pieces: readonly { nom: string }[]) =>
    groupeDeChoix({
      nom,
      classe: 'choix-vignettes',
      choix: pieces,
      choisi: composition[champ],
      rendu: (piece, b) => {
        const canvas = canvasApparence('vignette-apparence');
        vignettes.push({ canvas, champ, valeur: pieces.indexOf(piece) });
        b.append(canvas);
        b.setAttribute('aria-label', piece.nom);
        b.title = piece.nom;
      },
      surChoix: choisir(champ),
    });

  const cadreApercu = document.createElement('div');
  cadreApercu.className = 'cadre-apercu-apparence';
  cadreApercu.append(apercu);
  element.append(
    cadreApercu,
    sousTitre('Teint'),
    nuancier('Teint', 'teint', TEINTS, 1),
    sousTitre('Cheveux'),
    galerie('Coupe', 'coupe', COUPES),
    nuancier('Couleur des cheveux', 'couleurCheveux', COULEURS_CHEVEUX, 1),
    sousTitre('Haut'),
    galerie('Haut', 'haut', HAUTS),
    nuancier('Couleur du haut', 'couleurHaut', COULEURS_VETEMENTS, 1),
    sousTitre('Bas'),
    nuancier('Couleur du bas', 'couleurBas', COULEURS_VETEMENTS, 1),
    sousTitre('Accessoire'),
    galerie('Accessoire', 'accessoire', ACCESSOIRES),
  );
  return {
    section: { titre: 'Ton avatar', element },
    indice: () => encoderApparence(composition),
  };
}

function sousTitre(texte: string): HTMLElement {
  const h = document.createElement('h3');
  h.textContent = texte;
  return h;
}
