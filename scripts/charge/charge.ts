/**
 * Test de charge (#19) : simulation reproductible d'une grosse manif sur une
 * copie locale (vrai point d'entrée du serveur + Postgres local), en temps
 * accéléré. Méthode et résultats : docs/test-de-charge.md.
 *
 *   npm run charge -- [--soutiens 100000] [--acceleration 30] [--parcours-km 4]
 *     [--ouverture-avant 60] [--clients-simules 400] [--spectateurs 0.5]
 *     [--session-min 5] [--session-max 45] [--retraits 0.01] [--points-parcours 150]
 *     [--intervalle-publication 5000] [--autres-manifs 0] [--graine 1] [--garder]
 *
 * `--autres-manifs N` ajoute N manifs sans soutiens le même jour (journée nationale) :
 * elles grossissent la liste des manifs, relue par chaque client toutes les 20 s.
 *
 * Déroulé :
 * 1. base Postgres jetable `pc_charge_<hex>` (DATABASE_ADMIN_URL), une manif dont le
 *    départ est à 13:00 UTC (temps virtuel), parcours de type uMap ;
 * 2. serveur = point d'entrée de production dans son propre processus, horloge
 *    accélérée × `acceleration` (le reste de la configuration par l'environnement,
 *    comme en prod : coût ALTCHA, limite par IP, plafond global inchangés) ;
 * 3. lecteurs (faux CDN + clients simulés avec le vrai code client) dans un autre processus ;
 * 4. ici : chaque soutien demande un défi, le résout (vraie preuve ALTCHA, compteur
 *    réduit : voir ALTCHA_COMPTEUR_*), POST son entrée depuis sa propre IP (X-Forwarded-For
 *    derrière un proxy de confiance, comme derrière le CDN) ; une part retire ensuite son avatar ;
 * 5. échantillonnage CPU/mémoire du serveur et de Postgres (/proc), durée de chaque passage
 *    de publication ; à la fin, vérification qu'aucune entrée acceptée ne manque aux fichiers publiés.
 * Résultats : `var/charge/<horodatage>.json` et résumé sur la sortie standard.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import postgres from 'postgres';
import { solveChallenge, type Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import {
  CHEMIN_API_DEFI,
  CHEMIN_API_ENTREE,
  CHEMIN_API_RETRAIT,
  apparenceAuHasard,
  arriveeDeLaTete,
  calculerFin,
  COULEURS_PANCARTE,
  encoderApparence,
  encoderPancarte,
  FORMES_PANCARTE,
  longueurParcours,
  SLOGANS,
  lireEntreesMinute,
  type Parcours,
  type ReponseEntree,
} from '@petit-cortege/shared';
import { connecter, creerManif, lireParcoursGeoJson, migrer } from '@petit-cortege/server';
import { RACINE } from '../config';
import type { Categorie, Compte, ConfigLecteurs, ResultatsLecteurs } from './lecteurs';
import { aleaAGraine, centiles, coutCdn, HorlogeAcceleree, profilParDefaut, tirerInstants, type Tarif } from './outils';

// ---------------------------------------------------------------- options

function option(nom: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${nom}` || a.startsWith(`--${nom}=`));
  if (i < 0) return undefined;
  const arg = process.argv[i]!;
  return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : (process.argv[i + 1] ?? '');
}
const nombre = (nom: string, defaut: number) => {
  const texte = option(nom);
  if (texte === undefined) return defaut;
  const n = Number(texte);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${nom} : nombre attendu, reçu « ${texte} »`);
  return n;
};

const O = {
  soutiens: nombre('soutiens', 100_000),
  acceleration: nombre('acceleration', 30),
  parcoursKm: nombre('parcours-km', 4),
  ouvertureAvantMin: nombre('ouverture-avant', 60),
  clientsSimules: nombre('clients-simules', 400),
  spectateurs: nombre('spectateurs', 0.5),
  sessionMinMin: nombre('session-min', 5),
  sessionMaxMin: nombre('session-max', 45),
  retraits: nombre('retraits', 0.01),
  pointsParcours: Math.max(2, nombre('points-parcours', 150)),
  intervallePublicationMs: nombre('intervalle-publication', 5_000),
  autresManifs: nombre('autres-manifs', 0),
  graine: nombre('graine', 1),
  garder: process.argv.includes('--garder'),
  /** Profil CPU du serveur (`node --cpu-prof`) dans le dossier du run. */
  profilCpu: process.argv.includes('--profil-cpu'),
};

