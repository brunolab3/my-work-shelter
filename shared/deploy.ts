// Tablero de despliegue de la sala de planificación: tus PR por estado, los bloqueos entre ellos y el orden en que se
// pueden fusionar y desplegar. Un PR espera a otro si va apilado encima (su base es la rama del otro), si su descripción
// lo dice («depends on #12», «bloqueado por org/repo#7», el enlace al PR…), si el plan repartido de su tarea dice que su
// repo espera a otro (la parte de una sala «waits_on» la de otra: server/plans.ts) o si el Supervisor lo marca a mano.
// Los PR de una misma tarea en repos distintos sin orden conocido van enlazados («misma tarea»), sin bloquearse.
// Puro: lo usan el cliente, el servidor y las pruebas.
import type { PRBoard } from './board';
import { branchTask, textKey } from './tasks';
import { t } from './language';
import { ledgerPending } from './reviewCount';

export type BlockerReason = 'stack' | 'text' | 'plan' | 'manual';
/** `de` espera a `por` (las dos, URL de PR) */
export interface Blocker { from: string; by: string; reason: BlockerReason }
export interface BlockerManual { from: string; by: string }
/** Del plan repartido de una tarea: en ella, lo del repo `repo` («org/repo») espera a lo de los repos `waitsOn` */
export interface TaskOrder { key: string; repo: string; waitA: string[] }

export type DeploymentColumn = 'draft' | 'review' | 'changes' | 'approved' | 'merged';
export const DEPLOYMENT_COLUMNS: { id: DeploymentColumn; name: string }[] = [
  { id: 'draft', name: 'Borrador' }, { id: 'review', name: 'En revisión' }, { id: 'changes', name: 'Piden cambios' },
  { id: 'approved', name: 'Aprobado' }, { id: 'merged', name: 'Fusionado' },
];
export function deploymentColumn(p: PRBoard): DeploymentColumn | null {
  if (p.state === 'closed') return null;
  if (p.state === 'merged') return 'merged';
  if (p.state === 'draft') return 'draft';
  return p.review === 'APPROVED' ? 'approved' : p.review === 'CHANGES_REQUESTED' ? 'changes' : 'review';
}

// «org/repo#12» de una referencia escrita en la descripción; sin repo, el del propio PR
const WORDS = String.raw`(?:depends\s+on|depend(?:s|e)\s+(?:on|de)|blocked\s+by|bloquead[oa]\s+por|requires|requiere|needs|necesita|after|despu[eé]s\s+de|merge\s+after|stacked\s+on|apilad[oa]\s+(?:sobre|en))`;
const REF = String.raw`(?:https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|([\w.-]+/[\w.-]+)?#(\d+))`;
// una frase que habla de lo que tiene que ir antes («Merge with or after …», «Merge order: … must be in production
// first», «Blocked on …», una lista bajo «Blockers:»): cuentan todas las referencias de la frase, también las ramas entre
// comillas invertidas (`feature/ABC-12-algo`), que se cruzan con la rama de otro PR del tablero
const BLOCKER_PHRASE = /\b(?:depends?\s+on|blocked\s+(?:by|on)|blockers?|bloquead[oa]\s+por|bloqueos?|waits?\s+(?:for|on)|espera\s+a|stacked\s+on|apilad[oa]\s+(?:sobre|en)|(?:merge|deploy|release)[a-z]*\s+(?:(?:with\s+or|together\s+with\s+or)\s+)?after|merge\s+order|orden\s+de\s+(?:fusi[oó]n|despliegue)|(?:must|has\s+to|needs?\s+to|should)\s+(?:be\s+|go\s+)?(?:merged\s+|deployed\s+|released\s+|live\s+|in\s+production\s+|out\s+)?first|(?:that|this)\s+one\s+first|antes\s+que\s+(?:este|esta)|(?:do\s+not|don'?t|never|cannot|can'?t)\s+(?:be\s+)?(?:merge|deploy|release)[a-z]*\s+(?:before|until)|only\s+(?:be\s+)?(?:merged\s+|deployed\s+|released\s+)?after|until\b[^.]*\b(?:merged|in\s+production|deployed|live|released|ships?)|no\s+(?:se\s+)?(?:fusion|despleg|mezcl)[a-z]*\s+(?:hasta|antes)|hasta\s+que)\b/i;
const WITHOUT_ORDER = /\b(?:before\s+or\s+after|in\s+any\s+order|either\s+order|antes\s+o\s+despu[eé]s|en\s+cualquier\s+orden)\b/i;
const BRANCH = /`([\w.-]+(?:\/[\w.-]+)+|[A-Za-z][A-Za-z0-9]+-\d+[\w.-]*)`/g;
/** Los PR de los que dice depender un texto (descripción o título), normalizados como «org/repo#N» o, si lo nombra por
 *  su rama, «rama:<rama>», sin repetir */
