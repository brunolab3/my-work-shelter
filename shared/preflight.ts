// Pre-flight de una tarea (fase 1, solo lectura): de un vistazo, cómo va cada parte de una tarea de Jira en todos los
// repos del refugio. Una tarea repartida por Logística tiene partes en varias salas (un worktree por parte); cada parte
// es un PR (o un worktree sin PR aún, o una parte del plan sin empezar). Por parte: si la copia local está al día con
// GitHub (un bot puede haber empujado arreglos), la CI, la revisión y a qué espera o a quién bloquea (los bloqueos
// entre PR de shared/deploy.ts, también de otros repos). La CI roja de un PR al que se espera es problema de ese PR,
// no de esta parte: aquí solo sale como su estado. Luego, las olas en que se puede fusionar lo de la tarea.
// Puro: lo usan el cliente, el servidor (server/preflight.ts) y las pruebas.
import type { PRBoard } from './board';
import { deployWaves, refPR, type Blocker, type BlockerReason } from './deploy';
import { pRTask, taskKey } from './tasks';
import { t } from './language';
import { ledgerPending, type ReviewThread } from './reviewCount';
import type { TaskTracker, VerificationPlan } from './verification';

/** ✓ listo, ⚠ mirar, ✗ falta, — no aplica */
export type Mark = 'ok' | 'aviso' | 'mal' | 'nada';
export interface Cell { mark: Mark; text: string }

/** Una rama de la tarea en el repo de una sala: sacada en un worktree (`worktree`, con sus cambios sin commitear) o
 *  solo como rama local. `adelante`/`detras`: commits que tiene y no tiene respecto a la cabeza de su PR en GitHub;
 *  `headless`: esa cabeza no está en el repo local (no se ha traído: hay commits remotos que faltan) */
export interface LocalBranch {
  roomId: string; branch: string; head?: string;
  worktree?: string; changes?: number;
  ahead?: number; behind?: number; headless?: boolean;
}
export interface RoomRepo { id: string; name: string; repo?: string }
/** A compare page (server/compare.ts, its `<page>.json`) with what the Overseer did with it: which worktree, branch
 *  and commit each part is */
export interface CompareRecord {
  file: string; ts: number;
  parts: { worktree: string; branch: string; head: string; base?: string }[];
  answer?: { state: 'validada' | 'notas'; ts: number };
}
/** Un check de GitHub del último commit de un PR (server/ciFailures.ts) */
export interface CICheck { name: string; state: 'ok' | 'mal' | 'pendiente' }
/** Lo que contesta el habitante a un punto de la lista «antes de subir» del Supervisor, para un commit */
export interface ChecklistAnswer { state: 'ok' | 'n/a' | 'pendiente'; note?: string; ts: number }
export interface PlanPart { roomId: string; room: string; title: string; waitA?: string[] }

/** A qué espera una parte o a quién bloquea: otro PR (de esta tarea o no) o, sin PR aún, una sala del plan */
export interface PartLink { ref: string; url?: string; title?: string; state?: PRBoard['state']; checks?: PRBoard['checks']; reason: BlockerReason; room?: string }

export interface PartPreflight {
  id: string;
  roomId?: string; room?: string; repo?: string;
  worktree?: string; branch?: string; headLocal?: string; changes?: number;
  pr?: PRBoard;
  plan?: string;                 // el título de su parte en el plan repartido
  notStarted?: boolean;          // parte del plan sin worktree ni PR
  sync: Cell; ci: Cell; review: Cell; conflicts: Cell; blockers: Cell; compare: Cell; checklist: Cell;
  answers?: Record<string, ChecklistAnswer>;   // las del commit actual, por punto
  repoItems: string[];           // los puntos que pone su repo (su CLAUDE.md o AGENTS.md, sus skills de comprobación, sus órdenes de comprobación)
  ciChecks: CICheck[];           // cada check de GitHub de su PR, solo (no lo contesta el habitante)
  compareFile?: string;       // la página que cuenta para esta parte (la más reciente con su worktree y rama)
  threads: ReviewThread[];         // los hilos de revisión sin resolver de su PR
  waitsOn: PartLink[]; blocks: PartLink[];
}
export interface TaskPreflight {
  key: string; color?: string; title?: string;
  parts: PartPreflight[];
  waves: string[][];              // las olas (refPR) con lo de la tarea y lo que espera, en orden; cada una espera a las anteriores
  cycle: string[];
  checklist: string[];           // los puntos del Supervisor
  verification?: VerificationPlan;   // its production verification plan (shared/verification.ts)
  tracker?: TaskTracker;             // its status in the tracker (server/verificationBoards.ts)
  demo?: boolean; error?: string;
}

