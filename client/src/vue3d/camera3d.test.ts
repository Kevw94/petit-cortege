import { describe, expect, it } from 'vitest';
import {
  capDeSuivi,
  cibleDeVue,
  deplacerCible,
  DISTANCE_PROCHE_M,
  distancePourToutVoir,
  parametresZoom,
  poseCamera,
  rapprocherAngle,
  zoomApresPincement,
  zoomPourDistance,
} from './camera3d';
import type { Placeur } from './repere';

const DEG = Math.PI / 180;

describe('lissage de l’orientation de la caméra', () => {
  it('rapproche l’angle de la cible d’une part de l’écart', () => {
    expect(rapprocherAngle(0, 90 * DEG, 0.5)).toBeCloseTo(45 * DEG, 6);
  });

  it('passe par le plus court chemin à travers ±π, sans faire le tour', () => {
    // De 170° à -170° : 20° d'écart en passant par 180°, pas 340° dans l'autre sens.
    const a = rapprocherAngle(170 * DEG, -170 * DEG, 0.5);
    expect(Math.abs(Math.abs(a) - 180 * DEG)).toBeLessThan(1e-6);
    const b = rapprocherAngle(-170 * DEG, 170 * DEG, 0.25);
    expect(b).toBeCloseTo(-175 * DEG, 6);
  });

  it('reste dans ]-π, π] même après de nombreux tours', () => {
    let angle = 0;
    for (let i = 0; i < 1000; i++) angle = rapprocherAngle(angle, angle + 3, 1);
    expect(angle).toBeGreaterThan(-Math.PI);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });

  it('avec un facteur 1, arrive sur la cible', () => {
    expect(rapprocherAngle(-3, 3, 1)).toBeCloseTo(3, 6);
  });
});

/** Parcours en équerre : 200 m vers l'est, puis 200 m vers le sud (y vers le sud). */
const equerre: Placeur = {
  longueurM: 400,
  placer: (d) => (d <= 200 ? { x: d, y: 0 } : { x: 200, y: Math.min(d, 400) - 200 }),
  cap: (d) => (d <= 200 ? 0 : Math.PI / 2),
};

