/**
 * Rendu Phaser du cortège : se contente d'afficher les sorties du Cortège.
 * Squelette : parcours en simple ligne sur fond vide, un point par avatar.
 */
import * as Phaser from 'phaser';
import { pointSurParcours, type EntreesMinute, type ManifPubliee, type Position } from '@petit-cortege/shared';
import { calculerCortege, type Cortege } from './cortege/cortege';

export interface DonneesScene {
  manif: ManifPubliee;
  /** Fichiers d'entrées chargés à ce jour (mis à jour par le chargement périodique). */
  entrees: () => EntreesMinute[];
  /** Appelé à chaque image avec le cortège calculé (pour l'interface HTML). */
  surCortege: (cortege: Cortege) => void;
}

const MARGE_PX = 32;
const COULEUR_PARCOURS = 0x8a8a8a;
const COULEUR_AVATAR = 0xc0392b;

/** Projection locale équirectangulaire en mètres, suffisante à l'échelle d'une ville. */
function projeteur(origine: Position) {
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180);
  const ky = 110_540;
  return (p: Position) => ({ x: (p[0] - origine[0]) * kx, y: -(p[1] - origine[1]) * ky });
}

export class SceneCortege extends Phaser.Scene {
  #donnees!: DonneesScene;
  #parcours!: Phaser.GameObjects.Graphics;
  #avatars!: Phaser.GameObjects.Graphics;
  #versEcran: (p: Position) => { x: number; y: number } = () => ({ x: 0, y: 0 });

  constructor() {
    super('cortege');
  }

  init(donnees: DonneesScene): void {
    this.#donnees = donnees;
  }

  create(): void {
    this.#parcours = this.add.graphics();
    this.#avatars = this.add.graphics();
    this.#cadrer();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.#cadrer());
  }

  override update(): void {
    const cortege = calculerCortege({
      manif: this.#donnees.manif,
      entrees: this.#donnees.entrees(),
      maintenant: new Date(),
    });
    this.#avatars.clear();
    this.#avatars.fillStyle(COULEUR_AVATAR, 1);
    for (const avatar of cortege.avatars) {
      const { x, y } = this.#versEcran(pointSurParcours(this.#donnees.manif.parcours, avatar.distanceM));
      this.#avatars.fillCircle(x, y, 4);
    }
    this.#donnees.surCortege(cortege);
  }

  /** Ajuste le parcours à la taille de l'écran (mobile compris) et le redessine. */
  #cadrer(): void {
    const points = this.#donnees.manif.parcours.coordinates;
    const projeter = projeteur(points[0]!);
    const projetes = points.map(projeter);
    const xs = projetes.map((p) => p.x);
    const ys = projetes.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { width, height } = this.scale.gameSize;
    const echelle = Math.min(
      (width - 2 * MARGE_PX) / Math.max(maxX - minX, 1),
      (height - 2 * MARGE_PX) / Math.max(maxY - minY, 1),
    );
    const dx = (width - (maxX - minX) * echelle) / 2 - minX * echelle;
    const dy = (height - (maxY - minY) * echelle) / 2 - minY * echelle;
    this.#versEcran = (p) => {
      const q = projeter(p);
      return { x: q.x * echelle + dx, y: q.y * echelle + dy };
    };

    const ecran = points.map(this.#versEcran);
    this.#parcours.clear();
    this.#parcours.lineStyle(4, COULEUR_PARCOURS, 1);
    this.#parcours.beginPath();
    ecran.forEach((p, i) => (i === 0 ? this.#parcours.moveTo(p.x, p.y) : this.#parcours.lineTo(p.x, p.y)));
    this.#parcours.strokePath();
    const depart = ecran[0]!;
    const arrivee = ecran[ecran.length - 1]!;
    this.#parcours.fillStyle(0x2e7d32, 1).fillCircle(depart.x, depart.y, 7);
    this.#parcours.fillStyle(0x1f3a93, 1).fillCircle(arrivee.x, arrivee.y, 7);
  }
}
