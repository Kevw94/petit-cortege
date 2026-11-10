import * as Phaser from 'phaser';
import { apparenceAuHasard, ATTRIBUTION_OSM, COULEURS_PLAN, type FichierEntrees, type ManifPubliee } from '@petit-cortege/shared';
import '@fontsource/permanent-marker/latin-400.css';
import {
  avatarsPropres,
  jetonDeRetrait,
  memoriserAvatarPropre,
  suivreFinsDesManifs,
} from './avatars-propres';
import { chargerDecor } from './decor/chargement';
import { chargerPlan, decoderPlan } from './decor/plan';
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
import { etatDeLaManif, traceMiniature } from './liste/liste';
import { resumeMeteo, type IconeMeteo } from './meteo/ambiance';
import { creerImmersion } from './immersion';
import { ICONES } from './icones';
import { creerVoileMeteo } from './meteo/voile-2d';
import { lienManif, lireRoute } from './routage';
import { SceneCortege, type DonneesScene } from './scene-cortege';
import type { VueCortege } from './vue-cortege';
import { choisirModeVue, lireModeVue, memoriserModeVue, stockageLocal, webglDisponible, type ModeVue } from './vue3d/mode-vue';

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
  let affichees = '';
  const afficher = (manifs: ManifPubliee[]) => {
    const maintenant = new Date();
    const ouvertes = manifs.filter((m) => !estTerminee(m, maintenant));
    const terminees = manifs.filter((m) => estTerminee(m, maintenant)).reverse(); // les plus récentes d'abord
    // Mêmes manifs qu'à l'affichage précédent : seuls l'état, les soutiens et la météo changent
    // (le tracé ne se redessine pas, le focus clavier reste en place).
    const cles = JSON.stringify([ouvertes.map((m) => m.id), terminees.map((m) => m.id)]);
    if (cles === affichees) {
      for (const m of ouvertes) {
        const carton = interfaceEl.querySelector<HTMLElement>(`[data-manif="${CSS.escape(m.id)}"]`);
        if (!carton) continue;
        const etat = etatDeLaManif(m, maintenant);
        const etatEl = carton.querySelector<HTMLElement>('.carton-etat')!;
        etatEl.textContent = etat.texte;
        etatEl.dataset.phase = etat.phase;
        carton.querySelector('.carton-details')!.innerHTML = detailsDeManif(m, maintenant);
      }
      return;
    }
    affichees = cles;
    interfaceEl.innerHTML = `
    <main class="accueil">
      <header class="accueil-tete">
        <h1 class="accueil-titre">Petit Cortège</h1>
        <p class="accueil-intro">Soutiens une manif à distance : ton avatar marche avec le cortège, sur le parcours et à l’heure annoncés.</p>
      </header>
      <section aria-labelledby="titre-ouvertes">
        <h2 id="titre-ouvertes" class="accueil-section">${ouvertes.length > 0 ? 'Cortèges à rejoindre' : 'Aucun cortège ouvert pour le moment'}</h2>
        ${
          ouvertes.length > 0
            ? `<ul class="cartons">${ouvertes.map((m, i) => cartonDeManif(m, i, maintenant)).join('')}</ul>`
            : `<p class="accueil-vide">Les grandes journées nationales apparaissent ici dès que leur parcours est publié.</p>`
        }
      </section>
      ${
        terminees.length === 0
          ? ''
          : `<section aria-labelledby="titre-terminees">
        <h2 id="titre-terminees" class="accueil-section">Terminées : revoir l’image finale</h2>
        <ul class="terminees">${terminees.map((m) => `<li><a href="${lienManif(m.id)}"><strong>${echapper(m.intitule)}</strong>
          <span>${echapper(m.ville)}, terminée ${heure(m.fin)}</span></a></li>`).join('')}</ul>
      </section>`
      }
    </main>`;
  };
  afficher((await vue.attendre(listeManifs())).manifs);
  vue.rafraichir({ intervalleMs: INTERVALLE_RAFRAICHISSEMENT_MS, charger: listeManifs, appliquer: (liste) => afficher(liste.manifs) });
}

