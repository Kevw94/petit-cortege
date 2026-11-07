import { describe, expect, it } from 'vitest';
import {
  ACCESSOIRES,
  COUPES,
  COULEURS_CHEVEUX,
  COULEURS_VETEMENTS,
  decoderApparence,
  encoderApparence,
  estIndiceApparence,
  HAUTS,
  TEINTS,
  tuilesKenneyUtilisees,
} from './apparence';

describe("indice d'apparence", () => {
  it("une apparence composée se retrouve à l'identique depuis son indice", () => {
    const apparence = { teint: 4, couleurCheveux: 2, coupe: 3, haut: 1, couleurHaut: 7, couleurBas: 2, accessoire: 1 };
    expect(decoderApparence(encoderApparence(apparence))).toEqual(apparence);
  });

  it("l'indice est stable : chaque élément occupe une place fixe, en quelques octets", () => {
    // Calculé à la main : teint bits 0-2, couleur des cheveux 3-5, coupe 6-9, haut 10-13,
    // couleur du haut 14-17, couleur du bas 18-21, accessoire 22-24.
    // 2 + 1·8 + 3·64 + 4·1024 + 5·16384 + 6·262144 + 1·4194304 = 5 853 386
    expect(
      encoderApparence({ teint: 2, couleurCheveux: 1, coupe: 3, haut: 4, couleurHaut: 5, couleurBas: 6, accessoire: 1 }),
    ).toBe(5_853_386);
    expect(decoderApparence(0)).toEqual({
      teint: 0,
      couleurCheveux: 0,
      coupe: 0,
      haut: 0,
      couleurHaut: 0,
      couleurBas: 0,
      accessoire: 0,
    });
    expect(decoderApparence(5)).toMatchObject({ teint: 5 });
  });

  it.each([
    ['teint absent du catalogue', 7],
    ['accessoire absent du catalogue', 7 << 22],
    ['au-delà des champs', 1 << 25],
    ['négatif', -1],
    ['non entier', 1.5],
    ['pas un nombre', Number.NaN],
  ])("un indice qui ne désigne aucune apparence du catalogue est refusé (%s)", (_cas, indice) => {
    expect(decoderApparence(indice)).toBeNull();
    expect(estIndiceApparence(indice)).toBe(false);
  });
});

describe("contenu du catalogue d'apparence", () => {
  it('propose une gamme d’environ 6 teints, des coupes, couleurs et vêtements variés, et les accessoires inclusifs', () => {
    expect(TEINTS.length).toBe(6);
    expect(COUPES.length).toBeGreaterThanOrEqual(5);
    expect(COULEURS_CHEVEUX.length).toBeGreaterThanOrEqual(5);
    expect(HAUTS.length).toBeGreaterThanOrEqual(6);
    expect(COULEURS_VETEMENTS.length).toBeGreaterThanOrEqual(8);
    expect(ACCESSOIRES.map((a) => a.nom)).toEqual(['Aucun', 'Fauteuil roulant', 'Poussette', 'Canne']);
  });

  it('chaque élément a un nom distinct dans sa liste', () => {
    for (const liste of [TEINTS, COUPES, COULEURS_CHEVEUX, HAUTS, COULEURS_VETEMENTS, ACCESSOIRES]) {
      expect(new Set(liste.map((e) => e.nom)).size).toBe(liste.length);
    }
  });

  it('liste blanche (ADR 0003) : seules des pièces Kenney de corps humain, cheveux, hauts, bas et chaussures sont utilisées', () => {
    // Planche Roguelike Characters : colonnes 0-1 corps (rangée 3 = teint vert non humain),
    // 3 bas, 4 chaussures, 6-17 hauts (rangées 0-2 et 5-7 ; 3-4 et 8-9 = épaulières, armures),
    // 19-26 cheveux ; au-delà : couvre-chefs, casques, boucliers, armes (exclus).
    for (const [colonne, rangee] of tuilesKenneyUtilisees()) {
      const corps = colonne <= 1 && rangee <= 2;
      const basOuChaussures = (colonne === 3 || colonne === 4) && rangee <= 8 && rangee !== 4;
      const haut = colonne >= 6 && colonne <= 17 && [0, 1, 2, 5, 6, 7].includes(rangee);
      const cheveux = colonne >= 19 && colonne <= 26;
      expect(corps || basOuChaussures || haut || cheveux, `tuile ${colonne},${rangee}`).toBe(true);
    }
  });

  it('chaque combinaison des listes a son propre indice', () => {
    const vus = new Set<number>();
    TEINTS.forEach((_t, teint) =>
      COUPES.forEach((_c, coupe) =>
        HAUTS.forEach((_h, haut) =>
          ACCESSOIRES.forEach((_a, accessoire) => {
            const apparence = { teint, couleurCheveux: 1, coupe, haut, couleurHaut: 2, couleurBas: 3, accessoire };
            const indice = encoderApparence(apparence);
            expect(decoderApparence(indice)).toEqual(apparence);
            vus.add(indice);
          }),
        ),
      ),
    );
    expect(vus.size).toBe(TEINTS.length * COUPES.length * HAUTS.length * ACCESSOIRES.length);
  });
});
