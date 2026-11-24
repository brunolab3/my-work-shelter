// Tokens spent, from the session transcripts (server/usageSpend.ts reads them; the top bar's usage meter shows them on
// hover): the last 5 hours by local hour and the last 7 days by local day. Tokens, not the plan's allowance: Anthropic
// doesn't publish it, so nothing here says what is "allowed".

// one assistant message: new tokens (input + output + cache creation) and cache reads, kept apart
export interface UsageRecord { at: number; fresh: number; cacheRead: number }
export interface SpendBucket { start: number; end: number; fresh: number; cacheRead: number }
export interface SpendBuckets { hours: SpendBucket[]; days: SpendBucket[]; at: number }

export const HOURS_SPAN = 5 * 3600_000;
export const DAYS_SPAN = 7 * 86400_000;

// the transcript's `message.usage` as one record's two figures
export function usageTokens(u: Record<string, unknown> | null | undefined): { fresh: number; cacheRead: number } {
  const n = (k: string) => { const v = u?.[k]; return typeof v === 'number' && v > 0 ? v : 0; };
  return { fresh: n('input_tokens') + n('output_tokens') + n('cache_creation_input_tokens'), cacheRead: n('cache_read_input_tokens') };
}

const formats = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, timeZone?: string) {
  const k = timeZone ?? '';
  let f = formats.get(k);
  if (!f) formats.set(k, f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(t)) if (x.type !== 'literal') p[x.type] = +x.value;
  return p;
}
// the zone's offset at t (ms), from its wall clock
const offset = (t: number, timeZone?: string) => {
  const p = parts(t, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
};

// the start of t's local hour (zones with half-hour offsets too)
export function hourStart(t: number, timeZone?: string): number {
  const p = parts(t, timeZone);
  return t - (p.minute * 60 + p.second) * 1000 - (((t % 1000) + 1000) % 1000);
}
// the start of t's local day (local midnight; days of 23 or 25 hours on a clock change)
export function dayStart(t: number, timeZone?: string): number {
  const p = parts(t, timeZone);
  return midnight(p.year, p.month, p.day, timeZone);
}
function midnight(y: number, m: number, d: number, timeZone?: string) {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - offset(wall, timeZone);
  t = wall - offset(t, timeZone);
  return t;
}
const nextDay = (start: number, timeZone?: string) => {
  const p = parts(start + 36 * 3600_000, timeZone);   // well inside the next day, whatever its length
  return midnight(p.year, p.month, p.day, timeZone);
};

// buckets covering [now - span, now], anchored to the local hour or day: the first holds now - span, the last is the
// current (partial) one. Records outside them are left out.
export function spendBuckets(records: Iterable<UsageRecord>, now: number, unit: 'hour' | 'day', timeZone?: string): SpendBucket[] {
  const out: SpendBucket[] = [];
  const span = unit === 'hour' ? HOURS_SPAN : DAYS_SPAN;
  let start = unit === 'hour' ? hourStart(now - span, timeZone) : dayStart(now - span, timeZone);
  while (start <= now) {
    const end = unit === 'hour' ? hourStart(start + 3600_000 + 1000, timeZone) : nextDay(start, timeZone);
    out.push({ start, end, fresh: 0, cacheRead: 0 });
    start = end;
  }
  if (!out.length) return out;
  const first = out[0].start;
  for (const r of records) {
    if (r.at < first || r.at > now) continue;
    const b = out.find(x => r.at >= x.start && r.at < x.end);
    if (b) { b.fresh += r.fresh; b.cacheRead += r.cacheRead; }
  }
  return out;
}

export const spendSummary = (records: UsageRecord[], now: number, timeZone?: string): SpendBuckets =>
  ({ hours: spendBuckets(records, now, 'hour', timeZone), days: spendBuckets(records, now, 'day', timeZone), at: now });
