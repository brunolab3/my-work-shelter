// Production verification of a task (plan: plans/2026-11-17-production-verification.md). The dweller of the task's
// conversation proposes a plan with verification_plan, the Overseer approves it in the pre-flight, and the dweller records
// what it finds with verification_report. The plan has checkpoints: one per PR (optional, a smoke check) and a final one
// for the task (required). Each checkpoint has signals, written in the observability connector's own terms (the game
// queries nothing itself). A checkpoint moves waiting-deploy → live (some services) → waiting-traffic (all live; its
// deadline starts again) → evidenced | failed, or inconclusive when the deadline passes first. From inconclusive the
// Overseer chooses: wait more or accept it with a reason. A checkpoint opens when its PR merges (the final one when every
// PR of the task has, or when the tracker puts the task in its prod-check status): its deadline starts, and the game
// rechecks it in the task's conversation with backoff (server/verifications.ts) until it closes or turns inconclusive.
// Pure: a state machine shared by the server, the client and the tests.

export type SignalKind = 'must-disappear' | 'must-appear' | 'must-run' | 'no-new-errors';
export const SIGNAL_KINDS: SignalKind[] = ['must-disappear', 'must-appear', 'must-run', 'no-new-errors'];
export type SignalState = 'pending' | 'evidenced' | 'failed';
export type CheckpointState = 'waiting-deploy' | 'live' | 'waiting-traffic' | 'evidenced' | 'failed' | 'inconclusive';
export const CHECKPOINT_STATES: CheckpointState[] = ['waiting-deploy', 'live', 'waiting-traffic', 'evidenced', 'failed', 'inconclusive'];
export const DEFAULT_DEADLINE_HOURS = 24;
const MAX_DEADLINE_HOURS = 24 * 14, MAX_TEXT = 2000, MAX_CHECKPOINTS = 20, MAX_SIGNALS = 20;

export interface Evidence { texto: string; ts: number }
export interface Signal {
  id: string;
  tipo: SignalKind;
  que: string;            // what it proves (for the final checkpoint, an acceptance criterion)
  donde: string;          // where to look: service, query or log text, in the provider's terms
  base?: string;          // the baseline before the change
  estado: SignalState;
  evidencia?: Evidence;
}
export interface Checkpoint {
  id: string;
  tipo: 'pr' | 'final';
  pr?: string;            // org/repo#N, for a PR's checkpoint
  titulo: string;
  servicios: string[];    // where it deploys; none: one «live» report is enough
  vivos: Record<string, number>;   // service → when it was reported live
  plazoHoras: number;
  estado: CheckpointState;
  abierto?: number;       // when it opened: its PR merged (the final one: every PR merged, or the tracker's prod-check)
  desde?: number;         // when its deadline started: on opening, again once every service is live, and on «wait»
  atascado?: CheckpointState;   // the state it was in when it turned inconclusive (no deploy or no traffic)
  señales: Signal[];
  nota?: Evidence;        // a failure without a signal, the reason it was accepted or why it waits more
  // the game's rechecks (server/verifications.ts): how many were scheduled, the pending one, and whether the Overseer
  // was told it turned inconclusive
  rechequeos?: number;
  programado?: string;
  avisado?: boolean;
}
/** The conversation that proposed the plan: where its rechecks go (a scheduled message's target, shared/scheduled.ts) */
export interface PlanConversation { salaId: string; sesionId?: string; claudeId?: string; cwd: string; titulo?: string }
export interface VerificationPlan {
  clave: string;
  version: number;
  actualizado: number;
  aprobado?: { version: number; ts: number };
  conversacion?: PlanConversation;
  puntos: Checkpoint[];
}

/** What a dweller sends with verification_plan (English fields, as the tool's) */
export interface PlanInput {
  checkpoints: {
    id: string; kind: 'pr' | 'final'; pr?: string; title?: string; services?: string[]; deadline_hours?: number;
    signals: { id: string; kind: string; what: string; where: string; baseline?: string }[];
  }[];
}
export type ReportEvent = 'live' | 'evidenced' | 'failed' | 'wait' | 'accept';
export const REPORT_EVENTS: ReportEvent[] = ['live', 'evidenced', 'failed', 'wait', 'accept'];
export interface ReportInput { checkpoint: string; event: ReportEvent; signal?: string; service?: string; evidence?: string; hours?: number }

