// Pre-flight de una tarea (fase 1, solo lectura; el modelo en shared/preflight.ts): junta lo que hay de una tarea en todo
// el refugio. Las salas de repo con sus worktrees, tus PR (los del tablero de despliegue más los abiertos de antes,
// leídos de GitHub a lo sumo una vez por minuto), los bloqueos entre ellos (los manuales de bloqueosPR.ts y el orden
// del plan) y las partes de su plan repartido (planes.ts). De git, solo lectura: la cabeza de cada rama de la tarea,
// sus cambios sin commitear y cuántos commits tiene y le faltan respecto a la cabeza de su PR en GitHub (sin `fetch`:
// si esa cabeza no está en el repo local, faltan commits remotos).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { PRBoard } from '../shared/tablero.ts';
import { bloqueosEntre, type BlockerManual, type TaskOrder } from '../shared/despliegue.ts';
import { preflightTarea, repoChecklist, answered, checklistKey, gateMissing, linkState, type ChecklistAnswer, type CompareRecord, type PartPreflight, type CICheck, type RepoFiles, type LocalBranch, type PlanPart, type TaskPreflight } from '../shared/preflight.ts';
import type { ReviewLedger, ReviewThread } from '../shared/cuentaRevisiones.ts';
import { pRTask, taskKey, worktreeTask } from '../shared/tareas.ts';
import type { RoomPR } from './revisionesPR.ts';
import { t } from '../shared/idioma.ts';

type Git = (cwd: string, args: string[]) => Promise<string>;
export interface DataPRs { prs: PRBoard[]; demo?: boolean; error?: string }

export interface CtxPreflight {
  prs(forzar: boolean): Promise<DataPRs>;
  prsTarea?(clave: string, forzar: boolean): Promise<PRBoard[]>;   // the ones naming the task at any age (a task merged weeks ago)
  salas(): Promise<RoomPR[]>;
  manuales(): BlockerManual[];
  orden(): Promise<TaskOrder[]>;
  plan(clave: string): PlanPart[] | undefined;
  color(clave: string): string | undefined;
  compares(): Promise<CompareRecord[]>;
  revisiones(url: string): { ledger?: ReviewLedger; hilos?: ReviewThread[] };   // de la última vuelta de revisionesPR.ts
  ciChecks(url: string): CICheck[] | undefined;   // de la última vuelta de fallosCI.ts
  checklist(): { items: string[]; respuestas: (clave: string) => Record<string, Record<string, ChecklistAnswer>> };
  git: Git;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const quiet = (p: Promise<string>) => p.then(s => s.trim()).catch(() => '');

/** Las ramas de la tarea en cada sala: los worktrees de la tarea (por su nombre o su rama) y los que tienen sacada la
 *  rama de uno de sus PR, y las ramas locales de sus PR que no están sacadas en ninguno; cada una frente a su PR */
export async function localBranches(clave: string, prs: PRBoard[], salas: RoomPR[], git: Git): Promise<LocalBranch[]> {
  const K = taskKey(clave) ?? clave;
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
  const K = taskKey(clave);
  if (!K) throw new Error(t('server.notATaskKey', { clave: clave.slice(0, 40) }));
  const [todos, deLaTarea, salas, orden] = await Promise.all([ctx.prs(forzar), ctx.prsTarea?.(K, forzar).catch(() => [] as PRBoard[]) ?? [], ctx.salas(), ctx.orden().catch(() => [] as TaskOrder[])]);
  const gh = { ...todos, prs: [...new Map([...deLaTarea, ...todos.prs].map(p => [p.url, p])).values()] };
  // lo que queda por contestar en sus revisiones, como en el tablero de despliegue
  const prs = gh.demo ? gh.prs : gh.prs.map(p => { const l = ctx.revisiones(p.url).ledger; return l ? { ...p, ledger: l } : p; });
  const hilos = Object.fromEntries(prs.map(p => [p.url, ctx.revisiones(p.url).hilos ?? []]));
  const [locales, compares] = await Promise.all([localBranches(K, prs, salas, ctx.git), ctx.compares().catch(() => [] as CompareRecord[])]);
  const worktrees = [...new Set(locales.map(l => l.worktree).filter((w): w is string => !!w))];
  const repoItems = Object.fromEntries(await Promise.all(worktrees.map(async w => [w, await repoChecks(w)] as const)));
  const ciChecks = Object.fromEntries(prs.map(p => [p.url, ctx.ciChecks(p.url) ?? []]));
  const lista = ctx.checklist();
  return preflightTarea(K, {
    prs, bloqueos: bloqueosEntre(prs, ctx.manuales(), orden), locales, compares, hilos,
    checklist: { items: lista.items, respuestas: lista.respuestas(K) }, repoChecklist: repoItems, ciChecks,
    salas: salas.map(s => ({ id: s.id, nombre: s.nombre, repo: s.repo })),
    plan: ctx.plan(K), color: ctx.color(K), demo: gh.demo, error: gh.error,
  });
}

/** Lo que el repo de un worktree pide comprobar antes de subir (shared/preflight.ts: repoChecklist): solo se leen sus
 *  archivos, nada se ejecuta */
export async function repoChecks(worktree: string): Promise<string[]> {
  const leer = (f: string) => fs.readFile(path.join(worktree, f), 'utf8').then(x => x.slice(0, 200_000), () => undefined);
  const skillsDir = path.join(worktree, '.claude', 'skills');
  const skills = await Promise.all((await fs.readdir(skillsDir).catch(() => [] as string[])).slice(0, 60).map(async n => {
    const md = await fs.readFile(path.join(skillsDir, n, 'SKILL.md'), 'utf8').catch(() => '');
    const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
    return md ? { nombre: /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, '') || n, descripcion: /^description:\s*(.+)$/m.exec(fm)?.[1]?.slice(0, 400) } : null;
  }));
  const f: RepoFiles = {
    claudeMd: [await leer('CLAUDE.md'), await leer('.claude/CLAUDE.md')].filter(Boolean).join('\n\n'),
    agentsMd: await leer('AGENTS.md'),
    skills: skills.filter((x): x is NonNullable<typeof x> => !!x),
    packageJson: await leer('package.json'), makefile: await leer('Makefile'),
    precommit: existsSync(path.join(worktree, '.pre-commit-config.yaml')),
  };
  return repoChecklist(f);
}

