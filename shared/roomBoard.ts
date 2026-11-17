// The task board of a repo room (web/src/mundo/salas/tableroTareas.ts): one row for the main copy and one per worktree,
// with its task, branch, what its conversations are doing (or waiting on) and one overall state for its PRs in this
// room's repo. Pure, so it can be tested without the scene.
import type { InfoWorktree, SessionState } from './protocolo.ts';
import type { PRBoard } from './tablero.ts';
import { worktreeTask, worktreePRs } from './tareas.ts';

/** What the conversations open in a copy are doing, the most urgent first */
export type SessionMark = 'esperando' | 'error' | 'trabajando' | 'listo' | 'abierta';
/** One state for all of a task's PRs in this room's repo, the one that most needs someone first */
export type PRRollup = 'ci' | 'conflictos' | 'cambios' | 'revision' | 'aprobado' | 'borrador' | 'fusionado' | 'cerrado';

export interface BoardSession { estado: SessionState; cwd: string; salaId: string; sinLeer?: boolean; actualizada: number; pending?: { titulo: string }; actividad?: { texto: string } }
export interface BoardRow {
  ruta: string; principal: boolean; rama: string; clave?: string;
  sesion?: SessionMark; detalle?: string;   // detalle: what it's doing, or what it's waiting on
  pr?: PRRollup; prs: number;               // prs: how many PRs of its task in this room's repo
  cambios: number; advanced: number;
}

const URGENCY: Record<SessionMark, number> = { esperando: 0, error: 1, trabajando: 2, listo: 3, abierta: 4 };
const markOf = (s: BoardSession): SessionMark =>
  s.estado === 'esperando' || s.pending ? 'esperando' : s.estado === 'error' ? 'error' : s.estado === 'trabajando' || s.estado === 'arrancando' ? 'trabajando' : s.estado === 'terminada' && s.sinLeer ? 'listo' : 'abierta';

/** The state of a copy's open conversations: the most urgent one's, with what it's doing or waiting on */
export function sessionMark(sesiones: BoardSession[]): { sesion?: SessionMark; detalle?: string } {
  const abiertas = sesiones.filter(s => s.estado !== 'cerrada');
  if (!abiertas.length) return {};
  const s = [...abiertas].sort((a, b) => URGENCY[markOf(a)] - URGENCY[markOf(b)] || b.actualizada - a.actualizada)[0];
  const sesion = markOf(s);
  const detalle = sesion === 'esperando' ? s.pending?.titulo : sesion === 'trabajando' ? s.actividad?.texto : undefined;
  return { sesion, ...(detalle ? { detalle } : {}) };
}

/** One state for a task's PRs: what's open decides (failing CI, conflicts, changes asked, in review, approved, draft);
 *  with none open, merged if any was, else closed */
export function prRollup(prs: Pick<PRBoard, 'estado' | 'checks' | 'revision' | 'conflictos'>[]): PRRollup | undefined {
  if (!prs.length) return undefined;
  const abiertos = prs.filter(p => p.estado === 'abierto' || p.estado === 'borrador');
  if (abiertos.some(p => p.checks === 'FAILURE' || p.checks === 'ERROR')) return 'ci';
  if (abiertos.some(p => p.conflictos === true)) return 'conflictos';
  const listos = abiertos.filter(p => p.estado === 'abierto');
  if (listos.some(p => p.revision === 'CHANGES_REQUESTED')) return 'cambios';
  if (listos.some(p => p.revision !== 'APPROVED')) return 'revision';
  if (listos.length) return 'aprobado';
  if (abiertos.length) return 'borrador';
  return prs.some(p => p.estado === 'fusionado') ? 'fusionado' : 'cerrado';
}

const inside = (cwd: string | undefined, ruta: string) => !!cwd && (cwd === ruta || cwd.startsWith(ruta + '/'));
// a worktree a session has just created, before git lists it (as the holograms do: web/src/ui/copias.ts)
const freshWorktree = (cwd: string) => /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];

/** The rows of a room's board: its main copy first, then its worktrees in git's order (they don't reshuffle). */
export function boardRows(salaId: string, carpeta: string, worktrees: InfoWorktree[], sesiones: BoardSession[], prs: PRBoard[]): BoardRow[] {
  const principal = worktrees.find(w => w.principal) ?? { ruta: carpeta, rama: '', principal: true, cambios: 0, advanced: 0 };
  const wts = worktrees.filter(w => !w.principal);
  for (const s of sesiones) {
    if (s.salaId !== salaId || s.estado === 'cerrada' || wts.some(w => inside(s.cwd, w.ruta))) continue;
    const ruta = freshWorktree(s.cwd); if (ruta && inside(ruta, carpeta)) wts.push({ ruta, rama: ruta.split('/').pop() ?? '', principal: false, cambios: 0, advanced: 0 });
  }
  const row = (w: InfoWorktree, mias: BoardSession[]): BoardRow => {
    const suyos = w.principal ? [] : worktreePRs(prs, w, carpeta);
    const pr = prRollup(suyos);
    const clave = w.principal ? undefined : worktreeTask(w);
    return { ruta: w.ruta, principal: w.principal, rama: w.rama, ...(clave ? { clave } : {}), ...sessionMark(mias), ...(pr ? { pr } : {}), prs: suyos.length, cambios: w.cambios, advanced: w.advanced };
  };
  const enMain = sesiones.filter(s => s.salaId === salaId && !wts.some(w => inside(s.cwd, w.ruta)));
  return [row(principal, enMain), ...wts.map(w => row(w, sesiones.filter(s => inside(s.cwd, w.ruta))))];
}
