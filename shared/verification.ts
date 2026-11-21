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

export interface Evidence { text: string; ts: number }
export interface Signal {
  id: string;
  type: SignalKind;
  what: string;            // what it proves (for the final checkpoint, an acceptance criterion)
  where: string;          // where to look: service, query or log text, in the provider's terms
  base?: string;          // the baseline before the change
  state: SignalState;
  evidence?: Evidence;
}
export interface Checkpoint {
  id: string;
  type: 'pr' | 'final';
  pr?: string;            // org/repo#N, for a PR's checkpoint
  title: string;
  services: string[];    // where it deploys; none: one «live» report is enough
  live: Record<string, number>;   // service → when it was reported live
  deadlineHours: number;
  state: CheckpointState;
  open?: number;       // when it opened: its PR merged (the final one: every PR merged, or the tracker's prod-check)
  since?: number;         // when its deadline started: on opening, again once every service is live, and on «wait»
  stuck?: CheckpointState;   // the state it was in when it turned inconclusive (no deploy or no traffic)
  signals: Signal[];
  note?: Evidence;        // a failure without a signal, the reason it was accepted or why it waits more
  // the game's rechecks (server/verifications.ts): how many were scheduled, the pending one, and whether the Overseer
  // was told it turned inconclusive
  rechecks?: number;
  scheduled?: string;
  notified?: boolean;
}
/** The conversation that proposed the plan: where its rechecks go (a scheduled message's target, shared/scheduled.ts) */
export interface PlanConversation { roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }
export interface VerificationPlan {
  key: string;
  version: number;
  updated: number;
  approved?: { version: number; ts: number };
  conversation?: PlanConversation;
  points: Checkpoint[];
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

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; vars?: Record<string, string | number> };
const fail = (error: string, vars?: Record<string, string | number>): { ok: false; error: string; vars?: Record<string, string | number> } => ({ ok: false, error, vars });

/** A PR as `org/repo#N` (also from its GitHub URL), lowercase so it compares with refPR */
export function prRef(s: string): string | undefined {
  const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(s) ?? /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(s.trim());
  return m ? `${m[1].toLowerCase()}#${Number(m[2])}` : undefined;
}

const ID = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const txt = (s: unknown, n = MAX_TEXT) => String(s ?? '').trim().slice(0, n);
export const isApproved = (p: VerificationPlan) => p.approved?.version === p.version;
export const isClosed = (c: Checkpoint) => c.state === 'evidenced' || c.state === 'failed';
export const finalCheckpoint = (p: VerificationPlan) => p.points.find(c => c.type === 'final');

/** A new plan or an update of `antes`. Checkpoints and signals keep their state and evidence while what they check
 *  stays the same (same id, kind and where); a changed signal starts again. Any change to the content is a new version,
 *  so it needs approving again. Errors are keys under `verification.error.*` */
