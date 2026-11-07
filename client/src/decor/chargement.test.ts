import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Position } from '@petit-cortege/shared';
import { chargerDecor } from './chargement';

// Décor publié de la démo (République → Nation) et son parcours.
const RACINE = join(import.meta.dirname, '../../..');
const DECOR = join(RACINE, 'client/public/decors/republique-nation.json');
const lireParcours = async (): Promise<Position[]> =>
  JSON.parse(await readFile(join(RACINE, 'donnees/osm/republique-nation/parcours.geojson'), 'utf8')).geometry.coordinates;

/** Faux serveur statique : un index à deux décors, et le journal des URL demandées. */
function fauxServeur() {
  const demandees: string[] = [];
  const index = {
    v: 1,
    decors: [
      { fichier: 'lyon.json', emprise: [4.8, 45.7, 4.9, 45.8] },
      { fichier: 'republique-nation.json', emprise: [2.3637, 48.8478, 2.3967, 48.8677] },
    ],
  };
  const charger = async (url: string) => {
    demandees.push(url);
    if (url === '/decors/index.json') return new Response(JSON.stringify(index));
    if (url === '/decors/republique-nation.json') return new Response(await readFile(DECOR));
    if (url === '/decors/lyon.json') return new Response('{"type":"map"}');
    return new Response('', { status: 404 });
  };
  return { demandees, charger };
}

describe('chargement du décor d’une manif', () => {
  it('choisit le décor qui couvre le parcours', async () => {
    const { charger } = fauxServeur();
    const decor = await chargerDecor(await lireParcours(), charger);
    expect(decor).not.toBeNull();
    expect(decor!.blocs.size).toBeGreaterThan(100);
  });

  it('demande l’index puis tous les décors listés, quelle que soit la manif (ADR 0002)', async () => {
    const paris = fauxServeur();
    await chargerDecor(await lireParcours(), paris.charger);
    const ailleurs = fauxServeur();
    await chargerDecor([[5.37, 43.29], [5.38, 43.3]], ailleurs.charger);
    expect(paris.demandees).toEqual(['/decors/index.json', '/decors/lyon.json', '/decors/republique-nation.json']);
    expect(ailleurs.demandees).toEqual(paris.demandees);
  });

  it('se passe de décor si aucun ne couvre le parcours, ou si l’index est introuvable', async () => {
    expect(await chargerDecor([[5.37, 43.29], [5.38, 43.3]], fauxServeur().charger)).toBeNull();
    expect(await chargerDecor(await lireParcours(), async () => new Response('', { status: 404 }))).toBeNull();
  });
});
