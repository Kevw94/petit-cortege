/**
 * « Lancer un chant » dans la vue d'une manif : un appel-réponse sans paroles joué sur
 * l'appareil du soutien seulement (rien n'est envoyé, personne d'autre ne l'entend ni ne
 * le voit). Pendant le chant, le slogan de sa propre pancarte (catalogue `SLOGANS`) pulse
 * en rythme ; sans avatar, une simple pulsation. Son coupé : le chant reste visuel.
 */
import { COULEURS_PANCARTE, decoderPancarte, FORMES_PANCARTE, SLOGANS } from '@petit-cortege/shared';
import type { Vue } from '../navigation';
import { programmeChant } from './chants';
import type { MoteurSon } from './moteur';

/** Numéro du prochain chant sur l'appareil : les motifs tournent d'un chant à l'autre. */
let numeroChant = 0;

const enCss = (couleur: number) => `#${couleur.toString(16).padStart(6, '0')}`;

export function brancherChant(options: {
  bouton: HTMLButtonElement;
  /** Où poser l'affichage du chant (par-dessus la vue). */
  parent: HTMLElement;
  moteur: MoteurSon;
  /** Indice de pancarte de son propre avatar, s'il en a un. */
  pancartePropre: () => number | null;
  vue: Vue;
}): void {
  const { bouton, parent, moteur, vue } = options;
  const libelle = bouton.innerHTML;
  let minuteries: ReturnType<typeof setTimeout>[] = [];
  let visuel: HTMLElement | null = null;

  const terminer = () => {
    for (const m of minuteries) clearTimeout(m);
    minuteries = [];
    visuel?.remove();
    visuel = null;
    bouton.disabled = false;
    bouton.innerHTML = libelle;
  };
  vue.surQuitter(terminer);

  bouton.addEventListener('click', () => {
    if (visuel) return;
    const programme = programmeChant(numeroChant++);
    // Le son part un peu après le clic : l'affichage se cale sur le même instant.
    const delai = moteur.jouerChant(programme) ?? 0;

    visuel = document.createElement('div');
    visuel.className = 'chant-visuel';
    visuel.setAttribute('aria-hidden', 'true');
    const pulsant = document.createElement('div');
    const composition = decoderPancarte(options.pancartePropre() ?? -1);
    if (composition) {
      const couleur = COULEURS_PANCARTE[composition.couleur]!;
      pulsant.className = 'pancarte chant-pancarte';
      pulsant.dataset.forme = FORMES_PANCARTE[composition.forme]!;
      pulsant.style.setProperty('--fond', enCss(couleur.fond));
      pulsant.style.setProperty('--texte', enCss(couleur.texte));
      const texte = document.createElement('span');
      texte.textContent = SLOGANS[composition.slogan]!;
      pulsant.append(texte);
    } else {
      pulsant.className = 'chant-pouls';
      for (let i = 0; i < 3; i++) pulsant.append(document.createElement('span'));
    }
    const legende = document.createElement('p');
    legende.className = 'chant-legende';
    legende.textContent = moteur.actif ? 'Chant local : sur ton appareil seulement' : 'Chant local, son coupé';
    visuel.append(pulsant, legende);
    parent.append(visuel);

    bouton.disabled = true;
    bouton.innerHTML = libelle.replace('Lancer un chant', 'Chant en cours…');

    const mouvementReduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    for (const p of programme.pulsations) {
      minuteries.push(
        setTimeout(
          () => {
            if (mouvementReduit) return; // affichage fixe, sans animation
            pulsant.animate(
              [{ transform: `scale(${p.fort ? 1.16 : 1.08})` }, { transform: 'scale(1)' }],
              { duration: p.fort ? 260 : 180, easing: 'ease-out' },
            );
          },
          (delai + p.t) * 1000,
        ),
      );
    }
    minuteries.push(setTimeout(terminer, (delai + programme.duree + 0.4) * 1000));
  });
}