export function proposePlan(key: string, input: PlanInput, before: VerificationPlan | undefined, now: number): Result<VerificationPlan> {
  const cps = Array.isArray(input?.checkpoints) ? input.checkpoints : [];
  if (!cps.length || cps.length > MAX_CHECKPOINTS) return fail('noCheckpoints', { n: MAX_CHECKPOINTS });
  if (cps.filter(c => c?.kind === 'final').length !== 1) return fail('oneFinal');
  const ids = new Set<string>();
  const points: Checkpoint[] = [];
  for (const c of cps) {
    const id = txt(c?.id, 40);
    if (!ID.test(id) || ids.has(id)) return fail('badId', { id });
    ids.add(id);
    if (c.kind !== 'pr' && c.kind !== 'final') return fail('badCheckpointKind', { id });
    const pr = c.kind === 'pr' ? prRef(txt(c.pr, 200)) : undefined;
    if (c.kind === 'pr' && !pr) return fail('prNeedsRef', { id });
    const times = c.deadline_hours == null ? DEFAULT_DEADLINE_HOURS : Number(c.deadline_hours);
    if (!(times > 0 && times <= MAX_DEADLINE_HOURS)) return fail('badDeadline', { id, max: MAX_DEADLINE_HOURS });
    const sigs = Array.isArray(c.signals) ? c.signals : [];
    if (!sigs.length || sigs.length > MAX_SIGNALS) return fail('noSignals', { id, n: MAX_SIGNALS });
    const old = before?.points.find(x => x.id === id);
    const sids = new Set<string>();
    const signals: Signal[] = [];
    for (const s of sigs) {
      const sid = txt(s?.id, 40);
      if (!ID.test(sid) || sids.has(sid)) return fail('badId', { id: `${id}/${sid}` });
      sids.add(sid);
      if (!SIGNAL_KINDS.includes(s.kind as SignalKind)) return fail('badSignalKind', { id: `${id}/${sid}`, kinds: SIGNAL_KINDS.join(', ') });
      const what = txt(s.what), where = txt(s.where);
      if (!what || !where) return fail('signalNeedsWhatWhere', { id: `${id}/${sid}` });
      const base = txt(s.baseline) || undefined;
      const prev = old?.signals.find(x => x.id === sid && x.type === s.kind && x.where === where);
      signals.push({ id: sid, type: s.kind as SignalKind, what, where, ...(base ? { base } : {}), state: prev?.state ?? 'pending', ...(prev?.evidence ? { evidence: prev.evidence } : {}) });
    }
    const services = [...new Set((Array.isArray(c.services) ? c.services : []).map(x => txt(x, 100)).filter(Boolean))];
    const live = Object.fromEntries(Object.entries(old?.live ?? {}).filter(([k]) => services.includes(k)));
    const p: Checkpoint = { id, type: c.kind, ...(pr ? { pr } : {}), title: txt(c.title, 200) || (pr ?? id), services, live, deadlineHours: times,
      state: 'waiting-deploy', signals };
    for (const k of ['open', 'since', 'stuck', 'note', 'rechecks', 'scheduled', 'notified'] as const) if (old?.[k] != null) (p as any)[k] = old[k];
    p.state = old && (old.state === 'failed' || old.state === 'inconclusive' || (old.state === 'evidenced' && old.note)) ? old.state : derive(p);
    points.push(p);
  }
  const plan: VerificationPlan = { key, version: before?.version ?? 1, updated: now, ...(before?.approved ? { approved: before.approved } : {}),
    ...(before?.conversation ? { conversation: before.conversation } : {}), points };
  if (before && content(before) !== content(plan)) plan.version = before.version + 1;
  return { ok: true, value: plan };
}
// what the Overseer approves: the checkpoints and signals as written, not their states
const content = (p: VerificationPlan) => JSON.stringify(p.points.map(c => [c.id, c.type, c.pr, c.title, c.services, c.deadlineHours, c.signals.map(s => [s.id, s.type, s.what, s.where, s.base])]));

/** The state that follows from what's recorded: deploy, then traffic, then the signals' verdict */
function derive(c: Checkpoint): CheckpointState {
  const live = Object.keys(c.live).length;
  const all = c.services.length ? c.services.every(s => c.live[s]) : live > 0;
  if (!all) return live ? 'live' : 'waiting-deploy';
  if (c.signals.some(s => s.state === 'failed')) return 'failed';
  if (c.signals.every(s => s.state === 'evidenced')) return 'evidenced';
  return 'waiting-traffic';
}

/** Records what a dweller found and moves the checkpoint (errors are keys under `verification.error.*`):
 *  - live: a service (or, with none listed, the checkpoint) is deployed; with every one live, waiting for traffic starts
 *  - evidenced / failed with a signal: its verdict, with the evidence; failed without one fails the whole checkpoint
 *  - wait: the Overseer chose to wait more (from inconclusive or while waiting): the deadline starts again, `hours` long
 *  - accept: the Overseer accepted an inconclusive checkpoint, with the reason as evidence */
