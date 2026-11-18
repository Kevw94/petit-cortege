/**
 * Rappel d'agenda (.ics, RFC 5545) généré sur l'appareil, sans serveur : un événement à
 * l'heure de fin de la manif pour revenir voir l'image finale.
 *
 * Neutre par construction : titre fixe, description sans intitulé ni cause, ni lieu ni
 * catégorie, UID aléatoire. Le lien est la page publique de la manif (`/manif/<id>`,
 * ADR 0010). Le fichier est fabriqué sur l'appareil.
 */

export const TITRE_RAPPEL = 'Petit Cortège – voir la photo finale';
/** Nom du fichier proposé : neutre, sans identifiant de manif. */
export const NOM_FICHIER_RAPPEL = 'petit-cortege.ics';

export interface DemandeRappel {
  /** Heure de fin de la manif (l'image finale est prête). */
  fin: Date;
  /** URL de la page publique de la manif. */
  url: string;
  maintenant: Date;
}

/** Date-heure UTC au format RFC 5545 (`20260308T173000Z`). */
function dateUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Échappement d'une valeur TEXT (RFC 5545 §3.3.11). */
function texte(valeur: string): string {
  return valeur.replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n');
}

/** Replie une ligne à 75 octets au plus, sans couper un caractère UTF-8 (RFC 5545 §3.1). */
function replier(ligne: string): string {
  const encodeur = new TextEncoder();
  const morceaux: string[] = [];
  let courant = '';
  let octets = 0;
  for (const caractere of ligne) {
    const taille = encodeur.encode(caractere).length;
    const limite = morceaux.length === 0 ? 75 : 74; // la suite commence par une espace
    if (octets + taille > limite) {
      morceaux.push(courant);
      courant = '';
      octets = 0;
    }
    courant += caractere;
    octets += taille;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

export function rappelIcs({ fin, url, maintenant }: DemandeRappel): string {
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Petit Cortège//Rappel//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@petit-cortege`,
    `DTSTAMP:${dateUtc(maintenant)}`,
    `DTSTART:${dateUtc(fin)}`,
    `DTEND:${dateUtc(new Date(fin.getTime() + 15 * 60_000))}`,
    `SUMMARY:${texte(TITRE_RAPPEL)}`,
    `DESCRIPTION:${texte(`L’image finale du cortège est prête sur Petit Cortège : ${url}`)}`,
    `URL:${url}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lignes.map(replier).join('\r\n') + '\r\n';
}
