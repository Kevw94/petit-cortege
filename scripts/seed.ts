/**
 * Seed de dev : (re)crée une manif pré-remplie dont le départ est dans
 * 2 minutes, avec des avatars déjà entrés et des retardataires à venir.
 * Usage : `npm run seed` (aussi lancé par `npm run dev`).
 */
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { connecter, creerManif, migrer, preRemplirAvatars, type AvatarPreRempli, type Sql } from '@petit-cortege/server';
import { assurerBase, DOSSIER_PUBLICATION_DEV, URL_BASE_DEV } from './config';

export const ID_MANIF_DEMO = 'demo-republique-nation';

const MINUTE = 60_000;
const identifiant = () => randomBytes(9).toString('base64url');
const auHasard = (n: number) => Math.floor(Math.random() * n);

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
    // République → Nation par le boulevard Voltaire (≈ 3 km), tracé à la main.
    parcours: {
      type: 'LineString',
      coordinates: [
        [2.3634, 48.8673],
        [2.3683, 48.8649],
        [2.3755, 48.8613],
        [2.3805, 48.8578],
        [2.3846, 48.8549],
        [2.3905, 48.8513],
        [2.3959, 48.8483],
      ],
    },
    sources: [{ libelle: 'Source fictive (démo)', url: 'https://example.org/' }],
  });

  const avatars: AvatarPreRempli[] = [];
  // 80 soutiens entrés avant le départ, 60 retardataires sur la première demi-heure.
  for (let i = 0; i < 80; i++) avatars.push(avatar(maintenant - auHasard(30 * MINUTE)));
  for (let i = 0; i < 60; i++) avatars.push(avatar(maintenant + auHasard(30 * MINUTE)));
  await preRemplirAvatars(sql, avatars);
}

function avatar(entree: number): AvatarPreRempli {
  return { id: identifiant(), manifId: ID_MANIF_DEMO, entree: new Date(entree), apparence: auHasard(8), pancarte: auHasard(8) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await assurerBase(URL_BASE_DEV);
  const sql = connecter(URL_BASE_DEV);
  await migrer(sql);
  await semerManifDemo(sql, DOSSIER_PUBLICATION_DEV);
  await sql.end();
  console.log(`Manif « ${ID_MANIF_DEMO} » semée.`);
}