export function report(plan: VerificationPlan, r: ReportInput, now: number): Result<VerificationPlan> {
  const i = plan.points.findIndex(c => c.id === String(r?.checkpoint ?? '').trim());
  if (i < 0) return fail('noCheckpoint', { id: String(r?.checkpoint ?? ''), ids: plan.points.map(c => c.id).join(', ') });
  const c: Checkpoint = structuredClone(plan.points[i]);
  const evidence = txt(r.evidence);
  const ev = evidence ? { text: evidence, ts: now } : undefined;
  if (isClosed(c)) return fail('closed', { id: c.id, state: c.state });
  switch (r.event) {
    case 'live': {
      const s = txt(r.service, 100);
      if (c.services.length && !c.services.includes(s)) return fail('noService', { id: c.id, services: c.services.join(', ') });
      c.live[s || c.id] ??= now;
      break;
    }
    case 'evidenced': case 'failed': {
      if (!ev) return fail('needsEvidence');
      if (!r.signal && r.event === 'failed') { c.note = ev; c.state = 'failed'; break; }
      const s = c.signals.find(x => x.id === String(r.signal ?? '').trim());
      if (!s) return fail('noSignal', { id: c.id, ids: c.signals.map(x => x.id).join(', ') });
      // no evidence from production before what it checks is there
      if (c.state === 'waiting-deploy' || c.state === 'live') return fail('notLive', { id: c.id });
      s.state = r.event; s.evidence = ev;
      break;
    }
    case 'wait': {
      if (c.state !== 'inconclusive' && c.state !== 'waiting-traffic') return fail('cannotWait', { id: c.id, state: c.state });
      const h = r.hours == null ? c.deadlineHours : Number(r.hours);
      if (!(h > 0 && h <= MAX_DEADLINE_HOURS)) return fail('badDeadline', { id: c.id, max: MAX_DEADLINE_HOURS });
      c.deadlineHours = h; c.since = now; c.state = derive(c); delete c.stuck; c.notified = false; if (ev) c.note = ev;
      break;
    }
    case 'accept': {
      if (c.state !== 'inconclusive') return fail('cannotAccept', { id: c.id, state: c.state });
      if (!ev) return fail('needsEvidence');
      c.note = ev; c.state = 'evidenced';
      break;
    }
    default: return fail('badEvent', { events: REPORT_EVENTS.join(', ') });
  }
  if (r.event === 'live' || r.event === 'evidenced' || (r.event === 'failed' && r.signal)) {
    const before = c.state;
    c.state = derive(c);
    if (c.state === 'waiting-traffic' && before !== 'waiting-traffic' && before !== 'inconclusive') c.since = now;
    if (before === 'inconclusive' && c.state !== 'waiting-traffic') delete c.stuck;
    // an inconclusive checkpoint stays so until the Overseer chooses, unless the traffic finally came
    if (before === 'inconclusive' && c.state === 'waiting-traffic') c.state = 'inconclusive';
  }
  const points = plan.points.map((x, j) => (j === i ? c : x));
  return { ok: true, value: { ...plan, updated: now, points } };
}

/** When a checkpoint's deadline passes: `desde` + its hours */
export const deadlineOf = (c: Checkpoint) => (c.since != null ? c.since + c.deadlineHours * 3_600_000 : undefined);

/** Open checkpoints past their deadline, still waiting for their deploy or their traffic, turn inconclusive (the same
 *  plan if none did) */
export function expire(plan: VerificationPlan, now: number): VerificationPlan {
  const overdue = (c: Checkpoint) => (c.state === 'waiting-traffic' || c.state === 'waiting-deploy' || c.state === 'live') && (deadlineOf(c) ?? Infinity) <= now;
  if (!plan.points.some(overdue)) return plan;
  return { ...plan, points: plan.points.map(c => (overdue(c) ? { ...c, state: 'inconclusive' as const, stuck: c.state } : c)) };
}

/** The task's PRs as the game sees them on GitHub */
export interface TaskPR { ref: string; merged: boolean }
/** Opens what's due (the same plan if nothing is): a PR checkpoint when its PR merges; the final one when every PR of the
 *  task is merged (those of its checkpoints and the others the game sees) and the PR checkpoints are settled, or when the
 *  tracker has the task in its prod-check status. Opening starts the deadline */
