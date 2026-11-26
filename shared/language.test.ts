import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { t, tIs, setLanguage } from './language.ts';
import { TEXTS } from './texts.ts';
import { MODELS, EFFORTS, PERMISSION_MODES } from './protocol.ts';

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
    const missing: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'texts') walk(p); } else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/(?<![\w.$])(?:t|tr|tx)\(\s*'([a-z]+\.[A-Za-z0-9.]+)'/g)) if (!TEXTS[m[1]]) missing.push(`${path.relative('.', p)}: ${m[1]}`); } };
    for (const d of ['web/src', 'shared', 'server']) walk(d);
    expect(missing).toEqual([]);
  });
  // lo que se pinta con tIs() tiene que estar tal cual en el catálogo: si se retoca el español en el código y no en
  // shared/texts/, en inglés sale en español sin que nada falle
  const literals = (src: string) => [...src.matchAll(/'((?:\\.|[^'\\])*)'/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
  const inCatalog = new Set(Object.values(TEXTS).map(v => v.es));
  // teclas sueltas (Esc, Ctrl+C) y comandos (./shelter …) no se traducen: solo cuenta lo que tiene pinta de frase
  const untranslated = (xs: string[]) => xs.filter(x => (/\s/.test(x) || /[áéíóúñ]/.test(x)) && /[a-záéíóúñ]{3}/.test(x) && !x.startsWith('./') && !inCatalog.has(x));
  it('los literales que pasan por tIs() están en el catálogo', () => {
    const missing: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== 'texts') walk(p); } else if (/\.tsx?$/.test(n) && !n.endsWith('.test.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/(?<![\w.$])tIs\(\s*'((?:\\.|[^'\\])*)'/g)) if (!inCatalog.has(m[1].replace(/\\(.)/g, '$1'))) missing.push(`${path.relative('.', p)}: ${m[1]}`); } };
    for (const d of ['web/src', 'shared', 'server']) walk(d);
    expect(missing).toEqual([]);
  });
  it('las tablas de atajos (F1), los selectores del intercomunicador y los campos de las integraciones están en el catálogo', () => {
    const panels = readFileSync('web/src/ui/Panels.tsx', 'utf8');
    const shortcuts = [...panels.matchAll(/const \w*CONTROLS: \[string, string\]\[\] = \[([\s\S]*?)\n\];/g)].flatMap(m => literals(m[1]));
    expect(shortcuts.length).toBeGreaterThan(40);
    expect(untranslated(shortcuts)).toEqual([]);
    // the intercom's selectors hold text keys, each with its English version (a model's own name is not translated)
    const selectors = [MODELS[0].text, ...EFFORTS.map(e => e.text), ...PERMISSION_MODES.flatMap(m => [m.text, m.hint])];
    expect(selectors.filter(k => !TEXTS[k]?.en)).toEqual([]);
    const dir = 'server/integrations';
    const fields = readdirSync(dir).filter(n => /\.ts$/.test(n) && !n.endsWith('.test.ts')).flatMap(n => [...readFileSync(path.join(dir, n), 'utf8').matchAll(/\b(?:label|help): ('(?:\\.|[^'\\])*')/g)].flatMap(x => literals(x[1])));
    expect(fields.length).toBeGreaterThan(20);
    expect(untranslated(fields)).toEqual([]);
  });
});