/** The PRs naming one task, read at most once a minute per task (the last 30 tasks) */
export function cachedTaskPRs(leer: (clave: string) => Promise<PRBoard[]>, ttl = 60_000) {
  const porTarea = new Map<string, ReturnType<typeof cachedPRs>>();
  return async (clave: string, forzar = false) => {
    let f = porTarea.get(clave);
    if (!f) { f = cachedPRs(async () => ({ prs: await leer(clave) }), ttl); porTarea.set(clave, f); if (porTarea.size > 30) porTarea.delete(porTarea.keys().next().value!); }
    return (await f(forzar)).prs;
  };
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

/** Lo que el Supervisor hace con cada página de comparación (validarla o mandarle notas), guardado en el servidor
 *  (DATOS/preflight.json) para atarlo al commit de la página (su `<página>.json`, server/comparar.ts). El cliente sigue
 *  llevando la suya por conversación (Navegadores.tsx): esta es la que cuenta para el pre-flight */
export class PageReviews {
  private respuestas: Record<string, { estado: 'validada' | 'notas'; ts: number }> = {};
  // lo que contesta el habitante a la lista «antes de subir»: por tarea, `${worktree}|${head}` y punto
  private checklist: Record<string, Record<string, Record<string, ChecklistAnswer>>> = {};
  private archivo: string;
  constructor(dir: string, private carpeta: string) {
    this.archivo = path.join(dir, 'preflight.json');
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); this.respuestas = j.respuestas ?? {}; this.checklist = j.checklist ?? {}; } } catch { this.respuestas = {}; }
    // answers to compare pages that no longer exist (cleanCompares removes them after 14 days) are dropped, once at startup
    this.respuestas = Object.fromEntries(Object.entries(this.respuestas).filter(([k]) => existsSync(k)));
  }
  private guardar() {
    this.respuestas = Object.fromEntries(Object.entries(this.respuestas).sort((a, b) => b[1].ts - a[1].ts).slice(0, 500));
    // the checklist keeps the 60 most recent tasks and, in each, the answers for its 30 most recent commits (worktree and HEAD)
    const reciente = (x: Record<string, Record<string, ChecklistAnswer>>) => Math.max(0, ...Object.values(x).flatMap(r => Object.values(r).map(a => a.ts)));
    this.checklist = Object.fromEntries(Object.entries(this.checklist).sort((a, b) => reciente(b[1]) - reciente(a[1])).slice(0, 60)
      .map(([k, porCommit]) => [k, Object.fromEntries(Object.entries(porCommit).sort((a, b) => reciente({ b: b[1] }) - reciente({ a: a[1] })).slice(0, 30))]));
    const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ respuestas: this.respuestas, checklist: this.checklist }), { mode: 0o600 }); renameSync(tmp, this.archivo);
  }
  /** Solo las páginas de comparación (las de la carpeta, con su `.json`); lo demás no cuenta y se ignora */
  responder(ruta: unknown, estado: unknown): boolean {
    const r = path.resolve(String(ruta ?? ''));
    if (path.dirname(r) !== path.resolve(this.carpeta) || !r.endsWith('.html') || !existsSync(r.replace(/\.html$/, '.json'))) return false;
    if (estado !== 'validada' && estado !== 'notas') return false;
    this.respuestas[r] = { estado, ts: Date.now() };
    this.guardar();
    return true;
  }
  /** Lo contestado de la lista en una tarea, por `${worktree}|${head}` */
  checklistOf(clave: string) { return this.checklist[clave.toUpperCase()] ?? {}; }
  /** El habitante contesta un punto para el commit actual de su worktree */
  contestar(clave: string, worktree: string, head: string, item: string, a: Omit<ChecklistAnswer, 'ts'>) {
    const K = clave.toUpperCase(), k = checklistKey(path.resolve(worktree), head);
    ((this.checklist[K] ??= {})[k] ??= {})[item] = { estado: a.estado, nota: a.nota?.trim().slice(0, 1000) || undefined, ts: Date.now() };
    this.guardar();
  }
  /** Las comparaciones de la carpeta, con su respuesta */
  async compares(): Promise<CompareRecord[]> {
    const nombres = await fs.readdir(this.carpeta).catch(() => [] as string[]);
    const out: CompareRecord[] = [];
    await Promise.all(nombres.filter(n => n.endsWith('.json')).map(async n => {
      const archivo = path.join(path.resolve(this.carpeta), n.replace(/\.json$/, '.html'));
      try {
        const j = JSON.parse(await fs.readFile(path.join(this.carpeta, n), 'utf8'));
        if (!Array.isArray(j?.partes) || !existsSync(archivo)) return;
        out.push({ archivo, ts: Number(j.ts) || 0, respuesta: this.respuestas[archivo],
          partes: j.partes.filter((x: any) => x && typeof x.worktree === 'string').map((x: any) => ({ worktree: path.resolve(x.worktree), rama: String(x.rama ?? ''), head: String(x.head ?? ''), base: x.base ? String(x.base) : undefined })) });
      } catch {}
    }));
    return out;
  }
}