const MINUTE = 60_000;
const INTERVALLE_CLIENT_MS = 20_000; // client/src/main.ts
/** En-têtes HTTP d'une réponse du CDN, estimés (HTTP/2, compression HPACK) : ajoutés par requête. */
const ENTETES_PAR_REPONSE = 200;
/**
 * Tarifs publics bunny.net (CDN), Europe, connus en 2025 et NON revérifiés ici (accès
 * bloqué depuis l'environnement du test) : https://bunny.net/pricing/cdn/ — en dollars.
 */
const TARIFS: Tarif[] = [
  { nom: 'Bunny Standard, Europe (0,01 $/Go)', prixParGo: 0.01, minimumMensuel: 1 },
  { nom: 'Bunny Volume (0,005 $/Go)', prixParGo: 0.005, minimumMensuel: 1 },
];

const alea = aleaAGraine(O.graine);
const rond = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const emettre = (texte: string) => process.stdout.write(`${texte}\n`);

// ---------------------------------------------------------------- manif et horloge

/**
 * Parcours façon export uMap (points à pleine précision flottante, légère sinuosité,
 * longueur visée), lu comme le fait la commande de modération `creer-manif`.
 */
function parcoursDeTest(km: number, points: number): Parcours {
  const brut: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const f = i / (points - 1);
    brut.push([2.3634 + f * 0.05 + Math.sin(f * 12) * 0.002 + alea() * 1e-5, 48.8673 - f * 0.02 + Math.cos(f * 9) * 0.002]);
  }
  const echelle = (km * 1000) / longueurParcours({ type: 'LineString', coordinates: brut });
  const [lon0, lat0] = brut[0]!;
  return lireParcoursGeoJson({
    type: 'LineString',
    coordinates: brut.map(([lon, lat]) => [lon0 + (lon - lon0) * echelle, lat0 + (lat - lat0) * echelle]),
  });
}

const URL_ADMIN = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const nomBase = `pc_charge_${randomBytes(4).toString('hex')}`;
const urlBase = Object.assign(new URL(URL_ADMIN), { pathname: `/${nomBase}` }).toString();
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const dossierRun = join(RACINE, 'var/charge', horodatage);
const dossierPublication = join(dossierRun, 'publie');
await mkdir(dossierPublication, { recursive: true });

const admin = postgres(URL_ADMIN, { max: 1, onnotice: () => {} });
await admin.unsafe(`create database ${nomBase}`);
const sql = connecter(urlBase);
await migrer(sql);

const jour = new Date();
const depart = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate(), 13);
const ouverture = depart - O.ouvertureAvantMin * MINUTE;
const parcours = parcoursDeTest(O.parcoursKm, O.pointsParcours);
// Entrées jusqu'à l'arrivée de la tête (fermeture) ; fin = arrivée de la queue + danse.
const fermeture = arriveeDeLaTete(new Date(depart), longueurParcours(parcours)).getTime();
const fin = calculerFin(new Date(depart), longueurParcours(parcours), O.soutiens).getTime();
const ID_MANIF = 'charge-paris';
await creerManif(sql, {
  id: ID_MANIF,
  intitule: 'Grande marche (test de charge)',
  ville: 'Paris',
  ouverture: new Date(ouverture),
  depart: new Date(depart),
  parcours,
  sources: [{ libelle: 'Collectif organisateur', url: 'https://example.org/appel-a-manifester' }],
});

for (let i = 0; i < O.autresManifs; i++) {
  await creerManif(sql, {
    id: `autre-${i}`,
    intitule: `Marche n° ${i} (test de charge)`,
    ville: `Ville ${i}`,
    ouverture: new Date(ouverture),
    depart: new Date(depart),
    parcours: parcoursDeTest(O.parcoursKm, O.pointsParcours),
    sources: [{ libelle: 'Collectif organisateur', url: 'https://example.org/appel-a-manifester' }],
  });
}

