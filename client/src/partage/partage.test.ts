import { describe, expect, it } from 'vitest';
import { NOM_FICHIER_IMAGE, partagerImage, peutPartagerUneImage, telechargerImage } from './partage';

const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });

/** Navigateur simulé : enregistre ce qui est partagé ou téléchargé. */
function navigateurSimule(capacites: {
  share?: boolean;
  canShareFichiers?: boolean;
  canShare?: boolean;
  echecPartage?: Error;
}) {
  const partages: ShareData[] = [];
  const telechargements: { fichier: Blob; nom: string }[] = [];
  const navigateur: Partial<Pick<Navigator, 'share' | 'canShare'>> = {};
  if (capacites.share) {
    navigateur.share = async (donnees?: ShareData) => {
      if (capacites.echecPartage) throw capacites.echecPartage;
      partages.push(donnees!);
    };
  }
  if (capacites.canShare !== false && capacites.share) {
    navigateur.canShare = (donnees?: ShareData) => (donnees?.files ? !!capacites.canShareFichiers : true);
  }
  const environnement = {
    navigateur,
    telecharger: (fichier: Blob, nom: string) => void telechargements.push({ fichier, nom }),
  };
  return { environnement, partages, telechargements };
}

const erreurNommee = (name: string) => Object.assign(new Error(name), { name });

describe("partage de l'image finale", () => {
  it('partage le PNG comme fichier via le partage natif quand le navigateur sait partager des fichiers', async () => {
    const { environnement, partages, telechargements } = navigateurSimule({ share: true, canShareFichiers: true });
    expect(peutPartagerUneImage(environnement.navigateur)).toBe(true);
    expect(await partagerImage(png, environnement)).toBe('partage');
    expect(telechargements).toEqual([]);
    expect(partages).toHaveLength(1);
    const [fichier] = partages[0]!.files!;
    expect(fichier!.name).toBe('petit-cortege.png');
    expect(fichier!.type).toBe('image/png');
    expect(fichier!.size).toBe(png.size);
    // Rien qui désigne la manif : ni texte, ni titre, ni URL avec son fragment.
    expect(partages[0]!.url).toBeUndefined();
    expect(partages[0]!.text).toBeUndefined();
  });

  it('se replie sur le téléchargement quand le navigateur ne partage pas de fichiers', async () => {
    const { environnement, partages, telechargements } = navigateurSimule({ share: true, canShareFichiers: false });
    expect(peutPartagerUneImage(environnement.navigateur)).toBe(false);
    expect(await partagerImage(png, environnement)).toBe('telechargement');
    expect(partages).toEqual([]);
    expect(telechargements).toEqual([{ fichier: png, nom: 'petit-cortege.png' }]);
  });

  it('se replie sur le téléchargement sans API de partage (ordinateur), ou sans canShare', async () => {
    for (const capacites of [{}, { share: true, canShare: false }]) {
      const { environnement, telechargements } = navigateurSimule(capacites);
      expect(peutPartagerUneImage(environnement.navigateur)).toBe(false);
      expect(await partagerImage(png, environnement)).toBe('telechargement');
      expect(telechargements).toHaveLength(1);
    }
  });

  it("ne télécharge rien quand le soutien ferme la feuille de partage", async () => {
    const { environnement, telechargements } = navigateurSimule({
      share: true,
      canShareFichiers: true,
      echecPartage: erreurNommee('AbortError'),
    });
    expect(await partagerImage(png, environnement)).toBe('annule');
    expect(telechargements).toEqual([]);
  });

  it('se replie sur le téléchargement si le partage échoue pour une autre raison', async () => {
    const { environnement, telechargements } = navigateurSimule({
      share: true,
      canShareFichiers: true,
      echecPartage: erreurNommee('NotAllowedError'),
    });
    expect(await partagerImage(png, environnement)).toBe('telechargement');
    expect(telechargements).toHaveLength(1);
  });

  it("télécharge sous un nom neutre, sans identifiant de manif", () => {
    const { environnement, telechargements } = navigateurSimule({ share: true, canShareFichiers: true });
    telechargerImage(png, environnement);
    expect(NOM_FICHIER_IMAGE).toBe('petit-cortege.png');
    expect(telechargements).toEqual([{ fichier: png, nom: 'petit-cortege.png' }]);
  });
});
