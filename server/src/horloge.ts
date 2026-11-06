/** Horloge injectable : les tests la contrôlent, la prod lit l'heure système. */
export interface Horloge {
  maintenant(): Date;
}

export const horlogeSysteme: Horloge = { maintenant: () => new Date() };
