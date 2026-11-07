/**
 * Billboards instanciés : des sprites toujours face à la caméra (un quad par instance, une
 * seule texture atlas, un seul appel de dessin pour tous). Pieds au milieu du bas du sprite.
 *
 * Le quad est parallèle à l'écran (comme les sprites 2D : pas de déformation), dressé à
 * partir des pieds selon le « haut » de la caméra. De loin, les sprites gardent une taille
 * minimale à l'écran (comme `ECHELLE_SPRITE_MIN` en 2D) pour que la foule reste visible.
 */
import * as THREE from 'three';
import type { Point3 } from './repere';

/** Hauteur de référence (m) pour la taille minimale à l'écran : celle d'un avatar. */
const HAUTEUR_REFERENCE_M = 2;

const vertex = /* glsl */ `
  attribute vec2 coin;
  attribute vec3 aPied;
  attribute vec2 aTaille;
  attribute vec4 aUv;
  attribute float aLever;
  uniform float uPxMin;
  uniform float uHauteurEcran;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vec3 droite = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 haut = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec4 pied = viewMatrix * vec4(aPied, 1.0);
    // Pixels par mètre à la distance des pieds ; agrandi si l'avatar ferait moins de uPxMin.
    float pxParM = projectionMatrix[1][1] * uHauteurEcran * 0.5 / max(-pied.z, 0.001);
    float echelle = max(1.0, uPxMin / (${HAUTEUR_REFERENCE_M.toFixed(1)} * pxParM));
    vec3 monde = aPied + droite * (coin.x * aTaille.x * echelle) + haut * ((aLever + coin.y * aTaille.y) * echelle);
    vec4 mvPosition = viewMatrix * vec4(monde, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = vec2(mix(aUv.x, aUv.z, coin.x + 0.5), mix(aUv.w, aUv.y, coin.y));
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec3 uTeinte;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(uTexture, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb * uTeinte, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface OptionsBillboards {
  texture: THREE.Texture;
  capacite: number;
  /** Teinte multipliée (masse de foule assombrie). */
  teinte?: number;
  /** Ordre de rendu (les plus grands passent après). */
  ordre?: number;
  /** Toujours visible, par-dessus le reste (sa propre mise en valeur). */
  devant?: boolean;
}

export class Billboards {
  readonly mesh: THREE.Mesh;
  readonly #geometrie: THREE.InstancedBufferGeometry;
  readonly #pieds: THREE.InstancedBufferAttribute;
  readonly #tailles: THREE.InstancedBufferAttribute;
  readonly #uvs: THREE.InstancedBufferAttribute;
  readonly #levers: THREE.InstancedBufferAttribute;
  readonly #materiau: THREE.ShaderMaterial;
  readonly capacite: number;
  #nombre = 0;

  constructor({ texture, capacite, teinte = 0xffffff, ordre = 0, devant = false }: OptionsBillboards) {
    this.capacite = capacite;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('coin', new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1], 2));
    // Attribut `position` factice : Three.js en a besoin pour compter les sommets.
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const attribut = (taille: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacite * taille), taille);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.#pieds = attribut(3);
    this.#tailles = attribut(2);
    this.#uvs = attribut(4);
    this.#levers = attribut(1);
    g.setAttribute('aPied', this.#pieds);
    g.setAttribute('aTaille', this.#tailles);
    g.setAttribute('aUv', this.#uvs);
    g.setAttribute('aLever', this.#levers);
    g.instanceCount = 0;
    this.#geometrie = g;
    this.#materiau = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uPxMin: { value: 8 }, uHauteurEcran: { value: 800 }, uTeinte: { value: new THREE.Color(teinte) }, uTexture: { value: null } },
      ]),
    });
    this.#materiau.uniforms.uTexture!.value = texture;
    this.#materiau.fog = true; // brouillard de la scène (uniformes UniformsLib.fog)
    if (devant) this.#materiau.depthTest = false;
    this.mesh = new THREE.Mesh(g, this.#materiau);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = ordre;
  }

  /** Taille minimale d'un avatar à l'écran (pixels du tampon de rendu) et hauteur de l'écran. */
  ecran(pxMin: number, hauteurEcran: number): void {
    this.#materiau.uniforms.uPxMin!.value = pxMin;
    this.#materiau.uniforms.uHauteurEcran!.value = hauteurEcran;
  }

  /** Commence une nouvelle image : aucune instance. */
  vider(): void {
    this.#nombre = 0;
  }

  /**
   * Ajoute une instance : pieds, taille (m), cadre dans la texture (u0, v0 en haut à gauche,
   * u1, v1 en bas à droite, v vers le bas), et `lever` (m) : le sprite commence à cette hauteur
   * au-dessus des pieds (pancarte tenue au-dessus de la tête). Renvoie faux si c'est plein.
   */
  ajouter(pied: Point3, largeur: number, hauteur: number, uv: readonly [number, number, number, number], lever = 0): boolean {
    if (this.#nombre >= this.capacite) return false;
    const i = this.#nombre++;
    this.#pieds.setXYZ(i, pied.x, pied.y, pied.z);
    this.#tailles.setXY(i, largeur, hauteur);
    this.#uvs.setXYZW(i, uv[0], uv[1], uv[2], uv[3]);
    this.#levers.setX(i, lever);
    return true;
  }

  /** Envoie les instances de l'image au GPU. */
  terminer(): void {
    const n = this.#nombre;
    this.#geometrie.instanceCount = n;
    for (const [a, taille] of [
      [this.#pieds, 3],
      [this.#tailles, 2],
      [this.#uvs, 4],
      [this.#levers, 1],
    ] as const) {
      a.clearUpdateRanges();
      if (n > 0) a.addUpdateRange(0, n * taille);
      a.needsUpdate = true;
    }
  }

  detruire(): void {
    this.#geometrie.dispose();
    this.#materiau.dispose();
  }
}
