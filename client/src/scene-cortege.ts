/**
 * Rendu Phaser du cortège : se contente d'afficher les sorties du Cortège.
 * Squelette : parcours en simple ligne sur fond vide, un point par avatar
 * portant sa pancarte. Zoom et déplacement au doigt (pincer, glisser) ou à la souris.
 */
import * as Phaser from 'phaser';
import {
  positionDansLeCortege,
  type EntreePubliee,
  type FichierEntrees,
  type ManifPubliee,
  type Position,
} from '@petit-cortege/shared';
import { cadrerSur, deplacer, versEcran, zoomerAutour, type Cadrage, type PointM, type PointPx } from './cadrage';
import { calculerCortege, type Cortege } from './cortege/cortege';
import { pancartesAffichees, type PorteurDePancarte } from './pancartes/affichage';
import { dessinerPancarte, SlogansAffiches } from './pancartes/dessin';

export interface DonneesScene {
  manif: ManifPubliee;
  /** Fichiers d'entrées chargés à ce jour (mis à jour par le chargement périodique). */
  entrees: () => FichierEntrees[];
  /** Avatars du soutien sur cet appareil (affichés tout de suite, mis en valeur). */
  propres: () => EntreePubliee[];
  /** Appelé à chaque image avec le cortège calculé (pour l'interface HTML). */
  surCortege: (cortege: Cortege) => void;
}

const MARGE_PX = 32;
const COULEUR_PARCOURS = 0x8a8a8a;
const COULEUR_AVATAR = 0xc0392b;
const COULEUR_TOI = 0xf1c40f;

/** Ordre d'affichage : foule, slogans de la foule, sa pancarte, son slogan, étiquette « toi ». */
const PROFONDEUR = { foule: 1, slogans: 2, toi: 3, sloganToi: 4, etiquette: 5 } as const;

/** Projection locale équirectangulaire en mètres (y vers le bas), suffisante à l'échelle d'une ville. */
function projeteur(origine: Position) {
  const kx = 111_320 * Math.cos((origine[1] * Math.PI) / 180);
  const ky = 110_540;
  return (p: Position): PointM => ({ x: (p[0] - origine[0]) * kx, y: -(p[1] - origine[1]) * ky });
}

export class SceneCortege extends Phaser.Scene {
  #donnees!: DonneesScene;
  #parcours!: Phaser.GameObjects.Graphics;
  #foule!: Phaser.GameObjects.Graphics;
  #avatarsPropres!: Phaser.GameObjects.Graphics;
  #slogans!: SlogansAffiches;
  #toi!: Phaser.GameObjects.Text;
  #projeter: (p: Position) => PointM = () => ({ x: 0, y: 0 });
  #cadrage: Cadrage | null = null;
  /** Vrai dès que le soutien a zoomé ou déplacé la vue : on ne recadre plus au redimensionnement. */
  #cadrageManuel = false;
  #parcoursADessiner = true;
  #ecartPincement: number | null = null;

  constructor() {
    super('cortege');
  }

  init(donnees: DonneesScene): void {
    this.#donnees = donnees;
  }

