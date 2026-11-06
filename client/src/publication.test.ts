import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lireEntreesMinute, lireListeManifs, type EntreesMinute, type ManifPubliee } from '@petit-cortege/shared';
import { calculerCortege } from './cortege/cortege';
import { Publication } from './publication';

// Fichiers publiés par les tests du serveur (server/test/compactage.test.ts),
// publiés à 15:03:20 : heures de 13 h et 14 h compactées, minutes de 15:00 à 15:02.
const FIXTURES = join(import.meta.dirname, '../../fixtures/publication/compactage-horaire');
const BASE = 'https://cdn.exemple/publie/';
const PUBLIE_A = new Date('2026-05-01T15:03:20Z');

/** Faux CDN : sert les fixtures (404 pour le reste) et note les chemins demandés. */
function fauxCdn(publies: (chemin: string) => boolean = () => true) {
  const demandes: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const chemin = url.slice(BASE.length);
    demandes.push(chemin);
    const contenu = publies(chemin) ? await readFile(join(FIXTURES, chemin), 'utf8').catch(() => null) : null;
    return contenu === null ? new Response('absent', { status: 404 }) : new Response(contenu);
  });
  return demandes;
}

async function manifA(): Promise<ManifPubliee> {
  const liste = lireListeManifs(JSON.parse(await readFile(join(FIXTURES, 'manifs.json'), 'utf8')));
  return liste.manifs.find((m) => m.id === 'manif-a')!;
}

/** Référence : tous les fichiers par minute, sans aucun fichier horaire. */
async function toutesLesMinutes(): Promise<EntreesMinute[]> {
  const fichiers = (await readdir(join(FIXTURES, 'entrees'))).filter((f) => /T\d\d-\d\d\.json$/.test(f)).sort();
  return Promise.all(
    fichiers.map(async (f) => lireEntreesMinute(JSON.parse(await readFile(join(FIXTURES, 'entrees', f), 'utf8')))),
  );
}

const minutesDemandees = (demandes: string[]) => demandes.filter((c) => /T\d\d-\d\d\.json$/.test(c));
const heuresDemandees = (demandes: string[]) => demandes.filter((c) => /T\d\d\.json$/.test(c));

describe('chargement des fichiers publiés', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("un soutien arrivé tard charge les heures passées en fichiers horaires et l'heure en cours par minute", async () => {
    const demandes = fauxCdn();

    await new Publication(BASE).entreesPour(await manifA(), PUBLIE_A);

    expect(heuresDemandees(demandes).sort()).toEqual(['entrees/2026-05-01T13.json', 'entrees/2026-05-01T14.json']);
    expect(minutesDemandees(demandes).sort()).toEqual([
      'entrees/2026-05-01T15-00.json',
      'entrees/2026-05-01T15-01.json',
      'entrees/2026-05-01T15-02.json',
    ]);
  });

  it('et voit la même foule que depuis les fichiers par minute', async () => {
    fauxCdn();
    const manif = await manifA();

    const entrees = await new Publication(BASE).entreesPour(manif, PUBLIE_A);

    const depuisLesHeures = calculerCortege({ manif, entrees, maintenant: PUBLIE_A });
    const depuisLesMinutes = calculerCortege({ manif, entrees: await toutesLesMinutes(), maintenant: PUBLIE_A });
    expect(depuisLesHeures.avatars.map((a) => a.id).sort()).toEqual(
      ['av-13h58', 'av-13h59', 'av-14h00', 'av-14h30', 'av-14h59', 'av-15h00', 'av-15h02'].sort(),
    );
    expect(depuisLesHeures).toEqual(depuisLesMinutes);
  });

  it("si le fichier d'une heure tout juste terminée n'est pas encore publié, se rabat sur ses minutes", async () => {
    // Le CDN n'a pas encore le fichier de 14 h.
    const demandes = fauxCdn((chemin) => chemin !== 'entrees/2026-05-01T14.json');
    const manif = await manifA();

    const entrees = await new Publication(BASE).entreesPour(manif, PUBLIE_A);

    expect(minutesDemandees(demandes)).toContain('entrees/2026-05-01T14-30.json');
    expect(calculerCortege({ manif, entrees, maintenant: PUBLIE_A })).toEqual(
      calculerCortege({ manif, entrees: await toutesLesMinutes(), maintenant: PUBLIE_A }),
    );
  });

  it("un soutien présent depuis le début garde ses fichiers par minute : il ne télécharge pas l'heure terminée", async () => {
    const demandes = fauxCdn();
    const manif = await manifA();
    const publication = new Publication(BASE);
    await publication.entreesPour(manif, new Date('2026-05-01T14:59:30Z'));
    demandes.length = 0;

    const entrees = await publication.entreesPour(manif, PUBLIE_A);

    expect(heuresDemandees(demandes)).toEqual([]);
    expect(minutesDemandees(demandes).sort()).toEqual([
      'entrees/2026-05-01T14-59.json',
      'entrees/2026-05-01T15-00.json',
      'entrees/2026-05-01T15-01.json',
      'entrees/2026-05-01T15-02.json',
    ]);
    expect(calculerCortege({ manif, entrees, maintenant: PUBLIE_A })).toEqual(
      calculerCortege({ manif, entrees: await toutesLesMinutes(), maintenant: PUBLIE_A }),
    );
  });
});
