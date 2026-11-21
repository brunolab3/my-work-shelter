// The tracker's side of production verification. Jira's projects share their statuses, so the whole Jira has one pair:
// its prod-check status and the done one after it (settings.verificationJira). The game links them by itself when the
// statuses of the projects of your open tasks leave no doubt (one status named like a production check, one done one),
// and the Overseer picks what stays empty, once for the integration, in Jira's page of the vault. Each Linear team
// keeps its own pair, from its own states (settings.verificationBoards, by the key's prefix). At start the game asks once
// for what is still without a prod-check status. A task in its prod-check status opens its final checkpoint, and once
// that is evidenced the pre-flight offers the workflow's own transition to the done status (Jira only, the one write it
// already makes from the board; Linear stays read-only). Only connected trackers count: demo data never opens a checkpoint.
import { boardOf, sameStatus, type BoardStatuses, type TaskTracker } from '../shared/verification.ts';
import type { JiraTransition } from '../shared/board.ts';
import { t } from '../shared/language.ts';

export type { TaskTracker };
export type Tracker = TaskTracker['source'];
export interface TaskStatus { source: Tracker; key: string; state: string; done: boolean }
/** What the vault shows: Jira as one board (JIRA), each Linear team as its own; `linked` are the picks the game just made
 *  and `notes` what it did */
export interface BoardSetup extends BoardStatuses { source: Tracker; board: string; states: string[]; linked?: (keyof BoardStatuses)[]; notes?: string[]; error?: string }
/** What's saved: Jira's one pair (undefined until migrated, linked or picked) and each Linear team's */
export interface TrackerSettings { jira?: BoardStatuses; boards: Record<string, BoardStatuses> }
/** The board name the pre-flight and the vault show for the whole Jira */
export const JIRA = 'Jira';

