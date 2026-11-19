// Terminales reales (shell de login sobre PTY) en la carpeta de cada sala: para lo que solo el humano puede hacer
// (sudo, prompts interactivos, logins, Claude Code a mano). Los PTY viven en un proceso aparte
// (terminalHost.ts) para sobrevivir a un reinicio del servidor; aquí se reparten a las pestañas y, tras una
// recarga del cliente o un reinicio, se reenganchan al socket nuevo con lo que ya había en pantalla.
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA } from './state.ts';
import { t } from '../shared/language.ts';
import type { ServerMessage } from '../shared/protocol.ts';

type Listener = (m: ServerMessage) => void;
interface Term { shell: string; cwd: string; listeners: Set<Listener>; buffer: string; suffix: string; last?: string; outside: number; inPrompt?: boolean; program?: string }

// en la carpeta temporal del usuario (privada en macOS) y corta: los sockets Unix no admiten rutas largas
export const SOCKET_TERMINALS = path.join(os.tmpdir(), `work-shelter-${createHash('sha1').update(path.resolve(DATA)).digest('hex').slice(0, 10)}.sock`);
const HOST = path.join(import.meta.dirname, 'terminalHost.ts');
// lo que identifica a la terminal desde la que se lanzó el juego (iTerm, Terminal…) no vale dentro de la del juego
const FOREIGN = /^(CLAUDE_CODE|CLAUDECODE$|SHELTER_|ITERM_|LC_TERMINAL|TERM_PROGRAM|TERM_SESSION_ID$|KITTY_|WEZTERM_|GHOSTTY_|VSCODE_|COLORFGBG$)/;

export class Terminals {
  private t = new Map<string, Term>();
  private s: net.Socket | null = null;
  private queue: string[] = [];
  private requests = new Map<number, (fg: string | null) => void>();
  private n = 0;
  private dropped = false;
  private version = 0;          // la del anfitrión (1: anterior a los clientes de fuera)
  private renewing = false;    // se ha pedido a un anfitrión viejo que se vaya para lanzar uno nuevo
  constructor(private allowed: (cwd: string) => boolean, private clients: () => Iterable<Listener>) {
    this.connect(true, 0);
    // qué hay en primer plano se vigila siempre: el piloto de cada pestaña y la confirmación al cerrar dependen de ello
    setInterval(() => { if (this.s) for (const id of this.t.keys()) this.state(id); }, 1000).unref();
  }

  // ---------------------------------------------------------------- enlace con el anfitrión
  private connect(launch: boolean, attempt: number) {
    if (this.dropped) return;
    const s = net.connect(SOCKET_TERMINALS);
    let connected = false, rest = '';
    s.setEncoding('utf8');
    // el anfitrión sabe quién es cada conexión por su primera línea
    s.on('connect', () => { connected = true; this.s = s; s.write(JSON.stringify({ op: 'servidor' }) + '\n'); for (const l of this.queue.splice(0)) s.write(l); });
    s.on('data', (d: string) => {
      rest += d;
      let i: number;
      while ((i = rest.indexOf('\n')) >= 0) { const line = rest.slice(0, i); rest = rest.slice(i + 1); try { this.receive(JSON.parse(line)); } catch {} }
    });
    s.on('error', () => {});
    s.on('close', () => {
      if (!connected) {
        // no hay anfitrión: se lanza uno (una vez) y se reintenta mientras arranca
        if (launch) this.launch();
        if (attempt < 60) setTimeout(() => this.connect(false, attempt + 1), 150);
        else console.error('No arranca el anfitrión de terminales: las terminales del juego no funcionarán.');
        return;
      }
      if (this.s !== s) return;
      this.s = null;
      if (this.dropped) return;
      if (this.renewing) { this.renewing = false; this.version = 0; setTimeout(() => this.connect(true, 0), 150); return; }
      // el anfitrión se ha caído: sus terminales se han ido con él
      for (const [id, x] of [...this.t]) { this.t.delete(id); for (const o of x.listeners) o({ t: 'terminalEstado', id, inPrompt: true, live: false }); }
      setTimeout(() => this.connect(true, 0), 300);
    });
  }
  private launch() {
    const p = spawn(process.execPath, [...process.execArgv.filter(a => !a.startsWith('--inspect')), HOST, SOCKET_TERMINALS], { detached: true, stdio: 'ignore', cwd: path.dirname(HOST), env: process.env });
    p.unref();
  }
  private op(m: Record<string, unknown>) { const l = JSON.stringify(m) + '\n'; if (this.s) this.s.write(l); else this.queue.push(l); }

