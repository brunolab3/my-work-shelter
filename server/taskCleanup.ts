// Limpieza de las tareas terminadas: cuando todos los PR de una tarea en el repo de una sala están fusionados o cerrados
// (ninguno abierto ni en borrador) y en la sala sigue algún worktree de esa tarea, el juego lo quita solo, sin preguntar:
// antes comprueba con git que no queda otro trabajo (cambios sin commit en archivos de git; stash de su rama; commits que
// no estén en el remoto ni en la rama del PR en GitHub) y que no hay una conversación abierta en él. Los archivos sueltos
// que git no sigue (notas de un plan, borradores) no cuentan: van a la papelera de macOS (se recuperan desde el Finder).
// Quita el worktree (`git worktree remove`, sin forzar) y su rama local; la del remoto se queda (un PR cerrado se puede
// reabrir). Scheduled messages still pending for it (to its conversations, or to its room with its key: `placeOf`) count as
// work left, so they aren't lost with it. Con una conversación abierta, espera a que se cierre. Si queda trabajo, pregunta una vez al Supervisor si lo
// quita igualmente (y entonces sí, forzando; si para entonces hay una conversación abierta en él, queda aprobado y se
// quita en cuanto se cierre); en cada vuelta se vuelve a mirar (guardado lo que había, se quita sin preguntar). Cada cinco
// minutos con GitHub conectado (main.ts); lo ya preguntado y lo aprobado, en DATOS/limpieza-tareas.json.
// A task with a merged PR waits first for its production verification (verificationHold): while a checkpoint is open, or
// the final one failed, its worktree and conversations stay, so the rechecks reach the conversation that knows the work.
// Without an approved plan, its conversation is asked once to propose one and the Overseer told once (they can clean it up
// without verifying). Tasks whose PRs were all closed without merging don't wait: nothing reached production.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { PRBoard } from '../shared/board.ts';
import { jiraKeys } from '../shared/board.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocol.ts';
import { branchKey, prsOfName } from './prReviews.ts';
import { t } from '../shared/language.ts';
import { placeOf, type ScheduledMessage } from '../shared/scheduled.ts';
import { pRTask, taskKey, worktreeTask } from '../shared/tasks.ts';
import { finalCheckpoint, isApproved, prRef, type VerificationPlan } from '../shared/verification.ts';

export interface RoomCleanup { id: string; name: string; path: string; repo?: string; worktrees: InfoWorktree[] }
export interface FinishedTask { task: string; prs: PRBoard[]; worktrees: InfoWorktree[] }

const keyOf = (p: PRBoard) => branchKey(p.branch) ?? jiraKeys(p.title)[0];

/** Las tareas del repo de una sala con todos sus PR fusionados o cerrados (uno abierto o en borrador la deja como está; un
 *  PR cerrado sin fusionar se reabre si hace falta: su rama sigue en el remoto) y algún worktree suyo aún en la sala:
 *  con su rama, con su clave o con sus PR en el nombre */
export function finishedTasks(room: RoomCleanup, prs: PRBoard[]): FinishedTask[] {
  if (!room.repo) return [];
  const ofRepo = prs.filter(p => p.repo.toLowerCase() === room.repo);
  const byTask = new Map<string, PRBoard[]>();
  for (const p of ofRepo) { const k = keyOf(p) ?? `PR #${p.number}`; byTask.set(k, [...(byTask.get(k) ?? []), p]); }
  const others = room.worktrees.filter(w => !w.main && !w.external);
  const out: FinishedTask[] = [];
  for (const [task, list] of byTask) {
    if (list.some(p => p.state === 'open' || p.state === 'draft')) continue;
    const branches = new Set(list.map(p => p.branch)), key = keyOf(list[0])?.toLowerCase();
    const worktrees = others.filter(w => branches.has(w.branch)
      || (key && path.basename(w.path).toLowerCase().includes(key))
      || prsOfName(path.basename(w.path)).some(n => list.some(p => p.number === n)));
    if (worktrees.length) out.push({ task, prs: list.sort((a, b) => a.number - b.number), worktrees });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task));
}

