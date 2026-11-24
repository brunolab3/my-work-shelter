// The tasks' production verification plans (model in shared/verification.ts), saved in DATOS/verifications.json by task
// key: the dweller writes them with verification_plan and verification_report (MCP `rooms`, roomNotices.ts) and the
// Overseer approves them in the pre-flight. The game queries nothing itself: the evidence is what the dweller found with
// its own observability connector. Deadlines are checked whenever a plan is read. Every few minutes (repasar, main.ts)
// the game opens the checkpoints whose PR merged (the final one once all have, or when the tracker puts the task in the
// board's prod-check status) and schedules their rechecks in the conversation that proposed the plan, as scheduled
// messages with backoff; a checkpoint that closes or turns inconclusive is told to the Overseer once, and an
// inconclusive one also to that conversation, to ask the Overseer: wait more, exercise it, or accept it with a reason.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { t } from '../shared/language.ts';
import { describeWhen } from '../shared/scheduled.ts';
import { deadlineOf, expire, isApproved, isClosed, needsRecheck, openCheckpoints, proposePlan, recheckAt, report, validPlan, KIND_TEXT, STATE_TEXT,
  type Checkpoint, type PlanConversation, type PlanInput, type ReportInput, type Result, type TaskPR, type VerificationPlan } from '../shared/verification.ts';

export interface CtxRecheck {
  prs(key: string, plan: VerificationPlan): Promise<TaskPR[]>;
  inProdCheck(key: string): Promise<boolean>;   // the tracker has the task in its board's prod-check status
  // a scheduled message to the plan's conversation (scheduled.ts): its id, or none if it couldn't be scheduled
  schedule(c: PlanConversation, when: number, message: string): string | undefined;
  pending(id: string): boolean;
  cancel(id: string): void;
  notify(text: string, level: 'info' | 'warning'): void;
}

const MAX_PLANS = 100;

