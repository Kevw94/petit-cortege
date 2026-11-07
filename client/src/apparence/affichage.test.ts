import { describe, expect, it } from 'vitest';
import { aLEcran, couchesPourIndice, Emplacements } from './affichage';

const ecran = { largeur: 360, hauteur: 640 };
const sprite = { largeurSprite: 24, hauteurSprite: 16 };

describe('avatars à dessiner en sprites', () => {
  it("seuls les avatars à l'écran sont dessinés (un sprite qui dépasse du bord l'est encore)", () => {
    const avatars = [
      { id: 'dedans', x: 100, y: 300 },
      { id: 'au-bord', x: -5, y: 300 },
      { id: 'au-dessus', x: 100, y: -20 },
      { id: 'en-dessous', x: 100, y: 700 },
      { id: 'pieds-sous-le-bord', x: 100, y: 650 },
    ];
    const dessines = avatars.filter((a) => aLEcran(a, { ...ecran, ...sprite }));
    expect(dessines.map((a) => a.id)).toEqual(['dedans', 'au-bord', 'pieds-sous-le-bord']);
  });
});

describe("couches d'un indice d'apparence", () => {
  it('un indice hors catalogue (ancien ou corrompu) est dessiné avec l’apparence par défaut', () => {
    expect(couchesPourIndice(7)).toEqual(couchesPourIndice(0));
    expect(couchesPourIndice(0)).toEqual(['corps/0', 'bas/0', 'chaussures', 'haut/0/0']);
  });

  it("un accessoire ajoute ses couches derrière et devant l'avatar", () => {
    const couches = couchesPourIndice(1 << 22);
    expect(couches[0]).toBe('accessoire/1/arriere');
    expect(couches.at(-1)).toBe('accessoire/1/avant');
  });
});

describe('emplacements des apparences précomposées', () => {
  it('une apparence garde son emplacement ; une nouvelle en prend un libre', () => {
    const emplacements = new Emplacements(3);
    expect(emplacements.prendre(42)).toEqual({ numero: 0, nouveau: true, reinitialise: false });
    expect(emplacements.prendre(7)).toEqual({ numero: 1, nouveau: true, reinitialise: false });
    expect(emplacements.prendre(42)).toEqual({ numero: 0, nouveau: false, reinitialise: false });
  });

  it('quand tout est pris, on repart de zéro (la texture est à redessiner)', () => {
    const emplacements = new Emplacements(2);
    emplacements.prendre(1);
    emplacements.prendre(2);
    expect(emplacements.prendre(3)).toEqual({ numero: 0, nouveau: true, reinitialise: true });
    expect(emplacements.prendre(1)).toEqual({ numero: 1, nouveau: true, reinitialise: false });
  });
});