export interface PreflightInput {
  prs: PRBoard[];                // todos los del tablero (también los de otras tareas: pueden ser bloqueos)
  blockers: Blocker[];           // blockersBetween(prs, manuales, orden)
  local: LocalBranch[];
  rooms: RoomRepo[];             // las salas de repo, con su repo de GitHub («org/repo»)
  plan?: PlanPart[];
  compares?: CompareRecord[];
  threads?: Record<string, ReviewThread[]>;   // por URL del PR (server/prReviews.ts)
  checklist?: { items: string[]; answers: Record<string, Record<string, ChecklistAnswer>> };   // respuestas por `${worktree}|${head}`
  repoChecklist?: Record<string, string[]>;   // los puntos del repo, por worktree (server/preflight.ts: repoChecks)
  ciChecks?: Record<string, CICheck[]>;       // los checks de cada PR, por URL
  verification?: VerificationPlan;
  color?: string; title?: string; demo?: boolean; error?: string;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const live = (p: PRBoard) => p.state === 'abierto' || p.state === 'borrador';
export const shortRef = (p: Pick<PRBoard, 'repo' | 'number'>) => `${p.repo.split('/').pop()}#${p.number}`;

/** Copia local frente a la cabeza del PR en GitHub */
export function syncCell(pr: PRBoard | undefined, l: LocalBranch | undefined): Cell {
  const changes = l?.worktree ? l.changes ?? 0 : 0;
  const dirty = changes ? t('preflight.sync.uncommitted', { n: changes }) : '';
  if (!pr || !live(pr)) {
    if (dirty) return { mark: 'aviso', text: dirty };
    return { mark: 'nada', text: !pr ? t('preflight.sync.noPR') : t('preflight.sync.closed') };
  }
  if (!l?.head) return { mark: 'nada', text: t('preflight.sync.noLocal') };
  if (!pr.head || l.head === pr.head) return dirty ? { mark: 'aviso', text: dirty } : { mark: 'ok', text: t('preflight.sync.upToDate') };
  const behind = l.headless ? t('preflight.sync.remoteMissing') : l.behind ? t('preflight.sync.behind', { n: l.behind }) : '';
  const ahead = l.ahead ? t('preflight.sync.ahead', { n: l.ahead }) : '';
  const text = [behind, ahead, dirty].filter(Boolean).join(' · ') || t('preflight.sync.differs');
  // con commits a los dos lados la rama se ha separado: hay que integrar antes de empujar
  return { mark: (l.headless || l.behind) && l.ahead ? 'mal' : 'aviso', text };
}

export function ciCell(pr: PRBoard | undefined): Cell {
  if (!pr || !live(pr)) return { mark: 'nada', text: '—' };
  switch (pr.checks) {
    case 'SUCCESS': return { mark: 'ok', text: t('preflight.ci.green') };
    case 'FAILURE': case 'ERROR': return { mark: 'mal', text: t('preflight.ci.red') };
    case 'PENDING': case 'EXPECTED': return { mark: 'aviso', text: t('preflight.ci.pending') };
    default: return { mark: 'nada', text: t('preflight.ci.none') };
  }
}

export function reviewCell(pr: PRBoard | undefined): Cell {
  if (!pr) return { mark: 'nada', text: '—' };
  if (pr.state === 'fusionado') return { mark: 'ok', text: t('preflight.review.merged') };
  if (pr.state === 'cerrado') return { mark: 'nada', text: t('preflight.sync.closed') };
  if (pr.state === 'borrador') return { mark: 'nada', text: t('preflight.review.draft') };
  const base: Cell = pr.review === 'APPROVED' ? { mark: 'ok', text: t('preflight.review.approved') }
    : pr.review === 'CHANGES_REQUESTED' ? { mark: 'mal', text: t('preflight.review.changes') }
    : pr.review === 'REVIEW_REQUIRED' ? { mark: 'aviso', text: t('preflight.review.waiting') }
    : { mark: 'nada', text: t('preflight.review.none') };
  // lo que queda por contestar (shared/reviewCount.ts): un aprobado con hilos abiertos aún no está listo
  const l = pr.ledger;
  if (!l || !ledgerPending(l)) return base;
  const left = [l.unresolved > 0 && t('preflight.review.threads', { n: l.unresolved }), l.unansweredSummaries > 0 && t('preflight.review.summaries', { n: l.unansweredSummaries })].filter(Boolean).join(' · ');
  return { mark: base.mark === 'mal' ? 'mal' : 'aviso', text: `${base.text} · ${left}` };
}

/** Whether GitHub can merge it into its base as it is (its `mergeable`) */
export function conflictsCell(pr: PRBoard | undefined): Cell {
  if (!pr || !live(pr)) return { mark: 'nada', text: '—' };
  if (pr.conflicts === true) return { mark: 'mal', text: t('preflight.conflicts.yes') };
  if (pr.conflicts === false) return { mark: 'ok', text: t('preflight.conflicts.no') };
  return { mark: 'nada', text: t('preflight.conflicts.unknown') };
}

const short = (sha?: string) => (sha ?? '').slice(0, 7);
/** The compare reviewed at the current commit: a new head makes it stale */
export function compareCell(p: { worktree?: string; branch?: string; headLocal?: string; pr?: PRBoard }, compares: CompareRecord[]): { cell: Cell; file?: string } {
  if (p.pr && !live(p.pr)) return { cell: { mark: 'nada', text: '—' } };
  if (!p.worktree || !p.headLocal) return { cell: { mark: 'nada', text: t('preflight.sync.noLocal') } };
  const theirs = compares.filter(c => c.parts.some(x => x.worktree === p.worktree && x.branch === p.branch)).sort((a, b) => b.ts - a.ts);
  // la validada en este commit, si la hay (de un repo o de la tarea); si no, la más reciente
  const side = (c: CompareRecord) => c.parts.find(x => x.worktree === p.worktree && x.branch === p.branch)!;
  const valid = theirs.find(c => c.answer?.state === 'validada' && c.answer.ts >= c.ts && side(c).head === p.headLocal);
  if (valid) return { cell: { mark: 'ok', text: t('preflight.compare.validated', { sha: short(p.headLocal) }) }, file: valid.file };
  const c = theirs[0];
  if (!c) return { cell: { mark: 'mal', text: t('preflight.compare.none') } };
  if (side(c).head !== p.headLocal) return { cell: { mark: 'aviso', text: t('preflight.compare.old', { de: short(side(c).head), head: short(p.headLocal) }) }, file: c.file };
  if (c.answer?.state === 'notas' && c.answer.ts >= c.ts) return { cell: { mark: 'aviso', text: t('preflight.compare.notes') }, file: c.file };
  return { cell: { mark: 'aviso', text: t('preflight.compare.pending', { sha: short(p.headLocal) }) }, file: c.file };
}

const linkOf = (p: PRBoard, reason: BlockerReason): PartLink => ({ ref: refPR(p), url: p.url, title: p.title, state: p.state, checks: p.checks, reason });
/** Lo que falta de un PR al que se espera, dicho de él (su CI roja es suya) */
export function linkState(l: PartLink): string {
  if (!l.url) return t('preflight.blockers.notStarted');
  if (l.state === 'fusionado') return t('preflight.review.merged');
  const ci = l.checks === 'FAILURE' || l.checks === 'ERROR' ? t('preflight.blockers.itsCIRed') : l.checks === 'PENDING' || l.checks === 'EXPECTED' ? t('preflight.ci.pending') : '';
  return [l.state === 'borrador' ? t('preflight.review.draft') : t('preflight.blockers.open'), ci].filter(Boolean).join(' · ');
}
const linkName = (l: PartLink) => l.url ? l.ref.replace(/^[^/]+\//, '') : l.room ?? l.ref;

export function blockersCell(waitsOn: PartLink[], blocks: PartLink[], inCycle: boolean): Cell {
  if (inCycle) return { mark: 'mal', text: t('preflight.blockers.cycle') };
  const pending = waitsOn.filter(l => l.state !== 'fusionado');
  if (pending.length) return { mark: 'aviso', text: t('preflight.blockers.waitsFor', { prs: pending.map(l => `${linkName(l)} (${linkState(l)})`).join(', ') }) };
  const live = blocks.filter(l => l.state !== 'fusionado' && l.state !== 'cerrado');
  if (live.length) return { mark: 'ok', text: t('preflight.blockers.blocks', { prs: live.map(linkName).join(', ') }) };
  return { mark: waitsOn.length ? 'ok' : 'nada', text: waitsOn.length ? t('preflight.blockers.allMerged') : t('preflight.blockers.none') };
}

/** Un punto contestado: ok, o n/a con una nota que diga por qué */
export const answered = (a?: ChecklistAnswer) => !!a && (a.state === 'ok' || (a.state === 'n/a' && !!a.note?.trim()));
export const checklistKey = (worktree: string, head: string) => `${worktree}|${head}`;
/** La lista «antes de subir» de una parte, en su commit: n/m contestados; un borrador no la necesita (solo el compare) */
export function checklistCell(p: { worktree?: string; headLocal?: string; pr?: PRBoard }, items: string[], answers: Record<string, ChecklistAnswer> = {}): Cell {
  if (!items.length || (p.pr && !live(p.pr)) || !p.worktree || !p.headLocal) return { mark: 'nada', text: '—' };
  const n = items.filter(i => answered(answers[i])).length;
  if (p.pr?.state === 'borrador') return { mark: 'nada', text: t('preflight.checklist.draft', { n, m: items.length }) };
  return { mark: n === items.length ? 'ok' : 'aviso', text: t('preflight.checklist.count', { n, m: items.length, sha: short(p.headLocal) }) };
}

/** Lo que falta para subir una parte (la puerta de `git push`): el compare validado en su commit y, salvo en borrador,
 *  la lista contestada. El resto (CI, revisión, bloqueos) no frena una subida */
export function gateMissing(p: PartPreflight): string[] {
  const out: string[] = [];
  if (p.compare.mark !== 'ok' && p.compare.mark !== 'nada') out.push(t('preflight.gate.compare', { que: p.compare.text }));
  if (p.checklist.mark === 'aviso' || p.checklist.mark === 'mal') out.push(t('preflight.gate.checklist', { que: p.checklist.text }));
  return out;
}

/** ¿Sube algo esta orden de Bash? `git push` (también con -C, -c o --git-dir delante), en cualquier trozo de la línea,
 *  tras un `cd` o dentro de `sh -c "…"`; no un `--dry-run`. Devuelve la carpeta en la que sube (relativa a la de la
 *  conversación, si un `cd` o un -C la cambian) o null */
export const pushOf = (cmd: string, dir?: string) => gitOf(cmd, dir, 'push');
/** Does this Bash line merge something? `git merge` (not --abort, --quit or --continue) or `gh pr merge`, in the folder
 *  it runs in, as pushOf does for pushes */
export const mergeOf = (cmd: string, dir?: string) => gitOf(cmd, dir, 'merge');
function gitOf(cmd: string, dir: string | undefined, verb: 'push' | 'merge'): { cwd?: string } | null {
  const join = (a: string | undefined, b: string) => !a || /^[/~]/.test(b) ? b : `${a.replace(/\/+$/, '')}/${b}`;
  let cwd = dir;
  for (const chunk of shellPieces(String(cmd ?? ''))) {
    const w = chunk.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (w[i] === '(' || w[i] === '{') i++;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;                       // VAR=x git push
    if (w[i] === 'command' || w[i] === 'exec' || w[i] === 'env') { i++; while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++; }
    if ((w[i] === 'cd' || w[i] === 'pushd') && w[i + 1] !== '-') { cwd = join(cwd, w[i + 1] ?? '~'); continue; }
    if (/(^|\/)(ba|z)?sh$/.test(w[i] ?? '')) {                                          // sh -c "git push"
      const c = w.findIndex((x, j) => j > i && /^-[a-z]*c$/.test(x));   // -c, -lc
      const inside = c > 0 ? gitOf(w[c + 1] ?? '', cwd, verb) : null;
      if (inside) return inside;
      continue;
    }
    if (verb === 'merge' && /(^|\/)gh$/.test(w[i] ?? '') && w[i + 1] === 'pr' && w[i + 2] === 'merge') return { cwd };
    if (!/(^|\/)git$/.test(w[i] ?? '')) continue;
    i++;
    let here = cwd;
    while (i < w.length && w[i].startsWith('-')) {
      if (w[i] === '-C') { here = join(here, w[i + 1] ?? '.'); i += 2; }
      else if (w[i] === '-c' || w[i] === '--git-dir' || w[i] === '--work-tree') i += 2;
      else i++;
    }
    if (verb === 'push') {
      if (w[i] !== 'push' || w.slice(i + 1).some(a => a === '--dry-run' || a === '-n')) continue;
    } else if (w[i] !== 'merge' || w.slice(i + 1).some(a => a === '--abort' || a === '--quit' || a === '--continue')) continue;
    return { cwd: here };
  }
  return null;
}

/** Los trozos de una línea de shell, separados por `&&`, `||`, `;`, `|` o saltos de línea fuera de comillas */
function shellPieces(cmd: string): string[] {
  const out: string[] = [];
  let current = '', q = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { if (ch === q) q = ''; current += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; current += ch; continue; }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && cmd[i + 1] === '&')) {
      out.push(current); current = '';
      if ((ch === '&' || ch === '|') && cmd[i + 1] === ch) i++;
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map(x => x.replace(/^[\s(){}]+|[\s(){}]+$/g, ''));
}

/** Los puntos de la sección «Before pushing» (o «Antes de subir») de un CLAUDE.md: la lista numerada o con guiones de
 *  debajo, cada uno por su título en negrita si lo tiene (si no, su primera frase) */
export function checklistFromClaudeMd(text: string): string[] {
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex(l => /^#{1,6}\s+.*\b(before\s+push(?:ing)?|before\s+(?:opening|creating|marking|sending)\s+(?:a\s+|the\s+|your\s+)?(?:pr|pull\s+request)|pre-?flight|antes\s+de\s+(?:subir|abrir\s+(?:un\s+|el\s+)?pr))/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/.exec(l); if (!m) continue;
    const bold = /^\*\*(.+?)\*\*/.exec(m[1]);
    const item = (bold ? bold[1] : m[1].split(/(?<=[.!?])\s/)[0]).replace(/[*_`]/g, '').replace(/[.:]\s*$/, '').trim();
    if (item && !out.includes(item)) out.push(item.slice(0, 160));
  }
  return out.slice(0, 30);
}

/** Los puntos que pone un repo, de lo que hay en él (lo lee server/preflight.ts): la sección «antes de subir» de su
 *  CLAUDE.md y AGENTS.md, sus skills de comprobación (revisar, criterios de aceptación, pruebas…) y sus órdenes de
 *  comprobación (scripts de package.json, objetivos de Makefile, pre-commit). Cada uno con su origen delante */
export interface RepoFiles { claudeMd?: string; agentsMd?: string; skills?: { name: string; description?: string }[]; packageJson?: string; makefile?: string; precommit?: boolean }
const CHECK = /\b(lint|test|tests|typecheck|type-check|tsc|check|checks|verify|format:check|fmt-check|mypy|ruff|flake8|eslint|prettier|vet|audit)\b/i;
const NOT_CHECK = /\b(watch|dev|serve|start|fix|update|snapshot|debug|coverage-report|e2e:open|ui)\b/i;
const SKILL_CHECK = /\b(review|revis|acceptance|criteria|criterios|check|checklist|verify|verif|test|qa|lint|pre-?push|pre-?flight|security|audit)/i;
export function repoChecklist(f: RepoFiles): string[] {
  const out: string[] = [];
  const set = (x: string) => { const y = x.slice(0, 160); if (!out.includes(y)) out.push(y); };
  for (const i of checklistFromClaudeMd(f.claudeMd ?? '')) set(`CLAUDE.md · ${i}`);
  for (const i of checklistFromClaudeMd(f.agentsMd ?? '')) set(`AGENTS.md · ${i}`);
  for (const s of f.skills ?? []) if (SKILL_CHECK.test(`${s.name} ${s.description ?? ''}`) && !/\b(deploy|release|publish)\b/i.test(s.name)) set(`skill · ${s.name}`);
  try {
    const scripts = JSON.parse(f.packageJson ?? '{}')?.scripts ?? {};
    for (const n of Object.keys(scripts)) if (CHECK.test(n.replace(/[:_-]/g, ' ')) && !NOT_CHECK.test(n.replace(/[:_-]/g, ' '))) set(`npm run ${n}`);
  } catch {}
  for (const m of (f.makefile ?? '').matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)) if (CHECK.test(m[1].replace(/[_-]/g, ' ')) && !NOT_CHECK.test(m[1].replace(/[_-]/g, ' '))) set(`make ${m[1]}`);
  if (f.precommit) set('pre-commit run --all-files');
  return out.slice(0, 20);
}

/** Whether a PR can be merged now: merged already, ready (open, CI, review, no conflicts and nothing it waits for
 *  still open), or not yet (⚠) or with a problem (✗), with what stops it. Push-only cells (compare, checklist, sync)
 *  don't count here: they are the push gate's (gateMissing) */
export function mergeReady(p: PartPreflight): { state: 'fusionado' | 'listo' | 'aviso' | 'falta'; missing: string[] } {
  if (p.pr?.state === 'fusionado') return { state: 'fusionado', missing: [] };
  if (!p.pr || !live(p.pr)) return { state: 'falta', missing: [p.pr ? t('preflight.sync.closed') : t('preflight.sync.noPR')] };
  const cells = [p.ci, p.review, p.conflicts, p.blockers];
  const missing = [...(p.pr.state === 'borrador' ? [t('preflight.review.draft')] : []), ...cells.filter(c => c.mark === 'mal' || c.mark === 'aviso').map(c => c.text)];
  return { state: cells.some(c => c.mark === 'mal') ? 'falta' : missing.length ? 'aviso' : 'listo', missing };
}

/** Whether a task has a pre-flight to show: at least one PR of it (open, draft or merged) in any repo, matched as
 *  `preflightTarea` does. Without one there is nothing to merge, so its entry points stay hidden */
export function taskHasPRs(key: string, prs: Pick<PRBoard, 'branch' | 'title' | 'number' | 'state'>[]): boolean {
  const K = taskKey(key);
  return !!K && prs.some(p => p.state !== 'cerrado' && pRTask(p) === K);
}

/** El pre-flight de una tarea: sus partes en todas las salas y el orden en que puede fusionarse */
export function preflightTask(key: string, d: PreflightInput): TaskPreflight {
  const K = taskKey(key) ?? key.toUpperCase();
  const byUrl = new Map(d.prs.map(p => [p.url, p]));
  // los PR de la tarea (los cerrados sin fusionar ya no cuentan)
  const taskPrs = d.prs.filter(p => p.state !== 'cerrado' && pRTask(p) === K);
  const roomOf = (repo: string) => d.rooms.find(s => sameRepo(s.repo, repo));
  const planOf = (roomId?: string) => d.plan?.find(x => x.roomId === roomId);
  // merged PRs keep their wave: a task that fully landed shows its waves complete
  const { waves, cycle } = deployWaves(d.prs, d.blockers, true);
  const inCycle = new Set(cycle.map(p => p.url));
  const used = new Set<LocalBranch>();
  const compare = (p: Parameters<typeof compareCell>[0]) => {
    const r = compareCell(p, d.compares ?? []);
    const repoItems = (p.worktree && d.repoChecklist?.[p.worktree]) || [];
    const items = [...(d.checklist?.items ?? []), ...repoItems.filter(i => !d.checklist?.items.includes(i))];
    const answers = p.worktree && p.headLocal ? d.checklist?.answers[checklistKey(p.worktree, p.headLocal)] : undefined;
    return { compare: r.cell, compareFile: r.file, checklist: checklistCell(p, items, answers), answers, repoItems, ciChecks: (p.pr && live(p.pr) && d.ciChecks?.[p.pr.url]) || [] };
  };
  const parts: PartPreflight[] = [];

  const links = (url: string) => ({
    waitsOn: d.blockers.filter(b => b.from === url).map(b => byUrl.get(b.by) && linkOf(byUrl.get(b.by)!, b.reason)).filter((x): x is PartLink => !!x),
    blocks: d.blockers.filter(b => b.by === url).map(b => byUrl.get(b.from) && linkOf(byUrl.get(b.from)!, b.reason)).filter((x): x is PartLink => !!x),
  });

  for (const pr of [...taskPrs].sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)) {
    const room = roomOf(pr.repo);
    // mejor la sacada en un worktree que la rama suelta
    const local = d.local.filter(l => l.roomId === room?.id && l.branch === pr.branch).sort((a, b) => Number(!!b.worktree) - Number(!!a.worktree))[0];
    if (local) used.add(local);
    const { waitsOn, blocks } = links(pr.url);
    parts.push({
      id: pr.url, roomId: room?.id, room: room?.name, repo: pr.repo, worktree: local?.worktree, branch: pr.branch, headLocal: local?.head,
      changes: local?.worktree ? local.changes : undefined, pr, plan: planOf(room?.id)?.title,
      sync: syncCell(pr, local), ci: ciCell(pr), review: reviewCell(pr), conflicts: conflictsCell(pr), blockers: blockersCell(waitsOn, blocks, inCycle.has(pr.url)), waitsOn, blocks,
      ...compare({ worktree: local?.worktree, branch: pr.branch, headLocal: local?.worktree ? local.head : undefined, pr }), threads: live(pr) ? d.threads?.[pr.url] ?? [] : [],
    });
  }
  // worktrees de la tarea sin PR aún
  for (const l of d.local) {
    if (used.has(l) || !l.worktree) continue;
    const room = d.rooms.find(s => s.id === l.roomId);
    parts.push({
      id: 'wt:' + l.worktree, roomId: l.roomId, room: room?.name, repo: room?.repo, worktree: l.worktree, branch: l.branch, headLocal: l.head, changes: l.changes,
      plan: planOf(l.roomId)?.title, sync: syncCell(undefined, l), ci: ciCell(undefined), review: reviewCell(undefined), conflicts: conflictsCell(undefined), blockers: blockersCell([], [], false), waitsOn: [], blocks: [],
      ...compare({ worktree: l.worktree, branch: l.branch, headLocal: l.head }), threads: [],
    });
  }
  // partes del plan sin nada aún
  for (const x of d.plan ?? []) {
    if (parts.some(p => p.roomId === x.roomId)) continue;
    const room = d.rooms.find(s => s.id === x.roomId);
    const none: Cell = { mark: 'nada', text: '—' };
    parts.push({ id: 'plan:' + x.roomId, roomId: x.roomId, room: room?.name ?? x.room, repo: room?.repo, plan: x.title, notStarted: true, sync: none, ci: none, review: none, conflicts: none, blockers: none, compare: none, checklist: none, repoItems: [], ciChecks: [], threads: [], waitsOn: [], blocks: [] });
  }
  // lo que dice el plan que espera a una sala que aún no tiene PR: sin PR no hay bloqueo entre PR, pero se espera igual
  for (const x of d.plan ?? []) for (const id of x.waitA ?? []) {
    if (parts.some(p => p.roomId === id && p.pr)) continue;
    const other = d.plan!.find(y => y.roomId === id);
    const link: PartLink = { ref: 'plan:' + id, reason: 'plan', room: d.rooms.find(s => s.id === id)?.name ?? other?.room ?? id };
    for (const p of parts.filter(p => p.roomId === x.roomId && !p.notStarted)) {
      p.waitsOn.push(link);
      p.blockers = blockersCell(p.waitsOn, p.blocks, !!p.pr && inCycle.has(p.pr.url));
    }
  }

  // las olas con lo de la tarea y lo que espera (directa o indirectamente), renumeradas
  const mine = new Set(taskPrs.map(p => p.url));
  const tail = [...mine];
  // (another task's PR already merged no longer holds anything: it stays out)
  while (tail.length) { const u = tail.shift()!; for (const b of d.blockers) if (b.from === u && !mine.has(b.by) && byUrl.get(b.by)?.state !== 'fusionado') { mine.add(b.by); tail.push(b.by); } }
  const ownWaves = waves.map(o => o.filter(p => mine.has(p.url)).map(refPR)).filter(o => o.length);
  return { key: K, color: d.color, title: d.title, parts, waves: ownWaves, cycle: cycle.filter(p => mine.has(p.url)).map(refPR),
    checklist: d.checklist?.items ?? [], ...(d.verification ? { verification: d.verification } : {}), demo: d.demo, error: d.error };
}
