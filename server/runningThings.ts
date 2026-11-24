// What is running, for the top bar's memory chip (shared/runningThings.ts): one `ps` of every process with its memory
// and age, the environments of the server's children to tell each dweller's `claude` by its mark (sessionProcesses.ts),
// and one `lsof` of the local ports listening. Only when the client asks (the popover open), never on a timer; all
// asynchronous, so the game's loop never waits. A stop is only for what a dweller's `claude` started.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { descendants, markedChildren, ps, stopProcesses, type PsRow } from './sessionProcesses.ts';
import { parseEtime, type DevServer, type DwellerProcess, type GamePart, type GameProcess, type ProcessInfo, type RunningSnapshot } from '../shared/runningThings.ts';

export interface ProcRow extends PsRow { mb: number; ageS: number }
const PS_ARGS = ['-axwwo', 'pid=,ppid=,rss=,etime=,command='];

/** `ps -axwwo pid=,ppid=,rss=,etime=,command=` → rows (rss in KB → MB) */
export function parseProcs(out: string): ProcRow[] {
  const r: ProcRow[] = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s(.*)$/.exec(l);
    if (m) r.push({ pid: Number(m[1]), ppid: Number(m[2]), mb: Number(m[3]) / 1024, ageS: parseEtime(m[4]), command: m[5].trim() });
  }
  return r;
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` → pid → its listening ports */
export function parseListeners(out: string): Map<number, number[]> {
  const r = new Map<number, number[]>();
  let pid = 0;
  for (const l of out.split('\n')) {
    if (l.startsWith('p')) pid = Number(l.slice(1));
    else if (l.startsWith('n') && pid) {
      const port = Number(/:(\d+)$/.exec(l)?.[1]);
      if (port && !r.get(pid)?.includes(port)) r.set(pid, [...(r.get(pid) ?? []), port]);
    }
  }
  return r;
}

export interface GroupContext {
  server: number;
  /** the Electron app's main process, when the game runs as the app */
  app?: number;
  /** the terminal host's script path: detached, it outlives server restarts (server/terminals.ts) */
  terminalHost?: string;
  /** each dweller's `claude` pid → its conversation id */
  dwellers: Map<number, string>;
}

// the macOS services that listen on local ports (AirPlay, sharing...) are not anyone's dev server
const SYSTEM = /^\/(System|usr\/libexec|usr\/sbin)\//;
const appPart = (command: string): GamePart => /--type=renderer\b/.test(command) ? 'renderer' : /--type=gpu-process\b/.test(command) ? 'gpu' : 'helper';
const bySize = <T extends { mb: number }>(l: T[]) => l.sort((a, b) => b.mb - a.mb);

/** The snapshot's groups: the game (the server, what launched it up to the app, the app's helpers, the terminal host and
 *  the server's other children), the dwellers (each `claude` and its descendants, as a tree whose siblings go largest
 *  first) and the dev servers (every local listener that is not the game's nor the system's). */
export function groupRunning(rows: ProcRow[], listeners: Map<number, number[]>, ctx: GroupContext, now = Date.now()): RunningSnapshot {
  const byPid = new Map(rows.map(p => [p.pid, p]));
  const info = (p: ProcRow, depth?: number): ProcessInfo => ({ pid: p.pid, ppid: p.ppid, mb: p.mb, ageS: p.ageS, command: p.command, ...(listeners.get(p.pid) ? { ports: listeners.get(p.pid) } : {}), ...(depth ? { depth } : {}) });
  const taken = new Set<number>();
  const game: GameProcess[] = [];
  const addGame = (p: ProcRow | undefined, part: GamePart) => { if (p && !taken.has(p.pid)) { taken.add(p.pid); game.push({ ...info(p), part }); } };

  // the dwellers first: their subtrees are never the game's
  const owner = new Map<number, string>();
  const dwellers: DwellerProcess[] = [];
  for (const [pid, sessionId] of ctx.dwellers) {
    const p = byPid.get(pid); if (!p) continue;
    const sub = descendants(rows, pid, ctx.server);
    const depth = new Map([[pid, 0]]);
    for (const c of sub) depth.set(c.pid, (depth.get(c.ppid) ?? 0) + 1);
    // the tree in order, each level largest first
    const kids = new Map<number, ProcRow[]>();
    for (const c of sub) kids.set(c.ppid, [...(kids.get(c.ppid) ?? []), byPid.get(c.pid)!]);
    const children: ProcessInfo[] = [];
    const walk = (at: number) => { for (const c of bySize(kids.get(at) ?? [])) { children.push(info(c, depth.get(c.pid))); walk(c.pid); } };
    walk(pid);
    [pid, ...sub.map(c => c.pid)].forEach(x => { taken.add(x); owner.set(x, sessionId); });
    dwellers.push({ ...info(p), sessionId, children });
  }

  // the game: the server and its launchers up to the app, the app's own processes, the terminal host, the server's
  // other children (git, the terminal host before a restart)
  addGame(byPid.get(ctx.server), 'server');
  // launched from a terminal: only its supervisor, not the shell above it
  for (let p = byPid.get(byPid.get(ctx.server)?.ppid ?? 0); p && p.pid > 1; p = byPid.get(p.ppid)) {
    const supervisor = /supervisor\.mjs\b/.test(p.command);
    if (!ctx.app && !supervisor) break;
    addGame(p, p.pid === ctx.app ? 'main' : supervisor ? 'supervisor' : 'helper');
    if (p.pid === ctx.app) break;
  }
  if (ctx.app) for (const p of descendants(rows, ctx.app, ctx.server)) addGame(byPid.get(p.pid), appPart(p.command));
  const host = ctx.terminalHost;
  if (host) for (const p of rows) if (p.command.includes(host)) addGame(p, 'terminals');
  for (const p of descendants(rows, ctx.server, -1)) if (!taken.has(p.pid) && p.ppid === ctx.server && !/^(\S*\/)?(ps|lsof) /.test(p.command)) addGame(byPid.get(p.pid), 'helper');

  const devServers: DevServer[] = [];
  for (const [pid] of listeners) {
    const p = byPid.get(pid);
    if (!p || (taken.has(pid) && !owner.has(pid)) || SYSTEM.test(p.command)) continue;
    const parent = byPid.get(p.ppid);
    devServers.push({ ...info(p), ...(owner.has(pid) ? { sessionId: owner.get(pid) } : {}), ...(parent && parent.pid > 1 ? { parent: { pid: parent.pid, command: parent.command } } : {}) });
  }

  // the helpers as one line: how many and their memory
  const helperRows = game.filter(p => p.part === 'helper');
  const helpers = { count: helperRows.length, mb: helperRows.reduce((s, p) => s + p.mb, 0) };
  const gameMb = game.reduce((s, p) => s + p.mb, 0);
  const totalMb = gameMb + dwellers.reduce((s, d) => s + d.mb + d.children.reduce((t, c) => t + c.mb, 0), 0);
  const weight = (d: DwellerProcess) => d.mb + d.children.reduce((t, c) => t + c.mb, 0);
  return { at: now, game: bySize(game.filter(p => p.part !== 'helper')), helpers, gameMb, dwellers: dwellers.sort((a, b) => weight(b) - weight(a)), devServers: bySize(devServers), totalMb };
}

const lsof = () => new Promise<string>(ok => execFile('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn', '-w'], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 }, (_e, out) => ok(String(out ?? ''))));

/** The server's children that are a dweller's `claude` → its conversation: by the mark in its environment or, started
 *  before the mark existed, by the Claude session it resumes (`--resume=<id>`, `byClaudeId`); '' if neither says */
export function dwellersOf(rows: PsRow[], own: number, marks: Map<number, string>, byClaudeId: (claudeId: string) => string | undefined = () => undefined): Map<number, string> {
  const r = new Map<number, string>();
  for (const p of rows) {
    if (p.ppid !== own) continue;
    if (marks.has(p.pid)) { r.set(p.pid, marks.get(p.pid)!); continue; }
    if (!/^(\S*\/)?claude(\s|$)/.test(p.command)) continue;
    const resumed = /--resume[= ](\S+)/.exec(p.command)?.[1];
    r.set(p.pid, (resumed && byClaudeId(resumed)) || '');
  }
  return r;
}

async function read(own: number, byClaudeId?: (claudeId: string) => string | undefined) {
  const [rows, listeners] = await Promise.all([ps(PS_ARGS).then(parseProcs), lsof().then(parseListeners)]);
  const mine = rows.filter(p => p.ppid === own).map(p => p.pid);
  const marks = mine.length ? markedChildren(await ps(['-wwEo', 'pid=,command=', '-p', mine.join(',')])) : new Map<number, string>();
  return { rows, listeners, dwellers: dwellersOf(rows, own, marks, byClaudeId) };
}

/** The app's main process: when launched by it (SHELTER_DESDE_APP), the server's topmost ancestor under launchd */
function appPid(rows: ProcRow[], own: number): number | undefined {
  if (!process.env.SHELTER_DESDE_APP) return undefined;
  const byPid = new Map(rows.map(p => [p.pid, p]));
  let top: ProcRow | undefined;
  for (let p = byPid.get(byPid.get(own)?.ppid ?? 0); p && p.pid > 1; p = byPid.get(p.ppid)) top = p;
  return top?.pid;
}

const TERMINAL_HOST = path.join(import.meta.dirname, 'terminalHost.ts');
let pending: Promise<RunningSnapshot> | null = null;
/** One snapshot now; asked again while one is being read, it gets that one */
export function runningThings(byClaudeId?: (claudeId: string) => string | undefined, own = process.pid): Promise<RunningSnapshot> {
  return pending ??= read(own, byClaudeId).then(({ rows, listeners, dwellers }) => groupRunning(rows, listeners, { server: own, app: appPid(rows, own), terminalHost: TERMINAL_HOST, dwellers })).finally(() => { pending = null; });
}

/** What stopping `pid` stops: it and its descendants, only if a dweller's `claude` started it (never the `claude` itself,
 *  the game nor anything else); undefined otherwise */
export function stopTarget(rows: PsRow[], dwellers: Map<number, string>, pid: number, own: number): { sessionId: string; procs: PsRow[] } | undefined {
  for (const [claude, sessionId] of dwellers) {
    const p = descendants(rows, claude, own).find(c => c.pid === pid);
    if (p) return { sessionId, procs: [p, ...descendants(rows, pid, own)] };
  }
}

/** Stops a dweller's process (stopTarget) the same way as closing its conversation (SIGTERM, SIGKILL after 3 s) */
export async function stopDwellerProcess(pid: number, byClaudeId?: (claudeId: string) => string | undefined, own = process.pid): Promise<{ sessionId: string; command: string; n: number } | { error: 'notADwellers' }> {
  const { rows, dwellers } = await read(own, byClaudeId);
  const target = stopTarget(rows, dwellers, pid, own);
  if (!target) return { error: 'notADwellers' };
  stopProcesses(target.procs);
  return { sessionId: target.sessionId, command: target.procs[0].command, n: target.procs.length };
}
