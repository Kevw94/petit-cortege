/**
 * Serveur du test de charge : le point d'entrée de production (`lancer` +
 * `configDepuisEnv`, mêmes variables d'environnement), avec pour seule
 * différence une horloge métier accélérée (CHARGE_T0_REEL, CHARGE_T0_VIRTUEL,
 * CHARGE_FACTEUR). Chaque passage de publication est signalé sur la sortie
 * standard (ligne `CHARGE {json}`) pour le générateur.
 */
import { configDepuisEnv, lancer } from '@petit-cortege/server';
import { HorlogeAcceleree } from './outils';

const nombre = (nom: string) => {
  const n = Number(process.env[nom]);
  if (!Number.isFinite(n)) throw new Error(`${nom} manquant`);
  return n;
};

const horloge = new HorlogeAcceleree(nombre('CHARGE_T0_REEL'), nombre('CHARGE_T0_VIRTUEL'), nombre('CHARGE_FACTEUR'));
const emettre = (message: object) => process.stdout.write(`CHARGE ${JSON.stringify(message)}\n`);

const serveur = await lancer(configDepuisEnv(process.env), {
  horloge,
  surPublication: (p) => emettre({ publication: { ...p, virtuel: horloge.maintenant().toISOString() } }),
});
emettre({ pret: serveur.url, pid: process.pid });

process.once('SIGTERM', () => {
  void serveur.arreter().then(() => process.exit(0));
});
