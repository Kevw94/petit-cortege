/**
 * Bouton de son, visible sur toutes les vues, et démarrage du son au premier geste.
 * Le choix (activé / coupé) est mémorisé sur l'appareil seulement.
 */
import { icone } from '../icones';
import { stockageLocal } from '../vue3d/mode-vue';
import { creerMoteurSon, type MoteurSon } from './moteur';
import { lireSonActive, memoriserSonActive } from './preference';

/** Événements qui comptent comme un geste pour les navigateurs (autoplay). */
const GESTES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

export function installerSon(): MoteurSon {
  const moteur = creerMoteurSon(lireSonActive(stockageLocal()));

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'bouton bouton-icone bouton-son';
  bouton.setAttribute('aria-label', 'Son');
  const afficher = () => {
    bouton.setAttribute('aria-pressed', String(moteur.actif));
    bouton.title = moteur.actif ? 'Couper le son' : 'Remettre le son';
    bouton.innerHTML = icone(moteur.actif ? 'son' : 'sonCoupe');
  };
  afficher();
  bouton.addEventListener('click', () => {
    moteur.activer(!moteur.actif);
    memoriserSonActive(moteur.actif, stockageLocal());
    afficher();
  });
  document.body.append(bouton);

  // Premier geste n'importe où : le contexte audio peut démarrer. Les écouteurs restent
  // jusqu'à ce que le son ait vraiment démarré (certains navigateurs n'acceptent que
  // touchend ou click comme geste), ou que le soutien l'ait coupé.
  const debloquer = (e: Event) => {
    if (e.target instanceof Node && bouton.contains(e.target)) return; // le bouton gère son geste
    const fini = moteur.demarre || !moteur.actif;
    moteur.debloquer();
    if (fini) for (const geste of GESTES) window.removeEventListener(geste, debloquer, true);
  };
  for (const geste of GESTES) window.addEventListener(geste, debloquer, true);
  return moteur;
}
