/**
 * Banc d'écoute de l'ambiance (ADR 0008) : enregistre en WAV ce qu'on entend dans la vue
 * d'une manif, phase par phase, sans attendre une vraie manif (la danse finale n'arrive
 * qu'au bout du parcours). Pour régler le son à l'oreille.
 *
 * Construit la page `client/ecoute-son.html` (build Vite, hors du bundle du jeu), la sert
 * en local, l'ouvre dans Chromium headless (Playwright) et enregistre la sortie du moteur
 * en temps réel : compter la durée demandée par fichier.
 *
 * Usage : npm run ecouter-son -- [--phases=avant,marche,danse] [--soutiens=40,3000]
 *         [--proximites=1,0.3] [--duree=20] [--chant=10] [--sortie=var/son]
 *         (--chant : lance un chant local à cet instant, en secondes)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { RACINE } from './config';

function option(nom: string, defaut: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return arg ? arg.slice(nom.length + 3) : defaut;
}
const liste = (nom: string, defaut: string) => option(nom, defaut).split(',').filter(Boolean);

const phases = liste('phases', 'avant,marche,danse');
const soutiens = liste('soutiens', '40,3000').map(Number);
const proximites = liste('proximites', '1').map(Number);
const dureeS = Number(option('duree', '20'));
const chant = option('chant', '');
const dossierSortie = join(RACINE, option('sortie', 'var/son'));

/** Ce que la page expose (client/src/ecoute-son/main.ts ; pas de lib DOM ici). */
interface PageEcoute {
  __ecoute?: {
    pret: boolean;
    jouer: (s: {
      phase: string;
      soutiens: number;
      proximite: number;
      dureeS: number;
      chantS?: number;
    }) => Promise<{ taux: number; canaux: [string, string] }>;
  };
}

/** WAV 16 bits stéréo. */
function wav(gauche: Float32Array, droite: Float32Array, taux: number): Buffer {
  const n = Math.min(gauche.length, droite.length);
  const tampon = Buffer.alloc(44 + n * 4);
  tampon.write('RIFF', 0);
  tampon.writeUInt32LE(36 + n * 4, 4);
  tampon.write('WAVEfmt ', 8);
  tampon.writeUInt32LE(16, 16);
  tampon.writeUInt16LE(1, 20);
  tampon.writeUInt16LE(2, 22);
  tampon.writeUInt32LE(taux, 24);
  tampon.writeUInt32LE(taux * 4, 28);
  tampon.writeUInt16LE(4, 32);
  tampon.writeUInt16LE(16, 34);
  tampon.write('data', 36);
  tampon.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const canal of [gauche, droite]) {
      tampon.writeInt16LE(Math.round(Math.max(-1, Math.min(1, canal[i]!)) * 32_767), o);
      o += 2;
    }
  }
  return tampon;
}

const flottants = (b64: string) => {
  const octets = Buffer.from(b64, 'base64');
  return new Float32Array(octets.buffer, octets.byteOffset, octets.length / 4);
};

// 1. Build de la page du banc d'écoute seule, dans un dossier temporaire.
const racineClient = join(RACINE, 'client');
const dossierBuild = mkdtempSync(join(tmpdir(), 'pc-son-'));
await build({
  root: racineClient,
  logLevel: 'warn',
  build: {
    outDir: dossierBuild,
    emptyOutDir: true,
    rollupOptions: { input: join(racineClient, 'ecoute-son.html') },
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

// 2. Chromium headless, son autorisé sans geste.
const navigateur = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
mkdirSync(dossierSortie, { recursive: true });
try {
  for (const phase of phases) {
    for (const n of soutiens) {
      for (const proximite of proximites) {
        const page = await navigateur.newPage();
        const erreurs: string[] = [];
        page.on('pageerror', (e) => erreurs.push(e.message));
        await page.goto(`${adresse}ecoute-son.html`);
        await page.waitForFunction(() => (globalThis as PageEcoute).__ecoute?.pret);
        const scenario = { phase, soutiens: n, proximite, dureeS, ...(chant ? { chantS: Number(chant) } : {}) };
        const r = await page.evaluate((s) => (globalThis as PageEcoute).__ecoute!.jouer(s), scenario);
        const nom = `${phase}-${n}${proximite === 1 ? '' : `-proximite-${proximite}`}${chant ? '-chant' : ''}.wav`;
        writeFileSync(join(dossierSortie, nom), wav(flottants(r.canaux[0]), flottants(r.canaux[1]), r.taux));
        console.log(`${nom} (${dureeS} s)${erreurs.length ? ` — erreurs : ${erreurs.join(' | ')}` : ''}`);
        await page.close();
      }
    }
  }
} finally {
  await navigateur.close();
  await serveur.close();
  rmSync(dossierBuild, { recursive: true, force: true });
}
console.log(`Fichiers dans ${dossierSortie}`);