const profil = profilParDefaut(O.ouvertureAvantMin, (fermeture - depart) / MINUTE);
const instantsEntree = tirerInstants(O.soutiens, profil, alea).map((t) => depart + t);
const tirerSession = (arrivee: number) => ({
  arrivee,
  depart: Math.min(fin + 15 * MINUTE, arrivee + (O.sessionMinMin + alea() * (O.sessionMaxMin - O.sessionMinMin)) * MINUTE),
});
// Clients simulés : soutiens (arrivés une minute avant d'entrer) et spectateurs, même affluence.
const sessions = tirerInstants(O.clientsSimules, profil, alea).map((t, i) =>
  tirerSession(Math.max(ouverture, depart + t - (i % (1 + O.spectateurs) < 1 ? MINUTE : 0))),
);

// Le temps virtuel démarre à l'ouverture, 4 s (réelles) après le lancement des processus.
const horloge = new HorlogeAcceleree(Date.now() + 4_000, ouverture, O.acceleration);
const finVirtuelle = fin + 15 * MINUTE;

// ---------------------------------------------------------------- processus

let alertesPlafond = 0;
const TSX = ['--import', 'tsx'];
function lancerProcessus(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  memoire?: number,
  optionsNode: string[] = [],
): ChildProcess {
  return spawn(
    process.execPath,
    [...(memoire ? [`--max-old-space-size=${memoire}`] : []), ...optionsNode, ...TSX, join(RACINE, 'scripts/charge', script), ...args],
    { cwd: RACINE, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
/** Messages `CHARGE {json}` d'un processus ; le reste est recopié tel quel (alertes de plafond comptées). */
function ecouter(processus: ChildProcess, nom: string, surMessage: (m: Record<string, unknown>) => void): void {
  createInterface({ input: processus.stderr! }).on('line', (ligne) => {
    if (/plafond/i.test(ligne)) alertesPlafond++;
    else emettre(`[${nom}] ${ligne}`);
  });
  createInterface({ input: processus.stdout! }).on('line', (ligne) => {
    if (ligne.startsWith('CHARGE ')) surMessage(JSON.parse(ligne.slice(7)) as Record<string, unknown>);
    else emettre(`[${nom}] ${ligne}`);
  });
}

const intervalleReelPublication = Math.max(20, Math.round(O.intervallePublicationMs / O.acceleration));
const serveur = lancerProcessus('serveur-accelere.ts', [], {
  DATABASE_URL: urlBase,
  DOSSIER_PUBLICATION: dossierPublication,
  ALTCHA_CLE_HMAC: randomBytes(32).toString('hex'),
  PORT: '0',
  // Même rythme qu'en prod en temps virtuel (5 s) : les passages sont donc `acceleration` fois plus
  // fréquents en temps réel qu'en prod, ce qui charge plus le verrou partagé avec les entrées.
  INTERVALLE_PUBLICATION_MS: String(intervalleReelPublication),
  // Coût PBKDF2 de prod (le serveur dérive une clé par défi) ; compteur réduit pour que le
  // générateur puisse résoudre 100 000 preuves (un vrai téléphone en fait ≈ 4 000 fois plus).
  ALTCHA_COMPTEUR_MIN: '1',
  ALTCHA_COMPTEUR_MAX: '2',
  // Chaque soutien a sa propre IP, transmise par un proxy de confiance comme le ferait le CDN.
  PROXYS_DE_CONFIANCE: '127.0.0.1',
  CHARGE_T0_REEL: String(horloge.t0Reel),
  CHARGE_T0_VIRTUEL: String(horloge.t0Virtuel),
  CHARGE_FACTEUR: String(O.acceleration),
}, undefined, O.profilCpu ? ['--cpu-prof', `--cpu-prof-dir=${dossierRun}`] : []);
const passages: { debut: number; dureeMs: number; ok: boolean; virtuel: string }[] = [];
const pret = new Promise<{ url: string; pid: number }>((resolve) =>
  ecouter(serveur, 'serveur', (m) => {
    if (m.pret) resolve({ url: m.pret as string, pid: m.pid as number });
    if (m.publication) passages.push(m.publication as (typeof passages)[number]);
  }),
);
const { url: urlServeur, pid: pidServeur } = await pret;

const configLecteurs: ConfigLecteurs = {
  dossierPublication,
  t0Reel: horloge.t0Reel,
  t0Virtuel: horloge.t0Virtuel,
  facteur: O.acceleration,
  manif: ID_MANIF,
  intervalleMs: INTERVALLE_CLIENT_MS,
  sessions,
};
const lecteurs = lancerProcessus('lecteurs.ts', [JSON.stringify(configLecteurs)], {}, 8192);
const resultatsLecteurs = new Promise<ResultatsLecteurs>((resolve) =>
  ecouter(lecteurs, 'lecteurs', (m) => {
    if (m.resultats) resolve(m.resultats as ResultatsLecteurs);
  }),
);

// ---------------------------------------------------------------- CPU et mémoire (/proc)

const TICKS_PAR_S = 100;
function ticksCpu(pid: number): number {
  const champs = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
  return Number(champs[11]) + Number(champs[12]); // utime + stime
}
const rssMo = (pid: number) => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0) / 1024;
function ticksPostgres(): number {
  let total = 0;
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'postgres') total += ticksCpu(Number(pid));
    } catch {
      // processus terminé entre-temps
    }
  }
  return total;
}
/** CPU de toute la machine (tous cœurs) : [occupé, total] en ticks. */
function ticksMachine(): [number, number] {
  const champs = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number);
  const total = champs.reduce((a, b) => a + b, 0);
  return [total - champs[3]! - (champs[4] ?? 0), total];
}
const echantillons: {
  reel: number;
  virtuel: number;
  cpuServeur: number;
  cpuPostgres: number;
  cpuMachine: number;
  rssMo: number;
}[] = [];
let precedent = { t: performance.now(), serveur: ticksCpu(pidServeur), postgres: ticksPostgres(), machine: ticksMachine() };
const echantillonneur = setInterval(() => {
  try {
    const t = performance.now();
    const s = ticksCpu(pidServeur);
    const p = ticksPostgres();
    const machine = ticksMachine();
    const dt = (t - precedent.t) / 1000;
    echantillons.push({
      reel: Date.now(),
      virtuel: horloge.maintenant().getTime(),
      cpuServeur: ((s - precedent.serveur) / TICKS_PAR_S / dt) * 100,
      cpuPostgres: ((p - precedent.postgres) / TICKS_PAR_S / dt) * 100,
      cpuMachine: ((machine[0] - precedent.machine[0]) / Math.max(1, machine[1] - precedent.machine[1])) * 100,
      rssMo: rssMo(pidServeur),
    });
    precedent = { t, serveur: s, postgres: p, machine };
  } catch {
    // serveur arrêté
  }
}, 1_000);

