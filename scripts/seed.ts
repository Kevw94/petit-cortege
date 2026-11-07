/**
 * Seed de dev : (re)crée une manif pré-remplie dont le départ est dans
 * 2 minutes, avec des avatars déjà entrés et des retardataires à venir.
 * Usage : `npm run seed` (aussi lancé par `npm run dev`).
 *
 * Pour voir une manif très suivie (masse de foule) : `SEED_DEPART_MIN=-20` (départ il y a
 * 20 min), `SEED_AVANT=5000` (soutiens entrés avant le départ), `SEED_VAGUE=3000`
 * (vague d'arrivées en 2 minutes, 10 minutes après le départ).
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
import {
  ACCESSOIRES,
  apparenceAuHasard,
  COULEURS_PANCARTE,
  encoderApparence,
  encoderPancarte,
  FORMES_PANCARTE,
  SLOGANS,
} from '@petit-cortege/shared';
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
/** Une apparence quelconque du catalogue ; un avatar sur dix avec un accessoire. */
const apparenceDeLaFoule = () =>
  encoderApparence({
    ...apparenceAuHasard(),
    accessoire: Math.random() < 0.1 ? 1 + auHasard(ACCESSOIRES.length - 1) : 0,
  });

const nombreDepuisEnv = (nom: string, defaut: number) => {
  const valeur = Number(process.env[nom] ?? defaut);
  return Number.isFinite(valeur) ? valeur : defaut;
};

/** Parcours de la démo : celui du décor publié dans client/public/decors/republique-nation.json. */
export async function parcoursDemo() {
  const fichier = join(RACINE, 'donnees/osm/republique-nation/parcours.geojson');
  return lireParcoursGeoJson(JSON.parse(await readFile(fichier, 'utf8')));
}

export async function semerManifDemo(sql: Sql, dossierPublication: string): Promise<void> {
  const maintenant = Date.now();
  const depart = maintenant + nombreDepuisEnv('SEED_DEPART_MIN', 2) * MINUTE;
  await sql`delete from avatar where manif_id = ${ID_MANIF_DEMO}`;
  await sql`delete from manif where id = ${ID_MANIF_DEMO}`;
  // Les fichiers par minute sont immuables : on repart d'une publication vide.
  await rm(dossierPublication, { recursive: true, force: true });

  await creerManif(sql, {
    id: ID_MANIF_DEMO,
    intitule: 'Marche de démonstration',
    ville: 'Paris',
    ouverture: new Date(Math.min(maintenant, depart) - 30 * MINUTE),
    depart: new Date(depart),
    // République → Nation par le boulevard Voltaire (≈ 3 km), sur les chemins OSM (donnees/osm/, ODbL).
    parcours: await parcoursDemo(),
    sources: [{ libelle: 'Source fictive (démo)', url: 'https://example.org/' }],
  });

  const avatars: AvatarPreRempli[] = [];
  // 80 soutiens entrés avant le départ, 60 retardataires sur la première demi-heure.
  const avant = Math.min(maintenant, depart);
  for (let i = 0; i < nombreDepuisEnv('SEED_AVANT', 80); i++) avatars.push(avatar(avant - auHasard(30 * MINUTE)));
  for (let i = 0; i < 60; i++) avatars.push(avatar(depart + auHasard(30 * MINUTE)));
  for (let i = 0; i < nombreDepuisEnv('SEED_VAGUE', 0); i++) {
    avatars.push(avatar(depart + 10 * MINUTE + auHasard(2 * MINUTE)));
  }
  await preRemplirAvatars(sql, avatars);
}

function avatar(entree: number): AvatarPreRempli {
  return { id: identifiant(), manifId: ID_MANIF_DEMO, entree: new Date(entree), apparence: apparenceDeLaFoule(), pancarte: pancarteAuHasard() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await assurerBase(URL_BASE_DEV);
  const sql = connecter(URL_BASE_DEV);
  await migrer(sql);
  await semerManifDemo(sql, DOSSIER_PUBLICATION_DEV);
  await sql.end();
  console.log(`Manif « ${ID_MANIF_DEMO} » semée.`);
}