export type Result<T> = { ok: true; valor: T } | { ok: false; error: string; vars?: Record<string, string | number> };
const mal = (error: string, vars?: Record<string, string | number>): { ok: false; error: string; vars?: Record<string, string | number> } => ({ ok: false, error, vars });

/** A PR as `org/repo#N` (also from its GitHub URL), lowercase so it compares with refPR */
export function prRef(s: string): string | undefined {
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(s) ?? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s.trim());
  return m ? `${m[1].toLowerCase()}#${Number(m[2])}` : undefined;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const txt = (s: unknown, n = MAX_TEXT) => String(s ?? '').trim().slice(0, n);
export const isApproved = (p: VerificationPlan) => p.aprobado?.version === p.version;
export const isClosed = (c: Checkpoint) => c.estado === 'evidenced' || c.estado === 'failed';
export const finalCheckpoint = (p: VerificationPlan) => p.puntos.find(c => c.tipo === 'final');

/** A new plan or an update of `antes`. Checkpoints and signals keep their state and evidence while what they check
 *  stays the same (same id, kind and where); a changed signal starts again. Any change to the content is a new version,
 *  so it needs approving again. Errors are keys under `verification.error.*` */
export function proposePlan(clave: string, input: PlanInput, antes: VerificationPlan | undefined, ahora: number): Result<VerificationPlan> {
  const cps = Array.isArray(input?.checkpoints) ? input.checkpoints : [];
  if (!cps.length || cps.length > MAX_CHECKPOINTS) return mal('noCheckpoints', { n: MAX_CHECKPOINTS });
  if (cps.filter(c => c?.kind === 'final').length !== 1) return mal('oneFinal');
  const ids = new Set<string>();
  const puntos: Checkpoint[] = [];
  for (const c of cps) {
    const id = txt(c?.id, 40);
    if (!ID.test(id) || ids.has(id)) return mal('badId', { id });
    ids.add(id);
    if (c.kind !== 'pr' && c.kind !== 'final') return mal('badCheckpointKind', { id });
    const pr = c.kind === 'pr' ? prRef(txt(c.pr, 200)) : undefined;
    if (c.kind === 'pr' && !pr) return mal('prNeedsRef', { id });
    const horas = c.deadline_hours == null ? DEFAULT_DEADLINE_HOURS : Number(c.deadline_hours);
    if (!(horas > 0 && horas <= MAX_DEADLINE_HOURS)) return mal('badDeadline', { id, max: MAX_DEADLINE_HOURS });
    const sigs = Array.isArray(c.signals) ? c.signals : [];
    if (!sigs.length || sigs.length > MAX_SIGNALS) return mal('noSignals', { id, n: MAX_SIGNALS });
    const viejo = antes?.puntos.find(x => x.id === id);
    const sids = new Set<string>();
    const señales: Signal[] = [];
    for (const s of sigs) {
      const sid = txt(s?.id, 40);
      if (!ID.test(sid) || sids.has(sid)) return mal('badId', { id: `${id}/${sid}` });
      sids.add(sid);
      if (!SIGNAL_KINDS.includes(s.kind as SignalKind)) return mal('badSignalKind', { id: `${id}/${sid}`, kinds: SIGNAL_KINDS.join(', ') });
      const que = txt(s.what), donde = txt(s.where);
      if (!que || !donde) return mal('signalNeedsWhatWhere', { id: `${id}/${sid}` });
      const base = txt(s.baseline) || undefined;
      const prev = viejo?.señales.find(x => x.id === sid && x.tipo === s.kind && x.donde === donde);
      señales.push({ id: sid, tipo: s.kind as SignalKind, que, donde, ...(base ? { base } : {}), estado: prev?.estado ?? 'pending', ...(prev?.evidencia ? { evidencia: prev.evidencia } : {}) });
    }
    const servicios = [...new Set((Array.isArray(c.services) ? c.services : []).map(x => txt(x, 100)).filter(Boolean))];
    const vivos = Object.fromEntries(Object.entries(viejo?.vivos ?? {}).filter(([k]) => servicios.includes(k)));
    const p: Checkpoint = { id, tipo: c.kind, ...(pr ? { pr } : {}), titulo: txt(c.title, 200) || (pr ?? id), servicios, vivos, plazoHoras: horas,
      estado: 'waiting-deploy', señales };
    for (const k of ['abierto', 'desde', 'atascado', 'nota', 'rechequeos', 'programado', 'avisado'] as const) if (viejo?.[k] != null) (p as any)[k] = viejo[k];
    p.estado = viejo && (viejo.estado === 'failed' || viejo.estado === 'inconclusive' || (viejo.estado === 'evidenced' && viejo.nota)) ? viejo.estado : derive(p);
    puntos.push(p);
  }
  const plan: VerificationPlan = { clave, version: antes?.version ?? 1, actualizado: ahora, ...(antes?.aprobado ? { aprobado: antes.aprobado } : {}),
    ...(antes?.conversacion ? { conversacion: antes.conversacion } : {}), puntos };
  if (antes && content(antes) !== content(plan)) plan.version = antes.version + 1;
  return { ok: true, valor: plan };
}
// what the Overseer approves: the checkpoints and signals as written, not their states
const content = (p: VerificationPlan) => JSON.stringify(p.puntos.map(c => [c.id, c.tipo, c.pr, c.titulo, c.servicios, c.plazoHoras, c.señales.map(s => [s.id, s.tipo, s.que, s.donde, s.base])]));

