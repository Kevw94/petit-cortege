/**
 * Régénère l'image d'aperçu de lien du site (Open Graph, ADR 0002) depuis les planches
 * Kenney et l'atlas d'apparence : `npm run generer-apercu`. Le résultat est commité
 * (un test vérifie qu'il est à jour).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEMIN_APERCU, genererApercuLien } from './apercu/apercu';

const racine = join(import.meta.dirname, '..');
const { image, png } = genererApercuLien(racine);
writeFileSync(join(racine, CHEMIN_APERCU), png);
console.log(`Aperçu de lien : ${image.largeur} × ${image.hauteur} px → ${CHEMIN_APERCU}`);
