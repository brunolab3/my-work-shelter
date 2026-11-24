// What a dweller's conversation started (dev servers, watchers, test runs) are descendants of its `claude` process while
// it lives; once it exits they are reparented to PID 1 and can no longer be told apart. So closing a conversation takes
// the snapshot first, while `claude` is still alive, and stops them: SIGTERM, then SIGKILL after 3 s to whatever is still
// the same process (`ng serve` ignores SIGTERM).
import { execFile } from 'node:child_process';

// set on each dweller's `claude` process (its env), so the game finds it among its own children
export const CONVERSATION_MARK = 'WORK_SHELTER_CONVERSATION';

export type PsRow = { pid: number; ppid: number; command: string };

/** `ps -axwwo pid=,ppid=,command=` → rows. */
export function parsePs(out: string): PsRow[] {
  const r: PsRow[] = [];
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(l);
    if (m) r.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3].trim() });
  }
  return r;
}

/** Every descendant of `root` (not `root` itself), parents before their children; never `own` nor PID 1. */
export function descendants(rows: PsRow[], root: number, own = process.pid): PsRow[] {
  const children = new Map<number, PsRow[]>();
  for (const p of rows) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const r: PsRow[] = [], queue = [root], seen = new Set([root]);
  while (queue.length) {
    for (const c of children.get(queue.shift()!) ?? []) if (!seen.has(c.pid) && c.pid !== own && c.pid > 1) { seen.add(c.pid); r.push(c); queue.push(c.pid); }
  }
  return r;
}

/** Of `own`'s direct children, the one whose environment (`ps -E`) carries the conversation's mark. */
export function markedChild(envs: string, sessionId: string): number | undefined {
  for (const [pid, id] of markedChildren(envs)) if (id === sessionId) return pid;
}
/** Every process in a `ps -E` listing that carries a conversation's mark → that conversation's id. */
export function markedChildren(envs: string): Map<number, string> {
  const r = new Map<number, string>(), prefix = `${CONVERSATION_MARK}=`;
  for (const l of envs.split('\n')) {
    const m = /^\s*(\d+)\s(.*)$/.exec(l);
    const mark = m?.[2].split(/\s+/).find(w => w.startsWith(prefix));
    if (mark && !r.has(Number(m![1]))) r.set(Number(m![1]), mark.slice(prefix.length));
  }
  return r;
}

export const ps = (args: string[]) => new Promise<string>(ok => execFile('ps', args, { maxBuffer: 32 * 1024 * 1024, timeout: 5000 }, (_e, out) => ok(String(out ?? ''))));

/** The processes the conversation's `claude` started (its descendants), now. Empty if it can't be found. */
export async function processesOf(sessionId: string, own = process.pid): Promise<PsRow[]> {
  const rows = parsePs(await ps(['-axwwo', 'pid=,ppid=,command=']));
  const mine = rows.filter(p => p.ppid === own).map(p => p.pid);
  if (!mine.length) return [];
  const claude = markedChild(await ps(['-wwEo', 'pid=,command=', '-p', mine.join(',')]), sessionId);
  return claude ? descendants(rows, claude, own) : [];
}

/** SIGTERM to each; after `graceMs`, SIGKILL to those still running the same command (a reused PID is left alone). */
export function stopProcesses(procs: PsRow[], graceMs = 3000) {
  const signal = (pid: number, s: NodeJS.Signals) => { try { process.kill(pid, s); } catch {} };
  procs.forEach(p => signal(p.pid, 'SIGTERM'));
  if (!procs.length) return;
  setTimeout(async () => {
    const now = new Map(parsePs(await ps(['-axwwo', 'pid=,ppid=,command='])).map(p => [p.pid, p.command]));
    for (const p of procs) if (now.get(p.pid) === p.command) signal(p.pid, 'SIGKILL');
  }, graceMs).unref();
}