/** La parte de la tarea en la que trabaja una carpeta (un worktree de tarea): su clave por el nombre o la rama del
 *  worktree. Sin tarea, null (la puerta no se aplica y las herramientas lo dicen) */
export async function partOfFolder(cwd: string, ctx: CtxPreflight): Promise<{ clave: string; parte: PartPreflight; r: TaskPreflight } | null> {
  const raiz = (await ctx.git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
  if (!raiz) return null;
  const rama = (await ctx.git(raiz, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const clave = worktreeTask({ ruta: raiz, rama });
  if (!clave) return null;
  const r = await preflightOf(clave, ctx);
  const ruta = path.resolve(raiz);
  const parte = r.partes.find(p => p.worktree === ruta && p.rama === rama) ?? r.partes.find(p => p.worktree === ruta);
  return parte ? { clave: r.clave, parte, r } : null;
}

/** La puerta de `git push` en una carpeta: lo que falta (vacío: puede subir; null: no es una parte de tarea) */
export async function gatePush(cwd: string, ctx: CtxPreflight): Promise<{ clave: string; rama?: string; head?: string; falta: string[] } | null> {
  const x = await partOfFolder(cwd, ctx).catch(() => null);
  return x && { clave: x.clave, rama: x.parte.rama, head: x.parte.headLocal, falta: gateMissing(x.parte) };
}

/** Lo que ve el habitante con preflight_status: su parte, cada columna, la lista con lo contestado y los bloqueos */
export function textState(x: { clave: string; parte: PartPreflight; r: TaskPreflight }): string {
  const p = x.parte, c = (n: string, v: { marca: string; texto: string }) => `- ${n}: ${{ ok: '✓', aviso: '⚠', mal: '✗', nada: '—' }[v.marca as 'ok']} ${v.texto}`;
  const falta = gateMissing(p);
  const todos = [...x.r.checklist, ...p.repoItems.filter(i => !x.r.checklist.includes(i))];
  return [
    t('tool.preflight.heading', { clave: x.clave, sala: p.sala ?? '', rama: p.rama ?? '', head: (p.headLocal ?? '').slice(0, 7) }),
    c('Compare', p.compare), c(t('preflight.col.checklist'), p.checklist), c(t('preflight.col.sync'), p.sync), c('CI', p.ci), c(t('preflight.col.review'), p.revision), c(t('preflight.col.blockers'), p.bloqueos),
    '',
    t('tool.preflight.items'),
    ...(todos.length ? todos.map((it, i) => { const a = p.respuestas?.[it]; return `${i + 1}. [${answered(a) ? a!.estado : a?.estado ?? ' '}] ${it}${a?.nota ? ` — ${a.nota}` : ''}`; }) : [t('tool.preflight.noItems')]),
    ...(p.ciChecks.length ? ['', t('tool.preflight.ciChecks'), ...p.ciChecks.map(c => `- ${{ ok: '✓', mal: '✗', pendiente: '…' }[c.estado]} ${c.nombre}`)] : []),
    ...(p.esperaA.length ? ['', t('tool.preflight.waits', { prs: p.esperaA.map(l => `${l.url ? l.ref : l.sala} (${linkState(l)})`).join(', ') })] : []),
    ...(p.hilos.length ? ['', t('tool.preflight.threads', { n: p.hilos.length }), ...p.hilos.map(h => `- ${h.archivo}${h.linea ? ':' + h.linea : ''} ${h.autor}: ${h.texto} (${h.url})`)] : []),
    '',
    falta.length ? t('tool.preflight.missing', { que: falta.join('; ') }) : t('tool.preflight.ready'),
  ].join('\n');
}

/** The dweller's tools (in the `review` MCP): read its pre-flight and answer the checklist for its commit */
export function preflightTools(ctx: CtxPreflight, guardar: (clave: string, worktree: string, head: string, item: string, a: Omit<ChecklistAnswer, 'ts'>) => void) {
  return {
    async estado(cwd: string): Promise<string> {
      const x = await partOfFolder(cwd, ctx);
      return x ? textState(x) : t('tool.preflight.noTask');
    },
    async responder(cwd: string, item: string, estado: ChecklistAnswer['estado'], nota?: string): Promise<string> {
      const x = await partOfFolder(cwd, ctx);
      if (!x || !x.parte.worktree || !x.parte.headLocal) return t('tool.preflight.noTask');
      const items = [...x.r.checklist, ...x.parte.repoItems.filter(i => !x.r.checklist.includes(i))];
      const n = Number(item);
      const punto = Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : items.find(i => i.toLowerCase() === String(item).trim().toLowerCase());
      if (!punto) return t('tool.preflight.noSuchItem', { item: String(item).slice(0, 80), lista: items.map((x, i) => `${i + 1}. ${x}`).join(' · ') || '—' });
      if (estado === 'n/a' && !nota?.trim()) return t('tool.preflight.naNeedsNote');
      guardar(x.clave, x.parte.worktree, x.parte.headLocal, punto, { estado, nota });
      return t('tool.preflight.saved', { item: punto, estado, head: x.parte.headLocal.slice(0, 7) });
    },
  };
}