const inside = (dir: string, p: string) => (path.resolve(p) + path.sep).startsWith(path.resolve(dir) + path.sep);

/** The verification plan of a finished task's worktree: by the worktree's task, the task's key or its PRs' (as
 *  verification_plan keys it), then a plan with a checkpoint for one of its PRs or proposed from inside the worktree */
export function planOf(task: FinishedTask, w: InfoWorktree, plans: Record<string, VerificationPlan>): VerificationPlan | undefined {
  const keys = [worktreeTask(w), task.task, ...task.prs.map(pRTask)].map(k => taskKey(k)).filter((k): k is string => !!k);
  const byKey = keys.map(k => plans[k]).find(Boolean);
  if (byKey) return byKey;
  const refs = new Set(task.prs.map(p => prRef(p.url)));
  return Object.values(plans).find(p => p.points.some(c => c.pr && refs.has(c.pr)))
    ?? Object.values(plans).find(p => p.conversation && inside(w.path, p.conversation.cwd));
}

/** What keeps a finished task's worktree for its production verification (none: it can go): no approved plan yet, its
 *  final checkpoint still open, or failed (a fix is likely to follow there). Evidenced, or inconclusive accepted with a
 *  reason, lets it go; so do PRs all closed without merging */
export type Hold = 'no-plan' | 'open' | 'failed';
export function verificationHold(task: FinishedTask, plan: VerificationPlan | undefined): Hold | undefined {
  if (!task.prs.some(p => p.state === 'merged')) return undefined;
  if (!plan || !isApproved(plan)) return 'no-plan';
  const state = finalCheckpoint(plan)?.state;
  return state === 'evidenced' ? undefined : state === 'failed' ? 'failed' : 'open';
}

/** The task's conversation in a worktree: the most recent one there (open or closed, to resume) */
export const conversationIn = (sessions: SessionSummary[], w: InfoWorktree) =>
  sessions.filter(s => inside(w.path, s.worktree ?? s.cwd)).sort((a, b) => b.updated - a.updated)[0];

/** Lo que impide quitar un worktree (vacío: se puede quitar). `git` lanza si el comando falla */
export type Leftover = { type: 'changes' | 'stash' | 'commits' | 'scheduled'; n: number } | { type: 'conversation' };
export async function leftovers(git: (cwd: string, args: string[]) => Promise<string>, w: InfoWorktree, prs: PRBoard[], sessions: SessionSummary[]): Promise<Leftover[]> {
  const out: Leftover[] = [];
  const dir = path.resolve(w.path);
  if (sessions.some(s => s.state !== 'closed' && inside(dir, s.worktree ?? s.cwd))) out.push({ type: 'conversation' });
  const lines = (t: string) => t.split('\n').filter(Boolean);
  const changes = lines(await git(w.path, ['status', '--porcelain', '--untracked-files=no'])).length;
  if (changes) out.push({ type: 'changes', n: changes });
  // el stash es del repo entero: cuentan los guardados en esta rama («WIP on rama:» u «On rama:»)
  const stash = w.branch ? lines(await git(w.path, ['stash', 'list', '--format=%gs'])).filter(l => l.startsWith(`WIP on ${w.branch}:`) || l.startsWith(`On ${w.branch}:`)).length : 0;
  if (stash) out.push({ type: 'stash', n: stash });
  // commits fuera del remoto: valen si están en la rama de alguno de sus PR en GitHub (fusionado con squash, la rama del
  // remoto borrada…)
  const outside = lines(await git(w.path, ['rev-list', 'HEAD', '--not', '--remotes'])).length;
  if (outside) {
    let inPR = false;
    for (const p of prs) if (p.head && !inPR) inPR = await git(w.path, ['merge-base', '--is-ancestor', 'HEAD', p.head]).then(() => true, () => false);
    if (!inPR) out.push({ type: 'commits', n: outside });
  }
  return out;
}

