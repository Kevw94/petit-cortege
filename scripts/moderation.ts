/**
 * Modération en ligne de commande (V1 : le porteur, en SSH sur le serveur).
 * Usage : `npm run moderation -- <commande> [options]` ; `npm run moderation -- aide`.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import {
  ajouterManif,
  connecter,
  decalerDepart,
  ErreurModeration,
  horlogeSysteme,
  lireParcoursGeoJson,
  migrer,
  publier,
  retirerManif,
  type Horloge,
  type NouveauDepart,
  type Sql,
} from '@petit-cortege/server';
import type { Source } from '@petit-cortege/shared';
import { DOSSIER_PUBLICATION_DEV, URL_BASE_DEV } from './config';

export interface DependancesModeration {
  sql: Sql;
  horloge: Horloge;
  /** Dossier de publication : republié après chaque modification. */
  dossierPublication: string;
  ecrire: (ligne: string) => void;
  /** Dossier contre lequel résoudre les chemins de fichiers (dossier où la commande a été tapée). */
  dossierCourant?: string;
}

export const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

interface Commande {
  usage: string;
  options: ParseArgsOptionsConfig;
  executer: (valeurs: Valeurs, deps: DependancesModeration) => Promise<void>;
}
type Valeurs = Record<string, string | boolean | (string | boolean)[] | undefined>;

const COMMANDES: Record<string, Commande> = {
  'creer-manif': {
    usage:
      'creer-manif --geojson <fichier uMap> --intitule <texte> --ville <ville> --depart <heure>\n' +
      '            --source "<libellé>|<url>" [--source …] [--id <identifiant>] [--ouverture <heure>]',
    options: {
      id: { type: 'string' },
      geojson: { type: 'string' },
      intitule: { type: 'string' },
      ville: { type: 'string' },
      depart: { type: 'string' },
      ouverture: { type: 'string' },
      source: { type: 'string', multiple: true },
    },
    executer: creerManif,
  },
  'decaler-depart': {
    usage: 'decaler-depart --manif <identifiant> (--depart <heure> | --minutes <retard, négatif = avance>)',
    options: { manif: { type: 'string' }, depart: { type: 'string' }, minutes: { type: 'string' } },
    executer: async (valeurs, deps) => {
      const id = obligatoire(valeurs, 'manif');
      const { depart, minutes } = valeurs;
      if ((typeof depart === 'string') === (typeof minutes === 'string')) {
        throw new ErreurModeration('donner --depart ou --minutes (un seul des deux).');
      }
      let nouveau: NouveauDepart;
      if (typeof depart === 'string') {
        nouveau = { a: lireHeure(depart, 'départ') };
      } else {
        if (!/^[+-]?\d+$/.test(String(minutes).trim())) throw new ErreurModeration(`--minutes illisible : « ${String(minutes)} ».`);
        nouveau = { deMinutes: Number(minutes) };
      }
      const resultat = await decalerDepart(deps.sql, deps.horloge, id, nouveau);
      await publier(deps);
      deps.ecrire(`Manif « ${id} » : départ ${enHeureDeParis(resultat.depart)}, fin ${enHeureDeParis(resultat.fin)} (publié).`);
    },
  },
  'retirer-manif': {
    usage: "retirer-manif --manif <identifiant> --motif <ex. référence de l'arrêté d'interdiction>",
    options: { manif: { type: 'string' }, motif: { type: 'string' } },
    executer: async (valeurs, deps) => {
      const id = obligatoire(valeurs, 'manif');
      const retiree = await retirerManif(deps.sql, deps.horloge, id, obligatoire(valeurs, 'motif'));
      await publier(deps);
      deps.ecrire(retiree ? `Manif « ${id} » retirée de la liste publiée ; entrées refusées.` : `Manif « ${id} » déjà retirée.`);
    },
  },
};

function aide(): string {
  return [
    'Usage : npm run moderation -- <commande> [options]',
    '',
    ...Object.values(COMMANDES).map((c) => `  ${c.usage}`),
    '',
    `Heures : ISO 8601 ; sans fuseau (ex. 2026-11-21T14:00), heure de Paris.`,
  ].join('\n');
}

/** Exécute une commande de modération ; renvoie le code de sortie. */
export async function executerModeration(argv: string[], deps: DependancesModeration): Promise<number> {
  const [nom, ...args] = argv;
  const commande = nom === undefined ? undefined : COMMANDES[nom];
  if (!commande) {
    deps.ecrire(nom === undefined || nom === 'aide' ? aide() : `Commande inconnue : ${nom}\n\n${aide()}`);
    return nom === 'aide' ? 0 : 1;
  }
  try {
    let valeurs: Valeurs;
    try {
      valeurs = parseArgs({ args: joindreNombresNegatifs(args), options: commande.options, strict: true }).values;
    } catch (e) {
      throw new ErreurModeration(`${(e as Error).message}\nUsage : ${commande.usage}`);
    }
    await commande.executer(valeurs, deps);
    return 0;
  } catch (e) {
    if (!(e instanceof ErreurModeration)) throw e;
    deps.ecrire(`Erreur : ${e.message}`);
    return 1;
  }
}

