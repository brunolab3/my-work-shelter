// Pre-flight de una tarea (fase 1, solo lectura): de un vistazo, cómo va cada parte de una tarea de Jira en todos los
// repos del refugio. Una tarea repartida por Logística tiene partes en varias salas (un worktree por parte); cada parte
// es un PR (o un worktree sin PR aún, o una parte del plan sin empezar). Por parte: si la copia local está al día con
// GitHub (un bot puede haber empujado arreglos), la CI, la revisión y a qué espera o a quién bloquea (los bloqueos
// entre PR de shared/despliegue.ts, también de otros repos). La CI roja de un PR al que se espera es problema de ese PR,
// no de esta parte: aquí solo sale como su estado. Luego, las olas en que se puede fusionar lo de la tarea.
// Puro: lo usan el cliente, el servidor (server/preflight.ts) y las pruebas.
import type { PRBoard } from './tablero';
import { olasDespliegue, refPR, type Blocker, type BlockerReason } from './despliegue';
import { pRTask } from './tareas';
import { t } from './idioma';
import { ledgerPending, type ReviewThread } from './cuentaRevisiones';

/** ✓ listo, ⚠ mirar, ✗ falta, — no aplica */
export type Mark = 'ok' | 'aviso' | 'mal' | 'nada';
export interface Cell { marca: Mark; texto: string }

/** Una rama de la tarea en el repo de una sala: sacada en un worktree (`worktree`, con sus cambios sin commitear) o
 *  solo como rama local. `adelante`/`detras`: commits que tiene y no tiene respecto a la cabeza de su PR en GitHub;
 *  `sinCabeza`: esa cabeza no está en el repo local (no se ha traído: hay commits remotos que faltan) */
export interface LocalBranch {
  salaId: string; rama: string; head?: string;
  worktree?: string; cambios?: number;
  adelante?: number; detras?: number; sinCabeza?: boolean;
}
export interface RoomRepo { id: string; nombre: string; repo?: string }
/** Una página de comparación (server/comparar.ts, su `<página>.json`) con lo que el Supervisor hizo con ella: de qué
 *  worktree, rama y commit es cada parte. La de una tarea entera lleva varias partes */
export interface CompareRecord {
  archivo: string; ts: number; tarea?: string;
  partes: { worktree: string; rama: string; head: string; base?: string }[];
  respuesta?: { estado: 'validada' | 'notas'; ts: number };
}
/** Lo que contesta el habitante a un punto de la lista «antes de subir» del Supervisor, para un commit */
export interface ChecklistAnswer { estado: 'ok' | 'n/a' | 'pendiente'; nota?: string; ts: number }
export interface PlanPart { salaId: string; sala: string; titulo: string; waitA?: string[] }

/** A qué espera una parte o a quién bloquea: otro PR (de esta tarea o no) o, sin PR aún, una sala del plan */
export interface PartLink { ref: string; url?: string; titulo?: string; estado?: PRBoard['estado']; checks?: PRBoard['checks']; motivo: BlockerReason; sala?: string }

export interface PartPreflight {
  id: string;
  salaId?: string; sala?: string; repo?: string;
  worktree?: string; rama?: string; headLocal?: string; cambios?: number;
  pr?: PRBoard;
  plan?: string;                 // el título de su parte en el plan repartido
  sinEmpezar?: boolean;          // parte del plan sin worktree ni PR
  sync: Cell; ci: Cell; revision: Cell; bloqueos: Cell; compare: Cell; checklist: Cell;
  respuestas?: Record<string, ChecklistAnswer>;   // las del commit actual, por punto
  compareArchivo?: string;       // la página que cuenta para esta parte (la más reciente con su worktree y rama)
  hilos: ReviewThread[];         // los hilos de revisión sin resolver de su PR
  esperaA: PartLink[]; bloquea: PartLink[];
}
export interface TaskPreflight {
  clave: string; color?: string; titulo?: string;
  partes: PartPreflight[];
  olas: string[][];              // las olas (refPR) con lo de la tarea y lo que espera, en orden; cada una espera a las anteriores
  ciclo: string[];
  compareTarea?: CompareRecord;  // la página de toda la tarea, si se ha hecho
  checklist: string[];           // los puntos del Supervisor
  demo?: boolean; error?: string;
}

