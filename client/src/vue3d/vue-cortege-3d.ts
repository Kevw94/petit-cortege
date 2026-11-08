/**
 * Vue semi-3D de la manif (ADR 0007) : Three.js, caméra à la troisième personne derrière son
 * avatar (ou la tête du cortège), orientée dans le sens de la marche ; décor OSM à plat,
 * bâtiments en volume, avatars et pancartes en billboards (sprites Kenney face à la caméra).
 *
 * Se contente d'afficher les sorties du Cortège (inchangé) : mêmes avatars, mêmes positions,
 * même masse de foule et même tirage que la vue 2D. Importé dynamiquement : Three.js n'est
 * chargé que pour la vue d'une manif en 3D.
 */
import * as THREE from 'three';
import { COULEURS_PLAN, decoderPancarte, METRES_PAR_TUILE, versTuiles, type Georeference, type Position } from '@petit-cortege/shared';
import { BUDGET_AVATARS_DESSINES } from '../apparence/affichage';
import type { PointM } from '../cadrage';
import { cibleDeSuivi } from '../camera';
import { calculerCortege, COLONNES_FOULE, PAS_FOULE_M } from '../cortege/cortege';
import { composerFoule } from '../cortege/foule';
import { chargerImagesTilesets } from '../decor/cuisson';
import { empriseDuPlan } from '../decor/plan';
import { PAQUET, TEINTE_MASSE, VARIANTES_PAQUET } from '../foule/paquets';
import { tamponsDeMasse } from '../foule/tampons';
import { ambiance as ambianceDe } from '../meteo/ambiance';
import { CADRE_PANCARTE_M } from '../pancartes/canvas';
import type { DonneesScene } from '../scene-cortege';
import type { VueCortege } from '../vue-cortege';
import { boitesDeBatiments } from './batiments';
import { CielAmbiant } from './ciel';
import { Billboards } from './billboards';
import {
  capDeSuivi,
  cibleDeVue,
  deplacerCible,
  DISTANCE_SUIVI_M,
  distancePourToutVoir,
  CHAMP_VERTICAL_DEG,
  nomDePlaceVisible,
  parametresZoom,
  poseCamera,
  rapprocherAngle,
  zoomApresPincement,
  zoomPourDistance,
} from './camera3d';
import { detruireGroupe, maillageBatiments } from './maillage-batiments';
import { Precipitations } from './precipitations';
import { creerPlaceur, versScene } from './repere';
import { materiauDeSol, ORDRE_SOL, Sol } from './sol';
import { atlasApparences, atlasPancartes, chargerCouchesApparence, cleSansSlogan, texturePaquets } from './textures';
import { TraceAuSol3D } from './trace';

const CHAMP_DEG = CHAMP_VERTICAL_DEG;
/** L'ambiance (heure, météo publiée) est recalculée à cet intervalle, ou dès que la météo change. */
const INTERVALLE_AMBIANCE_S = 30;
/** Sol au-delà du plan de la ville : la couleur de ses îlots (son bord s'y fond), noyée dans la brume. */
const COULEUR_SOL_LOINTAIN = COULEURS_PLAN.ilot;
const COTE_SOL_LOINTAIN_M = 40_000;
/** Un avatar : cellule de 24 × 16 px de l'atlas = 3 m × 2 m (16 px par tuile de 2 m). */
const AVATAR_M = { largeur: 3, hauteur: 2 } as const;
/** Pancarte tenue au-dessus de la tête (haut du crâne Kenney : 14 px sur 16). */
const HAUTEUR_TETE_M = 1.75;
/** Sa propre pancarte est un peu plus grande : son slogan se lit mieux. */
const AGRANDISSEMENT_PANCARTE_PROPRE = 1.4;
/** Taille minimale d'un avatar à l'écran (pixels CSS) : la foule reste visible de haut. */
const PX_MIN_AVATAR = 7;
/** Largeur minimale du tracé à l'écran (pixels CSS). */
const PX_MIN_TRACE = 3;
/** Pixels par mètre des pancartes de la foule dans leur atlas : de près (avec slogan), de loin. */
const PX_PAR_M_PANCARTES = 48;
const PX_PAR_M_PANCARTES_LOIN = 20;
/** Le slogan s'écrit sur les pancartes vues à au moins ce zoom (pixels CSS par mètre). */
const SEUIL_SLOGAN_PX_PAR_M = 24;
/** Masse de foule : bande de la grille du Cortège, paquets de 5 m × 3,25 m (40 × 26 px). */
const MASSE = { largeurM: COLONNES_FOULE * PAS_FOULE_M, maximum: 6000, rangeesMax: 4 } as const;
const PAQUET_M = { largeur: PAQUET.largeur / 8, hauteur: PAQUET.hauteur / 8 } as const;
const PROPRES_MAX = 8;
/** Vitesses de lissage (par seconde) : position suivie, orientation, zoom. */
const LISSAGE = { position: 5, cap: 1.6, zoom: 8 } as const;
/** Glissement (px) au-delà duquel un toucher devient un déplacement de la vue. */
const SEUIL_GLISSEMENT_PX = 6;