export function dependenciesInText(text: string, repo: string): string[] {
  const out: string[] = [];
  const set = (r: string) => { if (!out.includes(r)) out.push(r); };
  const refs = (t: string) => { for (const r of t.matchAll(new RegExp(REF, 'g'))) set(r[1] ? `${r[1]}#${Number(r[2])}` : `${r[3] ?? repo}#${Number(r[4])}`); };
  const phrase = new RegExp(WORDS + String.raw`\s*:?\s*((?:` + REF + String.raw`[\s,;y&and]*)+)`, 'gi');
  for (const m of (text ?? '').matchAll(phrase)) refs(m[1]);
  // por frases (y la lista que cuelga de un «Blockers:» o «Depends on:» sin referencias en su propia línea)
  let list = false;
  for (const line of (text ?? '').split('\n')) {
    const item = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
    if (list && !item) list = false;
    if (list) { refs(line); for (const r of line.matchAll(BRANCH)) set('branch:' + r[1]); continue; }
    for (const f of line.split(/(?<=[.!?])\s+(?=[^a-z\s])/)) {
      if (!BLOCKER_PHRASE.test(f) || WITHOUT_ORDER.test(f)) continue;
      const before = out.length;
      refs(f); for (const r of f.matchAll(BRANCH)) set('branch:' + r[1]);
      if (out.length === before && !item && /:\s*$/.test(f.replace(/[*_`\s]+$/, ''))) list = true;   // «…in production:**»
    }
  }
  return out;
}
export const refPR = (p: Pick<PRBoard, 'repo' | 'number'>) => `${p.repo}#${p.number}`;
/** La clave de Jira de un PR (rama, luego título), sin el PR-<número> de reserva: ese no junta repos distintos */
export const pRKey = (p: Pick<PRBoard, 'branch' | 'title'>) => branchTask(p.branch) ?? textKey(p.title);
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Todos los bloqueos entre los PR del tablero (los que apuntan a PR que no están en él no cuentan), sin repetir */
export function blockersBetween(prs: PRBoard[], manual: BlockerManual[] = [], orden: TaskOrder[] = []): Blocker[] {
  const byRef = new Map(prs.map(p => [refPR(p), p]));
  const urls = new Set(prs.map(p => p.url));
  const out: Blocker[] = [];
  const set = (from: string, by: string, reason: BlockerReason) => { if (from !== by && !out.some(b => b.from === from && b.by === by)) out.push({ from, by, reason }); };
  for (const p of prs) {
    // apilado: su base es la rama de otro PR del mismo repo (que no esté ya fusionado: entonces la base ya es la buena)
    if (p.base) for (const q of prs) if (q !== p && q.repo === p.repo && q.branch === p.base && q.state !== 'closed') set(p.url, q.url, 'stack');
    for (const ref of p.dependencies ?? []) {
      // por su rama (de cualquier repo del tablero), mejor uno sin cerrar
      const q = ref.startsWith('branch:') ? prs.filter(x => x !== p && x.branch === ref.slice(7)).sort((a, b) => Number(a.state === 'closed') - Number(b.state === 'closed'))[0] : byRef.get(ref);
      if (q) set(p.url, q.url, 'text');
    }
    // el orden del plan de su tarea: espera a los PR de la misma tarea en los repos a los que espera el suyo
    const key = pRKey(p);
    for (const o of orden) if (key && o.key.toUpperCase() === key && sameRepo(o.repo, p.repo))
      for (const q of prs) if (q !== p && q.state !== 'closed' && pRKey(q) === key && o.waitA.some(r => sameRepo(r, q.repo))) set(p.url, q.url, 'plan');
  }
  for (const m of manual) if (urls.has(m.from) && urls.has(m.by)) set(m.from, m.by, 'manual');
  return out;
}

/** Los PR de una misma tarea en repos distintos que no tienen ningún bloqueo entre ellos (sin cerrar): van enlazados,
 *  sin orden, para que se vea que son la misma tarea (el orden lo pone el plan o se marca a mano) */
export function taskLinks(prs: PRBoard[], blockers: Blocker[]): { a: string; b: string; key: string }[] {
  const live = prs.filter(p => p.state !== 'closed');
  const out: { a: string; b: string; key: string }[] = [];
  live.forEach((p, i) => {
    const key = pRKey(p); if (!key) return;
    for (const q of live.slice(i + 1)) if (pRKey(q) === key && !sameRepo(p.repo, q.repo)
      && !blockers.some(b => (b.from === p.url && b.by === q.url) || (b.from === q.url && b.by === p.url))) out.push({ a: p.url, b: q.url, key });
  });
  return out;
}

/** El orden de despliegue de lo que queda por fusionar: olas (lo de cada ola puede ir a la vez; cada una espera a las
 *  anteriores). Lo ya fusionado no espera a nadie ni bloquea; un PR cerrado sin fusionar tampoco. Los PR en un ciclo de
 *  bloqueos quedan fuera, en `ciclo`. */
export function deployWaves(prs: PRBoard[], blockers: Blocker[], withMerged = false): { waves: PRBoard[][]; cycle: PRBoard[] } {
  // with merged ones too (the pre-flight, to show a task's waves complete): every PR but the closed ones
  const pending = prs.filter(p => p.state === 'open' || p.state === 'draft' || (withMerged && p.state === 'merged'));
  const live = new Set(pending.map(p => p.url));
  const wait = new Map(pending.map(p => [p.url, new Set(blockers.filter(b => b.from === p.url && live.has(b.by)).map(b => b.by))]));
  const waves: PRBoard[][] = [];
  let remain = pending;
  while (remain.length) {
    const wave = remain.filter(p => wait.get(p.url)!.size === 0);
    if (!wave.length) break;
    waves.push(wave);
    for (const p of wave) for (const s of wait.values()) s.delete(p.url);
    remain = remain.filter(p => !wave.includes(p));
  }
  return { waves, cycle: remain };
}

/** El tablero como texto, para pedirle a la sala de planificación el plan de despliegue */
export function deploymentText(prs: PRBoard[], blockers: Blocker[]): string {
  const byUrl = new Map(prs.map(p => [p.url, p]));
  const { waves, cycle } = deployWaves(prs, blockers);
  const links = taskLinks(prs, blockers);
  const line = (p: PRBoard) => {
    const waits = blockers.filter(b => b.from === p.url).map(b => byUrl.get(b.by)).filter(Boolean).map(q => refPR(q!) + (q!.state === 'merged' ? t('prompt.deploy.mergedMark') : ''));
    const beside = links.filter(e => e.a === p.url || e.b === p.url).map(e => byUrl.get(e.a === p.url ? e.b : e.a)!).map(refPR);
    return t('prompt.deploy.line', { pr: refPR(p), title: p.title ?? '', column: deploymentColumn(p) ?? '', ci: p.checks ? ' · CI ' + p.checks : '', reviews: p.state !== 'merged' && p.ledger && ledgerPending(p.ledger) ? t('prompt.deploy.ledger', { threads: p.ledger.unresolved, summaries: p.ledger.unansweredSummaries }) : '', waits: waits.length ? t('prompt.deploy.waitsFor', { prs: waits.join(', ') }) : '', beside: beside.length ? t('prompt.deploy.sameTask', { key: pRKey(p) || '', prs: beside.join(', ') }) : '', url: p.url });
  };
  return [
    t('prompt.deploy.pending'),
    ...waves.flatMap((o, i) => [t('prompt.deploy.wave', { n: i + 1 }), ...o.map(line)]),
    ...(cycle.length ? [t('prompt.deploy.cycle'), ...cycle.map(line)] : []),
    '',
    t('prompt.deploy.merged'),
    ...prs.filter(p => p.state === 'merged').map(line),
  ].join('\n');
}

/** Lo que recibe el habitante de la sala de planificación al pedirle el plan de despliegue */
export function promptDeployment(prs: PRBoard[], blockers: Blocker[]): string {
  return [t('prompt.deploy.title'), '', deploymentText(prs, blockers), '', '---', t('prompt.deploy.steps')].join('\n');
}
