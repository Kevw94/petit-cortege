import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListeManifs } from '@petit-cortege/shared';
import { demarrerBanc, URL_POSTGRES_ADMIN, type Banc } from '../../server/test/support';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * La commande telle que le modérateur la tape en SSH : `npm run moderation -- …`,
 * depuis le dossier où se trouve son fichier GeoJSON (horloge système).
 */
describe('npm run moderation (sous-processus)', () => {
  let banc: Banc;
  let dossierCourant: string;

  beforeAll(async () => {
    banc = await demarrerBanc(new Date().toISOString());
    dossierCourant = await mkdtemp(join(tmpdir(), 'pc-moderateur-'));
  });
  afterAll(async () => {
    await banc?.arreter();
    await rm(dossierCourant, { recursive: true, force: true });
  });

  async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
    const url = new URL(URL_POSTGRES_ADMIN);
    url.pathname = `/${banc.sql.options.database}`;
    try {
      const { stdout } = await promisify(execFile)(
        'npm',
        ['--prefix', RACINE, 'run', '--silent', 'moderation', '--', ...args],
        {
          cwd: dossierCourant,
          env: { ...process.env, DATABASE_URL: url.toString(), DOSSIER_PUBLICATION: banc.dossierPublication },
        },
      );
      return { code: 0, sortie: stdout };
    } catch (e) {
      const { code, stdout, stderr } = e as { code: number; stdout: string; stderr: string };
      return { code, sortie: stdout + stderr };
    }
  }

  it('créer une manif avec un chemin relatif au dossier courant, puis la retirer', async () => {
    await writeFile(
      join(dossierCourant, 'parcours.geojson'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [4.83, 45.76],
                [4.84, 45.77],
              ],
            },
          },
        ],
      }),
    );
    const demain = new Date(Date.now() + 24 * 3600_000).toISOString();

    const creation = await lancer(
      'creer-manif',
      '--id',
      'lyon-cli',
      '--geojson',
      'parcours.geojson',
      '--intitule',
      'Marche',
      '--ville',
      'Lyon',
      '--depart',
      demain,
      '--source',
      'Préfecture|https://www.rhone.gouv.fr/',
    );

    expect(creation).toMatchObject({ code: 0, sortie: expect.stringMatching(/lyon-cli/) });
    const liste = await banc.lire<ListeManifs>('/publie/manifs.json');
    expect(liste.corps.manifs.map((m) => m.id)).toContain('lyon-cli');

    const retrait = await lancer('retirer-manif', '--manif', 'lyon-cli', '--motif', 'Arrêté');

    expect(retrait.code).toBe(0);
    expect((await banc.lire<ListeManifs>('/publie/manifs.json')).corps.manifs.map((m) => m.id)).not.toContain(
      'lyon-cli',
    );
  });

  it('erreur : code de sortie non nul et message', async () => {
    const resultat = await lancer('decaler-depart', '--manif', 'inconnue', '--minutes', '-10');

    expect(resultat.code).toBe(1);
    expect(resultat.sortie).toMatch(/inconnue/);
  });
});
