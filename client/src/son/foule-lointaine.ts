/**
 * Foule lointaine : des dizaines de voix inintelligibles qui se fondent en une rumeur de
 * conversations, comme au milieu d'un cortège. Trop de voix pour les synthétiser en
 * direct sur un téléphone : on les rend une fois, hors temps réel (OfflineAudioContext,
 * sur le fil audio du navigateur), avec le même synthétiseur que les voix proches
 * (`moteur-voix.ts`), dans un tampon de quelques secondes que la scène joue en boucle.
 *
 * Toujours de la synthèse (ADR 0008) : aucun échantillon, aucun fichier, rien de
 * téléchargé. Les locuteurs y sont « sobres » (ni rire ni hésitation) : un rire
 * reconnaissable qui reviendrait à chaque tour de boucle trahirait la répétition.
 */
import { combinerGraines } from './alea';
import { bruitRose } from './bruit';
import { LOCUTEURS_MAX } from './brouhaha-voix';
import { creerBrouhahaVoix } from './moteur-voix';

/** Durée de la boucle (s). */
export const FOULE_DUREE_S = 14;
/** Recouvrement du raccord de la boucle (s). */
const FONDU_S = 2;
/** Début du rendu jeté : le temps que toutes les voix aient commencé à parler. */
const PREAMBULE_S = 3;
/** Groupes de LOCUTEURS_MAX voix chacun (16 voix, doublées par deux lectures décalées). */
const GROUPES = 2;
/** Taux d'échantillonnage du rendu : la rumeur est sourde, inutile de calculer les aigus. */
const TAUX = 22_050;
/** Niveau efficace du tampon rendu, pour que la scène le dose sans surprise. */
const NIVEAU_EFFICACE = 0.1;

type ConstructeurHorsLigne = new (canaux: number, longueur: number, taux: number) => OfflineAudioContext;

function constructeurHorsLigne(): ConstructeurHorsLigne | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: ConstructeurHorsLigne }).webkitOfflineAudioContext
  );
}

/** Rendu hors ligne, y compris par les anciens Safari (événement `complete`, sans promesse). */
function rendre(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    const promesse = ctx.startRendering() as Promise<AudioBuffer> | undefined;
    promesse?.then(resolve, reject);
  });
}

let enCache: Promise<AudioBuffer | null> | null = null;

/** Tampon de la foule lointaine : rendu une fois par page, puis gardé. `null` si impossible. */
export function fouleLointaine(): Promise<AudioBuffer | null> {
  enCache ??= rendreFouleLointaine(Math.floor(Math.random() * 2 ** 31)).catch(() => null);
  return enCache;
}

export async function rendreFouleLointaine(
  graine: number,
  Constructeur: ConstructeurHorsLigne | undefined = constructeurHorsLigne(),
): Promise<AudioBuffer | null> {
  if (!Constructeur) return null;
  const longueur = Math.round((PREAMBULE_S + FOULE_DUREE_S + FONDU_S) * TAUX);
  const ctx = new Constructeur(2, longueur, TAUX);
  const bruit = bruitRose(ctx, 4);
  for (let g = 0; g < GROUPES; g++) {
    const voix = creerBrouhahaVoix(
      ctx,
      bruit,
      { proche: ctx.destination, lointain: ctx.destination },
      combinerGraines(graine, g),
      { expressif: false },
    );
    voix.regler({ voix: 1, locuteurs: LOCUTEURS_MAX }, true);
    voix.programmer(0, longueur / TAUX);
  }
  return boucler(ctx, await rendre(ctx));
}

/**
 * Tampon bouclable : on jette le préambule, et la fin du rendu (après FOULE_DUREE_S) se
 * fond dans le début, à puissance constante (les deux bouts ne sont pas corrélés).
 */
function boucler(ctx: BaseAudioContext, rendu: AudioBuffer): AudioBuffer {
  const n = Math.round(FOULE_DUREE_S * rendu.sampleRate);
  const fondu = Math.round(FONDU_S * rendu.sampleRate);
  const debut = Math.round(PREAMBULE_S * rendu.sampleRate);
  const boucle = ctx.createBuffer(rendu.numberOfChannels, n, rendu.sampleRate);
  let energie = 0;
  for (let c = 0; c < rendu.numberOfChannels; c++) {
    const source = rendu.getChannelData(c);
    const cible = boucle.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let x = source[debut + i]!;
      if (i < fondu) {
        const angle = (i / fondu) * (Math.PI / 2);
        x = x * Math.sin(angle) + source[debut + n + i]! * Math.cos(angle);
      }
      cible[i] = x;
      energie += x * x;
    }
  }
  const efficace = Math.sqrt(energie / (n * rendu.numberOfChannels));
  if (efficace > 0) {
    const facteur = NIVEAU_EFFICACE / efficace;
    for (let c = 0; c < boucle.numberOfChannels; c++) {
      const d = boucle.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i]! *= facteur;
    }
  }
  return boucle;
}
