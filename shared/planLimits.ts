// The Claude plan's usage limits as the game knows them (server/planLimits.ts keeps them; the top bar shows them):
// one entry per window, keyed by the SDK's rateLimitType ('five_hour', 'seven_day', 'seven_day_opus'…).

import { locale, t } from './language.ts';

export type LimitStatus = 'allowed' | 'allowed_warning' | 'rejected';
export interface PlanLimit {
  status: LimitStatus;
  utilization: number | null;   // percent of the window used, 0-100; null when unknown
  resetsAt: number | null;      // ms
  updated: number;              // ms
  samples?: Sample[];           // the current window's utilization over time, in memory only (addSample)
}
export type Sample = [at: number, utilization: number];
export type PlanLimits = Record<string, PlanLimit>;

// the windows the top bar shows, in order: the 5-hour one always, the weekly one once known
export const BAR_WINDOWS = ['five_hour', 'seven_day'] as const;

// how long each window lasts (the 5-hour one, the weekly ones); null for one the game doesn't know
export function windowMs(type: string): number | null {
  return type === 'five_hour' ? 5 * 3_600_000 : type.startsWith('seven_day') ? 7 * 86_400_000 : null;
}
/** When the window started: its reset time minus its length */
export function windowStart(type: string, resetsAt: number | null): number | null {
  const len = windowMs(type);
  return len != null && resetsAt != null ? resetsAt - len : null;
}
/** The share of the window that has passed, 0-1 (null when its reset time or length is unknown) */
export function windowPace(type: string, resetsAt: number | null, now: number): number | null {
  const start = windowStart(type, resetsAt), len = windowMs(type);
  return start == null || !len ? null : Math.min(1, Math.max(0, (now - start) / len));
}
/** Usage against pace: the share of the window used over the share passed (1 = on pace); null when either is unknown */
export function paceRatio(l: PlanLimit | undefined, type: string, now: number): number | null {
  if (l?.utilization == null) return null;
  if (l.utilization <= 0) return 0;
  const pace = windowPace(type, l.resetsAt, now);
  return pace == null ? null : pace === 0 ? Infinity : l.utilization / 100 / pace;
}

// the traffic light, from usage against pace: green up to on pace, yellow up to PACE_YELLOW times it, red above or
// when rejected; grey while the usage (or the window's pace) is unknown, never green
export const PACE_YELLOW = 1.25;
export type LimitLight = 'gris' | 'verde' | 'amarillo' | 'rojo';
export function limitLight(l: PlanLimit | undefined, type: string, now: number): LimitLight {
  if (l?.status === 'rejected') return 'rojo';
  const r = paceRatio(l, type, now);
  return r == null ? 'gris' : r <= 1 ? 'verde' : r <= PACE_YELLOW ? 'amarillo' : 'rojo';
}
const RANK: Record<LimitLight, number> = { gris: 0, verde: 1, amarillo: 2, rojo: 3 };
/** The overall light: the worst of the given windows, and which one it is (the first on a tie; grey only when none is known) */
export function worstLight(ls: PlanLimits, windows: readonly string[], now: number): { light: LimitLight; window: string | null } {
  let best: { light: LimitLight; window: string | null } = { light: 'gris', window: null };
  for (const w of windows) { const light = limitLight(ls[w], w, now); if (RANK[light] > RANK[best.light]) best = { light, window: w }; }
  return best;
}

export const SAMPLE_EVERY_MS = 60_000;   // at most a sample a minute…
export const MAX_SAMPLES = 300;          // …and no more than this per window (the weekly one samples less often)
/** A window's samples with a new reading: those before the window started dropped; the last one stays provisional
 *  (replaced by the new reading) until it is a sampling interval past the one before it, so samples are at most one
 *  per interval */
export function addSample(samples: Sample[], at: number, utilization: number, type: string, resetsAt: number | null): Sample[] {
  const len = windowMs(type), every = Math.max(SAMPLE_EVERY_MS, len ? len / MAX_SAMPLES : 0);
  const from = windowStart(type, resetsAt) ?? -Infinity;
  const kept = samples.filter(x => x[0] >= from);
  const last = kept[kept.length - 1], before = kept[kept.length - 2];
  const next: Sample[] = before && last[0] - before[0] < every ? [...kept.slice(0, -1), [at, utilization]] : [...kept, [at, utilization]];
  return next.slice(-MAX_SAMPLES);
}

/** A window's reset for the people: the clock time (with the weekday when it isn't today) and how long until then,
 *  in the game's language; `timeZone` undefined is the Mac's, as every other time in the game */
export function describeReset(resetsAt: number, now: number, timeZone?: string): { clock: string; relative: string } {
  const loc = locale(), day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone });
  const hm = new Date(resetsAt).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone });
  const clock = day(resetsAt) === day(now) ? hm : `${new Date(resetsAt).toLocaleDateString(loc, { weekday: 'short', timeZone })} ${hm}`;
  const m = Math.round((resetsAt - now) / 60_000);
  if (m <= 0) return { clock, relative: t('panels.limit.inNow') };
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  const parts = d ? [t('panels.limit.days', { n: d }), h && t('panels.limit.hours', { n: h })] : [h && t('panels.limit.hours', { n: h }), min && t('panels.limit.minutes', { n: min })];
  return { clock, relative: t('panels.limit.in', { t: parts.filter(Boolean).join(' ') }) };
}

// the windows that have stopped Claude right now (any of them, not only the ones in the bar)
export const rejectedWindows = (ls: PlanLimits) => Object.keys(ls).filter(k => ls[k].status === 'rejected');
