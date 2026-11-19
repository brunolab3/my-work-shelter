// Anfitrión de las terminales: un proceso aparte que guarda los PTY para que sobrevivan a un reinicio del servidor
// (el botón «Reiniciar» de la regleta). El servidor le habla por un socket Unix en la carpeta temporal del usuario
// (privada en macOS) con una línea JSON por mensaje. Si el servidor no vuelve, se cierra solo: al minuto sin
// terminales, a los diez con ellas (lo que dura cualquier reinicio con compilación de por medio).
// Además del servidor, se le pueden enganchar clientes de fuera (`./shelter enganchar <id>`, en una terminal de tu
// escritorio: «salir a la superficie»). Ven y escriben en el mismo PTY a la vez que el juego, mandan en su tamaño
// mientras estén, y una terminal con alguien enganchado fuera no se cierra al apagarse el juego: el anfitrión
// sigue vivo por ella aunque el servidor no vuelva.
// Cada conexión dice quién es en su primera línea: {op:'servidor'}, {op:'enganchar', id, cols, filas} o {op:'lista'}.
// Basado en code-town/server/terminals.ts (MIT).
import net from 'node:net';
import path from 'node:path';
import { existsSync, statSync, chmodSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import pty, { type IPty } from 'node-pty';
import { t as tr } from '../shared/language.ts';

const SOCK = process.argv[2];
if (!SOCK) { console.error('Uso: terminalHost.ts <socket>'); process.exit(2); }
interface Term { p: IPty; shell: string; cwd: string; buffer: string; modes: Map<number, boolean>; kitty: number[]; queue: string; suffix: string; outside: Set<net.Socket>; resize: [number, number] }
const VERSION = 2;
const t = new Map<string, Term>();
let server: net.Socket | null = null;
let timer: NodeJS.Timeout | null = null;

const send = (m: Record<string, unknown>) => { if (server && !server.destroyed) server.write(JSON.stringify(m) + '\n'); };
const aOutside = (s: net.Socket, m: Record<string, unknown>) => { if (!s.destroyed) s.write(JSON.stringify(m) + '\n'); };
const withOutside = () => [...t.values()].some(x => x.outside.size);
function watch() {
  if (timer) clearTimeout(timer); timer = null;
  if (server || withOutside()) return;
  timer = setTimeout(() => { closeAll(); exit(); }, t.size ? 10 * 60_000 : 60_000);
}
// las que tienen a alguien enganchado fuera se quedan (si se pide), y con ellas el anfitrión
function closeAll(exceptOutside = false) { for (const [id, x] of [...t]) { if (exceptOutside && x.outside.size) continue; t.delete(id); try { x.p.kill(); } catch {} } }
function exit() { try { unlinkSync(SOCK); } catch {} process.exit(0); }

function open(m: any) {
  if (t.has(m.id)) return;
  let p: IPty;
  try { p = pty.spawn(m.shell, ['-l'], { name: 'xterm-256color', cols: m.cols, rows: m.filas, cwd: m.cwd, env: m.env }); }
  catch (e) { send({ ev: 'error', id: m.id, texto: (e as Error).message }); return; }
  const term: Term = { p, shell: path.basename(m.shell), cwd: m.cwd, buffer: '', modes: new Map(), kitty: [], queue: '', suffix: '', outside: new Set(), resize: [m.cols, m.filas] };
  t.set(m.id, term);
  p.onData(d => {
    term.buffer = (term.buffer + d).slice(-60_000);
    send({ ev: 'datos', id: m.id, datos: d });
    for (const s of term.outside) aOutside(s, { ev: 'datos', datos: d });
    if (followModes(term, d)) send({ ev: 'modos', id: m.id, suffix: term.suffix });
  });
  p.onExit(() => {
    if (t.get(m.id)?.p === p) t.delete(m.id);
    send({ ev: 'fin', id: m.id });
    for (const s of term.outside) { aOutside(s, { ev: 'fin' }); s.end(); }
    term.outside.clear();
    if (!server && !t.size) exit();
    watch();
  });
}

// Los modos que un programa pone al arrancar (pantalla alternativa, teclas de cursor, ratón, pegado entre corchetes,
// foco, protocolo de teclado de kitty) se quedan fuera de los últimos 60 KB en cuanto escribe mucho (Claude Code lo
// hace). Se siguen aquí para que quien se reengancha (recarga, reinicio) los recupere al final de lo repintado.
const MODES = [1, 25, 47, 1047, 1049, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 2004];
const DEFAULT: Record<number, boolean> = { 25: true };
const DEC = /\x1b\[\?([\d;]+)([hl])/g, KITTY = /\x1b\[([<>=])(\d*)(?:;(\d*))?u/g, RIS = /\x1bc/g;
function followModes(x: Term, d: string) {
  const text = x.queue + d, since = x.queue.length;
  x.queue = text.slice(-24);
  if (!text.includes('\x1b')) return false;
  const changes: [number, () => void][] = [];
  for (const m of text.matchAll(RIS)) if (m.index! + m[0].length > since) changes.push([m.index!, () => { x.modes.clear(); x.kitty = []; }]);
  for (const m of text.matchAll(DEC)) if (m.index! + m[0].length > since) changes.push([m.index!, () => { for (const n of m[1].split(';').map(Number)) if (MODES.includes(n)) x.modes.set(n, m[2] === 'h'); }]);
  for (const m of text.matchAll(KITTY)) if (m.index! + m[0].length > since) changes.push([m.index!, () => {
    const f = Number(m[2]) || 0;
    if (m[1] === '>') { if (x.kitty.length >= 16) x.kitty.shift(); x.kitty.push(f); }
    else if (m[1] === '<') x.kitty.splice(Math.max(0, x.kitty.length - (f || 1)));
    else { const mode = Number(m[3]) || 1, already = x.kitty.at(-1) ?? 0, n = mode === 2 ? already | f : mode === 3 ? already & ~f : f; if (x.kitty.length) x.kitty[x.kitty.length - 1] = n; else x.kitty.push(n); }
  }]);
  if (!changes.length) return false;
  for (const [, f] of changes.sort((a, b) => a[0] - b[0])) f();
  const before = x.suffix;
  let s = '';
  for (const [n, v] of x.modes) if (v !== (DEFAULT[n] ?? false)) s += `\x1b[?${n}${v ? 'h' : 'l'}`;
  s += '\x1b[<16u' + x.kitty.map(f => `\x1b[>${f}u`).join('');
  x.suffix = s;
  return s !== before;
}

// qué hay en primer plano: el shell, o un programa (vim, less, sudo, claude…)
function foreground(id: string) {
  const x = t.get(id); if (!x) return null;
  try { return path.basename(x.p.process ?? '').replace(/^-/, ''); } catch { return x.shell; }
}

function resize(x: Term, cols: number, rows: number) { try { x.p.resize(Math.max(20, cols | 0), Math.max(5, rows | 0)); } catch {} }

function handle(m: any) {
  const x = typeof m.id === 'string' ? t.get(m.id) : undefined;
  switch (m.op) {
    case 'abrir': open(m); break;
    case 'entrada': x?.p.write(String(m.datos)); break;
    // mientras alguien la tenga abierta fuera, manda su tamaño; el del juego se aplica cuando se va
    case 'tamano': if (x && Number.isFinite(m.cols) && Number.isFinite(m.filas)) { x.resize = [m.cols, m.filas]; if (!x.outside.size) resize(x, m.cols, m.filas); } break;
    case 'cerrar': if (x) { t.delete(m.id); try { x.p.kill(); } catch {} } break;
    case 'cerrarTodas': closeAll(!!m.salvoFuera); break;
    // alguien se ha reenganchado y ha repintado: un tamaño de ida y vuelta (SIGWINCH) hace que vim, less o Claude Code
    // vuelvan a dibujar su pantalla entera
    case 'empujar': if (x) setTimeout(() => { const { cols, rows } = x.p; try { x.p.resize(Math.max(20, cols - 1), rows); setTimeout(() => { try { x.p.resize(cols, rows); } catch {} }, 80); } catch {} }, 400); break;
    case 'primerPlano': send({ ev: 'primerPlano', peticion: m.peticion, id: m.id, fg: foreground(m.id) }); break;
    // el juego se apaga: lo que esté abierto fuera sigue (el anfitrión se queda por ello)
    case 'apagar': closeAll(true); if (!t.size) exit(); break;
  }
}

// ---------------------------------------------------------------- clientes de fuera (terminales del escritorio)
function attach(s: net.Socket, m: any) {
  const x = typeof m.id === 'string' ? t.get(m.id) : undefined;
  if (!x) { aOutside(s, { ev: 'error', texto: tr('server.thatTerminalNoLongerExists') }); s.end(); return; }
  x.outside.add(s);
  if (timer) { clearTimeout(timer); timer = null; }
  // lo que ya había en pantalla y los modos vigentes; el tamaño nuevo (o el empujón) hace que el programa se redibuje
  aOutside(s, { ev: 'datos', datos: x.buffer + x.suffix });
  if (Number.isFinite(m.cols) && Number.isFinite(m.filas) && (m.cols !== x.p.cols || m.filas !== x.p.rows)) resize(x, m.cols, m.filas);
  else handle({ op: 'empujar', id: m.id });
  send({ ev: 'fuera', id: m.id, n: x.outside.size });
  const drop = () => {
    if (!x.outside.delete(s)) return;
    send({ ev: 'fuera', id: m.id, n: x.outside.size });
    if (!x.outside.size && t.get(m.id) === x) resize(x, x.resize[0], x.resize[1]);
    watch();
  };
  s.on('close', drop); s.on('error', drop);
  return (l: any) => {
    if (l.op === 'entrada') x.p.write(String(l.datos));
    else if (l.op === 'tamano' && Number.isFinite(l.cols) && Number.isFinite(l.filas)) resize(x, l.cols, l.filas);
  };
}
const list = () => [...t].map(([id, x]) => ({ id, cwd: x.cwd, shell: x.shell, program: foreground(id), fuera: x.outside.size }));

ensureHelper();
if (existsSync(SOCK)) try { unlinkSync(SOCK); } catch {}
const srv = net.createServer(s => {
  s.setEncoding('utf8');
  // la primera línea dice quién es
  let onReceive: ((m: any) => void) | null = null;
  const introduce = (m: any) => {
    if (m.op === 'enganchar') { onReceive = attach(s, m) ?? (() => {}); return; }
    if (m.op === 'lista') { aOutside(s, { ev: 'lista', terminales: list() }); s.end(); onReceive = () => {}; return; }
    // un solo servidor a la vez: el nuevo (tras un reinicio) sustituye al viejo
    if (server) server.destroy();
    server = s; watch();
    s.write(JSON.stringify({ ev: 'hola', version: VERSION, terminales: [...t].map(([id, x]) => ({ id, cwd: x.cwd, shell: x.shell, bufer: x.buffer, suffix: x.suffix, fuera: x.outside.size })) }) + '\n');
    onReceive = handle;
    if (m.op !== 'servidor') handle(m);
  };
  let rest = '';
  s.on('data', (d: string) => {
    rest += d;
    let i: number;
    while ((i = rest.indexOf('\n')) >= 0) { const line = rest.slice(0, i); rest = rest.slice(i + 1); try { const m = JSON.parse(line); if (onReceive) onReceive(m); else introduce(m); } catch {} }
  });
  const outside = () => { if (server === s) { server = null; watch(); } };
  s.on('close', outside); s.on('error', outside);
});
// el socket nace ya con permisos 0600 (umask antes de listen): sin ventana en la que otro usuario pueda conectarse
const umaskBefore = process.umask(0o077);
srv.listen(SOCK, () => { process.umask(umaskBefore); try { chmodSync(SOCK, 0o600); } catch {} watch(); });
srv.on('error', e => { console.error('Anfitrión de terminales:', e.message); process.exit(1); });
process.on('SIGTERM', () => { closeAll(); exit(); });
process.on('SIGHUP', () => {});

// npm no conserva el bit de ejecución del ayudante precompilado de node-pty en macOS (posix_spawnp failed)
function ensureHelper() {
  try {
    const root = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    for (const r of [path.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'), path.join(root, 'build', 'Release', 'spawn-helper')])
      if (existsSync(r) && !(statSync(r).mode & 0o111)) chmodSync(r, 0o755);
  } catch (e) { console.error('No pude preparar el ayudante de terminales:', (e as Error).message); }
}
