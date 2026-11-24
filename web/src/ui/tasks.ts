// Los colores de las tareas en el cliente (shared/tasks.ts): se piden al servidor los de las tareas que se ven (los
// guarda y reparte para que no se repitan) y, al llegar, se repinta lo que los usa (tableros con useColoresTareas;
// pantallas y hologramas miran `versionColores`).
import { assignedColors, assignedEpics, hasTaskColor } from '@shared/tasks';
import type { Epic, PRBoard, TaskJira } from '@shared/board';
import { client, live } from '../net/client';
import { t } from '@shared/language';
import { STATE_TEXT } from '@shared/verification';
import { Store } from './store';

export const versionColors = new Store<{ v: number }>({ v: 0 });
export const useColorsTasks = () => versionColors.use(e => e.v);

const requested = new Set<string>(); const queue = new Set<string>(); let timer: ReturnType<typeof setTimeout> | null = null;
/** Los colores que trae el tablero de Jira (los reparte Logística): se apuntan sin pedirlos */
export function aimColors(tareas: { key: string; color?: string; epic?: Epic }[]) {
  let newer = false;
  const log = (key: string, color?: string) => { const k = key.toUpperCase(); if (color && assignedColors.get(k) !== color) { assignedColors.set(k, color); requested.add(k); newer = true; } };
  for (const t of tareas) {
    log(t.key, t.color);
    if (t.epic) log(t.epic.key, t.epic.color);
    const k = t.key.toUpperCase(), before = epics.get(k);
    if (before?.key !== t.epic?.key || before?.title !== t.epic?.title) { if (t.epic) epics.set(k, { key: t.epic.key, title: t.epic.title }); else epics.delete(k); newer = true; }
    if (t.epic) assignedEpics.set(k, t.epic.key.toUpperCase()); else assignedEpics.delete(k);
  }
  if (newer) versionColors.set(e => ({ v: e.v + 1 }));
}
// each task's epic, as the Jira board last read it (repaints go with versionColors, like the colors)
const epics = new Map<string, Epic>();
/** The epic of a task key, once the Jira board has read it; its color is taskColor(epic.clave) */
export const taskEpic = (key: string | undefined): Epic | undefined => key ? epics.get(key.toUpperCase()) : undefined;
/** The tasks in view: new ones with a task color are requested (together, a moment later); slugs take none */
export function knowTasks(keys: (string | undefined)[]) {
  for (const c of keys) { const k = c?.toUpperCase(); if (hasTaskColor(k) && !requested.has(k)) { requested.add(k); queue.add(k); } }
  if (!queue.size || timer) return;
  timer = setTimeout(() => {
    timer = null; const batch = [...queue]; queue.clear();
    client.action<Record<string, string>>('tasks.colors', { keys: batch }).then(m => {
      for (const [k, c] of Object.entries(m ?? {})) assignedColors.set(k, c);
      versionColors.set(e => ({ v: e.v + 1 }));
    }).catch(() => { for (const k of batch) requested.delete(k); });
  }, 80);
}

/** Lo último leído del tablero de Jira (tareas y PR): lo apuntan el panel y la pantalla de Planificación, y la pantalla
 *  lo pinta al momento (recargar el panel con R también la pone al día) */
export const jiraBoard = new Store<{ tareas: TaskJira[] | null; prs: PRBoard[] }>({ tareas: null, prs: [] });

/** A task's production verification as a short mark (🔭 and its state), once a checkpoint has opened; `pr`: that PR's
 *  checkpoint (org/repo#N), else the task's final one */
export function verificationMark(key: string | undefined, pr?: string): string {
  const v = key ? live.get().verifications[key.toUpperCase()] ?? live.get().verifications[key] : undefined;
  const state = v?.open ? (pr && v.prs[pr.toLowerCase()]) || v.final : undefined;
  return state ? '🔭 ' + t(STATE_TEXT[state]) : '';
}

/** The title of a task, when the Jira board has read it */
export const taskTitle = (key: string | undefined) => key ? jiraBoard.get().tareas?.find(x => x.key.toUpperCase() === key.toUpperCase())?.title : undefined;

// Your GitHub PRs (`git.prsTablero`, the same as Planning's board), read at most every two minutes and shared by the
// intercoms and the rooms' task boards; without GitHub connected (or in DEMO), none
let prsAsked: { when: number; p: Promise<PRBoard[]> } | null = null;
export function myPRs(): Promise<PRBoard[]> {
  if (!prsAsked || Date.now() - prsAsked.when > 120_000) {
    const p = client.action<any>('git.prsBoard', {}).then(d => { const prs: PRBoard[] = d?.demo ? [] : d?.prs ?? []; if (!d?.demo) jiraBoard.set({ prs }); return prs; }).catch(() => { prsAsked = null; return [] as PRBoard[]; });
    prsAsked = { when: Date.now(), p };
  }
  return prsAsked.p;
}
