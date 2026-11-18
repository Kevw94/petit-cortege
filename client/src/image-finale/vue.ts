/**
 * Vue d'une manif terminée : son image finale (tout le cortège au point d'arrivée),
 * consultable tant que la manif est dans la liste publiée (30 jours après la fin).
 * Ses propres avatars y sont mis en valeur tant qu'ils sont gardés sur l'appareil
 * (au plus 1 h après la fin, ADR 0001).
 */
import type { Decor, EntreePubliee, FichierEntrees, ManifPubliee } from '@petit-cortege/shared';
import { icone } from '../icones';
import { composerImageFinale } from '../cortege/image-finale';
import {
  partagerImage,
  peutPartagerUneImage,
  telechargerDansLeNavigateur,
  telechargerImage,
  type EnvironnementPartage,
} from '../partage/partage';
import {
  chargerRessourcesImageFinale,
  dessinerImageFinale,
  HAUTEUR_IMAGE_FINALE,
  imageFinaleEnPng,
  LARGEUR_IMAGE_FINALE,
  type RessourcesImageFinale,
} from './rendu';

export interface DonneesVueImageFinale {
  manif: ManifPubliee;
  decor: Decor | null;
  entrees: FichierEntrees[];
  propres: EntreePubliee[];
  retraits: readonly string[];
  /** Nom de la place d'arrivée, s'il est connu (décor OSM, #13). */
  nomPlace: string | null;
}

export interface VueImageFinale {
  /** Le canvas de l'image finale (PNG à télécharger ou partager : #16). */
  canvas: HTMLCanvasElement;
  /** Redessine avec des données à jour (retraits de la dernière heure, par exemple). */
  actualiser: (donnees: Partial<DonneesVueImageFinale>) => void;
}

let ressources: Promise<RessourcesImageFinale> | null = null;

function echapper(texte: string): string {
  const div = document.createElement('div');
  div.textContent = texte;
  return div.innerHTML;
}

export async function afficherImageFinale(conteneur: HTMLElement, depart: DonneesVueImageFinale): Promise<VueImageFinale> {
  ressources ??= chargerRessourcesImageFinale().catch((erreur: unknown) => {
    ressources = null;
    throw erreur;
  });
  const chargees = await ressources;
  let donnees = depart;

  conteneur.innerHTML = `
    <div class="vue-image-finale">
      <section class="carte">
        <a class="retour" href="/">${icone('retour', 'icone icone-petite')}Toutes les manifs</a>
        <h1>${echapper(donnees.manif.intitule)}</h1>
        <p data-etat></p>
        <p data-toi hidden>Ton avatar est mis en valeur, sur cet appareil seulement (et dans l’image si tu la
          télécharges ou la partages).</p>
      </section>
      <canvas class="image-finale" width="${LARGEUR_IMAGE_FINALE}" height="${HAUTEUR_IMAGE_FINALE}"
        role="img"></canvas>
      <div class="partage-image">
        <button type="button" class="bouton bouton-principal" data-partager hidden>${icone('partager')}Partager</button>
        <button type="button" class="bouton bouton-secondaire" data-telecharger>${icone('telecharger')}Télécharger</button>
      </div>
      <p class="message" data-message-partage role="status"></p>
    </div>`;
  const canvas = conteneur.querySelector<HTMLCanvasElement>('canvas.image-finale')!;
  const etatEl = conteneur.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const toiEl = conteneur.querySelector<HTMLParagraphElement>('[data-toi]')!;
  const partagerEl = conteneur.querySelector<HTMLButtonElement>('[data-partager]')!;
  const telechargerEl = conteneur.querySelector<HTMLButtonElement>('[data-telecharger]')!;
  const messageEl = conteneur.querySelector<HTMLParagraphElement>('[data-message-partage]')!;
  // PNG préparé à chaque dessin : au clic, le partage part sans attente (le partage natif
  // exige d'être appelé juste après le geste du soutien). Rien n'est envoyé au serveur.
  let png!: Promise<Blob>;
  const environnement: EnvironnementPartage = { navigateur: navigator, telecharger: telechargerDansLeNavigateur };

  let signature = '';
  const dessiner = () => {
    const image = composerImageFinale(donnees);
    // Ne redessine que si la composition change (un retrait dans l'heure qui suit la fin).
    const nouvelle = `${image.compteur}|${image.premierPlan.length}|${image.premierPlan.map((a) => a.id).join()}`;
    if (nouvelle === signature) return;
    signature = nouvelle;
    dessinerImageFinale(canvas, { ...donnees, image, ressources: chargees });
    png = imageFinaleEnPng(canvas);
    png.catch(() => {}); // erreur signalée au clic
    const n = image.compteur;
    etatEl.textContent = `Terminée · ${n.toLocaleString('fr-FR')} ${n > 1 ? 'soutiens' : 'soutien'}`;
    canvas.setAttribute(
      'aria-label',
      `Image finale : ${n} ${n > 1 ? 'soutiens rassemblés' : 'soutien rassemblé'} au point d'arrivée${donnees.nomPlace ? `, ${donnees.nomPlace}` : ''}.`,
    );
    toiEl.hidden = !image.premierPlan.some((a) => a.propre);
  };
  dessiner();

  partagerEl.hidden = !peutPartagerUneImage(environnement.navigateur);
  const agir = async (bouton: HTMLButtonElement, action: (fichier: Blob) => Promise<string | null>) => {
    bouton.disabled = true;
    messageEl.textContent = '';
    try {
      messageEl.textContent = (await action(await png)) ?? '';
    } catch {
      messageEl.textContent = 'Impossible de préparer l’image. Réessaie dans un instant.';
    } finally {
      bouton.disabled = false;
    }
  };
  partagerEl.addEventListener('click', () =>
    void agir(partagerEl, async (fichier) =>
      (await partagerImage(fichier, environnement)) === 'telechargement' ? 'Image téléchargée.' : null,
    ),
  );
  telechargerEl.addEventListener('click', () =>
    void agir(telechargerEl, async (fichier) => {
      telechargerImage(fichier, environnement);
      return 'Image téléchargée.';
    }),
  );

  return {
    canvas,
    actualiser: (changements) => {
      donnees = { ...donnees, ...changements };
      dessiner();
    },
  };
}
