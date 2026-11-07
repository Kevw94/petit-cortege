import * as Phaser from 'phaser';
import type { FichierEntrees } from '@petit-cortege/shared';
import { ATTRIBUTION_OSM } from '@petit-cortege/shared';
import { avatarsPropres, jetonDeRetrait, memoriserAvatarPropre, oublierAvatarPropre } from './avatars-propres';
import { chargerDecor } from './decor/chargement';
import { creerPanneauComposition, type PanneauComposition } from './composition/panneau';
import { pancarteAuHasard, sectionPancarte } from './composition/section-pancarte';
import type { Cortege } from './cortege/cortege';
import { EntreeRefusee, rejoindreLeCortege } from './entree';
import { Publication } from './publication';
import { hacherJetonRetrait, nouveauJetonRetrait, RetraitRefuse, retirerMonAvatar } from './retrait';
import { pageLegale, piedDePage } from './pages/pages-legales';
import { lienManif, lireRoute } from './routage';
import { SceneCortege, type DonneesScene } from './scene-cortege';

/** Rafraîchissement des fichiers publiés (liste en cache court ≈ 1 min, minutes immuables). */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20_000;

const publication = new Publication();
const interfaceEl = document.querySelector<HTMLDivElement>('#interface')!;
let jeu: Phaser.Game | null = null;
let arreterRafraichissement: () => void = () => {};

const heure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function echapper(texte: string): string {
  const div = document.createElement('div');
  div.textContent = texte;
  return div.innerHTML;
}

function quitterVue(): void {
  arreterRafraichissement();
  arreterRafraichissement = () => {};
  jeu?.destroy(true);
  jeu = null;
  interfaceEl.innerHTML = '';
}

