import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { t, tIs, setLanguage } from './idioma.ts';
import { TEXTS } from './textos.ts';

describe('idioma', () => {
  afterEach(() => setLanguage('es'));
  it('cada clave da su versión del idioma elegido; sin clave, la propia clave', () => {
    expect(t('menu.backToTheShelter')).toBe('Volver al refugio');
    setLanguage('en');
    expect(t('menu.backToTheShelter')).toBe('Back to the shelter');
    expect(t('menu.leaveAndStopTheN', { n: 3 })).toBe('Leave and stop the 3 live sessions');
    expect(t('no.existe')).toBe('no.existe');
  });
  it('los textos que llegan como datos en español se buscan por su español; lo demás sale tal cual', () => {
    setLanguage('en');
    expect(tIs('Cámara acorazada')).toBe('Vault');
    expect(tIs('app-web')).toBe('app-web');
  });
  it('claves en inglés, y cada traducción con las mismas variables que su original', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();
    for (const [k, v] of Object.entries(TEXTS)) {
      expect(k, k).toMatch(/^[a-z]+(\.[A-Za-z0-9]+)+$/);
      if (v.en !== undefined) expect(vars(v.en), k).toBe(vars(v.es));
    }
  });
  it('toda clave usada en el código existe en el catálogo', () => {
    const faltan: string[] = [];
    const recorrer = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'textos') recorrer(p); } else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/(?<![\w.$])(?:t|tr|tx)\(\s*'([a-z]+\.[A-Za-z0-9.]+)'/g)) if (!TEXTS[m[1]]) faltan.push(`${path.relative('.', p)}: ${m[1]}`); } };
    for (const d of ['web/src', 'shared', 'server']) recorrer(d);
    expect(faltan).toEqual([]);
  });
});
