// The work log ("Sync update" panel in Planning) and the trophies' facts: a ledger of what was done for each task, saved
// by server/workLog.ts in DATOS/bitacora.json. The game's sources forget (Jira and PRs read two weeks back, finished
// worktrees are removed), so every read is merged in here: a newer read updates a fact, a missing one is never
// deleted, a worktree no longer there is marked gone. Trophies and the career ladder are derived from it on read
// (shared/trophies.ts). Pure: used by the client, the server and the tests.
import { t } from './language.ts';
import type { Category, PRBoard, StatePR, TaskJira } from './board.ts';
import type { ReviewPR } from './reviews.ts';
import { branchTask, pRTask, textKey, worktreeTask, isJiraKey } from './tasks.ts';

export interface LogTask {
  key: string; title: string; url?: string; state: string; category: Category; type?: string;
  epic?: { key: string; title: string };
  seen: number; updated: number;       // first read by the game; Jira's last update
  doneAt?: number;                     // when it reached the done category (reopened: cleared)
  verifiedAt?: number;                 // its production verification ended evidenced (shared/verification.ts)
}
export interface LogPR {
  ref: string; url: string; title: string; repo: string; number: number; branch: string; task: string;
  state: StatePR; seen: number; updated: number; mergedAt?: number;
}
export interface LogWorktree { path: string; roomId: string; branch?: string; task: string; seen: number; last: number; goneAt?: number }
export interface LogConversation { claudeId: string; title: string; roomId: string; cwd: string; task: string; seen: number; last: number }
/** Another's PR the Overseer reviewed (seen in the Review room's reads) */
export interface LogReview { ref: string; url: string; title: string; repo: string; author: string; task?: string; at: number }
export interface Ledger {
  tasks: Record<string, LogTask>; prs: Record<string, LogPR>; worktrees: Record<string, LogWorktree>;
  conversations: Record<string, LogConversation>; reviews: Record<string, LogReview>;
  notified: string[];                  // trophies already announced
}

