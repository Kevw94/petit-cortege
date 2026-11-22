/**
 * Moteur de son : tout est synthétisé dans le navigateur avec la Web Audio API
 * (ADR 0008). Aucun fichier audio, aucun échantillon, aucune requête réseau.
 *
 * - L'AudioContext est créé paresseusement, au premier geste du soutien (politique
 *   d'autoplay des navigateurs), et seulement si le son n'est pas coupé.
 * - Une seule « scène » sonore à la fois : musique d'accueil, ambiance de manif, ou
 *   silence. Changer de scène fait un fondu court (pas de clic audible).
 * - Onglet caché ou son coupé : fondu, arrêt des minuteries, contexte suspendu.
 *
 * Les données (partition, chants, réglages d'ambiance) viennent des modules purs voisins.
 */
import { aleaDepuis, combinerGraines, frequenceMidi, type Alea } from './alea';
import { reponseRue } from './acoustique';
import { balancementDouble, creerBatucada, presenceBatucada, TEMPO_MARCHE, TEMPS_PAR_MESURE } from './batucada';
import { bruitRose } from './bruit';
import { programmeChant } from './chants';
import { fouleLointaine } from './foule-lointaine';
import {
  creerPercussions,
  jouerAtterrissage,
  jouerClameur,
  jouerDeclencheur,
  jouerMainsFoule,
  jouerPose,
  rafale as rafaleDe,
  type OptionsRafale,
} from './frappes';
import { TEMPO_DANSE_PAR_S } from '../cortege/marche';
import {
  instantDuTempsDeDanse,
  MARCHEURS_MAX,
  marcheursProches,
  posesDePied,
  premierTempsDeDanse,
} from './rythme-foule';
import type { ReglagesAmbiance } from './ambiance';
import type { EvenementChant, ProgrammeChant, Voyelle } from './chants';
import { creerBrouhahaVoix } from './moteur-voix';
import { creerPartitionAccueil, MESURE_ACCUEIL_S, type NoteAccueil } from './partition-accueil';

export type SceneSon = 'silence' | 'accueil' | 'manif';

export interface MoteurSon {
  readonly actif: boolean;
  /** Vrai dès que le contexte audio a tourné une fois (un geste l'a débloqué). */
  readonly demarre: boolean;
  /** Active ou coupe le son (appelé depuis un geste : le bouton de son). */
  activer(actif: boolean): void;
  /** Premier geste du soutien : crée et démarre le contexte audio si le son est activé. */
  debloquer(): void;
  /** Scène sonore voulue pour la vue affichée. */
  scene(scene: SceneSon): void;
  /** Réglages de l'ambiance de manif (≈ 1 fois par seconde au plus). */
  reglerAmbiance(reglages: ReglagesAmbiance): void;
  /**
   * Joue un chant dans la scène courante. Renvoie le délai (s) avant son début, pour
   * caler l'affichage, ou `null` si aucun son ne sort (coupé, pas encore de geste…).
   */
  jouerChant(programme: ProgrammeChant): number | null;
  /** La photo finale est prise : déclencheur, puis la foule crie et applaudit (hors scène). */
  jouerPhoto(): void;
}

/** Volume général, modéré. */
const VOLUME_GENERAL = 0.5;
const FONDU_ENTREE_S = 0.9;
const FONDU_SORTIE_S = 0.35;
/** Fenêtre de programmation des événements à venir, et période de la minuterie. */
const AVANCE_S = 1.2;
const PERIODE_MS = 250;

/** Sorties d'une scène, toutes deux sous son fondu : direct et envoi vers la réverbération. */
interface Sorties {
  sortie: GainNode;
  envoi: GainNode;
}

interface Scene extends Sorties {
  nom: Exclude<SceneSon, 'silence'>;
  arreter(): void;
  /** Baisse un peu le fond de voix le temps d'un chant (ambiance de manif seulement). */
  baisserPourChant?(debut: number, duree: number): void;
}

interface Bus {
  ctx: AudioContext;
  maitre: GainNode;
  /** Envoi vers la réverbération par délais. */
  reverb: GainNode;
  bruit: AudioBuffer;
}

