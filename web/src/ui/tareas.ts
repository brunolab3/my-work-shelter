// Los colores de las tareas en el cliente (shared/tareas.ts): se piden al servidor los de las tareas que se ven (los
// guarda y reparte para que no se repitan) y, al llegar, se repinta lo que los usa (tableros con useColoresTareas;
// pantallas y hologramas miran `versionColores`).
import { assignedColors } from '@shared/tareas';
import type { PRBoard, TaskJira } from '@shared/tablero';
import { cliente } from '../red/cliente';
import { Store } from './almacen';

export const versionColors = new Store<{ v: number }>({ v: 0 });
export const useColorsTasks = () => versionColors.usar(e => e.v);

const requested = new Set<string>(); const queue = new Set<string>(); let reloj: ReturnType<typeof setTimeout> | null = null;
/** Los colores que trae el tablero de Jira (los reparte Logística): se apuntan sin pedirlos */
export function aimColors(tareas: { clave: string; color?: string }[]) {
  let nuevo = false;
  for (const t of tareas) { const k = t.clave.toUpperCase(); if (t.color && assignedColors.get(k) !== t.color) { assignedColors.set(k, t.color); requested.add(k); nuevo = true; } }
  if (nuevo) versionColors.set(e => ({ v: e.v + 1 }));
}
/** Las tareas que se están viendo: las nuevas se piden (juntas, un momento después) */
export function knowTasks(claves: (string | undefined)[]) {
  for (const c of claves) { const k = c?.toUpperCase(); if (k && !requested.has(k)) { requested.add(k); queue.add(k); } }
  if (!queue.size || reloj) return;
  reloj = setTimeout(() => {
    reloj = null; const lote = [...queue]; queue.clear();
    cliente.accion<Record<string, string>>('tareas.colores', { claves: lote }).then(m => {
      for (const [k, c] of Object.entries(m ?? {})) assignedColors.set(k, c);
      versionColors.set(e => ({ v: e.v + 1 }));
    }).catch(() => { for (const k of lote) requested.delete(k); });
  }, 80);
}

/** Lo último leído del tablero de Jira (tareas y PR): lo apuntan el panel y la pantalla de Planificación, y la pantalla
 *  lo pinta al momento (recargar el panel con R también la pone al día) */
export const jiraBoard = new Store<{ tareas: TaskJira[] | null; prs: PRBoard[] }>({ tareas: null, prs: [] });
