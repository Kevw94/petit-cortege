/**
 * Étape « decors » : pour chaque manif tracée, extrait OSM brut de la bande
 * autour du parcours et extrait simplifié de ses alentours (Overpass, serveurs
 * essayés dans l'ordre ; enregistrés dans `donnees/osm/<id>/` pour rejouer sans
 * réseau) puis tilemap du décor dans
 * `client/public/decors/<id>.json`, inscrite dans `index.json` (ODbL).
 */
import { join, relative } from 'node:path';
import { COUCHE_PLACES, type CarteTiled, type CoucheObjetsTiled, type Parcours, type Position } from '@petit-cortege/shared';
import { inscrireDansIndex } from '../decor';
import { DEMI_LARGEUR_PAR_DEFAUT_M, genererDecor } from '../decor/carte';
import { lireExtrait, type ExtraitOverpass } from '../decor/osm';
import { RAYON_EXTRACTION_M, requeteBande } from '../decor/overpass';
import { reduireExtrait, texteExtrait } from '../decor/reduction';
import { cacheDePaves, telechargerPlan, texteExtraitAlentours } from '../decor/alentours';
import { echantillonner, nomDeVoie } from './controles';
import type { ManifDeclaree } from './fichier';
import { interrogerOverpass } from './overpass';
import type { Reseau } from './reseau';

/**
 * Extrait simplifié du plan de la ville, dans `donnees/osm/<id>/` (l'ancien
 * `alentours-overpass.json`, 700 m autour du parcours, n'est plus lu).
 */
export const FICHIER_PLAN = 'plan-overpass.json';

export interface DependancesDecors {
  reseau: Reseau;
  urlsOverpass: string[];
  journal: (ligne: string) => void;
  racine: string;
  /** Dossier des décors publiés (défaut : client/public/decors). */
  dossierDecors: string;
  lire: (chemin: string) => Promise<string | null>;
  ecrireFichier: (chemin: string, contenu: string) => Promise<void>;
  /** Retélécharger l'extrait OSM même s'il est déjà enregistré. */
  rafraichir?: boolean;
  /** Pause entre deux pavés du plan (ms) ; défaut : PAUSE_ENTRE_PAVES_MS. */
  pauseEntrePavesMs?: number;
}

export interface DecorGenere {
  id: string;
  octetsExtrait: number;
  octetsAlentours: number;
  octetsDecor: number;
  places: string[];
  /** Zones à éviter dans l'emprise OSM desquelles le parcours entre (doit rester vide). */
  zonesTraversees: string[];
}

export async function genererDecorManif(manif: ManifDeclaree, parcours: Parcours, deps: DependancesDecors): Promise<DecorGenere> {
  const cheminExtrait = join(deps.racine, 'donnees/osm', manif.id, 'extrait-overpass.json');
  let texte = deps.rafraichir ? null : await deps.lire(cheminExtrait);
  if (texte === null) {
    deps.journal(`  extrait OSM de la bande de ${RAYON_EXTRACTION_M} m autour du parcours…`);
    const reponse = await interrogerOverpass(deps.reseau, deps.urlsOverpass, requeteBande(parcours, RAYON_EXTRACTION_M), deps.journal);
    const reduit = reduireExtrait(reponse.extrait);
    texte = texteExtrait(reduit);
    await deps.ecrireFichier(cheminExtrait, texte);
    deps.journal(`  extrait de ${new URL(reponse.url).host} : ${reponse.extrait.elements.length} éléments OSM, ${reduit.elements.length} gardés.`);
  } else {
    deps.journal(`  extrait OSM déjà enregistré (${relative(deps.racine, cheminExtrait)}), rejoué sans réseau.`);
  }
  const osm = JSON.parse(texte) as ExtraitOverpass;
  const cheminAlentours = join(deps.racine, 'donnees/osm', manif.id, FICHIER_PLAN);
  let texteAlentours = deps.rafraichir ? null : await deps.lire(cheminAlentours);
  if (texteAlentours === null) {
    deps.journal('  extrait OSM du plan de la ville (carré couvrant le dézoom maximal, sans bâtiments, par pavés)…');
    const plan = await telechargerPlan(
      parcours,
      (requete) => interrogerOverpass(deps.reseau, deps.urlsOverpass, requete, deps.journal),
      deps.journal,
      { pauseMs: deps.pauseEntrePavesMs, cache: deps.rafraichir ? undefined : cacheDePaves(cheminAlentours) },
    );
    texteAlentours = texteExtraitAlentours(plan);
    await deps.ecrireFichier(cheminAlentours, texteAlentours);
    deps.journal(`  plan : ${plan.elements.length} objets gardés.`);
  } else {
    deps.journal(`  plan de la ville déjà enregistré (${relative(deps.racine, cheminAlentours)}), rejoué sans réseau.`);
  }
  const sortie = join(deps.dossierDecors, `${manif.id}.json`);
  const carte = genererDecor({
    osm,
    parcours,
    demiLargeurM: DEMI_LARGEUR_PAR_DEFAUT_M,
    alentours: { osm: JSON.parse(texteAlentours) as ExtraitOverpass },
    dossierKenney: relative(deps.dossierDecors, join(deps.racine, 'assets/kenney')).split('\\').join('/'),
  });
  const contenu = `${JSON.stringify(carte)}\n`;
  await deps.ecrireFichier(sortie, contenu);
  await inscrireDansIndex(join(deps.dossierDecors, 'index.json'), `${manif.id}.json`, carte, parcours, DEMI_LARGEUR_PAR_DEFAUT_M, deps.ecrireFichier);
  const places = placesDuDecor(carte);
  // Second contrôle des zones à éviter, sur les vraies emprises OSM des places :
  // le tracé ne doit pas y entrer (il peut longer leur bord, par la rue qui les borde).
  const zonesTraversees = zonesEntrees(manif, parcours, osm);
  return {
    id: manif.id,
    octetsExtrait: Buffer.byteLength(texte),
    octetsAlentours: Buffer.byteLength(texteAlentours),
    octetsDecor: Buffer.byteLength(contenu),
    places,
    zonesTraversees,
  };
}

/** Noms des places traversées inscrites dans la carte. */
export function placesDuDecor(carte: CarteTiled): string[] {
  return carte.layers
    .filter((c): c is CoucheObjetsTiled => c.type === 'objectgroup' && c.name === COUCHE_PLACES)
    .flatMap((c) => c.objects.map((o) => o.name));
}

/** Zones à éviter dont l'emprise OSM (surface de même nom) contient un point du tracé. */
export function zonesEntrees(manif: ManifDeclaree, parcours: Parcours, osm: ExtraitOverpass): string[] {
  const echantillons = echantillonner(parcours, 2);
  const objets = lireExtrait(osm).filter((o) => o.anneaux.length > 0 && o.tags.name);
  return manif.zonesEvitees
    .map((z) => z.adresse.split(',')[0]!.trim())
    .filter((nom) =>
      objets.some((o) => nomDeVoie(o.tags.name!) === nomDeVoie(nom) && echantillons.some((p) => dansAnneaux(p, o.anneaux))),
    );
}

/** Point dans des anneaux remplis pair-impair (comme le décor). */
function dansAnneaux([x, y]: Position, anneaux: Position[][]): boolean {
  let dedans = false;
  for (const anneau of anneaux) {
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const [xi, yi] = anneau[i]!;
      const [xj, yj] = anneau[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}