export function creerMoteurSon(actifAuDepart: boolean): MoteurSon {
  let actif = actifAuDepart;
  let debloque = false;
  let voulue: SceneSon = 'silence';
  let bus: Bus | null = null;
  let courante: Scene | null = null;
  let reglages: ReglagesAmbiance | null = null;
  let minuterieSuspension: ReturnType<typeof setTimeout> | undefined;
  let demarre = false;

  const contexte = (): Bus | null => {
    if (bus) return bus;
    const Constructeur =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructeur) return null;
    try {
      const ctx = new Constructeur({ latencyHint: 'playback' });
      const noter = () => {
        if (ctx.state === 'running') demarre = true;
      };
      ctx.addEventListener('statechange', noter);
      noter();
      bus = construireBus(ctx);
    } catch {
      return null;
    }
    return bus;
  };

  const doitJouer = () => actif && debloque && !document.hidden && voulue !== 'silence';

  const synchroniser = () => {
    if (!doitJouer()) {
      const b = bus;
      if (!b) return;
      arreterScene();
      if (minuterieSuspension === undefined && b.ctx.state === 'running') {
        // Le temps du fondu, puis contexte suspendu (pas de minuterie ni de calcul audio).
        minuterieSuspension = setTimeout(
          () => {
            minuterieSuspension = undefined;
            if (!doitJouer()) void b.ctx.suspend().catch(() => {});
          },
          (FONDU_SORTIE_S + 0.1) * 1000,
        );
      }
      return;
    }
    const b = contexte();
    if (!b) return;
    clearTimeout(minuterieSuspension);
    minuterieSuspension = undefined;
    if (b.ctx.state !== 'running') void b.ctx.resume().catch(() => {});
    if (courante?.nom === voulue) return;
    arreterScene();
    courante = voulue === 'accueil' ? sceneAccueil(b) : sceneManif(b, () => reglages);
  };

  const arreterScene = () => {
    courante?.arreter();
    courante = null;
  };

  document.addEventListener('visibilitychange', synchroniser);

  return {
    get actif() {
      return actif;
    },
    get demarre() {
      return demarre;
    },
    activer(nouveau) {
      actif = nouveau;
      if (actif) debloque = true; // le bouton est un geste
      synchroniser();
    },
    debloquer() {
      debloque = true;
      if (!actif) return;
      const b = contexte();
      // Dans le geste lui-même : certains navigateurs n'acceptent la reprise qu'ici.
      if (b && b.ctx.state !== 'running') void b.ctx.resume().catch(() => {});
      synchroniser();
    },
    scene(nouvelle) {
      voulue = nouvelle;
      synchroniser();
    },
    reglerAmbiance(nouveaux) {
      reglages = nouveaux;
    },
    jouerChant(programme) {
      if (!doitJouer() || !bus || bus.ctx.state !== 'running' || !courante) return null;
      const delai = 0.12;
      jouerProgrammeChant(bus, courante, programme, bus.ctx.currentTime + delai);
      courante.baisserPourChant?.(bus.ctx.currentTime + delai, programme.duree);
      return delai + (bus.ctx.outputLatency || bus.ctx.baseLatency || 0);
    },
    jouerPhoto() {
      if (!doitJouer() || !bus || bus.ctx.state !== 'running') return;
      // Sur le bus général : la clameur continue pendant que la scène passe à l'image finale.
      const t = bus.ctx.currentTime + 0.02;
      const alea = aleaDepuis(Math.floor(Math.random() * 2 ** 31));
      jouerDeclencheur(bus.ctx, bus.bruit, bus.maitre, t);
      jouerClameur(bus.ctx, bus.maitre, t + 0.3, 1.4, alea);
      jouerApplaudissements(bus, bus.maitre, t + 0.45, 1);
    },
  };
}

/** Bus général : volume, compresseur doux, réverbération par deux délais en boucle filtrée. */
function construireBus(ctx: AudioContext): Bus {
  const compresseur = ctx.createDynamicsCompressor();
  compresseur.threshold.value = -18;
  compresseur.ratio.value = 3;
  compresseur.connect(ctx.destination);
  const maitre = ctx.createGain();
  maitre.gain.value = VOLUME_GENERAL;
  maitre.connect(compresseur);

  const reverb = ctx.createGain();
  reverb.gain.value = 0.5;
  for (const [duree, retour] of [
    [0.173, 0.38],
    [0.291, 0.34],
  ] as const) {
    const delai = ctx.createDelay(1);
    delai.delayTime.value = duree;
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = 2200;
    const boucle = ctx.createGain();
    boucle.gain.value = retour;
    reverb.connect(delai);
    delai.connect(filtre);
    filtre.connect(boucle);
    boucle.connect(delai);
    filtre.connect(maitre);
  }
  return { ctx, maitre, reverb, bruit: bruitRose(ctx, 4) };
}

/**
 * Sorties d'une scène (direct et envoi vers la réverbération), qui montent en fondu ;
 * `fermer` les redescend ensemble (la réverbération s'éteint sans coupure), puis libère.
 */
function sortiesDeScene(b: Bus, reverb: AudioNode = b.reverb): Sorties & { fermer(liberer: () => void): void } {
  const { ctx } = b;
  const sortie = ctx.createGain();
  const envoi = ctx.createGain();
  sortie.connect(b.maitre);
  envoi.connect(reverb);
  for (const g of [sortie, envoi]) {
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + FONDU_ENTREE_S);
  }
  return {
    sortie,
    envoi,
    fermer(liberer) {
      const t = ctx.currentTime;
      for (const g of [sortie, envoi]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + FONDU_SORTIE_S);
      }
      setTimeout(
        () => {
          liberer();
          sortie.disconnect();
          envoi.disconnect();
        },
        (FONDU_SORTIE_S + 0.1) * 1000,
      );
    },
  };
}

/** Branche `noeud` sur les sorties d'une scène : en direct, et vers la réverbération (part `envoi`). */
function brancher(ctx: AudioContext, noeud: AudioNode, scene: Sorties, envoi: number): void {
  noeud.connect(scene.sortie);
  if (envoi > 0) {
    const g = ctx.createGain();
    g.gain.value = envoi;
    noeud.connect(g);
    g.connect(scene.envoi);
  }
}

// ---------------------------------------------------------------------------
// Musique d'accueil

