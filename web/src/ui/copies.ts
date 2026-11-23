// Copias holográficas (worktrees) como interlocutores propios: cada copia tiene su intercomunicador, independiente
// del de su autor, como un clon. Lo que se trabaja dentro de un worktree es de su copia; lo demás, del habitante.
import type { InfoWorktree, ReviewCopy, SessionSummary } from '@shared/protocol';
import { live } from '../net/client';
import { t } from '@shared/language';
import { juego, type DwellerSummary } from './gameState';
import { taskCaption, taskKey, worktreeTask } from '@shared/tasks';
import { taskTitle } from './tasks';

const PREFIX = 'holo:';
export const idCopy = (path: string) => PREFIX + path;
export const isCopy = (id: string | null | undefined) => !!id?.startsWith(PREFIX);
export const copyPath = (id: string) => id.slice(PREFIX.length);

/** Ruta del worktree que contiene `cwd` (de los conocidos o, recién creado por Claude Code, por la forma de su ruta). */
export function pathWorktree(cwd: string | undefined, known: InfoWorktree[]): string | undefined {
  if (!cwd) return;
  for (const w of known) if (!w.main && (cwd === w.path || cwd.startsWith(w.path + '/'))) return w.path;
  return /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];
}

export const worktreesKnown = (): InfoWorktree[] => Object.values(live.get().repos ?? {}).flatMap(r => r?.worktrees ?? []).filter(w => !w.main);

/** De quién es una sesión: de la copia del worktree donde trabaja (si su holograma está en el refugio) o de su habitante. */
export function sessionOwner(s: SessionSummary, copies = juego.get().copies): string {
  const path = pathWorktree(s.cwd, worktreesKnown());
  return path && copies.some(c => c.id === idCopy(path)) ? idCopy(path) : s.dwellerId;
}

/** Habitante o copia holográfica con ese id. */
export const interlocutor = (id: string | null | undefined, e = juego.get()): DwellerSummary | undefined =>
  id ? e.dwellers.find(h => h.id === id) ?? e.copies.find(c => c.id === id) : undefined;

export function branchCaption(branch: string) { return (branch || t('windows.noBranch')).replace(/^(worktree-)?(shelter|refugio)-/, '').slice(0, 18) || branch; }

/** A copy's task: its worktree's or, for a review's hologram (the Review room), its review's (a lone PR's has none) */
export const copyTask = (w: { path: string; branch?: string; review?: ReviewCopy }) => w.review ? taskKey(w.review.key) : worktreeTask(w);

/** A copy's caption: its task with the title when known (Jira board), otherwise `otherwise` (the key, or its branch); a
 *  review's, its key (or PR) and title, then its repos */
export function copyCaption(w: { path: string; branch: string; review?: ReviewCopy }, otherwise = branchCaption(w.branch)) {
  if (w.review) {
    const k = w.review.key, task = copyTask(w);
    return `${taskCaption(task ?? k.split('/').pop()!, taskTitle(task) ?? w.review.title)} · ${w.review.repos.map(r => r.split('/').pop()).join(' ')}`;
  }
  const key = worktreeTask(w), title = taskTitle(key);
  return key && title ? taskCaption(key, title) : otherwise;
}