// ---------------------------------------------------------------- soutiens (POST)

interface Mesure {
  reel: number;
  virtuel: number;
  defiMs: number;
  entreeMs: number;
  statut: number;
  erreur?: string;
}
const mesures: Mesure[] = [];
const mesuresRetrait: { ms: number; statut: number }[] = [];
const acceptes = new Set<string>();
let enVol = 0;
let maxEnVol = 0;
const delaiBoucle = monitorEventLoopDelay({ resolution: 10 });
delaiBoucle.enable();

const ipDe = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
const DELAI_MAX_MS = 30_000;

async function chronometrer<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = performance.now();
  const r = await f();
  return [r, performance.now() - t];
}

async function soutenir(i: number): Promise<void> {
  const entetes = { 'x-forwarded-for': ipDe(i), 'content-type': 'application/json' };
  const mesure: Mesure = { reel: Date.now(), virtuel: horloge.maintenant().getTime(), defiMs: 0, entreeMs: 0, statut: 0 };
  enVol++;
  maxEnVol = Math.max(maxEnVol, enVol);
  try {
    const [defi, defiMs] = await chronometrer(() =>
      fetch(new URL(CHEMIN_API_DEFI, urlServeur), { headers: entetes, signal: AbortSignal.timeout(DELAI_MAX_MS) }),
    );
    mesure.defiMs = defiMs;
    if (!defi.ok) {
      mesure.statut = defi.status;
      mesure.erreur = `defi-${defi.status}`;
      return;
    }
    const challenge = (await defi.json()) as Challenge;
    const solution = await solveChallenge({ challenge, deriveKey });
    if (!solution) throw new Error('défi non résolu');
    const jeton = randomBytes(16).toString('hex');
    const corps = JSON.stringify({
      manif: ID_MANIF,
      apparence: encoderApparence(apparenceAuHasard(alea)),
      pancarte: encoderPancarte({
        slogan: Math.floor(alea() * SLOGANS.length),
        couleur: Math.floor(alea() * COULEURS_PANCARTE.length),
        forme: Math.floor(alea() * FORMES_PANCARTE.length),
      }),
      hachageRetrait: createHash('sha256').update(jeton).digest('hex'),
      preuve: Buffer.from(JSON.stringify({ challenge, solution })).toString('base64'),
    });
    const [reponse, entreeMs] = await chronometrer(() =>
      fetch(new URL(CHEMIN_API_ENTREE, urlServeur), {
        method: 'POST',
        headers: entetes,
        body: corps,
        signal: AbortSignal.timeout(DELAI_MAX_MS),
      }),
    );
    mesure.entreeMs = entreeMs;
    mesure.statut = reponse.status;
    const json = (await reponse.json()) as ReponseEntree & { erreur?: string };
    if (reponse.status !== 201) {
      mesure.erreur = json.erreur ?? String(reponse.status);
      return;
    }
    acceptes.add(json.avatar);
    if (alea() < O.retraits) {
      // Retrait quelques minutes (virtuelles) plus tard, avant la fin.
      const quand = Math.min(fin - MINUTE, horloge.maintenant().getTime() + (2 + alea() * 20) * MINUTE);
      setTimeout(() => void retirer(json.avatar, jeton), Math.max(0, horloge.reelPour(quand) - Date.now()));
    }
  } catch (e) {
    mesure.erreur = e instanceof Error ? e.name : 'erreur';
  } finally {
    enVol--;
    mesures.push(mesure);
  }
}

