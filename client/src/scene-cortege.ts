/**
 * Rendu Phaser du cortège : se contente d'afficher les sorties du Cortège.
 * Décor OSM (tilemap chargée par blocs) et tracé du parcours au sol, un point
 * par avatar portant sa pancarte. Zoom et déplacement au doigt (pincer, glisser)
 * ou à la souris.
 *
 * Projection : mètres depuis l'origine du décor (tuile de 16 px = 2 m, voir
 * shared/src/decor.ts), la même pour le décor et les avatars ; le cadrage
 * projette ces mètres à l'écran. Profondeur = position y à l'écran.
 */
import * as Phaser from 'phaser';
import {
  METRES_PAR_TUILE,
  positionDansLeCortege,
  versTuiles,
  type Decor,
  type EntreePubliee,
  type Georeference,
  type FichierEntrees,
  type ManifPubliee,
  type Position,
} from '@petit-cortege/shared';
import { cadrerSur, deplacer, versEcran, zoomerAutour, type Cadrage, type PointM, type PointPx } from './cadrage';
import { calculerCortege, type Cortege } from './cortege/cortege';
import { DecorAffiche, prechargerDecor } from './decor/rendu';
import { TraceAuSol } from './decor/trace';
import { pancartesAffichees, type PorteurDePancarte } from './pancartes/affichage';
import { dessinerPancarte, SlogansAffiches } from './pancartes/dessin';

export interface DonneesScene {
  manif: ManifPubliee;
  /** Décor OSM couvrant le parcours (null : pas de décor, fond uni). */
  decor: Decor | null;
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
const COULEUR_AVATAR = 0xc0392b;
const COULEUR_TOI = 0xf1c40f;

/** Ordre d'affichage : foule, slogans de la foule, sa pancarte, son slogan, étiquette « toi ». */
const PROFONDEUR = { foule: 1, slogans: 2, toi: 3, sloganToi: 4, etiquette: 5 } as const;

/** Projection en mètres (y vers le bas) depuis l'origine du décor : celle de la tilemap. */
function projeteur(georef: Georeference) {
  return (p: Position): PointM => {
    const t = versTuiles(georef, p);
    return { x: t.x * METRES_PAR_TUILE, y: t.y * METRES_PAR_TUILE };
  };
}

export class SceneCortege extends Phaser.Scene {
  #donnees!: DonneesScene;
  #decor: DecorAffiche | null = null;
  #trace!: TraceAuSol;
  #foule!: Phaser.GameObjects.Graphics;
  #avatarsPropres!: Phaser.GameObjects.Graphics;
  #slogans!: SlogansAffiches;
  #toi!: Phaser.GameObjects.Text;
  #projeter: (p: Position) => PointM = () => ({ x: 0, y: 0 });
  #cadrage: Cadrage | null = null;
  /** Vrai dès que le soutien a zoomé ou déplacé la vue : on ne recadre plus au redimensionnement. */
  #cadrageManuel = false;
  #parcoursADessiner = true;
  #pincement: { ecart: number; milieu: PointPx } | null = null;

  constructor() {
    super('cortege');
  }

  init(donnees: DonneesScene): void {
    this.#donnees = donnees;
  }

  preload(): void {
    prechargerDecor(this);
  }

  create(): void {
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
    const { decor, manif } = this.#donnees;
    this.#projeter = projeteur(decor?.georef ?? { origine: manif.parcours.coordinates[0]! });
    if (decor) this.#decor = new DecorAffiche(this, decor);
    this.#trace = new TraceAuSol(this, manif.parcours.coordinates.map(this.#projeter));
    this.#cadrerSurLeParcours();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      if (!this.#cadrageManuel) this.#cadrerSurLeParcours();
      this.#parcoursADessiner = true;
    });
    this.#brancherGestes();
  }

  override update(): void {
    this.#suivrePincement();
    const cortege = calculerCortege({
      manif: this.#donnees.manif,
      entrees: this.#donnees.entrees(),
      propres: this.#donnees.propres(),
      retraits: this.#donnees.retraits(),
      maintenant: new Date(),
    });
    const ecran = this.#ecran();
    const vers = versEcran(this.#cadrage!, ecran);
    this.#decor?.afficher(this.#cadrage!, ecran, vers);
    if (this.#parcoursADessiner) {
      this.#parcoursADessiner = false;
      this.#trace.dessiner(this.#cadrage!.echelle, vers);
    }

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

  /**
   * Pincement : écart et milieu des deux doigts lus une fois par image (les deux
   * doigts bougent dans le même événement tactile, mais Phaser les met à jour un par
   * un : traiter chaque événement décentrait le zoom). Le milieu suit aussi le glissement.
   */
  #suivrePincement(): void {
    const [a, b] = [this.input.pointer1, this.input.pointer2];
    if (!a.isDown || !b.isDown) {
      this.#pincement = null;
      return;
    }
    const ecart = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    const milieu: PointPx = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const avant = this.#pincement;
    this.#pincement = { ecart, milieu };
    if (!avant || ecart <= 0 || (ecart === avant.ecart && milieu.x === avant.milieu.x && milieu.y === avant.milieu.y)) return;
    const deplace = deplacer(this.#cadrage!, { x: milieu.x - avant.milieu.x, y: milieu.y - avant.milieu.y });
    this.#changerCadrage(zoomerAutour(deplace, ecart / avant.ecart, milieu, this.#ecran()));
  }

  /** Glisser pour déplacer, pincer (deux doigts) ou molette pour zoomer. */
  #brancherGestes(): void {
    this.input.addPointer(1);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointeur: Phaser.Input.Pointer) => {
      // À deux doigts : pincement, traité une fois par image (#suivrePincement).
      if (!pointeur.isDown || (this.input.pointer1.isDown && this.input.pointer2.isDown)) return;
      const glissement = { x: pointeur.x - pointeur.prevPosition.x, y: pointeur.y - pointeur.prevPosition.y };
      if (glissement.x !== 0 || glissement.y !== 0) this.#changerCadrage(deplacer(this.#cadrage!, glissement));
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointeur: Phaser.Input.Pointer, _objets: unknown, _dx: number, dy: number) => {
        this.#changerCadrage(zoomerAutour(this.#cadrage!, Math.exp(-dy * 0.0015), pointeur, this.#ecran()));
      },
    );
  }
}