/** The scheduled messages still pending that would land in the worktree `w` of `room` (where `placeOf` shows them) */
export const scheduledIn = (list: ScheduledMessage[], room: RoomCleanup, w: InfoWorktree) =>
  list.filter(x => { const p = placeOf(x, room.worktrees); return p.roomId === room.id && !!p.worktree && path.resolve(p.worktree) === path.resolve(w.path); });

/** Open conversations whose worktree (.claude/worktrees/<name>, or a review's folder under `reviewsRoot`) no longer exists, merged and removed by hand or by a
 *  session: they close like any other, so their hologram goes with them. Only idle and read ones, and none in use in the
 *  intercom (`used`: on screen, or with something typed or attached); the rest keep their hologram until then */
export function orphanedConversations(sessions: SessionSummary[], used: Set<string>, exists: (filePath: string) => boolean, reviewsRoot?: string): string[] {
  const review = reviewsRoot && new RegExp('^(' + path.resolve(reviewsRoot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^/]+)');
  return sessions.filter(s => {
    if (!['finished', 'idle', 'error'].includes(s.state) || s.unread || used.has(s.id)) return false;
    // a retired review's folder (server/reviewRoom.ts) goes the same way
    const root = /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(s.worktree ?? s.cwd)?.[1] ?? (review ? review.exec(s.worktree ?? s.cwd)?.[1] : undefined);
    return !!root && !exists(root);
  }).map(s => s.id);
}

/** Los archivos y carpetas que git no sigue (ni ignora) en el worktree, en absoluto */
export async function untracked(git: (cwd: string, args: string[]) => Promise<string>, filePath: string): Promise<string[]> {
  const top = (await git(filePath, ['rev-parse', '--show-toplevel'])).trim();
  return (await git(filePath, ['status', '--porcelain', '-z', '--untracked-files=normal'])).split('\0')
    .filter(l => l.startsWith('?? ')).map(l => path.join(top, l.slice(3)));
}

export interface CtxCleanup {
  connection(): Promise<{ real: boolean; token?: string }>;
  prs(c: { real: boolean; token?: string }): Promise<PRBoard[]>;   // abiertos, y fusionados o cerrados hace poco
  rooms(): Promise<RoomCleanup[]>;
  sessions(): SessionSummary[];
  scheduled(): ScheduledMessage[];                               // los mensajes programados pendientes
  plans(): Record<string, VerificationPlan>;                     // the verification plans by task key (verifications.ts)
  /** a merged task without an approved plan (once): ask its conversation (`session`, the latest in the worktree; none:
   *  a new one there) to propose one and tell the Overseer, who can `skip` it and clean up without verifying */
  noPlan(roomId: string, task: FinishedTask, w: InfoWorktree, key: string, plan: VerificationPlan | undefined, session: SessionSummary | undefined, skip: () => void): void;
  git(cwd: string, args: string[]): Promise<string>;              // lanza si el comando falla
  trash(paths: string[]): Promise<void>;                       // a la papelera de macOS
  removed(roomId: string, task: FinishedTask, w: InfoWorktree, loose: number): void;   // aviso al Supervisor
  /** pregunta al Supervisor (una vez) si lo quita igualmente; `quitar` lo hace, si dice que sí ('esperando': hay una
   *  conversación abierta en él, se quitará al cerrarla) */
  ask(roomId: string, task: FinishedTask, w: InfoWorktree, what: Leftover[], remove: () => Promise<'removed' | 'waiting' | undefined>): void;
  changed(): void;                                               // los worktrees de las salas han cambiado
}