/** `--minutes -5` → `--minutes=-5` (sinon parseArgs prend « -5 » pour une option). */
function joindreNombresNegatifs(args: string[]): string[] {
  const resultat: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const suivant = args[i + 1];
    if (/^--[a-z-]+$/.test(arg) && suivant !== undefined && /^-\d/.test(suivant)) {
      resultat.push(`${arg}=${suivant}`);
      i++;
    } else {
      resultat.push(arg);
    }
  }
  return resultat;
}

function obligatoire(valeurs: Valeurs, nom: string): string {
  const v = valeurs[nom];
  if (typeof v !== 'string' || v.trim() === '') throw new ErreurModeration(`option --${nom} obligatoire.`);
  return v;
}

async function lireJson(chemin: string): Promise<unknown> {
  let texte: string;
  try {
    texte = await readFile(chemin, 'utf8');
  } catch {
    throw new ErreurModeration(`fichier illisible : ${chemin}`);
  }
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurModeration(`${chemin} : ce n'est pas du JSON valide.`);
  }
}

/** Décalage (ms) de l'heure locale de `fuseau` par rapport à UTC à l'instant `t`. */
function decalageFuseau(t: number, fuseau: string): number {
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(t))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(parties.year!, parties.month! - 1, parties.day!, parties.hour!, parties.minute!, parties.second!);
  return local - Math.floor(t / 1000) * 1000;
}

/**
 * Lit une heure saisie par le modérateur : ISO 8601 avec fuseau (`Z`, `+01:00`),
 * ou sans fuseau (`2026-11-21T14:00`), comprise comme l'heure de Paris.
 */
export function lireHeure(texte: string, quoi: string): Date {
  const t = texte.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(t)) {
    const instant = Date.parse(t);
    if (!Number.isNaN(instant)) return new Date(instant);
  }
  const sansFuseau = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (sansFuseau) {
    const [a, mo, j, h, mi, s] = sansFuseau.slice(1).map((x) => Number(x ?? 0)) as number[];
    const commeUtc = Date.UTC(a!, mo! - 1, j!, h!, mi!, s!);
    const premier = commeUtc - decalageFuseau(commeUtc, FUSEAU_PAR_DEFAUT);
    const instant = commeUtc - decalageFuseau(premier, FUSEAU_PAR_DEFAUT);
    if (!Number.isNaN(instant)) return new Date(instant);
  }
  throw new ErreurModeration(`${quoi} illisible : « ${texte} » (ex. 2026-11-21T14:00 ou 2026-11-21T13:00Z).`);
}

/** « 2026-06-01 12:00 (Paris) ». */
export function enHeureDeParis(instant: Date): string {
  const texte = new Intl.DateTimeFormat('sv-SE', {
    timeZone: FUSEAU_PAR_DEFAUT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
  return `${texte} (Paris)`;
}

/** Date du jour (AAAA-MM-JJ) à Paris. */
function jourAParis(instant: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU_PAR_DEFAUT }).format(instant);
}

/** « Saint-Étienne » → « saint-etienne ». */
function enIdentifiant(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function lireSource(texte: string): Source {
  const i = texte.lastIndexOf('|');
  if (i < 0) throw new ErreurModeration(`source « ${texte} » : format attendu "<libellé>|<url>".`);
  return { libelle: texte.slice(0, i).trim(), url: texte.slice(i + 1).trim() };
}

async function creerManif(valeurs: Valeurs, deps: DependancesModeration): Promise<void> {
  const fichier = resolve(deps.dossierCourant ?? process.cwd(), obligatoire(valeurs, 'geojson'));
  const intitule = obligatoire(valeurs, 'intitule');
  const ville = obligatoire(valeurs, 'ville');
  const depart = lireHeure(obligatoire(valeurs, 'depart'), 'départ');
  const ouverture = typeof valeurs.ouverture === 'string' ? lireHeure(valeurs.ouverture, 'ouverture') : undefined;
  const sources = ((valeurs.source as string[] | undefined) ?? []).map(lireSource);
  if (sources.length === 0) throw new ErreurModeration('option --source obligatoire (au moins une source publique).');
  const parcours = lireParcoursGeoJson(await lireJson(fichier));
  const id = typeof valeurs.id === 'string' ? valeurs.id : `${enIdentifiant(ville)}-${jourAParis(depart)}`;

  await ajouterManif(deps.sql, deps.horloge, {
    id,
    intitule,
    ville,
    depart,
    ...(ouverture ? { ouverture } : {}),
    parcours,
    sources,
  });
  await publier(deps);
  deps.ecrire(`Manif « ${id} » créée et publiée.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Base et dossier de publication : DATABASE_URL et DOSSIER_PUBLICATION (défaut : ceux du dev local).
  const sql = connecter(URL_BASE_DEV);
  try {
    await migrer(sql);
    process.exitCode = await executerModeration(process.argv.slice(2), {
      sql,
      horloge: horlogeSysteme,
      dossierPublication: DOSSIER_PUBLICATION_DEV,
      ecrire: (ligne) => console.log(ligne),
      // `npm run` change de dossier : les chemins se résolvent depuis celui où la commande a été tapée.
      dossierCourant: process.env.INIT_CWD ?? process.cwd(),
    });
  } finally {
    await sql.end();
  }
}
