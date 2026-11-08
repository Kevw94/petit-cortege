/**
 * Ciel de la vue 3D (ADR 0008) : applique une `Ambiance` (météo publiée + heure au lieu de la
 * manif) à la scène : dégradé du ciel en arrière-plan, brume de la couleur de l'horizon,
 * lumières du soleil et du ciel, éclairs d'orage. Les matériaux non éclairés (sol, sprites)
 * lisent `eclairage` pour s'assombrir la nuit.
 */
import * as THREE from 'three';
import type { Ambiance } from '../meteo/ambiance';

/** Éclair : durée (s) et intervalle moyen entre deux éclairs (s). */
const ECLAIR = { duree: 0.18, intervalle: 9 } as const;

export class CielAmbiant {
  readonly #scene: THREE.Scene;
  readonly #diffuse: THREE.HemisphereLight;
  readonly #soleil: THREE.DirectionalLight;
  readonly #canvas = document.createElement('canvas');
  readonly #fond: THREE.CanvasTexture;
  /** Éclairage des matériaux non éclairés (sol, sprites) : teinte × lumière. */
  readonly eclairage = new THREE.Color(1, 1, 1);
  #ambiance: Ambiance | null = null;
  #eclair = 0;
  #prochainEclair: number = ECLAIR.intervalle;

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
    this.#diffuse = new THREE.HemisphereLight(0xffffff, 0x9a9384, 2.2);
    this.#soleil = new THREE.DirectionalLight(0xfff4e0, 1.4);
    this.#soleil.position.set(-0.6, 1, 0.9); // Sud-ouest : les façades sud sont claires, les nord plus sombres.
    scene.add(this.#diffuse, this.#soleil);
    this.#canvas.width = 1;
    this.#canvas.height = 256;
    this.#fond = new THREE.CanvasTexture(this.#canvas);
    this.#fond.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.#fond;
    scene.fog = new THREE.Fog(0xcfdde6, 100, 600);
  }

  get ambiance(): Ambiance | null {
    return this.#ambiance;
  }

  appliquer(ambiance: Ambiance): void {
    this.#ambiance = ambiance;
    const ctx = this.#canvas.getContext('2d')!;
    const degrade = ctx.createLinearGradient(0, 0, 0, this.#canvas.height);
    const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    degrade.addColorStop(0, css(ambiance.zenith));
    degrade.addColorStop(0.75, css(ambiance.horizon));
    degrade.addColorStop(1, css(ambiance.horizon));
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, 1, this.#canvas.height);
    this.#fond.needsUpdate = true;
    (this.#scene.fog as THREE.Fog).color.setHex(ambiance.horizon);
    this.#soleil.color.setHex(ambiance.soleil.couleur);
    this.#mettreAJourLumieres(0);
  }

  /**
   * Portée de la brume : de près, la ville s'estompe plus tôt sous la pluie ou dans le
   * brouillard ; en montant (`distance` de la caméra), l'effet s'efface pour que le plan de
   * la ville reste lisible de haut.
   */
  brume(near: number, far: number, distance: number): void {
    const fog = this.#scene.fog as THREE.Fog;
    const portee = this.#ambiance?.portee ?? 1;
    const hauteur = Math.min(1, Math.max(0, (distance - 150) / 650));
    const k = portee + (1 - portee) * hauteur;
    fog.near = near * k;
    fog.far = Math.max(fog.near + 50, far * k);
  }

  /** À chaque image : éclairs d'orage. */
  animer(dt: number): void {
    if (!this.#ambiance?.eclairs) return;
    this.#prochainEclair -= dt;
    if (this.#prochainEclair <= 0) {
      this.#eclair = ECLAIR.duree;
      this.#prochainEclair = ECLAIR.intervalle * (0.4 + Math.random() * 1.2);
    }
    const avant = this.#eclair;
    this.#eclair = Math.max(0, this.#eclair - dt);
    if (avant > 0) this.#mettreAJourLumieres(this.#eclair / ECLAIR.duree);
  }

  #mettreAJourLumieres(flash: number): void {
    const a = this.#ambiance;
    if (!a) return;
    this.#diffuse.intensity = a.diffuse * (1 + flash * 1.5);
    this.#diffuse.color.setHex(a.teinte);
    this.#soleil.intensity = a.soleil.intensite;
    const lumiere = Math.min(1, a.lumiere + flash * 0.5);
    this.eclairage.setHex(a.teinte).multiplyScalar(lumiere);
  }

  detruire(): void {
    this.#fond.dispose();
    this.#scene.remove(this.#diffuse, this.#soleil);
  }
}
