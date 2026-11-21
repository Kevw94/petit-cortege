/**
 * Tracé du parcours au sol dans la vue 3D : ruban jaune (largeur ajustée au zoom pour rester
 * visible de haut), flèches blanches dans le sens de marche, bande de départ verte et damier
 * d'arrivée, comme la vue 2D (decor/trace.ts). Couleurs de la palette Kenney.
 */
import * as THREE from 'three';
import { tracerParcours, type PointOriente } from '@petit-cortege/shared';
import type { PointM } from '../cadrage';
import { materiauDeSol, ORDRE_SOL } from './sol';

const COULEUR_LIGNE = 0xf4c542;
const COULEUR_FLECHE = 0xffffff;
const COULEUR_DEPART = 0x3d9a4c;
const COULEUR_SOMBRE = 0x2b2b2b;
const ESPACEMENT_FLECHES_M = 50;
const TAILLE_FLECHE_M = 2.5;
const LARGEUR_BANDE_M = 14;
/** Largeur du ruban au plus près (m), comme la ligne de la vue 2D. */
export const LARGEUR_LIGNE_M = 1.2;
/** Au-delà de cette distance de la caméra, les flèches ne se voient plus : on les cache. */
const DISTANCE_FLECHES_M = 400;

const vertexRuban = /* glsl */ `
  attribute vec2 dir;
  uniform float uLargeur;
  void main() {
    vec3 p = position + vec3(dir.x, 0.0, dir.y) * uLargeur * 0.5;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const fragmentRuban = /* glsl */ `
  uniform vec3 uCouleur;
  void main() {
    gl_FragColor = vec4(uCouleur, 1.0);
    #include <colorspace_fragment>
  }
