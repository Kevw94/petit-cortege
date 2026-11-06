import * as Phaser from 'phaser';
import type { EntreesMinute } from '@petit-cortege/shared';
import type { Cortege } from './cortege/cortege';
import { Publication } from './publication';
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
    </section>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  let dernierTexte = '';
  const surCortege = (cortege: Cortege) => {
    const texte = `${cortege.etat === 'ouverte' ? 'Ouverte' : 'Terminée'} · ${cortege.avatars.length} soutiens`;
    if (texte !== dernierTexte) etatEl.textContent = dernierTexte = texte;
  };

  const donnees: DonneesScene = { manif, entrees: () => entrees, surCortege };
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

async function naviguer(): Promise<void> {
  quitterVue();
  const route = lireRoute(window.location.hash);
  try {
    if (route.page === 'manif') await afficherManif(route.id);
    else await afficherListe();
  } catch (erreur) {
    interfaceEl.innerHTML = `<section class="carte"><p>Impossible de charger le cortège. Réessaie dans un instant.</p></section>`;
    console.error(erreur);
  }
}

window.addEventListener('hashchange', () => void naviguer());
void naviguer();
