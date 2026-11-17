import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  CHEMIN_API_DEFI,
  CHEMIN_API_ENTREE,
  CHEMIN_API_RETRAIT,
  CHEMIN_LISTE_MANIFS,
  CHEMIN_RETRAITS,
  DUREE_CACHE_COURT_S,
  lireRequeteEntree,
  lireRequeteRetrait,
  PREFIXE_PUBLICATION,
  type ReponseErreur,
} from '@petit-cortege/shared';
import { creerAntiTriche, type OptionsAntiTriche } from './anti-triche';
import type { Limiteur } from './limite-debit';
import { migrer, type Sql } from './base';
import { entrer } from './entree';
import type { Horloge } from './horloge';
import { reponsePageManif, reponseSitemap } from './page-manif';
import { publier } from './publication';
import { retirerParLeSoutien } from './retrait';

export interface OptionsServeur {
  sql: Sql;
  horloge: Horloge;
  /** Dossier où la tâche de publication écrit les fichiers (servi par le serveur web en prod). */
  dossierPublication: string;
  /** 0 = port libre choisi par le système. */
  port: number;
  /** Servir aussi le dossier de publication (dev et tests ; en prod, le serveur web s'en charge). */
  servirPublication?: boolean;
  /** Preuve de travail, limites de débit, alerte (voir `antiTricheDepuisEnv`). */
  antiTriche: OptionsAntiTriche;
}

export interface Serveur {
  /** URL de base, ex. `http://127.0.0.1:54321`. */
  url: string;
  /** Lance un passage de la tâche de publication, à l'heure de l'horloge. */
  publier(): Promise<void>;
  fermer(): Promise<void>;
}

/** Taille maximale d'un corps POST : large pour la future solution ALTCHA (#8). */
const TAILLE_MAX_CORPS = 8 * 1024;

const STATUT_ERREUR = {
  'requete-invalide': 400,
  'preuve-invalide': 403,
  'retrait-refuse': 403,
  'manif-inconnue': 404,
  'manif-terminee': 409,
  'trop-de-requetes': 429,
} as const;

export function creerApp(
  options: Pick<OptionsServeur, 'sql' | 'horloge' | 'dossierPublication' | 'servirPublication' | 'antiTriche'>,
): Hono {
  const app = new Hono();
  const antiTriche = creerAntiTriche(options.antiTriche);
  const erreur = (code: ReponseErreur['erreur']) => Response.json({ erreur: code }, { status: STATUT_ERREUR[code] });

  /**
   * Limite par IP, avant tout autre travail. L'IP ne sert que de clé en mémoire :
   * jamais écrite, jamais journalisée (ADR 0001).
   */
  const limiter = (limiteur: Limiteur) => async (c: Context, suite: () => Promise<void>) => {
    const ip = antiTriche.lireIp(getConnInfo(c).remote.address, (nom) => c.req.header(nom));
    const attente = limiteur.compter(ip);
    if (attente === null) return suite();
    const reponse = erreur('trop-de-requetes');
    reponse.headers.set('retry-after', String(attente));
    return reponse;
  };
  app.use(CHEMIN_API_DEFI, limiter(antiTriche.limiteDefi));
  app.use(CHEMIN_API_ENTREE, limiter(antiTriche.limiteEntree));
  app.use(CHEMIN_API_RETRAIT, limiter(antiTriche.limiteRetrait));
  app.use('/api/*', bodyLimit({ maxSize: TAILLE_MAX_CORPS, onError: () => erreur('requete-invalide') }));

  // Défi ALTCHA : le même pour tous, sans identifiant de manif (ADR 0002), jamais mis en cache.
  app.get(CHEMIN_API_DEFI, async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await antiTriche.preuve.creerDefi());
  });

  // Entrée dans un cortège : identifiant de manif dans le corps, jamais dans l'URL (ADR 0002).
  app.post(CHEMIN_API_ENTREE, async (c) => {
    const requete = lireRequeteEntree(await c.req.json().catch(() => null));
    if (!requete) return erreur('requete-invalide');
    if (!(await antiTriche.preuve.verifierEtConsommer(requete.preuve))) return erreur('preuve-invalide');
    const resultat = await entrer(options.sql, options.horloge, requete);
    if (resultat.ok) antiTriche.compterEntreeAcceptee();
    return resultat.ok ? c.json(resultat.reponse, 201) : erreur(resultat.erreur);
  });

  // Page publique et sitemap : lus dans la base, pas dans le build (ADR 0010).
  app.get('/sitemap.xml', () => reponseSitemap(options.sql));
  app.get('/manif/:id', (c) => reponsePageManif(options.sql, options.horloge, c.req.param('id')));

  // Retrait de son avatar : identifiant de l'avatar et jeton en clair dans le corps.
  app.post(CHEMIN_API_RETRAIT, async (c) => {
    const requete = lireRequeteRetrait(await c.req.json().catch(() => null));
    if (!requete) return erreur('requete-invalide');
    const resultat = await retirerParLeSoutien(options.sql, requete);
    return resultat.ok ? c.json(resultat.reponse, 200) : erreur(resultat.erreur);
  });

  if (options.servirPublication ?? true) {
    // Fichiers réécrits à chaque publication : cache court (en prod, la même règle sur le serveur web).
    for (const chemin of [CHEMIN_LISTE_MANIFS, CHEMIN_RETRAITS]) {
      app.use(`${PREFIXE_PUBLICATION}${chemin}`, async (c, next) => {
        await next();
        c.header('Cache-Control', `public, max-age=${DUREE_CACHE_COURT_S}`);
      });
    }
    app.use(
      `${PREFIXE_PUBLICATION}*`,
      serveStatic({
        root: options.dossierPublication,
        rewriteRequestPath: (chemin) => chemin.slice(PREFIXE_PUBLICATION.length - 1),
      }),
    );
  }
  return app;
}

export async function demarrerServeur(options: OptionsServeur): Promise<Serveur> {
  await migrer(options.sql);
  await mkdir(options.dossierPublication, { recursive: true });
  const app = creerApp(options);
  const http = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: options.port, hostname: '127.0.0.1' }, () => resolve(s));
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    publier: () => publier(options),
    fermer: () => new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))),
  };
}