  private receive(m: any) {
    switch (m.ev) {
      case 'hola':
        this.version = Number(m.version) || 1;
        // tras un reinicio del servidor: las terminales que siguen vivas vuelven a las pestañas abiertas
        for (const x of m.terminales ?? []) {
          if (this.t.has(x.id)) continue;
          const term: Term = { shell: x.shell, cwd: x.cwd, listeners: new Set(this.clients()), buffer: x.bufer ?? '', suffix: x.suffix ?? '', outside: Number(x.fuera) || 0 };
          this.t.set(x.id, term);
          for (const o of term.listeners) this.repaint(x.id, term, o);
          this.state(x.id, true);
        }
        break;
      case 'datos': { const x = this.t.get(m.id); if (!x) return; x.buffer = (x.buffer + m.datos).slice(-60_000); for (const o of x.listeners) o({ t: 'terminalDatos', id: m.id, data: m.datos }); break; }
      case 'modos': { const x = this.t.get(m.id); if (x) x.suffix = String(m.suffix ?? ''); break; }
      case 'fin': { const x = this.t.get(m.id); if (!x) return; this.t.delete(m.id); for (const o of x.listeners) o({ t: 'terminalEstado', id: m.id, inPrompt: true, live: false }); this.renewSiEmpty(); break; }
      // alguien ha abierto (o cerrado) esta terminal en el escritorio
      case 'fuera': { const x = this.t.get(m.id); if (!x) return; x.outside = Number(m.n) || 0; this.notifyState(m.id, x); break; }
      case 'error': {
        const x = this.t.get(m.id); if (!x) return; this.t.delete(m.id);
        for (const o of x.listeners) { o({ t: 'aviso', level: 'error', text: t('server.couldNotOpenTerminal', { error: m.texto }) }); o({ t: 'terminalEstado', id: m.id, inPrompt: true, live: false }); }
        break;
      }
      case 'primerPlano': { const f = this.requests.get(m.peticion); if (f) { this.requests.delete(m.peticion); f(m.fg ?? null); } break; }
    }
  }

