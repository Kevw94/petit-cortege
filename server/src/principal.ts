/**
 * Exécutable de production : `npm run serveur` (configuration par variables
 * d'environnement, voir `configDepuisEnv`). Les migrations sont appliquées au
 * démarrage. Aucune IP n'est journalisée (ADR 0002).
 */
import { configDepuisEnv, lancer } from './lancement';

const serveur = await lancer(configDepuisEnv(process.env));
console.log(`Serveur prêt : ${serveur.url}`);

const arreter = async () => {
  await serveur.arreter();
  process.exit(0);
};
process.once('SIGINT', () => void arreter());
process.once('SIGTERM', () => void arreter());
