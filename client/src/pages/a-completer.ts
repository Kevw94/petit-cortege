/**
 * Informations que seul le porteur connaît, utilisées par les pages légales
 * (`pages-legales.ts`). Valeurs du site en production (petit-cortege.fr).
 *
 * Tant qu'une valeur commence par `[À COMPLÉTER`, elle s'affiche telle quelle,
 * bien visible, sur le site, et les scripts de déploiement refusent le build.
 */
export const A_COMPLETER = {
  /** Pseudo de l'éditeur, qui est aussi directeur de la publication. */
  pseudo: 'kevw94',
  /** Adresse e-mail de contact et de signalement (lue régulièrement). */
  emailSignalement: 'contact@petit-cortege.fr',
  /**
   * Coordonnées de l'hébergeur, recopiées des mentions légales OVHcloud
   * (https://www.ovhcloud.com/fr/terms-and-conditions/, consultées le
   * 15 novembre 2026). Pas de téléphone : cette page n'en publie pas.
   * Le numéro RCS est celui d'OVH SAS (424 761 419), pas celui de la maison
   * mère OVH Groupe SA (537 407 926).
   */
  coordonneesHebergeur:
    'OVH SAS, SAS au capital de 50 000 000 €, RCS Lille Métropole 424 761 419 00045, siège social : 2 rue Kellermann, 59100 Roubaix, France',
  /** Ville et pays du centre de données. */
  centreDeDonnees: 'Strasbourg (SBG), France',
  /**
   * Critère d'ampleur publié (ADR 0003), en une phrase qui complète « Nous
   * ajoutons une manif quand… ». Il ne porte jamais sur la cause.
   */
  critereAmpleur:
    'elle s’inscrit dans une grande journée nationale et que son parcours officiel a été rendu public par les organisateurs ou la préfecture',
  /** Durée de conservation des sauvegardes de la base (`DUREE_JOURS` dans `deploiement/sauvegarde.sh`). */
  dureeSauvegardes: '7 jours',
  /** Licence du code source et lien vers le dépôt public. */
  licenceCode: 'licence MIT (https://github.com/Kevw94/petit-cortege)',
  /** Date de dernière mise à jour des pages. */
  dateMiseAJour: '15 novembre 2026',
} as const;

/** Valeurs encore à remplir : chaque marqueur visible sur le site doit en faire partie. */
export const MARQUEURS_A_COMPLETER: readonly string[] = Object.values(A_COMPLETER).filter((valeur) =>
  valeur.startsWith('[À COMPLÉTER'),
);
