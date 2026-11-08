/**
 * Météo des manifs ouvertes (ADR 0008) : relevée par le serveur au départ du parcours, au
 * plus une fois par `RELEVE_METEO_MS` et par manif, puis publiée dans la liste des manifs.
 * Le client ne contacte jamais de service météo : aucun tiers ne voit l'IP d'un soutien à
 * côté du lieu d'une manif (ADR 0002).
 */
import type { MeteoPubliee, Position } from '@petit-cortege/shared';

/** Météo actuelle à une position [lon, lat]. Rejette si la source est injoignable. */
export type SourceMeteo = (position: Position) => Promise<MeteoPubliee>;

/** Intervalle entre deux relevés d'une même manif. */
export const RELEVE_METEO_MS = 15 * 60_000;
/** Après un échec, nouvel essai au bout de ce délai (la dernière météo connue reste publiée). */
const REESSAI_APRES_ECHEC_MS = 2 * 60_000;

interface Releve {
  meteo?: MeteoPubliee;
  /** Heure (ms) à partir de laquelle redemander. */
  prochain: number;
}

export interface ManifAMeteo {
  id: string;
  position: Position;
}

/** Dernière météo connue de chaque manif ouverte. */
export class CacheMeteo {
  readonly #source: SourceMeteo;
  readonly #releves = new Map<string, Releve>();

  constructor(source: SourceMeteo) {
    this.#source = source;
  }

  /**
   * Relève la météo des manifs dont le relevé est périmé (en parallèle) et oublie celles qui
   * ne sont plus ouvertes. Une source en panne garde la dernière météo connue ; les échecs
   * sont renvoyés dans une `AggregateError` une fois les autres relevés enregistrés.
   */
  async actualiser(manifs: ManifAMeteo[], maintenant: Date): Promise<void> {
    const t = maintenant.getTime();
    const ouvertes = new Set(manifs.map((m) => m.id));
    for (const id of this.#releves.keys()) if (!ouvertes.has(id)) this.#releves.delete(id);
    const echecs: unknown[] = [];
    await Promise.all(
      manifs
        .filter((m) => (this.#releves.get(m.id)?.prochain ?? 0) <= t)
        .map(async ({ id, position }) => {
          const precedent = this.#releves.get(id);
          try {
            this.#releves.set(id, { meteo: await this.#source(position), prochain: t + RELEVE_METEO_MS });
          } catch (e) {
            echecs.push(e);
            this.#releves.set(id, { ...(precedent?.meteo ? { meteo: precedent.meteo } : {}), prochain: t + REESSAI_APRES_ECHEC_MS });
          }
        }),
    );
    if (echecs.length > 0) throw new AggregateError(echecs, 'Météo indisponible');
  }

  lire(id: string): MeteoPubliee | undefined {
    return this.#releves.get(id)?.meteo;
  }
}
