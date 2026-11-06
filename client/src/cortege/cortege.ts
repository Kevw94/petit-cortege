/**
 * Le Cortège : fonction pure, sans Phaser ni réseau (ADR 0004).
 * Manif + entrées publiées + heure courante → état de la manif et position de
 * chaque avatar le long du parcours. Tous les clients calculent la même foule.
 */
import { VITESSE_M_PAR_MS, type EntreesMinute, type ManifPubliee } from '@petit-cortege/shared';

export type EtatManif = 'ouverte' | 'terminee';

export interface AvatarDuCortege {
  id: string;
  /** Abscisse le long du parcours, en mètres depuis le départ. */
  distanceM: number;
  apparence: number;
  pancarte: number;
}

export interface Cortege {
  etat: EtatManif;
  avatars: AvatarDuCortege[];
}

export interface EntreesDuCortege {
  manif: ManifPubliee;
  /** Fichiers d'entrées publiés (toutes manifs confondues). */
  entrees: EntreesMinute[];
  maintenant: Date;
}

export function calculerCortege({ manif, entrees, maintenant }: EntreesDuCortege): Cortege {
  const depart = Date.parse(manif.depart);
  const t = maintenant.getTime();
  const avatars: AvatarDuCortege[] = [];
  for (const fichier of entrees) {
    for (const e of fichier.entrees) {
      if (e.m !== manif.id || e.t * 1000 > t) continue;
      const debutMarche = Math.max(e.t * 1000, depart);
      const distanceM = Math.min(manif.longueurM, Math.max(0, t - debutMarche) * VITESSE_M_PAR_MS);
      avatars.push({ id: e.a, distanceM, apparence: e.ap, pancarte: e.pa });
    }
  }
  return { etat: t < Date.parse(manif.fin) ? 'ouverte' : 'terminee', avatars };
}
