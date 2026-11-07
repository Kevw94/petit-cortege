import * as Phaser from 'phaser';
import { apparenceAuHasard, ATTRIBUTION_OSM, type FichierEntrees } from '@petit-cortege/shared';
import {
  avatarsPropres,
  jetonDeRetrait,
  memoriserAvatarPropre,
  suivreFinsDesManifs,
} from './avatars-propres';
import { chargerDecor } from './decor/chargement';
import { creerPanneauComposition, type PanneauComposition } from './composition/panneau';
import { sectionApparence } from './composition/section-apparence';
import { pancarteAuHasard, sectionPancarte } from './composition/section-pancarte';
import type { Cortege } from './cortege/cortege';
import { EntreeRefusee, rejoindreLeCortege } from './entree';
import { afficherImageFinale } from './image-finale/vue';
import { telechargerDansLeNavigateur } from './partage/partage';
import { NOM_FICHIER_RAPPEL, rappelIcs } from './partage/rappel';
import { Publication } from './publication';
import { hacherJetonRetrait, nouveauJetonRetrait, RetraitRefuse, retirerMesAvatars } from './retrait';
import { pageLegale, piedDePage } from './pages/pages-legales';
import { creerNavigation, VuePerimee, type Vue } from './navigation';
import { lienManif, lireRoute } from './routage';
import { SceneCortege, type DonneesScene } from './scene-cortege';

/** Rafraîchissement des fichiers publiés (liste en cache court ≈ 1 min, minutes immuables). */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20_000;

const publication = new Publication();
const interfaceEl = document.querySelector<HTMLDivElement>('#interface')!;
/** Chaque navigation périme la vue précédente : ses chargements en cours n'écrivent plus rien. */
const navigation = creerNavigation();

const heure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

function echapper(texte: string): string {
  const div = document.createElement('div');
  div.textContent = texte;
  return div.innerHTML;
}

/**
 * Liste des manifs publiée (ouvertes et terminées récentes). À chaque lecture, les
 * avatars gardés sur l'appareil suivent la fin publiée (départ corrigé) et sont purgés :
 * jetons de retrait effacés à la fin, avatars 1 h après (ADR 0001).
 */
async function listeManifs() {
  const liste = await publication.listeManifs();
  suivreFinsDesManifs(liste.manifs, new Date());
  return liste;
}

const estTerminee = (manif: { fin: string }, maintenant = new Date()) => maintenant.getTime() >= Date.parse(manif.fin);

async function afficherListe(vue: Vue): Promise<void> {
  const { manifs } = await vue.attendre(listeManifs());
  const ouvertes = manifs.filter((m) => !estTerminee(m));
  const terminees = manifs.filter((m) => estTerminee(m)).reverse(); // les plus récentes d'abord
  const element = (m: (typeof manifs)[number], detail: string) => `<li><a href="${lienManif(m.id)}">
              <strong>${echapper(m.intitule)}</strong>
              ${echapper(m.ville)} · ${detail}
            </a></li>`;
  interfaceEl.innerHTML = `
    <section class="carte">
      <h1>Petit Cortège</h1>
      <p>${ouvertes.length > 0 ? 'Choisis un cortège à rejoindre.' : 'Aucun cortège ouvert pour le moment.'}</p>
      <ul class="liste">
        ${ouvertes.map((m) => element(m, `départ ${heure(m.depart)} · fin ${heure(m.fin)}`)).join('')}
      </ul>
      ${
        terminees.length === 0
          ? ''
          : `<h2 class="sous-titre">Terminées : revoir l’image finale</h2>
      <ul class="liste">
        ${terminees.map((m) => element(m, `terminée ${heure(m.fin)}`)).join('')}
      </ul>`
      }
    </section>`;
}

