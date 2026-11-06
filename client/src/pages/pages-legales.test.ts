import { describe, expect, it } from 'vitest';
import { lireRoute } from '../routage';
import { MARQUEURS_A_COMPLETER } from './a-completer';
import { pageLegale, piedDePage } from './pages-legales';

/** Liens `href="#/…"` d'un fragment HTML. */
const liens = (html: string) => [...html.matchAll(/href="(#\/[^"]*)"/g)].map((m) => m[1]!);

/** Les pages atteintes depuis le pied de page, rendues en HTML. */
function pagesDuPiedDePage(): string[] {
  return liens(piedDePage()).map((lien) => {
    const route = lireRoute(lien);
    if (route.page !== 'legale') throw new Error(`${lien} ne mène pas à une page légale`);
    return pageLegale(route.id);
  });
}

describe('pages légales et de confiance', () => {
  it('le pied de page mène aux mentions légales, à la vie privée, à la charte et aux CGU', () => {
    expect(liens(piedDePage()).map((lien) => lireRoute(lien))).toEqual([
      { page: 'legale', id: 'mentions-legales' },
      { page: 'legale', id: 'vie-privee' },
      { page: 'legale', id: 'charte' },
      { page: 'legale', id: 'cgu' },
    ]);
  });

  it('chaque page liée depuis le pied de page existe, avec un titre et du texte', () => {
    for (const html of pagesDuPiedDePage()) {
      expect(html).toMatch(/<h1>[^<]+<\/h1>/);
      expect(html.length).toBeGreaterThan(1000);
    }
  });

  it("un fragment inconnu ou une manif ne sont pas pris pour une page légale", () => {
    expect(lireRoute('#/inconnue')).toEqual({ page: 'liste' });
    expect(lireRoute('#/manif/vie-privee')).toEqual({ page: 'manif', id: 'vie-privee' });
  });

  it('les mentions légales donnent une adresse de signalement et nomment les hébergeurs', () => {
    const html = pageLegale('mentions-legales');
    expect(html).toContain('Hetzner');
    expect(html).toContain('Bunny');
    expect(html).toMatch(/signalement/i);
  });

  it('la vie privée mentionne le Cloud Act, l’effacement au plus tard 1 h après la fin et l’absence de cookie', () => {
    const html = pageLegale('vie-privee');
    expect(html).toContain('Cloud Act');
    expect(html).toContain('1 h après la fin');
    expect(html).toMatch(/cookie/i);
  });

  it('la charte explique que la sélection des manifs ne dépend jamais de la cause', () => {
    expect(pageLegale('charte')).toMatch(/comment on choisit les manifs/i);
  });

  it('les informations à compléter par le porteur viennent toutes du fichier centralisé', () => {
    const marqueurs = pagesDuPiedDePage()
      .join('')
      .matchAll(/\[À COMPLÉTER[^\]]*\]/g);
    const trouves = [...marqueurs].map((m) => m[0]);
    for (const marqueur of trouves) expect(MARQUEURS_A_COMPLETER).toContain(marqueur);
  });
});
