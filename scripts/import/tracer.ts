/**
 * Étape « tracer » : étapes annoncées → géocodage → points de passage (raccords
 * des rues) → itinéraire piéton → contrôles → GeoJSON relisible et versionné.
 */
import { distanceM, longueurParcours, type Parcours, type Position } from '@petit-cortege/shared';
import {
  controlerTrace,
  demiTours,
  distanceAuTrace,
  echantillonner,
  nettoyerTrace,
  type ZoneGeocodee,
} from './controles';
import { decrireEtape, empreinteTrace, ErreurImport, type ManifDeclaree } from './fichier';
import { geocoder, SERVICES_GEOCODAGE, type LieuGeocode, type ServiceGeocodage } from './geocodage';
import { calculerItineraire, SERVICES_ITINERAIRE, type Itineraire, type ServiceItineraire } from './itineraire';
import { ErreurService, type Reseau } from './reseau';
import { geometriesRues, pointLePlusProche, RACCORD_SIGNALE_M, raccorder, type GeometrieRue } from './rues';

export interface DependancesTrace {
  reseau: Reseau;
  maintenant: () => Date;
  journal: (ligne: string) => void;
  urlsOverpass: string[];
  servicesGeocodage?: ServiceGeocodage[];
  servicesItineraire?: ServiceItineraire[];
}

/** Étape résolue, telle qu'inscrite dans le GeoJSON (relue par le porteur). */
export interface EtapeTracee {
  rang: number;
  genre: 'adresse' | 'rue' | 'position';
  demande: string;
  /** Libellé BAN (ou libellé donné pour une position explicite). */
  libelle: string;
  position: Position;
  score?: number;
  service?: string;
  /** Rue : points où le cortège y entre et en sort (géométrie OSM). */
  entree?: Position;
  sortie?: Position;
}

export interface ProprietesTrace {
  manif: string;
  ville: string;
  parcoursAnnonce: string;
  /** Empreinte des étapes : la publication refuse un tracé dont les étapes ont changé depuis. */
  empreinte: string;
  etapes: EtapeTracee[];
  pointsDePassage: Position[];
  zonesEvitees: { demande: string; libelle: string; position: Position; rayonM: number; distanceAuTraceM: number }[];
  itineraire: {
    service: string;
    versionDonnees?: string;
    distanceAnnonceeM: number;
    /** Tracés d'autres services comparés puis écartés (le premier revenait sur ses pas). */
    ecartes?: { service: string; longueurM: number; demiTours: number; erreurs: string[] }[];
  };
  longueurM: number;
  /** Voies empruntées selon le service d'itinéraire (noms abrégés pour l'IGN). */
  rues: { nom: string; m: number }[];
  avertissements: string[];
  calculeLe: string;
  attribution: string[];
  licence: string;
}

export interface ManifTracee {
  type: 'Feature';
  properties: ProprietesTrace;
  geometry: Parcours;
}

/** Deux points de passage plus proches que ça sont confondus. */
const POINTS_CONFONDUS_M = 5;

type Resolue = { etape: EtapeTracee; rue?: { geocode: LieuGeocode; geometrie?: GeometrieRue } };

