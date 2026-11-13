// Pre-flight de una tarea (fase 1, solo lectura; el modelo en shared/preflight.ts): junta lo que hay de una tarea en todo
// el refugio. Las salas de repo con sus worktrees, tus PR (los del tablero de despliegue más los abiertos de antes,
// leídos de GitHub a lo sumo una vez por minuto), los bloqueos entre ellos (los manuales de bloqueosPR.ts y el orden
// del plan) y las partes de su plan repartido (planes.ts). De git, solo lectura: la cabeza de cada rama de la tarea,
// sus cambios sin commitear y cuántos commits tiene y le faltan respecto a la cabeza de su PR en GitHub (sin `fetch`:
// si esa cabeza no está en el repo local, faltan commits remotos).
import path from 'node:path';
import type { PRBoard } from '../shared/tablero.ts';
import { bloqueosEntre, type BlockerManual, type TaskOrder } from '../shared/despliegue.ts';
import { preflightTarea, type LocalBranch, type PlanPart, type TaskPreflight } from '../shared/preflight.ts';
import { pRTask, worktreeTask } from '../shared/tareas.ts';
import type { RoomPR } from './revisionesPR.ts';
import { t } from '../shared/idioma.ts';

type Git = (cwd: string, args: string[]) => Promise<string>;
export interface DataPRs { prs: PRBoard[]; demo?: boolean; error?: string }

export interface CtxPreflight {
  prs(forzar: boolean): Promise<DataPRs>;
  salas(): Promise<RoomPR[]>;
  manuales(): BlockerManual[];
  orden(): Promise<TaskOrder[]>;
  plan(clave: string): PlanPart[] | undefined;
  color(clave: string): string | undefined;
  git: Git;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const quiet = (p: Promise<string>) => p.then(s => s.trim()).catch(() => '');

/** Las ramas de la tarea en cada sala: los worktrees de la tarea (por su nombre o su rama) y los que tienen sacada la
 *  rama de uno de sus PR, y las ramas locales de sus PR que no están sacadas en ninguno; cada una frente a su PR */
export async function localBranches(clave: string, prs: PRBoard[], salas: RoomPR[], git: Git): Promise<LocalBranch[]> {
  const K = clave.toUpperCase();
  const deLaTarea = prs.filter(p => p.estado !== 'cerrado' && pRTask(p) === K);
  const out: LocalBranch[] = [];
  await Promise.all(salas.map(async s => {
    const suyos = deLaTarea.filter(p => sameRepo(p.repo, s.repo));
    const ramas = new Set(suyos.map(p => p.rama));
    const sacadas = new Set<string>();
    const wts = s.worktrees.length ? s.worktrees : [{ ruta: s.ruta, rama: s.rama ?? '' }];
    await Promise.all(wts.map(async w => {
      if (!w.rama || (worktreeTask(w) !== K && !ramas.has(w.rama))) return;
      sacadas.add(w.rama);
      const [head, estado] = await Promise.all([quiet(git(w.ruta, ['rev-parse', 'HEAD'])), quiet(git(w.ruta, ['status', '--porcelain']))]);
      out.push({ salaId: s.id, rama: w.rama, head: head || undefined, worktree: path.resolve(w.ruta), cambios: estado.split('\n').filter(Boolean).length });
    }));
    await Promise.all([...ramas].filter(r => !sacadas.has(r)).map(async rama => {
      const head = await quiet(git(s.ruta, ['rev-parse', '--verify', '--quiet', `refs/heads/${rama}^{commit}`]));
      if (head) out.push({ salaId: s.id, rama, head });
    }));
    // frente a la cabeza de su PR en GitHub
    await Promise.all(out.filter(l => l.salaId === s.id && l.head).map(async l => {
      const cabeza = suyos.find(p => p.rama === l.rama)?.cabeza;
      if (!cabeza || cabeza === l.head) return;
      const hay = await git(s.ruta, ['cat-file', '-e', `${cabeza}^{commit}`]).then(() => true, () => false);
      if (!hay) { l.sinCabeza = true; return; }
      const [a, b] = (await quiet(git(s.ruta, ['rev-list', '--left-right', '--count', `${l.head}...${cabeza}`]))).split(/\s+/).map(Number);
      l.adelante = a || 0; l.detras = b || 0;
    }));
  }));
  return out.sort((a, b) => a.salaId.localeCompare(b.salaId) || a.rama.localeCompare(b.rama));
}

/** El pre-flight de una tarea, con todo lo del refugio */
export async function preflightOf(clave: string, ctx: CtxPreflight, forzar = false): Promise<TaskPreflight> {
  const K = clave.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(K)) throw new Error(t('server.notATaskKey', { clave: clave.slice(0, 40) }));
  const [gh, salas, orden] = await Promise.all([ctx.prs(forzar), ctx.salas(), ctx.orden().catch(() => [] as TaskOrder[])]);
  const locales = await localBranches(K, gh.prs, salas, ctx.git);
  return preflightTarea(K, {
    prs: gh.prs, bloqueos: bloqueosEntre(gh.prs, ctx.manuales(), orden), locales,
    salas: salas.map(s => ({ id: s.id, nombre: s.nombre, repo: s.repo })),
    plan: ctx.plan(K), color: ctx.color(K), demo: gh.demo, error: gh.error,
  });
}

/** Tus PR para el pre-flight: los del tablero (dos semanas) y todos los abiertos, una lectura por minuto como mucho */
export function cachedPRs(leer: () => Promise<DataPRs>, ttl = 60_000) {
  let ultimo: { ts: number; p: Promise<DataPRs> } | null = null;
  return (forzar = false) => {
    if (!ultimo || forzar || Date.now() - ultimo.ts > ttl) {
      const p = leer().catch(e => { ultimo = null; throw e; });
      ultimo = { ts: Date.now(), p };
    }
    return ultimo.p;
  };
}
