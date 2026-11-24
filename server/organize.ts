// Organizar una sala de repo por tareas: un worktree por cada tarea con PR tuyos sin fusionar en ese repo, y en cada uno
// su propia conversación con el habitante de la sala. Una tarea es la clave de Jira de la rama o del título; los PR
// apilados (la base de uno es la rama de otro) van siempre juntos aunque no la lleven. Dentro de una tarea se trabaja de
// uno en uno (checkout, arreglar, rebasar los de encima): varios a la vez en una pila serían un caos.
// Primero se enseña el plan (qué worktree se crea o se reutiliza y qué conversación empieza) y el Supervisor lo confirma.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PRBoard } from '../shared/board.ts';
import { jiraKeys, prText } from '../shared/board.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocol.ts';
import { branchKey, prsOfName } from './prReviews.ts';
import { t } from '../shared/language.ts';
import { worktreeHasTask } from '../shared/tasks.ts';

export interface TaskGroup { id: string; key?: string; name: string; prs: PRBoard[] }

const keyOf = (p: PRBoard) => branchKey(p.branch) ?? jiraKeys(p.title)[0];

/** Los PR abiertos de un repo, por tarea: misma clave o apilados entre sí; dentro, de la base hacia arriba */
export function groupByTask(prs: PRBoard[]): TaskGroup[] {
  const open = prs.filter(p => p.state === 'open' || p.state === 'draft');
  const parent = new Map(open.map(p => [p.url, p.url]));
  const root = (u: string): string => { const q = parent.get(u)!; return q === u ? u : root(q); };
  const union = (a: string, b: string) => { const x = root(a), y = root(b); if (x !== y) parent.set(y, x); };
  const keyBy = new Map<string, string>();
  for (const p of open) {
    const c = keyOf(p); if (c) { const already = keyBy.get(c); if (already) union(already, p.url); else keyBy.set(c, p.url); }
    for (const q of open) if (q !== p && p.base && q.branch === p.base) union(q.url, p.url);
  }
  const groups = new Map<string, PRBoard[]>();
  for (const p of open) { const r = root(p.url); groups.set(r, [...(groups.get(r) ?? []), p]); }
  return [...groups.values()].map(list => {
    const prs = stackOrder(list);
    const key = prs.map(keyOf).find(Boolean);
    const name = key ? `shelter-${key.toLowerCase()}` : `shelter-pr-${prs.slice(0, 4).map(p => p.number).join('-')}`;
    return { id: key ?? `pr-${prs[0].number}`, key, name, prs };
  }).sort((a, b) => a.prs[0].number - b.prs[0].number);
}
// de la base hacia arriba: primero los que no van encima de otro del grupo, luego los que van encima de esos…
function stackOrder(prs: PRBoard[]): PRBoard[] {
  const out: PRBoard[] = []; let remain = [...prs].sort((a, b) => a.number - b.number);
  while (remain.length) {
    const ready = remain.filter(p => !remain.some(q => q !== p && q.branch === p.base));
    const batch = ready.length ? ready : [remain[0]];   // un ciclo (no debería): se rompe por el más antiguo
    out.push(...batch); remain = remain.filter(p => !batch.includes(p));
  }
  return out;
}


/** El worktree que ya trabaja una tarea: con la rama de uno de sus PR, o con su clave (o sus PR) en el nombre */
export function taskWorktree(g: TaskGroup, worktrees: InfoWorktree[]): InfoWorktree | undefined {
  const branches = new Set(g.prs.map(p => p.branch));
  const others = worktrees.filter(w => !w.main);
  return others.find(w => branches.has(w.branch))
    ?? (g.key ? others.find(w => worktreeHasTask(w, g.key!)) : undefined)
    ?? others.find(w => prsOfName(path.basename(w.path)).some(n => g.prs.some(p => p.number === n)));
}

