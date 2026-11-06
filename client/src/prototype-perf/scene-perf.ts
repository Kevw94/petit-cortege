/**
 * Scène du prototype de performance (ticket #4) : n avatars placeholders
 * (personnages Kenney composés), positions issues du Cortège à chaque image,
 * rendus avec l'une des trois techniques Phaser 4 comparées :
 *
 * - `sprites`  : un `Image` par avatar, profondeur = y (tri de la liste d'affichage) ;
 * - `blitter`  : un `Blitter` et un `Bob` par avatar (pas de profondeur par Bob) ;
 * - `gpulayer` : un `SpriteGPULayer` (tampon GPU d'instances, un seul appel de dessin),
 *                positions écrites directement dans le tampon puis réenvoyées.
 *
 * Les apparences sont précomposées une fois (corps + bas + haut + cheveux) dans
 * une texture 128 × 128 : un seul quad par avatar, comme le ferait le vrai rendu.
 */
import * as Phaser from 'phaser';
import feuillePersonnages from '../../../assets/kenney/chars/Spritesheet/roguelikeChar_transparent.png?url';
import { calculerCortege } from '../cortege/cortege';
import type { ParametresPerf } from './parametres';
import { creerPlacement, PX_PAR_M, type Placer } from './placement';
import type { ScenarioPerf } from './scenario';

/** Largeur de rue sur laquelle s'étale le cortège : 20 m = 10 tuiles. */
const LARGEUR_RUE_M = 20;
const NB_APPARENCES = 64;
const TAILLE = 16;
const COLONNES_FEUILLE = 54;

export interface MesuresScene {
  /** Durée cumulée Cortège + placement + mise à jour des objets, en ms. */
  msMiseAJour: number;
  images: number;
  /** Avatars effectivement dessinés à la dernière image (après élimination hors écran). */
  dessines: number;
}

export interface DonneesScenePerf {
  parametres: ParametresPerf;
  scenario: ScenarioPerf;
  mesures: MesuresScene;
  /** Appelé quand la scène est prête à être mesurée. */
  pret: () => void;
}

export class ScenePerf extends Phaser.Scene {
  #donnees!: DonneesScenePerf;
  #placer!: Placer;
  #debut = 0;
  #derniereMaj = -Infinity;
  /** Transformation monde (px, 16 px = 2 m) → écran : écran = monde × echelle + (dx, dy). */
  #echelle = 1;
  #dx = 0;
  #dy = 0;
  #images: Phaser.GameObjects.Image[] = [];
  #bobs: Phaser.GameObjects.Bob[] = [];
  #couche: Phaser.GameObjects.SpriteGPULayer | null = null;

  constructor() {
    super('perf');
  }

  init(donnees: DonneesScenePerf): void {
    this.#donnees = donnees;
  }

  preload(): void {
    this.load.spritesheet('kenney-perso', feuillePersonnages, { frameWidth: TAILLE, frameHeight: TAILLE, spacing: 1 });
  }

  create(): void {
    this.#composerApparences();
    const { parametres, scenario } = this.#donnees;
    this.#placer = creerPlacement(scenario.manif.parcours, { largeurRueM: LARGEUR_RUE_M });
    this.#cadrer();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.#cadrer());

    const { n, technique } = parametres;
    if (technique === 'sprites') {
      for (let i = 0; i < n; i++) this.#images.push(this.add.image(0, 0, 'avatars', i % NB_APPARENCES));
    } else if (technique === 'blitter') {
      const blitter = this.add.blitter(0, 0, 'avatars');
      for (let i = 0; i < n; i++) this.#bobs.push(blitter.create(0, 0, i % NB_APPARENCES));
    } else {
      const couche = this.add.spriteGPULayer(this.textures.get('avatars'), n);
      const membre = { x: 0, y: 0, frame: '0' };
      for (let i = 0; i < n; i++) {
        membre.frame = String(i % NB_APPARENCES);
        couche.addMember(membre);
      }
      this.#couche = couche;
    }
    this.#debut = performance.now();
    this.#donnees.pret();
  }

