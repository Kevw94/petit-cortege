/**
 * Maillage des bâtiments de la vue 3D : les boîtes de `boitesDeBatiments`, habillées des
 * tuiles Kenney du bâtiment (toit répété sur le dessus, « mur + fenêtre, mur » sur les côtés).
 * Une géométrie fusionnée par texture : quelques dizaines d'appels de dessin pour tout le décor.
 */
import * as THREE from 'three';
import { METRES_PAR_TUILE, type Decor } from '@petit-cortege/shared';
import type { ImagesTilesets } from '../decor/cuisson';
import type { Boite } from './batiments';
import { textureDeTuiles } from './textures';

/** Une tuile de texture couvre 2 m au sol comme en hauteur. */
const M_PAR_TUILE_TEXTURE = METRES_PAR_TUILE;

class Tampons {
  readonly positions: number[] = [];
  readonly normales: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  /** Quadrilatère a b c d (sens trigonométrique vu de l'extérieur), normale et uv par coin. */
  quad(coins: number[][], normale: number[], uv: number[][]): void {
    const base = this.positions.length / 3;
    coins.forEach((p, i) => {
      this.positions.push(...p);
      this.normales.push(...normale);
      this.uvs.push(...uv[i]!);
    });
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  geometrie(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normales, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

export function maillageBatiments(decor: Decor, images: ImagesTilesets, boites: readonly Boite[], anisotropie: number): THREE.Group {
  const groupe = new THREE.Group();
  const toits = new Map<number, Tampons>();
  const murs = new Map<string, { tampons: Tampons; mur: number; fenetre: number }>();
  const t = M_PAR_TUILE_TEXTURE;
  for (const b of boites) {
    const [x0, z0, x1, z1] = [b.x0 * METRES_PAR_TUILE, b.y0 * METRES_PAR_TUILE, b.x1 * METRES_PAR_TUILE, b.y1 * METRES_PAR_TUILE];
    const h = b.hauteurM;
    let toit = toits.get(b.toit);
    if (!toit) toits.set(b.toit, (toit = new Tampons()));
    toit.quad(
      [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]],
      [0, 1, 0],
      [[x0 / t, z1 / t], [x1 / t, z1 / t], [x1 / t, z0 / t], [x0 / t, z0 / t]],
    );
    const cle = `${b.mur}/${b.fenetre}`;
    let m = murs.get(cle);
    if (!m) murs.set(cle, (m = { tampons: new Tampons(), mur: b.mur, fenetre: b.fenetre }));
    // Texture de façade sur deux tuiles (4 m) : u le long du mur, v vers le haut.
    const cote = (a: number[], bb: number[], normale: number[], u0: number, u1: number) =>
      m.tampons.quad(
        [[a[0]!, 0, a[1]!], [bb[0]!, 0, bb[1]!], [bb[0]!, h, bb[1]!], [a[0]!, h, a[1]!]],
        normale,
        [[u0 / (2 * t), 0], [u1 / (2 * t), 0], [u1 / (2 * t), h / t], [u0 / (2 * t), h / t]],
      );
    cote([x0, z1], [x1, z1], [0, 0, 1], x0, x1); // sud
    cote([x1, z0], [x0, z0], [0, 0, -1], -x1, -x0); // nord
    cote([x1, z1], [x1, z0], [1, 0, 0], -z1, -z0); // est
    cote([x0, z0], [x0, z1], [-1, 0, 0], z0, z1); // ouest
  }
  for (const [gid, tampons] of toits) {
    const texture = textureDeTuiles(decor, images, [[gid]]);
    texture.anisotropy = anisotropie;
    groupe.add(new THREE.Mesh(tampons.geometrie(), new THREE.MeshLambertMaterial({ map: texture })));
  }
  for (const { tampons, mur, fenetre } of murs.values()) {
    const texture = textureDeTuiles(decor, images, [fenetre ? [mur, fenetre] : [mur], [mur]]);
    texture.anisotropy = anisotropie;
    groupe.add(new THREE.Mesh(tampons.geometrie(), new THREE.MeshLambertMaterial({ map: texture })));
  }
  return groupe;
}

export function detruireGroupe(groupe: THREE.Object3D): void {
  groupe.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material as THREE.MeshLambertMaterial;
      m.map?.dispose();
      m.dispose();
    }
  });
}
