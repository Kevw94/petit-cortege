/**
 * Clé de limite de débit d'un soutien : sa vraie IP, lue dans l'en-tête du
 * reverse proxy quand la connexion vient d'un proxy de confiance, sinon
 * l'adresse de la connexion.
 * Ne sert qu'en mémoire (ADR 0001) : jamais écrite ni journalisée.
 */
import { BlockList, isIP } from 'node:net';

export interface OptionsIpClient {
  /**
   * En-tête qui porte la vraie IP, ex. `CDN-RequestClientIP` (Bunny) ou `X-Forwarded-For`
   * (dans ce cas, l'adresse la plus à droite qui n'est pas un proxy de confiance).
   */
  enteteIp: string;
  /** Adresses ou sous-réseaux CIDR des proxys dont on croit l'en-tête. Vide = jamais. */
  proxysDeConfiance: readonly string[];
}

export type LireIpClient = (
  adresseConnexion: string | undefined,
  lireEntete: (nom: string) => string | undefined,
) => string;

export function creerLecteurIp(options: OptionsIpClient): LireIpClient {
  const confiance = new BlockList();
  for (const entree of options.proxysDeConfiance) {
    const [adresse = '', prefixe] = entree.trim().split('/');
    const famille = isIP(adresse) === 6 ? 'ipv6' : 'ipv4';
    if (!isIP(adresse)) throw new Error(`Proxy de confiance invalide : « ${entree} »`);
    if (prefixe === undefined) confiance.addAddress(adresse, famille);
    else confiance.addSubnet(adresse, Number(prefixe), famille);
  }
  const deConfiance = (ip: string) => {
    const famille = isIP(ip);
    return famille !== 0 && confiance.check(ip, famille === 6 ? 'ipv6' : 'ipv4');
  };
  const estXff = options.enteteIp.toLowerCase() === 'x-forwarded-for';

  return (adresseConnexion, lireEntete) => {
    const connexion = normaliser(adresseConnexion ?? '');
    if (!deConfiance(connexion)) return cle(connexion);
    const valeur = lireEntete(options.enteteIp);
    if (!valeur) return cle(connexion);
    const candidates = valeur.split(',').map((x) => normaliser(x.trim()));
    // X-Forwarded-For : chaque proxy ajoute à droite ; ce qui est à gauche peut être forgé.
    const ip = estXff ? candidates.reverse().find((x) => !deConfiance(x)) : candidates[0];
    return ip && isIP(ip) ? cle(ip) : cle(connexion);
  };
}

/** `::ffff:1.2.3.4` → `1.2.3.4`. */
function normaliser(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return v4 ? v4[1]! : ip;
}

/**
 * Une IPv4 compte seule ; une IPv6 compte par /64, la plus petite allocation
 * d'un abonné (sinon il changerait d'adresse à chaque requête).
 */
function cle(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [gauche = '', droite] = ip.split('::');
  const g = gauche ? gauche.split(':') : [];
  const d = droite !== undefined && droite !== '' ? droite.split(':') : [];
  const groupes = droite === undefined ? g : [...g, ...Array<string>(8 - g.length - d.length).fill('0'), ...d];
  return `${groupes
    .slice(0, 4)
    .map((x) => parseInt(x || '0', 16).toString(16))
    .join(':')}::/64`;
}
