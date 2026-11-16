// Guards for English mode: nothing the Overseer sees (or a dweller receives) stays in Spanish.
// 1. Every Spanish string the UI shows from a data catalogue through tIs() exists as an `es` value in shared/textos/.
// 2. No literal with Spanish characters lives outside t()/tIs() in the client, the server or Electron, except a short
//    commented allowlist.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { TEXTS } from '../shared/textos.ts';
import { setLanguage, roomNameIs } from '../shared/idioma.ts';
import { PIECES as LOOK_PIECES, SLOT_NAME, NAME_REGION, nameRegion } from '../shared/aspecto.ts';
import { PIECES, SHOP, SIGNALS, HARVESTS, CROSSBOW } from '../shared/catalogo.ts';
import { DESCRIPTION_BASE, PACKS } from '../shared/decorado.ts';
import { INITIAL_ROOMS, ROOM_DESCRIPTION, INITIAL_DWELLERS } from '../shared/refugioInicial.ts';
import { ROOM_INFO, REPO_INFO, INTEGRATION_STATE, INTEGRATION_STATE_SHORT, REPO_TYPE, LOOK, ACTIVITY_TABS, FRESH_HARVEST } from '../shared/etiquetas.ts';
import { NICKNAMES, ORIGIN, MANIA, ROBOT_ORIGIN } from '../shared/reclutas.ts';
import { SECTORS } from '../shared/sectores.ts';
import { MODELS, EFFORTS, PERMISSION_MODES } from '../shared/protocolo.ts';
import { COLUMNS } from '../shared/tablero.ts';
import { DEPLOYMENT_COLUMNS } from '../shared/despliegue.ts';

const spanish = new Set(Object.values(TEXTS).map(v => v.es));

describe('English mode guards', () => {
  it('every Spanish string of the data catalogues shown through tIs() is in the catalogue', () => {
    const data = [
      ...LOOK_PIECES.map(p => p.nombre), ...Object.values(SLOT_NAME), ...Object.values(NAME_REGION), nameRegion('piel', 'robot'),
      ...[...PIECES, ...SHOP, CROSSBOW].flatMap(p => [p.nombre, p.texto]), ...PIECES.map(p => p.rarity),
      ...SIGNALS.flatMap(s => [s.titulo, s.texto]), ...Object.values(HARVESTS).map(h => h.nombre),
      ...Object.values(DESCRIPTION_BASE), ...Object.values(PACKS).map(p => p.que),
      ...INITIAL_ROOMS.map(s => s.nombre), ...Object.values(ROOM_DESCRIPTION), ...INITIAL_DWELLERS.flatMap(h => [h.mote, h.bio]),
      ...Object.values(ROOM_INFO), REPO_INFO, ...Object.values(INTEGRATION_STATE), ...Object.values(INTEGRATION_STATE_SHORT),
      ...Object.values(REPO_TYPE), ...Object.values(LOOK), ...ACTIVITY_TABS, FRESH_HARVEST,
      ...NICKNAMES, ...ORIGIN, ...MANIA, ROBOT_ORIGIN,
      ...Object.values(SECTORS).flatMap(s => [s.nombre, s.motto]),
      MODELS[0].texto, ...EFFORTS.map(e => e.texto), ...PERMISSION_MODES.flatMap(m => [m.texto, m.pista]),
      ...COLUMNS.map(c => c.nombre), ...DEPLOYMENT_COLUMNS.map(c => c.nombre),
    ];
    expect([...new Set(data.filter(x => !spanish.has(x)))]).toEqual([]);
  });

  // the room tools (enviar_a_sala) and the remote control list rooms through roomNameIs, not their saved Spanish name
  it('room names reach English mode translated, Logistics wings included', () => {
    setLanguage('en');
    try {
      const names = [...INITIAL_ROOMS, { tipo: 'coordinacion', nombre: 'Logística web' }].map(roomNameIs);
      expect(names.filter(n => spanish.has(n) || n.startsWith('Logística'))).toEqual([]);
      expect(roomNameIs({ tipo: 'repo', nombre: 'Logística' })).toBe('Logística');
    } finally { setLanguage('es'); }
  });

  it('no literal with Spanish characters outside t()/tIs() in the client, the server, Electron and shared/', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) { if (!/^(node_modules|textos|fixtures)$/.test(n)) walk(p); } else if (/\.(tsx?|cjs|mjs|js)$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
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
// the catalogues themselves, and the demo data (integrations start off; the demo is for screenshots)
const SKIP_FILES = ['electron/textos.cjs', 'server/integraciones/demo.ts'];
// GLSL inside template literals (its comments are code comments)
const SHADER = /\b(uniform|varying|gl_FragColor|void main|vec[234]|float)\b/;
// developer logs: console, the Electron log file and the Chrome helpers' log (apuntar)
const LOG_LINE = /console\.(log|warn|error|info)|log\.write\(|apuntar\(/;
// What may stay in Spanish, and why. Keep it short.
const ALLOWED: [string, RegExp][] = [
  ['web/src/audio/teclado.ts', /./],                    // Spanish keyboard rows for the typing sounds, not text
  ['web/src/audio/voces.ts', /^[a-zñ]+$/],              // letters the dwellers' babble is made of
  ['web/src/main.tsx', /^ÁÑáñ¿¡$/],                     // glyphs to preload the fonts with
  ['web/src/ui/Buscador.tsx', /teléfono|móvil/],        // finder search synonyms in both languages
  ['web/src/ui/entrada.tsx', /^Español \(/],            // dictation languages, each named in its own language
  ['shared/idioma.ts', /^Español$/],                    // the language picker: each language in its own name
  ['shared/despliegue.ts', /bloquead/],                 // regex that reads Spanish and English PR bodies
  ['server/integraciones/normalizar.ts', /^[¡¿]$/],     // HTML entities
  ['server/estado.ts', /^Planificación $/],             // migration of saved room names (data keys)
  ['server/main.ts', /^Logística $/],                   // Logistics wings are saved as 'Logística <folder>' (roomNameIs)
  ['server/repos.ts', /^diseño$/],                      // project type key, shown with tIs()
  ['server/git.ts', /^(Rutas con parámetros|REF-236 )/], // GitHub demo profile and PRs (DEMO data, before connecting)
  ['shared/reclutas.ts', /^[A-ZÁÉÍÓÚ][a-záéíóúñ]+$/],   // recruits' first names
  ['shared/refugioInicial.ts', /^[A-ZÁÉÍÓÚ][a-záéíóúñ]+$/], // the initial cast's first names
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
