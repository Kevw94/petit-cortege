/**
 * Seed de dev : (re)crée une manif pré-remplie dont le départ est dans
 * 2 minutes, avec des avatars déjà entrés et des retardataires à venir.
 * Usage : `npm run seed` (aussi lancé par `npm run dev`).
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  connecter,
  creerManif,
  lireParcoursGeoJson,
  migrer,
  preRemplirAvatars,
  type AvatarPreRempli,
  type Sql,
} from '@petit-cortege/server';
import { COULEURS_PANCARTE, encoderPancarte, FORMES_PANCARTE, SLOGANS } from '@petit-cortege/shared';
import { assurerBase, DOSSIER_PUBLICATION_DEV, RACINE, URL_BASE_DEV } from './config';

export const ID_MANIF_DEMO = 'demo-republique-nation';

const MINUTE = 60_000;
const identifiant = () => randomBytes(9).toString('base64url');
const auHasard = (n: number) => Math.floor(Math.random() * n);
/** Une pancarte quelconque du catalogue, pour une foule variée. */
const pancarteAuHasard = () =>
  encoderPancarte({
    slogan: auHasard(SLOGANS.length),
    couleur: auHasard(COULEURS_PANCARTE.length),
    forme: auHasard(FORMES_PANCARTE.length),
  });

/** Parcours de la démo : celui du décor publié dans client/public/decors/republique-nation.json. */
export async function parcoursDemo() {
  const fichier = join(RACINE, 'donnees/osm/republique-nation/parcours.geojson');
  return lireParcoursGeoJson(JSON.parse(await readFile(fichier, 'utf8')));
}

export async function semerManifDemo(sql: Sql, dossierPublication: string): Promise<void> {
  const maintenant = Date.now();
  await sql`delete from avatar where manif_id = ${ID_MANIF_DEMO}`;
  await sql`delete from manif where id = ${ID_MANIF_DEMO}`;
  // Les fichiers par minute sont immuables : on repart d'une publication vide.
  await rm(dossierPublication, { recursive: true, force: true });

  await creerManif(sql, {
    id: ID_MANIF_DEMO,
    intitule: 'Marche de démonstration',
    ville: 'Paris',
    ouverture: new Date(maintenant - 30 * MINUTE),
    depart: new Date(maintenant + 2 * MINUTE),
    // République → Nation par le boulevard Voltaire (≈ 3 km), sur les chemins OSM (donnees/osm/, ODbL).
    parcours: await parcoursDemo(),
    sources: [{ libelle: 'Source fictive (démo)', url: 'https://example.org/' }],
  });

  const avatars: AvatarPreRempli[] = [];
  // 80 soutiens entrés avant le départ, 60 retardataires sur la première demi-heure.
  for (let i = 0; i < 80; i++) avatars.push(avatar(maintenant - auHasard(30 * MINUTE)));
  for (let i = 0; i < 60; i++) avatars.push(avatar(maintenant + auHasard(30 * MINUTE)));
  await preRemplirAvatars(sql, avatars);
}

function avatar(entree: number): AvatarPreRempli {
  return { id: identifiant(), manifId: ID_MANIF_DEMO, entree: new Date(entree), apparence: auHasard(8), pancarte: pancarteAuHasard() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await assurerBase(URL_BASE_DEV);
  const sql = connecter(URL_BASE_DEV);
  await migrer(sql);
  await semerManifDemo(sql, DOSSIER_PUBLICATION_DEV);
  await sql.end();
  console.log(`Manif « ${ID_MANIF_DEMO} » semée.`);
}