export class TasksCleanup {
  private notified: string[] = [];
  private approved: string[] = [];   // «sala|ruta» que el Supervisor mandó quitar con una conversación abierta en él
  private unverified: string[] = [];   // «sala|ruta» the Overseer let go without a verification plan
  private file: string;
  constructor(dir: string, private ctx: CtxCleanup) {
    this.file = path.join(dir, 'limpieza-tareas.json');
    const texts = (x: unknown) => Array.isArray(x) ? x.filter((y: unknown): y is string => typeof y === 'string') : [];
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); this.notified = texts(j.notified); this.approved = texts(j.approved); this.unverified = texts(j.unverified); } } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ notified: this.notified.slice(-2000), approved: this.approved, unverified: this.unverified }), { mode: 0o600 }); renameSync(tmp, this.file); }

  async poll() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const prs = await this.ctx.prs(c);
    let notices = false, removed = false;
    const seen = new Set<string>();
    for (const room of await this.ctx.rooms()) for (const task of finishedTasks(room, prs)) for (const w of task.worktrees) {
      const approved = `${room.id}|${path.resolve(w.path)}`;
      seen.add(approved);
      try {
        const plan = planOf(task, w, this.ctx.plans()), hold = this.unverified.includes(approved) ? undefined : verificationHold(task, plan);
        if (hold) {
          // without an approved plan, asked once per task (the plan's key, else the worktree's task)
          const key = plan?.key ?? taskKey(worktreeTask(w)) ?? taskKey(task.task) ?? task.task;
          const asked = `plan|${room.id}|${key}`;
          if (hold === 'no-plan' && !this.notified.includes(asked)) {
            this.notified.push(asked); notices = true;
            this.ctx.noPlan(room.id, task, w, key, plan, conversationIn(this.ctx.sessions(), w), () => {
              if (!this.unverified.includes(approved)) { this.unverified.push(approved); this.save(); }
            });
          }
          continue;
        }
        const what = await leftovers(this.ctx.git, w, task.prs, this.ctx.sessions());
        const pending = scheduledIn(this.ctx.scheduled(), room, w).length;
        if (pending) what.push({ type: 'scheduled', n: pending });
        if (what.some(x => x.type === 'conversation')) continue;   // se espera a que se cierre
        const force = this.approved.includes(approved);
        if (!what.length || force) {
          await this.remove(room, task, w, force);
          if (force) { this.approved = this.approved.filter(x => x !== approved); notices = true; }
          removed = true;
          continue;
        }
        // se pregunta una vez por lo que queda (si cambia, otra)
        const key = `${room.id}|${task.task}|${path.resolve(w.path)}|${what.map(x => x.type + ('n' in x ? x.n : '')).join(',')}`;
        if (this.notified.includes(key)) continue;
        this.notified.push(key); notices = true;
        this.ctx.ask(room.id, task, w, what, async () => {
          // sigue siendo un worktree de la sala (puede haber pasado un rato)
          const list = await this.ctx.git(room.path, ['worktree', 'list', '--porcelain']);
          if (!list.split('\n').includes('worktree ' + w.path)) return undefined;
          // con una conversación abierta en él (p. ej. la de preguntarle qué queda), se quita en cuanto se cierre
          if ((await leftovers(this.ctx.git, w, task.prs, this.ctx.sessions())).some(x => x.type === 'conversation')) {
            if (!this.approved.includes(approved)) { this.approved.push(approved); this.save(); }
            return 'waiting';
          }
          await this.remove(room, task, w, true);
          this.ctx.changed();
          return 'removed';
        });
      } catch (e) {
        console.error(`Limpieza de ${w.path}:`, String((e as Error).message).split('\n')[0]);
      }
    }
    // lo aprobado que ya no está (quitado a mano, PR reabierto) se olvida
    const remaining = this.approved.filter(x => seen.has(x)), unverified = this.unverified.filter(x => seen.has(x));
    if (remaining.length !== this.approved.length || unverified.length !== this.unverified.length) { this.approved = remaining; this.unverified = unverified; notices = true; }
    if (notices) this.save();
    if (removed) this.ctx.changed();
  }

  /** Quita el worktree (forzando solo si el Supervisor lo ha dicho) y su rama local; lo que git no sigue, antes a la papelera */
  private async remove(room: RoomCleanup, task: FinishedTask, w: InfoWorktree, force: boolean) {
    const loose = await untracked(this.ctx.git, w.path);
    if (loose.length) await this.ctx.trash(loose);
    await this.ctx.git(room.path, ['worktree', 'remove', ...(force ? ['--force'] : []), w.path]);
    if (w.branch) await this.ctx.git(room.path, ['branch', '-D', w.branch]).catch(() => '');
    this.ctx.removed(room.id, task, w, loose.length);
  }
}
