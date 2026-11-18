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
import { brancherMesureAudience } from './mesure-audience';
import { creerNavigation, VuePerimee, type Vue } from './navigation';
import { lireManifIntegree } from './manif-integree';
import { lienManif, lireRoute } from './routage';
import { SceneCortege, type DonneesScene } from './scene-cortege';
import type { VueCortege } from './vue-cortege';
import { choisirModeVue, lireModeVue, memoriserModeVue, stockageLocal, webglDisponible, type ModeVue } from './vue3d/mode-vue';
import { banniereCortege, carteManif } from './accueil';
import { icone } from './icones';
import { creerLimiteur, phaseAmbiance, reglagesAmbiance } from './son/ambiance';
import { brancherChant } from './son/interface-chant';
import { installerSon } from './son/interface-son';
import type { SceneSon } from './son/moteur';

/** Rafraîchissement des fichiers publiés (liste en cache court ≈ 1 min, minutes immuables). */
const INTERVALLE_RAFRAICHISSEMENT_MS = 20_000;

const publication = new Publication();
const interfaceEl = document.querySelector<HTMLDivElement>('#interface')!;
/**
 * Texte d'accueil écrit dans index.html (visible avant le JavaScript). On le déplace
 * tel quel : le réécrire ici le ferait diverger de ce que les robots lisent.
 */
const presentation = document.getElementById('presentation');
/** Chaque navigation périme la vue précédente : ses chargements en cours n'écrivent plus rien. */
const navigation = creerNavigation();
/** Son synthétisé dans le navigateur (ADR 0008) : bouton visible sur toutes les vues. */
const son = installerSon();

/** Scène sonore de la vue ; elle se tait (fondu) dès qu'on quitte la vue. */
function jouerScene(vue: Vue, scene: SceneSon): void {
  if (!vue.courante) return;
  son.scene(scene);
  vue.surQuitter(() => son.scene('silence'));
}

const lienRetour = `<a class="retour" href="/">${icone('retour', 'icone icone-petite')}Toutes les manifs</a>`;

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

/** Coque de l'accueil : le bandeau est ajouté au bloc statique, le texte n'est pas recopié. */
function poserAccueil(): HTMLElement {
  presentation?.remove();
  interfaceEl.innerHTML = `<section class="accueil"></section>`;
  const accueil = interfaceEl.querySelector<HTMLElement>('.accueil')!;
  if (presentation) {
    if (!presentation.querySelector('.banniere')) presentation.insertAdjacentHTML('afterbegin', banniereCortege());
    accueil.append(presentation);
  }
  return accueil;
}

async function afficherListe(vue: Vue): Promise<void> {
  const accueil = poserAccueil();
  let suite = '';
  try {
    const { manifs } = await vue.attendre(listeManifs());
    const ouvertes = manifs.filter((m) => !estTerminee(m));
    const terminees = manifs.filter((m) => estTerminee(m)).reverse(); // les plus récentes d'abord
    const maintenant = new Date();
    suite = `
      <h2 class="sous-titre">Cortèges ouverts</h2>
      ${
        ouvertes.length > 0
          ? `<ul class="liste-manifs">${ouvertes.map((m) => carteManif(m, maintenant)).join('')}</ul>`
          : '<p class="vide">Aucun cortège ouvert pour le moment. Reviens le jour d’une grande manif !</p>'
      }
      ${
        terminees.length === 0
          ? ''
          : `<h2 class="sous-titre">Terminées : revoir l’image finale</h2>
      <ul class="liste-manifs">${terminees.map((m) => carteManif(m, maintenant)).join('')}</ul>`
      }`;
  } catch (erreur) {
    if (erreur instanceof VuePerimee || !vue.courante) throw erreur;
    suite = '<p class="vide">Impossible de charger le cortège. Réessaie dans un instant.</p>';
    console.error(erreur);
  }
  if (!vue.courante) return;
  accueil.insertAdjacentHTML('beforeend', suite);
  jouerScene(vue, 'accueil');
}

/**
 * La liste publiée fait foi tant que la manif y est (même départ pour tous).
 * Sinon, la page embarque la manif : c'est le cas d'une manif passée, sortie
 * de la liste après le délai de consultation.
 */
async function manifDeLaRoute(id: string, vue: Vue) {
  let erreurListe: unknown;
  try {
    const publiee = (await vue.attendre(listeManifs())).manifs.find((m) => m.id === id);
    if (publiee) return publiee;
  } catch (erreur) {
    if (erreur instanceof VuePerimee) throw erreur;
    erreurListe = erreur;
  }
  const integree = lireManifIntegree(document.getElementById('donnees-manif')?.textContent, id);
  if (integree) return integree;
  // Pas de copie dans la page : une liste injoignable reste une erreur, pas un « introuvable ».
  if (erreurListe) throw erreurListe;
}

