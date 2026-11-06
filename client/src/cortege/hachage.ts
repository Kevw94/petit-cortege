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
