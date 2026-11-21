/**
 * Dessin d'une pancarte (manche, panneau, slogan) sur un canvas 2D, pour la vue 3D : même
 * forme, mêmes couleurs et mêmes proportions que dans la vue 2D (pancartes/dessin.ts).
 */
import { COULEURS_PANCARTE, decoderPancarte, FORMES_PANCARTE, SLOGANS } from '@petit-cortege/shared';
import { DIMENSIONS_M, MANCHE_M } from './affichage';

/** Cadre d'une pancarte, en mètres : le panneau le plus large et le plus haut, plus le manche. */
export const CADRE_PANCARTE_M = {
  largeur: Math.max(...Object.values(DIMENSIONS_M).map(([l]) => l)),
  hauteur: Math.max(...Object.values(DIMENSIONS_M).map(([, h]) => h)) + MANCHE_M,
} as const;

const COULEUR_MANCHE = '#7a5530';
const COULEUR_CONTOUR = 'rgba(34, 34, 34, 0.7)';
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Dessine la pancarte `indice` dans le cadre (x, y, CADRE_PANCARTE_M × pxParM) : bas du manche
 * au milieu du bas du cadre. Un indice hors catalogue ne dessine rien.
 */
export function dessinerPancarteCanvas(
  ctx: CanvasRenderingContext2D,
  indice: number,
  x: number,
  y: number,
  pxParM: number,
  avecSlogan = true,
): void {
  const composition = decoderPancarte(indice);
  if (!composition) return;
  const forme = FORMES_PANCARTE[composition.forme]!;
  const couleur = COULEURS_PANCARTE[composition.couleur]!;
  const [lM, hM] = DIMENSIONS_M[forme];
  const l = lM * pxParM;
  const h = hM * pxParM;
  const cx = x + (CADRE_PANCARTE_M.largeur * pxParM) / 2;
  const bas = y + CADRE_PANCARTE_M.hauteur * pxParM;
  const cy = bas - MANCHE_M * pxParM - h / 2;

  ctx.save();
  ctx.strokeStyle = COULEUR_MANCHE;
  ctx.lineWidth = Math.max(1, l * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, bas);
  ctx.stroke();

  // Panneau un peu en retrait du bord : le contour ne déborde pas du cadre.
  const marge = Math.max(1, Math.min(l * 0.04, 3));
  ctx.beginPath();
  switch (forme) {
    case 'rond':
      ctx.ellipse(cx, cy, l / 2 - marge, h / 2 - marge, 0, 0, Math.PI * 2);
      break;
    case 'losange':
      ctx.moveTo(cx, cy - h / 2 + marge);
      ctx.lineTo(cx + l / 2 - marge, cy);
      ctx.lineTo(cx, cy + h / 2 - marge);
      ctx.lineTo(cx - l / 2 + marge, cy);
      ctx.closePath();
      break;
    default:
      ctx.rect(cx - l / 2 + marge, cy - h / 2 + marge, l - 2 * marge, h - 2 * marge);
  }
  ctx.fillStyle = hex(couleur.fond);
  ctx.fill();
  ctx.strokeStyle = COULEUR_CONTOUR;
  ctx.lineWidth = marge;
  ctx.stroke();

  if (avecSlogan) {
    const zone = { rectangle: [0.88, 0.8], portrait: [0.86, 0.84], rond: [0.74, 0.68], losange: [0.66, 0.56] }[forme];
    ecrire(ctx, SLOGANS[composition.slogan]!, cx, cy, l * zone[0]!, h * zone[1]!, hex(couleur.texte));
  }
  ctx.restore();
}

/** Écrit le texte centré, sur une à trois lignes, à la plus grande taille qui tient dans la zone. */
function ecrire(
  ctx: CanvasRenderingContext2D,
  texte: string,
  cx: number,
  cy: number,
  largeur: number,
  hauteur: number,
  couleur: string,
): void {
  const mots = texte.split(' ');
  const police = (px: number) => `bold ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let meilleur: { lignes: string[]; taille: number } | null = null;
  for (let n = 1; n <= Math.min(3, mots.length); n++) {
    // Découpe en n lignes de longueurs voisines.
    const lignes: string[] = [];
    const parLigne = Math.ceil(texte.length / n);
    let courante = '';
    for (const mot of mots) {
      if (courante && `${courante} ${mot}`.length > parLigne && lignes.length < n - 1) {
        lignes.push(courante);
        courante = mot;
      } else courante = courante ? `${courante} ${mot}` : mot;
    }
    lignes.push(courante);
    ctx.font = police(100);
    const plusLarge = Math.max(...lignes.map((l) => ctx.measureText(l).width)) / 100;
    const taille = Math.min(largeur / plusLarge, hauteur / (lignes.length * 1.15));
    if (!meilleur || taille > meilleur.taille) meilleur = { lignes, taille };
  }
  if (!meilleur) return;
  ctx.font = police(meilleur.taille);
  ctx.fillStyle = couleur;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pas = meilleur.taille * 1.15;
  meilleur.lignes.forEach((ligne, i) => ctx.fillText(ligne, cx, cy + (i - (meilleur.lignes.length - 1) / 2) * pas));
}
