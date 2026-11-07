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

/** Nouveau départ : une heure donnée, ou un décalage en minutes (négatif = avancé). */
export type NouveauDepart = { a: Date } | { deMinutes: number };

/**
 * Corrige le départ d'une manif, avant ou pendant la marche (stories 53-54) :
 * la fin est recalculée, et la liste publiée (cache court) propage la correction.
 */
export async function decalerDepart(
  sql: Sql,
  horloge: Horloge,
  id: string,
  nouveau: NouveauDepart,
): Promise<{ depart: Date; fin: Date }> {
  return sql.begin(async (tx) => {
    const maintenant = horloge.maintenant();
    const [manif] = await tx<{ ouverture: Date; depart: Date; parcours: Parcours }[]>`
      select ouverture, depart, parcours from manif where id = ${id} for update`;
    if (!manif) throw new ErreurModeration(`manif « ${id} » inconnue.`);
    const longueurM = longueurParcours(manif.parcours);
    if (calculerFin(manif.depart, longueurM) <= maintenant) {
      throw new ErreurModeration(`la manif « ${id} » est terminée : son départ ne peut plus être corrigé.`);
    }
    const depart = 'a' in nouveau ? nouveau.a : new Date(manif.depart.getTime() + nouveau.deMinutes * 60_000);
    const fin = calculerFin(depart, longueurM);
    if (depart < manif.ouverture) {
      throw new ErreurModeration(`le départ ne peut pas précéder l'ouverture des entrées (${manif.ouverture.toISOString()}).`);
    }
    if (fin <= maintenant) throw new ErreurModeration('avec ce départ, la manif serait déjà terminée.');
    await tx`update manif set depart = ${depart} where id = ${id}`;
    return { depart, fin };
  });
}