export interface PreflightInput {
  prs: PRBoard[];                // todos los del tablero (también los de otras tareas: pueden ser bloqueos)
  bloqueos: Blocker[];           // bloqueosEntre(prs, manuales, orden)
  locales: LocalBranch[];
  salas: RoomRepo[];             // las salas de repo, con su repo de GitHub («org/repo»)
  plan?: PlanPart[];
  compares?: CompareRecord[];
  hilos?: Record<string, ReviewThread[]>;   // por URL del PR (server/revisionesPR.ts)
  checklist?: { items: string[]; respuestas: Record<string, Record<string, ChecklistAnswer>> };   // respuestas por `${worktree}|${head}`
  color?: string; titulo?: string; demo?: boolean; error?: string;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const vivo = (p: PRBoard) => p.estado === 'abierto' || p.estado === 'borrador';
export const shortRef = (p: Pick<PRBoard, 'repo' | 'numero'>) => `${p.repo.split('/').pop()}#${p.numero}`;

/** Copia local frente a la cabeza del PR en GitHub */
export function syncCell(pr: PRBoard | undefined, l: LocalBranch | undefined): Cell {
  const cambios = l?.worktree ? l.cambios ?? 0 : 0;
  const sucio = cambios ? t('preflight.sync.uncommitted', { n: cambios }) : '';
  if (!pr || !vivo(pr)) {
    if (sucio) return { marca: 'aviso', texto: sucio };
    return { marca: 'nada', texto: !pr ? t('preflight.sync.noPR') : t('preflight.sync.closed') };
  }
  if (!l?.head) return { marca: 'nada', texto: t('preflight.sync.noLocal') };
  if (!pr.cabeza || l.head === pr.cabeza) return sucio ? { marca: 'aviso', texto: sucio } : { marca: 'ok', texto: t('preflight.sync.upToDate') };
  const detras = l.sinCabeza ? t('preflight.sync.remoteMissing') : l.detras ? t('preflight.sync.behind', { n: l.detras }) : '';
  const adelante = l.adelante ? t('preflight.sync.ahead', { n: l.adelante }) : '';
  const texto = [detras, adelante, sucio].filter(Boolean).join(' · ') || t('preflight.sync.differs');
  // con commits a los dos lados la rama se ha separado: hay que integrar antes de empujar
  return { marca: (l.sinCabeza || l.detras) && l.adelante ? 'mal' : 'aviso', texto };
}

export function ciCell(pr: PRBoard | undefined): Cell {
  if (!pr || !vivo(pr)) return { marca: 'nada', texto: '—' };
  switch (pr.checks) {
    case 'SUCCESS': return { marca: 'ok', texto: t('preflight.ci.green') };
    case 'FAILURE': case 'ERROR': return { marca: 'mal', texto: t('preflight.ci.red') };
    case 'PENDING': case 'EXPECTED': return { marca: 'aviso', texto: t('preflight.ci.pending') };
    default: return { marca: 'nada', texto: t('preflight.ci.none') };
  }
}

export function reviewCell(pr: PRBoard | undefined): Cell {
  if (!pr) return { marca: 'nada', texto: '—' };
  if (pr.estado === 'fusionado') return { marca: 'ok', texto: t('preflight.review.merged') };
  if (pr.estado === 'cerrado') return { marca: 'nada', texto: t('preflight.sync.closed') };
  if (pr.estado === 'borrador') return { marca: 'nada', texto: t('preflight.review.draft') };
  const base: Cell = pr.revision === 'APPROVED' ? { marca: 'ok', texto: t('preflight.review.approved') }
    : pr.revision === 'CHANGES_REQUESTED' ? { marca: 'mal', texto: t('preflight.review.changes') }
    : pr.revision === 'REVIEW_REQUIRED' ? { marca: 'aviso', texto: t('preflight.review.waiting') }
    : { marca: 'nada', texto: t('preflight.review.none') };
  // lo que queda por contestar (shared/cuentaRevisiones.ts): un aprobado con hilos abiertos aún no está listo
  const l = pr.ledger;
  if (!l || !ledgerPending(l)) return base;
  const queda = [l.unresolved > 0 && t('preflight.review.threads', { n: l.unresolved }), l.unansweredSummaries > 0 && t('preflight.review.summaries', { n: l.unansweredSummaries })].filter(Boolean).join(' · ');
  return { marca: base.marca === 'mal' ? 'mal' : 'aviso', texto: `${base.texto} · ${queda}` };
}

const corto = (sha?: string) => (sha ?? '').slice(0, 7);
/** La comparación revisada para el commit actual: una nueva cabeza la deja vieja; la de la tarea entera también vale */
export function compareCell(p: { worktree?: string; rama?: string; headLocal?: string; pr?: PRBoard }, compares: CompareRecord[]): { celda: Cell; archivo?: string } {
  if (p.pr && !vivo(p.pr)) return { celda: { marca: 'nada', texto: '—' } };
  if (!p.worktree || !p.headLocal) return { celda: { marca: 'nada', texto: t('preflight.sync.noLocal') } };
  const suya = compares.filter(c => c.partes.some(x => x.worktree === p.worktree && x.rama === p.rama)).sort((a, b) => b.ts - a.ts);
  // la validada en este commit, si la hay (de un repo o de la tarea); si no, la más reciente
  const lado = (c: CompareRecord) => c.partes.find(x => x.worktree === p.worktree && x.rama === p.rama)!;
  const vale = suya.find(c => c.respuesta?.estado === 'validada' && c.respuesta.ts >= c.ts && lado(c).head === p.headLocal);
  if (vale) return { celda: { marca: 'ok', texto: t('preflight.compare.validated', { sha: corto(p.headLocal) }) }, archivo: vale.archivo };
  const c = suya[0];
  if (!c) return { celda: { marca: 'mal', texto: t('preflight.compare.none') } };
  if (lado(c).head !== p.headLocal) return { celda: { marca: 'aviso', texto: t('preflight.compare.old', { de: corto(lado(c).head), head: corto(p.headLocal) }) }, archivo: c.archivo };
  if (c.respuesta?.estado === 'notas' && c.respuesta.ts >= c.ts) return { celda: { marca: 'aviso', texto: t('preflight.compare.notes') }, archivo: c.archivo };
  return { celda: { marca: 'aviso', texto: t('preflight.compare.pending', { sha: corto(p.headLocal) }) }, archivo: c.archivo };
}

const linkOf = (p: PRBoard, motivo: BlockerReason): PartLink => ({ ref: refPR(p), url: p.url, titulo: p.titulo, estado: p.estado, checks: p.checks, motivo });
/** Lo que falta de un PR al que se espera, dicho de él (su CI roja es suya) */
export function linkState(l: PartLink): string {
  if (!l.url) return t('preflight.blockers.notStarted');
  if (l.estado === 'fusionado') return t('preflight.review.merged');
  const ci = l.checks === 'FAILURE' || l.checks === 'ERROR' ? t('preflight.blockers.itsCIRed') : l.checks === 'PENDING' || l.checks === 'EXPECTED' ? t('preflight.ci.pending') : '';
  return [l.estado === 'borrador' ? t('preflight.review.draft') : t('preflight.blockers.open'), ci].filter(Boolean).join(' · ');
}
const linkName = (l: PartLink) => l.url ? l.ref.replace(/^[^/]+\//, '') : l.sala ?? l.ref;

export function blockersCell(esperaA: PartLink[], bloquea: PartLink[], enCiclo: boolean): Cell {
  if (enCiclo) return { marca: 'mal', texto: t('preflight.blockers.cycle') };
  const pendientes = esperaA.filter(l => l.estado !== 'fusionado');
  if (pendientes.length) return { marca: 'aviso', texto: t('preflight.blockers.waitsFor', { prs: pendientes.map(l => `${linkName(l)} (${linkState(l)})`).join(', ') }) };
  const vivos = bloquea.filter(l => l.estado !== 'fusionado' && l.estado !== 'cerrado');
  if (vivos.length) return { marca: 'ok', texto: t('preflight.blockers.blocks', { prs: vivos.map(linkName).join(', ') }) };
  return { marca: esperaA.length ? 'ok' : 'nada', texto: esperaA.length ? t('preflight.blockers.allMerged') : t('preflight.blockers.none') };
}

/** Un punto contestado: ok, o n/a con una nota que diga por qué */
export const answered = (a?: ChecklistAnswer) => !!a && (a.estado === 'ok' || (a.estado === 'n/a' && !!a.nota?.trim()));
export const checklistKey = (worktree: string, head: string) => `${worktree}|${head}`;
/** La lista «antes de subir» de una parte, en su commit: n/m contestados; un borrador no la necesita (solo el compare) */
export function checklistCell(p: { worktree?: string; headLocal?: string; pr?: PRBoard }, items: string[], respuestas: Record<string, ChecklistAnswer> = {}): Cell {
  if (!items.length || (p.pr && !vivo(p.pr)) || !p.worktree || !p.headLocal) return { marca: 'nada', texto: '—' };
  const n = items.filter(i => answered(respuestas[i])).length;
  if (p.pr?.estado === 'borrador') return { marca: 'nada', texto: t('preflight.checklist.draft', { n, m: items.length }) };
  return { marca: n === items.length ? 'ok' : 'aviso', texto: t('preflight.checklist.count', { n, m: items.length, sha: corto(p.headLocal) }) };
}

/** Lo que falta para subir una parte (la puerta de `git push`): el compare validado en su commit y, salvo en borrador,
 *  la lista contestada. El resto (CI, revisión, bloqueos) no frena una subida */
export function gateMissing(p: PartPreflight): string[] {
  const out: string[] = [];
  if (p.compare.marca !== 'ok' && p.compare.marca !== 'nada') out.push(t('preflight.gate.compare', { que: p.compare.texto }));
  if (p.checklist.marca === 'aviso' || p.checklist.marca === 'mal') out.push(t('preflight.gate.checklist', { que: p.checklist.texto }));
  return out;
}

/** ¿Sube algo esta orden de Bash? `git push` (también con -C, -c o --git-dir delante), en cualquier trozo de la línea;
 *  no un `--dry-run`. Devuelve la carpeta en la que sube (la de -C, si la lleva) o null */
export function pushOf(cmd: string): { cwd?: string } | null {
  for (const trozo of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = trozo.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;                       // VAR=x git push
    if (w[i] === 'command' || w[i] === 'exec') i++;
    if (!/(^|\/)git$/.test(w[i] ?? '')) continue;
    i++;
    let cwd: string | undefined;
    while (i < w.length && w[i].startsWith('-')) {
      if (w[i] === '-C') { cwd = w[i + 1]; i += 2; }
      else if (w[i] === '-c' || w[i] === '--git-dir' || w[i] === '--work-tree') i += 2;
      else i++;
    }
    if (w[i] !== 'push') continue;
    if (w.slice(i + 1).some(a => a === '--dry-run' || a === '-n')) continue;
    return { cwd };
  }
  return null;
}

/** Los puntos de la sección «Before pushing» (o «Antes de subir») de un CLAUDE.md: la lista numerada o con guiones de
 *  debajo, cada uno por su título en negrita si lo tiene (si no, su primera frase) */
export function checklistFromClaudeMd(texto: string): string[] {
  const lineas = String(texto ?? '').split('\n');
  const i = lineas.findIndex(l => /^#{1,6}\s+.*\b(before\s+push|before\s+pushing|antes\s+de\s+subir)/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lineas.slice(i + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/.exec(l); if (!m) continue;
    const negrita = /^\*\*(.+?)\*\*/.exec(m[1]);
    const item = (negrita ? negrita[1] : m[1].split(/(?<=[.!?])\s/)[0]).replace(/[*_`]/g, '').replace(/[.:]\s*$/, '').trim();
    if (item && !out.includes(item)) out.push(item.slice(0, 160));
  }
  return out.slice(0, 30);
}

/** Cómo está una parte: lista (todo ✓ o —), con avisos o con algo que falta, y la lista de lo que no está listo */
export function estadoParte(p: PartPreflight): { estado: 'listo' | 'aviso' | 'falta'; falta: string[] } {
  if (p.sinEmpezar) return { estado: 'falta', falta: [t('preflight.blockers.notStarted')] };
  const celdas = [p.compare, p.checklist, p.sync, p.ci, p.revision, p.bloqueos];
  const falta = celdas.filter(c => c.marca === 'mal' || c.marca === 'aviso').map(c => c.texto);
  return { estado: celdas.some(c => c.marca === 'mal') ? 'falta' : falta.length ? 'aviso' : 'listo', falta };
}

/** El pre-flight de una tarea: sus partes en todas las salas y el orden en que puede fusionarse */
export function preflightTarea(clave: string, d: PreflightInput): TaskPreflight {
  const K = clave.toUpperCase();
  const byUrl = new Map(d.prs.map(p => [p.url, p]));
  // los PR de la tarea (los cerrados sin fusionar ya no cuentan)
  const deLaTarea = d.prs.filter(p => p.estado !== 'cerrado' && pRTask(p) === K);
  const salaDe = (repo: string) => d.salas.find(s => sameRepo(s.repo, repo));
  const planDe = (salaId?: string) => d.plan?.find(x => x.salaId === salaId);
  const { waves, ciclo } = olasDespliegue(d.prs, d.bloqueos);
  const enCiclo = new Set(ciclo.map(p => p.url));
  const usadas = new Set<LocalBranch>();
  const comparar = (p: Parameters<typeof compareCell>[0]) => {
    const r = compareCell(p, d.compares ?? []);
    const items = d.checklist?.items ?? [], respuestas = p.worktree && p.headLocal ? d.checklist?.respuestas[checklistKey(p.worktree, p.headLocal)] : undefined;
    return { compare: r.celda, compareArchivo: r.archivo, checklist: checklistCell(p, items, respuestas), respuestas };
  };
  const partes: PartPreflight[] = [];

  const enlaces = (url: string) => ({
    esperaA: d.bloqueos.filter(b => b.de === url).map(b => byUrl.get(b.por) && linkOf(byUrl.get(b.por)!, b.motivo)).filter((x): x is PartLink => !!x),
    bloquea: d.bloqueos.filter(b => b.por === url).map(b => byUrl.get(b.de) && linkOf(byUrl.get(b.de)!, b.motivo)).filter((x): x is PartLink => !!x),
  });

  for (const pr of [...deLaTarea].sort((a, b) => a.repo.localeCompare(b.repo) || a.numero - b.numero)) {
    const sala = salaDe(pr.repo);
    // mejor la sacada en un worktree que la rama suelta
    const local = d.locales.filter(l => l.salaId === sala?.id && l.rama === pr.rama).sort((a, b) => Number(!!b.worktree) - Number(!!a.worktree))[0];
    if (local) usadas.add(local);
    const { esperaA, bloquea } = enlaces(pr.url);
    partes.push({
      id: pr.url, salaId: sala?.id, sala: sala?.nombre, repo: pr.repo, worktree: local?.worktree, rama: pr.rama, headLocal: local?.head,
      cambios: local?.worktree ? local.cambios : undefined, pr, plan: planDe(sala?.id)?.titulo,
      sync: syncCell(pr, local), ci: ciCell(pr), revision: reviewCell(pr), bloqueos: blockersCell(esperaA, bloquea, enCiclo.has(pr.url)), esperaA, bloquea,
      ...comparar({ worktree: local?.worktree, rama: pr.rama, headLocal: local?.worktree ? local.head : undefined, pr }), hilos: vivo(pr) ? d.hilos?.[pr.url] ?? [] : [],
    });
  }
  // worktrees de la tarea sin PR aún
  for (const l of d.locales) {
    if (usadas.has(l) || !l.worktree) continue;
    const sala = d.salas.find(s => s.id === l.salaId);
    partes.push({
      id: 'wt:' + l.worktree, salaId: l.salaId, sala: sala?.nombre, repo: sala?.repo, worktree: l.worktree, rama: l.rama, headLocal: l.head, cambios: l.cambios,
      plan: planDe(l.salaId)?.titulo, sync: syncCell(undefined, l), ci: ciCell(undefined), revision: reviewCell(undefined), bloqueos: blockersCell([], [], false), esperaA: [], bloquea: [],
      ...comparar({ worktree: l.worktree, rama: l.rama, headLocal: l.head }), hilos: [],
    });
  }
  // partes del plan sin nada aún
  for (const x of d.plan ?? []) {
    if (partes.some(p => p.salaId === x.salaId)) continue;
    const sala = d.salas.find(s => s.id === x.salaId);
    const nada: Cell = { marca: 'nada', texto: '—' };
    partes.push({ id: 'plan:' + x.salaId, salaId: x.salaId, sala: sala?.nombre ?? x.sala, repo: sala?.repo, plan: x.titulo, sinEmpezar: true, sync: nada, ci: nada, revision: nada, bloqueos: nada, compare: nada, checklist: nada, hilos: [], esperaA: [], bloquea: [] });
  }
  // lo que dice el plan que espera a una sala que aún no tiene PR: sin PR no hay bloqueo entre PR, pero se espera igual
  for (const x of d.plan ?? []) for (const id of x.waitA ?? []) {
    if (partes.some(p => p.salaId === id && p.pr)) continue;
    const otra = d.plan!.find(y => y.salaId === id);
    const link: PartLink = { ref: 'plan:' + id, motivo: 'plan', sala: d.salas.find(s => s.id === id)?.nombre ?? otra?.sala ?? id };
    for (const p of partes.filter(p => p.salaId === x.salaId && !p.sinEmpezar)) {
      p.esperaA.push(link);
      p.bloqueos = blockersCell(p.esperaA, p.bloquea, !!p.pr && enCiclo.has(p.pr.url));
    }
  }

  // las olas con lo de la tarea y lo que espera (directa o indirectamente), renumeradas
  const mias = new Set(deLaTarea.map(p => p.url));
  const cola = [...mias];
  while (cola.length) { const u = cola.shift()!; for (const b of d.bloqueos) if (b.de === u && !mias.has(b.por)) { mias.add(b.por); cola.push(b.por); } }
  const olas = waves.map(o => o.filter(p => mias.has(p.url)).map(refPR)).filter(o => o.length);
  return { clave: K, color: d.color, titulo: d.titulo, partes, olas, ciclo: ciclo.filter(p => mias.has(p.url)).map(refPR),
    checklist: d.checklist?.items ?? [],
    compareTarea: (d.compares ?? []).filter(c => c.tarea?.toUpperCase() === K).sort((a, b) => b.ts - a.ts)[0], demo: d.demo, error: d.error };
}