export const emptyLedger = (): Ledger => ({ tasks: {}, prs: {}, worktrees: {}, conversations: {}, reviews: {}, notified: [] });
/** A ledger read from disk: whatever is missing or of the wrong shape starts empty */
export function ledgerOf(j: any): Ledger {
  const rec = (x: any) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  return { tasks: rec(j?.tasks), prs: rec(j?.prs), worktrees: rec(j?.worktrees), conversations: rec(j?.conversations), reviews: rec(j?.reviews),
    notified: Array.isArray(j?.notified) ? j.notified.filter((x: unknown) => typeof x === 'string') : [] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function put<T>(rec: Record<string, T>, id: string, v: T): boolean { if (same(rec[id], v)) return false; rec[id] = v; return true; }

/** Jira tasks as the board read them. Returns whether anything changed */
export function mergeTasks(l: Ledger, tasks: TaskJira[], now: number): boolean {
  let changed = false;
  for (const x of tasks) {
    const key = x.key.toUpperCase(), prev = l.tasks[key], done = x.category === 'done';
    // first seen already done: Jira's last update is the best date there is
    const doneAt = done ? prev?.doneAt ?? (prev && prev.category !== 'done' ? now : x.updated || now) : undefined;
    changed = put(l.tasks, key, {
      key, title: x.title, url: x.url, state: x.state, category: x.category, ...(x.type ? { type: x.type } : {}),
      ...(x.epic ? { epic: { key: x.epic.key, title: x.epic.title } } : {}),
      seen: prev?.seen ?? now, updated: x.updated || prev?.updated || now,
      ...(doneAt ? { doneAt } : {}), ...(prev?.verifiedAt ? { verifiedAt: prev.verifiedAt } : {}),
    }) || changed;
  }
  return changed;
}

export const prRef = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`.toLowerCase();

/** The Overseer's PRs (their task: branch, then title; PR-<n> without one) */
export function mergePRs(l: Ledger, prs: (PRBoard & { mergedAt?: number })[], now: number): boolean {
  let changed = false;
  for (const p of prs) {
    if (!p.repo || !p.number) continue;
    const ref = prRef(p), prev = l.prs[ref], merged = p.state === 'fusionado';
    const mergedAt = merged ? p.mergedAt ?? prev?.mergedAt ?? (prev && prev.state !== 'fusionado' ? now : p.updated || now) : undefined;
    changed = put(l.prs, ref, {
      ref, url: p.url, title: p.title, repo: p.repo, number: p.number, branch: p.branch, task: pRTask(p), state: p.state,
      seen: prev?.seen ?? now, updated: p.updated || prev?.updated || now, ...(mergedAt ? { mergedAt } : {}),
    }) || changed;
  }
  return changed;
}

/** The task worktrees of the rooms read now (`rooms`): new ones are added, those no longer there are marked gone */
export function mergeWorktrees(l: Ledger, live: { path: string; roomId: string; branch?: string }[], rooms: string[], now: number): boolean {
  let changed = false;
  const here = new Set<string>();
  for (const w of live) {
    const task = worktreeTask(w); if (!task) continue;
    here.add(w.path);
    const prev = l.worktrees[w.path];
    // `last` moves only when something else changes: a ledger rewritten every sweep for a clock would never rest
    const v: LogWorktree = { path: w.path, roomId: w.roomId, ...(w.branch ? { branch: w.branch } : {}), task, seen: prev?.seen ?? now, last: prev && !prev.goneAt ? prev.last : now };
    changed = put(l.worktrees, w.path, v) || changed;
  }
  const read = new Set(rooms);
  for (const w of Object.values(l.worktrees)) if (!w.goneAt && read.has(w.roomId) && !here.has(w.path)) { w.goneAt = now; w.last = now; changed = true; }
  return changed;
}

/** The game's conversations that worked on a task (in a task's worktree, or a review's folder) */
export function mergeConversations(l: Ledger, sessions: { claudeId?: string; title: string; roomId: string; cwd: string; worktree?: string; updated: number }[], now: number): boolean {
  let changed = false;
  for (const s of sessions) {
    if (!s.claudeId) continue;
    const task = worktreeTask({ path: s.worktree || s.cwd }); if (!task) continue;
    const prev = l.conversations[s.claudeId];
    changed = put(l.conversations, s.claudeId, { claudeId: s.claudeId, title: s.title, roomId: s.roomId, cwd: s.cwd, task, seen: prev?.seen ?? now, last: Math.max(s.updated || now, prev?.last ?? 0) }) || changed;
  }
  return changed;
}

/** Others' PRs the Overseer has reviewed (any review): counted once, the first time seen */
export function mergeReviews(l: Ledger, prs: ReviewPR[], now: number): boolean {
  let changed = false;
  for (const p of prs) {
    if (!p.reviewed) continue;
    const ref = prRef(p), prev = l.reviews[ref];
    const task = branchTask(p.branch) ?? textKey(p.title);
    changed = put(l.reviews, ref, { ref, url: p.url, title: p.title, repo: p.repo, author: p.author, ...(task ? { task } : {}), at: prev?.at ?? now }) || changed;
  }
  return changed;
}

/** The tasks whose production verification ended evidenced (their final checkpoint) */
export function mergeVerified(l: Ledger, keys: string[], now: number): boolean {
  let changed = false;
  for (const k of keys) { const x = l.tasks[k.toUpperCase()]; if (x && !x.verifiedAt) { x.verifiedAt = now; changed = true; } }
  return changed;
}

// ---------------------------------------------------------------- the log: one row per task
export interface LogRow {
  key: string; jira: boolean;           // jira: a Jira-shaped key (slug tasks and PR-12 go last)
  task?: LogTask;
  prs: LogPR[]; worktrees: LogWorktree[]; conversations: LogConversation[];
  repos: string[];
  last: number;                         // the last activity of any of its facts
}
export type LogRange = 'week' | 'twoWeeks' | 'month' | 'all';
export const LOG_RANGES: LogRange[] = ['week', 'twoWeeks', 'month', 'all'];
const RANGE_DAYS: Record<LogRange, number> = { week: 7, twoWeeks: 14, month: 30, all: Infinity };
export const rangeStart = (r: LogRange, now: number) => (RANGE_DAYS[r] === Infinity ? 0 : now - RANGE_DAYS[r] * 864e5);

/** Each task with what was done for it since `since`: a Jira task counts once started (not while only in To do) */
export function logRows(l: Ledger, since: number): LogRow[] {
  const rows = new Map<string, LogRow>();
  const row = (key: string) => { let r = rows.get(key); if (!r) rows.set(key, r = { key, jira: isJiraKey(key) && !/^PR-\d+$/i.test(key), prs: [], worktrees: [], conversations: [], repos: [], last: 0 }); return r; };
  for (const x of Object.values(l.tasks)) if (x.category !== 'new') { const r = row(x.key); r.task = x; r.last = Math.max(r.last, x.updated); }
  for (const p of Object.values(l.prs)) { const r = row(p.task); r.prs.push(p); r.last = Math.max(r.last, p.updated, p.mergedAt ?? 0); }
  for (const w of Object.values(l.worktrees)) { const r = row(w.task); r.worktrees.push(w); r.last = Math.max(r.last, w.last); }
  for (const c of Object.values(l.conversations)) { const r = row(c.task); r.conversations.push(c); r.last = Math.max(r.last, c.last); }
  for (const r of rows.values()) {
    r.task ??= l.tasks[r.key];
    r.repos = [...new Set(r.prs.map(p => p.repo))].sort();
    r.prs.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
    r.worktrees.sort((a, b) => Number(!!a.goneAt) - Number(!!b.goneAt) || b.last - a.last);
    r.conversations.sort((a, b) => b.last - a.last);
  }
  return [...rows.values()].filter(r => r.last >= since).sort((a, b) => Number(b.jira) - Number(a.jira) || b.last - a.last);
}

const PR_STATE: Record<StatePR, string> = { abierto: 'worklog.pr.open', borrador: 'worklog.pr.draft', fusionado: 'worklog.pr.merged', cerrado: 'worklog.pr.closed' };
export const prStateText = (s: StatePR) => t(PR_STATE[s]);
/** «2 merged · 1 open» */
export function prRollup(prs: LogPR[]): string {
  const n = new Map<StatePR, number>();
  for (const p of prs) n.set(p.state, (n.get(p.state) ?? 0) + 1);
  return (['fusionado', 'abierto', 'borrador', 'cerrado'] as StatePR[]).filter(s => n.get(s)).map(s => `${n.get(s)} ${prStateText(s)}`).join(' · ');
}

/** The sync update: one line per task and its PRs underneath, as Markdown to paste */
export function syncText(rows: LogRow[]): string {
  const out: string[] = [];
  for (const r of rows) {
    const head = [r.key, r.task?.title].filter(Boolean).join(' ');
    out.push(`- ${head}${r.task ? ` (${r.task.state})` : ''}${r.prs.length ? ` — ${prRollup(r.prs)}` : ''}`);
    for (const p of r.prs) out.push(`  - ${p.repo.split('/').pop()}#${p.number} ${p.title} — ${prStateText(p.state)} ${p.url}`);
  }
  return out.join('\n');
}
