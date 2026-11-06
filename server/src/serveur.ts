import { mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { CHEMIN_API_ENTREE, lireRequeteEntree, PREFIXE_PUBLICATION, type ReponseErreur } from '@petit-cortege/shared';
import { migrer, type Sql } from './base';
import { entrer } from './entree';
import type { Horloge } from './horloge';
import { publier } from './publication';

export interface OptionsServeur {
  sql: Sql;
  horloge: Horloge;
  /** Dossier où la tâche de publication écrit les fichiers (servi par le CDN en prod). */
  dossierPublication: string;
  /** 0 = port libre choisi par le système. */
  port: number;
  /** Servir aussi le dossier de publication (dev et tests ; en prod c'est le CDN). */
  servirPublication?: boolean;
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

const STATUT_ERREUR = { 'requete-invalide': 400, 'manif-inconnue': 404, 'manif-terminee': 409 } as const;

export function creerApp(
  options: Pick<OptionsServeur, 'sql' | 'horloge' | 'dossierPublication' | 'servirPublication'>,
): Hono {
  const app = new Hono();
  const erreur = (code: ReponseErreur['erreur']) => Response.json({ erreur: code }, { status: STATUT_ERREUR[code] });

  app.use('/api/*', bodyLimit({ maxSize: TAILLE_MAX_CORPS, onError: () => erreur('requete-invalide') }));

  // Entrée dans un cortège : identifiant de manif dans le corps, jamais dans l'URL (ADR 0002).
  app.post(CHEMIN_API_ENTREE, async (c) => {
    const requete = lireRequeteEntree(await c.req.json().catch(() => null));
    if (!requete) return erreur('requete-invalide');
    const resultat = await entrer(options.sql, options.horloge, requete);
    return resultat.ok ? c.json(resultat.reponse, 201) : erreur(resultat.erreur);
  });

  if (options.servirPublication ?? true) {
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
