/**
 * Préférence de son (activé ou coupé), mémorisée sur l'appareil seulement (localStorage,
 * jamais envoyée au serveur). Son activé par défaut ; une valeur illisible ou un stockage
 * bloqué (navigation privée) ne cassent rien : on retombe sur le défaut.
 */
import type { StockageModeVue } from '../vue3d/mode-vue';

const CLE = 'petit-cortege.son';

export type StockageSon = StockageModeVue;

/** Vrai si le son est activé (défaut), faux s'il a été coupé sur cet appareil. */
export function lireSonActive(stockage: StockageSon | undefined): boolean {
  try {
    return stockage?.getItem(CLE) !== 'coupe';
  } catch {
    return true;
  }
}

export function memoriserSonActive(actif: boolean, stockage: StockageSon | undefined): void {
  try {
    stockage?.setItem(CLE, actif ? 'actif' : 'coupe');
  } catch {
    // Choix non mémorisé : le son reviendra activé à la prochaine visite.
  }
}
