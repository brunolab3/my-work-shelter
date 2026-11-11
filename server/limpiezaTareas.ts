// Limpieza de las tareas terminadas: cuando todos los PR de una tarea en el repo de una sala están fusionados o cerrados
// (ninguno abierto ni en borrador) y en la sala sigue algún worktree de esa tarea, el juego lo quita solo, sin preguntar:
// antes comprueba con git que no queda otro trabajo (cambios sin commit, ni ignorados; stash de su rama; commits que no
// estén en el remoto ni en la rama del PR en GitHub) y que no hay una conversación abierta en él. Quita el worktree
// (`git worktree remove`, sin forzar) y su rama local; la del remoto se queda (un PR cerrado se puede reabrir). Con una
// conversación abierta, espera a que se cierre. Si queda trabajo, pregunta una vez al Supervisor si lo quita igualmente
// (y entonces sí, forzando); en cada vuelta se vuelve a mirar (guardado lo que había, se quita sin preguntar). Cada cinco
// minutos con GitHub conectado (main.ts); lo ya preguntado, en DATOS/limpieza-tareas.json.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { PRBoard } from '../shared/tablero.ts';
import { clavesJira } from '../shared/tablero.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocolo.ts';
import { branchKey, prsOfName } from './revisionesPR.ts';
import { t } from '../shared/idioma.ts';

export interface RoomCleanup { id: string; nombre: string; ruta: string; repo?: string; worktrees: InfoWorktree[] }
export interface FinishedTask { tarea: string; prs: PRBoard[]; worktrees: InfoWorktree[] }

const keyOf = (p: PRBoard) => branchKey(p.rama) ?? clavesJira(p.titulo)[0];

/** Las tareas del repo de una sala con todos sus PR fusionados o cerrados (uno abierto o en borrador la deja como está; un
 *  PR cerrado sin fusionar se reabre si hace falta: su rama sigue en el remoto) y algún worktree suyo aún en la sala:
 *  con su rama, con su clave o con sus PR en el nombre */
export function finishedTasks(sala: RoomCleanup, prs: PRBoard[]): FinishedTask[] {
  if (!sala.repo) return [];
  const delRepo = prs.filter(p => p.repo.toLowerCase() === sala.repo);
  const porTarea = new Map<string, PRBoard[]>();
  for (const p of delRepo) { const k = keyOf(p) ?? `PR #${p.numero}`; porTarea.set(k, [...(porTarea.get(k) ?? []), p]); }
  const otros = sala.worktrees.filter(w => !w.principal && !w.external);
  const out: FinishedTask[] = [];
  for (const [tarea, lista] of porTarea) {
    if (lista.some(p => p.estado === 'abierto' || p.estado === 'borrador')) continue;
    const ramas = new Set(lista.map(p => p.rama)), clave = keyOf(lista[0])?.toLowerCase();
    const worktrees = otros.filter(w => ramas.has(w.rama)
      || (clave && path.basename(w.ruta).toLowerCase().includes(clave))
      || prsOfName(path.basename(w.ruta)).some(n => lista.some(p => p.numero === n)));
    if (worktrees.length) out.push({ tarea, prs: lista.sort((a, b) => a.numero - b.numero), worktrees });
  }
  return out.sort((a, b) => a.tarea.localeCompare(b.tarea));
}

/** Lo que impide quitar un worktree (vacío: se puede quitar). `git` lanza si el comando falla */
export type Leftover = { tipo: 'cambios' | 'stash' | 'commits'; n: number } | { tipo: 'conversacion' };
export async function leftovers(git: (cwd: string, args: string[]) => Promise<string>, w: InfoWorktree, prs: PRBoard[], sesiones: SessionSummary[]): Promise<Leftover[]> {
  const out: Leftover[] = [];
  const dir = path.resolve(w.ruta);
  if (sesiones.some(s => s.estado !== 'cerrada' && (path.resolve(s.worktree ?? s.cwd) + path.sep).startsWith(dir + path.sep))) out.push({ tipo: 'conversacion' });
  const lineas = (t: string) => t.split('\n').filter(Boolean);
  const cambios = lineas(await git(w.ruta, ['status', '--porcelain'])).length;
  if (cambios) out.push({ tipo: 'cambios', n: cambios });
  // el stash es del repo entero: cuentan los guardados en esta rama («WIP on rama:» u «On rama:»)
  const stash = w.rama ? lineas(await git(w.ruta, ['stash', 'list', '--format=%gs'])).filter(l => l.startsWith(`WIP on ${w.rama}:`) || l.startsWith(`On ${w.rama}:`)).length : 0;
  if (stash) out.push({ tipo: 'stash', n: stash });
  // commits fuera del remoto: valen si están en la rama de alguno de sus PR en GitHub (fusionado con squash, la rama del
  // remoto borrada…)
  const fuera = lineas(await git(w.ruta, ['rev-list', 'HEAD', '--not', '--remotes'])).length;
  if (fuera) {
    let enPR = false;
    for (const p of prs) if (p.cabeza && !enPR) enPR = await git(w.ruta, ['merge-base', '--is-ancestor', 'HEAD', p.cabeza]).then(() => true, () => false);
    if (!enPR) out.push({ tipo: 'commits', n: fuera });
  }
  return out;
}

