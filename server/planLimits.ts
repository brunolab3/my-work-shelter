// The Claude plan's usage limits: the latest known state of each window (5-hour, weekly…), from two read-only sources
// with the player's own login: the SDK's `rate_limit_event` (sessions.ts, 'limite') and the /usage data a live session
// can read (`Sessions.planUsage`). Each window also keeps its utilization samples (at most one a minute, in memory) for
// the top bar's chart, dropped when the window resets. Events: 'cambio' (the whole state, for the top bar) and 'renovado' (a window that
// was rejected has renewed: what was stopped by it can go on).
import { EventEmitter } from 'node:events';
import { addSample, type LimitStatus, type PlanLimit, type PlanLimits } from '../shared/planLimits.ts';

// rate_limit_event's info (SDKRateLimitInfo): utilization 0-1, resetsAt in seconds (ms tolerated)
export interface LimitEvent { status: LimitStatus; rateLimitType?: string; utilization?: number; resetsAt?: number }
// the /usage data's rate_limits (SDKControlGetUsageResponse): utilization 0-100, resets_at ISO 8601
type UsageWindow = { utilization: number | null; resets_at: string | null } | null | undefined;
export type UsageLimits = Record<string, unknown> | null | undefined;
const USAGE_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

export const toMs = (ts: number) => ts * (ts < 1e12 ? 1000 : 1);
// two reset times a minute apart or less are the same window
const sameWindow = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= 60_000;

export class PlanLimitsStore extends EventEmitter {
  private w: PlanLimits = {};
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private now: () => number = Date.now) { super(); }

  get(): PlanLimits { return Object.fromEntries(Object.entries(this.w).map(([k, l]) => [k, { ...l, samples: [...(l.samples ?? [])] }])); }

  fromEvent(i: LimitEvent | null | undefined) {
    if (!i?.status || !i.rateLimitType) return;
    const prev = this.w[i.rateLimitType];
    const resetsAt = i.resetsAt ? toMs(i.resetsAt) : prev?.resetsAt ?? null;
    // without a figure the last one holds, except once a rejection lifts (a new window)
    const lifted = prev?.status === 'rejected' && i.status !== 'rejected';
    const utilization = i.utilization != null ? Math.round(i.utilization * 1000) / 10 : prev && !lifted ? prev.utilization : null;
    this.set(i.rateLimitType, { status: i.status, utilization, resetsAt, updated: this.now() }, lifted);
  }

  fromUsage(rl: UsageLimits) {
    if (!rl) return;
    for (const type of USAGE_WINDOWS) {
      const u = rl[type] as UsageWindow;
      if (!u || u.utilization == null) continue;
      const prev = this.w[type], resetsAt = u.resets_at ? Date.parse(u.resets_at) || null : null;
      // /usage has no status: full is rejected; a warning or rejection the events gave holds within the same window
      const status: LimitStatus = u.utilization >= 100 ? 'rejected' : prev && prev.status !== 'allowed' && sameWindow(prev.resetsAt, resetsAt) ? prev.status : 'allowed';
      this.set(type, { status, utilization: u.utilization, resetsAt, updated: this.now() });
    }
  }

  private set(type: string, l: PlanLimit, newWindow = false) {
    const prev = this.w[type];
    // another reset time is another window: its samples start over
    const fresh = newWindow || !prev || (prev.resetsAt != null && l.resetsAt != null && !sameWindow(prev.resetsAt, l.resetsAt));
    const samples = fresh ? [] : prev.samples ?? [];
    l.samples = l.utilization != null ? addSample(samples, l.updated, l.utilization, type, l.resetsAt ?? prev?.resetsAt ?? null) : samples;
    this.w[type] = l;
    clearTimeout(this.timers.get(type)); this.timers.delete(type);
    if (l.resetsAt != null) {
      const timer = setTimeout(() => this.renew(type), Math.max(0, l.resetsAt - this.now()));
      timer.unref?.(); this.timers.set(type, timer);
    }
    if (prev?.status === 'rejected' && l.status !== 'rejected') this.emit('renovado', type);
    if (!prev || prev.status !== l.status || prev.utilization !== l.utilization || prev.resetsAt !== l.resetsAt) this.emit('cambio', this.get());
  }

  // the window's reset time has come: a new window starts empty
  renew(type: string) {
    if (!this.w[type]) return;
    this.set(type, { status: 'allowed', utilization: 0, resetsAt: null, updated: this.now() }, true);
  }
}

export const planLimits = new PlanLimitsStore();
