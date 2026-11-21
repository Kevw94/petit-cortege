/**
 * Page publique d'une manif et sitemap (ADR 0010).
 *
 * Générés à la demande depuis la base : une manif créée après le build
 * (`pc-moderation creer-manif`) a sa page sans reconstruction du client.
 * Le HTML initial est lisible sans JavaScript ; la coque du client (feuilles
 * de style, script) est recopiée pour que l'application s'ouvre ensuite.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculerFin, longueurParcours, type ManifPubliee, type Parcours, type Source } from '@petit-cortege/shared';
import type { Sql } from './base';
import type { Horloge } from './horloge';
import { FORMAT_ID_MANIF } from './moderation';

export const ORIGINE_PUBLIQUE = 'https://petit-cortege.fr';

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;

/** Au-delà, le titre retombe sur « Manif ville date » : les noms de lieux longs restent dans la page. */
const TITRE_MAX = 100;

const IMAGE_APERCU = `${ORIGINE_PUBLIQUE}/apercu.png`;
const ALT_APERCU = 'Une rue en pixel art remplie d’une foule de petits personnages avec des pancartes colorées.';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Texte inséré dans le HTML (contenu ou attribut). */
export function echapperHtml(texte: string): string {
  return texte
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function echapperXml(texte: string): string {
  return texte.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** JSON dans un `<script>` : `<` ne doit pas pouvoir fermer la balise. */
function jsonDansHtml(valeur: unknown): string {
  return JSON.stringify(valeur).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

interface PartiesParis {
  annee: string;
  mois: string;
  jour: string;
  heure: string;
  minute: string;
  seconde: string;
  decalage: string;
}

/** Heure civile de Paris, avec le décalage (CET ou CEST) pour une date ISO de schema.org. */
export function partiesParis(date: Date): PartiesParis {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const annee = p.year ?? '0000';
  const mois = p.month ?? '01';
  const jour = p.day ?? '01';
  const heure = p.hour ?? '00';
  const minute = p.minute ?? '00';
  const seconde = p.second ?? '00';
  const commeUtc = Date.UTC(Number(annee), Number(mois) - 1, Number(jour), Number(heure), Number(minute), Number(seconde));
  const deltaMin = Math.round((commeUtc - date.getTime()) / 60_000);
  const signe = deltaMin >= 0 ? '+' : '-';
  const abs = Math.abs(deltaMin);
  const decalage = `${signe}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return { annee, mois, jour, heure, minute, seconde, decalage };
}

/** `2026-11-17T14:00:00+01:00`. */
export function instantParis(date: Date): string {
  const p = partiesParis(date);
  return `${p.annee}-${p.mois}-${p.jour}T${p.heure}:${p.minute}:${p.seconde}${p.decalage}`;
}

function dateParis(date: Date): { jourSemaine: string; date: string; heure: string } {
  const p = partiesParis(date);
  const semaine = JOURS[new Date(Date.UTC(Number(p.annee), Number(p.mois) - 1, Number(p.jour))).getUTCDay()]!;
  const mois = MOIS[Number(p.mois) - 1] ?? '';
  return {
    jourSemaine: semaine,
    date: `${Number(p.jour)} ${mois} ${p.annee}`,
    heure: `${Number(p.heure)} h ${p.minute}`,
  };
}

function parcoursCourt(etapes: string[]): string | undefined {
  if (etapes.length < 2) return;
  return `${etapes[0]} → ${etapes[etapes.length - 1]}`;
}

export interface TextesManif {
  h1: string;
  titre: string;
  description: string;
  chapeau: string;
}

/** Titre, description et chapeau. Les étapes longues restent dans la liste, pas dans le titre. */
export function textesManif(manif: Pick<ManifPubliee, 'intitule' | 'ville' | 'depart'>, etapes: string[], terminee: boolean): TextesManif {
  const { jourSemaine, date, heure } = dateParis(new Date(manif.depart));
  const court = parcoursCourt(etapes);
  let h1 = `Manif ${manif.ville} ${date}${court ? ` : parcours ${court}` : ''}`;
  if (`${h1} | Petit Cortège`.length > TITRE_MAX) h1 = `Manif ${manif.ville} ${date}`;
  const titre = `${h1} | Petit Cortège`;
  const route = court && h1.includes('parcours') ? `, parcours ${court}` : '';
  const description = terminee
    ? `Cortège virtuel terminé : manif à ${manif.ville} le ${date}, départ à ${heure}${route}. L’image finale reste consultable en ligne.`
    : `Cortège virtuel à ${manif.ville} le ${date}, départ à ${heure}${route}. Rejoins la manif en ligne, sans compte ni publicité.`;
  const chapeau = `${manif.intitule}. Cortège virtuel en pixel art, à ${manif.ville}, départ le ${jourSemaine} ${date} à ${heure} (heure de Paris).`;
  return { h1, titre, description, chapeau };
}

function urlHttp(url: string): string | undefined {
  try {
    const analyse = new URL(url);
    if (analyse.protocol !== 'http:' && analyse.protocol !== 'https:') return;
    return analyse.href;
  } catch {
    return;
  }
}

function corpsManif(textes: TextesManif, etapes: string[], sources: Source[], terminee: boolean): string {
  const lignes = [
    `<article class="page-manif">`,
    `  <h1>${echapperHtml(textes.h1)}</h1>`,
    `  <p>${echapperHtml(textes.chapeau)}</p>`,
  ];
  if (terminee) lignes.push(`  <p>Ce cortège est terminé.</p>`);
  if (etapes.length > 0) {
    lignes.push(`  <h2>Parcours annoncé</h2>`, `  <ol>`);
    for (const etape of etapes) lignes.push(`    <li>${echapperHtml(etape)}</li>`);
    lignes.push(`  </ol>`);
  }
  const cites = sources.filter((s) => s.libelle.trim() !== '');
  if (cites.length > 0) {
    lignes.push(`  <h2>Sources</h2>`, `  <ul>`);
    for (const source of cites) {
      const libelle = echapperHtml(source.libelle);
      const url = urlHttp(source.url);
      lignes.push(
        url
          ? `    <li><a href="${echapperHtml(url)}" rel="noopener noreferrer">${libelle}</a></li>`
          : `    <li>${libelle}</li>`,
      );
    }
    lignes.push(`  </ul>`);
  }
  lignes.push(`</article>`);
  return lignes.join('\n');
}

function donneesEvenement(manif: ManifPubliee, textes: TextesManif, canonique: string, terminee: boolean): unknown {
  const evenement: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: textes.h1,
    description: textes.description,
    url: canonique,
    startDate: instantParis(new Date(manif.depart)),
    endDate: instantParis(new Date(manif.fin)),
    eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode',
    image: IMAGE_APERCU,
    inLanguage: 'fr',
    isAccessibleForFree: true,
    location: [
      {
        '@type': 'Place',
        name: manif.ville,
        address: { '@type': 'PostalAddress', addressLocality: manif.ville },
      },
      { '@type': 'VirtualLocation', url: canonique },
    ],
  };
  // Une manif passée n'est pas « programmée » : on ne le prétend pas.
  if (!terminee) evenement.eventStatus = 'https://schema.org/EventScheduled';
  return evenement;
}

export interface AssetsCoque {
  liens: string;
  scripts: string;
}

/** Feuilles de style, icônes et script de l'application, pas les balises de la page d'accueil. */
export function assetsDeLaCoque(coque: string): AssetsCoque {
  const balises = coque.match(/<link\b[^>]*>|<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
  const liens: string[] = [];
  const scripts: string[] = [];
  for (const balise of balises) {
    if (balise.startsWith('<link')) {
      const rel = /\brel="([^"]*)"/.exec(balise)?.[1] ?? '';
      const roles = rel.split(/\s+/);
      if (roles.some((role) => role === 'stylesheet' || role === 'icon' || role === 'apple-touch-icon')) liens.push(balise);
    } else if (/\btype="module"/.test(balise) && /\bsrc="/.test(balise)) {
      scripts.push(balise);
    }
  }
  return { liens: liens.join('\n    '), scripts: scripts.join('\n    ') };
}

interface DocumentPage {
  titre: string;
  description?: string;
  canonique?: string;
  robots?: string;
  corps: string;
  jsonLd?: unknown;
  donneesManif?: unknown;
  coque: string;
}

function rendreDocument(page: DocumentPage): string {
  const { liens, scripts } = assetsDeLaCoque(page.coque);
  const tete = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`,
    `<meta name="referrer" content="no-referrer" />`,
    `<meta name="theme-color" content="#f4f1ea" />`,
    `<title>${echapperHtml(page.titre)}</title>`,
    page.robots ? `<meta name="robots" content="${echapperHtml(page.robots)}" />` : '',
    page.canonique ? `<link rel="canonical" href="${echapperHtml(page.canonique)}" />` : '',
    page.description ? `<meta name="description" content="${echapperHtml(page.description)}" />` : '',
  ];
  if (page.description && page.canonique) {
    tete.push(
      `<meta property="og:type" content="website" />`,
      `<meta property="og:url" content="${echapperHtml(page.canonique)}" />`,
      `<meta property="og:site_name" content="Petit Cortège" />`,
      `<meta property="og:title" content="${echapperHtml(page.titre)}" />`,
      `<meta property="og:description" content="${echapperHtml(page.description)}" />`,
      `<meta property="og:locale" content="fr_FR" />`,
      `<meta property="og:image" content="${IMAGE_APERCU}" />`,
      `<meta property="og:image:type" content="image/png" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${echapperHtml(ALT_APERCU)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${echapperHtml(page.titre)}" />`,
      `<meta name="twitter:description" content="${echapperHtml(page.description)}" />`,
      `<meta name="twitter:image" content="${IMAGE_APERCU}" />`,
      `<meta name="twitter:image:alt" content="${echapperHtml(ALT_APERCU)}" />`,
    );
  }
  if (liens) tete.push(liens);
  if (page.jsonLd) tete.push(`<script type="application/ld+json">${jsonDansHtml(page.jsonLd)}</script>`);
  if (page.donneesManif) {
    tete.push(`<script type="application/json" id="donnees-manif">${jsonDansHtml(page.donneesManif)}</script>`);
  }
  return `<!doctype html>
<html lang="fr">
  <head>
    ${tete.filter(Boolean).join('\n    ')}
  </head>
  <body>
    <div id="jeu"></div>
    <div id="interface">
      ${page.corps}
    </div>
    ${scripts}
  </body>
</html>
`;
}

export interface PageManifRendue {
  manif: ManifPubliee;
  etapes: string[];
  terminee: boolean;
  coque: string;
}

/** HTML initial de `/manif/<id>` : métas, texte, données structurées, et la coque de l'application. */
export function rendrePageManif({ manif, etapes, terminee, coque }: PageManifRendue): string {
  const textes = textesManif(manif, etapes, terminee);
  const canonique = `${ORIGINE_PUBLIQUE}/manif/${manif.id}`;
  return rendreDocument({
    titre: textes.titre,
    description: textes.description,
    canonique,
    corps: corpsManif(textes, etapes, manif.sources, terminee),
    jsonLd: donneesEvenement(manif, textes, canonique, terminee),
    donneesManif: manif,
    coque,
  });
}

/** Page 404 ou 410 : pas d'indexation, sans reprendre l'intitulé de la manif. */
export function rendrePageAbsente(statut: 404 | 410, coque: string): string {
  const retiree = statut === 410;
  const titre = retiree ? 'Manif retirée | Petit Cortège' : 'Manif introuvable | Petit Cortège';
  const h1 = retiree ? 'Manif retirée' : 'Manif introuvable';
  const texte = retiree ? 'Cette manif a été retirée. Elle n’est plus en ligne.' : 'Cette manif n’existe pas.';
  return rendreDocument({
    titre,
    robots: 'noindex',
    corps: `<article class="page-manif">\n  <h1>${h1}</h1>\n  <p>${texte}</p>\n</article>`,
    coque,
  });
}

export interface LigneSitemap {
  id: string;
  modifiee: Date;
}

/** Sitemap : page d'accueil, puis chaque manif encore publique. Un identifiant invalide est omis. */
export function rendreSitemap(manifs: LigneSitemap[]): string {
  const urls = [
    `  <url>\n    <loc>${echapperXml(`${ORIGINE_PUBLIQUE}/`)}</loc>\n  </url>`,
    ...manifs
      .filter((m) => FORMAT_ID_MANIF.test(m.id))
      .map(
        (m) =>
          `  <url>\n    <loc>${echapperXml(`${ORIGINE_PUBLIQUE}/manif/${m.id}`)}</loc>\n    <lastmod>${m.modifiee.toISOString()}</lastmod>\n  </url>`,
      ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Coque du client : le build de production s'il existe, sinon `client/index.html` (dev, tests). */
export function cheminCoque(): string {
  const dist = join(RACINE, 'client/dist/index.html');
  const source = join(RACINE, 'client/index.html');
  if (process.env.NODE_ENV === 'production') return dist;
  return source;
}

async function lireCoque(): Promise<string> {
  const prefere = cheminCoque();
  const source = join(RACINE, 'client/index.html');
  try {
    return await readFile(prefere, 'utf8');
  } catch {
    if (prefere === source) return '';
    return readFile(source, 'utf8').catch(() => '');
  }
}

interface LignePage {
  id: string;
  intitule: string;
  ville: string;
  ouverture: Date;
  depart: Date;
  parcours: Parcours;
  sources: unknown;
  etapes: unknown;
  retiree: Date | null;
  compteur: number;
  /** Avatars entrés, retirés compris : fixent la fin (ADR 0004). */
  entres: number;
}

function textesSources(valeur: unknown): Source[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.flatMap((entree) => {
    if (typeof entree !== 'object' || entree === null) return [];
    const libelle = (entree as { libelle?: unknown }).libelle;
    const url = (entree as { url?: unknown }).url;
    if (typeof libelle !== 'string' || typeof url !== 'string') return [];
    return [{ libelle, url }];
  });
}

function textesEtapes(valeur: unknown): string[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.flatMap((etape) => (typeof etape === 'string' && etape.trim() !== '' ? [etape.trim()] : []));
}

const HTML = { 'content-type': 'text/html; charset=utf-8' };

export async function reponsePageManif(sql: Sql, horloge: Horloge, id: string): Promise<Response> {
  const coque = await lireCoque();
  if (!FORMAT_ID_MANIF.test(id)) {
    return new Response(rendrePageAbsente(404, coque), {
      status: 404,
      headers: { ...HTML, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }
  const [ligne] = await sql<LignePage[]>`
    select m.id, m.intitule, m.ville, m.ouverture, m.depart, m.parcours, m.sources, m.etapes, m.retiree,
      (select count(*)::int from avatar a
       where a.manif_id = m.id and not exists (select 1 from retrait r where r.avatar_id = a.id)) as compteur,
      (select count(*)::int from avatar a where a.manif_id = m.id) as entres
    from manif m where m.id = ${id}`;
  if (!ligne || ligne.retiree) {
    const statut = ligne?.retiree ? 410 : 404;
    return new Response(rendrePageAbsente(statut, coque), {
      status: statut,
      headers: { ...HTML, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }
  const longueurM = longueurParcours(ligne.parcours);
  const fin = calculerFin(ligne.depart, longueurM, Number(ligne.entres));
  const sources = textesSources(ligne.sources);
  const manif: ManifPubliee = {
    id: ligne.id,
    intitule: ligne.intitule,
    ville: ligne.ville,
    ouverture: ligne.ouverture.toISOString(),
    depart: ligne.depart.toISOString(),
    fin: fin.toISOString(),
    parcours: ligne.parcours,
    longueurM,
    sources,
    compteur: Number(ligne.compteur),
  };
  const html = rendrePageManif({
    manif,
    etapes: textesEtapes(ligne.etapes),
    terminee: fin.getTime() <= horloge.maintenant().getTime(),
    coque,
  });
  return new Response(html, {
    status: 200,
    headers: { ...HTML, 'cache-control': 'public, max-age=60' },
  });
}

export async function reponseSitemap(sql: Sql): Promise<Response> {
  const lignes = await sql<LigneSitemap[]>`
    select id, modifiee from manif where retiree is null order by depart desc, id`;
  return new Response(rendreSitemap(lignes), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=60' },
  });
}