async function afficherManif(id: string, vue: Vue): Promise<void> {
  const manif = (await vue.attendre(listeManifs())).manifs.find((m) => m.id === id);
  if (!manif) {
    interfaceEl.innerHTML = `<section class="carte"><p>Cette manif n'existe pas ou n'est plus publiée.</p>
      <a class="retour" href="#/">← Toutes les manifs</a></section>`;
    return;
  }
  // Décor OSM : tous les décors publiés sont demandés, quelle que soit la manif (ADR 0002).
  const decor = chargerDecor(manif.parcours.coordinates);
  let entrees: FichierEntrees[] = await vue.attendre(publication.entreesPour(manif, new Date()));
  let retraitsPublies: string[] = await vue.attendre(publication.retraits().catch(() => []));
  // Retirés depuis cet appareil : effacés tout de suite, sans attendre le fichier des retraits.
  const retiresIci = new Set<string>();

  if (estTerminee(manif)) {
    await afficherManifTerminee(vue, manif, await vue.attendre(decor), entrees, retraitsPublies);
    return;
  }

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
      <button type="button" class="rappel" data-rappel hidden>Rappel pour voir l’image finale</button>
      <p class="message" data-message role="status"></p>
    </section>
    <p class="attribution">${ATTRIBUTION_OSM.replace('OpenStreetMap', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>')}</p>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const boutonEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rejoindre]')!;
  const retirerEl = interfaceEl.querySelector<HTMLButtonElement>('[data-retirer]')!;
  const messageEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-message]')!;
  const rappelEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rappel]')!;

  // Rappel d'agenda (.ics) généré ici, au titre neutre, à l'heure de fin (ADR 0002 : seul
  // le fragment désigne la manif, jamais envoyé au serveur).
  rappelEl.addEventListener('click', () => {
    const ics = rappelIcs({
      fin: new Date(donnees.manif.fin),
      url: `${window.location.origin}${window.location.pathname}${lienManif(id)}`,
      maintenant: new Date(),
    });
    telechargerDansLeNavigateur(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), NOM_FICHIER_RAPPEL);
    messageEl.textContent = 'Rappel ajouté à tes téléchargements : ouvre-le pour l’ajouter à ton agenda.';
  });

  // Avatars de ce soutien : relus du localStorage (purgé 1 h après la fin), mis en valeur.
  let propres = avatarsPropres(new Date()).filter((e) => e.m === id);
  let envoiEnCours = false;
  // Avatars propres dont on garde le jeton (relu à chaque changement, pas à chaque image).
  let propresRetirables = propres.filter((e) => jetonDeRetrait(e.a, new Date()) !== undefined);
  let dernierTexte = '';
  let finAnnoncee = false;
  const surCortege = (cortege: Cortege) => {
    // Compteur : avatars du cortège à l'heure locale (publiés et entrés, plus les siens) ;
    // c'est ce qui est dessiné. Le `compteur` de la liste des manifs sert à la liste.
    if (cortege.etat === 'terminee') {
      // Fin de la manif pendant qu'on regarde : place à l'image finale (une seule fois).
      // Le jeton de retrait est effacé par la lecture de la liste, à l'affichage de la vue.
      if (!finAnnoncee) void naviguer();
      finAnnoncee = true;
      return;
    }
    const n = cortege.avatars.length;
    const texte = `${cortege.etat === 'ouverte' ? 'Ouverte' : 'Terminée'} · ${n} ${n > 1 ? 'soutiens' : 'soutien'}`;
    if (texte !== dernierTexte) etatEl.textContent = dernierTexte = texte;
    const peutRejoindre = cortege.etat === 'ouverte' && propres.length === 0 && !envoiEnCours && !composition;
    if (boutonEl.hidden === peutRejoindre) boutonEl.hidden = !peutRejoindre;
    // Le jeton est effacé à la fin de la manif : le retrait n'est possible que tant qu'elle est ouverte.
    const peutRetirer = cortege.etat === 'ouverte' && propresRetirables.length > 0 && !envoiEnCours;
    if (retirerEl.hidden === peutRetirer) retirerEl.hidden = !peutRetirer;
    const peutRappeler = cortege.etat === 'ouverte' && !composition;
    if (rappelEl.hidden === peutRappeler) rappelEl.hidden = !peutRappeler;
    if (propres.length > 0 && !envoiEnCours && !messageEl.textContent) {
      messageEl.textContent = 'Tu marches avec le cortège. Tu peux fermer la page : ton avatar continue.';
    }
  };

  // Composition de l'apparence et de la pancarte avant d'entrer.
  let composition: PanneauComposition | null = null;
  const fermerComposition = () => {
    composition?.element.remove();
    composition = null;
  };
  const entrer = async (apparence: number, pancarte: number) => {
    envoiEnCours = true;
    composition?.occupe(true);
    // Preuve de travail anti-robots (#8) : quelques secondes de calcul, attente affichée.
    composition?.annoncer('Vérification anti-robots, quelques secondes…');
    try {
      // Jeton de retrait : gardé sur cet appareil, seul son SHA-256 part au serveur (ADR 0001).
      const jeton = nouveauJetonRetrait();
      const entree = await rejoindreLeCortege({
        manif: id,
        apparence,
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
    const apparence = sectionApparence(apparenceAuHasard());
    const pancarte = sectionPancarte(pancarteAuHasard());
    composition = creerPanneauComposition({
      sections: [apparence.section, pancarte.section],
      libelleValider: 'Rejoindre le cortège',
      surValider: () => void entrer(apparence.indice(), pancarte.indice()),
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
      const resultat = await retirerMesAvatars(propresRetirables.map((e) => e.a), new Date());
      const { retires, refuses } = resultat;
      for (const avatar of retires) retiresIci.add(avatar);
      propres = propres.filter((e) => !retires.includes(e.a));
      // Refusés pour de bon : jeton oublié, le bouton « Retirer » disparaît.
      propresRetirables = propresRetirables.filter((e) => !retires.includes(e.a) && !refuses.includes(e.a));
      if ('erreur' in resultat) messageEl.textContent = messageErreurRetrait(resultat.erreur);
      else if (refuses.length > 0) {
        messageEl.textContent = "Le retrait n'est plus possible pour ton avatar : il reste dans le cortège jusqu'à la fin.";
      } else messageEl.textContent = "Ton avatar est retiré. Il disparaîtra pour tout le monde d'ici quelques minutes.";
    } finally {
      envoiEnCours = false;
      retirerEl.disabled = false;
    }
  });

  const donnees: DonneesScene = {
    manif,
    decor: await vue.attendre(decor),
    entrees: () => entrees,
    propres: () => propres,
    retraits: () => (retiresIci.size === 0 ? retraitsPublies : [...retraitsPublies, ...retiresIci]),
    surCortege,
  };
  const jeu = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'jeu',
    backgroundColor: '#f4f1ea',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  jeu.scene.add('cortege', SceneCortege, true, donnees);
  vue.surQuitter(() => jeu.destroy(true));

  // Sans chevauchement, et rien n'est appliqué une fois la vue quittée.
  vue.rafraichir({
    intervalleMs: INTERVALLE_RAFRAICHISSEMENT_MS,
    charger: async () => {
      // Départ éventuellement corrigé.
      const aJour = (await listeManifs().catch(() => null))?.manifs.find((m) => m.id === id) ?? donnees.manif;
      return {
        manif: aJour,
        entrees: await publication.entreesPour(aJour, new Date()),
        retraits: await publication.retraits().catch(() => null),
      };
    },
    appliquer: (aJour) => {
      donnees.manif = aJour.manif;
      entrees = aJour.entrees;
      retraitsPublies = aJour.retraits ?? retraitsPublies;
    },
  });
}

/** Image finale d'une manif terminée (tout le cortège au point d'arrivée). */
async function afficherManifTerminee(
  vue: Vue,
  manif: Parameters<typeof afficherImageFinale>[1]['manif'],
  decor: Parameters<typeof afficherImageFinale>[1]['decor'],
  entrees: FichierEntrees[],
  retraits: string[],
): Promise<void> {
  // Composée hors de la page, insérée seulement si la vue est encore courante.
  const brouillon = document.createElement('div');
  const imageFinale = await vue.attendre(
    afficherImageFinale(brouillon, {
      manif,
      decor,
      entrees,
      propres: avatarsPropres(new Date()).filter((e) => e.m === manif.id),
      retraits,
      // Nom de la place d'arrivée, porté par le décor OSM (#13).
      nomPlace: decor?.places.find((p) => p.arrivee)?.nom ?? null,
    }),
  );
  interfaceEl.replaceChildren(...brouillon.childNodes);
  // Les retraits de la dernière heure peuvent encore changer l'image ; ses avatars mis en
  // valeur disparaissent 1 h après la fin (purge du stockage local).
  vue.rafraichir({
    intervalleMs: INTERVALLE_RAFRAICHISSEMENT_MS,
    charger: () => publication.retraits().catch(() => null),
    appliquer: (aJour) =>
      imageFinale.actualiser({
        propres: avatarsPropres(new Date()).filter((e) => e.m === manif.id),
        ...(aJour ? { retraits: aJour } : {}),
      }),
  });
}

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
  const vue = navigation.nouvelleVue(); // arrête le jeu et les minuteries de la vue quittée
  interfaceEl.innerHTML = '';
  const route = lireRoute(window.location.hash);
  try {
    if (route.page === 'manif') await afficherManif(route.id, vue);
    else if (route.page === 'legale') interfaceEl.innerHTML = pageLegale(route.id);
    else await afficherListe(vue);
  } catch (erreur) {
    // Vue quittée pendant un chargement : la nouvelle vue s'affiche, rien à faire.
    if (erreur instanceof VuePerimee || !vue.courante) return;
    interfaceEl.innerHTML = `<section class="carte"><p>Impossible de charger le cortège. Réessaie dans un instant.</p></section>`;
    console.error(erreur);
  }
}

document.body.insertAdjacentHTML('beforeend', piedDePage());
window.addEventListener('hashchange', () => void naviguer());
void naviguer();
