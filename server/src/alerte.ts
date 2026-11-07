/**
 * Alerte au porteur (story 57) : le débit global d'entrées acceptées dépasse un
 * plafond, signe possible d'un raid de robots. Les entrées ne sont pas bloquées.
 * Aucune IP ni aucun identifiant de manif dans l'alerte.
 */
export interface AlertePlafondGlobal {
  /** Plafond d'entrées acceptées par fenêtre. */
  plafond: number;
  fenetreMs: number;
}

/** Point d'injection : journal par défaut, webhook en option, autre chose en test. */
export interface Alerte {
  plafondGlobalDepasse(alerte: AlertePlafondGlobal): void | Promise<void>;
}

const message = (a: AlertePlafondGlobal) =>
  `Petit Cortège : plus de ${a.plafond} entrées en ${Math.round(a.fenetreMs / 1000)} s (plafond global dépassé).`;

/** Alerte par défaut : une ligne de journal, sans IP. */
export const alerteJournal: Alerte = {
  plafondGlobalDepasse: (a) => console.warn(message(a)),
};

/**
 * Alerte par webhook (`ALERTE_WEBHOOK_URL`) : POST JSON `{ text, ...alerte }`
 * (`text` est compris par Slack, Mattermost, Discord via /slack…). Journalise aussi ;
 * un échec d'envoi est journalisé sans jamais faire échouer l'entrée.
 */
export function alerteWebhook(url: string, envoyer: typeof fetch = fetch): Alerte {
  return {
    async plafondGlobalDepasse(a) {
      alerteJournal.plafondGlobalDepasse(a);
      try {
        const reponse = await envoyer(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: message(a), ...a }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!reponse.ok) console.error(`Alerte webhook refusée : ${reponse.status}`);
      } catch (e) {
        console.error('Alerte webhook en échec :', e instanceof Error ? e.message : e);
      }
    },
  };
}
