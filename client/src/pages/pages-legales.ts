/**
 * Pages légales et de confiance (ticket #17) : mentions légales, vie privée,
 * charte (« comment on choisit les manifs ») et CGU, routées par fragment
 * (`#/vie-privee`…) et liées depuis le pied de page.
 *
 * Les textes décrivent les engagements des ADR 0001 à 0006 : toute évolution
 * de ce qui est stocké ou journalisé doit être reportée ici.
 * Les informations que seul le porteur connaît sont dans `a-completer.ts`.
 */
import { IDS_PAGES_LEGALES, lienPageLegale, type IdPageLegale } from '../routage';
import { icone } from '../icones';
import { A_COMPLETER } from './a-completer';

const TITRES: Record<IdPageLegale, string> = {
  'mentions-legales': 'Mentions légales',
  'vie-privee': 'Vie privée',
  charte: 'Charte : comment on choisit les manifs',
  cgu: 'Conditions d’utilisation',
};

const LIBELLES_PIED: Record<IdPageLegale, string> = {
  'mentions-legales': 'Mentions légales',
  'vie-privee': 'Vie privée',
  charte: 'Comment on choisit les manifs',
  cgu: 'CGU',
};

function echapper(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Valeur du fichier `a-completer.ts`, mise en évidence tant qu'elle n'est pas remplie. */
function valeur(cle: keyof typeof A_COMPLETER): string {
  const texte: string = A_COMPLETER[cle];
  return texte.startsWith('[À COMPLÉTER') ? `<mark>${echapper(texte)}</mark>` : echapper(texte);
}

/** Comme `valeur`, avec chaque URL https rendue en lien. */
function texteAvecLiens(cle: keyof typeof A_COMPLETER): string {
  const texte: string = A_COMPLETER[cle];
  if (texte.startsWith('[À COMPLÉTER')) return valeur(cle);
  return echapper(texte).replace(/https:\/\/[^\s<)]+/g, (url) => `<a href="${url}">${url}</a>`);
}

function email(): string {
  const adresse: string = A_COMPLETER.emailSignalement;
  if (adresse.startsWith('[À COMPLÉTER')) return valeur('emailSignalement');
  return `<a href="mailto:${echapper(adresse)}">${echapper(adresse)}</a>`;
}

const lien = (id: IdPageLegale) => `<a href="${lienPageLegale(id)}">${TITRES[id]}</a>`;

