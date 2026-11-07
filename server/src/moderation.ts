import { calculerFin, longueurParcours, type Parcours, type Source } from '@petit-cortege/shared';
import type { Sql } from './base';
import type { Horloge } from './horloge';
import { creerManif } from './manifs';

/** Refus d'une action de modération, avec un message lisible par le modérateur. */
export class ErreurModeration extends Error {
  override name = 'ErreurModeration';
}

/** Identifiant de manif : visible dans le fragment des liens partagés (ADR 0002), donc court et lisible. */
export const FORMAT_ID_MANIF = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface SaisieManif {
  id: string;
  intitule: string;
  ville: string;
  depart: Date;
  /** Début des entrées ; par défaut, tout de suite (au plus tard au départ). */
  ouverture?: Date;
  parcours: Parcours;
  sources: Source[];
}

const estUrlWeb = (url: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** Saisie d'une manif à la main par le modérateur (story 52). */
export async function ajouterManif(sql: Sql, horloge: Horloge, saisie: SaisieManif): Promise<void> {
  const maintenant = horloge.maintenant();
  const ouverture = saisie.ouverture ?? (maintenant < saisie.depart ? maintenant : saisie.depart);
  if (!FORMAT_ID_MANIF.test(saisie.id)) {
    throw new ErreurModeration(`identifiant « ${saisie.id} » invalide (minuscules, chiffres et tirets).`);
  }
  if (!saisie.intitule.trim() || !saisie.ville.trim()) throw new ErreurModeration('intitulé et ville obligatoires.');
  if (saisie.sources.length === 0) {
    throw new ErreurModeration('au moins une source publique est obligatoire (organisateurs, préfecture).');
  }
  for (const source of saisie.sources) {
    if (!source.libelle.trim() || !estUrlWeb(source.url)) {
      throw new ErreurModeration(`source « ${source.libelle} » invalide : un libellé et une URL http(s).`);
    }
  }
  if (ouverture > saisie.depart) throw new ErreurModeration("l'ouverture des entrées doit précéder le départ.");
  if (calculerFin(saisie.depart, longueurParcours(saisie.parcours)) <= maintenant) {
    throw new ErreurModeration('cette manif serait déjà terminée (départ + parcours + marge dans le passé).');
  }

  try {
    await creerManif(sql, {
      id: saisie.id,
      intitule: saisie.intitule.trim(),
      ville: saisie.ville.trim(),
      ouverture,
      depart: saisie.depart,
      parcours: saisie.parcours,
      sources: saisie.sources.map((s) => ({ libelle: s.libelle.trim(), url: s.url })),
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw new ErreurModeration(`la manif « ${saisie.id} » existe déjà (choisir un autre --id).`);
    }
    throw e;
  }
}
