import { describe, it, expect, afterEach } from 'vitest';
import { tIs, setLanguage } from './language.ts';
import { TEXTS } from './texts.ts';
import { ROOM_INFO, REPO_INFO, INTEGRATION_STATE, INTEGRATION_STATE_SHORT, REPO_TYPE, LOOK, ACTIVITY_TABS, FRESH_HARVEST } from './labels.ts';
import { HARVESTS } from './catalog.ts';
import { NAME_REGION, nameRegion } from './appearance.ts';

// Los textos guardados como datos en español se muestran con tIs(): cada uno necesita su entrada en el catálogo o,
// en inglés, saldría en español
const SPANISH_DATA = [
  ...Object.values(ROOM_INFO), REPO_INFO, ...Object.values(INTEGRATION_STATE), ...Object.values(INTEGRATION_STATE_SHORT),
  ...Object.values(REPO_TYPE), ...Object.values(LOOK), ...ACTIVITY_TABS, FRESH_HARVEST,
  ...Object.values(HARVESTS).map(h => h.nombre), ...Object.values(NAME_REGION), nameRegion('piel', 'robot'),
];

describe('labels', () => {
  afterEach(() => setLanguage('es'));
  it('cada texto en español de los mapas tiene su entrada en el catálogo', () => {
    const spanish = new Set(Object.values(TEXTS).map(v => v.es));
    expect(SPANISH_DATA.filter(x => !spanish.has(x))).toEqual([]);
  });
  it('en inglés, ninguno sale en español (salvo los que se escriben igual)', () => {
    const same = new Set(Object.values(TEXTS).filter(v => v.es === v.en).map(v => v.es));
    setLanguage('en');
    expect(SPANISH_DATA.filter(x => !same.has(x) && tIs(x) === x)).toEqual([]);
  });
});