function sceneAccueil(b: Bus): Scene {
  const { ctx } = b;
  const sorties = sortiesDeScene(b);
  // Filtre doux commun : timbres ronds.
  const douceur = ctx.createBiquadFilter();
  douceur.type = 'lowpass';
  douceur.frequency.value = 2400;
  douceur.Q.value = 0.3;
  brancher(ctx, douceur, sorties, 0.55);
  const partition = creerPartitionAccueil(Math.floor(Math.random() * 2 ** 31));
  let n = 0;
  let debut = ctx.currentTime + 0.15;
  const programmer = () => {
    if (debut < ctx.currentTime - 0.5) debut = ctx.currentTime + 0.05; // onglet ralenti
    while (debut < ctx.currentTime + AVANCE_S) {
      for (const note of partition.mesure(n)) jouerNoteAccueil(ctx, douceur, note, debut);
      n++;
      debut += MESURE_ACCUEIL_S;
    }
  };
  programmer();
  const minuterie = setInterval(programmer, PERIODE_MS);
  return {
    nom: 'accueil',
    sortie: sorties.sortie,
    envoi: sorties.envoi,
    arreter() {
      clearInterval(minuterie);
      sorties.fermer(() => douceur.disconnect());
    },
  };
}

function jouerNoteAccueil(ctx: AudioContext, sortie: AudioNode, note: NoteAccueil, debutMesure: number): void {
  const t0 = debutMesure + note.debut;
  const f = frequenceMidi(note.note);
  const enveloppe = ctx.createGain();
  enveloppe.connect(sortie);
  const g = enveloppe.gain;
  g.setValueAtTime(0, t0);
  const oscillateurs: OscillatorNode[] = [];
  const osc = (type: OscillatorType, frequence: number, desaccord = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequence;
    o.detune.value = desaccord;
    o.connect(enveloppe);
    oscillateurs.push(o);
  };
  let fin: number;
  switch (note.voix) {
    case 'nappe': {
      // Nappe : sinus + triangle légèrement désaccordés, attaque et extinction lentes.
      osc('sine', f, -4);
      osc('triangle', f, 5);
      const pic = note.velocite * 0.035;
      g.linearRampToValueAtTime(pic, t0 + 1.6);
      g.setValueAtTime(pic, t0 + note.duree - 1.8);
      fin = t0 + note.duree + 0.4;
      g.linearRampToValueAtTime(0, fin);
      break;
    }
    case 'basse': {
      osc('sine', f);
      const pic = note.velocite * 0.11;
      g.linearRampToValueAtTime(pic, t0 + 0.9);
      g.setValueAtTime(pic, t0 + note.duree - 1.5);
      fin = t0 + note.duree;
      g.linearRampToValueAtTime(0, fin);
      break;
    }
    case 'arpege': {
      // Arpège : triangle pincé (attaque brève, extinction exponentielle).
      osc('triangle', f);
      osc('sine', f * 2, 3);
      const pic = note.velocite * 0.07;
      g.linearRampToValueAtTime(pic, t0 + 0.015);
      fin = t0 + Math.max(0.4, note.duree);
      g.setTargetAtTime(0, t0 + 0.03, (fin - t0) / 4);
      fin += 0.3;
      break;
    }
  }
  for (const o of oscillateurs) {
    o.start(t0);
    o.stop(fin);
  }
  oscillateurs[0]!.onended = () => enveloppe.disconnect();
}

// ---------------------------------------------------------------------------
// Ambiance de manif

/** Coupure des voix proches (presque tout le spectre) et lointaines (assourdies par la distance). */
const VOIX_PROCHES_HZ = 6000;
const VOIX_LOINTAINES_HZ = 2000;

/** Niveau du retour de la réverbération de rue (la réponse est normalisée par le navigateur). */
const NIVEAU_RUE = 0.55;
/** Niveau de la foule lointaine (tampon à 0,1 efficace) quand `foule` vaut 1. */
const NIVEAU_FOULE = 0.2;
const DELAI_FOULE_MS = 1_500;
/** Pendant un chant, toute l'ambiance baisse (les voix plus encore) : le sien passe devant. */
const BAISSE_AMBIANCE_CHANT = 0.55;
/** Niveau du bruit de foule (souffle continu) : la rumeur de voix porte maintenant l'essentiel. */
const NIVEAU_BROUHAHA = 0.25;

/** Niveau du bus des événements (pas, sifflets, applaudissements, clameurs). */
const NIVEAU_EVENEMENTS = 0.7;
/** Pas des voisins (talon + semelle). */
const VOLUME_PAS = 0.07;
/** Niveau du groupe de percussions quand `percussions` vaut 1 et qu'il est tout près. */
const VOLUME_BATUCADA = 0.8;

const REGLAGES_PAR_DEFAUT: ReglagesAmbiance = {
  allure: 'arret',
  proximite: 1,
  chantsLointainsParMinute: 0,
  foule: 0.2,
  brouhaha: 0.25,
  coupureHz: 800,
  pasParSeconde: 0.5,
  percussions: 0,
  evenementsParMinute: 1,
  voix: 0.2,
  locuteurs: 1,
};