export class Verifications {
  private plans: Record<string, VerificationPlan> = {};
  private file: string;
  constructor(dir: string, private now: () => number = Date.now, private changed: (key: string) => void = () => {}) {
    this.file = path.join(dir, 'verifications.json');
    try {
      if (existsSync(this.file)) {
        const j = JSON.parse(readFileSync(this.file, 'utf8'))?.plans ?? {};
        this.plans = Object.fromEntries(Object.entries(j).filter(([, p]) => validPlan(p))) as Record<string, VerificationPlan>;
      }
    } catch {}
  }
  private save(key: string) {
    // the most recent tasks only
    this.plans = Object.fromEntries(Object.entries(this.plans).sort((a, b) => b[1].updated - a[1].updated).slice(0, MAX_PLANS));
    const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ plans: this.plans }), { mode: 0o600 }); renameSync(tmp, this.file);
    this.changed(key);
  }
  /** A task's plan, with its deadlines checked */
  get(key: string): VerificationPlan | undefined {
    const p = this.plans[key]; if (!p) return undefined;
    const q = expire(p, this.now());
    if (q !== p) { this.plans[key] = q; this.save(key); }
    return q;
  }
  /** `conversacion`: the one proposing it, where its rechecks go (the latest to propose it) */
  propose(key: string, input: PlanInput, conversation?: PlanConversation): Result<VerificationPlan> {
    const r = proposePlan(key, input, this.get(key), this.now());
    return this.set(key, r.ok && conversation ? { ok: true, value: { ...r.value, conversation } } : r);
  }
  /** Every plan's state, for the boards and the holograms */
  states(): Record<string, VerificationPlan> { return Object.fromEntries(Object.keys(this.plans).map(k => [k, this.get(k)!])); }

  /** Opens what merged, tells what closed or ran out of time, and keeps one recheck scheduled per open checkpoint */
  async sweep(ctx: CtxRecheck) {
    for (const key of Object.keys(this.plans)) {
      const before = this.get(key);
      if (!before?.conversation || before.points.every(c => c.notified && (isClosed(c) || c.state === 'inconclusive'))) continue;
      const now = this.now();
      const open = before.points.some(c => c.open == null && !isClosed(c))
        ? openCheckpoints(before, await ctx.prs(key, before).catch(() => []), await ctx.inProdCheck(key).catch(() => false), now) : before;
      const p = expire(open, now);
      const points = p.points.map(c => this.recheckPoint(p, structuredClone(c), ctx, now));
      const newer = { ...p, points };
      if (JSON.stringify(newer) !== JSON.stringify(this.plans[key])) { this.plans[key] = newer; this.save(key); }
    }
  }
  private recheckPoint(p: VerificationPlan, c: Checkpoint, ctx: CtxRecheck, now: number): Checkpoint {
    const conv = p.conversation!;
    const name = `${p.key} · ${c.type === 'final' ? t('verification.final') : c.pr}`;
    if (!needsRecheck(c) && c.scheduled) { if (ctx.pending(c.scheduled)) ctx.cancel(c.scheduled); delete c.scheduled; }
    if ((isClosed(c) || c.state === 'inconclusive') && !c.notified) {
      c.notified = true;
      if (c.state === 'inconclusive') {
        ctx.schedule(conv, now, t('prompt.verification.inconclusive', { key: p.key, id: c.id, stuck: t(STATE_TEXT[c.stuck ?? 'waiting-traffic']), plan: planText(p) }));
        ctx.notify(t('server.verification.inconclusive', { name: name, stuck: t(STATE_TEXT[c.stuck ?? 'waiting-traffic']) }), 'warning');
      } else ctx.notify(t(c.state === 'failed' ? 'server.verification.failed' : 'server.verification.evidenced', { name: name }), c.state === 'failed' ? 'warning' : 'info');
    }
    if (needsRecheck(c) && !(c.scheduled && ctx.pending(c.scheduled))) {
      const n = c.rechecks ?? 0;
      const id = ctx.schedule(conv, recheckAt(n, now), t('prompt.verification.recheck', { key: p.key, id: c.id, n: n + 1, plan: planText(p) }));
      if (id) { c.scheduled = id; c.rechecks = n + 1; }
    }
    return c;
  }
  report(key: string, r: ReportInput): Result<VerificationPlan> | undefined {
    const p = this.get(key);
    return p && this.set(key, report(p, r, this.now()));
  }
  /** The Overseer approves the current version (from the pre-flight) */
  approve(key: string): VerificationPlan | undefined {
    const p = this.get(key); if (!p) return undefined;
    this.plans[key] = { ...p, approved: { version: p.version, ts: this.now() } }; this.save(key);
    return this.plans[key];
  }
  private set(key: string, r: Result<VerificationPlan>) {
    if (r.ok) { this.plans[key] = r.value; this.save(key); }
    return r;
  }
}

/** A plan's error in words */
export const errorText = (r: { error: string; vars?: Record<string, string | number> }) => t(`verification.error.${r.error}`, r.vars);

/** A plan as the dweller reads it back after each call */
export function planText(p: VerificationPlan): string {
  return [
    t('tool.verification.heading', { key: p.key, version: p.version, approved: t(isApproved(p) ? 'verification.approved' : 'verification.unapproved', { version: p.version }) }),
    ...p.points.flatMap(c => {
      const deadline = deadlineOf(c);
      return [
        `- ${c.id} (${c.type === 'final' ? t('verification.final') : c.pr}) · ${t(STATE_TEXT[c.state])}${c.services.length ? ' · ' + t('verification.services', { list: c.services.map(s => (c.live[s] ? s + ' ✓' : s)).join(', ') }) : ''} · ${deadline ? t('verification.deadline', { when: describeWhen(deadline) }) : t('verification.deadlineHours', { n: c.deadlineHours })}`,
        ...(c.note ? [`  ${t('verification.note', { text: c.note.text })}`] : []),
        ...c.signals.map(s => `  - ${s.id} · ${t(KIND_TEXT[s.type])} · ${s.state} · ${s.what} · ${t('verification.where', { where: s.where })}${s.base ? ' · ' + t('verification.baseline', { base: s.base }) : ''}${s.evidence ? ' · ' + t('verification.evidence', { text: s.evidence.text }) : ''}`),
      ];
    }),
  ].join('\n');
}
