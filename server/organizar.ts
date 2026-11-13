// Organizar una sala de repo por tareas: un worktree por cada tarea con PR tuyos sin fusionar en ese repo, y en cada uno
// su propia conversación con el habitante de la sala. Una tarea es la clave de Jira de la rama o del título; los PR
// apilados (la base de uno es la rama de otro) van siempre juntos aunque no la lleven. Dentro de una tarea se trabaja de
// uno en uno (checkout, arreglar, rebasar los de encima): varios a la vez en una pila serían un caos.
// Primero se enseña el plan (qué worktree se crea o se reutiliza y qué conversación empieza) y el Supervisor lo confirma.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PRBoard } from '../shared/tablero.ts';
import { clavesJira, textoPR } from '../shared/tablero.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocolo.ts';
import { branchKey, prsOfName } from './revisionesPR.ts';
import { t } from '../shared/idioma.ts';

export interface TaskGroup { id: string; clave?: string; nombre: string; prs: PRBoard[] }

const keyOf = (p: PRBoard) => branchKey(p.rama) ?? clavesJira(p.titulo)[0];

/** Los PR abiertos de un repo, por tarea: misma clave o apilados entre sí; dentro, de la base hacia arriba */
export function agruparPorTarea(prs: PRBoard[]): TaskGroup[] {
  const abiertos = prs.filter(p => p.estado === 'abierto' || p.estado === 'borrador');
  const padre = new Map(abiertos.map(p => [p.url, p.url]));
  const raiz = (u: string): string => { const q = padre.get(u)!; return q === u ? u : raiz(q); };
  const unir = (a: string, b: string) => { const x = raiz(a), y = raiz(b); if (x !== y) padre.set(y, x); };
  const keyBy = new Map<string, string>();
  for (const p of abiertos) {
    const c = keyOf(p); if (c) { const ya = keyBy.get(c); if (ya) unir(ya, p.url); else keyBy.set(c, p.url); }
    for (const q of abiertos) if (q !== p && p.base && q.rama === p.base) unir(q.url, p.url);
  }
  const grupos = new Map<string, PRBoard[]>();
  for (const p of abiertos) { const r = raiz(p.url); grupos.set(r, [...(grupos.get(r) ?? []), p]); }
  return [...grupos.values()].map(lista => {
    const prs = stackOrder(lista);
    const clave = prs.map(keyOf).find(Boolean);
    const nombre = clave ? `shelter-${clave.toLowerCase()}` : `shelter-pr-${prs.slice(0, 4).map(p => p.numero).join('-')}`;
    return { id: clave ?? `pr-${prs[0].numero}`, clave, nombre, prs };
  }).sort((a, b) => a.prs[0].numero - b.prs[0].numero);
}
// de la base hacia arriba: primero los que no van encima de otro del grupo, luego los que van encima de esos…
function stackOrder(prs: PRBoard[]): PRBoard[] {
  const out: PRBoard[] = []; let remain = [...prs].sort((a, b) => a.numero - b.numero);
  while (remain.length) {
    const listos = remain.filter(p => !remain.some(q => q !== p && q.rama === p.base));
    const batch = listos.length ? listos : [remain[0]];   // un ciclo (no debería): se rompe por el más antiguo
    out.push(...batch); remain = remain.filter(p => !batch.includes(p));
  }
  return out;
}


/** El worktree que ya trabaja una tarea: con la rama de uno de sus PR, o con su clave (o sus PR) en el nombre */
export function taskWorktree(g: TaskGroup, worktrees: InfoWorktree[]): InfoWorktree | undefined {
  const ramas = new Set(g.prs.map(p => p.rama));
  const otros = worktrees.filter(w => !w.principal);
  return otros.find(w => ramas.has(w.rama))
    ?? (g.clave ? otros.find(w => path.basename(w.ruta).toLowerCase().includes(g.clave!.toLowerCase())) : undefined)
    ?? otros.find(w => prsOfName(path.basename(w.ruta)).some(n => g.prs.some(p => p.numero === n)));
}

