import { describe, it, expect, afterEach } from 'vitest';
import { MAX_SAMPLES, PACE_YELLOW, addSample, describeReset, limitLight, paceRatio, windowPace, windowStart, worstLight, type PlanLimit, type Sample } from './planLimits.ts';
import { setLanguage } from './language.ts';

const M = 60_000, H = 60 * M, D = 24 * H, NOW = 1_800_000_000_000;
// a window `elapsed` ms into it, `utilization` % used
const at = (type: 'five_hour' | 'seven_day', utilization: number | null, elapsed: number, status: PlanLimit['status'] = 'allowed'): PlanLimit =>
  ({ status, utilization, resetsAt: NOW - elapsed + (type === 'five_hour' ? 5 * H : 7 * D), updated: NOW });

afterEach(() => setLanguage('es'));

describe('usage traffic light (usage against pace)', () => {
  it('the window starts at its reset time minus its length: 5 h, or 7 days for the weekly ones', () => {
    expect(windowStart('five_hour', NOW)).toBe(NOW - 5 * H);
    expect(windowStart('seven_day', NOW)).toBe(NOW - 7 * D);
    expect(windowStart('seven_day_opus', NOW)).toBe(NOW - 7 * D);
    expect(windowStart('five_hour', null)).toBeNull();
    expect(windowStart('mystery', NOW)).toBeNull();
    expect(windowPace('five_hour', NOW + 4 * H, NOW)).toBeCloseTo(0.2);
  });

  it("Bruno's examples", () => {
    // the 5-hour window at 60 % in its first hour: pace 20 %, ratio 3 → red
    expect(paceRatio(at('five_hour', 60, H), 'five_hour', NOW)).toBeCloseTo(3);
    expect(limitLight(at('five_hour', 60, H), 'five_hour', NOW)).toBe('red');
    // the weekly one at 50 % on day 1: pace 1/7, ratio 3.5 → red
    expect(paceRatio(at('seven_day', 50, D), 'seven_day', NOW)).toBeCloseTo(3.5);
    expect(limitLight(at('seven_day', 50, D), 'seven_day', NOW)).toBe('red');
    // at 50 % on day 6: pace 6/7, ratio ≈ 0.58 → green
    expect(paceRatio(at('seven_day', 50, 6 * D), 'seven_day', NOW)).toBeCloseTo(0.583, 2);
    expect(limitLight(at('seven_day', 50, 6 * D), 'seven_day', NOW)).toBe('green');
  });

  it('green up to on pace, yellow up to 1.25 times it, red above', () => {
    expect(PACE_YELLOW).toBe(1.25);
    expect(limitLight(at('five_hour', 50, 2.5 * H), 'five_hour', NOW)).toBe('green');      // ratio 1
    expect(limitLight(at('five_hour', 55, 2.5 * H), 'five_hour', NOW)).toBe('yellow');   // 1.1
    expect(limitLight(at('five_hour', 62.5, 2.5 * H), 'five_hour', NOW)).toBe('yellow'); // 1.25
    expect(limitLight(at('five_hour', 63, 2.5 * H), 'five_hour', NOW)).toBe('red');       // 1.26
    expect(limitLight(at('five_hour', 0, 0), 'five_hour', NOW)).toBe('green');             // nothing used yet
  });

  it('rejected is red, unknown is grey (never green)', () => {
    expect(limitLight(at('five_hour', null, H, 'rejected'), 'five_hour', NOW)).toBe('red');
    expect(limitLight(at('seven_day', 10, 6 * D, 'rejected'), 'seven_day', NOW)).toBe('red');
    expect(limitLight(at('five_hour', null, H), 'five_hour', NOW)).toBe('gray');
    expect(limitLight(undefined, 'five_hour', NOW)).toBe('gray');
    // used but with no reset time there is no pace to compare with
    expect(limitLight({ status: 'allowed', utilization: 30, resetsAt: null, updated: NOW }, 'five_hour', NOW)).toBe('gray');
  });

  it('the overall light is the worst of the shown windows, named', () => {
    const ls = { five_hour: at('five_hour', 10, 4 * H), seven_day: at('seven_day', 50, D) };
    expect(worstLight(ls, ['five_hour', 'seven_day'], NOW)).toEqual({ light: 'red', window: 'seven_day' });
    expect(worstLight(ls, ['five_hour'], NOW)).toEqual({ light: 'green', window: 'five_hour' });
    expect(worstLight({}, ['five_hour'], NOW)).toEqual({ light: 'gray', window: null });
  });
});

describe('utilization samples', () => {
  const T = NOW, resets = T + 5 * H;
  it('at most one a minute: the last stays provisional until a minute past the one before', () => {
    let s: Sample[] = addSample([], T, 10, 'five_hour', resets);
    s = addSample(s, T + 20_000, 11, 'five_hour', resets);
    expect(s).toEqual([[T, 10], [T + 20_000, 11]]);
    s = addSample(s, T + 40_000, 12, 'five_hour', resets);
    expect(s).toEqual([[T, 10], [T + 40_000, 12]]);
    s = addSample(s, T + M, 13, 'five_hour', resets);
    expect(s).toEqual([[T, 10], [T + M, 13]]);
    s = addSample(s, T + M + 5_000, 14, 'five_hour', resets);
    expect(s).toEqual([[T, 10], [T + M, 13], [T + M + 5_000, 14]]);
  });

  it('those from before the window started are dropped; the weekly one samples less often, never over the cap', () => {
    expect(addSample([[resets - 6 * H, 90]], T, 5, 'five_hour', resets)).toEqual([[T, 5]]);
    let s: Sample[] = [];
    for (let i = 0; i < 2000; i++) s = addSample(s, T + i * M, i % 100, 'seven_day', T + 7 * D);
    expect(s.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(s[1][0] - s[0][0]).toBeGreaterThanOrEqual(7 * D / MAX_SAMPLES);
  });
});

describe('reset time', () => {
  const at = (iso: string) => Date.parse(iso);
  it('clock time today, with the weekday on another day, and how long until then', () => {
    setLanguage('en');
    expect(describeReset(at('2026-11-24T17:40:00Z'), at('2026-11-24T15:30:00Z'), 'UTC')).toEqual({ clock: '17:40', relative: 'in 2 h 10 min' });
    expect(describeReset(at('2026-11-24T16:00:00Z'), at('2026-11-24T15:55:00Z'), 'UTC').relative).toBe('in 5 min');
    expect(describeReset(at('2026-11-24T18:00:00Z'), at('2026-11-24T15:00:00Z'), 'UTC').relative).toBe('in 3 h');
    expect(describeReset(at('2026-11-27T09:05:00Z'), at('2026-11-24T15:00:00Z'), 'UTC')).toEqual({ clock: 'Fri 09:05', relative: 'in 2 d 18 h' });
    expect(describeReset(at('2026-11-24T15:00:00Z'), at('2026-11-24T15:01:00Z'), 'UTC').relative).toBe('now');
  });

  it('in the given time zone and the game language', () => {
    setLanguage('es');
    // 23:30 UTC is already Wednesday 00:30 in Madrid
    expect(describeReset(at('2026-11-24T23:30:00Z'), at('2026-11-24T22:00:00Z'), 'Europe/Madrid')).toEqual({ clock: 'mié 00:30', relative: 'en 1 h 30 min' });
  });
});
