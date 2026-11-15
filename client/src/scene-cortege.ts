/**
 * Rendu Phaser du cortège : se contente d'afficher les sorties du Cortège.
 * Décor OSM (tilemap chargée par blocs) et tracé du parcours au sol ; chaque
 * avatar est un sprite Kenney selon son indice d'apparence (précomposé dans une
 * texture), portant sa pancarte. Zoom et déplacement au doigt (pincer, glisser)
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
import { aLEcran, BUDGET_AVATARS_DESSINES } from './apparence/affichage';
import { CELLULE_APPARENCE, HAUTEUR_TETE_PX } from './apparence/dessin';
import { chargerCouchesApparence, CLE_APPARENCES, TextureApparences } from './apparence/texture';
import { cadrerSur, deplacer, versEcran, zoomerAutour, type Cadrage, type PointM, type PointPx } from './cadrage';
import { cadrerEnTroisiemePersonne, cibleDeSuivi, ECHELLE_SUIVI_PX_PAR_M, LISSAGE_SUIVI, suivre } from './camera';
import { calculerCortege, type Cortege } from './cortege/cortege';
import { composerFoule } from './cortege/foule';
import {
  allureDeMarche,
  allureImmobile,
  marquerTronconsEnMarche,
  phaseDeMarche,
  phaseDeTampon,
  requeteMouvementReduit,
  sautDeMasse,
  tronconEnMarche,
} from './cortege/marche';
import { MasseDeFoule } from './foule/masse';
import { COULEUR_FOND_CSS, echelleMinDansLePlan, rectangleNetDuPlan, type RectangleM } from './decor/alentours';
import { DecorAffiche, prechargerDecor } from './decor/rendu';
import { TraceAuSol } from './decor/trace';
import { pancartesAffichees } from './pancartes/affichage';
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
  /** Appelé quand la caméra passe du suivi (troisième personne) à la vue libre, ou l'inverse. */
  surModeCamera?: (suivi: boolean) => void;
}

const MARGE_PX = 32;
const COULEUR_TOI = 0xf1c40f;
/** Un sprite Kenney de 16 px de haut représente 2 m (une tuile). */
const METRES_PAR_PX_ATLAS = 2 / 16;
/** De loin, un avatar garde au moins cette échelle (≈ 6 px de haut) pour rester visible. */
const ECHELLE_SPRITE_MIN = 0.375;

/**
 * Ordre d'affichage : masse de foule (0,5 à 0,99 selon y), sprites de la foule (profondeur 1 à 2 selon y, les plus bas devant),
 * pancartes et slogans de la foule, halo « toi », son avatar, sa pancarte, son slogan, étiquette.
 */
