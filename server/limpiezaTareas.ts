// Limpieza de las tareas terminadas: cuando todos los PR de una tarea en el repo de una sala están fusionados o cerrados
// (ninguno abierto ni en borrador) y en la sala sigue algún worktree de esa tarea, el juego lo quita solo, sin preguntar:
// antes comprueba con git que no queda otro trabajo (cambios sin commit en archivos de git; stash de su rama; commits que
// no estén en el remoto ni en la rama del PR en GitHub) y que no hay una conversación abierta en él. Los archivos sueltos
// que git no sigue (notas de un plan, borradores) no cuentan: van a la papelera de macOS (se recuperan desde el Finder).
// Quita el worktree (`git worktree remove`, sin forzar) y su rama local; la del remoto se queda (un PR cerrado se puede
// reabrir). Con una conversación abierta, espera a que se cierre. Si queda trabajo, pregunta una vez al Supervisor si lo
// quita igualmente (y entonces sí, forzando; si para entonces hay una conversación abierta en él, queda aprobado y se
// quita en cuanto se cierre); en cada vuelta se vuelve a mirar (guardado lo que había, se quita sin preguntar). Cada cinco
// minutos con GitHub conectado (main.ts); lo ya preguntado y lo aprobado, en DATOS/limpieza-tareas.json.
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
  const cambios = lineas(await git(w.ruta, ['status', '--porcelain', '--untracked-files=no'])).length;
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

/** Los archivos y carpetas que git no sigue (ni ignora) en el worktree, en absoluto */
export async function untracked(git: (cwd: string, args: string[]) => Promise<string>, ruta: string): Promise<string[]> {
  const top = (await git(ruta, ['rev-parse', '--show-toplevel'])).trim();
  return (await git(ruta, ['status', '--porcelain', '-z', '--untracked-files=normal'])).split('\0')
    .filter(l => l.startsWith('?? ')).map(l => path.join(top, l.slice(3)));
}

export interface CtxCleanup {
  connection(): Promise<{ real: boolean; token?: string }>;
  prs(c: { real: boolean; token?: string }): Promise<PRBoard[]>;   // abiertos, y fusionados o cerrados hace poco
  salas(): Promise<RoomCleanup[]>;
  sesiones(): SessionSummary[];
  git(cwd: string, args: string[]): Promise<string>;              // lanza si el comando falla
  papelera(rutas: string[]): Promise<void>;                       // a la papelera de macOS
  quitado(salaId: string, tarea: FinishedTask, w: InfoWorktree, sueltos: number): void;   // aviso al Supervisor
  /** pregunta al Supervisor (una vez) si lo quita igualmente; `quitar` lo hace, si dice que sí ('esperando': hay una
   *  conversación abierta en él, se quitará al cerrarla) */
  preguntar(salaId: string, tarea: FinishedTask, w: InfoWorktree, que: Leftover[], quitar: () => Promise<'quitado' | 'esperando' | undefined>): void;
  cambiado(): void;                                               // los worktrees de las salas han cambiado
}

export class TasksCleanup {
  private avisados: string[] = [];
  private aprobados: string[] = [];   // «sala|ruta» que el Supervisor mandó quitar con una conversación abierta en él
  private archivo: string;
  constructor(dir: string, private ctx: CtxCleanup) {
    this.archivo = path.join(dir, 'limpieza-tareas.json');
    const textos = (x: unknown) => Array.isArray(x) ? x.filter((y: unknown): y is string => typeof y === 'string') : [];
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); this.avisados = textos(j.avisados); this.aprobados = textos(j.aprobados); } } catch {}
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ avisados: this.avisados.slice(-2000), aprobados: this.aprobados }), { mode: 0o600 }); renameSync(tmp, this.archivo); }

  async sondear() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const prs = await this.ctx.prs(c);
    let avisos = false, quitados = false;
    const vistos = new Set<string>();
    for (const sala of await this.ctx.salas()) for (const tarea of finishedTasks(sala, prs)) for (const w of tarea.worktrees) {
      const aprobado = `${sala.id}|${path.resolve(w.ruta)}`;
      vistos.add(aprobado);
      try {
        const que = await leftovers(this.ctx.git, w, tarea.prs, this.ctx.sesiones());
        if (que.some(x => x.tipo === 'conversacion')) continue;   // se espera a que se cierre
        const forzar = this.aprobados.includes(aprobado);
        if (!que.length || forzar) {
          await this.quitar(sala, tarea, w, forzar);
          if (forzar) { this.aprobados = this.aprobados.filter(x => x !== aprobado); avisos = true; }
          quitados = true;
          continue;
        }
        // se pregunta una vez por lo que queda (si cambia, otra)
        const clave = `${sala.id}|${tarea.tarea}|${path.resolve(w.ruta)}|${que.map(x => x.tipo + ('n' in x ? x.n : '')).join(',')}`;
        if (this.avisados.includes(clave)) continue;
        this.avisados.push(clave); avisos = true;
        this.ctx.preguntar(sala.id, tarea, w, que, async () => {
          // sigue siendo un worktree de la sala (puede haber pasado un rato)
          const lista = await this.ctx.git(sala.ruta, ['worktree', 'list', '--porcelain']);
          if (!lista.split('\n').includes('worktree ' + w.ruta)) return undefined;
          // con una conversación abierta en él (p. ej. la de preguntarle qué queda), se quita en cuanto se cierre
          if ((await leftovers(this.ctx.git, w, tarea.prs, this.ctx.sesiones())).some(x => x.tipo === 'conversacion')) {
            if (!this.aprobados.includes(aprobado)) { this.aprobados.push(aprobado); this.guardar(); }
            return 'esperando';
          }
          await this.quitar(sala, tarea, w, true);
          this.ctx.cambiado();
          return 'quitado';
        });
      } catch (e) {
        console.error(`Limpieza de ${w.ruta}:`, String((e as Error).message).split('\n')[0]);
      }
    }
    // lo aprobado que ya no está (quitado a mano, PR reabierto) se olvida
    const quedan = this.aprobados.filter(x => vistos.has(x));
    if (quedan.length !== this.aprobados.length) { this.aprobados = quedan; avisos = true; }
    if (avisos) this.guardar();
    if (quitados) this.ctx.cambiado();
  }

  /** Quita el worktree (forzando solo si el Supervisor lo ha dicho) y su rama local; lo que git no sigue, antes a la papelera */
  private async quitar(sala: RoomCleanup, tarea: FinishedTask, w: InfoWorktree, forzar: boolean) {
    const sueltos = await untracked(this.ctx.git, w.ruta);
    if (sueltos.length) await this.ctx.papelera(sueltos);
    await this.ctx.git(sala.ruta, ['worktree', 'remove', ...(forzar ? ['--force'] : []), w.ruta]);
    if (w.rama) await this.ctx.git(sala.ruta, ['branch', '-D', w.rama]).catch(() => '');
    this.ctx.quitado(sala.id, tarea, w, sueltos.length);
  }
}