export function openCheckpoints(plan: VerificationPlan, prs: TaskPR[], inProdCheck: boolean, now: number): VerificationPlan {
  const merged = new Set(prs.filter(p => p.merged).map(p => p.ref.toLowerCase()));
  const fromCheckpoints = plan.points.filter(c => c.pr).map(c => c.pr!);
  const all = [...new Set([...prs.map(p => p.ref.toLowerCase()), ...fromCheckpoints])];
  // the final one after the PRs' own: once none of them is still being rechecked (closed, or waiting for the Overseer)
  const resolvedPrs = plan.points.every(c => c.type !== 'pr' || isClosed(c) || c.state === 'inconclusive');
  const allMerged = all.length > 0 && all.every(r => merged.has(r)) && resolvedPrs;
  const opener = (c: Checkpoint) => c.open == null && !isClosed(c) && (c.type === 'pr' ? merged.has(c.pr ?? '') : allMerged || inProdCheck);
  if (!plan.points.some(opener)) return plan;
  return { ...plan, points: plan.points.map(c => (opener(c) ? { ...c, open: now, since: c.state === 'waiting-traffic' ? c.since ?? now : now } : c)) };
}

/** Whether the game keeps rechecking it: open, not closed, and not waiting for the Overseer's call */
export const needsRecheck = (c: Checkpoint) => c.open != null && !isClosed(c) && c.state !== 'inconclusive';

/** When the n-th recheck (from 0) goes: 30 min, 2 h, then each next morning at `hora` (weekends held to Monday by the
 *  scheduler) */
export function recheckAt(n: number, now: number, time = 9): number {
  if (n <= 0) return now + 30 * 60_000;
  if (n === 1) return now + 2 * 3_600_000;
  const f = new Date(now);
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1, time, 0, 0).getTime();
}

/** The board a task belongs to: its key's prefix (ABC-123 → ABC; a Jira project, a Linear team). Jira has one prod-check
 *  and done pair for all its projects; each Linear team has its own */
export const boardOf = (key: string) => /^([A-Z][A-Z0-9]+)-\d+$/i.exec(key.trim())?.[1]?.toUpperCase();
/** The tracker's statuses for production verification: Jira's (linked by the game or picked in the vault), a Linear team's */
export interface BoardStatuses { test?: string; done?: string }
/** What the pre-flight shows of the tracker: the task's status and, once verified, whether it can move to done */
export interface TaskTracker { source: 'jira' | 'linear'; state: string; board: string; test?: string; done?: string; inProdCheck: boolean; move: boolean }
export const sameStatus = (a: string | undefined, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The task's verdict: its final checkpoint's state (undefined without a plan) */
export const planState = (p: VerificationPlan | undefined): CheckpointState | undefined => (p ? finalCheckpoint(p)?.state : undefined);

// their labels (shared/texts/verification.ts)
export const STATE_TEXT: Record<CheckpointState, string> = { 'waiting-deploy': 'verification.state.waitingDeploy', live: 'verification.state.live',
  'waiting-traffic': 'verification.state.waitingTraffic', evidenced: 'verification.state.evidenced', failed: 'verification.state.failed', inconclusive: 'verification.state.inconclusive' };
export const KIND_TEXT: Record<SignalKind, string> = { 'must-disappear': 'verification.kind.mustDisappear', 'must-appear': 'verification.kind.mustAppear',
  'must-run': 'verification.kind.mustRun', 'no-new-errors': 'verification.kind.noNewErrors' };

/** What the boards and holograms show of a task's verification: its final checkpoint's state and each PR's */
export interface VerificationSummary { final?: CheckpointState; stuck?: CheckpointState; prs: Record<string, CheckpointState>; open: boolean }
export function summaryOf(p: VerificationPlan): VerificationSummary {
  const f = finalCheckpoint(p);
  return { final: f?.state, ...(f?.stuck && f.state === 'inconclusive' ? { stuck: f.stuck } : {}), prs: Object.fromEntries(p.points.filter(c => c.pr).map(c => [c.pr!, c.state])),
    open: p.points.some(c => c.open != null || isClosed(c)) };
}

/** Only plans that look like one (what's read from disk) */
export function validPlan(x: any): x is VerificationPlan {
  return !!x && typeof x.key === 'string' && Number.isInteger(x.version) && Array.isArray(x.points)
    && x.points.every((c: any) => c && typeof c.id === 'string' && CHECKPOINT_STATES.includes(c.state) && Array.isArray(c.signals) && Array.isArray(c.services) && c.live && typeof c.live === 'object');
}