const retraitsEnCours: Promise<void>[] = [];
function retirer(avatar: string, jeton: string): Promise<void> {
  const p = (async () => {
    const [reponse, ms] = await chronometrer(() =>
      fetch(new URL(CHEMIN_API_RETRAIT, urlServeur), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ avatar, jeton }),
      }),
    ).catch(() => [null, 0] as const);
    mesuresRetrait.push({ ms, statut: reponse?.status ?? 0 });
    await reponse?.body?.cancel();
  })();
  retraitsEnCours.push(p);
  return p;
}

emettre(
  `Simulation : ${O.soutiens} soutiens, manif ${new Date(ouverture).toISOString()} → ${new Date(fin).toISOString()} ` +
    `(virtuel), accélération ×${O.acceleration} ≈ ${Math.round((finVirtuelle - ouverture) / O.acceleration / 1000)} s réelles. ` +
    `Base ${nomBase}, publication dans ${dossierPublication}.`,
);

const enCours: Promise<void>[] = [];
let suivant = 0;
let dernierJalon = 0;
await new Promise<void>((resolve) => {
  const repartiteur = setInterval(() => {
    const maintenantV = horloge.maintenant().getTime();
    while (suivant < instantsEntree.length && instantsEntree[suivant]! <= maintenantV) enCours.push(soutenir(suivant++));
    if (suivant >= dernierJalon + O.soutiens / 10 || suivant === instantsEntree.length) {
      dernierJalon = suivant;
      emettre(`  ${new Date(maintenantV).toISOString().slice(11, 19)} : ${suivant} soutiens lancés, ${enVol} en vol`);
    }
    if (suivant >= instantsEntree.length) {
      clearInterval(repartiteur);
      resolve();
    }
  }, 5);
});
await Promise.all(enCours);
await Promise.all(retraitsEnCours);
delaiBoucle.disable();