export async function tracerManif(manif: ManifDeclaree, deps: DependancesTrace): Promise<ManifTracee> {
  const quoi = (rang: number) => `manif « ${manif.id} », étape n° ${rang + 1}`;
  const services = deps.servicesGeocodage ?? SERVICES_GEOCODAGE;
  const attribution = new Set<string>();

  // 1. Géocodage, une étape après l'autre (pas de rafale vers les services publics).
  const resolues: Resolue[] = [];
  for (const [rang, etape] of manif.etapes.entries()) {
    const base = { rang: rang + 1, demande: decrireEtape(etape) };
    if ('position' in etape) {
      resolues.push({ etape: { ...base, genre: 'position', libelle: etape.libelle, position: etape.position } });
      continue;
    }
    const requete = 'adresse' in etape ? etape.adresse : `${etape.rue}, ${manif.ville}`;
    const lieu = await geocoder(deps.reseau, requete, manif.ville, quoi(rang), services);
    attribution.add('Adresses : Base Adresse Nationale, via la Géoplateforme IGN (Licence Ouverte 2.0)');
    const etapeTracee: EtapeTracee = {
      ...base,
      genre: 'adresse' in etape ? 'adresse' : 'rue',
      libelle: lieu.libelle,
      position: lieu.position,
      score: lieu.score,
      service: lieu.service,
    };
    if ('rue' in etape) {
      if (lieu.type !== 'street') {
        throw new ErreurImport(
          `${quoi(rang)} : « ${etape.rue} » donne « ${lieu.libelle} », qui n'est pas une voie (${lieu.type}).`,
        );
      }
      resolues.push({ etape: etapeTracee, rue: { geocode: lieu } });
    } else {
      resolues.push({ etape: etapeTracee });
    }
    deps.journal(`  ${rang + 1}. ${base.demande} → ${lieu.libelle} (score ${lieu.score})`);
  }

  // 2. Géométrie OSM des rues annoncées.
  const rues = resolues.filter((r) => r.rue);
  if (rues.length > 0) {
    const geometries = await geometriesRues(
      deps.reseau,
      deps.urlsOverpass,
      rues.map((r) => r.rue!.geocode.nom),
      rues.map((r) => r.rue!.geocode.position),
      resolues.map((r) => r.etape.position),
      (i) => quoi(rues[i]!.etape.rang - 1),
      deps.journal,
    );
    rues.forEach((r, i) => (r.rue!.geometrie = geometries[i]!));
    attribution.add('Géométrie des rues annoncées : © les contributeurs d’OpenStreetMap (ODbL), via Overpass');
  }

  // 3. Points de passage : chaque lieu, et pour chaque rue son entrée et sa sortie.
  const avertissements: string[] = [];
  const points: Position[] = [];
  const ajouter = (p: Position) => {
    if (!points.length || distanceM(points.at(-1)!, p) >= POINTS_CONFONDUS_M) points.push(p);
  };
  for (const [i, { etape, rue }] of resolues.entries()) {
    const geometrie = rue?.geometrie;
    if (!geometrie) {
      ajouter(etape.position);
      continue;
    }
    const avant = resolues[i - 1]!;
    const apres = resolues[i + 1]!;
    const raccord = (a: GeometrieRue, b: GeometrieRue, reference: Position) => {
      const r = raccorder(a, b, reference);
      if (r.ecartM > RACCORD_SIGNALE_M) {
        avertissements.push(
          `« ${a.nom} » et « ${b.nom} » ne se croisent pas : raccord non annoncé de ${Math.round(r.ecartM)} m entre elles.`,
        );
      }
      return r;
    };
    const entree = avant.rue?.geometrie
      ? raccord(avant.rue.geometrie, geometrie, points.at(-1) ?? etape.position).entreeB
      : pointLePlusProche(geometrie, avant.etape.position);
    const sortie = apres.rue?.geometrie
      ? raccorder(geometrie, apres.rue.geometrie, entree).sortieA
      : pointLePlusProche(geometrie, apres.etape.position);
    etape.entree = entree;
    etape.sortie = sortie;
    ajouter(entree);
    ajouter(sortie);
  }
  if (points.length < 2) throw new ErreurImport(`manif « ${manif.id} » : moins de deux points de passage distincts.`);

  // 4. Zones à éviter.
  const zones: ZoneGeocodee[] = [];
  for (const [i, zone] of manif.zonesEvitees.entries()) {
    const lieu = await geocoder(
      deps.reseau,
      zone.adresse,
      manif.ville,
      `manif « ${manif.id} », zone évitée n° ${i + 1}`,
      services,
    );
    zones.push({ nom: lieu.nom, libelle: lieu.libelle, position: lieu.position, rayonM: zone.rayonM });
  }

  // 5. Itinéraire piéton, puis contrôles. Si le tracé du premier service revient
  // sur ses pas (accroche d'un point d'étape au mauvais tronçon du graphe), les
  // services suivants sont essayés aussi et le meilleur tracé est gardé.
  const servicesIti = deps.servicesItineraire ?? SERVICES_ITINERAIRE;
  const evaluer = (itineraire: Itineraire) => {
    const parcours: Parcours = { type: 'LineString', coordinates: nettoyerTrace(itineraire.coordonnees) };
    const constat = controlerTrace({ parcours, points, rues: itineraire.rues, zones });
    return {
      itineraire,
      parcours,
      constat,
      demiTours: demiTours(parcours.coordinates).length,
      longueur: longueurParcours(parcours),
    };
  };
  const premier = evaluer(
    await calculerItineraire(deps.reseau, points, `manif « ${manif.id} »`, deps.journal, servicesIti),
  );
  const candidats = [premier];
  if (premier.demiTours > 0 || premier.constat.erreurs.length > 0) {
    for (const service of servicesIti.filter((s) => s.nom !== premier.itineraire.service)) {
      deps.journal(`  ${premier.itineraire.service} : tracé douteux, comparaison avec ${service.nom}…`);
      try {
        candidats.push(evaluer(await service.calculer(deps.reseau, points)));
      } catch (e) {
        if (!(e instanceof ErreurService)) throw e;
        deps.journal(`  ${service.nom} indisponible (${e.message}).`);
      }
    }
  }
  const rang = (c: (typeof candidats)[number]) => [c.constat.erreurs.length, c.demiTours, c.longueur];
  const meilleur = candidats.reduce((m, c) => {
    const [a, b] = [rang(c), rang(m)];
    const i = a.findIndex((x, k) => x !== b[k]);
    return i >= 0 && a[i]! < b[i]! ? c : m;
  });
  const { itineraire, parcours, constat } = meilleur;
  attribution.add(`Itinéraire : ${itineraire.attribution}`);
  if (constat.erreurs.length > 0) {
    throw new ErreurImport(
      `manif « ${manif.id} » : tracé refusé (${itineraire.service}) :\n  - ${constat.erreurs.join('\n  - ')}`,
    );
  }
  const ecartes = candidats
    .filter((c) => c !== meilleur)
    .map((c) => ({
      service: c.itineraire.service,
      longueurM: Math.round(c.longueur),
      demiTours: c.demiTours,
      erreurs: c.constat.erreurs,
    }));
  const echantillons = echantillonner(parcours);
  return {
    type: 'Feature',
    properties: {
      manif: manif.id,
      ville: manif.ville,
      parcoursAnnonce: manif.parcoursAnnonce,
      empreinte: empreinteTrace(manif),
      etapes: resolues.map((r) => r.etape),
      pointsDePassage: points,
      zonesEvitees: zones.map((z, i) => ({
        demande: manif.zonesEvitees[i]!.adresse,
        libelle: z.libelle,
        position: z.position,
        rayonM: z.rayonM,
        distanceAuTraceM: Math.round(distanceAuTrace(echantillons, z.position)),
      })),
      itineraire: {
        service: itineraire.service,
        ...(itineraire.versionDonnees ? { versionDonnees: itineraire.versionDonnees } : {}),
        distanceAnnonceeM: Math.round(itineraire.distanceM),
        ...(ecartes.length ? { ecartes } : {}),
      },
      longueurM: Math.round(longueurParcours(parcours)),
      rues: itineraire.rues,
      avertissements: [...avertissements, ...constat.avertissements],
      calculeLe: deps.maintenant().toISOString(),
      attribution: [...attribution],
      licence:
        'Tracé calculé, dérivé de données sous Licence Ouverte 2.0 (IGN, BAN) et, le cas échéant, ODbL (OpenStreetMap)',
    },
    geometry: parcours,
  };
}
