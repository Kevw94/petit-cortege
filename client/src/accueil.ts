/**
 * Page d'accueil : la liste des manifs en cartes (intitulé, ville, heure de départ
 * lisible, état, compteur de soutiens), sous un petit bandeau pixel art généré ici.
 */
import { COULEURS_PANCARTE, type ManifPubliee } from '@petit-cortege/shared';
import { lienManif } from './routage';

export type EtatCarte = 'bientot' | 'en-marche' | 'terminee';

const MINUTE = 60_000;
const HEURE = 60 * MINUTE;

/** État d'une manif pour sa carte, et le texte court qui le dit. */
export function etiquetteDepart(departMs: number, finMs: number, maintenantMs: number): { etat: EtatCarte; texte: string } {
  if (maintenantMs >= finMs) return { etat: 'terminee', texte: 'Terminée' };
  if (maintenantMs >= departMs) return { etat: 'en-marche', texte: 'En marche' };
  const reste = departMs - maintenantMs;
  if (reste < HEURE) return { etat: 'bientot', texte: `Départ dans ${Math.max(1, Math.ceil(reste / MINUTE))} min` };
  if (reste < 24 * HEURE) {
    const h = Math.floor(reste / HEURE);
    const min = Math.floor((reste % HEURE) / MINUTE);
    return { etat: 'bientot', texte: `Départ dans ${h} h${min > 0 ? ` ${String(min).padStart(2, '0')}` : ''}` };
  }
  return { etat: 'bientot', texte: 'À venir' };
}

export const nombreDeSoutiens = (n: number) => `${n.toLocaleString('fr-FR')} ${n > 1 ? 'soutiens' : 'soutien'}`;

/** « sam. 14 nov. » et « 14:30 » (heure de Paris par défaut du navigateur). */
export function jourEtHeure(iso: string): { jour: string; heure: string } {
  const date = new Date(iso);
  return {
    jour: date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
    heure: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
}

function echapper(texte: string): string {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Carte d'une manif dans la liste (lien vers sa page publique `/manif/<id>`). */
export function carteManif(m: ManifPubliee, maintenant: Date): string {
  const { etat, texte } = etiquetteDepart(Date.parse(m.depart), Date.parse(m.fin), maintenant.getTime());
  const { jour, heure } = jourEtHeure(etat === 'terminee' ? m.fin : m.depart);
  return `<li><a class="carte-manif" data-etat="${etat}" href="${lienManif(m.id)}">
      <span class="carte-manif-haut">
        <span class="pastille-etat">${texte}</span>
        <span class="carte-manif-compteur">${nombreDeSoutiens(m.compteur)}</span>
      </span>
      <strong class="carte-manif-titre">${echapper(m.intitule)}</strong>
      <span class="carte-manif-bas">
        <span>${echapper(m.ville)}</span>
        <span class="carte-manif-heure">${etat === 'terminee' ? 'fin' : 'départ'} <time datetime="${echapper(etat === 'terminee' ? m.fin : m.depart)}">${jour} · <b>${heure}</b></time></span>
      </span>
    </a></li>`;
}

/**
 * Bandeau décoratif : une file de petits personnages avec des pancartes aux couleurs du
 * catalogue, en pixels (SVG inline, rien de téléchargé). Déterministe, sans symbole.
 */
export function banniereCortege(nombre = 14): string {
  const teints = ['#f1c9a5', '#d9a77e', '#b97f55', '#8d5a3a', '#6a4129', '#e8b48f'];
  const rects: string[] = [];
  const r = (x: number, y: number, l: number, h: number, c: string) => rects.push(`<rect x="${x}" y="${y}" width="${l}" height="${h}" fill="${c}"/>`);
  const enCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  for (let i = 0; i < nombre; i++) {
    const x = 2 + i * 9;
    const saut = (i * 7) % 3 === 0 ? 1 : 0; // la file ondule un peu
    const y = 4 - saut;
    const couleur = COULEURS_PANCARTE[(i * 5 + 1) % COULEURS_PANCARTE.length]!;
    const vetement = COULEURS_PANCARTE[(i * 3 + 4) % COULEURS_PANCARTE.length]!;
    // Pancarte une fois sur deux.
    if (i % 2 === 0) {
      r(x - 1, y, 7, 4, enCss(couleur.fond));
      r(x + 2, y + 4, 1, 3, '#7a5530');
    }
    r(x + 1, y + 6, 3, 3, teints[i % teints.length]!); // tête
    r(x, y + 9, 5, 4, enCss(vetement.fond)); // corps
    r(x + 1, y + 13, 1, 2, '#3a3a3a'); // jambes
    r(x + 3, y + 13, 1, 2, '#3a3a3a');
  }
  const largeur = 2 + nombre * 9;
  return `<svg class="banniere" viewBox="0 0 ${largeur} 18" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