function sceneManif(b: Bus, lireReglages: () => ReglagesAmbiance | null): Scene {
  const { ctx } = b;
  // Acoustique de rue : réverbération à convolution (réponse synthétique, `acoustique.ts`).
  const rue = ctx.createConvolver();
  const [gauche, droite] = reponseRue({ taux: ctx.sampleRate, graine: Math.floor(Math.random() * 2 ** 31) });
  const reponse = ctx.createBuffer(2, gauche.length, ctx.sampleRate);
  reponse.copyToChannel(gauche, 0);
  reponse.copyToChannel(droite, 1);
  rue.buffer = reponse;
  const retourRue = ctx.createGain();
  retourRue.gain.value = NIVEAU_RUE;
  rue.connect(retourRue);
  retourRue.connect(b.maitre);
  const sorties = sortiesDeScene(b, rue);
  // L'ambiance passe par ses propres sorties : elle baisse pendant un chant, pas le chant.
  const ambiance: Sorties = { sortie: ctx.createGain(), envoi: ctx.createGain() };
  ambiance.sortie.connect(sorties.sortie);
  ambiance.envoi.connect(sorties.envoi);
  const sources: AudioScheduledSourceNode[] = [];
  const noeuds: AudioNode[] = [ambiance.sortie, ambiance.envoi];
  let arretee = false;

  // Brouhaha : bruit rose en trois bandes (comme des formants de voix mêlées), chacune
  // modulée lentement par son propre oscillateur basse fréquence.
  const coupure = ctx.createBiquadFilter();
  coupure.type = 'lowpass';
  coupure.frequency.value = REGLAGES_PAR_DEFAUT.coupureHz;
  const volumeBrouhaha = ctx.createGain();
  volumeBrouhaha.gain.value = 0;
  coupure.connect(volumeBrouhaha);
  brancher(ctx, volumeBrouhaha, ambiance, 0.25);
  noeuds.push(coupure, volumeBrouhaha);
  for (const [centre, q, vitesse, part] of [
    [380, 0.9, 0.07, 1],
    [900, 1.2, 0.11, 0.7],
    [2100, 1.6, 0.05, 0.3],
  ] as const) {
    const source = ctx.createBufferSource();
    source.buffer = b.bruit;
    source.loop = true;
    const bande = ctx.createBiquadFilter();
    bande.type = 'bandpass';
    bande.frequency.value = centre;
    bande.Q.value = q;
    const niveau = ctx.createGain();
    niveau.gain.value = part;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vitesse;
    const profondeur = ctx.createGain();
    profondeur.gain.value = part * 0.35;
    lfo.connect(profondeur);
    profondeur.connect(niveau.gain);
    source.connect(bande);
    bande.connect(niveau);
    niveau.connect(coupure);
    source.start(ctx.currentTime, Math.random() * b.bruit.duration);
    lfo.start();
    sources.push(source, lfo);
    noeuds.push(bande, niveau, profondeur);
  }

  // Bus des événements ponctuels (pas, percussions, sifflet, applaudissements).
  const evenements = ctx.createGain();
  evenements.gain.value = NIVEAU_EVENEMENTS;
  brancher(ctx, evenements, ambiance, 0.3);
  noeuds.push(evenements);

  // Conversations inintelligibles, sous le reste (ADR 0008) : une voix par locuteur. Les
  // voisins sont nets et peu réverbérés ; les voix plus loin, assourdies et noyées dans la rue.
  const plans = (
    [
      [VOIX_PROCHES_HZ, 0.18],
      [VOIX_LOINTAINES_HZ, 0.6],
    ] as const
  ).map(([coupureHz, envoi]) => {
    const entree = ctx.createGain();
    const eloigner = ctx.createBiquadFilter();
    eloigner.type = 'lowpass';
    eloigner.frequency.value = coupureHz;
    eloigner.Q.value = 0;
    entree.connect(eloigner);
    brancher(ctx, eloigner, ambiance, envoi);
    noeuds.push(entree, eloigner);
    return entree;
  });
  const voix = creerBrouhahaVoix(
    ctx,
    b.bruit,
    { proche: plans[0]!, lointain: plans[1]! },
    Math.floor(Math.random() * 2 ** 31),
  );
  sources.push(...voix.sources);
  noeuds.push(...voix.noeuds);

  // Foule lointaine : des dizaines de voix rendues hors ligne, jouées en boucle (deux
  // lectures décalées, l'une un peu plus lente et plus grave : deux foules différentes).
  const foule = ctx.createGain();
  foule.gain.value = 0;
  const fouleAssourdie = ctx.createBiquadFilter();
  fouleAssourdie.type = 'lowpass';
  fouleAssourdie.frequency.value = REGLAGES_PAR_DEFAUT.coupureHz * 1.4;
  foule.connect(fouleAssourdie);
  brancher(ctx, fouleAssourdie, ambiance, 0.6);
  noeuds.push(foule, fouleAssourdie);
  // Rendu un peu après l'entrée dans la vue : la vue 3D se charge d'abord.
  const minuterieFoule = setTimeout(() => {
    void fouleLointaine().then((tampon) => {
      if (!tampon || arretee) return;
      // Entrée en fondu : la rumeur monte doucement, quel que soit le temps qu'a pris le rendu.
      const entreeFoule = ctx.createGain();
      entreeFoule.gain.setValueAtTime(0, ctx.currentTime);
      entreeFoule.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
      entreeFoule.connect(foule);
      noeuds.push(entreeFoule);
      for (const [vitesse, pan] of [
        [1, -0.4],
        [0.94, 0.4],
      ] as const) {
        const lecture = ctx.createBufferSource();
        lecture.buffer = tampon;
        lecture.loop = true;
        lecture.playbackRate.value = vitesse;
        let place: AudioNode;
        if (ctx.createStereoPanner) {
          const panneau = ctx.createStereoPanner();
          panneau.pan.value = pan;
          place = panneau;
        } else place = ctx.createGain(); // anciens Safari : pas de panoramique
        lecture.connect(place);
        place.connect(entreeFoule);
        lecture.start(ctx.currentTime + 0.05, Math.random() * tampon.duration);
        sources.push(lecture);
        noeuds.push(place);
      }
    });
  }, DELAI_FOULE_MS);

  // Batucada : un groupe qui va et vient pendant la marche, tout près pendant la danse.
  const graineScene = Math.floor(Math.random() * 2 ** 31);
  const alea = aleaDepuis(combinerGraines(graineScene, 2));
  const groupe = ctx.createGain();
  const groupeAssourdi = ctx.createBiquadFilter();
  groupeAssourdi.type = 'lowpass';
  groupeAssourdi.frequency.value = 600;
  groupeAssourdi.Q.value = 0;
  const groupeNiveau = ctx.createGain();
  groupeNiveau.gain.value = 0;
  const groupeEnvoi = ctx.createGain();
  groupeEnvoi.gain.value = 0.7;
  groupe.connect(groupeAssourdi);
  const groupePan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (groupePan) {
    groupeAssourdi.connect(groupePan);
    groupePan.connect(groupeNiveau);
  } else groupeAssourdi.connect(groupeNiveau);
  groupeNiveau.connect(ambiance.sortie);
  groupeNiveau.connect(groupeEnvoi);
  groupeEnvoi.connect(ambiance.envoi);
  const percussions = creerPercussions(ctx, b.bruit, groupe);
  sources.push(...percussions.sources);
  noeuds.push(...percussions.noeuds, groupe, groupeAssourdi, groupeNiveau, groupeEnvoi);
  if (groupePan) noeuds.push(groupePan);
  const batucadaMarche = creerBatucada(graineScene);
  const batucadaDanse = creerBatucada(combinerGraines(graineScene, 1), { breaks: false });
  let mesureMarche = 0;
  let debutMesureMarche = ctx.currentTime + 0.5;
  /** Prochain temps (entier, début de mesure) de la danse à programmer. */
  let tempsDanse: number | null = null;
  /** Dernières valeurs appliquées au groupe : on ne reprogramme que ce qui a bougé. */
  const groupeApplique = { niveau: -1, presence: -1, pan: -2 };
  const reglerGroupe = (niveau: number, presence: number, pan: number, maintenant: number) => {
    if (Math.abs(niveau - groupeApplique.niveau) > 0.005) {
      groupeNiveau.gain.setTargetAtTime(niveau * VOLUME_BATUCADA, maintenant, 0.8);
      groupeApplique.niveau = niveau;
    }
    if (Math.abs(presence - groupeApplique.presence) > 0.005) {
      groupeAssourdi.frequency.setTargetAtTime(500 + 5500 * presence ** 2, maintenant, 0.8);
      groupeEnvoi.gain.setTargetAtTime(0.9 - 0.6 * presence, maintenant, 0.8);
      groupeApplique.presence = presence;
    }
    if (groupePan && Math.abs(pan - groupeApplique.pan) > 0.02) {
      groupePan.pan.setTargetAtTime(pan, maintenant, 2);
      groupeApplique.pan = pan;
    }
  };

  const marcheurs = marcheursProches(graineScene);
  let horizonPas = ctx.currentTime;
  let reglagesAppliques: ReglagesAmbiance | null = null;
  let prochainPas = ctx.currentTime + 0.3;
  let prochainEvenement = ctx.currentTime + 4 + Math.random() * 6;
  let prochainChantLointain = ctx.currentTime + 15 + 25 * Math.random();
  let numeroChantLointain = Math.floor(Math.random() * 1000);

  const programmer = () => {
    const r = lireReglages() ?? REGLAGES_PAR_DEFAUT;
    const maintenant = ctx.currentTime;
    if (r !== reglagesAppliques) {
      // Transitions lentes (constante de temps ≈ 1,5 s) : la foule enfle sans à-coup.
      volumeBrouhaha.gain.setTargetAtTime(r.brouhaha * NIVEAU_BROUHAHA, maintenant, 1.5);
      coupure.frequency.setTargetAtTime(r.coupureHz, maintenant, 1.5);
      foule.gain.setTargetAtTime(r.foule * NIVEAU_FOULE, maintenant, 1.5);
      fouleAssourdie.frequency.setTargetAtTime(r.coupureHz * 1.4, maintenant, 1.5);
      // Sifflets, clameurs, pas : plus discrets vus de loin.
      evenements.gain.setTargetAtTime(NIVEAU_EVENEMENTS * (0.35 + 0.65 * r.proximite), maintenant, 1.5);
      voix.regler(r);
      reglagesAppliques = r;
    }
    const horizon = maintenant + AVANCE_S;
    voix.programmer(maintenant, horizon);
    if (prochainPas < maintenant - 1) prochainPas = maintenant;
    if (horizonPas < maintenant - 1) horizonPas = maintenant;
    if (prochainEvenement < maintenant - 1) prochainEvenement = maintenant + 2;
    if (prochainChantLointain < maintenant - 1) prochainChantLointain = maintenant + 5;

    // Pieds : on piétine en attendant (au hasard), on marche (pas cadencés des voisins).
    if (r.allure === 'marche') {
      // Autant de voisins qu'il faut pour la densité de pas ; aucun vu de loin.
      const n = r.pasParSeconde > 0 ? Math.min(MARCHEURS_MAX, Math.max(1, Math.round(r.pasParSeconde / 2))) : 0;
      for (const m of marcheurs.slice(0, n)) {
        for (const t of posesDePied(m, horizonPas, horizon)) jouerPose(ctx, b.bruit, evenements, t, m, VOLUME_PAS);
      }
      prochainPas = horizon;
    } else {
      while (r.pasParSeconde > 0 && prochainPas < horizon) {
        jouerPas(b, evenements, prochainPas);
        prochainPas += -Math.log(1 - Math.random()) / r.pasParSeconde;
      }
      if (r.pasParSeconde <= 0) prochainPas = horizon;
    }
    horizonPas = horizon;

    if (r.allure === 'danse') {
      // Danse finale : la batucada joue tout près, calée sur l'animation (les surdos
      // frappent quand la foule retombe) ; la foule saute sur chaque temps et tape dans
      // ses mains sur les temps 2 et 4.
      const versContexte = horlogeAnimation(ctx);
      const noire = 1 / TEMPO_DANSE_PAR_S;
      if (tempsDanse === null || versContexte(instantDuTempsDeDanse(tempsDanse)) < maintenant - 0.5) {
        const k = premierTempsDeDanse(performance.now() / 1000 + 0.2);
        tempsDanse = k + ((TEMPS_PAR_MESURE - (k % TEMPS_PAR_MESURE)) % TEMPS_PAR_MESURE);
      }
      // Sauts et mains de la foule : forts au milieu, lointains en vue d'ensemble.
      const ampleur = (0.4 + 0.6 * r.foule) * (0.2 + 0.8 * r.proximite);
      while (versContexte(instantDuTempsDeDanse(tempsDanse)) < horizon) {
        const t0 = versContexte(instantDuTempsDeDanse(tempsDanse));
        for (const f of batucadaDanse.mesure(tempsDanse / TEMPS_PAR_MESURE).frappes) {
          percussions.frapper(f, t0 + (f.temps + balancementDouble(f.temps)) * noire);
        }
        for (let k = 0; k < TEMPS_PAR_MESURE; k++) {
          jouerAtterrissage(ctx, b.bruit, evenements, t0 + k * noire, ampleur);
          if (k % 2 === 1) jouerMainsFoule(ctx, b.bruit, evenements, t0 + k * noire, ampleur, alea);
        }
        tempsDanse += TEMPS_PAR_MESURE;
      }
      // Tout près au milieu de la place ; assourdie vue de haut.
      reglerGroupe(r.percussions, 0.4 + 0.6 * r.proximite, 0.1, maintenant);
    } else {
      // Marche : le groupe remonte le cortège, passe, s'éloigne, se tait un moment.
      tempsDanse = null;
      const presence = r.percussions > 0 ? presenceBatucada(maintenant, graineScene) : 0;
      const noire = 60 / TEMPO_MARCHE;
      if (debutMesureMarche < maintenant - 1) debutMesureMarche = maintenant + 0.1;
      while (debutMesureMarche < horizon) {
        if (presence > 0.01) {
          for (const f of batucadaMarche.mesure(mesureMarche).frappes) {
            percussions.frapper(f, debutMesureMarche + (f.temps + balancementDouble(f.temps)) * noire);
          }
        }
        mesureMarche++;
        debutMesureMarche += TEMPS_PAR_MESURE * noire;
      }
      // Il passe d'un côté à l'autre pendant qu'il remonte le cortège.
      const pan = 0.6 * Math.sin((maintenant + graineScene) / 37);
      reglerGroupe(r.percussions * presence, presence * (0.4 + 0.6 * r.proximite), pan, maintenant);
    }

    // Événements : sifflets, applaudissements, clameurs (« ouais ! » sans paroles).
    while (prochainEvenement < horizon) {
      const x = Math.random();
      if (r.allure === 'danse' && x < 0.55) {
        jouerClameur(ctx, evenements, prochainEvenement, 0.8 + 0.4 * r.foule, alea);
        jouerApplaudissements(b, evenements, prochainEvenement + 0.3, 0.6 + 0.4 * r.brouhaha);
      } else if (x < 0.3) jouerSifflet(b, evenements, prochainEvenement);
      else if (x < 0.7) jouerApplaudissements(b, evenements, prochainEvenement, 0.5 + 0.5 * r.brouhaha);
      else {
        jouerClameur(ctx, evenements, prochainEvenement, 0.4 + 0.6 * r.foule, alea);
        jouerApplaudissements(b, evenements, prochainEvenement + 0.4, 0.4 + 0.4 * r.brouhaha);
      }
      prochainEvenement += Math.max(3, (-Math.log(1 - Math.random()) * 60) / Math.max(0.1, r.evenementsParMinute));
    }

    // Au loin, un groupe scande un appel-réponse sans paroles (comme le chant local, assourdi).
    while (prochainChantLointain < horizon) {
      if (r.chantsLointainsParMinute > 0) {
        jouerChantLointain(b, ambiance, programmeChant(numeroChantLointain++), prochainChantLointain, alea);
      }
      prochainChantLointain += Math.max(
        20,
        (-Math.log(1 - Math.random()) * 60) / Math.max(0.05, r.chantsLointainsParMinute),
      );
    }
  };
  programmer();
  const minuterie = setInterval(programmer, PERIODE_MS);
  return {
    nom: 'manif',
    sortie: sorties.sortie,
    envoi: sorties.envoi,
    baisserPourChant(debut, duree) {
      voix.baisserPourChant(debut, duree);
      for (const g of [ambiance.sortie, ambiance.envoi]) {
        g.gain.cancelScheduledValues(debut);
        g.gain.setTargetAtTime(BAISSE_AMBIANCE_CHANT, debut, 0.15);
        g.gain.setTargetAtTime(1, debut + duree + 0.2, 0.6);
      }
    },
    arreter() {
      arretee = true;
      clearInterval(minuterie);
      clearTimeout(minuterieFoule);
      sorties.fermer(() => {
        // La réverbération s'éteint d'elle-même, puis on la libère.
        setTimeout(() => {
          rue.disconnect();
          retourRue.disconnect();
        }, 1_800);
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // déjà arrêtée
          }
          s.disconnect();
        }
        for (const n of noeuds) n.disconnect();
      });
    },
  };
}

