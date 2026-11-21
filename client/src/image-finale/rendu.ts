/**
 * Rendu de l'image finale dans un canvas 2D (sans Phaser) : décor OSM de la place
 * d'arrivée, tracé du parcours, masse de foule atténuée, avatars du premier plan avec
 * leur pancarte, mise en valeur « toi », nom de la place, compteur de soutiens et
 * mention OSM. Se contente d'afficher la composition du Cortège (`composerImageFinale`).
 *
 * Le canvas est réutilisable tel quel pour le PNG à télécharger ou à partager (#16) :
 * `imageFinaleEnPng`. Rendu en pixels entiers (tuiles Kenney à l'échelle 1, 2 ou 3).
 */
import {
  ATTRIBUTION_OSM,
  METRES_PAR_TUILE,
  TAILLE_TUILE_PX,
  tuileEn,
  versTuiles,
  type Decor,
  type Georeference,
  type ManifPubliee,
  type TilesetTiled,
} from '@petit-cortege/shared';
import urlRpg from '../../../assets/kenney/rpg/Spritesheet/roguelikeSheet_transparent.png';
import urlVille from '../../../assets/kenney/city/Spritesheet/roguelikeCity_transparent.png';
import { COULEUR_FOND_CSS, cuireAlentours } from '../decor/alentours';
import { CELLULE_APPARENCE, dessinerApparence, HAUTEUR_TETE_PX, URL_COUCHES_APPARENCE } from '../apparence/dessin';
import type { AvatarImageFinale, ImageFinale } from '../cortege/image-finale';
import { pancartesAffichees, type PancarteAffichee } from '../pancartes/affichage';

/** Format portrait 4:5, celui des réseaux sociaux. */
export const LARGEUR_IMAGE_FINALE = 1080;
export const HAUTEUR_IMAGE_FINALE = 1350;
const BANDEAU_HAUT_PX = 200;
const BANDEAU_BAS_PX = 190;
/** Marge de décor autour de la foule, et demi-largeur minimale de la vue (en mètres). */
const MARGE_M = 8;
const DEMI_VUE_MIN_M = 22;
const ECHELLE_MAX = 3;
const POLICE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const COULEUR_TOI = '#f1c40f';
const COULEUR_LIGNE = '#f4c542';
/** Voile posé sur la masse de foule pour que le premier plan ressorte (comme la masse en marche, #14). */
const VOILE_MASSE = 'rgba(190, 190, 200, 0.55)';

/** Images des tilesets Kenney (CC0), par nom de tileset Tiled. */
const URLS_TILESETS: Record<string, string> = { roguelikeCity: urlVille, roguelikeSheet: urlRpg };

export interface RessourcesImageFinale {
  couches: HTMLImageElement;
  tilesets: Map<string, HTMLImageElement>;
}

function chargerImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image indisponible : ${url}`));
    image.src = url;
  });
}

/** Atlas des apparences et planches Kenney du décor. */
export async function chargerRessourcesImageFinale(): Promise<RessourcesImageFinale> {
  const [couches, ...planches] = await Promise.all([
    chargerImage(URL_COUCHES_APPARENCE),
    ...Object.values(URLS_TILESETS).map(chargerImage),
  ]);
  return { couches, tilesets: new Map(Object.keys(URLS_TILESETS).map((nom, i) => [nom, planches[i]!])) };
}

export interface DonneesImageFinale {
  manif: ManifPubliee;
  decor: Decor | null;
  image: ImageFinale;
  /** Nom de la place d'arrivée (décor OSM, #13) ; à défaut, « Arrivée du cortège ». */
  nomPlace: string | null;
  ressources: RessourcesImageFinale;
}

/** Dessine l'image finale dans `canvas` (redimensionné à 1080 × 1350). */
export function dessinerImageFinale(canvas: HTMLCanvasElement, donnees: DonneesImageFinale): void {
  const { manif, decor, image, ressources } = donnees;
  canvas.width = LARGEUR_IMAGE_FINALE;
  canvas.height = HAUTEUR_IMAGE_FINALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = decor ? COULEUR_FOND_CSS : '#c9c3b6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Cadrage : la place d'arrivée au centre de la zone entre les bandeaux, échelle entière.
  const zone = { haut: BANDEAU_HAUT_PX, hauteur: HAUTEUR_IMAGE_FINALE - BANDEAU_HAUT_PX - BANDEAU_BAS_PX };
  const demiVueM = Math.max(image.rayonM + MARGE_M, DEMI_VUE_MIN_M);
  const pxParMetreBrut = Math.min(LARGEUR_IMAGE_FINALE, zone.hauteur) / (2 * demiVueM);
  const echelle = Math.min(ECHELLE_MAX, Math.max(1, Math.floor(pxParMetreBrut / (TAILLE_TUILE_PX / METRES_PAR_TUILE))));
  const pxParMetre = (echelle * TAILLE_TUILE_PX) / METRES_PAR_TUILE;
  const georef: Georeference = decor?.georef ?? { origine: manif.parcours.coordinates[0]! };
  const enMetres = (p: [number, number]) => {
    const t = versTuiles(georef, p);
    return { x: t.x * METRES_PAR_TUILE, y: t.y * METRES_PAR_TUILE };
  };
  const arrivee = enMetres(manif.parcours.coordinates[manif.parcours.coordinates.length - 1]!);
  const centre = { x: LARGEUR_IMAGE_FINALE / 2, y: zone.haut + zone.hauteur / 2 };
  const versImage = (m: { x: number; y: number }) => ({
    x: Math.round(centre.x + (m.x - arrivee.x) * pxParMetre),
    y: Math.round(centre.y + (m.y - arrivee.y) * pxParMetre),
  });

  if (decor) dessinerDecor(ctx, decor, ressources, versImage, echelle);
  dessinerParcours(ctx, manif.parcours.coordinates.map(enMetres).map(versImage), echelle);

  const placer = (a: AvatarImageFinale) => ({ ...a, ...versImage({ x: arrivee.x + a.xM, y: arrivee.y + a.yM }) });
  const apparences = new ApparencesPrecomposees(ressources.couches);

  // Masse de foule : avatars atténués, sans pancarte, sous le premier plan.
  if (image.masse.length > 0) {
    const calque = document.createElement('canvas');
    calque.width = canvas.width;
    calque.height = canvas.height;
    const c = calque.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    for (const a of image.masse.map(placer)) apparences.dessiner(c, a.apparence, a.x, a.y, echelle);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = VOILE_MASSE;
    c.fillRect(0, 0, calque.width, calque.height);
    ctx.drawImage(calque, 0, 0);
  }

  // Premier plan, du fond vers l'avant ; ses propres avatars par-dessus, avec halo.
  const premierPlan = image.premierPlan.map(placer);
  for (const a of premierPlan) if (!a.propre) apparences.dessiner(ctx, a.apparence, a.x, a.y, echelle);
  const hauteurTete = HAUTEUR_TETE_PX * echelle;
  const pancartes = pancartesAffichees(
    premierPlan.map((a) => ({ x: a.x, y: a.y - hauteurTete, pancarte: a.pancarte, propre: a.propre })),
    { echelle: pxParMetre, largeur: canvas.width, hauteur: canvas.height },
  );
  for (const p of pancartes) if (!p.propre) dessinerPancarte(ctx, p);
  const propres = premierPlan.filter((a) => a.propre);
  for (const a of propres) {
    const rayon = Math.max(CELLULE_APPARENCE.hauteur * echelle * 0.55, 8);
    const cy = a.y - hauteurTete / 2;
    ctx.fillStyle = 'rgba(241, 196, 15, 0.35)';
    disque(ctx, a.x, cy, rayon + 8);
    ctx.fillStyle = 'rgba(241, 196, 15, 0.85)';
    disque(ctx, a.x, cy, rayon);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.stroke();
    apparences.dessiner(ctx, a.apparence, a.x, a.y, echelle);
  }
  for (const p of pancartes) if (p.propre) dessinerPancarte(ctx, p);
  for (const p of pancartes.filter((p) => p.propre).slice(0, 1)) etiquetteToi(ctx, p.x, p.y - p.hauteur / 2 - 6);

  dessinerBandeaux(ctx, donnees);
}

/** PNG de l'image finale (téléchargement, partage natif : #16). */
export function imageFinaleEnPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG indisponible'))), 'image/png'),
  );
}

/** Une apparence précomposée par indice (toutes ses couches), dessinée ensuite en un seul `drawImage`. */
class ApparencesPrecomposees {
  readonly #couches: CanvasImageSource;
  readonly #cache = new Map<number, HTMLCanvasElement>();

  constructor(couches: CanvasImageSource) {
    this.#couches = couches;
  }

  /** Pieds de l'avatar en (x, y) : milieu du bas de la cellule. */
  dessiner(ctx: CanvasRenderingContext2D, indice: number, x: number, y: number, echelle: number): void {
    let cellule = this.#cache.get(indice);
    if (!cellule) {
      cellule = document.createElement('canvas');
      cellule.width = CELLULE_APPARENCE.largeur;
      cellule.height = CELLULE_APPARENCE.hauteur;
      dessinerApparence(cellule.getContext('2d')!, this.#couches, indice, 0, 0);
      this.#cache.set(indice, cellule);
    }
    const l = CELLULE_APPARENCE.largeur * echelle;
    const h = CELLULE_APPARENCE.hauteur * echelle;
    ctx.drawImage(cellule, Math.round(x - l / 2), y - h, l, h);
  }
}

function dessinerDecor(
  ctx: CanvasRenderingContext2D,
  decor: Decor,
  ressources: RessourcesImageFinale,
  versImage: (m: { x: number; y: number }) => { x: number; y: number },
  echelle: number,
): void {
  // Plan de la ville (s'il existe) : au-delà de la bande, si la foule à l'arrivée déborde ;
  // cases nettes (pixel art), comme en jeu.
  const alentours = cuireAlentours(decor, (nom) => ressources.tilesets.get(nom));
  if (alentours) {
    const a = versImage({ x: alentours.x, y: alentours.y });
    const b = versImage({ x: alentours.x + alentours.largeur, y: alentours.y + alentours.hauteur });
    const lisse = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(alentours.canvas, a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.imageSmoothingEnabled = lisse;
  }
  const cote = TAILLE_TUILE_PX * echelle;
  const origine = versImage({ x: 0, y: 0 }); // coin de la tuile (0, 0)
  const x0 = Math.floor(-origine.x / cote);
  const y0 = Math.floor(-origine.y / cote);
  const x1 = Math.ceil((LARGEUR_IMAGE_FINALE - origine.x) / cote);
  const y1 = Math.ceil((HAUTEUR_IMAGE_FINALE - origine.y) / cote);
  for (const couche of decor.nomsCouches) {
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const gid = tuileEn(decor, couche, tx, ty);
        const source = gid === 0 ? null : sourceTuile(decor.tilesets, ressources, gid);
        if (!source) continue;
        ctx.drawImage(
          source.image,
          source.sx,
          source.sy,
          TAILLE_TUILE_PX,
          TAILLE_TUILE_PX,
          origine.x + tx * cote,
          origine.y + ty * cote,
          cote,
          cote,
        );
      }
    }
  }
}

function sourceTuile(tilesets: TilesetTiled[], ressources: RessourcesImageFinale, gid: number) {
  const tileset = tilesets.reduce<TilesetTiled | null>((t, c) => (gid >= c.firstgid ? c : t), null);
  const image = tileset && ressources.tilesets.get(tileset.name);
  if (!tileset || !image) return null;
  const i = gid - tileset.firstgid;
  const pas = tileset.tilewidth + tileset.spacing;
  return {
    image,
    sx: tileset.margin + (i % tileset.columns) * pas,
    sy: tileset.margin + Math.floor(i / tileset.columns) * pas,
  };
}

function dessinerParcours(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], echelle: number): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = COULEUR_LIGNE;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 3 * echelle;
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

const couleurCss = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function disque(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Pancarte : manche et panneau (forme, couleur), slogan quand il est lisible. */
function dessinerPancarte(ctx: CanvasRenderingContext2D, p: PancarteAffichee): void {
  const { x, y, largeur: l, hauteur: h } = p;
  ctx.strokeStyle = '#7a5530';
  ctx.lineWidth = Math.max(1, l * 0.07);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, p.yManche);
  ctx.stroke();

  ctx.fillStyle = couleurCss(p.couleur.fond);
  ctx.strokeStyle = 'rgba(34, 34, 34, 0.7)';
  ctx.lineWidth = Math.max(1, Math.min(l * 0.04, 3));
  ctx.beginPath();
  switch (p.forme) {
    case 'rond':
      ctx.ellipse(x, y, l / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'losange':
      ctx.moveTo(x, y - h / 2);
      ctx.lineTo(x + l / 2, y);
      ctx.lineTo(x, y + h / 2);
      ctx.lineTo(x - l / 2, y);
      ctx.closePath();
      break;
    default:
      ctx.rect(x - l / 2, y - h / 2, l, h);
  }
  ctx.fill();
  ctx.stroke();

  if (p.slogan === null) return;
  // Slogan sur une ou deux lignes, réduit pour tenir dans la partie utile du panneau.
  const utile = p.forme === 'losange' ? 0.6 : p.forme === 'rond' ? 0.72 : 0.86;
  const lignes = couper(p.slogan);
  let taille = h * 0.4;
  ctx.font = `bold ${taille}px ${POLICE}`;
  const plusLarge = Math.max(...lignes.map((ligne) => ctx.measureText(ligne).width));
  taille = Math.min(taille, (taille * l * utile) / plusLarge, (h * utile) / (lignes.length * 1.15));
  ctx.font = `bold ${taille}px ${POLICE}`;
  ctx.fillStyle = couleurCss(p.couleur.texte);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lignes.forEach((ligne, i) => ctx.fillText(ligne, x, y + (i - (lignes.length - 1) / 2) * taille * 1.15));
}

/** Coupe un slogan en deux lignes équilibrées s'il a plusieurs mots. */
function couper(slogan: string): string[] {
  const mots = slogan.split(' ');
  if (mots.length < 3) return [slogan];
  let meilleur = 1;
  for (let i = 1; i < mots.length; i++) {
    const ecart = (k: number) => Math.abs(mots.slice(0, k).join(' ').length - mots.slice(k).join(' ').length);
    if (ecart(i) < ecart(meilleur)) meilleur = i;
  }
  return [mots.slice(0, meilleur).join(' '), mots.slice(meilleur).join(' ')];
}

function etiquetteToi(ctx: CanvasRenderingContext2D, x: number, bas: number): void {
  ctx.font = `bold 26px ${POLICE}`;
  const l = ctx.measureText('toi').width + 16;
  ctx.fillStyle = COULEUR_TOI;
  ctx.fillRect(x - l / 2, bas - 34, l, 34);
  ctx.fillStyle = '#222';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('toi', x, bas - 17);
}

/** Texte réduit jusqu'à tenir dans `largeurMax`. */
function texte(
  ctx: CanvasRenderingContext2D,
  contenu: string,
  x: number,
  y: number,
  taille: number,
  largeurMax: number,
  gras = false,
) {
  let t = taille;
  ctx.font = `${gras ? 'bold ' : ''}${t}px ${POLICE}`;
  while (t > 12 && ctx.measureText(contenu).width > largeurMax) {
    t -= 2;
    ctx.font = `${gras ? 'bold ' : ''}${t}px ${POLICE}`;
  }
  ctx.fillText(contenu, x, y);
}

function dessinerBandeaux(ctx: CanvasRenderingContext2D, { manif, image, nomPlace }: DonneesImageFinale): void {
  const L = LARGEUR_IMAGE_FINALE;
  const H = HAUTEUR_IMAGE_FINALE;
  const marge = 48;
  ctx.fillStyle = 'rgba(244, 241, 234, 0.94)';
  ctx.fillRect(0, 0, L, BANDEAU_HAUT_PX);
  ctx.fillRect(0, H - BANDEAU_BAS_PX, L, BANDEAU_BAS_PX);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(0, BANDEAU_HAUT_PX - 6, L, 6);
  ctx.fillRect(0, H - BANDEAU_BAS_PX, L, 6);

  ctx.fillStyle = '#222';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  texte(ctx, nomPlace ?? 'Arrivée du cortège', marge, 86, 64, L - 2 * marge, true);
  ctx.fillStyle = '#444';
  texte(ctx, manif.intitule, marge, 134, 34, L - 2 * marge);
  const jour = new Date(manif.depart).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  texte(ctx, `${manif.ville} · ${jour}`, marge, 174, 28, L - 2 * marge);

  const n = image.compteur;
  ctx.fillStyle = '#222';
  texte(
    ctx,
    `${n.toLocaleString('fr-FR')} ${n > 1 ? 'soutiens' : 'soutien'}`,
    marge,
    H - BANDEAU_BAS_PX + 96,
    76,
    L - 2 * marge,
    true,
  );
  ctx.fillStyle = '#444';
  texte(ctx, 'rassemblés au point d’arrivée · Petit Cortège', marge, H - BANDEAU_BAS_PX + 140, 30, L - 2 * marge);
  ctx.fillStyle = '#666';
  ctx.textAlign = 'right';
  texte(ctx, ATTRIBUTION_OSM, L - 24, H - 22, 22, L - 2 * marge);
}
