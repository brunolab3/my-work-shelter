// Guards for English mode: nothing the Overseer sees (or a dweller receives) stays in Spanish.
// 1. Every Spanish string the UI shows from a data catalogue through tIs() exists as an `es` value in shared/texts/.
// 2. No literal with Spanish characters lives outside t()/tIs() in the client, the server or Electron, except a short
//    commented allowlist.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { TEXTS } from '../shared/texts.ts';
import { setLanguage, roomNameIs } from '../shared/language.ts';
import { PIECES as LOOK_PIECES, SLOT_NAME, NAME_REGION, nameRegion } from '../shared/appearance.ts';
import { PIECES, SHOP, SIGNALS, HARVESTS, CROSSBOW } from '../shared/catalog.ts';
import { DESCRIPTION_BASE, PACKS } from '../shared/decor.ts';
import { INITIAL_ROOMS, ROOM_DESCRIPTION, INITIAL_DWELLERS } from '../shared/initialShelter.ts';
import { ROOM_INFO, REPO_INFO, INTEGRATION_STATE, INTEGRATION_STATE_SHORT, REPO_TYPE, LOOK, ACTIVITY_TABS, FRESH_HARVEST } from '../shared/labels.ts';
import { NICKNAMES, ORIGIN, MANIA, ROBOT_ORIGIN } from '../shared/recruits.ts';
import { SECTORS } from '../shared/sectors.ts';
import { MODELS, EFFORTS, PERMISSION_MODES } from '../shared/protocol.ts';
import { COLUMNS } from '../shared/board.ts';
import { DEPLOYMENT_COLUMNS } from '../shared/deploy.ts';

const spanish = new Set(Object.values(TEXTS).map(v => v.es));

