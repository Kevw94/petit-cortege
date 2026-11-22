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
import { frequenceMidi } from './alea';
import { reponseRue } from './acoustique';
import { bruitRose } from './bruit';
import { fouleLointaine } from './foule-lointaine';
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

const REGLAGES_PAR_DEFAUT: ReglagesAmbiance = {
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
  evenements.gain.value = 0.7;
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

  let reglagesAppliques: ReglagesAmbiance | null = null;
  let prochainPas = ctx.currentTime + 0.3;
  let prochainEvenement = ctx.currentTime + 4 + Math.random() * 6;
  // Percussions lointaines : un motif de huit croches générique, qui va et vient.
  const MOTIF = [1, 0, 0, 1, 0, 0, 1, 0] as const;
  const CROCHE = 60 / 96 / 2;
  let prochaineCroche = ctx.currentTime + 1;
  let croche = 0;
  let mesuresRestantes = 4;
  let joue = false;

  const programmer = () => {
    const r = lireReglages() ?? REGLAGES_PAR_DEFAUT;
    const maintenant = ctx.currentTime;
    if (r !== reglagesAppliques) {
      // Transitions lentes (constante de temps ≈ 1,5 s) : la foule enfle sans à-coup.
      volumeBrouhaha.gain.setTargetAtTime(r.brouhaha * NIVEAU_BROUHAHA, maintenant, 1.5);
      coupure.frequency.setTargetAtTime(r.coupureHz, maintenant, 1.5);
      foule.gain.setTargetAtTime(r.foule * NIVEAU_FOULE, maintenant, 1.5);
      fouleAssourdie.frequency.setTargetAtTime(r.coupureHz * 1.4, maintenant, 1.5);
      voix.regler(r);
      reglagesAppliques = r;
    }
    const horizon = maintenant + AVANCE_S;
    voix.programmer(maintenant, horizon);
    if (prochainPas < maintenant - 1) prochainPas = maintenant;
    if (prochaineCroche < maintenant - 1) prochaineCroche = maintenant + 0.1;
    if (prochainEvenement < maintenant - 1) prochainEvenement = maintenant + 2;
    // Pas : processus de Poisson, frottements sourds et discrets.
    while (r.pasParSeconde > 0 && prochainPas < horizon) {
      jouerPas(b, evenements, prochainPas);
      prochainPas += -Math.log(1 - Math.random()) / r.pasParSeconde;
    }
    if (r.pasParSeconde <= 0) prochainPas = horizon;
    while (prochaineCroche < horizon) {
      if (croche === 0 && --mesuresRestantes <= 0) {
        joue = !joue && r.percussions > 0;
        mesuresRestantes = joue ? 4 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 4);
      }
      if (joue && MOTIF[croche] && Math.random() > 0.12) {
        jouerTambour(b, evenements, prochaineCroche + (Math.random() - 0.5) * 0.02, r.percussions * 0.5, true);
      }
      croche = (croche + 1) % MOTIF.length;
      prochaineCroche += CROCHE;
    }
    while (prochainEvenement < horizon) {
      if (Math.random() < 0.35) jouerSifflet(b, evenements, prochainEvenement);
      else jouerApplaudissements(b, evenements, prochainEvenement, 0.5 + 0.5 * r.brouhaha);
      prochainEvenement += Math.max(3, (-Math.log(1 - Math.random()) * 60) / Math.max(0.1, r.evenementsParMinute));
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

/** Courte rafale de bruit filtré, enveloppe percussive : base des pas, des mains, des tambours. */
function rafale(
  b: Bus,
  sortie: AudioNode,
  t: number,
  {
    type,
    frequence,
    q = 1,
    duree,
    volume,
  }: { type: BiquadFilterType; frequence: number; q?: number; duree: number; volume: number },
): void {
  const { ctx } = b;
  const source = ctx.createBufferSource();
  source.buffer = b.bruit;
  const filtre = ctx.createBiquadFilter();
  filtre.type = type;
  filtre.frequency.value = frequence;
  filtre.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.006, duree / 4);
  source.connect(filtre);
  filtre.connect(g);
  g.connect(sortie);
  source.start(t, Math.random() * (b.bruit.duration - 1));
  source.stop(t + duree + 0.05);
  source.onended = () => g.disconnect();
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
