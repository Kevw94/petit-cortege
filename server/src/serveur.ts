import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { PREFIXE_PUBLICATION } from '@petit-cortege/shared';
import { migrer, type Sql } from './base';
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

export function creerApp(options: Pick<OptionsServeur, 'dossierPublication' | 'servirPublication'>): Hono {
  const app = new Hono();
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