export interface CtxCleanup {
  connection(): Promise<{ real: boolean; token?: string }>;
  prs(c: { real: boolean; token?: string }): Promise<PRBoard[]>;   // abiertos, y fusionados o cerrados hace poco
  salas(): Promise<RoomCleanup[]>;
  sesiones(): SessionSummary[];
  git(cwd: string, args: string[]): Promise<string>;              // lanza si el comando falla
  quitado(salaId: string, tarea: FinishedTask, w: InfoWorktree): void;              // aviso al Supervisor
  /** pregunta al Supervisor (una vez) si lo quita igualmente; `quitar` lo hace, si dice que sí */
  preguntar(salaId: string, tarea: FinishedTask, w: InfoWorktree, que: Leftover[], quitar: () => Promise<void>): void;
  cambiado(): void;                                               // los worktrees de las salas han cambiado
}

export class TasksCleanup {
  private avisados: string[] = [];
  private archivo: string;
  constructor(dir: string, private ctx: CtxCleanup) {
    this.archivo = path.join(dir, 'limpieza-tareas.json');
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); this.avisados = Array.isArray(j.avisados) ? j.avisados.filter((x: unknown) => typeof x === 'string') : []; } } catch {}
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ avisados: this.avisados.slice(-2000) }), { mode: 0o600 }); renameSync(tmp, this.archivo); }

  async sondear() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const prs = await this.ctx.prs(c);
    let avisos = false, quitados = false;
    for (const sala of await this.ctx.salas()) for (const tarea of finishedTasks(sala, prs)) for (const w of tarea.worktrees) {
      try {
        const que = await leftovers(this.ctx.git, w, tarea.prs, this.ctx.sesiones());
        if (!que.length) {
          await this.quitar(sala, tarea, w, false);
          quitados = true;
          continue;
        }
        if (que.some(x => x.tipo === 'conversacion')) continue;   // se espera a que se cierre
        // se pregunta una vez por lo que queda (si cambia, otra)
        const clave = `${sala.id}|${tarea.tarea}|${path.resolve(w.ruta)}|${que.map(x => x.tipo + ('n' in x ? x.n : '')).join(',')}`;
        if (this.avisados.includes(clave)) continue;
        this.avisados.push(clave); avisos = true;
        this.ctx.preguntar(sala.id, tarea, w, que, async () => {
          // sigue siendo un worktree de la sala, y sin conversación abierta (puede haber pasado un rato)
          const lista = await this.ctx.git(sala.ruta, ['worktree', 'list', '--porcelain']);
          if (!lista.split('\n').includes('worktree ' + w.ruta)) return;
          if ((await leftovers(this.ctx.git, w, tarea.prs, this.ctx.sesiones())).some(x => x.tipo === 'conversacion')) throw new Error('hay una conversación abierta en él');
          await this.quitar(sala, tarea, w, true);
          this.ctx.cambiado();
        });
      } catch (e) {
        console.error(`Limpieza de ${w.ruta}:`, String((e as Error).message).split('\n')[0]);
      }
    }
    if (avisos) this.guardar();
    if (quitados) this.ctx.cambiado();
  }

  /** Quita el worktree (forzando solo si el Supervisor lo ha dicho) y su rama local */
  private async quitar(sala: RoomCleanup, tarea: FinishedTask, w: InfoWorktree, forzar: boolean) {
    await this.ctx.git(sala.ruta, ['worktree', 'remove', ...(forzar ? ['--force'] : []), w.ruta]);
    if (w.rama) await this.ctx.git(sala.ruta, ['branch', '-D', w.rama]).catch(() => '');
    this.ctx.quitado(sala.id, tarea, w);
  }
}