// Attendre la fin de la manif (dernière minute publiée, heure compactée) et des sessions des lecteurs.
emettre('Entrées terminées ; attente de la fin de la manif et des lecteurs…');
const lus = await resultatsLecteurs;
await new Promise((r) => setTimeout(r, Math.max(0, horloge.reelPour(finVirtuelle) - Date.now())));
clearInterval(echantillonneur);
serveur.kill('SIGTERM');
await new Promise((r) => serveur.once('exit', r));

// ---------------------------------------------------------------- vérification et résultats

// Aucune entrée acceptée ne doit manquer aux fichiers publiés (minutes immuables).
const publies = new Set<string>();
for (const fichier of await readdir(join(dossierPublication, 'entrees'))) {
  if (!/T\d\d-\d\d\.json$/.test(fichier)) continue;
  const minute = lireEntreesMinute(JSON.parse(await readFile(join(dossierPublication, 'entrees', fichier), 'utf8')));
  for (const e of minute.entrees) publies.add(e.a);
}
const manquants = [...acceptes].filter((a) => !publies.has(a)).length;
const enBase = (await sql<{ n: number }[]>`select count(*)::int as n from avatar`)[0]?.n ?? 0;

const ok = mesures.filter((m) => m.statut === 201);
const erreurs: Record<string, number> = {};
for (const m of mesures) if (m.statut !== 201) erreurs[m.erreur ?? String(m.statut)] = (erreurs[m.erreur ?? String(m.statut)] ?? 0) + 1;
const parSeconde = new Map<number, number>();
for (const m of mesures) parSeconde.set(Math.floor(m.reel / 1000), (parSeconde.get(Math.floor(m.reel / 1000)) ?? 0) + 1);
const debitMax = Math.max(...parSeconde.values());
// Pic : le quart d'heure virtuel qui suit le départ.
const auPic = mesures.filter((m) => m.virtuel >= depart && m.virtuel < depart + 15 * MINUTE);
const dureePicReelleS = (15 * MINUTE) / O.acceleration / 1000;

// Bande passante : moyenne par client simulé, extrapolée à tous les clients.
const categories: Categorie[] = ['liste', 'retraits', 'minute', 'heure', 'absent'];
const somme = (f: (c: Compte) => number) =>
  Object.fromEntries(categories.map((cat) => [cat, lus.clients.reduce((s, c) => s + f(c.parCategorie[cat]), 0) / lus.clients.length])) as Record<Categorie, number>;
const parClient = { octets: somme((c) => c.octets), octetsGzip: somme((c) => c.octetsGzip), requetes: somme((c) => c.requetes) };
const total = (r: Record<Categorie, number>) => categories.reduce((s, c) => s + r[c], 0);
const appli = tailleAppli();
const clientsReels = O.soutiens * (1 + O.spectateurs);
const octetsParClientGzip = total(parClient.octetsGzip) + total(parClient.requetes) * ENTETES_PAR_REPONSE + appli.octetsGzip;
const octetsParClientBruts = total(parClient.octets) + total(parClient.requetes) * ENTETES_PAR_REPONSE + appli.octets;
const totalGzip = octetsParClientGzip * clientsReels;
const totalBrut = octetsParClientBruts * clientsReels;
const sessionMoyenneMin = lus.clients.reduce((s, c) => s + (c.depart - c.arrivee), 0) / lus.clients.length / MINUTE;