const CONTENUS: Record<IdPageLegale, () => string> = {
  'mentions-legales': () => `
    <h2>Éditeur</h2>
    <p>Petit Cortège est édité par un particulier, à titre non professionnel et sans but lucratif, sous le
      pseudonyme ${valeur('pseudo')}, qui est aussi directeur de la publication.</p>
    <p>Conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l’économie numérique (LCEN),
      un éditeur non professionnel peut rester anonyme : ses nom, prénom et adresse ont été communiqués à
      l’hébergeur, qui peut les transmettre à l’autorité judiciaire.</p>
    <p>Contact : ${email()}</p>

    <h2>Hébergement</h2>
    <p>Le serveur (base de données et réception des entrées dans les cortèges) est hébergé en France
      par OVH, une société française : ${valeur('coordonneesHebergeur')}. Centre de données :
      ${valeur('centreDeDonnees')}.</p>
    <p>Les fichiers du site et du cortège, identiques pour tout le monde, sont servis depuis ce même serveur.</p>

    <h2>Signaler un contenu</h2>
    <p>Pour signaler un contenu manifestement illicite (par exemple un intitulé de manif injurieux), une manif
      interdite par arrêté, ou tout autre problème, écris à l’adresse de signalement : ${email()}.</p>
    <p>Indique la manif concernée, le contenu en cause et pourquoi il te semble illicite. Nous retirons
      promptement un contenu manifestement illicite, comme la LCEN l’impose à tout hébergeur de contenus. Un
      retrait porte sur un contenu, jamais sur la cause d’une manif (voir ${lien('charte')}).</p>

    <h2>Crédits</h2>
    <p>Personnages et décor : packs Roguelike de Kenney (kenney.nl), dans le domaine public (CC0). Données
      cartographiques : © les contributeurs d’OpenStreetMap, sous licence ODbL ; les cartes dérivées
      d’OpenStreetMap utilisées par le jeu sont publiées sous la même licence.</p>
    <p>Code : ${texteAvecLiens('licenceCode')}.</p>`,

  'vie-privee': () => `
    <p>Rejoindre un cortège peut révéler une opinion politique, une donnée que le RGPD protège
      particulièrement. Petit Cortège est donc conçu pour ne relier durablement personne à une manif. Voici
      exactement ce qui est stocké, où, et combien de temps.</p>

    <h2>Ce que nous ne collectons pas</h2>
    <ul>
      <li>Ni compte, ni nom, ni adresse e-mail, ni numéro de téléphone, ni position géographique.</li>
      <li>Ni cookie, ni traceur publicitaire, ni publicité, ni script, police ou image chargés depuis
        un service d’une autre organisation.</li>
      <li>Jamais ton adresse IP à côté d’une manif : ni en base de données, ni dans les journaux du serveur.
        La mesure d’audience ci-dessous ne stocke pas non plus les adresses IP.</li>
    </ul>

    <h2>Mesure d’audience</h2>
    <p>Pour savoir combien de personnes ouvrent le site, et quelles pages, nous utilisons Umami, un outil de
      mesure d’audience que nous hébergeons nous-mêmes sur le même serveur OVH, à Strasbourg
      (stats.petit-cortege.fr). Il ne dépose pas de cookie, ne suit personne d’un site à l’autre et ne sert
      aucune publicité. Il n’enregistre pas les adresses IP. Les chiffres sont agrégés et anonymes : ils ne
      permettent pas de savoir qui a ouvert le site, ni qui a rejoint quelle manif.</p>
    <p>La mesure voit quelle page est ouverte. Comme le site change de page dans le fragment de l’adresse
      (<code>#/…</code>), ce fragment est inclus : par exemple une page légale, ou la page d’une manif. Il
      n’est toujours pas envoyé dans les adresses demandées au serveur qui affiche le site. Seule la mesure,
      chez nous, le reçoit, et sans l’adresse IP. Cette mesure sert uniquement à l’audience du site. Selon
      les recommandations de la CNIL pour la mesure d’audience, elle est exemptée de consentement. Si ton
      navigateur envoie le signal Do Not Track, elle ne s’applique pas à ta visite.</p>

    <h2>Ce qui est stocké sur notre serveur</h2>
    <ul>
      <li><strong>Ton avatar</strong>, anonyme : la manif, l’heure d’entrée arrondie à la minute avec un léger
        aléa, l’apparence et la pancarte choisies dans le catalogue. Il ne contient rien qui te désigne. Il est
        conservé après la fin pour que l’image finale du cortège reste disponible, et il est publié, comme
        tous les avatars, dans les fichiers du cortège que chacun peut télécharger.</li>
      <li><strong>Le hachage de ton jeton de retrait</strong> : seule une empreinte (SHA-256) du jeton aléatoire
        qui te permet de retirer ton avatar. C’est le seul lien entre ton appareil et une manif. Il est effacé
        au plus tard 1 h après la fin de la manif ; l’avatar redevient alors totalement anonyme et ne peut plus
        être retiré qu’à la suite d’un signalement.</li>
      <li><strong>Les sauvegardes de la base</strong> peuvent contenir ces hachages ; elles sont conservées
        ${valeur('dureeSauvegardes')}, puis détruites.</li>
    </ul>

    <h2>Ce qui reste sur ton appareil</h2>
    <p>Le stockage local de ton navigateur (localStorage, pas un cookie) garde ton jeton de retrait et de quoi
      reconnaître tes propres avatars pour les mettre en valeur. Le site l’efface à la fin de la manif. Rien de
      ce stockage n’est envoyé au serveur, sauf le jeton quand tu demandes toi-même un retrait. Il garde aussi
      tes réglages (son coupé ou non, vue 2D ou 3D), qui ne quittent jamais ton appareil. L’image finale et le
      rappel de calendrier (.ics) sont fabriqués sur ton appareil.</p>
    <p>Les sons (musique, ambiance, chants) sont synthétisés par ton navigateur : aucun fichier audio n’est
      téléchargé. Un chant lancé ne s’entend et ne se voit que sur ton appareil : rien n’est envoyé au serveur.</p>

    <h2>Anti-triche</h2>
    <p>Chaque entrée demande à ton appareil un petit calcul (une « preuve de travail », sans service tiers). Pour
      limiter les entrées en rafale, le serveur compte les entrées par adresse IP <strong>en mémoire
      uniquement</strong> : ce compte n’est jamais écrit sur disque ni journalisé, et disparaît en quelques
      minutes. Le compteur affiche des « soutiens », pas un chiffre certifié.</p>

    <h2>Journaux techniques</h2>
    <ul>
      <li>Le programme qui reçoit les entrées dans les cortèges n’enregistre aucune adresse IP dans ses
        journaux.</li>
      <li>L’identifiant d’une manif n’apparaît jamais dans une adresse demandée au serveur : il reste
        après le <code>#</code> de l’adresse, que le navigateur n’envoie pas. Les fichiers du site et du
        cortège sont servis depuis ce même serveur, et ils sont les mêmes pour tout le monde, quelle que
        soit la manif que tu regardes.</li>
    </ul>

    <h2>Hébergement en France et Cloud Act</h2>
    <p>Le serveur est hébergé en France, à Strasbourg, par OVH, une société française (voir
      ${lien('mentions-legales')}). Les fichiers du site et du cortège sont servis depuis ce même serveur.
      Le Cloud Act américain permet aux autorités des États-Unis d’exiger des données auprès des fournisseurs
      soumis à leur juridiction, même stockées en Europe. OVH est une société française ; nous n’affirmons pas
      pour autant qu’elle échappe à cette loi. La protection repose d’abord sur ce que nous ne stockons pas :
      même obtenues par une autorité, nos données ne permettent pas de savoir qui a rejoint quelle manif.</p>

    <h2>Base légale et responsable</h2>
    <p>Le responsable du traitement est l’éditeur du site, ${valeur('pseudo')}, joignable à ${email()}. Le
      traitement repose sur ton consentement explicite, donné en rejoignant un cortège ; tu peux le retirer à
      tout moment en retirant ton avatar.</p>

    <h2>Tes droits</h2>
    <p>Tu disposes des droits d’accès, de rectification, d’effacement, de limitation et d’opposition prévus par
      le RGPD. Comme nous ne savons pas qui tu es, nous ne pouvons généralement pas retrouver tes données sans
      ton jeton de retrait : le plus simple est de retirer ton avatar depuis le site avant la fin de la manif.
      Pour toute demande, écris à ${email()}. Tu peux aussi adresser une réclamation à la CNIL (cnil.fr).</p>
    <p>Si tu nous écris, nous ne conservons ton message et ton adresse que le temps de traiter ta demande.</p>`,

  charte: () => `
    <h2>Ce qu’est Petit Cortège</h2>
    <p>Un moyen de soutenir à distance une manifestation réelle. Le cortège virtuel suit le parcours et
      l’horaire annoncés publiquement, jamais la position réelle des gens : ce n’est pas un outil
      d’information sur le terrain. Si la vraie manif part en retard, le cortège virtuel est en avance.</p>
    <p>Le compteur indique un nombre de « soutiens » qui ont rejoint le cortège virtuel. Ce n’est pas un chiffre
      certifié et il ne se compare ni aux chiffres officiels ni à ceux des organisateurs.</p>
    <p>Petit Cortège n’est lié à aucun parti, syndicat, association ou organisateur de manif.</p>

    <h2>Comment on choisit les manifs</h2>
    <p>Nous ne jugeons jamais une cause. Une manif est acceptable, quelle que soit sa cause, y compris si nous la
      désapprouvons, dès lors qu’elle est :</p>
    <ul>
      <li>déclarée ;</li>
      <li>non interdite par arrêté préfectoral ;</li>
      <li>dotée d’un parcours annoncé publiquement.</li>
    </ul>
    <p>Pour l’instant, les manifs sont saisies à la main et nous ne pouvons pas toutes les ajouter. Nous les
      sélectionnons sur leur ampleur, jamais sur leur cause : nous ajoutons une manif quand
      ${valeur('critereAmpleur')}. Le parcours est tracé d’après des sources publiques, citées.</p>

    <h2>Quand une manif est refusée ou retirée</h2>
    <p>Une manif n’est exclue que sur un acte extérieur et objectif : un arrêté d’interdiction, une décision de
      justice, ou la dissolution par décret du groupe qui l’organise. Comme les arrêtés sont souvent pris la
      veille, nous vérifions leur absence juste avant le départ et retirons la manif en cas d’interdiction.</p>
    <p>Les refus pratiques (capacité, parcours non publié) sont motivés publiquement.</p>
    <p>Retirer un contenu manifestement illicite qui nous est signalé, par exemple un intitulé injurieux, est
      une obligation légale qui porte sur ce contenu, pas un jugement sur la cause (voir
      ${lien('mentions-legales')}).</p>
    <p>L’heure de départ peut être corrigée par un modérateur s’il est disponible ; la fin du cortège est alors
      décalée d’autant.</p>

    <h2>Avatars et pancartes</h2>
    <p>Les avatars sont composés uniquement d’éléments neutres : ni drapeau, ni symbole de parti ou de syndicat,
      ni signe d’appartenance, ni arme ou équipement de combat. Les pancartes portent des slogans génériques
      choisis dans un catalogue, sans texte libre ni image importée. Personne ne peut donc y écrire ce qu’il
      veut, et personne n’est désigné par son avatar.</p>
    <p>Pour proposer une manif ou contester une décision, écris à ${email()}.</p>`,

  cgu: () => `
    <h2>Objet</h2>
    <p>Ces conditions encadrent l’utilisation de Petit Cortège, service gratuit, sans compte et sans publicité,
      qui permet de soutenir à distance une manif en rejoignant son cortège virtuel. Utiliser le site vaut
      acceptation de ces conditions et de la ${lien('charte')}.</p>

    <h2>Utilisation</h2>
    <ul>
      <li>Rejoins un cortège pour toi-même. N’automatise pas les entrées et ne cherche pas à fausser le
        compteur : les entrées suspectes peuvent être limitées ou supprimées.</li>
      <li>N’essaie pas de perturber le service ni de contourner ses protections.</li>
      <li>Tu peux retirer ton avatar depuis le site jusqu’à la fin de la manif. Ensuite, il devient anonyme et
        reste dans l’image finale ; il ne peut plus être supprimé qu’à la suite d’un signalement.</li>
    </ul>

    <h2>Contenus</h2>
    <p>Les apparences, slogans et pancartes viennent d’un catalogue prédéfini : tu ne publies aucun texte ni
      image. Les informations sur les manifs (intitulé, parcours, horaire) proviennent de sources publiques et
      peuvent être inexactes ou changer : fie-toi aux organisateurs pour toute information pratique. Tu peux
      signaler un contenu selon les ${lien('mentions-legales')}.</p>
    <p>Tu peux librement partager l’image finale d’un cortège. Les données d’OpenStreetMap restent sous licence
      ODbL (« © les contributeurs d’OpenStreetMap »).</p>

    <h2>Responsabilité et disponibilité</h2>
    <p>Petit Cortège est un projet personnel, fourni tel quel, sans garantie de disponibilité ni d’exactitude.
      Il peut être interrompu, modifié ou arrêté à tout moment. Il ne remplace pas une participation réelle et
      ne donne aucune information sur ce qui se passe sur le terrain.</p>

    <h2>Données personnelles</h2>
    <p>Voir la page ${lien('vie-privee')}. Elle décrit aussi la mesure d’audience, faite sans cookie sur notre
      propre serveur.</p>

    <h2>Modification et droit applicable</h2>
    <p>Ces conditions peuvent évoluer ; la version en ligne fait foi. Elles sont soumises au droit français.</p>`,
};

/** Page légale complète, en HTML, à afficher par-dessus le canvas. */
export function pageLegale(id: IdPageLegale): string {
  return `
    <article class="carte page-legale">
      <a class="retour" href="#/">${icone('retour', 'icone icone-petite')}Toutes les manifs</a>
      <h1>${TITRES[id]}</h1>
      ${CONTENUS[id]()}
      <p class="mise-a-jour">Dernière mise à jour : ${valeur('dateMiseAJour')}</p>
    </article>`;
}

/** Pied de page affiché sur toutes les vues, avec un lien vers chaque page légale. */
export function piedDePage(): string {
  return `<nav class="pied-de-page" aria-label="Informations légales">
    ${IDS_PAGES_LEGALES.map((id) => `<a href="${lienPageLegale(id)}">${LIBELLES_PIED[id]}</a>`).join(' · ')}
  </nav>`;
}
