/**
 * Informations que seul le porteur connaît, utilisées par les pages légales
 * (`pages-legales.ts`). C'est le SEUL fichier à remplir : remplace chaque
 * valeur `[À COMPLÉTER : …]` par l'information réelle, puis relis les pages
 * (`#/mentions-legales`, `#/vie-privee`, `#/charte`, `#/cgu`).
 *
 * Tant qu'une valeur commence par `[À COMPLÉTER`, elle s'affiche telle quelle,
 * bien visible, sur le site.
 */
export const A_COMPLETER = {
  /** Pseudo de l'éditeur, qui est aussi directeur de la publication. */
  pseudo: '[À COMPLÉTER : pseudo de l’éditeur]',
  /** Adresse e-mail de contact et de signalement (lue régulièrement). */
  emailSignalement: '[À COMPLÉTER : adresse e-mail de signalement]',
  /** Coordonnées complètes de l'hébergeur du serveur (raison sociale, adresse, téléphone). */
  coordonneesHetzner:
    '[À COMPLÉTER : coordonnées de l’hébergeur du serveur, ex. Hetzner Online GmbH, adresse postale et téléphone, à recopier depuis les mentions légales de Hetzner]',
  /** Ville / pays du centre de données Hetzner utilisé. */
  centreDeDonnees: '[À COMPLÉTER : emplacement du serveur, ex. Falkenstein (Allemagne) ou Helsinki (Finlande)]',
  /** Coordonnées complètes du CDN (raison sociale, adresse). */
  coordonneesBunny:
    '[À COMPLÉTER : coordonnées du CDN, ex. BunnyWay d.o.o., adresse postale, à recopier depuis les mentions légales de Bunny]',
  /**
   * Critère d'ampleur publié (ADR 0003), en une phrase qui complète « Nous
   * ajoutons une manif quand… ». Il ne doit jamais porter sur la cause.
   */
  critereAmpleur:
    '[À COMPLÉTER : critère d’ampleur, ex. « elle fait partie d’une journée de mobilisation appelée au niveau national, avec des cortèges annoncés dans au moins N villes »]',
  /** Durée de conservation des sauvegardes de la base (elles peuvent contenir des hachages de jetons de retrait). */
  dureeSauvegardes:
    '[À COMPLÉTER : durée de conservation des sauvegardes de la base, ex. « 7 jours »]',
  /** Licence du code source (et lien vers le dépôt si public). */
  licenceCode: '[À COMPLÉTER : licence du code source et lien vers le dépôt, ou « code non publié »]',
  /** Date de dernière mise à jour des pages, ex. « 6 novembre 2026 ». */
  dateMiseAJour: '[À COMPLÉTER : date de dernière mise à jour]',
} as const;

/** Valeurs encore à remplir : chaque marqueur visible sur le site doit en faire partie. */
export const MARQUEURS_A_COMPLETER: readonly string[] = Object.values(A_COMPLETER).filter((valeur) =>
  valeur.startsWith('[À COMPLÉTER'),
);