const PROFONDEUR = {
  masse: 0.5,
  foule: 1,
  pancartes: 2,
  slogans: 3,
  halo: 4,
  avatarToi: 5,
  pancarteToi: 6,
  sloganToi: 7,
  etiquette: 8,
} as const;

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
  /** Partie nette du plan de la ville (hors fondu) : le dézoom maximal n'en sort pas. */
  #planNet: RectangleM | null = null;
  #trace!: TraceAuSol;
  #foule!: Phaser.GameObjects.Graphics;
  #avatarsPropres!: Phaser.GameObjects.Graphics;
  #pancartesPropres!: Phaser.GameObjects.Graphics;
  #apparences!: TextureApparences;
  #masse!: MasseDeFoule;
  /** Réservoir de sprites d'avatars, réutilisés d'une image à l'autre. */
  readonly #sprites: Phaser.GameObjects.Image[] = [];
  #slogans!: SlogansAffiches;
  #toi!: Phaser.GameObjects.Text;
  #projeter: (p: Position) => PointM = () => ({ x: 0, y: 0 });
  #cadrage: Cadrage | null = null;
  /** Vue d'ensemble du parcours : borne le dézoom et sert au bouton « Vue d'ensemble ». */
  #ensemble: Cadrage | null = null;
  /**
   * Caméra à la troisième personne : la vue suit son avatar (ou la tête du cortège).
   * Glisser la vue la détache ; « Suivre » la rattache.
   */
  #suivi = true;
  /** Première image suivie : la vue saute sur la cible au lieu d'y glisser. */
  #suiviImmediat = true;
  #parcoursADessiner = true;
  #pincement: { ecart: number; milieu: PointPx } | null = null;
  /** Animation de marche (`cortege/marche.ts`) : allure réutilisée d'un avatar à l'autre. */
  readonly #allure = allureImmobile();
  readonly #tronconsEnMarche = new Set<number>();
  readonly #mouvementReduit = requeteMouvementReduit();

  constructor() {
    super('cortege');
  }

  init(donnees: DonneesScene): void {
    this.#donnees = donnees;
  }

  preload(): void {
    prechargerDecor(this);
    chargerCouchesApparence(this);
  }

  create(): void {
    this.#apparences = new TextureApparences(this);
    this.#masse = new MasseDeFoule(this);
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
    const { decor, manif } = this.#donnees;
    this.#projeter = projeteur(decor?.georef ?? { origine: manif.parcours.coordinates[0]! });
    if (decor) {
      this.#decor = new DecorAffiche(this, decor);
      this.#planNet = rectangleNetDuPlan(decor.alentours);
      // Au-delà du décor, la teinte des pâtés de maisons (celle où se fondent les alentours), pas le papier.
      this.cameras.main.setBackgroundColor(COULEUR_FOND_CSS);
    }
    this.#trace = new TraceAuSol(this, manif.parcours.coordinates.map(this.#projeter));
    this.#ensemble = this.#cadrageDEnsemble();
    this.#cadrage = cadrerEnTroisiemePersonne(this.#ensemble, this.#projeter(this.#donnees.manif.parcours.coordinates[0]!));
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.#ensemble = this.#cadrageDEnsemble();
      this.#cadrage = { ...this.#cadrage!, echelleMin: this.#ensemble.echelleMin };
      this.#parcoursADessiner = true;
    });
    this.#brancherGestes();
    this.#donnees.surModeCamera?.(this.#suivi);
  }

  /** Rattache la caméra à son avatar (ou à la tête du cortège), de près. */
  suivreLeCortege(): void {
    this.#suivi = true;
    this.#cadrage = { ...this.#cadrage!, echelle: Math.max(this.#cadrage!.echelle, ECHELLE_SUIVI_PX_PAR_M) };
    this.#parcoursADessiner = true;
    this.#donnees.surModeCamera?.(true);
  }

  /** Tout le parcours à l'écran ; la caméra ne suit plus. */
  vueDEnsemble(): void {
    this.#ensemble = this.#cadrageDEnsemble();
    this.#cadrage = { ...this.#ensemble };
    this.#detacher();
    this.#parcoursADessiner = true;
  }

  /** Zoom d'un facteur autour du centre de l'écran (boutons + et −). */
  zoomer(facteur: number): void {
    const ecran = this.#ecran();
    this.#zoomer(facteur, { x: ecran.largeur / 2, y: ecran.hauteur / 2 });
  }

  #detacher(): void {
    if (!this.#suivi) return;
    this.#suivi = false;
    this.#donnees.surModeCamera?.(false);
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
    if (this.#suivi) {
      const cible = cibleDeSuivi(cortege.avatars);
      const cibleM = this.#projeter(positionDansLeCortege(this.#donnees.manif.parcours, cible.distanceM, cible.decalageM));
      const avant = this.#cadrage!.centre;
      this.#cadrage = suivre(this.#cadrage!, cibleM, this.#suiviImmediat ? 1 : LISSAGE_SUIVI);
      this.#suiviImmediat = false;
      const bouge = Math.hypot(this.#cadrage.centre.x - avant.x, this.#cadrage.centre.y - avant.y) * this.#cadrage.echelle;
      if (bouge >= 0.25) this.#parcoursADessiner = true;
    }
    const ecran = this.#ecran();
    const vers = versEcran(this.#cadrage!, ecran);
    this.#decor?.afficher(this.#cadrage!, ecran, vers, (y) => this.#profondeurSelonY(y));
    if (this.#parcoursADessiner) {
      this.#parcoursADessiner = false;
      this.#trace.dessiner(this.#cadrage!.echelle, vers);
    }

    // Avatars en sprites, pieds sur leur position dans le cortège.
    const echelleSprite = Math.max(this.#cadrage!.echelle * METRES_PAR_PX_ATLAS, ECHELLE_SPRITE_MIN);
    const placer = (distanceM: number, decalageM: number) =>
      vers(this.#projeter(positionDansLeCortege(this.#donnees.manif.parcours, distanceM, decalageM)));
    const places = cortege.avatars.map((avatar) => ({ ...avatar, ...placer(avatar.distanceM, avatar.decalageM) }));
    const tailleSprite = {
      largeurSprite: CELLULE_APPARENCE.largeur * echelleSprite,
      hauteurSprite: CELLULE_APPARENCE.hauteur * echelleSprite,
    };
    // Masse de foule au-delà du seuil de densité ou du budget ; avatars tirés par-dessus.
    const foule = composerFoule(places, {
      repereM: cortege.avanceeM,
      budget: BUDGET_AVATARS_DESSINES,
      visible: (avatar) => aLEcran(avatar, { ...ecran, ...tailleSprite }),
    });
    const dessines = foule.dessines;
    // Marche : temps de la scène (secondes) ; rien ne bouge si le mouvement réduit est demandé.
    const tempsS = this.time.now / 1000;
    const animer = !this.#mouvementReduit.matches;
    if (animer) marquerTronconsEnMarche(cortege.avatars, cortege.avanceeM, this.#tronconsEnMarche);
    else this.#tronconsEnMarche.clear();
    this.#masse.afficherLeLong(foule.troncons, {
      repereM: cortege.avanceeM,
      placer,
      echelle: this.#cadrage!.echelle,
      echelleSprite,
      ...ecran,
      profondeurMin: PROFONDEUR.masse,
      profondeurMax: PROFONDEUR.foule - 0.01,
      sautPxAtlas: (t) =>
        sautDeMasse(
          tempsS,
          phaseDeTampon(t.distanceM - cortege.avanceeM, t.decalageM),
          this.#tronconsEnMarche.size > 0 && tronconEnMarche(this.#tronconsEnMarche, t.distanceM, cortege.avanceeM),
        ),
    });

    // Pancartes tenues au-dessus de la tête ; porteur et pancarte suivent le pas (sautillement
    // et balancement calés sur les pixels de l'atlas agrandi).
    const hauteurTete = HAUTEUR_TETE_PX * echelleSprite;
    const allure = this.#allure;
    const porteurs = dessines.map((a) => {
      allureDeMarche(allure, tempsS, phaseDeMarche(a.id), animer && a.enMarche);
      const saut = allure.sautPxAtlas * echelleSprite;
      return {
        ...a,
        xCorps: a.x + allure.decalagePxAtlas * echelleSprite,
        yCorps: a.y - saut,
        yPieds: a.y,
        x: a.x + allure.decalagePancartePxAtlas * echelleSprite,
        y: a.y - saut - hauteurTete,
      };
    });
    this.#placerSprites(porteurs, echelleSprite);
    this.#foule.clear();
    const pancartes = pancartesAffichees(porteurs, { echelle: this.#cadrage!.echelle, ...ecran });
    for (const p of pancartes) if (!p.propre) dessinerPancarte(this.#foule, p);

    // Mise en valeur « toi », visible uniquement sur l'écran du soutien : halo sous son avatar,
    // dessiné par-dessus la foule, avec sa pancarte toujours lisible.
    this.#avatarsPropres.clear();
    this.#pancartesPropres.clear();
    // Le halo reste fixe : placé d'après la position du Cortège, sans le pas.
    const propres = dessines.filter((p) => p.propre);
    const rayon = Math.max(CELLULE_APPARENCE.hauteur * echelleSprite * 0.55, 6);
    for (const p of propres) {
      const centre = p.y - hauteurTete / 2;
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 0.35).fillCircle(p.x, centre, rayon + 6);
      this.#avatarsPropres.fillStyle(COULEUR_TOI, 0.8).fillCircle(p.x, centre, rayon);
      this.#avatarsPropres.lineStyle(2, 0x222222, 1).strokeCircle(p.x, centre, rayon);
    }
    for (const p of pancartes) if (p.propre) dessinerPancarte(this.#pancartesPropres, p);
    this.#slogans.afficher(pancartes, (p) => (p.propre ? PROFONDEUR.sloganToi : PROFONDEUR.slogans));

    const toi = pancartes.find((p) => p.propre) ?? propres[0];
    if (toi) this.#toi.setPosition(toi.x, ('hauteur' in toi ? toi.y - toi.hauteur / 2 : toi.y - hauteurTete) - 4);
    this.#toi.setVisible(toi !== undefined);
    this.#donnees.surCortege(cortege);
  }

  /**
   * Un sprite par avatar dessiné (réservoir réutilisé), profondeur selon les pieds (`yPieds`, position
   * du Cortège sans le pas : l'ordre ne clignote pas) ; le sprite est posé à `xCorps`, `yCorps` (avec le pas).
   */
  #placerSprites(
    avatars: readonly { xCorps: number; yCorps: number; yPieds: number; apparence: number; propre: boolean }[],
    echelle: number,
  ): void {
    avatars.forEach((avatar, i) => {
      let sprite = this.#sprites[i];
      if (!sprite) {
        sprite = this.add.image(0, 0, CLE_APPARENCES, this.#apparences.cadre(avatar.apparence)).setOrigin(0.5, 1);
        this.#sprites.push(sprite);
      }
      sprite.setFrame(this.#apparences.cadre(avatar.apparence), false, false);
      sprite.setPosition(avatar.xCorps, avatar.yCorps).setScale(echelle).setVisible(true);
      sprite.setDepth(
        avatar.propre ? PROFONDEUR.avatarToi : this.#profondeurSelonY(avatar.yPieds),
      );
    });
    for (let i = avatars.length; i < this.#sprites.length; i++) this.#sprites[i]!.setVisible(false);
    this.#apparences.actualiser();
  }

  /** Profondeur = y à l'écran (1 à 2, les plus bas devant) : avatars de la foule et rangées de bâtiments. */
  #profondeurSelonY(y: number): number {
    return PROFONDEUR.foule + Math.min(Math.max(y / Math.max(this.scale.gameSize.height, 1), 0), 1) * 0.99;
  }

  #ecran() {
    const { width, height } = this.scale.gameSize;
    return { largeur: width, hauteur: height };
  }

  /** Vue d'ensemble : tout le parcours à l'écran (mobile compris). */
  #cadrageDEnsemble(): Cadrage {
    const points = this.#donnees.manif.parcours.coordinates.map(this.#projeter);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const emprise = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const ensemble = cadrerSur(emprise, this.#ecran(), MARGE_PX);
    if (!this.#planNet) return ensemble;
    // Dézoom maximal borné au plan de la ville : centré sur le parcours, l'écran reste dans le plan.
    const dansLePlan = echelleMinDansLePlan(this.#planNet, ensemble.centre, this.#ecran(), ensemble.echelle);
    return { ...ensemble, echelleMin: Math.max(ensemble.echelleMin, dansLePlan) };
  }

  #changerCadrage(cadrage: Cadrage): void {
    this.#cadrage = cadrage;
    this.#parcoursADessiner = true;
  }

  /** Zoom : en suivi, autour du centre de l'écran (la cible reste au centre) ; sinon autour du doigt. */
  #zoomer(facteur: number, point: PointPx): void {
    const ecran = this.#ecran();
    const autour = this.#suivi ? { x: ecran.largeur / 2, y: ecran.hauteur / 2 } : point;
    this.#changerCadrage(zoomerAutour(this.#cadrage!, facteur, autour, ecran));
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
    if (!this.#suivi) this.#cadrage = deplacer(this.#cadrage!, { x: milieu.x - avant.milieu.x, y: milieu.y - avant.milieu.y });
    this.#zoomer(ecart / avant.ecart, milieu);
  }

  /** Glisser pour déplacer (détache la caméra), pincer (deux doigts) ou molette pour zoomer. */
  #brancherGestes(): void {
    this.input.addPointer(1);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointeur: Phaser.Input.Pointer) => {
      // À deux doigts : pincement, traité une fois par image (#suivrePincement).
      if (!pointeur.isDown || (this.input.pointer1.isDown && this.input.pointer2.isDown)) return;
      const glissement = { x: pointeur.x - pointeur.prevPosition.x, y: pointeur.y - pointeur.prevPosition.y };
      if (glissement.x === 0 && glissement.y === 0) return;
      this.#detacher();
      this.#changerCadrage(deplacer(this.#cadrage!, glissement));
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (pointeur: Phaser.Input.Pointer, _objets: unknown, _dx: number, dy: number) => {
        this.#zoomer(Math.exp(-dy * 0.0015), pointeur);
      },
    );
  }
}
