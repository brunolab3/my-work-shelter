import { describe, it, expect } from 'vitest';
import { spendBuckets, spendSummary, hourStart, dayStart, usageTokens, type UsageRecord } from './usageSpend.ts';

const H = 3_600_000, D = 86_400_000;
const at = (iso: string) => Date.parse(iso);
const rec = (iso: string, fresh = 10, cacheRead = 100): UsageRecord => ({ at: at(iso), fresh, cacheRead });

describe('usage spend buckets', () => {
  it('a message\'s usage: new tokens (input + output + cache creation) apart from cache reads', () => {
    expect(usageTokens({ input_tokens: 2, output_tokens: 259, cache_creation_input_tokens: 12558, cache_read_input_tokens: 16700, service_tier: 'standard' }))
      .toEqual({ fresh: 2 + 259 + 12558, cacheRead: 16700 });
    expect(usageTokens(undefined)).toEqual({ fresh: 0, cacheRead: 0 });
    expect(usageTokens({ input_tokens: 'x', output_tokens: -3 } as any)).toEqual({ fresh: 0, cacheRead: 0 });
  });

  it('the last 5 hours by local hour: the first bucket holds now - 5 h, the last is the current one; edges go to the later hour', () => {
    const now = at('2026-11-24T15:20:00Z');
    const b = spendBuckets([rec('2026-11-24T10:19:59Z', 1, 1), rec('2026-11-24T10:20:00Z', 2, 20), rec('2026-11-24T11:00:00Z', 3, 30), rec('2026-11-24T10:59:59.999Z', 4, 40), rec('2026-11-24T15:20:00Z', 5, 50), rec('2026-11-24T15:20:01Z', 9, 9)], now, 'hour', 'UTC');
    expect(b.map(x => new Date(x.start).toISOString().slice(11, 16))).toEqual(['10:00', '11:00', '12:00', '13:00', '14:00', '15:00']);
    expect(b.map(x => x.end - x.start)).toEqual(Array(6).fill(H));
    // 10:19:59 is in the 10:00 bucket (the hour of now - 5 h); 15:20:01 is in the future
    expect(b.map(x => [x.fresh, x.cacheRead])).toEqual([[7, 61], [3, 30], [0, 0], [0, 0], [0, 0], [5, 50]]);
  });

  it('hours follow the time zone, half-hour offsets too', () => {
    const now = at('2026-11-24T15:40:00Z');   // 21:10 in Kolkata (+5:30)
    const b = spendBuckets([rec('2026-11-24T15:29:59Z', 1), rec('2026-11-24T15:30:00Z', 2)], now, 'hour', 'Asia/Kolkata');
    expect(new Date(b.at(-1)!.start).toISOString()).toBe('2026-11-24T15:30:00.000Z');   // 21:00 local
    expect(b.slice(-2).map(x => x.fresh)).toEqual([1, 2]);
    expect(hourStart(at('2026-11-24T15:20:00Z'), 'Europe/Madrid')).toBe(at('2026-11-24T15:00:00Z'));
  });

  it('the last 7 days by local day: midnight in the zone, a clock change makes a 25-hour day', () => {
    const tz = 'Europe/Madrid';
    const now = at('2026-10-29T10:00:00Z');   // Thursday; Sunday 25 October 2026 goes from +2 to +1
    const b = spendBuckets([rec('2026-10-22T21:59:59Z', 1, 0), rec('2026-10-22T22:00:00Z', 2, 0), rec('2026-10-25T22:59:59Z', 4, 0), rec('2026-10-25T23:00:00Z', 8, 0)], now, 'day', tz);
    expect(b).toHaveLength(8);
    expect(new Date(b[0].start).toISOString()).toBe('2026-10-21T22:00:00.000Z');   // 22 Oct, 00:00 at +2
    expect(new Date(b.at(-1)!.start).toISOString()).toBe('2026-10-28T23:00:00.000Z');   // 29 Oct, 00:00 at +1
    expect(b.map(x => (x.end - x.start) / H)).toEqual([24, 24, 24, 25, 24, 24, 24, 24]);
    // 22 Oct 23:59:59 local, then 23 Oct; 25 Oct 23:59:59 local (+1), then 26 Oct
    expect(b.map(x => x.fresh)).toEqual([1, 2, 0, 4, 8, 0, 0, 0]);
    expect(dayStart(now, 'UTC')).toBe(at('2026-10-29T00:00:00Z'));
    expect(dayStart(now, 'America/Los_Angeles')).toBe(at('2026-10-29T07:00:00Z'));
  });

  it('an empty window is all zero buckets; a summary has both views', () => {
    const now = at('2026-11-24T15:20:00Z');
    const s = spendSummary([], now, 'UTC');
    expect(s.hours).toHaveLength(6);
    expect(s.days).toHaveLength(8);
    expect([...s.hours, ...s.days].every(x => x.fresh === 0 && x.cacheRead === 0)).toBe(true);
    expect(s.at).toBe(now);
    // a record a week and a day old counts in neither
    expect(spendSummary([{ at: now - 8 * D, fresh: 5, cacheRead: 5 }], now, 'UTC').days.every(x => x.fresh === 0)).toBe(true);
  });
});
