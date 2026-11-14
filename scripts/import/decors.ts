/**
 * Étape « decors » : pour chaque manif tracée, extrait OSM brut de la bande
 * autour du parcours (Overpass, serveurs essayés dans l'ordre ; enregistré dans
 * `donnees/osm/<id>/` pour rejouer sans réseau) puis tilemap du décor dans
 * `client/public/decors/<id>.json`, inscrite dans `index.json` (ODbL).
 */
import { join, relative } from 'node:path';
import { COUCHE_PLACES, type CarteTiled, type CoucheObjetsTiled, type Parcours, type Position } from '@petit-cortege/shared';
import { inscrireDansIndex } from '../decor';
import { DEMI_LARGEUR_PAR_DEFAUT_M, genererDecor } from '../decor/carte';
import { lireExtrait, type ExtraitOverpass } from '../decor/osm';
import { RAYON_EXTRACTION_M, requeteBande } from '../decor/overpass';
import { echantillonner, nomDeVoie } from './controles';
import type { ManifDeclaree } from './fichier';
import { interrogerOverpass } from './overpass';
import type { Reseau } from './reseau';

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
}

export interface DecorGenere {
  id: string;
  octetsExtrait: number;
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
    texte = reponse.texte;
    await deps.ecrireFichier(cheminExtrait, texte);
    deps.journal(`  extrait de ${new URL(reponse.url).host} : ${reponse.extrait.elements.length} éléments OSM.`);
  } else {
    deps.journal(`  extrait OSM déjà enregistré (${relative(deps.racine, cheminExtrait)}), rejoué sans réseau.`);
  }
  const osm = JSON.parse(texte) as ExtraitOverpass;
  const sortie = join(deps.dossierDecors, `${manif.id}.json`);
  const carte = genererDecor({
    osm,
    parcours,
    demiLargeurM: DEMI_LARGEUR_PAR_DEFAUT_M,
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
