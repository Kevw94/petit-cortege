import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('rafraîchissement périodique', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jamais deux chargements en même temps : le suivant part un intervalle après la fin du précédent', async () => {
    const vue = creerNavigation().nouvelleVue();
    const reponses: ReturnType<typeof differee<number>>[] = [];
    const appliques: number[] = [];
    vue.rafraichir({
      intervalleMs: 20_000,
      charger: () => {
        const r = differee<number>();
        reponses.push(r);
        return r.promesse;
      },
      appliquer: (n) => appliques.push(n),
    });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(reponses).toHaveLength(1);
    // Réseau lent : trois intervalles passent, toujours un seul chargement en cours.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reponses).toHaveLength(1);

    reponses[0]!.resoudre(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(appliques).toEqual([1]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reponses).toHaveLength(2);
  });

  it('un résultat arrivé après avoir quitté la vue est ignoré, et plus rien ne repart', async () => {
    const navigation = creerNavigation();
    const vue = navigation.nouvelleVue();
    const charger = vi.fn(() => lente.promesse);
    const lente = differee<number>();
    const appliquer = vi.fn();
    vue.rafraichir({ intervalleMs: 20_000, charger, appliquer });

    await vi.advanceTimersByTimeAsync(20_000);
    navigation.nouvelleVue();
    lente.resoudre(1);
    await vi.advanceTimersByTimeAsync(100_000);

    expect(appliquer).not.toHaveBeenCalled();
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it('un chargement en échec ne casse pas le rafraîchissement', async () => {
    const vue = creerNavigation().nouvelleVue();
    let n = 0;
    const appliquer = vi.fn();
    vue.rafraichir({
      intervalleMs: 20_000,
      charger: async () => {
        n += 1;
        if (n === 1) throw new Error('réseau');
        return n;
      },
      appliquer,
    });

    await vi.advanceTimersByTimeAsync(40_000);

    expect(appliquer).toHaveBeenCalledWith(2);
  });
});
