/**
 * Pluie et neige de la vue 3D (ADR 0008) : des particules dans une boîte centrée sur ce que
 * regarde la caméra, animées entièrement dans le shader (aucune mise à jour par image côté
 * CPU). La boîte grandit avec la distance de la caméra : de près, on voit les gouttes autour
 * du cortège ; de haut, une averse sur la ville.
 */
import * as THREE from 'three';
import type { Ambiance } from '../meteo/ambiance';

const PARTICULES_MAX = { pluie: 2600, neige: 2200 } as const;

const vertex = /* glsl */ `
  attribute vec3 aGraine;
  attribute float aBout;
  uniform float uTemps;
  uniform vec3 uCentre;
  uniform float uTaille;
  uniform float uVitesse;
  uniform float uLongueur;
  uniform float uNeige;
  uniform float uPxPoint;
  varying float vAlpha;
  void main() {
    vec3 boite = vec3(uTaille, uTaille * 0.6, uTaille);
    vec3 p = aGraine * boite;
    // Chute en boucle dans la boîte ; la neige ondule, la pluie file un peu de biais (vent).
    p.y = mod(p.y - uTemps * uVitesse * (0.8 + aGraine.x * 0.4), boite.y);
    p.x += uNeige * sin(uTemps * 0.9 + aGraine.z * 40.0) * 1.2 + (1.0 - uNeige) * p.y * 0.12;
    vec3 monde = uCentre + vec3(p.x - boite.x * 0.5, p.y, p.z - boite.z * 0.5);
    monde.y -= aBout * uLongueur;
    monde.x -= aBout * uLongueur * 0.12 * (1.0 - uNeige);
    vec4 mv = viewMatrix * vec4(monde, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPxPoint * (0.6 + aGraine.y * 0.8) / max(-mv.z, 1.0) * 30.0;
    // Les particules s'effacent en haut et en bas de la boîte, sans coupure nette.
    float h = p.y / boite.y;
    vAlpha = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.8, h);
  }
`;

const fragmentPluie = /* glsl */ `
  uniform vec3 uCouleur;
  uniform float uOpacite;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uCouleur, uOpacite * vAlpha);
  }
`;

const fragmentNeige = /* glsl */ `
  uniform vec3 uCouleur;
  uniform float uOpacite;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(uCouleur, uOpacite * vAlpha);
  }
`;

export class Precipitations {
  readonly groupe = new THREE.Group();
  #objet: THREE.LineSegments | THREE.Points | null = null;
  #materiau: THREE.ShaderMaterial | null = null;
  #sorte: 'pluie' | 'neige' | null = null;
  #temps = 0;

  /** Change la sorte et la densité des précipitations (aucune si l'ambiance n'en a pas). */
  appliquer(ambiance: Ambiance): void {
    const p = ambiance.precipitation;
    if (p?.sorte !== this.#sorte) this.#construire(p?.sorte ?? null);
    if (!this.#objet || !p) return;
    const n = Math.round(PARTICULES_MAX[p.sorte] * Math.min(1, p.densite));
    this.#objet.geometry.setDrawRange(0, p.sorte === 'pluie' ? n * 2 : n);
    // Gouttes claires sur ciel sombre, grises sur ciel clair.
    const nuit = ambiance.lumiere < 0.7;
    this.#materiau!.uniforms.uCouleur!.value.setHex(p.sorte === 'neige' ? 0xffffff : nuit ? 0xb8c4d6 : 0x7d8a99);
  }

  /**
   * À chaque image : la boîte suit le point regardé (au sol) et grandit avec la distance de
   * la caméra ; `pxParM` règle l'épaisseur apparente.
   */
  actualiser(dt: number, regard: { x: number; z: number }, distance: number, hauteurEcranPx: number): void {
    if (!this.#objet || !this.#materiau) return;
    this.#temps += dt;
    const taille = Math.min(2500, Math.max(60, distance * 1.4));
    const u = this.#materiau.uniforms;
    u.uTemps!.value = this.#temps;
    u.uCentre!.value.set(regard.x, 0, regard.z);
    u.uTaille!.value = taille;
    const pluie = this.#sorte === 'pluie';
    // Vitesse et longueur à l'échelle de la boîte : de haut, l'averse reste lisible.
    const echelle = taille / 60;
    u.uVitesse!.value = (pluie ? 22 : 2.2) * echelle;
    u.uLongueur!.value = (pluie ? 0.9 : 0) * echelle;
    u.uPxPoint!.value = (hauteurEcranPx / 900) * echelle;
    // Vue de haut : l'averse se devine sans brouiller le plan de la ville.
    u.uOpacite!.value = (pluie ? 0.55 : 0.9) * Math.min(1, Math.max(0.3, 1.3 - distance / 700));
  }

  #construire(sorte: 'pluie' | 'neige' | null): void {
    this.#vider();
    this.#sorte = sorte;
    if (!sorte) return;
    const pluie = sorte === 'pluie';
    const n = PARTICULES_MAX[sorte];
    const sommets = pluie ? 2 : 1;
    const graines = new Float32Array(n * sommets * 3);
    const bouts = new Float32Array(n * sommets);
    for (let i = 0; i < n; i++) {
      const g = [Math.random(), Math.random(), Math.random()];
      for (let s = 0; s < sommets; s++) {
        graines.set(g, (i * sommets + s) * 3);
        bouts[i * sommets + s] = s;
      }
    }
    const geometrie = new THREE.BufferGeometry();
    geometrie.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * sommets * 3), 3));
    geometrie.setAttribute('aGraine', new THREE.Float32BufferAttribute(graines, 3));
    geometrie.setAttribute('aBout', new THREE.Float32BufferAttribute(bouts, 1));
    this.#materiau = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: pluie ? fragmentPluie : fragmentNeige,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTemps: { value: 0 },
        uCentre: { value: new THREE.Vector3() },
        uTaille: { value: 60 },
        uVitesse: { value: 20 },
        uLongueur: { value: 1 },
        uNeige: { value: pluie ? 0 : 1 },
        uPxPoint: { value: 1 },
        uCouleur: { value: new THREE.Color(0xffffff) },
        uOpacite: { value: pluie ? 0.55 : 0.9 },
      },
    });
    this.#objet = pluie ? new THREE.LineSegments(geometrie, this.#materiau) : new THREE.Points(geometrie, this.#materiau);
    this.#objet.frustumCulled = false;
    this.#objet.renderOrder = 10;
    this.groupe.add(this.#objet);
  }

  #vider(): void {
    if (!this.#objet) return;
    this.groupe.remove(this.#objet);
    this.#objet.geometry.dispose();
    this.#materiau?.dispose();
    this.#objet = null;
    this.#materiau = null;
  }

  detruire(): void {
    this.#vider();
  }
}
