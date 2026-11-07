/**
 * Lecteurs du test de charge, dans leur propre processus (hors du serveur mesuré) :
 * - un faux CDN qui sert le dossier de publication et compte les octets servis,
 *   par client simulé et par type de fichier (bruts et gzip) ;
 * - des clients simulés qui utilisent le VRAI code du client (`Publication`) au
 *   même rythme que la vue manif : à l'arrivée puis toutes les 20 s (temps
 *   virtuel), liste des manifs, fichiers d'entrées, retraits.
 * Chaque client lit sous `/c/<n>/publie/…` : le préfixe identifie le client
 * auprès du faux CDN sans toucher au code du client.
 *
 * Configuration : JSON en argument. Résultats : ligne `CHARGE {json}` à la fin.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ManifPubliee } from '@petit-cortege/shared';
import { Publication } from '../../client/src/publication';
import { HorlogeAcceleree } from './outils';

export interface ConfigLecteurs {
  dossierPublication: string;
  t0Reel: number;
  t0Virtuel: number;
  facteur: number;
  manif: string;
  /** Rafraîchissement de la vue manif (ms virtuelles), 20 s dans le client. */
  intervalleMs: number;
  /** Une session par client simulé (ms virtuelles epoch). */
  sessions: { arrivee: number; depart: number }[];
}

export type Categorie = 'liste' | 'retraits' | 'minute' | 'heure' | 'absent';
const CATEGORIES: Categorie[] = ['liste', 'retraits', 'minute', 'heure', 'absent'];

export interface Compte {
  requetes: number;
  octets: number;
  octetsGzip: number;
}

const compteVide = (): Compte => ({ requetes: 0, octets: 0, octetsGzip: 0 });
const comptesVides = () => Object.fromEntries(CATEGORIES.map((c) => [c, compteVide()])) as Record<Categorie, Compte>;

export interface ResultatsLecteurs {
  clients: { arrivee: number; depart: number; rafraichissements: number; parCategorie: Record<Categorie, Compte> }[];
  /** Dernière version servie de chaque fichier (taille brute et gzip, nombre de fois servi). */
  fichiers: Record<string, { categorie: Categorie; octets: number; octetsGzip: number; servi: number }>;
  /** Octets gzip servis par tranche de 5 min virtuelles (clé = début de tranche ISO). */
  parTranche: Record<string, number>;
  erreurs: number;
}

const config = JSON.parse(process.argv[2] ?? '{}') as ConfigLecteurs;
const horloge = new HorlogeAcceleree(config.t0Reel, config.t0Virtuel, config.facteur);

const categorie = (chemin: string): Categorie => {
  if (chemin === 'manifs.json') return 'liste';
  if (chemin === 'retraits.json') return 'retraits';
  if (/T\d\d-\d\d\.json$/.test(chemin)) return 'minute';
  return 'heure';
};

const resultats: ResultatsLecteurs = {
  clients: config.sessions.map((s) => ({ ...s, rafraichissements: 0, parCategorie: comptesVides() })),
  fichiers: {},
  parTranche: {},
  erreurs: 0,
};

/** Contenu et taille gzip, par chemin (les fichiers à cache court sont relus s'ils ont changé). */
const cache = new Map<string, { version: string; corps: Buffer; octetsGzip: number }>();

async function lireFichier(chemin: string): Promise<{ corps: Buffer; octetsGzip: number } | null> {
  const complet = join(config.dossierPublication, chemin);
  const infos = await stat(complet).catch(() => null);
  if (!infos) return null;
  const version = `${infos.mtimeMs}:${infos.size}`;
  const connu = cache.get(chemin);
  if (connu?.version === version) return connu;
  const corps = await readFile(complet).catch(() => null);
  if (!corps) return null;
  const entree = { version, corps, octetsGzip: gzipSync(corps, { level: 6 }).length };
  cache.set(chemin, entree);
  return entree;
}

const cdn = createServer((requete, reponse) => {
  void (async () => {
    const m = /^\/c\/(\d+)\/publie\/(.+)$/.exec(requete.url ?? '');
    const client = m ? resultats.clients[Number(m[1])] : undefined;
    const chemin = m ? normalize(m[2]!) : '';
    if (!m || !client || chemin.startsWith('..')) {
      reponse.writeHead(400).end();
      return;
    }
    const fichier = await lireFichier(chemin);
    const tranche = new Date(Math.floor(horloge.maintenant().getTime() / 300_000) * 300_000).toISOString();
    if (!fichier) {
      client.parCategorie.absent.requetes++;
      reponse.writeHead(404).end();
      return;
    }
    const cat = categorie(chemin);
    const compte = client.parCategorie[cat];
    compte.requetes++;
    compte.octets += fichier.corps.length;
    compte.octetsGzip += fichier.octetsGzip;
    const stats = (resultats.fichiers[chemin] ??= { categorie: cat, octets: 0, octetsGzip: 0, servi: 0 });
    stats.octets = fichier.corps.length;
    stats.octetsGzip = fichier.octetsGzip;
    stats.servi++;
    resultats.parTranche[tranche] = (resultats.parTranche[tranche] ?? 0) + fichier.octetsGzip;
    reponse.writeHead(200, { 'content-type': 'application/json', 'content-length': fichier.corps.length });
    reponse.end(fichier.corps);
  })();
});
await new Promise<void>((resolve) => cdn.listen(0, '127.0.0.1', resolve));
const urlCdn = `http://127.0.0.1:${(cdn.address() as AddressInfo).port}`;

const attendreReel = (reelMs: number) => new Promise((r) => setTimeout(r, Math.max(0, reelMs - Date.now())));

/** Un client simulé : la vue manif du vrai client (main.ts), sans le rendu. */
async function simuler(n: number): Promise<void> {
  const client = resultats.clients[n]!;
  await attendreReel(horloge.reelPour(client.arrivee));
  const publication = new Publication(`${urlCdn}/c/${n}/publie/`);
  let manif: ManifPubliee | undefined;
  const rafraichir = async () => {
    client.rafraichissements++;
    try {
      const liste = await publication.listeManifs().catch(() => null);
      manif = liste?.manifs.find((x) => x.id === config.manif) ?? manif;
      if (manif) await publication.entreesPour(manif, horloge.maintenant());
      await publication.retraits().catch(() => []);
    } catch {
      resultats.erreurs++;
    }
  };
  await rafraichir();
  for (let prochain = client.arrivee + config.intervalleMs; prochain < client.depart; prochain += config.intervalleMs) {
    await attendreReel(horloge.reelPour(prochain));
    await rafraichir();
  }
}

process.stdout.write(`CHARGE ${JSON.stringify({ cdn: urlCdn })}\n`);
await Promise.all(config.sessions.map((_, n) => simuler(n)));
cdn.close();
process.stdout.write(`CHARGE ${JSON.stringify({ resultats })}\n`);