  create(): void {
    this.#parcours = this.add.graphics();
    this.#foule = this.add.graphics().setDepth(PROFONDEUR.foule);
    this.#avatarsPropres = this.add.graphics().setDepth(PROFONDEUR.toi);
    this.#slogans = new SlogansAffiches(this);
    this.#toi = this.add
      .text(0, 0, 'toi', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', fontStyle: 'bold', color: '#222' })
      .setOrigin(0.5, 1)
      .setBackgroundColor('#f1c40f')
      .setPadding(4, 1, 4, 1)
      .setDepth(PROFONDEUR.etiquette)
      .setVisible(false);
    this.#projeter = projeteur(this.#donnees.manif.parcours.coordinates[0]!);
    this.#cadrerSurLeParcours();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (!this.#cadrageManuel) this.#cadrerSurLeParcours();
      this.#parcoursADessiner = true;
    });
    this.#brancherGestes();
  }

  override update(): void {
    const cortege = calculerCortege({
      manif: this.#donnees.manif,
      entrees: this.#donnees.entrees(),
      propres: this.#donnees.propres(),
      maintenant: new Date(),
    });
    const ecran = this.#ecran();
    const vers = versEcran(this.#cadrage!, ecran);
    if (this.#parcoursADessiner) this.#dessinerParcours(vers);

    const porteurs: PorteurDePancarte[] = cortege.avatars.map((avatar) => {
      const position = positionDansLeCortege(this.#donnees.manif.parcours, avatar.distanceM, avatar.decalageM);
      const { x, y } = vers(this.#projeter(position));
      return { x, y, pancarte: avatar.pancarte, propre: avatar.propre };
    });

    // Avatars (points en attendant les sprites, #10), avec leur pancarte.
    const rayon = Math.min(Math.max(0.35 * this.#cadrage!.echelle, 2.5), 14);
    this.#foule.clear().fillStyle(COULEUR_AVATAR, 1);
    for (const p of porteurs) if (!p.propre) this.#foule.fillCircle(p.x, p.y, rayon);
    const pancartes = pancartesAffichees(porteurs, { echelle: this.#cadrage!.echelle, ...ecran });
    for (const p of pancartes) if (!p.propre) dessinerPancarte(this.#foule, p);

    // Mise en valeur « toi », visible uniquement sur l'écran du soutien, dessinée par-dessus la foule,
    // avec sa pancarte toujours lisible.
    this.#avatarsPropres.clear();
    const propres = porteurs.filter((p) => p.propre);
    for (const p of propres) {
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 0.45).fillCircle(p.x, p.y, rayon + 6);
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 1).fillCircle(p.x, p.y, rayon + 1);
      this.#avatarsPropres.lineStyle(2, 0x222222, 1).strokeCircle(p.x, p.y, rayon + 1);
    }
    for (const p of pancartes) if (p.propre) dessinerPancarte(this.#avatarsPropres, p);
    this.#slogans.afficher(pancartes, (p) => (p.propre ? PROFONDEUR.sloganToi : PROFONDEUR.slogans));

    const toi = pancartes.find((p) => p.propre) ?? propres[0];
    if (toi) this.#toi.setPosition(toi.x, ('hauteur' in toi ? toi.y - toi.hauteur / 2 : toi.y) - 4);
    this.#toi.setVisible(toi !== undefined);
    this.#donnees.surCortege(cortege);
  }

  #ecran() {
    const { width, height } = this.scale.gameSize;
    return { largeur: width, hauteur: height };
  }

  /** Vue d'ensemble : tout le parcours à l'écran (mobile compris). */
  #cadrerSurLeParcours(): void {
    const points = this.#donnees.manif.parcours.coordinates.map(this.#projeter);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const emprise = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    this.#cadrage = cadrerSur(emprise, this.#ecran(), MARGE_PX);
    this.#parcoursADessiner = true;
  }

  #changerCadrage(cadrage: Cadrage): void {
    this.#cadrage = cadrage;
    this.#cadrageManuel = true;
    this.#parcoursADessiner = true;
  }

  /** Glisser pour déplacer, pincer (deux doigts) ou molette pour zoomer. */
  #brancherGestes(): void {
    this.input.addPointer(1);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointeur: Phaser.Input.Pointer) => {
      const [a, b] = [this.input.pointer1, this.input.pointer2];
      if (a.isDown && b.isDown) {
        const ecart = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const milieu: PointPx = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.#ecartPincement !== null && ecart > 0) {
          this.#changerCadrage(zoomerAutour(this.#cadrage!, ecart / this.#ecartPincement, milieu, this.#ecran()));
        }
        this.#ecartPincement = ecart;
        return;
      }
      this.#ecartPincement = null;
      if (!pointeur.isDown) return;
      const glissement = { x: pointeur.x - pointeur.prevPosition.x, y: pointeur.y - pointeur.prevPosition.y };
      if (glissement.x !== 0 || glissement.y !== 0) this.#changerCadrage(deplacer(this.#cadrage!, glissement));
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, () => (this.#ecartPincement = null));
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointeur: Phaser.Input.Pointer, _objets: unknown, _dx: number, dy: number) => {
        this.#changerCadrage(zoomerAutour(this.#cadrage!, Math.exp(-dy * 0.0015), pointeur, this.#ecran()));
      },
    );
  }

  #dessinerParcours(vers: (p: PointM) => PointPx): void {
    this.#parcoursADessiner = false;
    const ecran = this.#donnees.manif.parcours.coordinates.map((p) => vers(this.#projeter(p)));
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
