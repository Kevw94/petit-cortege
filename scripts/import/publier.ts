/**
 * Étape « publier » : relit les tracés versionnés (sans réseau) et crée les
 * manifs en base comme `npm run moderation -- creer-manif`, de façon
 * idempotente. Refuse une manif dont la vérification humaine (ADR 0003) n'est
 * pas remplie, ou dont le tracé ne correspond plus aux étapes du fichier.
 */
import { ajouterManif, ErreurModeration, lireParcoursGeoJson, publier, type Horloge, type Sql } from '@petit-cortege/server';
import { lireHeure } from '../moderation';
import { empreinteTrace, type JourneeDeclaree, type ManifDeclaree } from './fichier';

export interface DependancesPublier {
  sql: Sql;
  horloge: Horloge;
  dossierPublication: string;
  journal: (ligne: string) => void;
  /** Contenu JSON du tracé d'une manif (`donnees/manifs/<jour>/<id>.geojson`), ou `null` s'il n'existe pas. */
  lireTrace: (id: string) => Promise<unknown | null>;
}

export interface BilanPublication {
  creees: string[];
  dejaCreees: string[];
  refusees: { id: string; motif: string }[];
}

/** Ce qui manque à la vérification humaine, ou `null` si elle est complète. */
export function verificationIncomplete(manif: ManifDeclaree): string | null {
  const manque = [
    manif.verifie.declaree ? null : 'déclaration en préfecture (verifie.declaree)',
    manif.verifie.sansInterdiction ? null : "absence d'arrêté d'interdiction (verifie.sansInterdiction)",
  ].filter((x): x is string => x !== null);
  return manque.length ? `vérification humaine à faire : ${manque.join(', ')} (ADR 0003).` : null;
}

export async function publierJournee(journee: JourneeDeclaree, deps: DependancesPublier, seulement?: string[]): Promise<BilanPublication> {
  const bilan: BilanPublication = { creees: [], dejaCreees: [], refusees: [] };
  const refuser = (id: string, motif: string) => {
    bilan.refusees.push({ id, motif });
    deps.journal(`Refusée : ${id} : ${motif}`);
  };
  for (const manif of journee.manifs) {
    if (seulement && !seulement.includes(manif.id)) continue;
    if (manif.aVerifier) {
      refuser(manif.id, `marquée « aVerifier » : ${manif.aVerifier}`);
      continue;
    }
    const [existante] = await deps.sql<{ id: string }[]>`select id from manif where id = ${manif.id}`;
    if (existante) {
      bilan.dejaCreees.push(manif.id);
      deps.journal(`Déjà créée : ${manif.id} (sautée).`);
      continue;
    }
    const incomplete = verificationIncomplete(manif);
    if (incomplete) {
      refuser(manif.id, incomplete);
      continue;
    }
    const trace = (await deps.lireTrace(manif.id)) as { properties?: { empreinte?: unknown } } | null;
    if (trace === null) {
      refuser(manif.id, `pas de tracé : lancer d'abord « tracer ».`);
      continue;
    }
    if (trace.properties?.empreinte !== empreinteTrace(manif)) {
      refuser(manif.id, `le tracé ne correspond plus aux étapes du fichier du jour : relancer « tracer » et le relire.`);
      continue;
    }
    try {
      await ajouterManif(deps.sql, deps.horloge, {
        id: manif.id,
        intitule: manif.intitule,
        ville: manif.ville,
        depart: lireHeure(manif.depart, 'départ'),
        ...(manif.ouverture ? { ouverture: lireHeure(manif.ouverture, 'ouverture') } : {}),
        parcours: lireParcoursGeoJson(trace),
        sources: manif.sources,
      });
    } catch (e) {
      if (!(e instanceof ErreurModeration)) throw e;
      refuser(manif.id, e.message);
      continue;
    }
    bilan.creees.push(manif.id);
    deps.journal(`Créée : ${manif.id}.`);
  }
  if (bilan.creees.length > 0) {
    await publier(deps);
    deps.journal(`Publié (${bilan.creees.length} manif${bilan.creees.length > 1 ? 's' : ''} ajoutée${bilan.creees.length > 1 ? 's' : ''}).`);
  }
  return bilan;
}
