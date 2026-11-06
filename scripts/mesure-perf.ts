/**
 * Mesure reproductible du prototype de performance (ticket #4).
 *
 * Construit la page `client/prototype-perf.html` (build Vite de production, hors
 * du bundle du jeu), la sert en local, puis l'ouvre dans Chromium headless
 * (Playwright) en émulant un téléphone d'entrée de gamme : profil Moto G4
 * (360 × 640, tactile) et ralentissement CPU par CDP
 * (`Emulation.setCPUThrottlingRate`). Pour chaque combinaison nombre d'avatars ×
 * technique × vue × ralentissement : 2 s de chauffe, puis échantillonnage des
 * durées d'image (requestAnimationFrame) et de la mémoire (performance.memory et
 * CDP `Performance.getMetrics`).
 *
 * ⚠ Émulation : en headless, WebGL est rendu en logiciel (SwiftShader) dans le
 * processus GPU, qui n'est PAS ralenti par `setCPUThrottlingRate` (seul le fil
 * principal du moteur de rendu l'est). À confirmer sur un vrai téléphone.
 *
 * Usage : npm run mesure-perf -- [--n=1000,5000,10000,20000] [--techniques=sprites,blitter,gpulayer]
 *         [--vues=tout,rue] [--ralentis=4,6] [--majs=0,250] [--duree=5000] [--sortie=var/perf/resultats.json]
 *         (--majs : intervalle de recalcul des positions en ms, 0 = à chaque image)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium, devices } from 'playwright-core';
import { build, preview } from 'vite';
import { RACINE } from './config';

const APPAREIL = 'Moto G4';
const CHAUFFE_MS = 2000;

function option(nom: string, defaut: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return arg ? arg.slice(nom.length + 3) : defaut;
}
const liste = (nom: string, defaut: string) => option(nom, defaut).split(',').filter(Boolean);

const tailles = liste('n', '1000,5000,10000,20000').map(Number);
const techniques = liste('techniques', 'sprites,blitter,gpulayer');
const vues = liste('vues', 'tout,rue');
const ralentis = liste('ralentis', '4,6').map(Number);
const majs = liste('majs', '0').map(Number);
const dureeMs = Number(option('duree', '5000'));
const sortie = join(RACINE, option('sortie', 'var/perf/resultats.json'));

// 1. Build de production de la page de prototype seule, dans un dossier temporaire.
const racineClient = join(RACINE, 'client');
const dossierBuild = mkdtempSync(join(tmpdir(), 'pc-perf-'));
await build({
  root: racineClient,
  logLevel: 'warn',
  build: {
    outDir: dossierBuild,
    emptyOutDir: true,
    rollupOptions: { input: join(racineClient, 'prototype-perf.html') },
  },
});
const serveur = await preview({
  root: racineClient,
  logLevel: 'warn',
  build: { outDir: dossierBuild },
  preview: { port: 0, host: '127.0.0.1' },
});
const adresse = serveur.resolvedUrls?.local[0];
if (!adresse) throw new Error('Serveur de prévisualisation sans adresse');

// 2. Chromium headless, WebGL logiciel (SwiftShader via ANGLE).
const navigateur = await chromium.launch({
  args: [
    '--enable-precise-memory-info',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const { defaultBrowserType: _, ...profil } = devices[APPAREIL]!;

interface Ligne {
  n: number;
  technique: string;
  vue: string;
  ralenti: number;
  majMs: number;
  fps: number;
  p95Ms: number;
  pireMs: number;
  cpuMs: number;
  cpuP95Ms: number;
  miseAJourMs: number;
  dessines: number;
  tasMo: number | null;
  tasCdpMo: number | null;
  chargementMs: number;
  renderer: string;
}
const resultats: Ligne[] = [];

/** `window.__perf` exposé par client/src/prototype-perf/main.ts (pas de lib DOM ici). */
interface PagePerf {
  __perf?: {
    pret: boolean;
    mesurer: (dureeMs: number) => Promise<{
      fps: number;
      p95Ms: number;
      pireMs: number;
      cpuMs: number;
      cpuP95Ms: number;
      miseAJourMs: number;
      dessines: number;
      tasMo: number | null;
      renderer: string;
    }>;
  };
}

const configurations = ralentis.flatMap((ralenti) =>
  majs.flatMap((majMs) =>
    vues.flatMap((vue) =>
      techniques.flatMap((technique) => tailles.map((n) => ({ ralenti, majMs, vue, technique, n }))),
    ),
  ),
);

for (const { ralenti, majMs, vue, technique, n } of configurations) {
  const contexte = await navigateur.newContext(profil);
  const page = await contexte.newPage();
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  const cdp = await contexte.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: ralenti });
  await cdp.send('Performance.enable');
  const debut = Date.now();
  await page.goto(`${adresse}prototype-perf.html?n=${n}&technique=${technique}&vue=${vue}&maj=${majMs}`);
  await page.waitForFunction(() => (globalThis as PagePerf).__perf?.pret, undefined, { timeout: 180_000 });
  const chargementMs = Date.now() - debut;
  await page.waitForTimeout(CHAUFFE_MS);
  const r = await page.evaluate((d) => (globalThis as PagePerf).__perf!.mesurer(d), dureeMs);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const tasCdp = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value;
  if (erreurs.length) console.error(`  erreurs page : ${erreurs.join(' | ')}`);
  const ligne: Ligne = {
    n,
    technique,
    vue,
    ralenti,
    majMs,
    fps: r.fps,
    p95Ms: r.p95Ms,
    pireMs: r.pireMs,
    cpuMs: r.cpuMs,
    cpuP95Ms: r.cpuP95Ms,
    miseAJourMs: r.miseAJourMs,
    dessines: r.dessines,
    tasMo: r.tasMo,
    tasCdpMo: tasCdp === undefined ? null : tasCdp / 2 ** 20,
    chargementMs,
    renderer: r.renderer,
  };
  resultats.push(ligne);
  console.log(
    `CPU ×${ralenti} · maj ${majMs} ms · vue ${vue.padEnd(4)} · ${technique.padEnd(8)} · n=${String(n).padStart(5)} : ` +
      `${r.fps.toFixed(1).padStart(5)} i/s · p95 ${r.p95Ms.toFixed(0).padStart(4)} ms · ` +
      `CPU ${r.cpuMs.toFixed(1).padStart(5)} ms (p95 ${r.cpuP95Ms.toFixed(0)}, MAJ ${r.miseAJourMs.toFixed(1)}) · ${String(r.dessines).padStart(5)} dessinés · ` +
      `tas ${ligne.tasCdpMo?.toFixed(0) ?? '?'} Mo · chargement ${(chargementMs / 1000).toFixed(1)} s`,
  );
  await contexte.close();
}

await navigateur.close();
await new Promise<void>((resoudre) => serveur.httpServer.close(() => resoudre()));
rmSync(dossierBuild, { recursive: true, force: true });

mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(
  sortie,
  JSON.stringify(
    { date: new Date().toISOString(), appareil: APPAREIL, dureeMs, renderer: resultats[0]?.renderer, resultats },
    null,
    2,
  ),
);
console.log(`\nRésultats bruts : ${sortie}`);
