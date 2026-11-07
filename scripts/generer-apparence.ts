/**
 * Régénère l'atlas des couches d'apparence du client depuis la planche Kenney et le
 * catalogue partagé : `npm run generer-apparence`. À relancer après toute évolution du
 * catalogue d'apparence ; le résultat est commité (un test vérifie qu'il est à jour).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHEMINS_ATLAS, CHEMINS_PLANCHES, genererAtlasApparence, lirePng } from './apparence/atlas';

const racine = join(import.meta.dirname, '..');
const planche = lirePng(readFileSync(join(racine, CHEMINS_PLANCHES.personnages)));
const atlas = genererAtlasApparence(planche);
mkdirSync(dirname(join(racine, CHEMINS_ATLAS.png)), { recursive: true });
writeFileSync(join(racine, CHEMINS_ATLAS.png), atlas.png);
writeFileSync(join(racine, CHEMINS_ATLAS.json), atlas.json);
console.log(
  `Atlas d'apparence : ${Object.keys(atlas.description.cadres).length} couches, ` +
    `${atlas.image.largeur} × ${atlas.image.hauteur} px → ${CHEMINS_ATLAS.png}`,
);
