/**
 * Hachage FNV-1a 32 bits d'un identifiant d'avatar : stable, identique chez
 * tous les clients, indépendant de l'ordre d'arrivée des fichiers.
 */
export function hacherIdentifiant(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Valeur de tirage d'un identifiant (32 bits), uniforme même pour des identifiants
 * voisins (« av-1 », « av-2 ») : hachage FNV-1a suivi du mélange final de MurmurHash3,
 * car les bits de poids fort du FNV-1a seul varient peu d'un identifiant court à l'autre.
 */
export function tirageIdentifiant(id: string): number {
  let h = hacherIdentifiant(id);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