/** Courte rafale de bruit filtré (voir `frappes.ts`). */
function rafale(b: Bus, sortie: AudioNode, t: number, options: OptionsRafale): void {
  rafaleDe(b.ctx, b.bruit, sortie, t, options);
}

/**
 * Passe de l'horloge de l'animation (`performance.now()`, en secondes) à celle du
 * contexte audio, latence de sortie comprise : un son programmé à l'instant rendu
 * s'entend quand l'image correspondante s'affiche.
 */
function horlogeAnimation(ctx: AudioContext): (tempsS: number) => number {
  const horodatage = ctx.getOutputTimestamp?.();
  const { contextTime, performanceTime } = horodatage ?? {};
  if (contextTime !== undefined && performanceTime !== undefined && performanceTime > 0) {
    return (tempsS) => contextTime + tempsS - performanceTime / 1000;
  }
  const ecart = ctx.currentTime - performance.now() / 1000 - (ctx.outputLatency || ctx.baseLatency || 0);
  return (tempsS) => tempsS + ecart;
}

function jouerPas(b: Bus, sortie: AudioNode, t: number): void {
  rafale(b, sortie, t, {
    type: 'lowpass',
    frequence: 260 + Math.random() * 220,
    duree: 0.08,
    volume: 0.05 + Math.random() * 0.05,
  });
}

