/**
 * Page de prototype de performance (ticket #4), séparée du jeu :
 * `prototype-perf.html?n=20000&technique=sprites|blitter|gpulayer&vue=tout|rue`.
 * Affiche les images par seconde à l'écran et expose `window.__perf` pour
 * `scripts/mesure-perf.ts`.
 */
import * as Phaser from 'phaser';
import { lireParametres, type ParametresPerf } from './parametres';
import { scenarioPerf } from './scenario';
import { ScenePerf, type DonneesScenePerf, type MesuresScene } from './scene-perf';

export interface ResultatMesure {
  parametres: ParametresPerf;
  /** Images par seconde moyennes sur la fenêtre de mesure. */
  fps: number;
  /** Durée d'image au 95e centile, en ms. */
  p95Ms: number;
  pireMs: number;
  /**
   * Temps du fil principal par image (pas de jeu Phaser complet : Cortège, objets, préparation
   * et envoi des lots WebGL), moyenne et 95e centile, en ms. Indépendant du GPU émulé.
   */
  cpuMs: number;
  cpuP95Ms: number;
  /** Temps JS moyen par image passé dans Cortège + placement + mise à jour des objets, en ms. */
  miseAJourMs: number;
  dessines: number;
  /** Tas JS utilisé (performance.memory, Chromium), en Mo ; null si indisponible. */
  tasMo: number | null;
  renderer: string;
}

declare global {
  interface Window {
    __perf?: { pret: boolean; mesurer: (dureeMs: number) => Promise<ResultatMesure> };
  }
}

const parametres = lireParametres(window.location.search);
const scenario = scenarioPerf(parametres.n);
const mesures: MesuresScene = { msMiseAJour: 0, images: 0, dessines: 0 };
const collectesCpu = new Set<number[]>();
const affichage = document.querySelector<HTMLDivElement>('#mesures')!;

const tasMo = () => {
  const memoire = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memoire ? memoire.usedJSHeapSize / 2 ** 20 : null;
};

function nomRenderer(): string {
  const gl = (jeu.renderer as { gl?: WebGLRenderingContext }).gl;
  if (!gl) return 'canvas';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/** Échantillonne les durées d'image via requestAnimationFrame pendant `dureeMs`. */
function mesurer(dureeMs: number): Promise<ResultatMesure> {
  return new Promise((resoudre) => {
    const durees: number[] = [];
    const depart = { images: mesures.images, ms: mesures.msMiseAJour };
    // Chaque mesure a sa propre collecte : l'affichage à l'écran mesure en parallèle du script.
    const coutsCpu: number[] = [];
    collectesCpu.add(coutsCpu);
    let precedent = performance.now();
    const debut = precedent;
    const image = (t: number) => {
      durees.push(t - precedent);
      precedent = t;
      if (t - debut < dureeMs) {
        requestAnimationFrame(image);
        return;
      }
      const tri = [...durees].sort((a, b) => a - b);
      collectesCpu.delete(coutsCpu);
      const cpu = coutsCpu.sort((a, b) => a - b);
      const images = mesures.images - depart.images;
      resoudre({
        parametres,
        fps: (durees.length * 1000) / (t - debut),
        p95Ms: tri[Math.floor(tri.length * 0.95)] ?? 0,
        pireMs: tri[tri.length - 1] ?? 0,
        cpuMs: cpu.reduce((a, b) => a + b, 0) / Math.max(cpu.length, 1),
        cpuP95Ms: cpu[Math.floor(cpu.length * 0.95)] ?? 0,
        miseAJourMs: images ? (mesures.msMiseAJour - depart.ms) / images : 0,
        dessines: mesures.dessines,
        tasMo: tasMo(),
        renderer: nomRenderer(),
      });
    };
    requestAnimationFrame(image);
  });
}

const donnees: DonneesScenePerf = {
  parametres,
  scenario,
  mesures,
  pret: () => {
    window.__perf = { pret: true, mesurer };
    // Affichage continu pour un essai à la main sur un téléphone.
    const boucle = async () => {
      const r = await mesurer(1000);
      affichage.textContent =
        `${parametres.n} avatars · ${parametres.technique} · vue ${parametres.vue} · ` +
        `${r.fps.toFixed(0)} i/s · p95 ${r.p95Ms.toFixed(0)} ms · CPU ${r.cpuMs.toFixed(1)} ms ` +
        `(MAJ ${r.miseAJourMs.toFixed(1)}) · ` +
        `${r.dessines} dessinés · tas ${r.tasMo?.toFixed(0) ?? '?'} Mo`;
      void boucle();
    };
    void boucle();
  },
};

const jeu = new Phaser.Game({
  type: Phaser.WEBGL, // SpriteGPULayer est WebGL uniquement ; mêmes conditions pour les trois techniques
  parent: 'jeu',
  backgroundColor: '#f4f1ea',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [],
});
jeu.scene.add('perf', ScenePerf, true, donnees);

// Coût du fil principal par pas de jeu : du début de la mise à jour à la fin de l'envoi du rendu.
let debutPas = 0;
jeu.events.on(Phaser.Core.Events.PRE_STEP, () => (debutPas = performance.now()));
jeu.events.on(Phaser.Core.Events.POST_RENDER, () => {
  const cout = performance.now() - debutPas;
  for (const collecte of collectesCpu) collecte.push(cout);
});