export interface OrganizeStep {
  group: TaskGroup;
  path: string;                        // donde se trabaja la tarea
  create: boolean;                      // worktree nuevo
  main: boolean;                  // una de sus ramas está en la copia principal: se trabaja ahí
  session?: string;                     // conversación ya abierta ahí (no se empieza otra)
}
export function roomPlan(room: { path: string; branch?: string; worktrees: InfoWorktree[] }, groups: TaskGroup[], sessions: SessionSummary[]): OrganizeStep[] {
  const openSessions = sessions.filter(s => s.state !== 'closed');
  const inside = (filePath: string) => openSessions.find(s => { const d = path.resolve(s.worktree ?? s.cwd); return d === filePath || d.startsWith(filePath + path.sep); });
  return groups.map(group => {
    const wt = taskWorktree(group, room.worktrees);
    const main = !wt && !!room.branch && group.prs.some(p => p.branch === room.branch);
    const filePath = wt?.path ?? (main ? room.path : path.join(room.path, '.claude', 'worktrees', group.name));
    // en la copia principal solo cuenta una conversación que esté en ella, no en sus worktrees
    const s = main ? openSessions.find(x => path.resolve(x.worktree ?? x.cwd) === path.resolve(room.path)) : inside(filePath);
    return { group, path: filePath, create: !wt && !main, main, session: s?.id };
  });
}

/** Lo que recibe la conversación de la tarea */
export function promptTask(g: TaskGroup, repo: string): string {
  const stacked = g.prs.some(p => g.prs.some(q => q.branch === p.base));
  const task = g.key ?? 'PR #' + g.prs.map(p => p.number).join(', #');
  return [
    g.prs.length === 1 ? t('prompt.task.title.one', { task: task, repo }) : t('prompt.task.title.many', { task: task, n: g.prs.length, repo }),
    '',
    t('prompt.task.onlyThis', { key: g.key ? ` (${g.key})` : '' }) + ' ' + t(stacked ? 'prompt.task.stacked' : 'prompt.task.these'),
    ...g.prs.map((p, i) => t('prompt.task.pr', { i: i + 1, number: p.number, title: p.title, branch: p.branch, base: p.base ? t('prompt.task.onTopOf', { base: p.base }) : '', state: prText(p), url: p.url })),
    '',
    t('prompt.task.howTo'),
    ...(stacked ? [t('prompt.task.rebase')] : []),
    t('prompt.task.noPush'),
  ].join('\n');
}

export interface CtxOrganize {
  git(cwd: string, args: string[]): Promise<string>;
  start(roomId: string, cwd: string, prompt: string): Promise<string>;   // id de la sesión
}
/** Crea los worktrees que faltan (con ramas locales que siguen a las del remoto) y empieza las conversaciones que faltan.
 *  Devuelve, por paso, qué se ha hecho (o por qué no). */
export async function applyPlan(ctx: CtxOrganize, room: { id: string; path: string }, steps: OrganizeStep[], repo: string, remain: () => number): Promise<string[]> {
  const out: string[] = [];
  const branches = [...new Set(steps.flatMap(p => p.group.prs.map(x => x.branch)))];
  if (steps.some(p => p.create)) await ctx.git(room.path, ['fetch', 'origin', ...branches.map(r => `+refs/heads/${r}:refs/remotes/origin/${r}`)]).catch(() => '');
  const exists = (r: string) => ctx.git(room.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${r}`]).then(() => true, () => false);
  for (const p of steps) {
    const name = p.group.key ?? `PR #${p.group.prs[0].number}`;
    try {
      if (p.create) {
        // las ramas de la tarea, locales y siguiendo a las del remoto (para poder hacer checkout de cada una)
        for (const x of p.group.prs.slice(1)) if (!(await exists(x.branch))) await ctx.git(room.path, ['branch', '--track', x.branch, `origin/${x.branch}`]).catch(() => '');
        const r0 = p.group.prs[0].branch;
        mkdirSync(path.dirname(p.path), { recursive: true });
        await ctx.git(room.path, (await exists(r0)) ? ['worktree', 'add', p.path, r0] : ['worktree', 'add', '--track', '-b', r0, p.path, `origin/${r0}`]);
      }
      if (p.session) { out.push(p.create ? t('server.organize.hasConversation', { name: name }) : t('server.organize.hasConversationIn', { name: name, folder: path.basename(p.path) })); continue; }
      if (remain() <= 0) { out.push(t(p.create ? 'server.organize.createdNoSession' : 'server.organize.readyNoSession', { name: name })); continue; }
      await ctx.start(room.id, p.path, promptTask(p.group, repo));
      out.push(p.create ? t('server.organize.startedNew', { name: name }) : p.main ? t('server.organize.startedMain', { name: name }) : t('server.organize.startedIn', { name: name, folder: path.basename(p.path) }));
    } catch (e) {
      out.push(t('server.organize.failed', { name: name, error: String((e as Error).message).split('\n')[0].slice(0, 160) }));
    }
  }
  return out;
}