/** Tambour : sinus grave qui chute en hauteur, plus un souffle ; `lointain` l'assourdit. */
function jouerTambour(b: Bus, sortie: AudioNode, t: number, volume: number, lointain: boolean): void {
  const { ctx } = b;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(lointain ? 120 : 150, t);
  o.frequency.exponentialRampToValueAtTime(lointain ? 55 : 62, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.005);
  g.gain.setTargetAtTime(0, t + 0.01, lointain ? 0.12 : 0.09);
  o.connect(g);
  if (lointain) {
    const assourdi = ctx.createBiquadFilter();
    assourdi.type = 'lowpass';
    assourdi.frequency.value = 380;
    g.connect(assourdi);
    assourdi.connect(sortie);
    o.onended = () => assourdi.disconnect();
  } else g.connect(sortie);
  o.start(t);
  o.stop(t + 0.6);
  rafale(b, sortie, t, { type: 'lowpass', frequence: lointain ? 500 : 900, duree: 0.06, volume: volume * 0.5 });
}

/** Sifflet lointain : sinus aigu en trille, très bas et filtré. */
function jouerSifflet(b: Bus, sortie: AudioNode, t: number): void {
  const { ctx } = b;
  const coups = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < coups; i++) {
    const debut = t + i * 0.45;
    const duree = 0.22 + Math.random() * 0.25;
    const o = ctx.createOscillator();
    o.frequency.value = 2500 + Math.random() * 500;
    const trille = ctx.createOscillator();
    trille.frequency.value = 22 + Math.random() * 8;
    const profondeur = ctx.createGain();
    profondeur.gain.value = 90;
    trille.connect(profondeur);
    profondeur.connect(o.frequency);
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, debut);
    g.gain.linearRampToValueAtTime(0.012, debut + 0.03);
    g.gain.setValueAtTime(0.012, debut + duree);
    g.gain.linearRampToValueAtTime(0, debut + duree + 0.05);
    o.connect(filtre);
    filtre.connect(g);
    g.connect(sortie);
    for (const s of [o, trille]) {
      s.start(debut);
      s.stop(debut + duree + 0.1);
    }
    o.onended = () => {
      g.disconnect();
      profondeur.disconnect();
    };
  }
}