`;

export class TraceAuSol3D {
  readonly groupe = new THREE.Group();
  readonly depart: PointOriente;
  readonly arrivee: PointOriente;
  readonly #ruban: THREE.ShaderMaterial;
  readonly #fleches: THREE.Mesh;

  /** `parcours` : points du parcours en mètres. */
  constructor(parcours: PointM[]) {
    const trace = tracerParcours(parcours, { espacementFleches: ESPACEMENT_FLECHES_M });
    this.depart = trace.depart;
    this.arrivee = trace.arrivee;

    // Ruban : un quad par tronçon, un disque à chaque sommet (virages sans trou).
    const centres: number[] = [];
    const dirs: number[] = [];
    const indices: number[] = [];
    const sommet = (p: PointM, dx: number, dy: number) => {
      centres.push(p.x, 0, p.y);
      dirs.push(dx, dy);
      return centres.length / 3 - 1;
    };
    const ligne = trace.ligne;
    for (let i = 1; i < ligne.length; i++) {
      const [a, b] = [ligne[i - 1]!, ligne[i]!];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l === 0) continue;
      const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
      const [i0, i1, i2, i3] = [sommet(a, n.x, n.y), sommet(a, -n.x, -n.y), sommet(b, -n.x, -n.y), sommet(b, n.x, n.y)];
      indices.push(i0, i1, i2, i0, i2, i3);
    }
    const RAYONS = 8;
    for (const p of ligne) {
      const c = sommet(p, 0, 0);
      const premier = centres.length / 3;
      for (let k = 0; k < RAYONS; k++)
        sommet(p, Math.cos((k / RAYONS) * Math.PI * 2), Math.sin((k / RAYONS) * Math.PI * 2));
      for (let k = 0; k < RAYONS; k++) indices.push(c, premier + ((k + 1) % RAYONS), premier + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(centres, 3));
    g.setAttribute('dir', new THREE.Float32BufferAttribute(dirs, 2));
    g.setIndex(indices);
    this.#ruban = new THREE.ShaderMaterial({
      vertexShader: vertexRuban,
      fragmentShader: fragmentRuban,
      uniforms: { uLargeur: { value: LARGEUR_LIGNE_M }, uCouleur: { value: new THREE.Color(COULEUR_LIGNE) } },
      // Opaque : un objet transparent serait dessiné après la foule et les bâtiments.
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const ruban = new THREE.Mesh(g, this.#ruban);
    ruban.frustumCulled = false;
    ruban.renderOrder = ORDRE_SOL.trace;
    this.groupe.add(ruban);

    // Flèches : triangles à plat, pointe dans le sens de marche.
    const fleches: number[] = [];
    for (const f of trace.fleches) fleches.push(...pointe(f, TAILLE_FLECHE_M));
    const gf = new THREE.BufferGeometry();
    gf.setAttribute('position', new THREE.Float32BufferAttribute(fleches, 3));
    this.#fleches = new THREE.Mesh(
      gf,
      materiauDeSol({ color: COULEUR_FLECHE, side: THREE.DoubleSide }, ORDRE_SOL.marques),
    );
    this.#fleches.renderOrder = ORDRE_SOL.marques;
    this.groupe.add(this.#fleches);

    // Départ (vert) et arrivée (damier), en travers de la rue.
    const positions: number[] = [];
    const couleurs: number[] = [];
    const c = new THREE.Color();
    bande(trace.depart, () => COULEUR_DEPART, positions, couleurs, c);
    bande(trace.arrivee, (i, j) => ((i + j) % 2 ? COULEUR_SOMBRE : 0xffffff), positions, couleurs, c);
    const gb = new THREE.BufferGeometry();
    gb.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    gb.setAttribute('color', new THREE.Float32BufferAttribute(couleurs, 3));
    const bandes = new THREE.Mesh(gb, materiauDeSol({ vertexColors: true, side: THREE.DoubleSide }, ORDRE_SOL.marques));
    bandes.renderOrder = ORDRE_SOL.marques;
    this.groupe.add(bandes);
  }

  /** Ajuste le ruban au zoom : au moins `pxMin` pixels de large à l'écran. */
  actualiser(metresParPx: number, pxMin: number, distanceCamera: number): void {
    this.#ruban.uniforms.uLargeur!.value = Math.max(LARGEUR_LIGNE_M, metresParPx * pxMin);
    this.#fleches.visible = distanceCamera < DISTANCE_FLECHES_M;
  }

  detruire(): void {
    this.groupe.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

/** Triangle à plat pointant dans la direction `angle` (degrés, sens horaire depuis l'est). */
function pointe(c: PointOriente, taille: number): number[] {
  const a = (c.angle * Math.PI) / 180;
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  const [nx, ny] = [-uy, ux];
  const [avant, arriere, demi] = [0.6 * taille, 0.4 * taille, 0.45 * taille];
  return [
    c.x + ux * avant,
    0,
    c.y + uy * avant,
    c.x - ux * arriere + nx * demi,
    0,
    c.y - uy * arriere + ny * demi,
    c.x - ux * arriere - nx * demi,
    0,
    c.y - uy * arriere - ny * demi,
  ];
}

/** Bande en travers du parcours (2 rangées de cases de 2 m), couleur par case. */
function bande(
  p: PointOriente,
  couleur: (i: number, j: number) => number,
  positions: number[],
  couleurs: number[],
  c: THREE.Color,
): void {
  const a = (p.angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const n = { x: -u.y, y: u.x };
  const point = (i: number, j: number) => [
    p.x + n.x * (i * 2 - LARGEUR_BANDE_M / 2) + u.x * (j * 2 - 2),
    0,
    p.y + n.y * (i * 2 - LARGEUR_BANDE_M / 2) + u.y * (j * 2 - 2),
  ];
  for (let i = 0; i < LARGEUR_BANDE_M / 2; i++) {
    for (let j = 0; j < 2; j++) {
      const [q0, q1, q2, q3] = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      positions.push(...q0!, ...q1!, ...q2!, ...q0!, ...q2!, ...q3!);
      c.setHex(couleur(i, j), THREE.SRGBColorSpace);
      for (let k = 0; k < 6; k++) couleurs.push(c.r, c.g, c.b);
    }
  }
}