/** Inclinaisons des cartons, à tour de rôle : tenues à la main, pas alignées au cordeau. */
const INCLINAISONS = [-1.4, 0.9, -0.6, 1.3, -1];
const ICONES_METEO: Record<IconeMeteo, string> = {
  soleil: '☀️', lune: '🌙', eclaircies: '🌤️', nuages: '☁️', brouillard: '🌫️', pluie: '🌧️', neige: '🌨️', orage: '⛈️',
};

/** Soutiens et météo d'une manif, sur son carton. */
function detailsDeManif(m: ManifPubliee, maintenant: Date): string {
  const meteo = m.meteo && resumeMeteo(m.meteo, m.parcours.coordinates[0]!, maintenant);
  return `<span>${m.compteur} ${m.compteur > 1 ? 'soutiens' : 'soutien'}</span>${
    meteo ? `<span><span aria-hidden="true">${ICONES_METEO[meteo.icone]}</span> ${meteo.texte}</span>` : ''
  }`;
}

/** Une manif ouverte sur l'accueil : un carton tenu à la main, avec le tracé de son parcours. */
function cartonDeManif(m: ManifPubliee, rang: number, maintenant: Date): string {
  const etat = etatDeLaManif(m, maintenant);
  const trace = traceMiniature(m.parcours, { largeur: 120, hauteur: 96, marge: 12 });
  const [depart, arrivee] = [trace.points[0]!, trace.points.at(-1)!];
  return `<li data-manif="${echapper(m.id)}"><a class="carton-manif" href="${lienManif(m.id)}" style="--inclinaison: ${INCLINAISONS[rang % INCLINAISONS.length]}deg">
    <svg class="trace-miniature" viewBox="0 0 120 96" aria-hidden="true">
      <path class="trace-fond" d="${trace.d}" />
      <path class="trace-ligne" d="${trace.d}" style="--longueur: ${Math.ceil(trace.longueur)}" />
      <circle class="trace-depart" cx="${depart.x.toFixed(1)}" cy="${depart.y.toFixed(1)}" r="4" />
      <circle class="trace-arrivee" cx="${arrivee.x.toFixed(1)}" cy="${arrivee.y.toFixed(1)}" r="5" />
    </svg>
    <span class="carton-texte">
      <strong class="carton-titre">${echapper(m.intitule)}</strong>
      <span class="carton-lieu">${echapper(m.ville)}, départ ${heure(m.depart)}</span>
      <span class="carton-etat" data-phase="${etat.phase}">${etat.texte}</span>
      <span class="carton-details">${detailsDeManif(m, maintenant)}</span>
    </span>
  </a></li>`;
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
  // Plan de la ville autour du décor (ADR 0008) : même règle, tous les plans sont demandés.
  const plan = chargerPlan(manif.parcours.coordinates).then((charge) => (charge ? decoderPlan(charge) : null));
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
      <h1 class="titre-manif">${echapper(manif.intitule)}</h1>
      <p>${echapper(manif.ville)} · départ ${heure(manif.depart)}</p>
      <p data-etat></p>
      <p class="meteo-manif" data-meteo></p>
    </section>
    <div class="camera" role="group" aria-label="Caméra">
      <button type="button" data-suivre data-libelle="Suivre le cortège" aria-label="Suivre le cortège" hidden>${ICONES.suivre}</button>
      <button type="button" data-ensemble data-libelle="Vue d’ensemble" aria-label="Vue d’ensemble">${ICONES.ensemble}</button>
      <span class="camera-separateur" aria-hidden="true"></span>
      <button type="button" data-zoom="1.5" data-libelle="Rapprocher" aria-label="Rapprocher">${ICONES.plus}</button>
      <button type="button" data-zoom="0.6667" data-libelle="Éloigner" aria-label="Éloigner">${ICONES.moins}</button>
      <span class="camera-separateur" aria-hidden="true"></span>
      <button type="button" class="camera-mode" data-mode hidden></button>
      <button type="button" data-immersion data-libelle="Mode immersif" aria-label="Mode immersif : masquer les boutons">${ICONES.immersion}</button>
    </div>
    <button type="button" class="sortir-immersion" data-sortir-immersion aria-label="Quitter le mode immersif : afficher les boutons" title="Afficher les boutons (Échap)">${ICONES.sortirImmersion}</button>
    <section class="action">
      <button type="button" class="rejoindre" data-rejoindre hidden>Rejoindre le cortège</button>
      <button type="button" class="retirer" data-retirer hidden>Retirer mon avatar</button>
      <button type="button" class="rappel" data-rappel hidden>Rappel pour voir l’image finale</button>
      <p class="message" data-message role="status"></p>
    </section>
    <p class="attribution">${ATTRIBUTION_OSM.replace('OpenStreetMap', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>')}${
      manif.meteo ? ' · météo <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>' : ''
    }</p>`;
  const etatEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-etat]')!;
  const boutonEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rejoindre]')!;
  const retirerEl = interfaceEl.querySelector<HTMLButtonElement>('[data-retirer]')!;
  const messageEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-message]')!;
  const rappelEl = interfaceEl.querySelector<HTMLButtonElement>('[data-rappel]')!;
  const suivreEl = interfaceEl.querySelector<HTMLButtonElement>('[data-suivre]')!;
  const ensembleEl = interfaceEl.querySelector<HTMLButtonElement>('[data-ensemble]')!;
  const modeEl = interfaceEl.querySelector<HTMLButtonElement>('[data-mode]')!;
  const meteoEl = interfaceEl.querySelector<HTMLParagraphElement>('[data-meteo]')!;
  /** Météo publiée au départ du parcours (ADR 0008), rafraîchie avec la liste des manifs. */
  const afficherMeteo = (m: ManifPubliee) => {
    const resume = m.meteo && resumeMeteo(m.meteo, m.parcours.coordinates[0]!, new Date());
    meteoEl.textContent = resume ? `${ICONES_METEO[resume.icone]} ${resume.texte}` : '';
  };
  afficherMeteo(manif);

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
    plan: await vue.attendre(plan),
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
    modeEl.dataset.libelle = mode === '3d' ? 'Vue 2D, de dessus' : 'Vue 3D, dans la rue';
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
  // Mode immersif : l'interface s'efface, la vue reste ; le bouton de sortie prend le focus.
  const sortirImmersionEl = interfaceEl.querySelector<HTMLButtonElement>('[data-sortir-immersion]')!;
  const entrerImmersionEl = interfaceEl.querySelector<HTMLButtonElement>('[data-immersion]')!;
  const immersion = creerImmersion((active) => (active ? sortirImmersionEl : entrerImmersionEl).focus({ preventScroll: true }));
  entrerImmersionEl.addEventListener('click', () => immersion.entrer());
  sortirImmersionEl.addEventListener('click', () => immersion.sortir());
  vue.surQuitter(() => {
    immersion.detruire();
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
      afficherMeteo(aJour.manif);
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
    // Au-delà du plan de la ville : la couleur de ses îlots, sans coupure.
    backgroundColor: `#${COULEURS_PLAN.ilot.toString(16).padStart(6, '0')}`,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [],
  });
  jeu.scene.add('cortege', SceneCortege, true, donnees);
  // La scène n'existe qu'une fois le jeu démarré : on la cherche au moment du clic.
  const scene = () => jeu.scene.getScene('cortege') as SceneCortege | null;
  const meteo = creerVoileMeteo(document.querySelector<HTMLElement>('#jeu')!, () => donnees.manif);
  return {
    suivreLeCortege: () => scene()?.suivreLeCortege(),
    vueDEnsemble: () => scene()?.vueDEnsemble(),
    zoomer: (facteur) => scene()?.zoomer(facteur),
    detruire: () => {
      meteo.detruire();
      jeu.destroy(true);
    },
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
  document.body.dataset.page = route.page;
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
