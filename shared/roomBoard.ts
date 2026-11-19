// The task board of a repo room (web/src/world/rooms/taskBoard.ts): one row for the main copy and one per worktree,
// with its task, branch, what its conversations are doing (or waiting on) and one overall state for its PRs in this
// room's repo. Pure, so it can be tested without the scene.
import type { InfoWorktree, SessionState } from './protocol.ts';
import type { PRBoard } from './board.ts';
import { worktreeTask, worktreePRs } from './tasks.ts';

/** What the conversations open in a copy are doing, the most urgent first */
export type SessionMark = 'esperando' | 'error' | 'trabajando' | 'listo' | 'abierta';
/** One state for all of a task's PRs in this room's repo, the one that most needs someone first */
export type PRRollup = 'ci' | 'conflictos' | 'cambios' | 'revision' | 'aprobado' | 'borrador' | 'fusionado' | 'cerrado';

export interface BoardSession { state: SessionState; cwd: string; roomId: string; unread?: boolean; updated: number; pending?: { title: string }; activity?: { text: string } }
export interface BoardRow {
  path: string; main: boolean; branch: string; key?: string;
  session?: SessionMark; detail?: string;   // detalle: what it's doing, or what it's waiting on
  pr?: PRRollup; prs: number;               // prs: how many PRs of its task in this room's repo
  changes: number; advanced: number;
}

const URGENCY: Record<SessionMark, number> = { esperando: 0, error: 1, trabajando: 2, listo: 3, abierta: 4 };
const markOf = (s: BoardSession): SessionMark =>
  s.state === 'esperando' || s.pending ? 'esperando' : s.state === 'error' ? 'error' : s.state === 'trabajando' || s.state === 'arrancando' ? 'trabajando' : s.state === 'terminada' && s.unread ? 'listo' : 'abierta';

/** The state of a copy's open conversations: the most urgent one's, with what it's doing or waiting on */
export function sessionMark(sessions: BoardSession[]): { session?: SessionMark; detail?: string } {
  const openSessions = sessions.filter(s => s.state !== 'cerrada');
  if (!openSessions.length) return {};
  const s = [...openSessions].sort((a, b) => URGENCY[markOf(a)] - URGENCY[markOf(b)] || b.updated - a.updated)[0];
  const session = markOf(s);
  const detail = session === 'esperando' ? s.pending?.title : session === 'trabajando' ? s.activity?.text : undefined;
  return { session, ...(detail ? { detail } : {}) };
}

/** One state for a task's PRs: what's open decides (failing CI, conflicts, changes asked, in review, approved, draft);
 *  with none open, merged if any was, else closed */
export function prRollup(prs: Pick<PRBoard, 'state' | 'checks' | 'review' | 'conflicts'>[]): PRRollup | undefined {
  if (!prs.length) return undefined;
  const open = prs.filter(p => p.state === 'abierto' || p.state === 'borrador');
  if (open.some(p => p.checks === 'FAILURE' || p.checks === 'ERROR')) return 'ci';
  if (open.some(p => p.conflicts === true)) return 'conflictos';
  const ready = open.filter(p => p.state === 'abierto');
  if (ready.some(p => p.review === 'CHANGES_REQUESTED')) return 'cambios';
  if (ready.some(p => p.review !== 'APPROVED')) return 'revision';
  if (ready.length) return 'aprobado';
  if (open.length) return 'borrador';
  return prs.some(p => p.state === 'fusionado') ? 'fusionado' : 'cerrado';
}

const inside = (cwd: string | undefined, path: string) => !!cwd && (cwd === path || cwd.startsWith(path + '/'));
// a worktree a session has just created, before git lists it (as the holograms do: web/src/ui/copies.ts)
const freshWorktree = (cwd: string) => /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];

/** The rows of a room's board: its main copy first, then its worktrees in git's order (they don't reshuffle). */
export function boardRows(roomId: string, folder: string, worktrees: InfoWorktree[], sessions: BoardSession[], prs: PRBoard[]): BoardRow[] {
  const main = worktrees.find(w => w.main) ?? { path: folder, branch: '', main: true, changes: 0, advanced: 0 };
  const wts = worktrees.filter(w => !w.main);
  for (const s of sessions) {
    if (s.roomId !== roomId || s.state === 'cerrada' || wts.some(w => inside(s.cwd, w.path))) continue;
    const path = freshWorktree(s.cwd); if (path && inside(path, folder)) wts.push({ path, branch: path.split('/').pop() ?? '', main: false, changes: 0, advanced: 0 });
  }
  const row = (w: InfoWorktree, mine: BoardSession[]): BoardRow => {
    const theirs = w.main ? [] : worktreePRs(prs, w, folder);
    const pr = prRollup(theirs);
    const key = w.main ? undefined : worktreeTask(w);
    return { path: w.path, main: w.main, branch: w.branch, ...(key ? { key } : {}), ...sessionMark(mine), ...(pr ? { pr } : {}), prs: theirs.length, changes: w.changes, advanced: w.advanced };
  };
  const onMain = sessions.filter(s => s.roomId === roomId && !wts.some(w => inside(s.cwd, w.path)));
  return [row(main, onMain), ...wts.map(w => row(w, sessions.filter(s => inside(s.cwd, w.path))))];
}