/** The state that follows from what's recorded: deploy, then traffic, then the signals' verdict */
function derive(c: Checkpoint): CheckpointState {
  const vivos = Object.keys(c.vivos).length;
  const todos = c.servicios.length ? c.servicios.every(s => c.vivos[s]) : vivos > 0;
  if (!todos) return vivos ? 'live' : 'waiting-deploy';
  if (c.señales.some(s => s.estado === 'failed')) return 'failed';
  if (c.señales.every(s => s.estado === 'evidenced')) return 'evidenced';
  return 'waiting-traffic';
}

/** Records what a dweller found and moves the checkpoint (errors are keys under `verification.error.*`):
 *  - live: a service (or, with none listed, the checkpoint) is deployed; with every one live, waiting for traffic starts
 *  - evidenced / failed with a signal: its verdict, with the evidence; failed without one fails the whole checkpoint
 *  - wait: the Overseer chose to wait more (from inconclusive or while waiting): the deadline starts again, `hours` long
 *  - accept: the Overseer accepted an inconclusive checkpoint, with the reason as evidence */
export function report(plan: VerificationPlan, r: ReportInput, ahora: number): Result<VerificationPlan> {
  const i = plan.puntos.findIndex(c => c.id === String(r?.checkpoint ?? '').trim());
  if (i < 0) return mal('noCheckpoint', { id: String(r?.checkpoint ?? ''), ids: plan.puntos.map(c => c.id).join(', ') });
  const c: Checkpoint = structuredClone(plan.puntos[i]);
  const evidencia = txt(r.evidence);
  const ev = evidencia ? { texto: evidencia, ts: ahora } : undefined;
  if (isClosed(c)) return mal('closed', { id: c.id, estado: c.estado });
  switch (r.event) {
    case 'live': {
      const s = txt(r.service, 100);
      if (c.servicios.length && !c.servicios.includes(s)) return mal('noService', { id: c.id, servicios: c.servicios.join(', ') });
      c.vivos[s || c.id] ??= ahora;
      break;
    }
    case 'evidenced': case 'failed': {
      if (!ev) return mal('needsEvidence');
      if (!r.signal && r.event === 'failed') { c.nota = ev; c.estado = 'failed'; break; }
      const s = c.señales.find(x => x.id === String(r.signal ?? '').trim());
      if (!s) return mal('noSignal', { id: c.id, ids: c.señales.map(x => x.id).join(', ') });
      // no evidence from production before what it checks is there
      if (c.estado === 'waiting-deploy' || c.estado === 'live') return mal('notLive', { id: c.id });
      s.estado = r.event; s.evidencia = ev;
      break;
    }
    case 'wait': {
      if (c.estado !== 'inconclusive' && c.estado !== 'waiting-traffic') return mal('cannotWait', { id: c.id, estado: c.estado });
      const h = r.hours == null ? c.plazoHoras : Number(r.hours);
      if (!(h > 0 && h <= MAX_DEADLINE_HOURS)) return mal('badDeadline', { id: c.id, max: MAX_DEADLINE_HOURS });
      c.plazoHoras = h; c.desde = ahora; c.estado = derive(c); delete c.atascado; c.avisado = false; if (ev) c.nota = ev;
      break;
    }
    case 'accept': {
      if (c.estado !== 'inconclusive') return mal('cannotAccept', { id: c.id, estado: c.estado });
      if (!ev) return mal('needsEvidence');
      c.nota = ev; c.estado = 'evidenced';
      break;
    }
    default: return mal('badEvent', { eventos: REPORT_EVENTS.join(', ') });
  }
  if (r.event === 'live' || r.event === 'evidenced' || (r.event === 'failed' && r.signal)) {
    const antes = c.estado;
    c.estado = derive(c);
    if (c.estado === 'waiting-traffic' && antes !== 'waiting-traffic' && antes !== 'inconclusive') c.desde = ahora;
    if (antes === 'inconclusive' && c.estado !== 'waiting-traffic') delete c.atascado;
    // an inconclusive checkpoint stays so until the Overseer chooses, unless the traffic finally came
    if (antes === 'inconclusive' && c.estado === 'waiting-traffic') c.estado = 'inconclusive';
  }
  const puntos = plan.puntos.map((x, j) => (j === i ? c : x));
  return { ok: true, valor: { ...plan, actualizado: ahora, puntos } };
}