export interface OrganizeStep {
  grupo: TaskGroup;
  ruta: string;                        // donde se trabaja la tarea
  crear: boolean;                      // worktree nuevo
  principal: boolean;                  // una de sus ramas está en la copia principal: se trabaja ahí
  sesion?: string;                     // conversación ya abierta ahí (no se empieza otra)
}
export function planDeSala(sala: { ruta: string; rama?: string; worktrees: InfoWorktree[] }, grupos: TaskGroup[], sesiones: SessionSummary[]): OrganizeStep[] {
  const abiertas = sesiones.filter(s => s.estado !== 'cerrada');
  const dentro = (ruta: string) => abiertas.find(s => { const d = path.resolve(s.worktree ?? s.cwd); return d === ruta || d.startsWith(ruta + path.sep); });
  return grupos.map(grupo => {
    const wt = taskWorktree(grupo, sala.worktrees);
    const principal = !wt && !!sala.rama && grupo.prs.some(p => p.rama === sala.rama);
    const ruta = wt?.ruta ?? (principal ? sala.ruta : path.join(sala.ruta, '.claude', 'worktrees', grupo.nombre));
    // en la copia principal solo cuenta una conversación que esté en ella, no en sus worktrees
    const s = principal ? abiertas.find(x => path.resolve(x.worktree ?? x.cwd) === path.resolve(sala.ruta)) : dentro(ruta);
    return { grupo, ruta, crear: !wt && !principal, principal, sesion: s?.id };
  });
}

/** Lo que recibe la conversación de la tarea */
export function promptTask(g: TaskGroup, repo: string): string {
  const apilado = g.prs.some(p => g.prs.some(q => q.rama === p.base));
  const tarea = g.clave ?? 'PR #' + g.prs.map(p => p.numero).join(', #');
  return [
    g.prs.length === 1 ? t('prompt.task.title.one', { tarea, repo }) : t('prompt.task.title.many', { tarea, n: g.prs.length, repo }),
    '',
    t('prompt.task.onlyThis', { clave: g.clave ? ` (${g.clave})` : '' }) + ' ' + t(apilado ? 'prompt.task.stacked' : 'prompt.task.these'),
    ...g.prs.map((p, i) => t('prompt.task.pr', { i: i + 1, numero: p.numero, titulo: p.titulo, rama: p.rama, base: p.base ? t('prompt.task.onTopOf', { base: p.base }) : '', estado: textoPR(p), url: p.url })),
    '',
    t('prompt.task.howTo'),
    ...(apilado ? [t('prompt.task.rebase')] : []),
    t('prompt.task.noPush'),
  ].join('\n');
}

export interface CtxOrganize {
  git(cwd: string, args: string[]): Promise<string>;
  empezar(salaId: string, cwd: string, prompt: string): Promise<string>;   // id de la sesión
}
/** Crea los worktrees que faltan (con ramas locales que siguen a las del remoto) y empieza las conversaciones que faltan.
 *  Devuelve, por paso, qué se ha hecho (o por qué no). */
export async function applyPlan(ctx: CtxOrganize, sala: { id: string; ruta: string }, pasos: OrganizeStep[], repo: string, remain: () => number): Promise<string[]> {
  const out: string[] = [];
  const ramas = [...new Set(pasos.flatMap(p => p.grupo.prs.map(x => x.rama)))];
  if (pasos.some(p => p.crear)) await ctx.git(sala.ruta, ['fetch', 'origin', ...ramas.map(r => `+refs/heads/${r}:refs/remotes/origin/${r}`)]).catch(() => '');
  const existe = (r: string) => ctx.git(sala.ruta, ['rev-parse', '--verify', '--quiet', `refs/heads/${r}`]).then(() => true, () => false);
  for (const p of pasos) {
    const nombre = p.grupo.clave ?? `PR #${p.grupo.prs[0].numero}`;
    try {
      if (p.crear) {
        // las ramas de la tarea, locales y siguiendo a las del remoto (para poder hacer checkout de cada una)
        for (const x of p.grupo.prs.slice(1)) if (!(await existe(x.rama))) await ctx.git(sala.ruta, ['branch', '--track', x.rama, `origin/${x.rama}`]).catch(() => '');
        const r0 = p.grupo.prs[0].rama;
        mkdirSync(path.dirname(p.ruta), { recursive: true });
        await ctx.git(sala.ruta, (await existe(r0)) ? ['worktree', 'add', p.ruta, r0] : ['worktree', 'add', '--track', '-b', r0, p.ruta, `origin/${r0}`]);
      }
      if (p.sesion) { out.push(p.crear ? t('server.organize.hasConversation', { nombre }) : t('server.organize.hasConversationIn', { nombre, carpeta: path.basename(p.ruta) })); continue; }
      if (remain() <= 0) { out.push(t(p.crear ? 'server.organize.createdNoSession' : 'server.organize.readyNoSession', { nombre })); continue; }
      await ctx.empezar(sala.id, p.ruta, promptTask(p.grupo, repo));
      out.push(p.crear ? t('server.organize.startedNew', { nombre }) : p.principal ? t('server.organize.startedMain', { nombre }) : t('server.organize.startedIn', { nombre, carpeta: path.basename(p.ruta) }));
    } catch (e) {
      out.push(t('server.organize.failed', { nombre, error: String((e as Error).message).split('\n')[0].slice(0, 160) }));
    }
  }
  return out;
}
