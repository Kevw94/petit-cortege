/**
 * Icônes de l'interface (SVG en ligne, trait de la couleur du texte) : boutons de la caméra
 * et du mode immersif. Décoratives : chaque bouton porte son nom dans `aria-label`.
 */
const icone = (chemins: string) =>
  `<svg class="icone" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${chemins}</svg>`;

export const ICONES = {
  /** Une cible : suivre le cortège (son avatar, ou la tête). */
  suivre: icone('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  /** Un parcours de bout en bout : tout le cortège. */
  ensemble: icone('<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="5.5" r="2.5"/><path d="M7.5 17c3-1 2-5 5-6s3-3 4-4"/>'),
  plus: icone('<path d="M12 5v14M5 12h14"/>'),
  moins: icone('<path d="M5 12h14"/>'),
  /** Coins vers l'extérieur : l'interface s'efface. */
  immersion: icone('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  /** Coins vers l'intérieur : l'interface revient. */
  sortirImmersion: icone('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
};
