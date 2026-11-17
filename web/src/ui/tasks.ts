// Los colores de las tareas en el cliente (shared/tareas.ts): se piden al servidor los de las tareas que se ven (los
// guarda y reparte para que no se repitan) y, al llegar, se repinta lo que los usa (tableros con useColoresTareas;
// pantallas y hologramas miran `versionColores`).
import { assignedColors, hasTaskColor } from '@shared/tareas';
import type { Epic, PRBoard, TaskJira } from '@shared/tablero';
import { cliente } from '../red/cliente';
import { Store } from './almacen';

export const versionColors = new Store<{ v: number }>({ v: 0 });
export const useColorsTasks = () => versionColors.usar(e => e.v);

const requested = new Set<string>(); const queue = new Set<string>(); let reloj: ReturnType<typeof setTimeout> | null = null;
/** Los colores que trae el tablero de Jira (los reparte Logística): se apuntan sin pedirlos */
export function aimColors(tareas: { clave: string; color?: string; epica?: Epic }[]) {
  let nuevo = false;
  const apuntar = (clave: string, color?: string) => { const k = clave.toUpperCase(); if (color && assignedColors.get(k) !== color) { assignedColors.set(k, color); requested.add(k); nuevo = true; } };
  for (const t of tareas) {
    apuntar(t.clave, t.color);
    if (t.epica) apuntar(t.epica.clave, t.epica.color);
    const k = t.clave.toUpperCase(), antes = epics.get(k);
    if (antes?.clave !== t.epica?.clave || antes?.titulo !== t.epica?.titulo) { if (t.epica) epics.set(k, { clave: t.epica.clave, titulo: t.epica.titulo }); else epics.delete(k); nuevo = true; }
  }
  if (nuevo) versionColors.set(e => ({ v: e.v + 1 }));
}
// each task's epic, as the Jira board last read it (repaints go with versionColors, like the colors)
const epics = new Map<string, Epic>();
/** The epic of a task key, once the Jira board has read it; its color is taskColor(epic.clave) */
export const taskEpic = (clave: string | undefined): Epic | undefined => clave ? epics.get(clave.toUpperCase()) : undefined;
/** The tasks in view: new ones with a task color are requested (together, a moment later); slugs take none */
export function knowTasks(claves: (string | undefined)[]) {
  for (const c of claves) { const k = c?.toUpperCase(); if (hasTaskColor(k) && !requested.has(k)) { requested.add(k); queue.add(k); } }
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

/** The title of a task, when the Jira board has read it */
export const taskTitle = (clave: string | undefined) => clave ? jiraBoard.get().tareas?.find(x => x.clave.toUpperCase() === clave.toUpperCase())?.titulo : undefined;

// Your GitHub PRs (`git.prsTablero`, the same as Planning's board), read at most every two minutes and shared by the
// intercoms and the rooms' task boards; without GitHub connected (or in DEMO), none
let prsAsked: { cuando: number; p: Promise<PRBoard[]> } | null = null;
export function myPRs(): Promise<PRBoard[]> {
  if (!prsAsked || Date.now() - prsAsked.cuando > 120_000) {
    const p = cliente.accion<any>('git.prsTablero', {}).then(d => { const prs: PRBoard[] = d?.demo ? [] : d?.prs ?? []; if (!d?.demo) jiraBoard.set({ prs }); return prs; }).catch(() => { prsAsked = null; return [] as PRBoard[]; });
    prsAsked = { cuando: Date.now(), p };
  }
  return prsAsked.p;
}