describe('orientation de la caméra selon le parcours', () => {
  it('regarde dans le sens de la marche sur une ligne droite', () => {
    expect(capDeSuivi(equerre, 80)).toBeCloseTo(0, 6);
    expect(capDeSuivi(equerre, 320)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('anticipe le virage : à l’approche du coin, elle a déjà commencé à tourner', () => {
    const avant = capDeSuivi(equerre, 190);
    expect(avant).toBeGreaterThan(0.05);
    expect(avant).toBeLessThan(Math.PI / 4);
  });

  it('tourne progressivement dans le virage, sans saut', () => {
    let precedent = capDeSuivi(equerre, 150);
    for (let d = 151; d <= 260; d++) {
      const cap = capDeSuivi(equerre, d);
      expect(Math.abs(cap - precedent)).toBeLessThan(5 * DEG);
      expect(cap).toBeGreaterThanOrEqual(precedent - 1e-9);
      precedent = cap;
    }
    expect(precedent).toBeCloseTo(Math.PI / 2, 6);
  });

  it('avant le départ et à l’arrivée, garde la direction du premier ou du dernier tronçon', () => {
    expect(capDeSuivi(equerre, -30)).toBeCloseTo(0, 6);
    expect(capDeSuivi(equerre, 400)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('zoom de la caméra : de près de l’avatar à la vue de haut', () => {
  const loin = 3000;

  it('au plus près : à quelques mètres de l’avatar, inclinée vers l’avant (vue de trois quarts)', () => {
    const p = parametresZoom(0, loin);
    expect(p.distance).toBe(DISTANCE_PROCHE_M);
    expect(p.distance).toBeLessThan(10);
    expect(p.inclinaison).toBeGreaterThan(20 * DEG);
    expect(p.inclinaison).toBeLessThan(40 * DEG);
  });

  it('au plus loin : assez haut pour tout le parcours, regard presque à la verticale', () => {
    const p = parametresZoom(1, loin);
    expect(p.distance).toBeCloseTo(loin, 6);
    expect(p.inclinaison).toBeGreaterThan(85 * DEG);
    expect(p.inclinaison).toBeLessThan(90 * DEG);
    expect(p.hauteur).toBeGreaterThan(0.99 * loin);
  });

  it('en dézoomant, la caméra recule, monte et se redresse progressivement', () => {
    let avant = parametresZoom(0, loin);
    for (let z = 0.05; z <= 1.0001; z += 0.05) {
      const p = parametresZoom(z, loin);
      expect(p.distance).toBeGreaterThan(avant.distance);
      expect(p.hauteur).toBeGreaterThan(avant.hauteur);
      expect(p.inclinaison).toBeGreaterThanOrEqual(avant.inclinaison);
      expect(p.distance / avant.distance).toBeLessThan(2); // pas de saut
      avant = p;
    }
  });

  it('hauteur et recul sont ceux d’une caméra à `distance` du point regardé', () => {
    const p = parametresZoom(0.4, loin);
    expect(Math.hypot(p.hauteur, p.recul)).toBeCloseTo(p.distance, 6);
  });

  it('zoomPourDistance est l’inverse de la distance du zoom', () => {
    expect(parametresZoom(zoomPourDistance(30, loin), loin).distance).toBeCloseTo(30, 6);
    expect(zoomPourDistance(1, loin)).toBe(0);
    expect(zoomPourDistance(1e6, loin)).toBe(1);
  });

  it('écarter les doigts rapproche la caméra d’autant ; le zoom reste borné', () => {
    const z = zoomPourDistance(40, loin);
    expect(parametresZoom(zoomApresPincement(z, 2, loin), loin).distance).toBeCloseTo(20, 6);
    expect(parametresZoom(zoomApresPincement(z, 0.5, loin), loin).distance).toBeCloseTo(80, 6);
    expect(zoomApresPincement(0.01, 100, loin)).toBe(0);
    expect(zoomApresPincement(0.99, 0.01, loin)).toBe(1);
  });
});

describe('distance pour voir tout le parcours de haut', () => {
  it('le cercle du parcours tient dans l’écran, en portrait comme en paysage', () => {
    for (const aspect of [0.5, 1, 2]) {
      const d = distancePourToutVoir(1000, 50, aspect);
      const demiV = Math.tan((25 * Math.PI) / 180);
      const demiH = demiV * aspect;
      expect(1000 / d).toBeLessThanOrEqual(Math.min(demiV, demiH) + 1e-9);
      expect(1000 / d).toBeGreaterThan(0.8 * Math.min(demiV, demiH));
    }
  });
});

describe('pose de la caméra', () => {
  it('derrière la cible dans le sens de la marche, au-dessus, regard sur elle', () => {
    // On marche vers l'est (cap 0) : la caméra est à l'ouest de la cible.
    const pose = poseCamera({ cible: { x: 100, y: 50 }, cap: 0, distance: 20, inclinaison: 30 * DEG });
    expect(pose.regard.x).toBe(100);
    expect(pose.regard.z).toBe(50);
    expect(pose.position.x).toBeCloseTo(100 - 20 * Math.cos(30 * DEG), 6);
    expect(pose.position.z).toBeCloseTo(50, 6);
    expect(pose.position.y - pose.regard.y).toBeCloseTo(10, 6);
  });

  it('tourne avec le cap : en marchant vers le sud, la caméra est au nord', () => {
    const pose = poseCamera({ cible: { x: 0, y: 0 }, cap: Math.PI / 2, distance: 10, inclinaison: 0 });
    expect(pose.position.x).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-10, 6);
  });
});

describe('point regardé', () => {
  const suivie = { x: 0, y: 0 };
  const centre = { x: 1000, y: 400 };

  it('de près, la cible suivie ; de haut, le centre du parcours ; entre les deux, un fondu', () => {
    expect(cibleDeVue(suivie, centre, 0.3)).toEqual(suivie);
    expect(cibleDeVue(suivie, centre, 1)).toEqual(centre);
    const milieu = cibleDeVue(suivie, centre, 0.8);
    expect(milieu.x).toBeGreaterThan(0);
    expect(milieu.x).toBeLessThan(1000);
  });
});

describe('glisser la vue', () => {
  it('le sol suit le doigt : glisser vers la droite déplace le regard vers la gauche', () => {
    // Regard vers l'est : la gauche de l'écran est le nord (y négatif).
    const apres = deplacerCible({ x: 0, y: 0 }, 0, { x: 100, y: 0 }, 0.5);
    expect(apres.x).toBeCloseTo(0, 6);
    expect(apres.y).toBeCloseTo(-50, 6);
  });

  it('glisser vers le bas avance le regard', () => {
    const apres = deplacerCible({ x: 0, y: 0 }, Math.PI / 2, { x: 0, y: 40 }, 1);
    // Regard vers le sud : avancer, c'est aller vers le sud.
    expect(apres.x).toBeCloseTo(0, 6);
    expect(apres.y).toBeCloseTo(40, 6);
  });
});
