// Limpieza de las tareas terminadas: cuando todos los PR de una tarea en el repo de una sala están fusionados o cerrados
// (ninguno abierto ni en borrador) y en la sala sigue algún worktree de esa tarea, se le pide al
// habitante de la sala, en la conversación de su copia principal (la abierta ahí, la última retomada o una nueva; un
// worktree no puede quitarse a sí mismo), que los limpie sin plan: comprobar que no queda trabajo sin subir y quitarlos. Se mira cada
// pocos minutos con GitHub conectado (main.ts); cada worktree se avisa una sola vez (DATOS/limpieza-tareas.json). Si no
// hay conversación que lo reciba (límite de sesiones), se vuelve a intentar.
// Quitar los worktrees lo hace el habitante desde su conversación (con los permisos de la sesión): aquí no se borra nada.
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

/** El mensaje para el habitante de la sala: las tareas terminadas, sus worktrees y que proponga limpiarlos */
export function cleanupMessage(repo: string, tareas: FinishedTask[], sesiones: SessionSummary[]): string {
  const abierta = (ruta: string) => sesiones.some(s => s.estado !== 'cerrada' && path.resolve(s.worktree ?? s.cwd) === path.resolve(ruta));
  return [
    t('prompt.cleanup.title', { repo }),
    '',
    ...tareas.flatMap(x => [
      t('prompt.cleanup.task', { tarea: x.tarea, prs: x.prs.map(p => `#${p.numero}` + (p.estado === 'fusionado' ? '' : t('prompt.cleanup.closed'))).join(', ') }),
      ...x.worktrees.map(w => `   - \`${w.ruta}\`${w.rama ? ` (${w.rama})` : ''}`
        + (w.cambios ? t('prompt.cleanup.changes', { n: w.cambios }) : '')
        + (abierta(w.ruta) ? t('prompt.cleanup.open') : '')),
    ]),
    '',
    t('prompt.cleanup.ask'),
  ].join('\n');
}

export interface CtxCleanup {
  connection(): Promise<{ real: boolean; token?: string }>;
  prs(c: { real: boolean; token?: string }): Promise<PRBoard[]>;   // abiertos y fusionados o cerrados hace poco
  salas(): Promise<RoomCleanup[]>;
  sesiones(): SessionSummary[];
  /** a la conversación de la copia principal de la sala (abierta, retomada o nueva); false si no se ha podido */
  enviar(salaId: string, cwd: string, texto: string): Promise<boolean>;
  delivered(salaId: string, tareas: FinishedTask[]): void;   // el robot mensajero y un aviso al Supervisor
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
    const ya = new Set(this.avisados);
    let cambio = false;
    const clave = (sala: RoomCleanup, w: InfoWorktree, x: FinishedTask) => `${sala.id}|${x.tarea}|${path.resolve(w.ruta)}`;
    for (const sala of await this.ctx.salas()) {
      // solo lo nuevo: las tareas con algún worktree sin avisar, y de ellas esos worktrees
      const nuevas = finishedTasks(sala, prs).map(x => ({ ...x, worktrees: x.worktrees.filter(w => !ya.has(clave(sala, w, x))) })).filter(x => x.worktrees.length);
      if (!nuevas.length) continue;
      if (!(await this.ctx.enviar(sala.id, sala.ruta, cleanupMessage(sala.repo ?? sala.nombre, nuevas, this.ctx.sesiones())).catch(() => false))) continue;
      this.avisados.push(...nuevas.flatMap(x => x.worktrees.map(w => clave(sala, w, x)))); cambio = true;
      this.ctx.delivered(sala.id, nuevas);
    }
    if (cambio) this.guardar();
  }
}
