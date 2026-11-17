// The tracker's side of production verification: each board (a Jira project, a Linear team: the key's prefix) has its own
// workflow, so the Overseer picks its prod-check status and the done one after it, from that board's own statuses, in the
// tracker's page of the vault; at start the game asks once for the boards of open tasks still without one. A task in its
// board's prod-check status opens its final checkpoint, and once that is evidenced the pre-flight offers the workflow's
// own transition to the done status (Jira only, the one write it already makes from the board; Linear stays read-only).
// Saved in ajustes.verificacionTableros. Only connected trackers count: demo data never opens a checkpoint.
import { boardOf, sameStatus, type BoardStatuses, type TaskTracker } from '../shared/verification.ts';
import type { JiraTransition } from '../shared/board.ts';
import { t } from '../shared/language.ts';

export type { TaskTracker };
export type Tracker = TaskTracker['fuente'];
export interface TaskStatus { fuente: Tracker; clave: string; estado: string; hecha: boolean }
export interface BoardSetup extends BoardStatuses { fuente: Tracker; tablero: string; estados: string[]; error?: string }

export interface CtxTrackers {
  accion(nombre: string, d: Record<string, unknown>): Promise<any>;
  conectada(fuente: Tracker): boolean;
  ajustes(): Record<string, BoardStatuses>;
  guardar(tablero: string, v: BoardStatuses): void;
}

/** The tasks the connected trackers show (yours), with their status */
export async function taskStatuses(ctx: CtxTrackers): Promise<TaskStatus[]> {
  const out: TaskStatus[] = [];
  if (ctx.conectada('jira')) {
    const r = await ctx.accion('panel', { fuente: 'jira' }).catch(() => null);
    for (const x of r?.tareas ?? []) out.push({ fuente: 'jira', clave: String(x.clave).toUpperCase(), estado: String(x.estado ?? ''), hecha: x.categoria === 'done' });
  }
  if (ctx.conectada('linear')) {
    const r = await ctx.accion('panel', { fuente: 'linear' }).catch(() => null);
    for (const g of r?.myIssues ?? []) for (const i of g.issues ?? []) if (i.identificador) out.push({ fuente: 'linear', clave: String(i.identificador).toUpperCase(), estado: String(i.estado?.nombre ?? ''), hecha: false });
  }
  return out;
}

/** A task's status in its tracker, with its board's setup */
export async function taskTracker(ctx: CtxTrackers, clave: string, verificada = false): Promise<TaskTracker | undefined> {
  const tablero = boardOf(clave); if (!tablero) return undefined;
  const x = (await taskStatuses(ctx)).find(s => s.clave === clave.toUpperCase()); if (!x) return undefined;
  const m = ctx.ajustes()[tablero] ?? {};
  return { fuente: x.fuente, estado: x.estado, tablero, ...m, enPrueba: sameStatus(x.estado, m.prueba),
    mover: verificada && x.fuente === 'jira' && !x.hecha && !sameStatus(x.estado, m.hecho) };
}

/** The boards of your open tasks in each connected tracker, with their statuses and what's picked */
export async function boardsSetup(ctx: CtxTrackers, fuente?: Tracker): Promise<BoardSetup[]> {
  const tareas = (await taskStatuses(ctx)).filter(x => !x.hecha && (!fuente || x.fuente === fuente));
  const tableros = [...new Map(tareas.map(x => [`${x.fuente}:${boardOf(x.clave)}`, { fuente: x.fuente, tablero: boardOf(x.clave)! }])).values()].filter(x => x.tablero);
  const aj = ctx.ajustes();
  return Promise.all(tableros.map(async b => {
    try { return { ...b, ...aj[b.tablero], estados: (await ctx.accion('estadosTablero', { fuente: b.fuente, tablero: b.tablero }))?.estados ?? [] }; }
    catch (e) { return { ...b, ...aj[b.tablero], estados: [], error: (e as Error).message }; }
  }));
}

/** The boards of open tasks still without a prod-check status (for the notice at start) */
export async function boardsUnset(ctx: CtxTrackers): Promise<string[]> {
  const aj = ctx.ajustes();
  return [...new Set((await taskStatuses(ctx)).filter(x => !x.hecha).map(x => boardOf(x.clave)).filter((b): b is string => !!b && !aj[b]?.prueba))].sort();
}

/** Saves a board's statuses (empty clears one) */
export function saveBoard(ctx: CtxTrackers, tablero: unknown, v: { prueba?: unknown; hecho?: unknown }): BoardStatuses {
  const b = String(tablero ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,19}$/.test(b)) throw new Error(t('verification.badBoard', { tablero: b }));
  const limpio = (s: unknown) => String(s ?? '').trim().slice(0, 100) || undefined;
  const x: BoardStatuses = { ...(limpio(v.prueba) ? { prueba: limpio(v.prueba) } : {}), ...(limpio(v.hecho) ? { hecho: limpio(v.hecho) } : {}) };
  ctx.guardar(b, x);
  return x;
}

/** The workflow's own transition to the board's done status (Jira): the one leading to it, or the only one to the
 *  board's done column when none is picked */
export function doneTransition(trs: JiraTransition[], hecho?: string): JiraTransition | undefined {
  const a = hecho ? trs.filter(x => sameStatus(x.a, hecho)) : trs;
  return a.length === 1 ? a[0] : undefined;
}