/** Applaudissements : quatre couches de claquements aléatoires, qui montent puis s'éteignent. */
function jouerApplaudissements(b: Bus, sortie: AudioNode, t: number, ampleur: number): void {
  const { ctx } = b;
  const duree = 1.6 + Math.random() * 1.6;
  const claquements = Math.floor((30 + Math.random() * 40) * ampleur);
  const couches = Array.from({ length: 4 }, () => {
    const source = ctx.createBufferSource();
    source.buffer = b.bruit;
    source.loop = true;
    const filtre = ctx.createBiquadFilter();
    filtre.type = 'bandpass';
    filtre.frequency.value = 1100 + Math.random() * 900;
    filtre.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    source.connect(filtre);
    filtre.connect(g);
    g.connect(sortie);
    source.start(t, Math.random() * b.bruit.duration);
    source.stop(t + duree + 0.3);
    source.onended = () => g.disconnect();
    return { g, libre: t };
  });
  const instants = Array.from(
    { length: claquements },
    () => t + duree * Math.sqrt(Math.random()) * Math.random() ** 0.3,
  ).sort((a, z) => a - z);
  instants.forEach((ti, i) => {
    const couche = couches[i % couches.length]!;
    if (ti < couche.libre) return; // la couche claque encore
    const enveloppe = Math.sin((Math.PI * (ti - t)) / duree); // monte puis s'éteint
    const v = 0.03 * enveloppe * (0.6 + Math.random() * 0.4);
    couche.g.gain.setValueAtTime(0, ti);
    couche.g.gain.linearRampToValueAtTime(v, ti + 0.003);
    couche.g.gain.linearRampToValueAtTime(0, ti + 0.035);
    couche.libre = ti + 0.04;
  });
}

