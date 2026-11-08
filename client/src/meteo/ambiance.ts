/**
 * Ambiance de la vue d'une manif (ADR 0008) : couleurs du ciel, brume, lumière et
 * précipitations, d'après la météo publiée par le serveur et la hauteur du soleil au lieu
 * de la manif. Fonction pure, sans moteur de rendu : la vue 3D et la vue 2D l'appliquent.
 */
import type { Ciel, MeteoPubliee, Position } from '@petit-cortege/shared';

export interface Ambiance {
  /** Ciel au zénith et à l'horizon (0xRRGGBB) ; la brume prend la couleur de l'horizon. */
  zenith: number;
  horizon: number;
  /** Portée de la brume, relative au temps clair (1) : plus petite, la ville s'efface plus tôt. */
  portee: number;
  /** Éclairage du sol et des sprites (multiplicateur, 1 = plein jour). */
  lumiere: number;
  /** Teinte de cet éclairage (bleutée la nuit, dorée au crépuscule). */
  teinte: number;
  soleil: { intensite: number; couleur: number };
  /** Lumière diffuse du ciel. */
  diffuse: number;
  precipitation: { sorte: 'pluie' | 'neige'; densite: number } | null;
  eclairs: boolean;
  nuit: boolean;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Hauteur du soleil au-dessus de l'horizon (degrés), formules simplifiées de l'Almanach
 * astronomique (précision ≈ 0,1° : largement assez pour la couleur d'un ciel).
 */
export function hauteurDuSoleil([lon, lat]: Position, instant: Date): number {
  const d = instant.getTime() / 86_400_000 - 10_957.5; // jours depuis J2000.0
  const g = rad(357.529 + 0.98560028 * d);
  const q = 280.459 + 0.98564736 * d;
  const longitude = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const obliquite = rad(23.439 - 0.00000036 * d);
  const ascensionDroite = Math.atan2(Math.cos(obliquite) * Math.sin(longitude), Math.cos(longitude));
  const declinaison = Math.asin(Math.sin(obliquite) * Math.sin(longitude));
  const tempsSideral = rad(((18.697374558 + 24.06570982441908 * d) * 15 + lon) % 360);
  const angleHoraire = tempsSideral - ascensionDroite;
  const phi = rad(lat);
  return deg(Math.asin(Math.sin(phi) * Math.sin(declinaison) + Math.cos(phi) * Math.cos(declinaison) * Math.cos(angleHoraire)));
}

// ---------------------------------------------------------------------------
// Couleurs.

type Rvb = [number, number, number];
const versRvb = (c: number): Rvb => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const versNombre = ([r, v, b]: Rvb) => (Math.round(r) << 16) | (Math.round(v) << 8) | Math.round(b);
const melanger = (a: number, b: number, t: number): number => {
  const x = versRvb(a);
  const y = versRvb(b);
  return versNombre([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
const assombrir = (c: number, k: number) => melanger(0x000000, c, k);
const borner = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));
const lisse = (a: number, b: number, x: number) => {
  const t = borner((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface Palette {
  /** Ciel de jour, zénith et horizon. */
  zenith: number;
  horizon: number;
  /** Ciel de nuit. */
  nuitZenith: number;
  nuitHorizon: number;
  /** Part du soleil qui passe (1 : ciel dégagé). */
  clarte: number;
  portee: number;
}

const PALETTES: Record<Ciel, Palette> = {
  degage: { zenith: 0x3b8ad6, horizon: 0xb4d9f2, nuitZenith: 0x0a1426, nuitHorizon: 0x1c2c4a, clarte: 1, portee: 1 },
  'peu-nuageux': { zenith: 0x5596d2, horizon: 0xc4dcec, nuitZenith: 0x0f1828, nuitHorizon: 0x223049, clarte: 0.85, portee: 1 },
  nuageux: { zenith: 0x8aa3ba, horizon: 0xc6d1da, nuitZenith: 0x151b25, nuitHorizon: 0x262e3b, clarte: 0.55, portee: 0.85 },
  couvert: { zenith: 0x9ca3aa, horizon: 0xbfc4c9, nuitZenith: 0x1a1d22, nuitHorizon: 0x2b2f35, clarte: 0.25, portee: 0.7 },
  brouillard: { zenith: 0xb8bcbf, horizon: 0xc8cbcd, nuitZenith: 0x24272b, nuitHorizon: 0x34383c, clarte: 0.2, portee: 0.22 },
};
/** Sans météo publiée : le ciel pâle d'avant la météo. */
const PALETTE_INCONNUE: Palette = { ...PALETTES['peu-nuageux'], zenith: 0xa9c6dc, horizon: 0xcfdde6 };

const HORIZON_CREPUSCULE = 0xf2a061;
const ZENITH_CREPUSCULE = 0x46598f;
const SOLEIL_BAS = 0xffa65c;
const SOLEIL_HAUT = 0xfff4e0;
const TEINTE_NUIT = 0x8fa3d6;
const TEINTE_CREPUSCULE = 0xffd2a8;

/** Portée de la brume selon la précipitation et sa force (0, 1, 2). */
const PORTEE_PRECIPITATION = { aucune: [1, 1, 1], bruine: [0.85, 0.8, 0.75], pluie: [0.8, 0.65, 0.5], orage: [0.65, 0.55, 0.45], neige: [0.7, 0.5, 0.35] } as const;

export function ambiance(meteo: MeteoPubliee | undefined, position: Position, instant: Date): Ambiance {
  const hauteur = hauteurDuSoleil(position, instant);
  const palette = meteo ? PALETTES[meteo.ciel] : PALETTE_INCONNUE;
  const precipitation = meteo?.precipitation ?? 'aucune';
  const intensite = meteo?.intensite ?? 0;

  // Jour : 0 sous −6° (nuit civile), 1 au-dessus de 8°.
  const jour = lisse(-6, 8, hauteur);
  // Crépuscule : soleil près de l'horizon, visible seulement si le ciel est assez dégagé.
  const crepuscule = Math.max(0, 1 - Math.abs(hauteur - 1) / 7) * palette.clarte;
  // Précipitations : ciel plus sombre (la neige, elle, éclaircit).
  const voile = precipitation === 'aucune' ? 1 : precipitation === 'neige' ? 1.05 : 0.86 - intensite * 0.06;

  let zenith = melanger(palette.nuitZenith, palette.zenith, jour);
  let horizon = melanger(palette.nuitHorizon, palette.horizon, jour);
  zenith = melanger(zenith, ZENITH_CREPUSCULE, crepuscule * 0.5);
  horizon = melanger(horizon, HORIZON_CREPUSCULE, crepuscule * 0.75);
  if (voile < 1) {
    zenith = assombrir(zenith, voile);
    horizon = assombrir(horizon, voile);
  } else if (voile > 1) {
    zenith = melanger(zenith, 0xffffff, voile - 1);
    horizon = melanger(horizon, 0xffffff, voile - 1);
  }

  const lumiere = (0.5 + 0.5 * jour) * (precipitation === 'aucune' || precipitation === 'neige' ? 1 : 0.9);
  const teinte = melanger(melanger(TEINTE_NUIT, 0xffffff, jour), TEINTE_CREPUSCULE, crepuscule * 0.6);

  const sorte = precipitation === 'aucune' ? null : precipitation === 'neige' ? 'neige' : 'pluie';
  const densite = precipitation === 'bruine' ? 0.2 + intensite * 0.1 : (intensite + 1) / 3;

  return {
    zenith,
    horizon,
    portee: palette.portee * PORTEE_PRECIPITATION[precipitation][intensite],
    lumiere,
    teinte,
    soleil: {
      intensite: 1.6 * lisse(-2, 10, hauteur) * palette.clarte,
      couleur: melanger(SOLEIL_BAS, SOLEIL_HAUT, lisse(0, 25, hauteur)),
    },
    diffuse: 2.2 * (0.28 + 0.72 * jour),
    precipitation: sorte ? { sorte, densite } : null,
    eclairs: precipitation === 'orage',
    nuit: hauteur < -6,
  };
}

// ---------------------------------------------------------------------------
// Résumé en mots, pour la liste des manifs et l'en-tête de la vue.

const LIBELLES_CIEL: Record<Ciel, string> = {
  degage: 'Ensoleillé',
  'peu-nuageux': 'Éclaircies',
  nuageux: 'Nuageux',
  couvert: 'Couvert',
  brouillard: 'Brouillard',
};
const LIBELLES_PRECIPITATION = { bruine: 'bruine', pluie: 'pluie', neige: 'neige', orage: 'orage' } as const;
const FORCES = ['Faible', '', 'Forte'] as const;

export type IconeMeteo = 'soleil' | 'lune' | 'eclaircies' | 'nuages' | 'brouillard' | 'pluie' | 'neige' | 'orage';

export function resumeMeteo(meteo: MeteoPubliee, position: Position, instant: Date): { texte: string; icone: IconeMeteo } {
  const nuit = hauteurDuSoleil(position, instant) < -6;
  let mots: string;
  let icone: IconeMeteo;
  if (meteo.precipitation !== 'aucune') {
    const nom = LIBELLES_PRECIPITATION[meteo.precipitation];
    const force = meteo.precipitation === 'orage' ? '' : FORCES[meteo.intensite];
    mots = force ? `${force} ${nom}` : nom.charAt(0).toUpperCase() + nom.slice(1);
    icone = meteo.precipitation === 'bruine' ? 'pluie' : meteo.precipitation;
  } else if (meteo.ciel === 'degage') {
    mots = nuit ? 'Nuit claire' : LIBELLES_CIEL.degage;
    icone = nuit ? 'lune' : 'soleil';
  } else {
    mots = LIBELLES_CIEL[meteo.ciel];
    icone = meteo.ciel === 'peu-nuageux' ? (nuit ? 'lune' : 'eclaircies') : meteo.ciel === 'brouillard' ? 'brouillard' : 'nuages';
  }
  const t = Math.round(meteo.temperatureC) || 0; // pas de « −0 »
  return { texte: `${mots}, ${t < 0 ? `−${-t}` : t} °C`, icone };
}