export interface CtxTrackers {
  action(name: string, d: Record<string, unknown>): Promise<any>;
  connected(source: Tracker): boolean;
  settings(): TrackerSettings;
  save(patch: Partial<TrackerSettings>): void;
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

/** A task's statuses: Jira's one pair (before its migration, its project's old one), a Linear team's own */
const statusesOf = (s: TrackerSettings, source: Tracker, board: string): BoardStatuses => (source === 'jira' ? s.jira ?? s.boards[board] : s.boards[board]) ?? {};

/** A task's status in its tracker, with its setup */
export async function taskTracker(ctx: CtxTrackers, key: string, verified = false): Promise<TaskTracker | undefined> {
  const board = boardOf(key); if (!board) return undefined;
  const x = (await taskStatuses(ctx)).find(s => s.key === key.toUpperCase()); if (!x) return undefined;
  const m = statusesOf(ctx.settings(), x.source, board);
  return { source: x.source, state: x.state, board: x.source === 'jira' ? JIRA : board, ...m, inProdCheck: sameStatus(x.state, m.test),
    move: verified && x.source === 'jira' && !x.done && !sameStatus(x.state, m.done) };
}

// a status named like a production check (Prueba en producción, Production check, PROD CHECK, Verify…)
const PROD_CHECK = /prueba.*producci|production|prod[- ]?check|verif/i;
/** The pair the game links by itself from Jira's statuses (`done`: those in the done category): the only one named like
 *  a production check that isn't done, and the only done one (with several, the only one named Hecho or Done). What
 *  isn't that clear stays empty for the Overseer */
export function autoLink(states: string[], done: string[]): BoardStatuses {
  const isDone = (s: string) => done.some(d => sameStatus(d, s));
  const unique = (l: string[]) => l.filter((s, i) => l.findIndex(x => sameStatus(x, s)) === i);
  const tests = unique(states.filter(s => !isDone(s) && PROD_CHECK.test(s)));
  const dones = unique(states.filter(isDone));
  const named = dones.filter(s => /^(hecho|done)$/i.test(s.trim()));
  const d = dones.length === 1 ? dones[0] : named.length === 1 ? named[0] : undefined;
  return { ...(tests.length === 1 ? { test: tests[0] } : {}), ...(d ? { done: d } : {}) };
}

/** The old per-project pairs of Jira's projects as one: the one picked most often (the first, on a tie), and the projects
 *  that had another. Undefined without any */
export function migrateJira(boards: Record<string, BoardStatuses>, projects: string[]): { pair: BoardStatuses; others: string[] } | undefined {
  const old = [...new Set(projects)].sort().filter(p => boards[p]?.test || boards[p]?.done).map(p => ({ p, v: { ...(boards[p].test ? { test: boards[p].test } : {}), ...(boards[p].done ? { done: boards[p].done } : {}) } }));
  if (!old.length) return undefined;
  const id = (v: BoardStatuses) => `${v.test?.trim().toLowerCase() ?? ''}\n${v.done?.trim().toLowerCase() ?? ''}`;
  const count = new Map<string, number>();
  for (const o of old) count.set(id(o.v), (count.get(id(o.v)) ?? 0) + 1);
  const best = old.reduce((a, o) => (count.get(id(o.v))! > count.get(id(a.v))! ? o : a));
  return { pair: best.v, others: old.filter(o => id(o.v) !== id(best.v)).map(o => `${o.p}: ${o.v.test ?? '—'} / ${o.v.done ?? '—'}`) };
}

/** The statuses of the Jira projects of your open tasks, all together, with those in the done category */
async function jiraStates(ctx: CtxTrackers, projects: string[]): Promise<{ states: string[]; done: string[]; error?: string }> {
  const r = await Promise.all(projects.map(board => ctx.action('estadosTablero', { source: 'jira', board }).then(x => ({ x }), e => ({ x: null, error: (e as Error).message }))));
  const all = (k: 'states' | 'done') => [...new Map(r.flatMap(y => (y.x?.[k] ?? []) as string[]).map(s => [s.toLowerCase(), s])).values()];
  return { states: all('states'), done: all('done'), ...(r.every(y => 'error' in y) && r.length ? { error: (r[0] as { error: string }).error } : {}) };
}

/** Jira's one pair, set up first if it was never: from the old per-project pairs, otherwise linked from the statuses.
 *  Never overwrites what's saved. `linked` and `migrated` tell the Overseer what the game did */
async function jiraPair(ctx: CtxTrackers, tasks: TaskStatus[], open: string[]): Promise<{ pair: BoardStatuses; states: string[]; linked: (keyof BoardStatuses)[]; migrated?: string; error?: string }> {
  const s = ctx.settings();
  let pair = s.jira, migrated: string | undefined;
  if (!pair) {
    const m = migrateJira(s.boards, tasks.filter(x => x.source === 'jira').map(x => boardOf(x.key)).filter((b): b is string => !!b));
    if (m) {
      pair = m.pair; ctx.save({ jira: pair });
      if (m.others.length) migrated = t('verification.migratedMixed', { prueba: pair.test ?? '—', hecho: pair.done ?? '—', otros: m.others.join('; ') });
    }
  }
  const { states, done, error } = await jiraStates(ctx, open);
  const linked: (keyof BoardStatuses)[] = [];
  // linked only while nothing was saved: what the Overseer clears or leaves empty stays so
  if (!pair) {
    const a = autoLink(states, done);
    if (a.test || a.done) {
      pair = a; ctx.save({ jira: pair });
      linked.push(...(['test', 'done'] as const).filter(k => a[k]));
    }
  }
  return { pair: pair ?? {}, states, linked, migrated, error };
}

const openBoards = (tasks: TaskStatus[], source: Tracker) => [...new Set(tasks.filter(x => x.source === source && !x.done).map(x => boardOf(x.key)).filter((b): b is string => !!b))].sort();

/** What the vault shows for a tracker: Jira as one board with the statuses of all its projects of your open tasks, each
 *  Linear team with its own */
export async function boardsSetup(ctx: CtxTrackers, source?: Tracker): Promise<BoardSetup[]> {
  const tasks = await taskStatuses(ctx);
  const out: BoardSetup[] = [];
  const jira = openBoards(tasks, 'jira');
  if (jira.length && (!source || source === 'jira')) {
    const j = await jiraPair(ctx, tasks, jira);
    out.push({ source: 'jira', board: JIRA, ...j.pair, states: j.states, ...(j.linked.length ? { linked: j.linked } : {}), ...(j.migrated ? { notes: [j.migrated] } : {}), ...(j.error ? { error: j.error } : {}) });
  }
  if (!source || source === 'linear') {
    const boards = ctx.settings().boards;
    out.push(...await Promise.all(openBoards(tasks, 'linear').map(async board => {
      const b = { source: 'linear' as const, board, ...boards[board] };
      try { return { ...b, states: (await ctx.action('estadosTablero', { source: 'linear', board }))?.states ?? [] }; }
      catch (e) { return { ...b, states: [], error: (e as Error).message }; }
    })));
  }
  return out;
}

/** Once per start: Jira's pair set up if it never was, and the notices for the Overseer: what the game did, and what is
 *  still without a prod-check status (Jira once, each Linear team of open tasks) */
export async function startupNotices(ctx: CtxTrackers): Promise<string[]> {
  const tasks = await taskStatuses(ctx);
  const notes: string[] = [], unset: string[] = [];
  const jira = openBoards(tasks, 'jira');
  if (jira.length) {
    const j = await jiraPair(ctx, tasks, jira);
    if (j.migrated) notes.push(j.migrated);
    if (j.linked.length) notes.push(t('verification.autoLinked', { prueba: j.pair.test ?? '—', hecho: j.pair.done ?? '—' }));
    if (!j.pair.test) unset.push(JIRA);
  }
  const boards = ctx.settings().boards;
  unset.push(...openBoards(tasks, 'linear').filter(b => !boards[b]?.test));
  if (unset.length) notes.push(t('verification.boardsUnset', { tableros: unset.join(', ') }));
  return notes;
}

/** Saves the statuses the Overseer picked (empty clears one): Jira's one pair, or a Linear team's */
export function saveBoard(ctx: CtxTrackers, source: unknown, board: unknown, v: { test?: unknown; done?: unknown }): BoardStatuses {
  const clean = (s: unknown) => String(s ?? '').trim().slice(0, 100) || undefined;
  const x: BoardStatuses = { ...(clean(v.test) ? { test: clean(v.test) } : {}), ...(clean(v.done) ? { done: clean(v.done) } : {}) };
  if (source === 'jira') { ctx.save({ jira: x }); return x; }
  const b = String(board ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,19}$/.test(b)) throw new Error(t('verification.badBoard', { tablero: b }));
  ctx.save({ boards: { ...ctx.settings().boards, [b]: x } });
  return x;
}

/** The workflow's own transition to the done status (Jira): the one leading to it, or the only one to the done column
 *  when none is picked */
export function doneTransition(trs: JiraTransition[], done?: string): JiraTransition | undefined {
  const a = done ? trs.filter(x => sameStatus(x.a, done)) : trs;
  return a.length === 1 ? a[0] : undefined;
}
