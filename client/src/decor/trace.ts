/**
 * Tracé du parcours au sol : ligne, flèches dans le sens de marche, ligne de
 * départ (verte) et d'arrivée (damier), avec leur libellé. Dessiné par script
 * dans des couleurs de la palette Kenney (aucun dessin à la main, ADR 0006).
 */
import * as Phaser from 'phaser';
import { tracerParcours, type PointOriente, type TraceParcours } from '@petit-cortege/shared';
import type { PointM, PointPx } from '../cadrage';

const COULEUR_LIGNE = 0xf4c542;
const COULEUR_FLECHE = 0xffffff;
const COULEUR_DEPART = 0x3d9a4c;
const COULEUR_SOMBRE = 0x2b2b2b;
const ESPACEMENT_FLECHES_M = 50;
/** Largeur de la ligne de départ / d'arrivée, en travers de la rue (m). */
const LARGEUR_BANDE_M = 14;
const PROFONDEUR = { ligne: -50, libelles: -40 } as const;

export class TraceAuSol {
  readonly #graphics: Phaser.GameObjects.Graphics;
  readonly #libelles: { depart: Phaser.GameObjects.Text; arrivee: Phaser.GameObjects.Text };
  readonly #trace: TraceParcours;

  /** `parcours` : points du parcours en mètres. */
  constructor(scene: Phaser.Scene, parcours: PointM[]) {
    this.#trace = tracerParcours(parcours, { espacementFleches: ESPACEMENT_FLECHES_M });
    this.#graphics = scene.add.graphics().setDepth(PROFONDEUR.ligne);
    const libelle = (texte: string) =>
      scene.add
        .text(0, 0, texte, { fontFamily: 'system-ui, sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#ffffff' })
        .setBackgroundColor('#2b2b2b')
        .setPadding(4, 1, 4, 1)
        .setOrigin(0.5, 1)
        .setDepth(PROFONDEUR.libelles);
    this.#libelles = { depart: libelle('Départ'), arrivee: libelle('Arrivée') };
  }

  dessiner(echelle: number, vers: (p: PointM) => PointPx): void {
    const g = this.#graphics.clear();
    const { ligne, fleches, depart, arrivee } = this.#trace;
    const ecran = ligne.map(vers);

    g.lineStyle(Phaser.Math.Clamp(1.2 * echelle, 2.5, 40), COULEUR_LIGNE, 0.9).beginPath();
    ecran.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.strokePath();

    // Flèches : dès qu'elles font quelques pixels.
    const taille = 2.5 * echelle;
    if (taille >= 6) {
      for (const f of fleches) {
        const c = vers(f);
        g.fillStyle(COULEUR_FLECHE, 0.95).fillTriangle(...pointe(c, f.angle, taille));
      }
    }

    if (LARGEUR_BANDE_M * echelle >= 12) {
      bande(g, depart, vers, () => COULEUR_DEPART);
      bande(g, arrivee, vers, (i, j) => ((i + j) % 2 ? COULEUR_SOMBRE : 0xffffff));
    } else {
      const [d, a] = [vers(depart), vers(arrivee)];
      g.fillStyle(COULEUR_DEPART, 1).fillCircle(d.x, d.y, 6);
      g.fillStyle(COULEUR_SOMBRE, 1).fillCircle(a.x, a.y, 6).fillStyle(0xffffff, 1).fillCircle(a.x, a.y, 3);
    }
    for (const [cle, point] of [['depart', depart], ['arrivee', arrivee]] as const) {
      const p = vers(point);
      this.#libelles[cle].setPosition(Math.round(p.x), Math.round(p.y - Math.max(8, 4 * echelle)));
    }
  }
}

/** Triangle (x1, y1, …, y3) pointant dans la direction `angle` (degrés), centré sur `c`. */
function pointe(c: PointPx, angle: number, taille: number): [number, number, number, number, number, number] {
  const a = (angle * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-uy, ux];
  const avant = 0.6 * taille;
  const arriere = 0.4 * taille;
  const demi = 0.45 * taille;
  return [
    c.x + ux * avant,
    c.y + uy * avant,
    c.x - ux * arriere + nx * demi,
    c.y - uy * arriere + ny * demi,
    c.x - ux * arriere - nx * demi,
    c.y - uy * arriere - ny * demi,
  ];
}

/** Bande en travers du parcours (2 rangées de cases de 2 m), couleur par case. */
function bande(
  g: Phaser.GameObjects.Graphics,
  p: PointOriente,
  vers: (p: PointM) => PointPx,
  couleur: (i: number, j: number) => number,
): void {
  const a = (p.angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) }; // sens de marche
  const n = { x: -u.y, y: u.x }; // en travers
  const cases = LARGEUR_BANDE_M / 2;
  const point = (i: number, j: number) =>
    vers({ x: p.x + n.x * (i * 2 - LARGEUR_BANDE_M / 2) + u.x * (j * 2 - 2), y: p.y + n.y * (i * 2 - LARGEUR_BANDE_M / 2) + u.y * (j * 2 - 2) });
  for (let i = 0; i < cases; i++) {
    for (let j = 0; j < 2; j++) {
      const [a, b, c, d] = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      g.fillStyle(couleur(i, j), 1).fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y).fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
    }
  }
}
