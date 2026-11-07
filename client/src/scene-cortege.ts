/**
 * Rendu Phaser du cortège : se contente d'afficher les sorties du Cortège.
 * Parcours en simple ligne sur fond vide ; chaque avatar est un sprite Kenney selon
 * son indice d'apparence (précomposé dans une texture), portant sa pancarte.
 * Zoom et déplacement au doigt (pincer, glisser) ou à la souris.
 */
import * as Phaser from 'phaser';
import {
  positionDansLeCortege,
  type EntreePubliee,
  type FichierEntrees,
  type ManifPubliee,
  type Position,
} from '@petit-cortege/shared';
import { avatarsADessiner, BUDGET_AVATARS_DESSINES } from './apparence/affichage';
import { CELLULE_APPARENCE, HAUTEUR_TETE_PX } from './apparence/dessin';
import { chargerCouchesApparence, CLE_APPARENCES, TextureApparences } from './apparence/texture';
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
  /** Identifiants des avatars retirés (fichier des retraits, cache court). */
  retraits: () => readonly string[];
  /** Appelé à chaque image avec le cortège calculé (pour l'interface HTML). */
  surCortege: (cortege: Cortege) => void;
}

const MARGE_PX = 32;
const COULEUR_PARCOURS = 0x8a8a8a;
const COULEUR_TOI = 0xf1c40f;
/** Un sprite Kenney de 16 px de haut représente 2 m (une tuile). */
const METRES_PAR_PX_ATLAS = 2 / 16;
/** De loin, un avatar garde au moins cette échelle (≈ 6 px de haut) pour rester visible. */
const ECHELLE_SPRITE_MIN = 0.375;

/**
 * Ordre d'affichage : sprites de la foule (profondeur 1 à 2 selon y, les plus bas devant),
 * pancartes et slogans de la foule, halo « toi », son avatar, sa pancarte, son slogan, étiquette.
 */
const PROFONDEUR = {
  foule: 1,
  pancartes: 2,
  slogans: 3,
  halo: 4,
  avatarToi: 5,
  pancarteToi: 6,
  sloganToi: 7,
  etiquette: 8,
} as const;

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
  #pancartesPropres!: Phaser.GameObjects.Graphics;
  #apparences!: TextureApparences;
  /** Réservoir de sprites d'avatars, réutilisés d'une image à l'autre. */
  readonly #sprites: Phaser.GameObjects.Image[] = [];
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

  preload(): void {
    chargerCouchesApparence(this);
  }

  create(): void {
    this.#parcours = this.add.graphics();
    this.#apparences = new TextureApparences(this);
    this.#foule = this.add.graphics().setDepth(PROFONDEUR.pancartes);
    this.#avatarsPropres = this.add.graphics().setDepth(PROFONDEUR.halo);
    this.#pancartesPropres = this.add.graphics().setDepth(PROFONDEUR.pancarteToi);
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
      retraits: this.#donnees.retraits(),
      maintenant: new Date(),
    });
    const ecran = this.#ecran();
    const vers = versEcran(this.#cadrage!, ecran);
    if (this.#parcoursADessiner) this.#dessinerParcours(vers);

    // Avatars en sprites, pieds sur leur position dans le cortège.
    const echelleSprite = Math.max(this.#cadrage!.echelle * METRES_PAR_PX_ATLAS, ECHELLE_SPRITE_MIN);
    const places = cortege.avatars.map((avatar) => {
      const position = positionDansLeCortege(this.#donnees.manif.parcours, avatar.distanceM, avatar.decalageM);
      const { x, y } = vers(this.#projeter(position));
      return { x, y, apparence: avatar.apparence, pancarte: avatar.pancarte, propre: avatar.propre };
    });
    const dessines = avatarsADessiner(places, {
      ...ecran,
      largeurSprite: CELLULE_APPARENCE.largeur * echelleSprite,
      hauteurSprite: CELLULE_APPARENCE.hauteur * echelleSprite,
      budget: BUDGET_AVATARS_DESSINES,
    });
    this.#placerSprites(dessines, echelleSprite);

    // Pancartes tenues au-dessus de la tête.
    const hauteurTete = HAUTEUR_TETE_PX * echelleSprite;
    const porteurs: PorteurDePancarte[] = dessines.map((a) => ({ ...a, y: a.y - hauteurTete }));
    this.#foule.clear();
    const pancartes = pancartesAffichees(porteurs, { echelle: this.#cadrage!.echelle, ...ecran });
    for (const p of pancartes) if (!p.propre) dessinerPancarte(this.#foule, p);

    // Mise en valeur « toi », visible uniquement sur l'écran du soutien : halo sous son avatar,
    // dessiné par-dessus la foule, avec sa pancarte toujours lisible.
    this.#avatarsPropres.clear();
    this.#pancartesPropres.clear();
    const propres = porteurs.filter((p) => p.propre);
    const rayon = Math.max(CELLULE_APPARENCE.hauteur * echelleSprite * 0.55, 6);
    for (const p of propres) {
      const centre = p.y + hauteurTete / 2;
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 0.35).fillCircle(p.x, centre, rayon + 6);
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 0.8).fillCircle(p.x, centre, rayon);
      this.#avatarsPropres.lineStyle(2, 0x222222, 1).strokeCircle(p.x, centre, rayon);
    }
    for (const p of pancartes) if (p.propre) dessinerPancarte(this.#pancartesPropres, p);
    this.#slogans.afficher(pancartes, (p) => (p.propre ? PROFONDEUR.sloganToi : PROFONDEUR.slogans));

    const toi = pancartes.find((p) => p.propre) ?? propres[0];
    if (toi) this.#toi.setPosition(toi.x, ('hauteur' in toi ? toi.y - toi.hauteur / 2 : toi.y) - 4);
    this.#toi.setVisible(toi !== undefined);
    this.#donnees.surCortege(cortege);
  }

  /** Un sprite par avatar dessiné (réservoir réutilisé), profondeur selon y : les plus bas devant. */
  #placerSprites(avatars: readonly { x: number; y: number; apparence: number; propre: boolean }[], echelle: number): void {
    const hauteurEcran = Math.max(this.scale.gameSize.height, 1);
    avatars.forEach((avatar, i) => {
      let sprite = this.#sprites[i];
      if (!sprite) {
        sprite = this.add.image(0, 0, CLE_APPARENCES, this.#apparences.cadre(avatar.apparence)).setOrigin(0.5, 1);
        this.#sprites.push(sprite);
      }
      sprite.setFrame(this.#apparences.cadre(avatar.apparence), false, false);
      sprite.setPosition(avatar.x, avatar.y).setScale(echelle).setVisible(true);
      sprite.setDepth(
        avatar.propre ? PROFONDEUR.avatarToi : PROFONDEUR.foule + Math.min(Math.max(avatar.y / hauteurEcran, 0), 1) * 0.99,
      );
    });
    for (let i = avatars.length; i < this.#sprites.length; i++) this.#sprites[i]!.setVisible(false);
    this.#apparences.actualiser();
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
