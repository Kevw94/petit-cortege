import { describe, expect, it } from 'vitest';
import { arriveeDeLaTete, calculerFin, debutDeLaDanse, DUREE_DANSE_MS, RETARD_MAX_QUEUE_MS, retardDeLaQueueMs } from './horaire';

const depart = new Date('2026-05-01T14:00:00Z');
// 1000 m à 2 km/h : 30 min.
const arrivee = Date.parse('2026-05-01T14:30:00Z');

describe('Horaire de la manif', () => {
  it("la tête arrive au bout du parcours à 2 km/h : c'est la fermeture des entrées", () => {
    expect(arriveeDeLaTete(depart, 1000).getTime()).toBe(arrivee);
  });

  it('la queue suit à 2 m par rangée de 5 (3,6 s par rangée)', () => {
    expect(retardDeLaQueueMs(0)).toBe(0);
    expect(retardDeLaQueueMs(5)).toBe(0);
    expect(retardDeLaQueueMs(6)).toBeCloseTo(3600, 6);
    expect(retardDeLaQueueMs(500)).toBeCloseTo(99 * 3600, 6);
  });

  it("au-delà d'une heure de retard de la queue, tout le cortège est considéré arrivé", () => {
    expect(retardDeLaQueueMs(100_000)).toBe(RETARD_MAX_QUEUE_MS);
  });

  it('fin = arrivée de la queue + 10 min de danse', () => {
    expect(calculerFin(depart, 1000, 3).getTime()).toBe(arrivee + DUREE_DANSE_MS);
    expect(calculerFin(depart, 1000, 500).getTime()).toBeCloseTo(arrivee + 99 * 3600 + DUREE_DANSE_MS, 6);
    expect(calculerFin(depart, 1000, 100_000).getTime()).toBe(arrivee + RETARD_MAX_QUEUE_MS + DUREE_DANSE_MS);
  });

  it('la danse commence 10 min avant la fin', () => {
    const fin = calculerFin(depart, 1000, 3);
    expect(debutDeLaDanse(fin).getTime()).toBe(arrivee);
  });
});