function tailleAppli(): { octets: number; octetsGzip: number; fichiers: number } {
  const dist = join(RACINE, 'client/dist');
  let octets = 0;
  let octetsGzip = 0;
  let fichiers = 0;
  try {
    for (const e of readdirSync(dist, { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('prototype')) continue;
      const corps = readFileSync(join(e.parentPath, e.name));
      octets += corps.length;
      octetsGzip += gzipSync(corps).length;
      fichiers++;
    }
  } catch {
    emettre('⚠ client/dist absent (npm run build) : application non comptée.');
  }
  return { octets, octetsGzip, fichiers };
}

/** Latence des entrées par tranche de 5 min virtuelles : où se situent les ralentissements. */
const parTranche = new Map<number, Mesure[]>();
for (const m of mesures) {
  const t = Math.floor(m.virtuel / (5 * MINUTE)) * 5 * MINUTE;
  const liste = parTranche.get(t) ?? [];
  liste.push(m);
  parTranche.set(t, liste);
}
const latenceParTranche = [...parTranche]
  .sort(([a], [b]) => a - b)
  .map(([t, ms]) => {
    const c = centiles(ms.filter((m) => m.statut === 201).map((m) => m.entreeMs));
    const machine = echantillons.filter((e) => e.virtuel >= t && e.virtuel < t + 5 * MINUTE);
    return {
      tranche: new Date(t).toISOString().slice(11, 16),
      entrees: ms.length,
      parSecondeReelle: rond(ms.length / ((5 * MINUTE) / O.acceleration / 1000)),
      p50: rond(c.p50),
      p95: rond(c.p95),
      p99: rond(c.p99),
      cpuMachine: rond(centiles(machine.map((e) => e.cpuMachine)).moyenne),
      cpuServeur: rond(centiles(machine.map((e) => e.cpuServeur)).moyenne),
    };
  });
const fichiers = Object.entries(lus.fichiers);
const tailleDe = (cat: Categorie) => fichiers.filter(([, f]) => f.categorie === cat).map(([chemin, f]) => ({ chemin, ...f }));
const cpuServeur = centiles(echantillons.map((e) => e.cpuServeur));
const cpuPostgres = centiles(echantillons.map((e) => e.cpuPostgres));
const dureesPublication = centiles(passages.map((p) => p.dureeMs));
const resume = {
  options: O,
  manif: {
    ouverture: new Date(ouverture).toISOString(),
    depart: new Date(depart).toISOString(),
    fin: new Date(fin).toISOString(),
    longueurM: Math.round(longueurParcours(parcours)),
  },
  machine: { coeurs: (await import('node:os')).cpus().length, modele: (await import('node:os')).cpus()[0]?.model },
  entrees: {
    lancees: mesures.length,
    acceptees: ok.length,
    tauxErreur: (mesures.length - ok.length) / mesures.length,
    erreurs,
    enBase,
    manquantesDansLesFichiersPublies: manquants,
    debitMaxParSecondeReelle: debitMax,
    debitMoyenAuPicParSecondeReelle: rond(auPic.length / dureePicReelleS),
    maxEnVol,
    latenceDefiMs: centiles(mesures.map((m) => m.defiMs)),
    latenceEntreeMs: centiles(ok.map((m) => m.entreeMs)),
    latenceEntreeAuPicMs: centiles(auPic.filter((m) => m.statut === 201).map((m) => m.entreeMs)),
    retraits: { n: mesuresRetrait.length, ok: mesuresRetrait.filter((r) => r.statut === 200).length, latenceMs: centiles(mesuresRetrait.map((r) => r.ms)) },
    delaiBoucleGenerateurMs: { p99: delaiBoucle.percentile(99) / 1e6, max: delaiBoucle.max / 1e6 },
  },
  publication: {
    intervalleReelMs: intervalleReelPublication,
    passages: passages.length,
    echecs: passages.filter((p) => !p.ok).length,
    dureeMs: dureesPublication,
    plusDe1s: passages.filter((p) => p.dureeMs > 1_000).length,
    lents: passages.filter((p) => p.dureeMs > 500).map((p) => ({ virtuel: p.virtuel, dureeMs: Math.round(p.dureeMs) })),
    alertesPlafond,
  },
  serveur: {
    cpuPourcent: cpuServeur,
    cpuPostgresPourcent: cpuPostgres,
    rssMaxMo: Math.max(...echantillons.map((e) => e.rssMo)),
    cpuMachinePourcent: centiles(echantillons.map((e) => e.cpuMachine)),
  },
  latenceParTranche,
  bandePassante: {
    clientsSimules: lus.clients.length,
    sessionMoyenneMin: rond(sessionMoyenneMin),
    rafraichissementsMoyens: rond(lus.clients.reduce((s, c) => s + c.rafraichissements, 0) / lus.clients.length),
    erreursLecteurs: lus.erreurs,
    parClient,
    appli,
    entetesParReponse: ENTETES_PAR_REPONSE,
    octetsParClientGzip,
    octetsParClientBruts,
    clientsReels,
    totalGo: { gzip: rond(totalGzip / 1e9, 2), brut: rond(totalBrut / 1e9, 2) },
    couts: TARIFS.map((t) => ({ tarif: t.nom, gzipDollars: rond(coutCdn(totalGzip, t), 2), brutDollars: rond(coutCdn(totalBrut, t), 2) })),
    fichiers: {
      liste: tailleDe('liste'),
      retraits: tailleDe('retraits'),
      heures: tailleDe('heure'),
      minutes: centiles(tailleDe('minute').map((f) => f.octets)),
      minutesGzip: centiles(tailleDe('minute').map((f) => f.octetsGzip)),
    },
    parTrancheGzip: lus.parTranche,
  },
  echantillons,
};
await writeFile(join(RACINE, 'var/charge', `${horodatage}.json`), JSON.stringify(resume, null, 1));

const ko = (o: number) => `${rond(o / 1024)} Kio`;
const fmt = (c: { p50: number; p95: number; p99: number; max: number }) =>
  `p50 ${rond(c.p50)} / p95 ${rond(c.p95)} / p99 ${rond(c.p99)} / max ${rond(c.max)}`;
emettre(`
=== Résultats (${horodatage}) ===
Entrées : ${ok.length}/${mesures.length} acceptées (erreurs : ${JSON.stringify(erreurs)}), ${enBase} en base, ${manquants} manquantes aux fichiers publiés
  débit max ${debitMax}/s réelle, moyenne au pic ${resume.entrees.debitMoyenAuPicParSecondeReelle}/s, en vol max ${maxEnVol}
  latence défi (ms)   : ${fmt(resume.entrees.latenceDefiMs)}
  latence entrée (ms) : ${fmt(resume.entrees.latenceEntreeMs)}
  … au pic (ms)       : ${fmt(resume.entrees.latenceEntreeAuPicMs)}
  retraits : ${resume.entrees.retraits.ok}/${resume.entrees.retraits.n} ; boucle du générateur p99 ${rond(resume.entrees.delaiBoucleGenerateurMs.p99)} ms
Publication : ${passages.length} passages (toutes les ${intervalleReelPublication} ms réelles), durée (ms) ${fmt(dureesPublication)}, ${resume.publication.plusDe1s} > 1 s, ${resume.publication.echecs} échecs
Serveur : CPU % ${fmt(cpuServeur)} ; Postgres CPU % ${fmt(cpuPostgres)} ; RSS max ${rond(resume.serveur.rssMaxMo)} Mo
  machine entière (${resume.machine.coeurs} cœurs, banc compris) CPU % ${fmt(resume.serveur.cpuMachinePourcent)}
Latence des entrées par tranche de 5 min virtuelles (tranche : entrées/s réelles, p50/p95/p99 ms, CPU machine %) :
${latenceParTranche.map((l) => `  ${l.tranche} : ${l.parSecondeReelle}/s, ${l.p50}/${l.p95}/${l.p99}, ${l.cpuMachine} %`).join('\n')}
Bande passante (${lus.clients.length} clients simulés, session moyenne ${rond(sessionMoyenneMin)} min) par client (gzip) :
  liste ${ko(parClient.octetsGzip.liste)}, retraits ${ko(parClient.octetsGzip.retraits)}, minutes ${ko(parClient.octetsGzip.minute)}, heures ${ko(parClient.octetsGzip.heure)}, appli ${ko(appli.octetsGzip)}, en-têtes ${ko(total(parClient.requetes) * ENTETES_PAR_REPONSE)} (${rond(total(parClient.requetes))} requêtes)
  = ${ko(octetsParClientGzip)} gzip / ${ko(octetsParClientBruts)} brut
Total pour ${clientsReels} clients : ${resume.bandePassante.totalGo.gzip} Go gzip (${resume.bandePassante.totalGo.brut} Go brut)
${resume.bandePassante.couts.map((c) => `  ${c.tarif} : ${c.gzipDollars} $ gzip, ${c.brutDollars} $ brut`).join('\n')}
Détail : var/charge/${horodatage}.json
`);

await sql.end();
if (!O.garder) {
  await admin.unsafe(`drop database if exists ${nomBase} with (force)`);
}
await admin.end();
process.exit(0);
