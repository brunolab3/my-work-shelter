// Salir a la superficie: lo que estaba en el juego sigue en una terminal de tu escritorio (iTerm, o Terminal si no
// hay iTerm). Las conversaciones de los habitantes se retoman con `claude --resume` en su carpeta; las terminales del
// juego se enganchan tal cual (el mismo PTY: lo que corra dentro sigue igual) con `./shelter enganchar`.
// Cada cosa se escribe en el shell de una pestaña nueva, como si la hubieras tecleado tú: con tu entorno, en tu
// historial, y al salir de Claude Code te quedas en la carpeta del proyecto.
import os from 'node:os';
import path from 'node:path';
import { existsSync, appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { t } from '../shared/idioma.ts';

export interface ItemDesktop { titulo: string; comando: string }
export type AppTerminal = 'iTerm' | 'Terminal';

export const quotes = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const chain = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES_CLI = ['acceptEdits', 'auto', 'plan', 'dontAsk', 'manual'];
// si estaba trabajando, se interrumpe en el juego y sigue fuera sin que haga falta pedírselo
export const promptContinue = () => t('prompt.continueOutside');

// `remoto`: con Remote Control (se sigue también desde claude.ai/code y la app de Claude del móvil), con ese nombre
export interface Resume { claudeId: string; cwd: string; continuar?: boolean; modelo?: string; esfuerzo?: string; permisos?: string; remoto?: string }
export function resumeCommand(r: Resume) {
  if (!UUID.test(r.claudeId)) throw new Error(t('server.invalidConversationIdentifier'));
  const a = ['cd', quotes(r.cwd), '&&', 'claude', '--resume', r.claudeId];
  if (r.modelo) a.push('--model', quotes(r.modelo));
  if (r.esfuerzo) a.push('--effort', quotes(r.esfuerzo));
  if (r.permisos === 'bypassPermissions') a.push('--dangerously-skip-permissions');
  else if (r.permisos && MODES_CLI.includes(r.permisos)) a.push('--permission-mode', r.permisos);
  // siempre con nombre: sin él, el texto de «continuar» se tomaría por el nombre de la sesión
  if (r.remoto !== undefined) a.push('--remote-control', quotes(r.remoto.trim() || 'work-shelter'));
  if (r.continuar) a.push(quotes(promptContinue()));
  return a.join(' ');
}
// `exec`: la pestaña es la terminal del juego; si esta termina (exit), la pestaña también
export const hookCommand = (shelter: string, socket: string, id: string) => `exec ${quotes(shelter)} enganchar ${quotes(id)} --socket ${quotes(socket)}`;

export function appTerminal(): AppTerminal {
  const pref = (process.env.SHELTER_TERMINAL ?? '').toLowerCase();
  if (pref === 'terminal') return 'Terminal';
  if (pref === 'iterm') return 'iTerm';
  return ['/Applications/iTerm.app', path.join(os.homedir(), 'Applications/iTerm.app')].some(existsSync) ? 'iTerm' : 'Terminal';
}

// AppleScript que abre una pestaña por cosa: en una ventana nueva (pánico, varias cosas) o en la ventana de delante
export function desktopScript(items: ItemDesktop[], app: AppTerminal, windowNew: boolean): string {
  if (app === 'Terminal') {
    // Terminal no crea pestañas por AppleScript: cada cosa en su ventana
    const l = ['tell application "Terminal"', 'activate'];
    for (const it of items) l.push(`set t to do script ${chain(it.comando)}`, `set custom title of t to ${chain(it.titulo)}`);
    return [...l, 'end tell'].join('\n');
  }
  const l = ['set estaba to application "iTerm" is running', 'tell application "iTerm"', 'activate', 'if not estaba then delay 0.6'];
  items.forEach((it, i) => {
    // recién abierto, iTerm ya trae su ventana vacía: se aprovecha
    if (i === 0) l.push(
      'if (not estaba) and (count of windows) > 0 then', 'set w to current window',
      `else if ${windowNew ? 'true' : 'false'} or (count of windows) is 0 then`, 'set w to (create window with default profile)',
      'else', 'set w to current window', 'tell w to create tab with default profile', 'end if');
    else l.push('tell w to create tab with default profile');
    l.push('tell current session of w', `set name to ${chain(it.titulo)}`, `write text ${chain(it.comando)}`, 'end tell');
  });
  return [...l, 'end tell'].join('\n');
}

export function openInDesktop(items: ItemDesktop[], o: { windowNew?: boolean } = {}): Promise<AppTerminal> {
  const app = appTerminal();
  if (!items.length) return Promise.resolve(app);
  // QA: en vez de abrir ventanas, se apunta lo que se abriría (una línea JSON por llamada)
  if (process.env.SHELTER_ESCRITORIO_PRUEBA) { appendFileSync(process.env.SHELTER_ESCRITORIO_PRUEBA, JSON.stringify({ app, windowNew: !!o.windowNew, items }) + '\n'); return Promise.resolve(app); }
  return new Promise((ok, ko) => execFile('osascript', ['-e', desktopScript(items, app, !!o.windowNew)], { timeout: 20_000 }, (err, _out, errOut) => {
    if (!err) { ok(app); return; }
    const texto = String(errOut || err.message);
    ko(new Error(/-1743|not authori[sz]ed|no autorizad/i.test(texto)
      ? `macOS no deja que work-shelter maneje ${app}: permítelo en Ajustes del Sistema › Privacidad y seguridad › Automatización.`
      : `No he podido abrir ${app}: ${texto.trim().split('\n').pop()}`));
  }));
}

// Conversaciones abiertas ahora mismo fuera del juego: un `claude --resume <id>` que no es del propio servidor, o
// cualquier Claude Code vivo que se apunta en ~/.claude/sessions/<pid>.json (un `claude` recién empezado en una terminal,
// la app de Claude). Retomarlas a la vez en el juego las corrompería: traerlas al refugio las cierra antes allí
export function outsideOpen(propio = process.pid): Set<string> {
  return new Set(outsideProcesses(propio).map(p => p.claudeId));
}

const RE_RESUME = /(?:--resume|-r)[ =]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
function outsideProcesses(propio: number): { pid: number; claudeId: string }[] {
  const r: { pid: number; claudeId: string }[] = [];
  let out = '';
  try { out = execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 3000, maxBuffer: 8 << 20 }); } catch { return r; }
  const fuera = new Set<number>();
  for (const linea of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(linea); if (!m || Number(m[2]) === propio || Number(m[1]) === propio) continue;
    fuera.add(Number(m[1]));
    for (const x of m[3].matchAll(RE_RESUME)) r.push({ pid: Number(m[1]), claudeId: x[1].toLowerCase() });
  }
  return [...r, ...registered(fuera).filter(x => !r.some(y => y.pid === x.pid))];
}
// las fichas de Claude Code de procesos vivos que no son del servidor (las de sus sesiones son hijas suyas)
function registered(vivos: Set<number>): { pid: number; claudeId: string }[] {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
  const r: { pid: number; claudeId: string }[] = [];
  let fichas: string[] = [];
  try { fichas = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch { return r; }
  for (const f of fichas) {
    try {
      const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (Number.isInteger(s?.pid) && vivos.has(s.pid) && typeof s.sessionId === 'string' && UUID.test(s.sessionId)) r.push({ pid: s.pid, claudeId: s.sessionId.toLowerCase() });
    } catch { /* ficha a medio escribir */ }
  }
  return r;
}

// Forzar el cierre de una conversación que se quedó abierta fuera (p. ej. la pestaña se cerró sin /exit y el proceso
// siguió vivo, o se trae al refugio): SIGTERM a sus procesos de fuera y, si a los 3 s alguno sigue, SIGKILL. Devuelve cuántos había.
export async function closeOutside(claudeId: string, propio = process.pid): Promise<number> {
  if (!UUID.test(claudeId)) throw new Error(t('server.invalidConversationIdentifier'));
  const id = claudeId.toLowerCase();
  const pids = () => outsideProcesses(propio).filter(p => p.claudeId === id).map(p => p.pid);
  const antes = pids();
  const senal = (pid: number, s: NodeJS.Signals) => { try { process.kill(pid, s); } catch {} };
  antes.forEach(pid => senal(pid, 'SIGTERM'));
  for (let t = 0; t < 30 && pids().length; t++) await new Promise(ok => setTimeout(ok, 100));
  pids().forEach(pid => senal(pid, 'SIGKILL'));
  return antes.length;
}

// A la app de Claude: su enlace `claude://resume?session=<id>` importa la conversación de Claude Code (lee el mismo
// .jsonl de ~/.claude/projects) y la abre en su lista. Se usa con la conversación ya cerrada en el juego.
export const linkAppClaude = (claudeId: string) => {
  if (!UUID.test(claudeId)) throw new Error(t('server.invalidConversationIdentifier'));
  return `claude://resume?session=${claudeId.toLowerCase()}`;
};
export function openInAppClaude(claudeId: string): Promise<void> {
  const url = linkAppClaude(claudeId);
  if (process.env.SHELTER_ESCRITORIO_PRUEBA) { appendFileSync(process.env.SHELTER_ESCRITORIO_PRUEBA, JSON.stringify({ app: 'Claude', url }) + '\n'); return Promise.resolve(); }
  return new Promise((ok, ko) => execFile('open', [url], { timeout: 15_000 }, err => err
    ? ko(new Error('No he podido abrir la app de Claude (¿está instalada?). La conversación está guardada: retómala desde su habitante o con claude --resume ' + claudeId + '.'))
    : ok()));
}
