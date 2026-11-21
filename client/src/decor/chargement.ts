/**
 * Chargement du décor d'une manif (tilemap OSM, ODbL).
 *
 * ADR 0002 : demander « le décor de cette manif » révélerait la manif
 * consultée. On demande donc l'index puis tous les décors qu'il liste, dans le
 * même ordre pour tout le monde (1 à 3 décors en V1, mis en cache), et on garde
 * celui dont l'emprise couvre le parcours.
 */
import {
  CHEMIN_INDEX_DECORS,
  decorDuParcours,
  lireDecor,
  lireIndexDecors,
  type CarteTiled,
  type Decor,
  type Position,
} from '@petit-cortege/shared';

export const PREFIXE_DECORS = '/decors/';

type Charger = (url: string) => Promise<Response>;

export async function chargerDecor(
  parcours: Position[],
  charger: Charger = (url) => fetch(url),
): Promise<Decor | null> {
  try {
    const reponseIndex = await charger(PREFIXE_DECORS + CHEMIN_INDEX_DECORS);
    if (!reponseIndex.ok) return null;
    const index = lireIndexDecors(await reponseIndex.json());
    const reponses = await Promise.all(index.decors.map((d) => charger(PREFIXE_DECORS + d.fichier)));
    const choisi = decorDuParcours(index, parcours);
    if (!choisi) return null;
    const reponse = reponses[index.decors.indexOf(choisi)]!;
    if (!reponse.ok) return null;
    return await lireDecor((await reponse.json()) as CarteTiled);
  } catch (erreur) {
    console.warn('Décor indisponible :', erreur);
    return null;
  }
}
