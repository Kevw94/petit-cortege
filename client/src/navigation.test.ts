import { describe, expect, it, vi } from 'vitest';
import { creerNavigation, VuePerimee } from './navigation';

/** Promesse résolue à la main par le test (réponse réseau lente). */
function differee<T>() {
  let resoudre!: (valeur: T) => void;
  const promesse = new Promise<T>((r) => (resoudre = r));
  return { promesse, resoudre };
}

describe('navigation : une vue quittée ne touche plus à la page', () => {
  it('une attente terminée après une nouvelle navigation est abandonnée (VuePerimee)', async () => {
    const navigation = creerNavigation();
    const lente = differee<string>();
    const vueA = navigation.nouvelleVue();
    const attenteA = vueA.attendre(lente.promesse);

    const vueB = navigation.nouvelleVue();
    lente.resoudre('liste');

    await expect(attenteA).rejects.toBeInstanceOf(VuePerimee);
    expect(vueA.courante).toBe(false);
    await expect(vueB.attendre(Promise.resolve('manif'))).resolves.toBe('manif');
  });

  it('les arrêts enregistrés par une vue (minuteries…) sont appelés quand on la quitte, même enregistrés trop tard', () => {
    const navigation = creerNavigation();
    const vueA = navigation.nouvelleVue();
    const arretA = vi.fn();
    vueA.surQuitter(arretA);

    const vueB = navigation.nouvelleVue();
    expect(arretA).toHaveBeenCalledTimes(1);

    // Enregistré après qu'on l'a quittée (fin d'un await périmé) : arrêté aussitôt.
    const tardif = vi.fn();
    vueA.surQuitter(tardif);
    expect(tardif).toHaveBeenCalledTimes(1);
    expect(vueB.courante).toBe(true);
  });
});
