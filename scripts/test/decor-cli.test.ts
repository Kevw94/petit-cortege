/**
 * Commande `npm run decor -- …` : extraire un extrait OSM (Overpass à une URL
 * configurable, ici un faux serveur local) ou rejouer un fichier JSON local,
 * générer la tilemap et l'index des décors.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireDecor, lireIndexDecors, type CarteTiled } from '@petit-cortege/shared';
import { executerDecor } from '../decor';

const FIXTURES = join(import.meta.dirname, 'fixtures/decor');
const PARCOURS = join(FIXTURES, 'parcours-mini.geojson');
const EXTRAIT = join(FIXTURES, 'extrait-mini.json');

let dossier: string;
let serveur: Server;
let urlOverpass: string;
const requetesRecues: string[] = [];
const sorties: string[] = [];
const executer = (...argv: string[]) =>
  executerDecor(argv, { ecrire: (l) => sorties.push(l), dossierCourant: dossier });
const lireJson = async (chemin: string) => JSON.parse(await readFile(chemin, 'utf8'));

beforeAll(async () => {
  dossier = await mkdtemp(join(tmpdir(), 'pc-decor-'));
  const extrait = await readFile(EXTRAIT, 'utf8');
  // Faux Overpass : répond l'extrait fixture à toute requête POST `data=…`.
  serveur = createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      requetesRecues.push(new URLSearchParams(corps).get('data') ?? '');
      res.writeHead(req.method === 'POST' ? 200 : 405, { 'content-type': 'application/json' }).end(extrait);
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  urlOverpass = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/interpreter`;
});

afterAll(async () => {
  serveur.close();
  await rm(dossier, { recursive: true, force: true });
});

describe('npm run decor', () => {
  it('extrait de l’URL Overpass donnée la bande autour du parcours, et enregistre la réponse brute', async () => {
    await executer('extraire', '--parcours', PARCOURS, '--overpass', urlOverpass, '--sortie', 'extrait.json');
    const requete = requetesRecues.at(-1)!;
    expect(requete).toContain('[out:json]');
    expect(requete).toContain('(around:150,48.87,2.36,48.87,2.365463)');
    expect(requete).toContain('out geom;');
    expect(await readFile(join(dossier, 'extrait.json'), 'utf8')).toBe(await readFile(EXTRAIT, 'utf8'));
  });

  it('génère la tilemap depuis un extrait local, sans réseau, et l’inscrit dans l’index des décors', async () => {
    const avant = requetesRecues.length;
    await executer('tilemap', '--parcours', PARCOURS, '--osm', EXTRAIT, '--sortie', 'decors/mini.json');
    expect(requetesRecues).toHaveLength(avant);
    const decor = await lireDecor((await lireJson(join(dossier, 'decors/mini.json'))) as CarteTiled);
    expect(decor.blocs.size).toBeGreaterThan(0);
    const index = lireIndexDecors(await lireJson(join(dossier, 'decors/index.json')));
    expect(index.decors).toHaveLength(1);
    const [entree] = index.decors;
    expect(entree!.fichier).toBe('mini.json');
    // L'emprise couvre le parcours (2.36 → 2.3655 de longitude, à 48.87 de latitude).
    expect(entree!.emprise[0]).toBeLessThan(2.36);
    expect(entree!.emprise[2]).toBeGreaterThan(2.3655);
    expect(entree!.emprise[1]).toBeLessThan(48.87);
    expect(entree!.emprise[3]).toBeGreaterThan(48.87);
  });

  it('génère aussi la tilemap directement depuis l’URL Overpass, et remplace l’entrée de l’index', async () => {
    const avant = requetesRecues.length;
    await executer(
      'tilemap',
      '--parcours',
      PARCOURS,
      '--overpass',
      urlOverpass,
      '--sortie',
      'decors/mini.json',
      '--alentours-osm',
      'alentours.json',
      '--alentours',
      '300',
    );
    // La bande, puis le plan de la ville (sans bâtiments, un pavé ici), enregistré simplifié.
    expect(requetesRecues.slice(avant)).toEqual([
      expect.stringContaining('around:150'),
      expect.stringContaining('[bbox:'),
    ]);
    expect(requetesRecues.at(-1)).not.toContain('building');
    const alentours = await readFile(join(dossier, 'alentours.json'), 'utf8');
    expect(alentours).not.toContain('"building"');
    const index = lireIndexDecors(await lireJson(join(dossier, 'decors/index.json')));
    expect(index.decors.map((d) => d.fichier)).toEqual(['mini.json']);
    const decor = await lireDecor((await lireJson(join(dossier, 'decors/mini.json'))) as CarteTiled);
    expect(decor.alentours?.tuilesParCase).toBe(2);

    // Rejoué sans réseau depuis les extraits enregistrés.
    const apres = requetesRecues.length;
    await executer(
      'tilemap',
      '--parcours',
      PARCOURS,
      '--osm',
      EXTRAIT,
      '--alentours-osm',
      'alentours.json',
      '--sortie',
      'decors/mini.json',
    );
    expect(requetesRecues).toHaveLength(apres);
    expect(
      (await lireDecor((await lireJson(join(dossier, 'decors/mini.json'))) as CarteTiled)).alentours,
    ).toBeDefined();
  });

  it('trace un parcours le long d’une rue de l’extrait, en GeoJSON', async () => {
    await executer(
      'parcours',
      '--osm',
      EXTRAIT,
      '--rue',
      'Boulevard Test',
      '--depart',
      '2.359,48.87',
      '--arrivee',
      '2.367,48.87',
      '--sortie',
      'parcours.geojson',
    );
    const geojson = await lireJson(join(dossier, 'parcours.geojson'));
    expect(geojson.type).toBe('Feature');
    expect(geojson.geometry.type).toBe('LineString');
    expect(geojson.geometry.coordinates).toHaveLength(2);
  });

  it('refuse une commande sans source OSM', async () => {
    await expect(executer('tilemap', '--parcours', PARCOURS, '--sortie', 'x.json')).rejects.toThrow(
      /--osm ou --overpass/,
    );
  });
});
