// Pre-flight de una tarea (fase 1, solo lectura; el modelo en shared/preflight.ts): junta lo que hay de una tarea en todo
// el refugio. Las salas de repo con sus worktrees, tus PR (los del tablero de despliegue más los abiertos de antes,
// leídos de GitHub a lo sumo una vez por minuto), los bloqueos entre ellos (los manuales de prBlocks.ts y el orden
// del plan) y las partes de su plan repartido (plans.ts). De git, solo lectura: la cabeza de cada rama de la tarea,
// sus cambios sin commitear y cuántos commits tiene y le faltan respecto a la cabeza de su PR en GitHub (sin `fetch`:
// si esa cabeza no está en el repo local, faltan commits remotos).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { PRBoard } from '../shared/board.ts';
import { blockersBetween, type BlockerManual, type TaskOrder } from '../shared/deploy.ts';
import { preflightTask, repoChecklist, answered, checklistKey, gateMissing, linkState, type ChecklistAnswer, type CompareRecord, type PartPreflight, type CICheck, type RepoFiles, type LocalBranch, type PlanPart, type TaskPreflight } from '../shared/preflight.ts';
import type { ReviewLedger, ReviewThread } from '../shared/reviewCount.ts';
import { branchTask, pRTask, taskKey, worktreeTask } from '../shared/tasks.ts';
import type { RoomPR } from './prReviews.ts';
import { t } from '../shared/language.ts';
import type { TaskTracker, VerificationPlan } from '../shared/verification.ts';

type Git = (cwd: string, args: string[]) => Promise<string>;
export interface DataPRs { prs: PRBoard[]; demo?: boolean; error?: string }