async function afficherListe(): Promise<void> {
  const { manifs } = await publication.listeManifs();
  interfaceEl.innerHTML = `
    <section class="carte">
      <h1>Petit Cortège</h1>
      <p>Choisis un cortège à rejoindre.</p>
      <ul class="liste">
        ${manifs
          .map(
            (m) => `<li><a href="${lienManif(m.id)}">
              <strong>${echapper(m.intitule)}</strong>
              ${echapper(m.ville)} · départ ${heure(m.depart)} · fin ${heure(m.fin)}
            </a></li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

async function afficherManif(id: string): Promise<void> {
  const manif = (await publication.listeManifs()).manifs.find((m) => m.id === id);
  if (!manif) {
    interfaceEl.innerHTML = `<section class="carte"><p>Cette manif n'existe pas ou n'est plus publiée.</p>
      <a class="retour" href="#/">← Toutes les manifs</a></section>`;
    return;
  }
  // Décor OSM : tous les décors publiés sont demandés, quelle que soit la manif (ADR 0002).
  const decor = chargerDecor(manif.parcours.coordinates);
  let entrees: FichierEntrees[] = await publication.entreesPour(manif, new Date());
  let retraitsPublies: string[] = await publication.retraits().catch(() => []);
  // Retirés depuis cet appareil : effacés tout de suite, sans attendre le fichier des retraits.
  const retiresIci = new Set<string>();

  interfaceEl.innerHTML = `
    <section class="carte">
      <a class="retour" href="#/">← Toutes les manifs</a>
      <h1>${echapper(manif.intitule)}</h1>
      <p>${echapper(manif.ville)} · départ ${heure(manif.depart)}</p>
      <p data-etat></p>
    </section>
    <section class="action">
      <button type="button" class="rejoindre" data-rejoindre hidden>Rejoindre le cortège</button>
      <button type="button" class="retirer" data-retirer hidden>Retirer mon avatar</button>
      <p class="message" data-message role="status"></p>
    </section>
    <p class="attribution">${ATTRIBUTION_OSM.replace('OpenStreetMap', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>')}</p>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const boutonEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rejoindre]')!;
  const retirerEl = interfaceEl.querySelector<HTMLButtonElement>('[data-retirer]')!;
  const messageEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-message]')!;

  // Avatars de ce soutien : relus du localStorage (purgé 1 h après la fin), mis en valeur.
  let propres = avatarsPropres(new Date()).filter((e) => e.m === id);
  let envoiEnCours = false;
  // Avatars propres dont on garde le jeton (relu à chaque changement, pas à chaque image).
  let propresRetirables = propres.filter((e) => jetonDeRetrait(e.a, new Date()) !== undefined);
  let dernierTexte = '';
  const surCortege = (cortege: Cortege) => {
    // Compteur : avatars du cortège à l'heure locale (publiés et entrés, plus les siens) ;
    // c'est ce qui est dessiné. Le `compteur` de la liste des manifs sert à la liste.
    const n = cortege.avatars.length;
    const texte = `${cortege.etat === 'ouverte' ? 'Ouverte' : 'Terminée'} · ${n} ${n > 1 ? 'soutiens' : 'soutien'}`;
    if (texte !== dernierTexte) etatEl.textContent = dernierTexte = texte;
    const peutRejoindre = cortege.etat === 'ouverte' && propres.length === 0 && !envoiEnCours && !composition;
    if (boutonEl.hidden === peutRejoindre) boutonEl.hidden = !peutRejoindre;
    // Le jeton est effacé à la fin de la manif : le retrait n'est possible que tant qu'elle est ouverte.
    const peutRetirer = cortege.etat === 'ouverte' && propresRetirables.length > 0 && !envoiEnCours;
    if (retirerEl.hidden === peutRetirer) retirerEl.hidden = !peutRetirer;
    if (propres.length > 0 && !envoiEnCours && !messageEl.textContent) {
      messageEl.textContent = 'Tu marches avec le cortège. Tu peux fermer la page : ton avatar continue.';
    }
  };

  // Composition (pancarte ; l'apparence #10 ajoutera sa section) avant d'entrer.
  let composition: PanneauComposition | null = null;
  const fermerComposition = () => {
    composition?.element.remove();
    composition = null;
  };
  const entrer = async (pancarte: number) => {
    envoiEnCours = true;
    composition?.occupe(true);
    // Preuve de travail anti-robots (#8) : quelques secondes de calcul, attente affichée.
    composition?.annoncer('Vérification anti-robots, quelques secondes…');
    try {
      // Jeton de retrait : gardé sur cet appareil, seul son SHA-256 part au serveur (ADR 0001).
      const jeton = nouveauJetonRetrait();
      // Apparence tirée au hasard en attendant sa composition (#10).
      const entree = await rejoindreLeCortege({
        manif: id,
        apparence: auHasard(8),
        pancarte,
        hachageRetrait: await hacherJetonRetrait(jeton),
      });
      memoriserAvatarPropre(entree, donnees.manif.fin, jeton);
      propres = [...propres, entree];
      propresRetirables = [...propresRetirables, entree];
      fermerComposition();
    } catch (erreur) {
      composition?.annoncer(messageErreurEntree(erreur));
      composition?.occupe(false);
    } finally {
      envoiEnCours = false;
    }
  };
  boutonEl.addEventListener('click', () => {
    if (composition) return;
    messageEl.textContent = '';
    const pancarte = sectionPancarte(pancarteAuHasard());
    composition = creerPanneauComposition({
      sections: [pancarte.section],
      libelleValider: 'Rejoindre le cortège',
      surValider: () => void entrer(pancarte.indice()),
      surAnnuler: fermerComposition,
    });
    interfaceEl.append(composition.element);
    boutonEl.hidden = true;
  });

  retirerEl.addEventListener('click', async () => {
    if (!window.confirm('Retirer ton avatar du cortège ? Il disparaîtra pour tout le monde.')) return;
    envoiEnCours = true;
    retirerEl.disabled = true;
    messageEl.textContent = 'Retrait de ton avatar…';
    try {
      for (const { a: avatar } of propresRetirables) {
        const jeton = jetonDeRetrait(avatar, new Date());
        if (jeton !== undefined) await retirerMonAvatar({ avatar, jeton });
        oublierAvatarPropre(avatar);
        retiresIci.add(avatar);
        propres = propres.filter((e) => e.a !== avatar);
        propresRetirables = propresRetirables.filter((e) => e.a !== avatar);
      }
      messageEl.textContent = "Ton avatar est retiré. Il disparaîtra pour tout le monde d'ici quelques minutes.";
    } catch (erreur) {
      messageEl.textContent = messageErreurRetrait(erreur);
    } finally {
      envoiEnCours = false;
      retirerEl.disabled = false;
    }
  });

  const donnees: DonneesScene = {
    manif,
    decor: await decor,
    entrees: () => entrees,
    propres: () => propres,
    retraits: () => (retiresIci.size === 0 ? retraitsPublies : [...retraitsPublies, ...retiresIci]),
    surCortege,
  };
  jeu = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'jeu',
    backgroundColor: '#f4f1ea',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  jeu.scene.add('cortege', SceneCortege, true, donnees);

  const minuterie = window.setInterval(async () => {
    const aJour = (await publication.listeManifs().catch(() => null))?.manifs.find((m) => m.id === id);
    if (aJour) donnees.manif = aJour; // départ éventuellement corrigé
    entrees = await publication.entreesPour(donnees.manif, new Date());
    retraitsPublies = (await publication.retraits().catch(() => null)) ?? retraitsPublies;
  }, INTERVALLE_RAFRAICHISSEMENT_MS);
  arreterRafraichissement = () => window.clearInterval(minuterie);
}

const auHasard = (n: number) => Math.floor(Math.random() * n);

function messageErreurEntree(erreur: unknown): string {
  const code = erreur instanceof EntreeRefusee ? erreur.code : 'reseau';
  switch (code) {
    case 'manif-terminee':
      return 'Cette manif est terminée : on ne peut plus la rejoindre.';
    case 'manif-inconnue':
      return "Cette manif n'est pas ouverte.";
    case 'trop-de-requetes':
      return 'Beaucoup d’entrées depuis ta connexion : réessaie dans une minute.';
    default:
      return 'Impossible de rejoindre le cortège pour le moment. Réessaie dans un instant.';
  }
}

function messageErreurRetrait(erreur: unknown): string {
  if (erreur instanceof RetraitRefuse && erreur.code === 'retrait-refuse') {
    return "Le retrait n'est plus possible pour cet avatar.";
  }
  return 'Impossible de retirer ton avatar pour le moment. Réessaie dans un instant.';
}

async function naviguer(): Promise<void> {
  quitterVue();
  const route = lireRoute(window.location.hash);
  try {
    if (route.page === 'manif') await afficherManif(route.id);
    else if (route.page === 'legale') interfaceEl.innerHTML = pageLegale(route.id);
    else await afficherListe();
  } catch (erreur) {
    interfaceEl.innerHTML = `<section class="carte"><p>Impossible de charger le cortège. Réessaie dans un instant.</p></section>`;
    console.error(erreur);
  }
}

document.body.insertAdjacentHTML('beforeend', piedDePage());
window.addEventListener('hashchange', () => void naviguer());
void naviguer();