  // ---------------------------------------------------------------- lo que usa el servidor
  open(id: string, cwd: string, cols: number, rows: number, send: Listener) {
    const already = this.t.get(id);
    // varias pestañas: cada una recibe la salida (y al engancharse, lo que ya había)
    if (already) { if (!already.listeners.has(send)) { already.listeners.add(send); this.repaint(id, already, send); } this.state(id, true); return; }
    const dir = path.resolve(cwd);
    if (!existsSync(dir) || !this.allowed(dir)) { send({ t: 'terminalEstado', id, inPrompt: true, live: false }); send({ t: 'aviso', level: 'error', text: t('server.iCannotOpenATerminal', { dir }) }); return; }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !FOREIGN.test(k)) env[k] = v;
    env.TERM = 'xterm-256color'; env.COLORTERM = 'truecolor'; env.LANG = env.LANG || 'es_ES.UTF-8';
    const shell = process.env.SHELL || '/bin/zsh';
    this.t.set(id, { shell: path.basename(shell), cwd: dir, listeners: new Set([send]), buffer: '', suffix: '', outside: 0 });
    this.op({ op: 'abrir', id, cwd: dir, cols: Math.max(20, cols), filas: Math.max(5, rows), shell, env });
    setTimeout(() => this.state(id, true), 300);
  }

  // quien se engancha a una terminal que ya existía la repinta desde cero: lo último que salió, los modos vigentes y
  // un empujón para que el programa de primer plano vuelva a dibujarse
  private repaint(id: string, x: Term, o: Listener) {
    if (!x.buffer && !x.suffix) return;
    o({ t: 'terminalDatos', id, data: x.buffer + x.suffix, repaint: true });
    this.op({ op: 'empujar', id });
  }

  // ¿está el shell en el prompt o hay un programa en primer plano (vim, less, sudo, un build, Claude Code)? Solo se
  // avisa a las pestañas si cambia (o si se pide: quien se acaba de enganchar)
  async state(id: string, force = false) {
    const t = this.t.get(id); if (!t) return;
    const request = ++this.n;
    let fg = await new Promise<string | null | undefined>(ok => { this.requests.set(request, ok); this.op({ op: 'primerPlano', id, peticion: request }); setTimeout(() => { if (this.requests.delete(request)) ok(undefined); }, 1500); });
    if (!this.t.has(id) || fg === undefined) return;   // sin respuesta del anfitrión no se cambia nada
    // la instalación nativa de Claude Code se llama por su versión (~/.local/share/claude/versions/2.1.296)
    if (fg && /^\d+\.\d+\.\d+/.test(fg)) fg = 'claude';
    const inPrompt = !fg || fg === t.shell || fg === 'login';
    const key = inPrompt ? '' : fg!;
    t.inPrompt = inPrompt; t.program = inPrompt ? undefined : fg!;
    if (force || key !== t.last) { t.last = key; this.notifyState(id, t); }
    return inPrompt;
  }
  private notifyState(id: string, t: Term) { for (const o of t.listeners) o({ t: 'terminalEstado', id, inPrompt: t.inPrompt ?? true, program: t.program, live: true, outside: t.outside }); }
  // anfitrión viejo: se le pide que se vaya y se lanza uno nuevo (solo sin terminales: no se pierde nada)
  private renew() { if (!this.s || this.renewing) return; this.renewing = true; this.s.write(JSON.stringify({ op: 'apagar' }) + '\n'); }
  private renewSiEmpty() { if (this.version === 1 && !this.t.size) this.renew(); }

  input(id: string, data: string) { if (this.t.has(id) && typeof data === 'string') this.op({ op: 'entrada', id, datos: data }); }
  resize(id: string, cols: number, rows: number) { if (this.t.has(id) && Number.isFinite(cols) && Number.isFinite(rows)) this.op({ op: 'tamano', id, cols, filas: rows }); }
  close(id: string) {
    const t = this.t.get(id); if (!t) return;
    this.t.delete(id); this.op({ op: 'cerrar', id });
    for (const o of t.listeners) o({ t: 'terminalEstado', id, inPrompt: true, live: false });
    this.renewSiEmpty();
  }
  drop(send: Listener) { for (const t of this.t.values()) t.listeners.delete(send); }
  // las que están abiertas en el escritorio se quedan si se pide (el juego se ha quedado sin nadie, pero tú sigues fuera)
  closeAll(exceptOutside = false) { let n = 0; for (const [id, t] of [...this.t]) if (!exceptOutside || !t.outside) { this.close(id); n++; } return n; }
  openSessions() { return [...this.t.entries()].map(([id, t]) => ({ id, cwd: t.cwd, inPrompt: t.inPrompt ?? true, program: t.program, fuera: t.outside })); }
  exists(id: string) { return this.t.has(id); }
  outside(id: string) { return this.t.get(id)?.outside ?? 0; }
  // las terminales abiertas antes de actualizar el anfitrión no se pueden enganchar desde fuera
  outsideAccepts() { return this.version >= 2; }
  // reinicio del servidor: el anfitrión se queda con las terminales vivas para el servidor nuevo
  dropHost() { this.dropped = true; this.s?.end(); }
  // apagado del juego: el anfitrión cierra todas y se va
  shutDown() { this.dropped = true; this.op({ op: 'apagar' }); this.s?.end(); }
}