/** When a checkpoint's deadline passes: `desde` + its hours */
export const deadlineOf = (c: Checkpoint) => (c.desde != null ? c.desde + c.plazoHoras * 3_600_000 : undefined);

/** Open checkpoints past their deadline, still waiting for their deploy or their traffic, turn inconclusive (the same
 *  plan if none did) */
export function expire(plan: VerificationPlan, ahora: number): VerificationPlan {
  const vencido = (c: Checkpoint) => (c.estado === 'waiting-traffic' || c.estado === 'waiting-deploy' || c.estado === 'live') && (deadlineOf(c) ?? Infinity) <= ahora;
  if (!plan.puntos.some(vencido)) return plan;
  return { ...plan, puntos: plan.puntos.map(c => (vencido(c) ? { ...c, estado: 'inconclusive' as const, atascado: c.estado } : c)) };
}

/** The task's PRs as the game sees them on GitHub */
export interface TaskPR { ref: string; fusionado: boolean }
/** Opens what's due (the same plan if nothing is): a PR checkpoint when its PR merges; the final one when every PR of the
 *  task is merged (those of its checkpoints and the others the game sees) and the PR checkpoints are settled, or when the
 *  tracker has the task in its prod-check status. Opening starts the deadline */
export function openCheckpoints(plan: VerificationPlan, prs: TaskPR[], enPrueba: boolean, ahora: number): VerificationPlan {
  const merged = new Set(prs.filter(p => p.fusionado).map(p => p.ref.toLowerCase()));
  const deCheckpoints = plan.puntos.filter(c => c.pr).map(c => c.pr!);
  const todos = [...new Set([...prs.map(p => p.ref.toLowerCase()), ...deCheckpoints])];
  // the final one after the PRs' own: once none of them is still being rechecked (closed, or waiting for the Overseer)
  const prsResueltos = plan.puntos.every(c => c.tipo !== 'pr' || isClosed(c) || c.estado === 'inconclusive');
  const todoFusionado = todos.length > 0 && todos.every(r => merged.has(r)) && prsResueltos;
  const abre = (c: Checkpoint) => c.abierto == null && !isClosed(c) && (c.tipo === 'pr' ? merged.has(c.pr ?? '') : todoFusionado || enPrueba);
  if (!plan.puntos.some(abre)) return plan;
  return { ...plan, puntos: plan.puntos.map(c => (abre(c) ? { ...c, abierto: ahora, desde: c.estado === 'waiting-traffic' ? c.desde ?? ahora : ahora } : c)) };
}

