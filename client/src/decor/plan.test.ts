import { describe, expect, it } from 'vitest';
import type { Position } from '@petit-cortege/shared';
import { chargerPlan } from './plan';

const PARIS: Position[] = [
  [2.365, 48.86],
  [2.39, 48.85],
];

/** Faux serveur statique : un index à deux décors, dont deux avec plan, et le journal des URL demandées. */
function fauxServeur() {
  const demandees: string[] = [];
  const plan = (fichier: string) => ({ fichier, origine: [0, 0], metresParPixel: 4, largeur: 10, hauteur: 10 });
  const index = {
    v: 1,
    decors: [
      { fichier: 'lyon.json', emprise: [4.8, 45.7, 4.9, 45.8], plan: plan('lyon-plan.png') },
      { fichier: 'sans-plan.json', emprise: [1, 43, 1.1, 43.1] },
      { fichier: 'republique-nation.json', emprise: [2.3637, 48.8478, 2.3967, 48.8677], plan: plan('republique-nation-plan.png') },
    ],
  };
  const charger = async (url: string) => {
    demandees.push(url);
    if (url === '/decors/index.json') return new Response(JSON.stringify(index));
    if (url.endsWith('.png')) return new Response(new Blob([url], { type: 'image/png' }));
    return new Response('', { status: 404 });
  };
  return { demandees, charger };
}

describe('chargement du plan de la ville', () => {
  it('choisit le plan du décor qui couvre le parcours', async () => {
    const charge = await chargerPlan(PARIS, fauxServeur().charger);
    expect(charge?.plan.fichier).toBe('republique-nation-plan.png');
    expect(await charge!.image.text()).toBe('/decors/republique-nation-plan.png');
  });

  it('demande l’index puis tous les plans listés, quelle que soit la manif (ADR 0002)', async () => {
    const paris = fauxServeur();
    await chargerPlan(PARIS, paris.charger);
    const ailleurs = fauxServeur();
    await chargerPlan([[5.37, 43.29]], ailleurs.charger);
    expect(paris.demandees).toEqual(['/decors/index.json', '/decors/lyon-plan.png', '/decors/republique-nation-plan.png']);
    expect(ailleurs.demandees).toEqual(paris.demandees);
  });

  it('se passe de plan si aucun décor ne couvre le parcours, ou si son plan est introuvable', async () => {
    expect(await chargerPlan([[5.37, 43.29]], fauxServeur().charger)).toBeNull();
    expect(await chargerPlan([[1.05, 43.05]], fauxServeur().charger)).toBeNull();
    expect(await chargerPlan(PARIS, async () => new Response('', { status: 404 }))).toBeNull();
  });
});
