/**
 * Sol de la vue 3D : le décor OSM (tilemap Kenney, #12-#13) posé à plat. Une vue d'ensemble
 * (un pixel par tuile) couvre toute la carte ; près de la caméra, les blocs de 32 × 32 tuiles
 * sont cuits à la demande dans une texture chacun (16 px par tuile, `NearestFilter` : pixel
 * art net), avec un plafond de blocs gardés en mémoire.
 *
 * Le sol ne s'écrit pas dans le tampon de profondeur : il est dessiné d'abord, couche par
 * couche (vue d'ensemble, blocs, tracé), puis bâtiments et avatars par-dessus.
 */
import * as THREE from 'three';
import { COUCHES_BATIMENTS, METRES_PAR_TUILE, TAILLE_BLOC, type BlocDecor, type Decor } from '@petit-cortege/shared';
import { cuireBloc, dessinerVueDEnsemble, type ImagesTilesets } from '../decor/cuisson';

/** Côté d'un bloc, en mètres. */
const COTE_BLOC_M = TAILLE_BLOC * METRES_PAR_TUILE;
/** Blocs gardés en texture (≈ 1,3 Mo de mémoire graphique chacun avec les mipmaps). */
const BLOCS_EN_MEMOIRE_MAX = 40;
/** Blocs cuits par image au plus, pour éviter les à-coups. */
const BLOCS_CUITS_PAR_IMAGE = 2;
/** Au-delà de cette distance à la caméra (m), la vue d'ensemble suffit. */
const DISTANCE_DETAIL_M = 700;

/** Ordre de dessin du sol (avant tout le reste). */
export const ORDRE_SOL = { ensemble: -10, blocs: -9, trace: -8, marques: -7, halo: -6 } as const;

export function materiauDeSol(options: THREE.MeshBasicMaterialParameters, ordre: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ ...options, depthWrite: false, depthTest: false });
  m.userData.ordre = ordre;
  return m;
}

/** Plan horizontal de `largeur` × `profondeur` m, coin nord-ouest en (x, z). */
function planAuSol(x: number, z: number, largeur: number, profondeur: number, materiau: THREE.Material, ordre: number): THREE.Mesh {
  const g = new THREE.PlaneGeometry(largeur, profondeur);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, materiau);
  mesh.position.set(x + largeur / 2, 0, z + profondeur / 2);
  mesh.renderOrder = ordre;
  return mesh;
}

interface BlocAffiche {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  vu: number;
}

export class Sol {
  readonly groupe = new THREE.Group();
  readonly #decor: Decor;
  readonly #images: ImagesTilesets;
  readonly #couches: string[];
  readonly #blocs = new Map<BlocDecor, BlocAffiche>();
  readonly #anisotropie: number;
  readonly #frustum = new THREE.Frustum();
  readonly #boite = new THREE.Box3();
  readonly #matrice = new THREE.Matrix4();
  #image = 0;

  constructor(decor: Decor, images: ImagesTilesets, anisotropie: number) {
    this.#decor = decor;
    this.#images = images;
    this.#anisotropie = anisotropie;
    this.#couches = decor.nomsCouches.filter((c) => !COUCHES_BATIMENTS.includes(c));
    const texture = new THREE.CanvasTexture(dessinerVueDEnsemble(decor, images));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = anisotropie;
    const ensemble = planAuSol(
      0,
      0,
      decor.largeur * METRES_PAR_TUILE,
      decor.hauteur * METRES_PAR_TUILE,
      materiauDeSol({ map: texture, alphaTest: 0.5 }, ORDRE_SOL.ensemble),
      ORDRE_SOL.ensemble,
    );
    this.groupe.add(ensemble);
  }

  /** À chaque image : affiche les blocs proches dans le champ, en cuit quelques-uns de plus. */
  actualiser(camera: THREE.PerspectiveCamera): void {
    this.#image++;
    this.#frustum.setFromProjectionMatrix(this.#matrice.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const position = camera.position;
    const candidats: { bloc: BlocDecor; distance: number }[] = [];
    for (const bloc of this.#decor.blocs.values()) {
      const x0 = bloc.x * METRES_PAR_TUILE;
      const z0 = bloc.y * METRES_PAR_TUILE;
      const distance = Math.hypot(x0 + COTE_BLOC_M / 2 - position.x, position.y, z0 + COTE_BLOC_M / 2 - position.z);
      if (distance > DISTANCE_DETAIL_M + COTE_BLOC_M) continue;
      this.#boite.min.set(x0, 0, z0);
      this.#boite.max.set(x0 + COTE_BLOC_M, 0.1, z0 + COTE_BLOC_M);
      if (!this.#frustum.intersectsBox(this.#boite)) continue;
      candidats.push({ bloc, distance });
    }
    candidats.sort((a, b) => a.distance - b.distance);
    let aCuire = BLOCS_CUITS_PAR_IMAGE;
    for (const { bloc } of candidats.slice(0, BLOCS_EN_MEMOIRE_MAX)) {
      let affiche = this.#blocs.get(bloc);
      if (!affiche) {
        if (aCuire-- <= 0) continue;
        affiche = this.#cuire(bloc);
        this.#blocs.set(bloc, affiche);
      }
      affiche.vu = this.#image;
      affiche.mesh.visible = true;
    }
    for (const affiche of this.#blocs.values()) if (affiche.vu !== this.#image) affiche.mesh.visible = false;
    if (this.#blocs.size > BLOCS_EN_MEMOIRE_MAX) this.#liberer();
  }

  #cuire(bloc: BlocDecor): BlocAffiche {
    const { canvas } = cuireBloc(this.#decor, this.#images, bloc, this.#couches);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = this.#anisotropie;
    const mesh = planAuSol(
      bloc.x * METRES_PAR_TUILE,
      bloc.y * METRES_PAR_TUILE,
      COTE_BLOC_M,
      COTE_BLOC_M,
      materiauDeSol({ map: texture, alphaTest: 0.5 }, ORDRE_SOL.blocs),
      ORDRE_SOL.blocs,
    );
    this.groupe.add(mesh);
    return { mesh, texture, vu: this.#image };
  }

  #liberer(): void {
    const anciens = [...this.#blocs].filter(([, a]) => a.vu !== this.#image).sort(([, a], [, b]) => a.vu - b.vu);
    for (const [bloc, affiche] of anciens.slice(0, this.#blocs.size - BLOCS_EN_MEMOIRE_MAX)) {
      this.#oublier(affiche);
      this.#blocs.delete(bloc);
    }
  }

  #oublier(affiche: BlocAffiche): void {
    this.groupe.remove(affiche.mesh);
    affiche.mesh.geometry.dispose();
    (affiche.mesh.material as THREE.Material).dispose();
    affiche.texture.dispose();
  }

  detruire(): void {
    for (const affiche of this.#blocs.values()) this.#oublier(affiche);
    this.#blocs.clear();
    this.groupe.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
