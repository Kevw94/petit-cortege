import { describe, expect, it } from 'vitest';
import {
  SCRIPT_MESURE_AUDIENCE,
  creerSuiviDeFragment,
  identifiantMesureAudience,
  scriptMesureAudience,
  urlDePage,
} from './mesure-audience';

const ID = '94db1cb1-74f4-4a40-ad6c-962362670409';

describe('mesure d’audience Umami', () => {
  it('n’accepte qu’un UUID de site, sans rien inventer s’il manque', () => {
    expect(identifiantMesureAudience(undefined)).toBeNull();
    expect(identifiantMesureAudience('')).toBeNull();
    expect(identifiantMesureAudience('   ')).toBeNull();
    expect(identifiantMesureAudience('pas-un-uuid')).toBeNull();
    expect(identifiantMesureAudience(`  ${ID}  `)).toBe(ID);
  });

  it('ne décrit un script qu’en production, avec l’identifiant fourni', () => {
    expect(scriptMesureAudience({ production: false, identifiant: ID })).toBeNull();
    expect(scriptMesureAudience({ production: true, identifiant: undefined })).toBeNull();
    expect(scriptMesureAudience({ production: true, identifiant: '' })).toBeNull();
    expect(scriptMesureAudience({ production: true, identifiant: ID })).toEqual({
      src: SCRIPT_MESURE_AUDIENCE,
      defer: true,
      websiteId: ID,
      doNotTrack: 'true',
    });
    expect(SCRIPT_MESURE_AUDIENCE).toBe('https://stats.petit-cortege.fr/script.js');
  });

  it('compte le fragment : les pages du site n’apparaissent pas dans le chemin', () => {
    expect(urlDePage({ pathname: '/', search: '', hash: '#/vie-privee' })).toBe('/#/vie-privee');
    expect(urlDePage({ pathname: '/', search: '', hash: '#/manif/demo' })).toBe('/#/manif/demo');
    expect(urlDePage({ pathname: '/', search: '?src=1', hash: '#/' })).toBe('/?src=1#/');
  });

  it('compte chaque changement de fragment, pas le premier affichage', () => {
    const urls = ['/#/', '/#/manif/demo', '/#/vie-privee'];
    let index = 0;
    const suivre = creerSuiviDeFragment(() => urls[index] ?? '');
    index = 1;
    expect(suivre()).toEqual({ url: '/#/manif/demo', referrer: '/#/' });
    index = 2;
    expect(suivre()).toEqual({ url: '/#/vie-privee', referrer: '/#/manif/demo' });
  });
});
