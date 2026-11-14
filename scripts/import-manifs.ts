/**
 * Import des manifs d'une journée à partir des étapes annoncées publiquement.
 * Usage : `npm run import-manifs -- <commande> --fichier donnees/manifs/<jour>.json` ;
 * `npm run import-manifs -- aide`. Mode d'emploi : docs/import-manifs.md.
 *
 * Il n'existe pas d'API publique des tracés de manifs : le tracé est calculé
 * (géocodage + itinéraire piéton, ADR 0009), relu par le porteur, puis publié.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { connecter, horlogeSysteme, lireParcoursGeoJson, migrer, type Horloge, type Sql } from '@petit-cortege/server';
import { DOSSIER_PUBLICATION_DEV, RACINE, URL_BASE_DEV } from './config';
import { genererDecorManif } from './import/decors';
import { ErreurImport, lireJournee, type JourneeDeclaree } from './import/fichier';
import type { ServiceGeocodage } from './import/geocodage';
import type { ServiceItineraire } from './import/itineraire';
import { URLS_OVERPASS_PAR_DEFAUT } from './import/overpass';
import { publierJournee, verificationIncomplete } from './import/publier';
import { ErreurService, reseauReel, type Reseau } from './import/reseau';
import { tracerManif } from './import/tracer';

export interface BaseDeDonnees {
  sql: Sql;
  horloge: Horloge;
  dossierPublication: string;
  fermer: () => Promise<void>;
}

export interface DependancesImportManifs {
  reseau: Reseau;
  maintenant: () => Date;
  ecrire: (ligne: string) => void;
  /** Dossier contre lequel résoudre les chemins (dossier où la commande a été tapée). */
  dossierCourant: string;
  /** Racine du dépôt : `donnees/osm/` et `assets/kenney/` y sont cherchés. */
  racine: string;
  /** Dossier des décors publiés (défaut : client/public/decors de la racine). */
  dossierDecors?: string;
  /** Base et dossier de publication, ouverts seulement pour « publier ». */
  base: () => Promise<BaseDeDonnees>;
  servicesGeocodage?: ServiceGeocodage[];
  servicesItineraire?: ServiceItineraire[];
}

const AIDE = `Usage : npm run import-manifs -- <commande> --fichier donnees/manifs/<AAAA-MM-JJ>.json [--manif <id>…]

  verifier   Valide le fichier du jour (aucun réseau).
  tracer     Géocode les étapes, calcule l'itinéraire piéton et écrit donnees/manifs/<jour>/<id>.geojson
             (Géoplateforme IGN, repli API Adresse / OSRM FOSSGIS ; Overpass pour les étapes « rue »).
  decors     Génère le décor de chaque manif tracée : extraits OSM de la bande et des alentours dans donnees/osm/<id>/
             (réutilisés s'ils existent, sauf --rafraichir), tilemap dans client/public/decors/<id>.json + index.json.
  publier    Crée en base les manifs tracées et vérifiées (DATABASE_URL, DOSSIER_PUBLICATION), puis publie.
             Idempotent : une manif déjà créée est sautée. Aucun réseau.

Options : --manif <id> (répétable) pour ne traiter que certaines manifs ;
          --overpass <url> (répétable) serveurs Overpass essayés dans l'ordre
          (défaut : ${URLS_OVERPASS_PAR_DEFAUT.join(', ')}).`;

const OPTIONS = {
  fichier: { type: 'string' },
  manif: { type: 'string', multiple: true },
  overpass: { type: 'string', multiple: true },
  rafraichir: { type: 'boolean' },
} as const;