const lisser = (vitesse: number, dt: number) => 1 - Math.exp(-vitesse * dt);

function projeteur(georef: Georeference) {
  return (p: Position): PointM => {
    const t = versTuiles(georef, p);
    return { x: t.x * METRES_PAR_TUILE, y: t.y * METRES_PAR_TUILE };
  };
}

/** Plan de la ville à plat, sous le décor : pixels nets de près, lissés de loin. */
function planDeLaVille(
  { plan, toile }: NonNullable<DonneesScene['plan']>,
  projeter: (p: Position) => PointM,
  anisotropie: number,
): THREE.Mesh {
  const { coin, largeurM, hauteurM } = empriseDuPlan(plan, projeter);
  const texture = new THREE.CanvasTexture(toile);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = anisotropie;
  const geometrie = new THREE.PlaneGeometry(largeurM, hauteurM).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometrie, materiauDeSol({ map: texture }, ORDRE_SOL.plan));
  mesh.position.set(coin.x + largeurM / 2, -0.03, coin.y + hauteurM / 2);
  mesh.renderOrder = ORDRE_SOL.plan;
  return mesh;
}

export async function creerVueCortege3D(parent: HTMLElement, donnees: DonneesScene): Promise<VueCortege> {
  const [couches, images] = await Promise.all([chargerCouchesApparence(), chargerImagesTilesets()]);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // Résolution plafonnée : net sur mobile sans multiplier le remplissage (×4 à ×9 en natif).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.domElement.className = 'vue-3d';
  parent.append(renderer.domElement);
  const etiquettes = document.createElement('div');
  etiquettes.className = 'etiquettes-3d';
  parent.append(etiquettes);
  const anisotropie = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  // Ciel, brume et lumières selon la météo publiée et l'heure au départ du parcours (ADR 0008).
  const ciel = new CielAmbiant(scene);
  const precipitations = new Precipitations();
  scene.add(precipitations.groupe);
  let meteoAppliquee: typeof donnees.manif.meteo | null = null;
  let avantAmbiance = 0;
  const actualiserAmbiance = (dt: number) => {
    avantAmbiance -= dt;
    if (avantAmbiance > 0 && meteoAppliquee === donnees.manif.meteo) return;
    avantAmbiance = INTERVALLE_AMBIANCE_S;
    meteoAppliquee = donnees.manif.meteo;
    const a = ambianceDe(donnees.manif.meteo, donnees.manif.parcours.coordinates[0]!, new Date());
    ciel.appliquer(a);
    precipitations.appliquer(a);
  };
  actualiserAmbiance(0);
  const camera = new THREE.PerspectiveCamera(CHAMP_DEG, 1, 0.5, 5000);

  const { decor } = donnees;
  const projeter = projeteur(decor?.georef ?? { origine: donnees.manif.parcours.coordinates[0]! });
  let placeur = creerPlaceur(donnees.manif.parcours, projeter);
  let parcoursConnu = donnees.manif.parcours;
  const pointsParcours = donnees.manif.parcours.coordinates.map(projeter);
  const xs = pointsParcours.map((p) => p.x);
  const ys = pointsParcours.map((p) => p.y);
  const centreParcours = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const rayonParcours = Math.max(...pointsParcours.map((p) => Math.hypot(p.x - centreParcours.x, p.y - centreParcours.y))) + 40;

  // Sol lointain, sous tout le reste : au-delà de la bande OSM, la rue file vers l'horizon
  // au lieu de s'arrêter sur le vide.
  const solLointain = new THREE.Mesh(
    new THREE.PlaneGeometry(COTE_SOL_LOINTAIN_M, COTE_SOL_LOINTAIN_M).rotateX(-Math.PI / 2),
    materiauDeSol({ color: COULEUR_SOL_LOINTAIN }, ORDRE_SOL.lointain),
  );
  solLointain.position.set(centreParcours.x, -0.05, centreParcours.y);
  solLointain.renderOrder = ORDRE_SOL.lointain;
  scene.add(solLointain);

  // Plan de la ville autour du décor (ADR 0008) : ce qu'on voit en dézoomant, au-delà de la bande.
  const plan = donnees.plan ? planDeLaVille(donnees.plan, projeter, anisotropie) : null;
  if (plan) scene.add(plan);

  // Décor : sol, tracé, bâtiments.
  const sol = decor ? new Sol(decor, images, anisotropie) : null;
  if (sol) scene.add(sol.groupe);
  const trace = new TraceAuSol3D(pointsParcours);
  scene.add(trace.groupe);
  const batiments = decor ? maillageBatiments(decor, images, boitesDeBatiments(decor), anisotropie) : null;
  if (batiments) scene.add(batiments);

  // Foule : masse, avatars, pancartes ; les siens à part.
  const apparences = atlasApparences(couches);
  const pancartes = atlasPancartes(PX_PAR_M_PANCARTES, 2048);
  const pancartesLoin = atlasPancartes(PX_PAR_M_PANCARTES_LOIN, 512, false);
  const pancartesPropres = atlasPancartes(140, 1024);
  const paquets = texturePaquets(couches);
  const masse = new Billboards({ texture: paquets.texture, capacite: MASSE.maximum, teinte: TEINTE_MASSE });
  const avatars = new Billboards({ texture: apparences.texture, capacite: BUDGET_AVATARS_DESSINES });
  const panneaux = new Billboards({ texture: pancartes.texture, capacite: BUDGET_AVATARS_DESSINES });
  const panneauxLoin = new Billboards({ texture: pancartesLoin.texture, capacite: BUDGET_AVATARS_DESSINES });
  // Les siens, comme en 2D : toujours visibles, par-dessus la foule et les bâtiments.
  const avatarsPropres = new Billboards({ texture: apparences.texture, capacite: PROPRES_MAX, ordre: 1, devant: true });
  const panneauxPropres = new Billboards({ texture: pancartesPropres.texture, capacite: PROPRES_MAX, ordre: 2, devant: true });
  const billboards = [masse, avatars, panneaux, panneauxLoin, avatarsPropres, panneauxPropres];
  for (const b of billboards) scene.add(b.mesh);
  const halos = Array.from({ length: PROPRES_MAX }, () => {
    const g = new THREE.CircleGeometry(1.2, 24);
    g.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(g, materiauDeSol({ color: 0xf1c40f }, ORDRE_SOL.halo));
    halo.renderOrder = ORDRE_SOL.halo;
    halo.visible = false;
    scene.add(halo);
    return halo;
  });

  // Étiquettes HTML (nettes, toujours lisibles) : places, départ, arrivée, « toi ».
  const etiquette = (texte: string, classe: string) => {
    const el = document.createElement('span');
    el.className = `etiquette-3d ${classe}`;
    el.textContent = texte;
    etiquettes.append(el);
    return el;
  };
  const libellesPlaces = (decor?.places ?? []).map((p) => ({
    el: etiquette(p.nom, p.arrivee ? 'place arrivee' : 'place'),
    point: { x: p.x * METRES_PAR_TUILE, y: p.y * METRES_PAR_TUILE },
  }));
  const libellesTrace = [
    { el: etiquette('Départ', 'trace'), point: trace.depart },
    { el: etiquette('Arrivée', 'trace'), point: trace.arrivee },
  ];
  const toi = etiquette('toi', 'toi');

  // État de la caméra.
  let suivi = true;
  let premiereImage = true;
  let pointSuivi: PointM = { ...pointsParcours[0]! };
  let cap = placeur.cap(0);
  let capLibre = cap;
  let libre: PointM = { ...pointSuivi };
  let libreCible: PointM = { ...pointSuivi };
  let regard: PointM = { ...pointSuivi };
  let zoom = 0;
  let zoomCible = 0;
  let distanceLoin = 3000;
  let largeur = 1;
  let hauteur = 1;
  donnees.surModeCamera?.(true);

  const detacher = () => {
    if (!suivi) return;
    suivi = false;
    libre = libreCible = { ...regard };
    capLibre = cap;
    donnees.surModeCamera?.(false);
  };

  const redimensionner = () => {
    largeur = Math.max(parent.clientWidth, 1);
    hauteur = Math.max(parent.clientHeight, 1);
    renderer.setSize(largeur, hauteur, false);
    camera.aspect = largeur / hauteur;
    distanceLoin = distancePourToutVoir(rayonParcours, CHAMP_DEG, camera.aspect);
  };
  redimensionner();
  zoom = zoomCible = zoomPourDistance(DISTANCE_SUIVI_M, distanceLoin);
  const observateur = new ResizeObserver(redimensionner);
  observateur.observe(parent);

  // Gestes : glisser (déplace et détache), pincer (zoom), tourner à deux doigts, molette ;
  // à la souris, glisser avec le bouton droit ou Maj fait tourner la vue.
  // Doigts : événements tactiles (multipoint fiable partout) ; souris : événements pointeur.
  let doigts = new Map<number, { x: number; y: number }>();
  let glissementTotal = 0;
  let deuxDoigts: { ecart: number; angle: number; milieu: { x: number; y: number }; torsion: number } | null = null;
  const metresParPx = () => {
    const { distance } = parametresZoom(zoom, distanceLoin);
    return (2 * distance * Math.tan((CHAMP_DEG * Math.PI) / 360)) / hauteur;
  };
  const mesureDeuxDoigts = () => {
    const [a, b] = [...doigts.values()];
    return {
      ecart: Math.hypot(b!.x - a!.x, b!.y - a!.y),
      angle: Math.atan2(b!.y - a!.y, b!.x - a!.x),
      milieu: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
    };
  };
  /** Glisser d'un doigt (ou de la souris) : déplace la vue, ou la fait tourner. */
  const glisser = (glisse: { x: number; y: number }, tourner: boolean) => {
    glissementTotal += Math.hypot(glisse.x, glisse.y);
    if (glissementTotal < SEUIL_GLISSEMENT_PX) return;
    detacher();
    if (tourner) {
      capLibre += glisse.x * 0.006;
      cap = capLibre;
    } else libre = libreCible = regard = deplacerCible(libre, cap, glisse, metresParPx());
  };
  /** Nouvelle position des doigts posés : un doigt glisse, deux doigts pincent et tournent. */
  const suivreDoigts = (nouveaux: Map<number, { x: number; y: number }>) => {
    const avant = doigts;
    doigts = nouveaux;
    const memes = nouveaux.size === avant.size && [...nouveaux.keys()].every((id) => avant.has(id));
    if (!memes) {
      // Un doigt posé ou levé : nouvelle référence, sans mouvement.
      glissementTotal = 0;
      deuxDoigts = doigts.size === 2 ? { ...mesureDeuxDoigts(), torsion: 0 } : null;
      return;
    }
    if (doigts.size === 1) {
      const [id, apres] = [...doigts][0]!;
      const p = avant.get(id)!;
      glisser({ x: apres.x - p.x, y: apres.y - p.y }, false);
    } else if (doigts.size === 2 && deuxDoigts) {
      const m = mesureDeuxDoigts();
      if (deuxDoigts.ecart > 0 && m.ecart > 0) zoom = zoomCible = zoomApresPincement(zoomCible, m.ecart / deuxDoigts.ecart, distanceLoin);
      let dAngle = m.angle - deuxDoigts.angle;
      dAngle = Math.atan2(Math.sin(dAngle), Math.cos(dAngle));
      const torsion = deuxDoigts.torsion + dAngle;
      // Tourner à deux doigts détache la vue (au-delà d'un petit seuil, pour ne pas gêner le pincement).
      if (!suivi || Math.abs(torsion) > 0.25) {
        detacher();
        capLibre -= dAngle;
        cap = capLibre;
        const glisse = { x: m.milieu.x - deuxDoigts.milieu.x, y: m.milieu.y - deuxDoigts.milieu.y };
        libre = libreCible = regard = deplacerCible(libre, cap, glisse, metresParPx());
      }
      deuxDoigts = { ...m, torsion };
    }
  };
  const canvas = renderer.domElement;
  const surToucher = (e: TouchEvent) => {
    e.preventDefault();
    suivreDoigts(new Map([...e.touches].slice(0, 2).map((t) => [t.identifier, { x: t.clientX, y: t.clientY }])));
  };
  let souris: { x: number; y: number } | null = null;
  const surAppui = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    canvas.setPointerCapture(e.pointerId);
    souris = { x: e.clientX, y: e.clientY };
    glissementTotal = 0;
  };
  const surDeplacement = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !souris) return;
    const glisse = { x: e.clientX - souris.x, y: e.clientY - souris.y };
    souris = { x: e.clientX, y: e.clientY };
    // Bouton droit ou Maj : tourner la vue.
    glisser(glisse, (e.buttons & 2) !== 0 || e.shiftKey);
  };
  const surRelache = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') souris = null;
  };
  const surMolette = (e: WheelEvent) => {
    e.preventDefault();
    zoomCible = zoomApresPincement(zoomCible, Math.exp(-e.deltaY * 0.0015), distanceLoin);
  };
  const sansMenu = (e: Event) => e.preventDefault();
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
    canvas.addEventListener(type, surToucher, { passive: false });
  }
  canvas.addEventListener('pointerdown', surAppui);
  canvas.addEventListener('pointermove', surDeplacement);
  canvas.addEventListener('pointerup', surRelache);
  canvas.addEventListener('pointercancel', surRelache);
  canvas.addEventListener('wheel', surMolette, { passive: false });
  canvas.addEventListener('contextmenu', sansMenu);

  // Projection vers l'écran (pixels CSS) ; null si derrière la caméra.
  const projection = new THREE.Matrix4();
  const versEcran = (x: number, y: number, z: number) => {
    const e = projection.elements;
    const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    if (w <= 0.01) return null;
    return {
      x: ((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w + 1) * 0.5 * largeur,
      y: (1 - (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w) * 0.5 * hauteur,
      w,
    };
  };
  const aLEcran = (p: PointM, marge: number) => {
    const s = versEcran(p.x, 1, p.y);
    return !!s && s.x > -marge && s.x < largeur + marge && s.y > -marge && s.y < hauteur + marge * 2;
  };
  /** Agrandissement d'un avatar de loin (comme le shader des billboards). */
  const agrandissement = (w: number) => {
    const pxParM = (camera.projectionMatrix.elements[5]! * hauteur * 0.5) / w;
    return Math.max(1, PX_MIN_AVATAR / (AVATAR_M.hauteur * pxParM));
  };
  const largeurs = new WeakMap<HTMLElement, number>();
  const placerEtiquette = (el: HTMLElement, p: { x: number; y: number } | null, borner = false) => {
    if (!p) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    // Largeur lue une fois (texte fixe) : pas de recalcul de mise en page à chaque image.
    let largeurEl = largeurs.get(el);
    if (!largeurEl) largeurs.set(el, (largeurEl = el.offsetWidth));
    const demi = largeurEl / 2;
    const x = borner ? Math.min(Math.max(p.x, demi + 4), Math.max(largeur - demi - 4, demi + 4)) : p.x;
    el.style.transform = `translate(${Math.round(x - demi)}px, ${Math.round(p.y)}px)`;
  };

  let dernier = performance.now();
  const image = () => {
    const maintenant = performance.now();
    const dt = Math.min((maintenant - dernier) / 1000, 0.1);
    dernier = maintenant;
    if (donnees.manif.parcours !== parcoursConnu) {
      parcoursConnu = donnees.manif.parcours;
      placeur = creerPlaceur(parcoursConnu, projeter);
    }
    const cortege = calculerCortege({
      manif: donnees.manif,
      entrees: donnees.entrees(),
      propres: donnees.propres(),
      retraits: donnees.retraits(),
      maintenant: new Date(),
    });

    // Caméra : suit sa cible (position et orientation lissées), zoom lissé.
    const cible = cibleDeSuivi(cortege.avatars);
    const pointCible = placeur.placer(cible.distanceM, cible.decalageM);
    const capCible = capDeSuivi(placeur, cible.distanceM);
    const kPosition = premiereImage ? 1 : lisser(LISSAGE.position, dt);
    pointSuivi = { x: pointSuivi.x + (pointCible.x - pointSuivi.x) * kPosition, y: pointSuivi.y + (pointCible.y - pointSuivi.y) * kPosition };
    if (suivi) cap = premiereImage ? capCible : rapprocherAngle(cap, capCible, lisser(LISSAGE.cap, dt));
    else cap = rapprocherAngle(cap, capLibre, lisser(LISSAGE.zoom, dt));
    zoom += (zoomCible - zoom) * (premiereImage ? 1 : lisser(LISSAGE.zoom, dt));
    if (!suivi) libre = { x: libre.x + (libreCible.x - libre.x) * lisser(LISSAGE.position, dt), y: libre.y + (libreCible.y - libre.y) * lisser(LISSAGE.position, dt) };
    const voulu = suivi ? cibleDeVue(pointSuivi, centreParcours, zoom) : libre;
    const kRegard = premiereImage ? 1 : lisser(LISSAGE.position * 1.5, dt);
    regard = { x: regard.x + (voulu.x - regard.x) * kRegard, y: regard.y + (voulu.y - regard.y) * kRegard };
    premiereImage = false;
    const parametres = parametresZoom(zoom, distanceLoin);
    const pose = poseCamera({
      cible: regard,
      cap,
      distance: parametres.distance,
      inclinaison: parametres.inclinaison,
      avance: parametres.avance,
    });
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.regard.x, pose.regard.y, pose.regard.z);
    camera.near = Math.max(0.3, parametres.distance * 0.03);
    camera.far = parametres.distance * 3 + 1200;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Brume : de près, la ville s'estompe vers l'horizon à quelques centaines de mètres ;
    // de haut, elle recule assez pour ne rien voiler. Plus proche sous la pluie, le brouillard.
    actualiserAmbiance(dt);
    ciel.animer(dt);
    ciel.brume(parametres.distance * 1.5 + 60, parametres.distance * 3 + 450);
    (solLointain.material as THREE.MeshBasicMaterial).color.setHex(COULEUR_SOL_LOINTAIN).multiply(ciel.eclairage);
    if (plan) (plan.material as THREE.MeshBasicMaterial).color.copy(ciel.eclairage);
    sol?.eclairer(ciel.eclairage);
    for (const b of billboards) b.eclairer(ciel.eclairage);
    precipitations.actualiser(dt, { x: regard.x, z: regard.y }, parametres.distance, hauteur);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const ratio = renderer.getPixelRatio();
    for (const b of billboards) b.ecran(PX_MIN_AVATAR * ratio, hauteur * ratio);
    trace.actualiser(metresParPx(), PX_MIN_TRACE, parametres.distance);
    sol?.actualiser(camera);

    // Foule : mêmes avatars que la vue 2D ; masse au-delà du seuil de densité ou du budget.
    const places = cortege.avatars.map((a) => ({ ...a, sol: placeur.placer(a.distanceM, a.decalageM) }));
    const foule = composerFoule(places, {
      repereM: cortege.avanceeM,
      budget: BUDGET_AVATARS_DESSINES,
      visible: (a) => aLEcran(a.sol, 40),
    });
    // Tampons à demi recouverts, comme en 2D : de loin, les paquets sont agrandis (taille
    // minimale à l'écran), le pas s'allonge d'autant.
    masse.vider();
    const k = agrandissement(parametres.distance);
    const tampons = tamponsDeMasse(foule.troncons, {
      repereM: cortege.avanceeM,
      pasM: PAQUET_M.largeur * k * 0.5,
      largeurM: MASSE.largeurM,
      rangees: Math.min(MASSE.rangeesMax, Math.max(1, Math.ceil(MASSE.largeurM / (PAQUET_M.hauteur * k * 0.5)))),
      variantes: VARIANTES_PAQUET,
      maximum: MASSE.maximum,
    });
    for (const t of tampons) {
      const p = placeur.placer(t.distanceM, t.decalageM);
      if (aLEcran(p, 80)) masse.ajouter(versScene(p), PAQUET_M.largeur, PAQUET_M.hauteur, paquets.cadres[t.variante]!);
    }
    for (const b of [avatars, panneaux, panneauxLoin, avatarsPropres, panneauxPropres]) b.vider();
    const propres: PointM[] = [];
    for (const a of foule.dessines) {
      const pied = versScene(a.sol);
      if (a.propre) {
        if (propres.length >= PROPRES_MAX) continue;
        propres.push(a.sol);
        avatarsPropres.ajouter(pied, AVATAR_M.largeur, AVATAR_M.hauteur, apparences.cadre(a.apparence));
      } else avatars.ajouter(pied, AVATAR_M.largeur, AVATAR_M.hauteur, apparences.cadre(a.apparence));
      if (decoderPancarte(a.pancarte) === null) continue;
      if (a.propre) {
        const k = AGRANDISSEMENT_PANCARTE_PROPRE;
        panneauxPropres.ajouter(pied, CADRE_PANCARTE_M.largeur * k, CADRE_PANCARTE_M.hauteur * k, pancartesPropres.cadre(a.pancarte), HAUTEUR_TETE_M);
      } else {
        // Comme en 2D : de loin, seules la forme et la couleur se voient.
        const ecran = versEcran(pied.x, pied.y, pied.z);
        const pxParM = ecran ? (camera.projectionMatrix.elements[5]! * hauteur * 0.5) / ecran.w : 0;
        if (pxParM >= SEUIL_SLOGAN_PX_PAR_M) {
          panneaux.ajouter(pied, CADRE_PANCARTE_M.largeur, CADRE_PANCARTE_M.hauteur, pancartes.cadre(a.pancarte), HAUTEUR_TETE_M);
        } else {
          const cadre = pancartesLoin.cadre(cleSansSlogan(a.pancarte));
          panneauxLoin.ajouter(pied, CADRE_PANCARTE_M.largeur, CADRE_PANCARTE_M.hauteur, cadre, HAUTEUR_TETE_M);
        }
      }
    }
    for (const b of billboards) b.terminer();
    apparences.actualiser();
    pancartes.actualiser();
    pancartesLoin.actualiser();
    pancartesPropres.actualiser();

    // Mise en valeur « toi » : halo au sol et étiquette au-dessus de sa pancarte.
    const hautCamera = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    halos.forEach((halo, i) => {
      const p = propres[i];
      halo.visible = !!p;
      if (!p) return;
      const s = versEcran(p.x, 0, p.y);
      halo.position.set(p.x, 0, p.y);
      halo.scale.setScalar(s ? agrandissement(s.w) : 1);
    });
    const premier = propres[0];
    const s = premier && versEcran(premier.x, 0, premier.y);
    if (premier && s) {
      const k = agrandissement(s.w);
      const h = (HAUTEUR_TETE_M + CADRE_PANCARTE_M.hauteur * AGRANDISSEMENT_PANCARTE_PROPRE + 0.2) * k;
      const haut = versEcran(premier.x + hautCamera.x * h, hautCamera.y * h, premier.y + hautCamera.z * h);
      placerEtiquette(toi, haut && { x: haut.x, y: haut.y - 24 });
    } else placerEtiquette(toi, null);
    for (const { el, point } of libellesPlaces) {
      const auSol = Math.hypot(point.x - camera.position.x, point.y - camera.position.z);
      const p = nomDePlaceVisible(auSol, parametres.distance) ? versEcran(point.x, 0, point.y) : null;
      placerEtiquette(el, p && { x: p.x, y: p.y + 6 }, true);
    }
    for (const { el, point } of libellesTrace) {
      const p = versEcran(point.x, 0, point.y);
      placerEtiquette(el, p && { x: p.x, y: p.y - 26 });
    }

    renderer.render(scene, camera);
    donnees.surCortege(cortege);
  };
  renderer.setAnimationLoop(image);

  return {
    suivreLeCortege() {
      suivi = true;
      zoomCible = Math.min(zoomCible, zoomPourDistance(DISTANCE_SUIVI_M, distanceLoin));
      donnees.surModeCamera?.(true);
    },
    vueDEnsemble() {
      detacher();
      libreCible = { ...centreParcours };
      zoomCible = 1;
    },
    zoomer(facteur) {
      zoomCible = zoomApresPincement(zoomCible, facteur, distanceLoin);
    },
    detruire() {
      renderer.setAnimationLoop(null);
      observateur.disconnect();
      sol?.detruire();
      if (plan) {
        plan.geometry.dispose();
        (plan.material as THREE.MeshBasicMaterial).map?.dispose();
        (plan.material as THREE.Material).dispose();
      }
      solLointain.geometry.dispose();
      (solLointain.material as THREE.Material).dispose();
      ciel.detruire();
      precipitations.detruire();
      trace.detruire();
      if (batiments) detruireGroupe(batiments);
      for (const b of billboards) b.detruire();
      for (const t of [apparences.texture, pancartes.texture, pancartesLoin.texture, pancartesPropres.texture, paquets.texture]) t.dispose();
      for (const h of halos) {
        h.geometry.dispose();
        (h.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      etiquettes.remove();
    },
  };
}