// ---------------------------------------------------------------------------
// Chant (local, sans paroles)

/** Volume du chant lancé par le soutien : il passe devant l'ambiance (qui baisse pendant ce temps). */
const VOLUME_CHANT = 1.25;

/** Formants (Hz) des voyelles du chœur : des timbres, pas des mots. */
const FORMANTS: Record<Voyelle, readonly [number, number]> = {
  he: [420, 2050],
  ho: [460, 820],
};

function jouerProgrammeChant(b: Bus, scene: Sorties, programme: ProgrammeChant, debut: number): void {
  const { ctx } = b;
  const bus = ctx.createGain();
  bus.gain.value = VOLUME_CHANT;
  brancher(ctx, bus, scene, 0.3);
  for (const e of programme.evenements) jouerEvenementChant(b, bus, e, debut + e.t);
  setTimeout(() => bus.disconnect(), (programme.duree + 2) * 1000 + (debut - ctx.currentTime) * 1000);
}

/** Un groupe scande au loin : même appel-réponse que le chant local, assourdi, quelque part dans la rue. */
function jouerChantLointain(b: Bus, scene: Sorties, programme: ProgrammeChant, debut: number, alea: Alea): void {
  const { ctx } = b;
  const bus = ctx.createGain();
  bus.gain.value = 0.3;
  const loin = ctx.createBiquadFilter();
  loin.type = 'lowpass';
  loin.frequency.value = 1100;
  loin.Q.value = 0;
  bus.connect(loin);
  const noeuds: AudioNode[] = [bus, loin];
  let sortie: AudioNode = loin;
  if (ctx.createStereoPanner) {
    const panneau = ctx.createStereoPanner();
    panneau.pan.value = (alea() * 2 - 1) * 0.8;
    loin.connect(panneau);
    sortie = panneau;
    noeuds.push(panneau);
  }
  brancher(ctx, sortie, scene, 0.8);
  for (const e of programme.evenements) jouerEvenementChant(b, bus, e, debut + e.t);
  setTimeout(
    () => {
      for (const n of noeuds) n.disconnect();
    },
    (programme.duree + 3) * 1000 + (debut - ctx.currentTime) * 1000,
  );
}

function jouerEvenementChant(b: Bus, sortie: AudioNode, e: EvenementChant, t: number): void {
  switch (e.type) {
    case 'tambour':
      jouerTambour(b, sortie, t, 0.35 * e.force, false);
      return;
    case 'mains':
      // Plusieurs mains légèrement décalées.
      for (let i = 0; i < 3; i++) {
        rafale(b, sortie, t + i * 0.009 + Math.random() * 0.006, {
          type: 'bandpass',
          frequence: 1200 + i * 350,
          q: 1.1,
          duree: 0.05,
          volume: 0.09 * e.force,
        });
      }
      return;
    case 'voix':
      jouerVoix(b, sortie, t, e.note, e.duree, e.voyelle, e.force);
  }
}

/** Chœur sans paroles : cinq voix en dents de scie, désaccordées, passées dans deux formants. */
function jouerVoix(
  b: Bus,
  sortie: AudioNode,
  t: number,
  note: number,
  duree: number,
  voyelle: Voyelle,
  force: number,
): void {
  const { ctx } = b;
  const melange = ctx.createGain();
  melange.gain.value = 0.2;
  const enveloppe = ctx.createGain();
  enveloppe.gain.setValueAtTime(0, t);
  enveloppe.gain.linearRampToValueAtTime(0.3 * force, t + 0.04);
  enveloppe.gain.setValueAtTime(0.3 * force, t + Math.max(0.05, duree - 0.08));
  enveloppe.gain.linearRampToValueAtTime(0, t + duree + 0.06);
  const adoucir = ctx.createBiquadFilter();
  adoucir.type = 'lowpass';
  adoucir.frequency.value = 3000;
  for (const [i, frequence] of FORMANTS[voyelle].entries()) {
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = frequence;
    formant.Q.value = i === 0 ? 5 : 8;
    const niveau = ctx.createGain();
    niveau.gain.value = i === 0 ? 1 : 0.55;
    melange.connect(formant);
    formant.connect(niveau);
    niveau.connect(enveloppe);
  }
  enveloppe.connect(adoucir);
  adoucir.connect(sortie);
  const f = frequenceMidi(note);
  const fin = t + duree + 0.1;
  let derniere: OscillatorNode | null = null;
  for (let i = 0; i < 5; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const decalage = (Math.random() - 0.5) * 0.03; // les voix n'attaquent pas ensemble
    o.frequency.setValueAtTime(f * (i === 4 ? 0.5 : 1), t + decalage);
    o.detune.value = (Math.random() - 0.5) * 30;
    // Petite chute de hauteur en fin de syllabe, comme une voix criée.
    o.frequency.setTargetAtTime(f * (i === 4 ? 0.5 : 1) * 0.94, t + duree * 0.7, 0.05);
    o.connect(melange);
    o.start(Math.max(t, t + decalage));
    o.stop(fin);
    derniere = o;
  }
  derniere!.onended = () => {
    melange.disconnect();
    enveloppe.disconnect();
    adoucir.disconnect();
  };
}