async function afficherManif(id: string, vue: Vue): Promise<void> {
  const manif = await manifDeLaRoute(id, vue);
  if (!manif) {
    interfaceEl.innerHTML = `<section class="carte"><p>Cette manif n'existe pas ou n'est plus publiée.</p>
      ${lienRetour}</section>`;
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
    <section class="carte carte-manif-info">
      ${lienRetour}
      <h1>${echapper(manif.intitule)}</h1>
      <p>${echapper(manif.ville)} · départ ${heure(manif.depart)}</p>
      <p class="etat-cortege" data-etat></p>
    </section>
    <div class="camera" role="group" aria-label="Caméra">
      <div class="barre-outils">
        <button type="button" class="bouton bouton-icone" data-ensemble aria-label="Vue d’ensemble" title="Vue d’ensemble">${icone('ensemble')}</button>
        <button type="button" class="bouton bouton-icone" data-zoom="1.5" aria-label="Rapprocher" title="Rapprocher">${icone('plus')}</button>
        <button type="button" class="bouton bouton-icone" data-zoom="0.6667" aria-label="Éloigner" title="Éloigner">${icone('moins')}</button>
        <button type="button" class="bouton bouton-icone bouton-mode" data-mode hidden></button>
      </div>
      <button type="button" class="bouton bouton-secondaire bouton-suivre" data-suivre hidden>${icone('suivre')}Suivre</button>
    </div>
    <section class="action">
      <button type="button" class="bouton bouton-principal" data-rejoindre hidden>Rejoindre le cortège</button>
      <div class="actions-secondaires">
        <button type="button" class="bouton bouton-secondaire" data-chant
          title="Un chant sans paroles, joué sur ton appareil seulement : personne d’autre ne l’entend.">${icone('chant')}Lancer un chant</button>
        <button type="button" class="bouton bouton-secondaire" data-rappel hidden
          aria-label="Rappel pour voir l’image finale" title="Rappel pour voir l’image finale (fichier d’agenda)">${icone('rappel')}Rappel</button>
        <button type="button" class="bouton bouton-secondaire" data-retirer hidden>Retirer mon avatar</button>
      </div>
      <p class="message" data-message role="status"></p>
    </section>
    <p class="attribution">${ATTRIBUTION_OSM.replace('OpenStreetMap', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>')}</p>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const boutonEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rejoindre]')!;
  const retirerEl = interfaceEl.querySelector<HTMLButtonElement>('[data-retirer]')!;
  const messageEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-message]')!;
  const rappelEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rappel]')!;
  const suivreEl = interfaceEl.querySelector<HTMLButtonElement>('[data-suivre]')!;
  const ensembleEl = interfaceEl.querySelector<HTMLButtonElement>('[data-ensemble]')!;
  const modeEl = interfaceEl.querySelector<HTMLButtonElement>('[data-mode]')!;
  const chantEl = interfaceEl.querySelector<HTMLButtonElement>('[data-chant]')!;

  // Rappel d'agenda (.ics) généré ici, au titre neutre, à l'heure de fin.
  // L'URL est la page publique de la manif (`/manif/<id>`, ADR 0010).
  rappelEl.addEventListener('click', () => {
    const ics = rappelIcs({
      fin: new Date(donnees.manif.fin),
      url: `${window.location.origin}${lienManif(id)}`,
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
  // Ambiance sonore : réglée au plus une fois par seconde (le rappel arrive à chaque image).
  const ambianceAJour = creerLimiteur(1_000);
  const surCortege = (cortege: Cortege) => {
    const maintenantMs = Date.now();
    if (ambianceAJour(maintenantMs)) {
      const phase = phaseAmbiance(cortege.etat, Date.parse(donnees.manif.depart), maintenantMs);
      son.reglerAmbiance(reglagesAmbiance({ soutiens: cortege.avatars.length, phase }));
    }
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
    const peutChanter = cortege.etat === 'ouverte' && !composition;
    if (chantEl.hidden === peutChanter) chantEl.hidden = !peutChanter;
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
    // Caméra à la troisième personne : « Suivre » n'apparaît que quand la vue est détachée.
    surModeCamera: (suivi) => {
      suivreEl.hidden = suivi;
    },
  };
  // Vue 3D (Three.js, chargé seulement ici) ou 2D (Phaser) : choix mémorisé sur l'appareil,
  // 3D par défaut si WebGL est disponible (ADR 0007).
  const webgl = webglDisponible();
  let mode: ModeVue = choisirModeVue(lireModeVue(stockageLocal()), webgl);
  let vueCortege: VueCortege | null = null;
  let changement = 0;
  const afficherMode = async (voulu: ModeVue) => {
    const numero = ++changement;
    vueCortege?.detruire();
    vueCortege = null;
    let creee: VueCortege;
    try {
      creee = voulu === '3d' ? await creerVue3D(donnees) : creerVue2D(donnees);
    } catch (erreur) {
      console.error('Vue 3D indisponible, retour à la 2D :', erreur);
      voulu = '2d';
      creee = creerVue2D(donnees);
    }
    // Vue quittée ou autre changement de mode pendant le chargement de Three.js.
    if (numero !== changement || !vue.courante) {
      creee.detruire();
      return;
    }
    vueCortege = creee;
    mode = voulu;
    modeEl.textContent = mode === '3d' ? '2D' : '3D';
    modeEl.title = mode === '3d' ? 'Vue 2D' : 'Vue 3D';
    modeEl.setAttribute('aria-label', mode === '3d' ? 'Passer à la vue 2D (de dessus)' : 'Passer à la vue 3D (troisième personne)');
    modeEl.hidden = !webgl;
  };
  void afficherMode(mode);
  modeEl.addEventListener('click', () => {
    const autre: ModeVue = mode === '3d' ? '2d' : '3d';
    memoriserModeVue(autre, stockageLocal());
    void afficherMode(autre);
  });
  suivreEl.addEventListener('click', () => vueCortege?.suivreLeCortege());
  ensembleEl.addEventListener('click', () => vueCortege?.vueDEnsemble());
  for (const bouton of interfaceEl.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
    bouton.addEventListener('click', () => vueCortege?.zoomer(Number(bouton.dataset.zoom)));
  }
  // Ambiance de manif et chant local (rien n'est envoyé : ADR 0008).
  jouerScene(vue, 'manif');
  brancherChant({
    bouton: chantEl,
    parent: interfaceEl,
    moteur: son,
    pancartePropre: () => propres.at(-1)?.pa ?? null,
    vue,
  });
  vue.surQuitter(() => {
    changement++;
    vueCortege?.detruire();
    vueCortege = null;
  });

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

/** Vue 2D (Phaser) : vue de dessus en 3/4, comme avant la 3D. */
function creerVue2D(donnees: DonneesScene): VueCortege {
  const jeu = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'jeu',
    backgroundColor: '#f4f1ea',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  jeu.scene.add('cortege', SceneCortege, true, donnees);
  // La scène n'existe qu'une fois le jeu démarré : on la cherche au moment du clic.
  const scene = () => jeu.scene.getScene('cortege') as SceneCortege | null;
  return {
    suivreLeCortege: () => scene()?.suivreLeCortege(),
    vueDEnsemble: () => scene()?.vueDEnsemble(),
    zoomer: (facteur) => scene()?.zoomer(facteur),
    detruire: () => jeu.destroy(true),
  };
}

/** Vue 3D (Three.js) : chargée à la demande, pour ne pas alourdir la liste des manifs. */
async function creerVue3D(donnees: DonneesScene): Promise<VueCortege> {
  const { creerVueCortege3D } = await import('./vue3d/vue-cortege-3d');
  return creerVueCortege3D(document.querySelector<HTMLElement>('#jeu')!, donnees);
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
  jouerScene(vue, 'accueil');
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
  // Sorti avant le vidage : sinon innerHTML détruit le texte d'accueil servi dans index.html.
  presentation?.remove();
  interfaceEl.innerHTML = '';
  const route = lireRoute(`${window.location.pathname}${window.location.hash}`);
  try {
    if (route.page === 'manif') await afficherManif(route.id, vue);
    else if (route.page === 'legale') interfaceEl.innerHTML = pageLegale(route.id); // en silence
    else await afficherListe(vue);
  } catch (erreur) {
    // Vue quittée pendant un chargement : la nouvelle vue s'affiche, rien à faire.
    if (erreur instanceof VuePerimee || !vue.courante) return;
    presentation?.remove();
    interfaceEl.innerHTML = `<section class="carte"><p>Impossible de charger le cortège. Réessaie dans un instant.</p></section>`;
    console.error(erreur);
  }
}

const identifiantMesure = import.meta.env.VITE_UMAMI_WEBSITE_ID;
brancherMesureAudience(document, window, {
  production: import.meta.env.PROD,
  identifiant: typeof identifiantMesure === 'string' ? identifiantMesure : undefined,
});
document.body.insertAdjacentHTML('beforeend', piedDePage());
window.addEventListener('hashchange', () => void naviguer());
void naviguer();
