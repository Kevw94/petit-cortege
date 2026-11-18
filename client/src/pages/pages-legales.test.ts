import { describe, expect, it } from 'vitest';
import { lireRoute } from '../routage';
import { MARQUEURS_A_COMPLETER } from './a-completer';
import { pageLegale, piedDePage } from './pages-legales';

/** Liens `href="#/…"` ou `href="/#/…"` d'une page du site. */
const liens = (html: string) => [...html.matchAll(/href="(\/?#\/[^"]*)"/g)].map((m) => m[1]!);

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

  it('les mentions légales donnent une adresse de signalement et nomment l’hébergeur', () => {
    const html = pageLegale('mentions-legales');
    expect(html).toContain('OVH SAS');
    expect(html).toContain('2 rue Kellermann, 59100 Roubaix, France');
    expect(html).toContain('RCS Lille Métropole 424 761 419');
    expect(html).toContain('Strasbourg (SBG), France');
    expect(html).toContain('même serveur');
    expect(html).toContain('mailto:contact@petit-cortege.fr');
    expect(html).toContain('kevw94');
    expect(html).toContain('href="https://github.com/Kevw94/petit-cortege"');
    expect(html).toContain('licence MIT');
    expect(html).toMatch(/signalement/i);
  });

  it('la vie privée mentionne le Cloud Act, l’effacement au plus tard 1 h après la fin, et Umami sans cookie', () => {
    const html = pageLegale('vie-privee');
    expect(html).toContain('Cloud Act');
    expect(html).toContain('OVH');
    expect(html).toContain('société française');
    expect(html).toContain('même serveur');
    expect(html).toContain('7 jours');
    expect(html).toContain('1 h après la fin');
    expect(html).toMatch(/cookie/i);
    expect(html).toContain('n’enregistre aucune adresse IP');
    expect(html).toContain('Umami');
    expect(html).toContain('stats.petit-cortege.fr');
    expect(html).toContain('même serveur');
    expect(html).toMatch(/ne dépose pas de cookie/);
    expect(html).toMatch(/traceur publicitaire/);
    expect(html).toMatch(/n’enregistre pas les adresses IP/);
    expect(html).toMatch(/agrégés et anonymes/);
    expect(html).toMatch(/exemptée de consentement/);
    expect(html).toMatch(/recommandations de la CNIL pour la mesure d’audience/);
    expect(html).toMatch(/Do Not Track/);
    expect(html).not.toMatch(/ni mesure d’audience/);
    expect(html).not.toMatch(/aucun suivi|sans traceur/i);
  });

  it('la charte explique que la sélection des manifs ne dépend jamais de la cause', () => {
    const html = pageLegale('charte');
    expect(html).toMatch(/comment on choisit les manifs/i);
    expect(html).toContain('jamais sur leur cause');
    expect(html).toContain(
      'elle s’inscrit dans une grande journée nationale et que son parcours officiel a été rendu public par les organisateurs ou la préfecture',
    );
  });

  it('aucune page légale ne cite Hetzner, Bunny, un CDN ou un marqueur à compléter', () => {
    expect(MARQUEURS_A_COMPLETER).toEqual([]);
    for (const html of pagesDuPiedDePage()) {
      expect(html).not.toMatch(/Hetzner|Bunny|CDN/i);
      expect(html).not.toContain('[À COMPLÉTER');
      expect(html).toContain('17 novembre 2026');
    }
  });

  it('les informations à compléter par le porteur viennent toutes du fichier centralisé', () => {
    const marqueurs = pagesDuPiedDePage()
      .join('')
      .matchAll(/\[À COMPLÉTER[^\]]*\]/g);
    const trouves = [...marqueurs].map((m) => m[0]);
    for (const marqueur of trouves) expect(MARQUEURS_A_COMPLETER).toContain(marqueur);
  });
});