/** Whether the game keeps rechecking it: open, not closed, and not waiting for the Overseer's call */
export const needsRecheck = (c: Checkpoint) => c.abierto != null && !isClosed(c) && c.estado !== 'inconclusive';

/** When the n-th recheck (from 0) goes: 30 min, 2 h, then each next morning at `hora` (weekends held to Monday by the
 *  scheduler) */
export function recheckAt(n: number, ahora: number, hora = 9): number {
  if (n <= 0) return ahora + 30 * 60_000;
  if (n === 1) return ahora + 2 * 3_600_000;
  const f = new Date(ahora);
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1, hora, 0, 0).getTime();
}

/** The board a task belongs to: its key's prefix (ABC-123 → ABC; a Jira project, a Linear team). Each board has its own
 *  workflow, so the tracker's prod-check and done statuses are set per board */
export const boardOf = (clave: string) => /^([A-Z][A-Z0-9]+)-\d+$/i.exec(clave.trim())?.[1]?.toUpperCase();
/** A board's statuses for production verification, set by the Overseer when connecting the tracker */
export interface BoardStatuses { prueba?: string; hecho?: string }
/** What the pre-flight shows of the tracker: the task's status and, once verified, whether it can move to done */
export interface TaskTracker { fuente: 'jira' | 'linear'; estado: string; tablero: string; prueba?: string; hecho?: string; enPrueba: boolean; mover: boolean }
export const sameStatus = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The task's verdict: its final checkpoint's state (undefined without a plan) */
export const planState = (p: VerificationPlan | undefined): CheckpointState | undefined => (p ? finalCheckpoint(p)?.estado : undefined);

// their labels (shared/texts/verification.ts)
export const STATE_TEXT: Record<CheckpointState, string> = { 'waiting-deploy': 'verification.state.waitingDeploy', live: 'verification.state.live',
  'waiting-traffic': 'verification.state.waitingTraffic', evidenced: 'verification.state.evidenced', failed: 'verification.state.failed', inconclusive: 'verification.state.inconclusive' };
export const KIND_TEXT: Record<SignalKind, string> = { 'must-disappear': 'verification.kind.mustDisappear', 'must-appear': 'verification.kind.mustAppear',
  'must-run': 'verification.kind.mustRun', 'no-new-errors': 'verification.kind.noNewErrors' };

/** What the boards and holograms show of a task's verification: its final checkpoint's state and each PR's */
export interface VerificationSummary { final?: CheckpointState; atascado?: CheckpointState; prs: Record<string, CheckpointState>; abierto: boolean }
export function summaryOf(p: VerificationPlan): VerificationSummary {
  const f = finalCheckpoint(p);
  return { final: f?.estado, ...(f?.atascado && f.estado === 'inconclusive' ? { atascado: f.atascado } : {}), prs: Object.fromEntries(p.puntos.filter(c => c.pr).map(c => [c.pr!, c.estado])),
    abierto: p.puntos.some(c => c.abierto != null || isClosed(c)) };
}

/** Only plans that look like one (what's read from disk) */
export function validPlan(x: any): x is VerificationPlan {
  return !!x && typeof x.clave === 'string' && Number.isInteger(x.version) && Array.isArray(x.puntos)
    && x.puntos.every((c: any) => c && typeof c.id === 'string' && CHECKPOINT_STATES.includes(c.estado) && Array.isArray(c.señales) && Array.isArray(c.servicios) && c.vivos && typeof c.vivos === 'object');
}
