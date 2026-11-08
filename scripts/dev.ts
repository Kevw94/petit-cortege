/**
 * Lance tout en local : base de dev + seed d'une manif pré-remplie, serveur
 * Node (fichiers publiés servis sous /publie/, tâche de publication toutes
 * les 5 s) et client Vite (qui relaie /publie et /api vers le serveur).
 */
import { spawn } from 'node:child_process';
import { antiTricheDepuisEnv, connecter, demarrerServeur, horlogeSysteme, meteoDepuisEnv, migrer } from '@petit-cortege/server';
import { assurerBase, DOSSIER_PUBLICATION_DEV, PORT_CLIENT, PORT_SERVEUR, RACINE, URL_BASE_DEV } from './config';
import { ID_MANIF_DEMO, semerManifDemo } from './seed';

const INTERVALLE_PUBLICATION_MS = 5_000;

await assurerBase(URL_BASE_DEV);
const sql = connecter(URL_BASE_DEV);
await migrer(sql);
if (!process.argv.includes('--sans-seed')) await semerManifDemo(sql, DOSSIER_PUBLICATION_DEV);

const meteo = meteoDepuisEnv(process.env);
const serveur = await demarrerServeur({
  sql,
  horloge: horlogeSysteme,
  dossierPublication: DOSSIER_PUBLICATION_DEV,
  port: PORT_SERVEUR,
  antiTriche: antiTricheDepuisEnv(process.env),
  // Météo réelle (Open-Meteo) par défaut ; METEO=fictive:61 pour voir la pluie sans réseau.
  ...(meteo ? { meteo } : {}),
});
await serveur.publier();
const minuterie = setInterval(() => {
  serveur.publier().catch((e: unknown) => console.error('Publication en échec :', e));
}, INTERVALLE_PUBLICATION_MS);
console.log(`Serveur : ${serveur.url} (fichiers publiés dans ${DOSSIER_PUBLICATION_DEV})`);
console.log(`Manif de démo : http://localhost:${PORT_CLIENT}/#/manif/${ID_MANIF_DEMO}`);

const client = spawn('npm', ['run', 'dev', '--workspace=@petit-cortege/client'], { cwd: RACINE, stdio: 'inherit' });

const arreter = async () => {
  clearInterval(minuterie);
  client.kill();
  await serveur.fermer();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', () => void arreter());
process.on('SIGTERM', () => void arreter());
client.on('exit', () => void arreter());