/** Exécute une commande ; renvoie le code de sortie (1 si une manif a échoué ou a été refusée). */
export async function executerImport(argv: string[], deps: DependancesImportManifs): Promise<number> {
  const [commande, ...reste] = argv;
  if (commande === undefined || commande === 'aide') {
    deps.ecrire(AIDE);
    return commande === undefined ? 1 : 0;
  }
  if (!['verifier', 'tracer', 'decors', 'publier'].includes(commande)) {
    deps.ecrire(`Commande inconnue : ${commande}\n\n${AIDE}`);
    return 1;
  }
  try {
    let options;
    try {
      options = parseArgs({ args: reste, options: OPTIONS, strict: true }).values;
    } catch (e) {
      throw new ErreurImport(`${(e as Error).message}\n\n${AIDE}`);
    }
    if (!options.fichier) throw new ErreurImport(`option --fichier obligatoire.\n\n${AIDE}`);
    const fichier = resolve(deps.dossierCourant, options.fichier);
    const journee = await lireFichierDuJour(fichier);
    const inconnues = (options.manif ?? []).filter((id) => !journee.manifs.some((m) => m.id === id));
    if (inconnues.length) throw new ErreurImport(`manif inconnue dans ${basename(fichier)} : ${inconnues.join(', ')}.`);
    const choisies = journee.manifs.filter((m) => !options.manif || options.manif.includes(m.id));
    const dossierTraces = join(dirname(fichier), journee.jour);
    const cheminTrace = (id: string) => join(dossierTraces, `${id}.geojson`);
    const urlsOverpass = options.overpass?.length ? options.overpass : URLS_OVERPASS_PAR_DEFAUT;
    const chemin = (c: string) => relative(deps.dossierCourant, c) || c;

    switch (commande) {
      case 'verifier': {
        for (const m of journee.manifs) {
          const etat = m.aVerifier ? `à vérifier : ${m.aVerifier}` : (verificationIncomplete(m) ?? 'vérification humaine remplie');
          deps.ecrire(`${m.id} : ${m.etapes.length} étapes, départ ${m.depart} ; ${etat}`);
        }
        deps.ecrire(`${basename(fichier)} : fichier valide (${journee.manifs.length} manifs).`);
        return 0;
      }
      case 'tracer': {
        let echecs = 0;
        for (const manif of choisies) {
          if (manif.aVerifier) {
            deps.ecrire(`${manif.id} : non tracée, marquée « aVerifier » (${manif.aVerifier}).`);
            continue;
          }
          deps.ecrire(`${manif.id} : géocodage des ${manif.etapes.length} étapes…`);
          try {
            const trace = await tracerManif(manif, {
              reseau: deps.reseau,
              maintenant: deps.maintenant,
              journal: deps.ecrire,
              urlsOverpass,
              ...(deps.servicesGeocodage ? { servicesGeocodage: deps.servicesGeocodage } : {}),
              ...(deps.servicesItineraire ? { servicesItineraire: deps.servicesItineraire } : {}),
            });
            await ecrireFichier(cheminTrace(manif.id), `${JSON.stringify(trace, null, 1)}\n`);
            const p = trace.properties;
            deps.ecrire(`${manif.id} : ${(p.longueurM / 1000).toFixed(2)} km par ${p.itineraire.service} → ${chemin(cheminTrace(manif.id))}`);
            const nommees = p.rues.filter((r) => r.nom !== '(sans nom)' && r.m >= 20).map((r) => r.nom);
            if (nommees.length) deps.ecrire(`  voies empruntées : ${nommees.join(', ')}`);
            for (const a of p.avertissements) deps.ecrire(`  Avertissement : ${a}`);
          } catch (e) {
            if (!(e instanceof ErreurImport || e instanceof ErreurService)) throw e;
            echecs++;
            deps.ecrire(`Erreur : ${e.message}`);
          }
        }
        return echecs ? 1 : 0;
      }
      case 'decors': {
        let echecs = 0;
        const dossierDecors = deps.dossierDecors ?? join(deps.racine, 'client/public/decors');
        for (const manif of choisies) {
          const json = await lireTexte(cheminTrace(manif.id));
          if (json === null) {
            deps.ecrire(`${manif.id} : pas de tracé (${chemin(cheminTrace(manif.id))}), décor non généré.`);
            if (!manif.aVerifier) echecs++;
            continue;
          }
          deps.ecrire(`${manif.id} : décor…`);
          try {
            const parcours = lireParcoursGeoJson(JSON.parse(json));
            const decor = await genererDecorManif(manif, parcours, {
              reseau: deps.reseau,
              urlsOverpass,
              journal: deps.ecrire,
              racine: deps.racine,
              dossierDecors,
              lire: lireTexte,
              ecrireFichier,
              ...(options.rafraichir ? { rafraichir: true } : {}),
            });
            const ko = (n: number) => `${Math.round(n / 1024)} Ko`;
            deps.ecrire(
              `${manif.id} : décor ${chemin(join(dossierDecors, `${manif.id}.json`))} (${ko(decor.octetsDecor)}), ` +
                `extrait OSM ${ko(decor.octetsExtrait)}, alentours ${ko(decor.octetsAlentours)} ; places traversées : ${decor.places.join(', ') || 'aucune'}.`,
            );
            if (decor.zonesTraversees.length) {
              echecs++;
              deps.ecrire(`Erreur : ${manif.id} : le parcours traverse une zone à éviter (place OSM) : ${decor.zonesTraversees.join(', ')}.`);
            }
          } catch (e) {
            if (!(e instanceof ErreurImport || e instanceof ErreurService)) throw e;
            echecs++;
            deps.ecrire(`Erreur : ${manif.id} : ${e.message}`);
          }
        }
        return echecs ? 1 : 0;
      }
      default: {
        const base = await deps.base();
        try {
          const bilan = await publierJournee(
            { ...journee, manifs: choisies },
            {
              sql: base.sql,
              horloge: base.horloge,
              dossierPublication: base.dossierPublication,
              journal: deps.ecrire,
              lireTrace: async (id) => {
                const texte = await lireTexte(cheminTrace(id));
                return texte === null ? null : (JSON.parse(texte) as unknown);
              },
            },
          );
          deps.ecrire(
            `Bilan : ${bilan.creees.length} créée(s), ${bilan.dejaCreees.length} déjà créée(s), ${bilan.refusees.length} refusée(s).`,
          );
          return bilan.refusees.length ? 1 : 0;
        } finally {
          await base.fermer();
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ErreurImport)) throw e;
    deps.ecrire(`Erreur : ${e.message}`);
    return 1;
  }
}

async function lireFichierDuJour(fichier: string): Promise<JourneeDeclaree> {
  const texte = await lireTexte(fichier);
  if (texte === null) throw new ErreurImport(`fichier introuvable : ${fichier}`);
  let json: unknown;
  try {
    json = JSON.parse(texte);
  } catch (e) {
    throw new ErreurImport(`${basename(fichier)} : JSON invalide (${(e as Error).message}).`);
  }
  return lireJournee(json, basename(fichier));
}

async function lireTexte(chemin: string): Promise<string | null> {
  try {
    return await readFile(chemin, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function ecrireFichier(chemin: string, contenu: string): Promise<void> {
  await mkdir(dirname(chemin), { recursive: true });
  await writeFile(chemin, contenu);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await executerImport(process.argv.slice(2), {
    reseau: reseauReel(),
    maintenant: () => new Date(),
    ecrire: (ligne) => console.log(ligne),
    dossierCourant: process.env.INIT_CWD ?? process.cwd(),
    racine: RACINE,
    // Base et dossier de publication : DATABASE_URL et DOSSIER_PUBLICATION (défaut : ceux du dev local).
    base: async () => {
      const sql = connecter(URL_BASE_DEV);
      await migrer(sql);
      return { sql, horloge: horlogeSysteme, dossierPublication: DOSSIER_PUBLICATION_DEV, fermer: () => sql.end() };
    },
  });
}
