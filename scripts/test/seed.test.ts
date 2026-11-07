import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrer, retirerAvatar } from '@petit-cortege/server';
import { creerBaseDeTest } from '../../server/test/support';
import { ID_MANIF_DEMO, semerManifDemo } from '../seed';

describe('seed de la manif de démo', () => {
  let base: Awaited<ReturnType<typeof creerBaseDeTest>>;
  let dossier: string;

  beforeAll(async () => {
    base = await creerBaseDeTest();
    await migrer(base.sql);
    dossier = await mkdtemp(join(tmpdir(), 'pc-seed-'));
  });

  afterAll(async () => {
    await base.detruire();
    await rm(dossier, { recursive: true, force: true });
  });

  it('se relance même après le retrait d’un avatar de la démo (essai précédent)', async () => {
    await semerManifDemo(base.sql, dossier);
    const [avatar] = await base.sql<{ id: string }[]>`select id from avatar where manif_id = ${ID_MANIF_DEMO} limit 1`;
    expect(await retirerAvatar(base.sql, avatar!.id, 'soutien')).toBe(true);

    await expect(semerManifDemo(base.sql, dossier)).resolves.toBeUndefined();
    const [ligne] = await base.sql<{ retraits: number }[]>`select count(*)::int as retraits from retrait`;
    expect(ligne?.retraits).toBe(0);
  });
});
