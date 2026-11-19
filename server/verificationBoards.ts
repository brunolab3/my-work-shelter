// The tracker's side of production verification: each board (a Jira project, a Linear team: the key's prefix) has its own
// workflow, so the Overseer picks its prod-check status and the done one after it, from that board's own statuses, in the
// tracker's page of the vault; at start the game asks once for the boards of open tasks still without one. A task in its
// board's prod-check status opens its final checkpoint, and once that is evidenced the pre-flight offers the workflow's
// own transition to the done status (Jira only, the one write it already makes from the board; Linear stays read-only).
// Saved in settings.verificationBoards. Only connected trackers count: demo data never opens a checkpoint.
import { boardOf, sameStatus, type BoardStatuses, type TaskTracker } from '../shared/verification.ts';
import type { JiraTransition } from '../shared/board.ts';
import { t } from '../shared/language.ts';

export type { TaskTracker };
export type Tracker = TaskTracker['source'];
export interface TaskStatus { source: Tracker; key: string; state: string; done: boolean }
export interface BoardSetup extends BoardStatuses { source: Tracker; board: string; states: string[]; error?: string }

export interface CtxTrackers {
  action(name: string, d: Record<string, unknown>): Promise<any>;
  connected(source: Tracker): boolean;
  settings(): Record<string, BoardStatuses>;
  save(board: string, v: BoardStatuses): void;
}

/** The tasks the connected trackers show (yours), with their status */
export async function taskStatuses(ctx: CtxTrackers): Promise<TaskStatus[]> {
  const out: TaskStatus[] = [];
  if (ctx.connected('jira')) {
    const r = await ctx.action('panel', { source: 'jira' }).catch(() => null);
    for (const x of r?.tareas ?? []) out.push({ source: 'jira', key: String(x.key).toUpperCase(), state: String(x.state ?? ''), done: x.category === 'done' });
  }
  if (ctx.connected('linear')) {
    const r = await ctx.action('panel', { source: 'linear' }).catch(() => null);
    for (const g of r?.myIssues ?? []) for (const i of g.issues ?? []) if (i.identifier) out.push({ source: 'linear', key: String(i.identifier).toUpperCase(), state: String(i.state?.name ?? ''), done: false });
  }
  return out;
}

/** A task's status in its tracker, with its board's setup */
export async function taskTracker(ctx: CtxTrackers, key: string, verified = false): Promise<TaskTracker | undefined> {
  const board = boardOf(key); if (!board) return undefined;
  const x = (await taskStatuses(ctx)).find(s => s.key === key.toUpperCase()); if (!x) return undefined;
  const m = ctx.settings()[board] ?? {};
  return { source: x.source, state: x.state, board, ...m, inProdCheck: sameStatus(x.state, m.test),
    move: verified && x.source === 'jira' && !x.done && !sameStatus(x.state, m.done) };
}

/** The boards of your open tasks in each connected tracker, with their statuses and what's picked */
export async function boardsSetup(ctx: CtxTrackers, source?: Tracker): Promise<BoardSetup[]> {
  const tareas = (await taskStatuses(ctx)).filter(x => !x.done && (!source || x.source === source));
  const boards = [...new Map(tareas.map(x => [`${x.source}:${boardOf(x.key)}`, { source: x.source, board: boardOf(x.key)! }])).values()].filter(x => x.board);
  const settings = ctx.settings();
  return Promise.all(boards.map(async b => {
    try { return { ...b, ...settings[b.board], states: (await ctx.action('estadosTablero', { source: b.source, board: b.board }))?.states ?? [] }; }
    catch (e) { return { ...b, ...settings[b.board], states: [], error: (e as Error).message }; }
  }));
}

/** The boards of open tasks still without a prod-check status (for the notice at start) */
export async function boardsUnset(ctx: CtxTrackers): Promise<string[]> {
  const settings = ctx.settings();
  return [...new Set((await taskStatuses(ctx)).filter(x => !x.done).map(x => boardOf(x.key)).filter((b): b is string => !!b && !settings[b]?.test))].sort();
}

/** Saves a board's statuses (empty clears one) */
export function saveBoard(ctx: CtxTrackers, board: unknown, v: { test?: unknown; done?: unknown }): BoardStatuses {
  const b = String(board ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,19}$/.test(b)) throw new Error(t('verification.badBoard', { tablero: b }));
  const clean = (s: unknown) => String(s ?? '').trim().slice(0, 100) || undefined;
  const x: BoardStatuses = { ...(clean(v.test) ? { test: clean(v.test) } : {}), ...(clean(v.done) ? { done: clean(v.done) } : {}) };
  ctx.save(b, x);
  return x;
}

/** The workflow's own transition to the board's done status (Jira): the one leading to it, or the only one to the
 *  board's done column when none is picked */
export function doneTransition(trs: JiraTransition[], done?: string): JiraTransition | undefined {
  const a = done ? trs.filter(x => sameStatus(x.a, done)) : trs;
  return a.length === 1 ? a[0] : undefined;
}
