/**
 * Chargement du plan de la ville autour du décor (ADR 0008), vu quand on dézoome.
 *
 * ADR 0002 : comme pour les décors, on demande l'index puis tous les plans qu'il liste, dans
 * le même ordre pour tout le monde, et on garde celui du décor qui couvre le parcours.
 */
import { CHEMIN_INDEX_DECORS, decorDuParcours, lireIndexDecors, type PlanDecor, type Position } from '@petit-cortege/shared';
import { PREFIXE_DECORS } from './chargement';

export interface PlanCharge {
  plan: PlanDecor;
  /** Image PNG du plan. */
  image: Blob;
}

type Charger = (url: string) => Promise<Response>;

export async function chargerPlan(parcours: Position[], charger: Charger = (url) => fetch(url)): Promise<PlanCharge | null> {
  try {
    const reponseIndex = await charger(PREFIXE_DECORS + CHEMIN_INDEX_DECORS);
    if (!reponseIndex.ok) return null;
    const index = lireIndexDecors(await reponseIndex.json());
    const plans = index.decors.flatMap((d) => (d.plan ? [d.plan] : []));
    const reponses = await Promise.all(plans.map((p) => charger(PREFIXE_DECORS + p.fichier)));
    const plan = decorDuParcours(index, parcours)?.plan;
    const reponse = plan && reponses[plans.indexOf(plan)];
    if (!plan || !reponse?.ok) return null;
    return { plan, image: await reponse.blob() };
  } catch (erreur) {
    console.warn('Plan de la ville indisponible :', erreur);
    return null;
  }
}

/** Plan prêt à afficher : son image décodée dans un canvas (texture Phaser ou Three.js). */
export interface PlanAffichable {
  plan: PlanDecor;
  toile: HTMLCanvasElement;
}

export async function decoderPlan({ plan, image }: PlanCharge): Promise<PlanAffichable | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const toile = document.createElement('canvas');
    toile.width = bitmap.width;
    toile.height = bitmap.height;
    toile.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { plan, toile };
  } catch (erreur) {
    console.warn('Plan de la ville illisible :', erreur);
    return null;
  }
}

/** Emprise du plan dans le repère de la vue (mètres depuis l'origine du décor, y vers le sud). */
export function empriseDuPlan(plan: PlanDecor, projeter: (p: Position) => { x: number; y: number }) {
  const coin = projeter(plan.origine);
  return { coin, largeurM: plan.largeur * plan.metresParPixel, hauteurM: plan.hauteur * plan.metresParPixel };
}
