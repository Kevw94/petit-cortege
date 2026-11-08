/**
 * Météo de la vue 2D (Phaser, vue de dessus) : pas de ciel à montrer, donc un voile posé
 * sur le canvas (assombri la nuit, grisé sous la pluie, en `mix-blend-mode: multiply`) et
 * la pluie ou la neige en CSS. Même `Ambiance` que la vue 3D (ADR 0008).
 */
import type { ManifPubliee } from '@petit-cortege/shared';
import { ambiance } from './ambiance';

const INTERVALLE_MS = 30_000;

export function creerVoileMeteo(parent: HTMLElement, manif: () => ManifPubliee): { detruire(): void } {
  const voile = document.createElement('div');
  voile.className = 'voile-meteo';
  const gouttes = document.createElement('div');
  gouttes.className = 'precipitation-2d';
  parent.append(voile, gouttes);
  const appliquer = () => {
    const m = manif();
    const a = ambiance(m.meteo, m.parcours.coordinates[0]!, new Date());
    // Vue de dessus, sans lumière propre aux sprites : la nuit assombrit moins qu'en 3D.
    // Ciel bouché de jour (soleil voilé) : la ville grisaille un peu.
    const voilee = 1 - 0.14 * (1 - Math.min(1, a.soleil.intensite / 1.6)) * (a.nuit ? 0 : 1);
    const lumiere = (0.35 + 0.65 * a.lumiere) * voilee;
    const c = (decalage: number) => Math.round(((a.teinte >> decalage) & 255) * lumiere);
    voile.style.backgroundColor = `rgb(${c(16)} ${c(8)} ${c(0)})`;
    gouttes.dataset.sorte = a.precipitation?.sorte ?? '';
    gouttes.style.opacity = String(a.precipitation ? 0.35 + a.precipitation.densite * 0.5 : 0);
  };
  appliquer();
  const minuterie = setInterval(appliquer, INTERVALLE_MS);
  return {
    detruire() {
      clearInterval(minuterie);
      voile.remove();
      gouttes.remove();
    },
  };
}