export interface CtxPreflight {
  prs(force: boolean): Promise<DataPRs>;
  taskPrs?(key: string, force: boolean): Promise<PRBoard[]>;   // the ones naming the task at any age (a task merged weeks ago)
  rooms(): Promise<RoomPR[]>;
  manual(): BlockerManual[];
  orden(): Promise<TaskOrder[]>;
  plan(key: string): PlanPart[] | undefined;
  verification?(key: string): VerificationPlan | undefined;   // its production verification plan (verifications.ts)
  tracker?(key: string): Promise<TaskTracker | undefined>;     // its status in the tracker, with its board's setup (verificationBoards.ts)
  color(key: string): string | undefined;
  compares(): Promise<CompareRecord[]>;
  reviews(url: string): { ledger?: ReviewLedger; threads?: ReviewThread[] };   // de la última vuelta de prReviews.ts
  ciChecks(url: string): CICheck[] | undefined;   // de la última vuelta de ciFailures.ts
  checklist(): { items: string[]; answers: (key: string) => Record<string, Record<string, ChecklistAnswer>> };
  git: Git;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const quiet = (p: Promise<string>) => p.then(s => s.trim()).catch(() => '');

/** Las ramas de la tarea en cada sala: los worktrees de la tarea (por su nombre o su rama) y los que tienen sacada la
 *  rama de uno de sus PR, y las ramas locales de sus PR que no están sacadas en ninguno; cada una frente a su PR */
export async function localBranches(key: string, prs: PRBoard[], rooms: RoomPR[], git: Git): Promise<LocalBranch[]> {
  const K = taskKey(key) ?? key;
  const taskPrs = prs.filter(p => p.state !== 'closed' && pRTask(p) === K);
  const out: LocalBranch[] = [];
  await Promise.all(rooms.map(async s => {
    const theirs = taskPrs.filter(p => sameRepo(p.repo, s.repo));
    const branches = new Set(theirs.map(p => p.branch));
    const checkedOut = new Set<string>();
    const wts = s.worktrees.length ? s.worktrees : [{ path: s.path, branch: s.branch ?? '' }];
    await Promise.all(wts.map(async w => {
      if (!w.branch || (worktreeTask(w) !== K && !branches.has(w.branch))) return;
      checkedOut.add(w.branch);
      const [head, state] = await Promise.all([quiet(git(w.path, ['rev-parse', 'HEAD'])), quiet(git(w.path, ['status', '--porcelain']))]);
      out.push({ roomId: s.id, branch: w.branch, head: head || undefined, worktree: path.resolve(w.path), changes: state.split('\n').filter(Boolean).length });
    }));
    await Promise.all([...branches].filter(r => !checkedOut.has(r)).map(async branch => {
      const head = await quiet(git(s.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`]));
      if (head) out.push({ roomId: s.id, branch, head });
    }));
    // frente a la cabeza de su PR en GitHub
    await Promise.all(out.filter(l => l.roomId === s.id && l.head).map(async l => {
      const head = theirs.find(p => p.branch === l.branch)?.head;
      if (!head || head === l.head) return;
      const exists = await git(s.path, ['cat-file', '-e', `${head}^{commit}`]).then(() => true, () => false);
      if (!exists) { l.headless = true; return; }
      const [a, b] = (await quiet(git(s.path, ['rev-list', '--left-right', '--count', `${l.head}...${head}`]))).split(/\s+/).map(Number);
      l.ahead = a || 0; l.behind = b || 0;
    }));
  }));
  return out.sort((a, b) => a.roomId.localeCompare(b.roomId) || a.branch.localeCompare(b.branch));
}

/** El pre-flight de una tarea, con todo lo del refugio */
export async function preflightOf(key: string, ctx: CtxPreflight, force = false): Promise<TaskPreflight> {
  const K = taskKey(key);
  if (!K) throw new Error(t('server.notATaskKey', { key: key.slice(0, 40) }));
  const [all, taskPrs, rooms, orden] = await Promise.all([ctx.prs(force), ctx.taskPrs?.(K, force).catch(() => [] as PRBoard[]) ?? [], ctx.rooms(), ctx.orden().catch(() => [] as TaskOrder[])]);
  const gh = { ...all, prs: [...new Map([...taskPrs, ...all.prs].map(p => [p.url, p])).values()] };
  // lo que queda por contestar en sus revisiones, como en el tablero de despliegue
  const prs = gh.demo ? gh.prs : gh.prs.map(p => { const l = ctx.reviews(p.url).ledger; return l ? { ...p, ledger: l } : p; });
  const threads = Object.fromEntries(prs.map(p => [p.url, ctx.reviews(p.url).threads ?? []]));
  const [local, compares] = await Promise.all([localBranches(K, prs, rooms, ctx.git), ctx.compares().catch(() => [] as CompareRecord[])]);
  const worktrees = [...new Set(local.map(l => l.worktree).filter((w): w is string => !!w))];
  const repoItems = Object.fromEntries(await Promise.all(worktrees.map(async w => [w, await repoChecks(w)] as const)));
  const ciChecks = Object.fromEntries(prs.map(p => [p.url, ctx.ciChecks(p.url) ?? []]));
  const list = ctx.checklist();
  const verification = ctx.verification?.(K), tracker = await ctx.tracker?.(K).catch(() => undefined);
  const r = preflightTask(K, {
    prs, blockers: blockersBetween(prs, ctx.manual(), orden), local, compares, threads,
    checklist: { items: list.items, answers: list.answers(K) }, repoChecklist: repoItems, ciChecks,
    rooms: rooms.map(s => ({ id: s.id, name: s.name, repo: s.repo })),
    plan: ctx.plan(K), color: ctx.color(K), demo: gh.demo, error: gh.error, verification,
  });
  return tracker ? { ...r, tracker } : r;
}

/** Lo que el repo de un worktree pide comprobar antes de subir (shared/preflight.ts: repoChecklist): solo se leen sus
 *  archivos, nada se ejecuta */
export async function repoChecks(worktree: string): Promise<string[]> {
  const read = (f: string) => fs.readFile(path.join(worktree, f), 'utf8').then(x => x.slice(0, 200_000), () => undefined);
  const skillsDir = path.join(worktree, '.claude', 'skills');
  const skills = await Promise.all((await fs.readdir(skillsDir).catch(() => [] as string[])).slice(0, 60).map(async n => {
    const md = await fs.readFile(path.join(skillsDir, n, 'SKILL.md'), 'utf8').catch(() => '');
    const fm = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? '';
    return md ? { name: /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, '') || n, description: /^description:\s*(.+)$/m.exec(fm)?.[1]?.slice(0, 400) } : null;
  }));
  const f: RepoFiles = {
    claudeMd: [await read('CLAUDE.md'), await read('.claude/CLAUDE.md')].filter(Boolean).join('\n\n'),
    agentsMd: await read('AGENTS.md'),
    skills: skills.filter((x): x is NonNullable<typeof x> => !!x),
    packageJson: await read('package.json'), makefile: await read('Makefile'),
    precommit: existsSync(path.join(worktree, '.pre-commit-config.yaml')),
  };
  return repoChecklist(f);
}

/** The PRs naming one task, read at most once a minute per task (the last 30 tasks) */
export function cachedTaskPRs(read: (key: string) => Promise<PRBoard[]>, ttl = 60_000) {
  const byTask = new Map<string, ReturnType<typeof cachedPRs>>();
  return async (key: string, force = false) => {
    let f = byTask.get(key);
    if (!f) { f = cachedPRs(async () => ({ prs: await read(key) }), ttl); byTask.set(key, f); if (byTask.size > 30) byTask.delete(byTask.keys().next().value!); }
    return (await f(force)).prs;
  };
}

/** Tus PR para el pre-flight: los del tablero (dos semanas) y todos los abiertos, una lectura por minuto como mucho */
export function cachedPRs(read: () => Promise<DataPRs>, ttl = 60_000) {
  let last: { ts: number; p: Promise<DataPRs> } | null = null;
  return (force = false) => {
    if (!last || force || Date.now() - last.ts > ttl) {
      const p = read().catch(e => { last = null; throw e; });
      last = { ts: Date.now(), p };
    }
    return last.p;
  };
}

/** Lo que el Supervisor hace con cada página de comparación (validarla o mandarle notas), guardado en el servidor
 *  (DATOS/preflight.json) para atarlo al commit de la página (su `<página>.json`, server/compare.ts). El cliente sigue
 *  llevando la suya por conversación (Browsers.tsx): esta es la que cuenta para el pre-flight */
export class PageReviews {
  private answers: Record<string, { state: 'validated' | 'notes'; ts: number }> = {};
  // lo que contesta el habitante a la lista «antes de subir»: por tarea, `${worktree}|${head}` y punto
  private checklist: Record<string, Record<string, Record<string, ChecklistAnswer>>> = {};
  private file: string;
  constructor(dir: string, private folder: string) {
    this.file = path.join(dir, 'preflight.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); this.answers = j.answers ?? {}; this.checklist = j.checklist ?? {}; } } catch { this.answers = {}; }
    // answers to compare pages that no longer exist (cleanCompares removes them after 14 days) are dropped, once at startup
    this.answers = Object.fromEntries(Object.entries(this.answers).filter(([k]) => existsSync(k)));
  }
  private save() {
    this.answers = Object.fromEntries(Object.entries(this.answers).sort((a, b) => b[1].ts - a[1].ts).slice(0, 500));
    // the checklist keeps the 60 most recent tasks and, in each, the answers for its 30 most recent commits (worktree and HEAD)
    const latest = (x: Record<string, Record<string, ChecklistAnswer>>) => Math.max(0, ...Object.values(x).flatMap(r => Object.values(r).map(a => a.ts)));
    this.checklist = Object.fromEntries(Object.entries(this.checklist).sort((a, b) => latest(b[1]) - latest(a[1])).slice(0, 60)
      .map(([k, byCommit]) => [k, Object.fromEntries(Object.entries(byCommit).sort((a, b) => latest({ b: b[1] }) - latest({ a: a[1] })).slice(0, 30))]));
    const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ answers: this.answers, checklist: this.checklist }), { mode: 0o600 }); renameSync(tmp, this.file);
  }
  /** Solo las páginas de comparación (las de la carpeta, con su `.json`); lo demás no cuenta y se ignora */
  respond(filePath: unknown, state: unknown): boolean {
    const r = path.resolve(String(filePath ?? ''));
    if (path.dirname(r) !== path.resolve(this.folder) || !r.endsWith('.html') || !existsSync(r.replace(/\.html$/, '.json'))) return false;
    if (state !== 'validated' && state !== 'notes') return false;
    this.answers[r] = { state, ts: Date.now() };
    this.save();
    return true;
  }
  /** Lo contestado de la lista en una tarea, por `${worktree}|${head}` */
  checklistOf(key: string) { return this.checklist[key.toUpperCase()] ?? {}; }
  /** El habitante contesta un punto para el commit actual de su worktree */
  answer(key: string, worktree: string, head: string, item: string, a: Omit<ChecklistAnswer, 'ts'>) {
    const K = key.toUpperCase(), k = checklistKey(path.resolve(worktree), head);
    ((this.checklist[K] ??= {})[k] ??= {})[item] = { state: a.state, note: a.note?.trim().slice(0, 1000) || undefined, ts: Date.now() };
    this.save();
  }
  /** Las comparaciones de la carpeta, con su respuesta */
  async compares(): Promise<CompareRecord[]> {
    const names = await fs.readdir(this.folder).catch(() => [] as string[]);
    const out: CompareRecord[] = [];
    await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => {
      const file = path.join(path.resolve(this.folder), n.replace(/\.json$/, '.html'));
      try {
        const j = JSON.parse(await fs.readFile(path.join(this.folder, n), 'utf8'));
        if (!Array.isArray(j?.parts) || !existsSync(file)) return;
        out.push({ file, ts: Number(j.ts) || 0, answer: this.answers[file],
          parts: j.parts.filter((x: any) => x && typeof x.worktree === 'string').map((x: any) => ({ worktree: path.resolve(x.worktree), branch: String(x.branch ?? ''), head: String(x.head ?? ''), base: x.base ? String(x.base) : undefined })) });
      } catch {}
    }));
    return out;
  }
}

/** La parte de la tarea en la que trabaja una carpeta (un worktree de tarea): su clave por el nombre o la rama del
 *  worktree. Sin tarea, null (la puerta no se aplica y las herramientas lo dicen) */
export async function partOfFolder(cwd: string, ctx: CtxPreflight): Promise<{ key: string; part: PartPreflight; r: TaskPreflight } | null> {
  const root = (await ctx.git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
  if (!root) return null;
  const branch = (await ctx.git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  const key = worktreeTask({ path: root, branch });
  if (!key) return null;
  const r = await preflightOf(key, ctx);
  const filePath = path.resolve(root);
  const part = r.parts.find(p => p.worktree === filePath && p.branch === branch) ?? r.parts.find(p => p.worktree === filePath);
  return part ? { key: r.key, part, r } : null;
}

/** The task part whose branch is this one (`origin/` dropped), wherever it is checked out: what a merge in a main copy
 *  merges. Null if the branch names no task or the task has no such part */
export async function partOfBranch(branch: string, ctx: CtxPreflight): Promise<{ key: string; part: PartPreflight; r: TaskPreflight } | null> {
  const b = branch.replace(/^(refs\/remotes\/)?origin\//, '');
  const key = branchTask(b);
  if (!key) return null;
  const r = await preflightOf(key, ctx);
  const part = r.parts.find(p => p.branch === b) ?? r.parts.find(p => p.pr?.branch === b);
  return part ? { key: r.key, part, r } : null;
}

/** La puerta de `git push` en una carpeta: lo que falta (vacío: puede subir; null: no es una parte de tarea). With
 *  `branch`, a folder that is no task part (a main copy) is gated as that branch's part, the one being merged */
export async function gatePush(cwd: string, ctx: CtxPreflight, branch?: string): Promise<{ key: string; branch?: string; head?: string; base?: string; missing: string[] } | null> {
  const x = await partOfFolder(cwd, ctx).catch(() => null) ?? (branch ? await partOfBranch(branch, ctx).catch(() => null) : null);
  return x && { key: x.key, branch: x.part.branch, head: x.part.headLocal, base: x.part.pr?.base, missing: gateMissing(x.part) };
}

/** Lo que ve el habitante con preflight_status: su parte, cada columna, la lista con lo contestado y los bloqueos */
export function textState(x: { key: string; part: PartPreflight; r: TaskPreflight }): string {
  const p = x.part, c = (n: string, v: { mark: string; text: string }) => `- ${n}: ${{ ok: '✓', notice: '⚠', fail: '✗', none: '—' }[v.mark as 'ok']} ${v.text}`;
  const missing = gateMissing(p);
  const all = [...x.r.checklist, ...p.repoItems.filter(i => !x.r.checklist.includes(i))];
  return [
    t('tool.preflight.heading', { key: x.key, room: p.room ?? '', branch: p.branch ?? '', head: (p.headLocal ?? '').slice(0, 7) }),
    c('Compare', p.compare), c(t('preflight.col.checklist'), p.checklist), c(t('preflight.col.sync'), p.sync), c('CI', p.ci), c(t('preflight.col.review'), p.review), c(t('preflight.col.blockers'), p.blockers),
    '',
    t('tool.preflight.items'),
    ...(all.length ? all.map((it, i) => { const a = p.answers?.[it]; return `${i + 1}. [${answered(a) ? a!.state : a?.state ?? ' '}] ${it}${a?.note ? ` — ${a.note}` : ''}`; }) : [t('tool.preflight.noItems')]),
    ...(p.ciChecks.length ? ['', t('tool.preflight.ciChecks'), ...p.ciChecks.map(c => `- ${{ ok: '✓', bad: '✗', pending: '…' }[c.state]} ${c.name}`)] : []),
    ...(p.waitsOn.length ? ['', t('tool.preflight.waits', { prs: p.waitsOn.map(l => `${l.url ? l.ref : l.room} (${linkState(l)})`).join(', ') })] : []),
    ...(p.threads.length ? ['', t('tool.preflight.threads', { n: p.threads.length }), ...p.threads.map(h => `- ${h.file}${h.line ? ':' + h.line : ''} ${h.author}: ${h.text} (${h.url})`)] : []),
    '',
    missing.length ? t('tool.preflight.missing', { what: missing.join('; ') }) : t('tool.preflight.ready'),
  ].join('\n');
}

/** The dweller's tools (in the `review` MCP): read its pre-flight and answer the checklist for its commit */
export function preflightTools(ctx: CtxPreflight, save: (key: string, worktree: string, head: string, item: string, a: Omit<ChecklistAnswer, 'ts'>) => void) {
  return {
    async state(cwd: string): Promise<string> {
      const x = await partOfFolder(cwd, ctx);
      return x ? textState(x) : t('tool.preflight.noTask');
    },
    async respond(cwd: string, item: string, state: ChecklistAnswer['state'], note?: string): Promise<string> {
      const x = await partOfFolder(cwd, ctx);
      if (!x || !x.part.worktree || !x.part.headLocal) return t('tool.preflight.noTask');
      const items = [...x.r.checklist, ...x.part.repoItems.filter(i => !x.r.checklist.includes(i))];
      const n = Number(item);
      const point = Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : items.find(i => i.toLowerCase() === String(item).trim().toLowerCase());
      if (!point) return t('tool.preflight.noSuchItem', { item: String(item).slice(0, 80), list: items.map((x, i) => `${i + 1}. ${x}`).join(' · ') || '—' });
      if (state === 'n/a' && !note?.trim()) return t('tool.preflight.naNeedsNote');
      save(x.key, x.part.worktree, x.part.headLocal, point, { state, note });
      return t('tool.preflight.saved', { item: point, state: state, head: x.part.headLocal.slice(0, 7) });
    },
  };
}