  override update(): void {
    const t0 = performance.now();
    const { scenario, mesures, parametres } = this.#donnees;
    mesures.images++;
    if (t0 - this.#derniereMaj < parametres.majMs) return;
    this.#derniereMaj = t0;
    const maintenant = new Date(scenario.maintenant.getTime() + (t0 - this.#debut));
    const { avatars } = calculerCortege({ manif: scenario.manif, entrees: scenario.entrees, maintenant });
    const { width, height } = this.scale.gameSize;
    const s = this.#echelle;
    const ox = this.#dx - TAILLE / 2;
    const oy = this.#dy - TAILLE; // ancrage aux pieds
    let dessines = 0;

    if (this.#couche) {
      const couche = this.#couche;
      const f32 = couche.submitterNode.instanceBufferLayout.buffer.viewF32!;
      const pas = couche.nextMemberF32.length;
      for (let i = 0; i < avatars.length; i++) {
        const a = avatars[i]!;
        const p = this.#placer(a.distanceM, a.id);
        // x et y sont les premières valeurs animables du membre : [base, amplitude, ease, durée].
        const x = p.x * s + this.#dx;
        const y = p.y * s + this.#dy - TAILLE / 2;
        f32[i * pas] = x;
        f32[i * pas + 4] = y;
        // Pas d'élimination côté CPU : le GPU écarte lui-même les quads hors écran.
        if (x > -TAILLE && y > -TAILLE && x < width + TAILLE && y < height + TAILLE) dessines++;
      }
      couche.setAllSegmentsNeedUpdate();
    } else {
      const objets = this.#images.length ? this.#images : this.#bobs;
      for (let i = 0; i < objets.length; i++) {
        const objet = objets[i]!;
        const a = avatars[i];
        if (!a) {
          objet.visible = false;
          continue;
        }
        const p = this.#placer(a.distanceM, a.id);
        const x = p.x * s + ox;
        const y = p.y * s + oy;
        const visible = x > -TAILLE && y > -TAILLE && x < width && y < height;
        objet.visible = visible;
        if (!visible) continue;
        dessines++;
        if (objet instanceof Phaser.GameObjects.Image) {
          objet.setPosition(x + TAILLE / 2, y + TAILLE / 2);
          objet.setDepth(y);
        } else {
          objet.x = x;
          objet.y = y;
        }
      }
    }

    mesures.msMiseAJour += performance.now() - t0;
    mesures.dessines = dessines;
  }

  /** Précompose NB_APPARENCES personnages (corps + bas + haut + cheveux) en 8 × 8 cases de 16 px. */
  #composerApparences(): void {
    const source = this.textures.get('kenney-perso').getSourceImage() as HTMLImageElement;
    const texture = this.textures.createCanvas('avatars', 8 * TAILLE, 8 * TAILLE)!;
    const ctx = texture.getContext();
    let graine = 7;
    const hasard = (k: number) => ((graine = (graine * 1_103_515_245 + 12_345) >>> 0) >>> 8) % k;
    const case17 = (col: number, ligne: number) => [col * (TAILLE + 1), ligne * (TAILLE + 1)] as const;
    for (let i = 0; i < NB_APPARENCES; i++) {
      const [x, y] = [(i % 8) * TAILLE, Math.floor(i / 8) * TAILLE];
      const couches: Array<[number, number]> = [
        [0, hasard(3)], // corps : 3 teints humains
        [3, [0, 1, 2, 5, 6, 7][hasard(6)]!], // bas
        [6 + hasard(12), [0, 2, 5, 7][hasard(4)]!], // haut
        [19 + hasard(8), [0, 1, 4, 5, 8, 9][hasard(6)]!], // cheveux
      ];
      for (const [col, ligne] of couches) {
        if (col >= COLONNES_FEUILLE) continue;
        const [sx, sy] = case17(col, ligne);
        ctx.drawImage(source, sx, sy, TAILLE, TAILLE, x, y, TAILLE, TAILLE);
      }
      texture.add(i, 0, x, y, TAILLE, TAILLE);
    }
    texture.refresh();
  }

  /** Vue `tout` : tout le tracé à l'écran, avatars en taille réelle. Vue `rue` : 16 px = 2 m, milieu du cortège. */
  #cadrer(): void {
    const { width, height } = this.scale.gameSize;
    const { parametres, scenario } = this.#donnees;
    if (parametres.vue === 'rue') {
      const centre = this.#placer(2000, 'centre');
      this.#echelle = 1;
      this.#dx = width / 2 - centre.x;
      this.#dy = height / 2 - centre.y;
      return;
    }
    const pas = 50;
    const points = Array.from({ length: Math.ceil(scenario.manif.longueurM / pas) + 1 }, (_, i) =>
      this.#placer(i * pas, 'cadrage'),
    );
    const marge = 32 + (LARGEUR_RUE_M * PX_PAR_M) / 2;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((width - 64) / Math.max(maxX - minX + marge, 1), (height - 64) / Math.max(maxY - minY + marge, 1));
    this.#echelle = s;
    this.#dx = (width - (maxX - minX) * s) / 2 - minX * s;
    this.#dy = (height - (maxY - minY) * s) / 2 - minY * s;
  }
}