describe('English mode guards', () => {
  it('every Spanish string of the data catalogues shown through tIs() is in the catalogue', () => {
    const data = [
      ...LOOK_PIECES.map(p => p.name), ...Object.values(SLOT_NAME), ...Object.values(NAME_REGION), nameRegion('piel', 'robot'),
      ...[...PIECES, ...SHOP, CROSSBOW].flatMap(p => [p.nombre, p.texto]), ...PIECES.map(p => p.rarity),
      ...SIGNALS.flatMap(s => [s.titulo, s.texto]), ...Object.values(HARVESTS).map(h => h.nombre),
      ...Object.values(DESCRIPTION_BASE), ...Object.values(PACKS).map(p => p.what),
      ...INITIAL_ROOMS.map(s => s.name), ...Object.values(ROOM_DESCRIPTION), ...INITIAL_DWELLERS.flatMap(h => [h.nickname, h.bio]),
      ...Object.values(ROOM_INFO), REPO_INFO, ...Object.values(INTEGRATION_STATE), ...Object.values(INTEGRATION_STATE_SHORT),
      ...Object.values(REPO_TYPE), ...Object.values(LOOK), ...ACTIVITY_TABS, FRESH_HARVEST,
      ...NICKNAMES, ...ORIGIN, ...MANIA, ROBOT_ORIGIN,
      ...Object.values(SECTORS).flatMap(s => [s.name, s.motto]),
      MODELS[0].text, ...EFFORTS.map(e => e.text), ...PERMISSION_MODES.flatMap(m => [m.text, m.hint]),
      ...COLUMNS.map(c => c.name), ...DEPLOYMENT_COLUMNS.map(c => c.name),
    ];
    expect([...new Set(data.filter(x => !spanish.has(x)))]).toEqual([]);
  });

  // the room tools (send_to_room) and the remote control list rooms through roomNameIs, not their saved Spanish name
  it('room names reach English mode translated, Planning wings included', () => {
    setLanguage('en');
    try {
      const names = [...INITIAL_ROOMS, { type: 'coordination', name: 'Planning web' }].map(roomNameIs);
      // Calendar, Logistics and Planning are the same in both languages
      const spanishOnly = new Set(Object.values(TEXTS).filter(v => v.es !== v.en).map(v => v.es));
      expect(names.filter(n => spanishOnly.has(n))).toEqual([]);
      expect(names).toContain('Planning web');
      expect(roomNameIs({ type: 'repo', name: 'Logística' })).toBe('Logística');
    } finally { setLanguage('es'); }
  });

  it('no literal with Spanish characters outside t()/tIs() in the client, the server, Electron and shared/', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (!/^(node_modules|texts|fixtures)$/.test(n)) walk(p); } else if (/\.(tsx?|cjs|mjs|js)$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
    for (const d of ['web/src', 'server', 'electron', 'shared']) walk(d);
    const hits: string[] = [];
    for (const f of files) {
      const rel = path.relative('.', f);
      if (SKIP_FILES.includes(rel)) continue;
      const src = readFileSync(f, 'utf8'), lines = src.split('\n');
      for (const l of literals(src)) {
        if (!SPANISH_CHARS.test(l.text) || spanish.has(l.text) || l.inT || SHADER.test(l.text)) continue;
        if (LOG_LINE.test(lines[l.line - 1])) continue;
        if (ALLOWED.some(([file, re]) => file === rel && re.test(l.text))) continue;
        hits.push(`${rel}:${l.line}: ${l.text.slice(0, 100)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

const SPANISH_CHARS = /[áéíóúñÁÉÍÓÚÑ¿¡]/;
// the catalogues themselves, and the demo data with its English (integrations start off; the demo is for screenshots)
const SKIP_FILES = ['electron/texts.cjs', 'server/integrations/demo.ts', 'server/integrations/demoEnglish.ts'];
// GLSL inside template literals (its comments are code comments)
const SHADER = /\b(uniform|varying|gl_FragColor|void main|vec[234]|float)\b/;
// developer logs: console, the Electron log file and the Chrome helpers' log (log)
const LOG_LINE = /console\.(log|warn|error|info)|log\.write\(|\blog\(/;
// What may stay in Spanish, and why. Keep it short.
const ALLOWED: [string, RegExp][] = [
  ['web/src/audio/keyboard.ts', /./],                    // Spanish keyboard rows for the typing sounds, not text
  ['web/src/audio/voices.ts', /^[a-zñ]+$/],              // letters the dwellers' babble is made of
  ['web/src/main.tsx', /^ÁÑáñ¿¡$/],                     // glyphs to preload the fonts with
  ['web/src/ui/Search.tsx', /teléfono|móvil/],        // finder search synonyms in both languages
  ['web/src/ui/inputLine.tsx', /^Español \(/],            // dictation languages, each named in its own language
  ['shared/language.ts', /^Español$/],                    // the language picker: each language in its own name
  ['shared/deploy.ts', /bloquead/],                 // regex that reads Spanish and English PR bodies
  ['server/integrations/normalize.ts', /^[¡¿]$/],     // HTML entities
  ['server/state.ts', /^(Planificación|Logística)$/],  // migration of saved room names from before (savedName)
  ['server/repos.ts', /^diseño$/],                      // project type key, shown with tIs()
  ['server/git.ts', /^(Rutas con parámetros|REF-236 )/], // GitHub demo profile and PRs (DEMO data, before connecting)
  ['shared/recruits.ts', /^[A-ZÁÉÍÓÚ][a-záéíóúñ]+$/],   // recruits' first names
  ['shared/initialShelter.ts', /^[A-ZÁÉÍÓÚ][a-záéíóúñ]+$/], // the initial cast's first names
];

// String literals of a JS/TS source (template literals in their static chunks), with whether each one is the first
// argument of t()/tIs()/tr()/tx(). Skips comments and regex literals.
function literals(src: string): { text: string; line: number; inT: boolean }[] {
  const out: { text: string; line: number; inT: boolean }[] = [];
  let i = 0, line = 1, prev = '', prev2 = '', depth = 0;
  const tpl: number[] = [];
  const sig = (x: string) => { prev2 = prev; prev = x; };
  const template = () => {
    let buf = ''; const l0 = line;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { buf += src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') line++;
      if (c === '`') { i++; out.push({ text: buf, line: l0, inT: false }); sig('`'); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; out.push({ text: buf, line: l0, inT: false }); tpl.push(depth); depth++; sig('{'); return; }
      buf += c; i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); for (let k = i; k < e; k++) if (src[k] === '\n') line++; i = e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, buf = '';
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { buf += src[j + 1]; j += 2; } else buf += src[j++]; }
      out.push({ text: buf, line, inT: prev === '(' && /^(t|tIs|tr|tx)$/.test(prev2) }); i = j + 1; sig(c); continue;
    }
    if (c === '`') { i++; template(); continue; }
    if (c === '/' && (/^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || prev === '' || /^(return|typeof|in|of|case)$/.test(prev))) {
      let j = i + 1, cls = false;
      while (j < src.length && src[j] !== '\n') { const d = src[j]; if (d === '\\') { j += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; j++; }
      i = j + 1; while (/[a-z]/.test(src[i] ?? '')) i++; sig('regex'); continue;
    }
    if (c === '{') { depth++; sig(c); i++; continue; }
    if (c === '}') { depth--; if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); i++; template(); continue; } sig(c); i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (/[\w$]/.test(src[j] ?? '')) j++; sig(src.slice(i, j)); i = j; continue; }
    sig(c); i++;
  }
  return out;
}
