/**
 * Régénère le favicon du site (SVG, PNG 32 px, PNG 96 px, ICO 16/32/48, icône Apple) : `npm run generer-favicon`.
 * Le résultat est commité dans `client/public/` (un test vérifie qu'il est à jour).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEMINS_FAVICON, genererFavicon } from './favicon/favicon';

const racine = join(import.meta.dirname, '..');
const sorties = genererFavicon();
writeFileSync(join(racine, CHEMINS_FAVICON.svg), sorties.svg);
writeFileSync(join(racine, CHEMINS_FAVICON.png32), sorties.png32);
writeFileSync(join(racine, CHEMINS_FAVICON.png96), sorties.png96);
writeFileSync(join(racine, CHEMINS_FAVICON.ico), sorties.ico);
writeFileSync(join(racine, CHEMINS_FAVICON.apple), sorties.apple);
console.log(`Favicon → ${Object.values(CHEMINS_FAVICON).join(', ')}`);
