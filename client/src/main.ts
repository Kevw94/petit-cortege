import * as Phaser from 'phaser';
import type { EntreesMinute } from '@petit-cortege/shared';
import { avatarsPropres, memoriserAvatarPropre } from './avatars-propres';
import type { Cortege } from './cortege/cortege';
import { EntreeRefusee, rejoindreLeCortege } from './entree';
import { Publication } from './publication';
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
  let entrees: EntreesMinute[] = await publication.entreesPour(manif, new Date());

  interfaceEl.innerHTML = `
    <section class="carte">
      <a class="retour" href="#/">← Toutes les manifs</a>
      <h1>${echapper(manif.intitule)}</h1>
      <p>${echapper(manif.ville)} · départ ${heure(manif.depart)}</p>
      <p data-etat></p>
    </section>
    <section class="action">
      <button type="button" class="rejoindre" data-rejoindre hidden>Rejoindre le cortège</button>
      <p class="message" data-message role="status"></p>
    </section>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const boutonEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rejoindre]')!;
  const messageEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-message]')!;

  // Avatars de ce soutien : relus du localStorage (purgé 1 h après la fin), mis en valeur.
  let propres = avatarsPropres(new Date()).filter((e) => e.m === id);
  let envoiEnCours = false;
  let dernierTexte = '';
  const surCortege = (cortege: Cortege) => {
    // Compteur : avatars du cortège à l'heure locale (publiés et entrés, plus les siens) ;
    // c'est ce qui est dessiné. Le `compteur` de la liste des manifs sert à la liste.
    const n = cortege.avatars.length;
    const texte = `${cortege.etat === 'ouverte' ? 'Ouverte' : 'Terminée'} · ${n} ${n > 1 ? 'soutiens' : 'soutien'}`;
    if (texte !== dernierTexte) etatEl.textContent = dernierTexte = texte;
    const peutRejoindre = cortege.etat === 'ouverte' && propres.length === 0 && !envoiEnCours;
    if (boutonEl.hidden === peutRejoindre) boutonEl.hidden = !peutRejoindre;
    if (propres.length > 0 && !envoiEnCours && !messageEl.textContent) {
      messageEl.textContent = 'Tu marches avec le cortège. Tu peux fermer la page : ton avatar continue.';
    }
  };

  boutonEl.addEventListener('click', async () => {
    envoiEnCours = true;
    boutonEl.disabled = true;
    // Preuve de travail anti-robots (#8) : quelques secondes de calcul, attente affichée.
    messageEl.textContent = 'Vérification anti-robots, quelques secondes…';
    try {
      // Apparence et pancarte tirées au hasard en attendant la composition (#10, #11).
      const entree = await rejoindreLeCortege({ manif: id, apparence: auHasard(8), pancarte: auHasard(8) });
      memoriserAvatarPropre(entree, donnees.manif.fin);
      propres = [...propres, entree];
      messageEl.textContent = '';
    } catch (erreur) {
      messageEl.textContent = messageErreurEntree(erreur);
    } finally {
      envoiEnCours = false;
      boutonEl.disabled = false;
    }
  });

  const donnees: DonneesScene = { manif, entrees: () => entrees, propres: () => propres, surCortege };
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
