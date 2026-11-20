import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlanLimitsStore } from './planLimits.ts';
import { limitLevel, rejectedWindows } from '../shared/planLimits.ts';

const NOW = 1_800_000_000_000, H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

afterEach(() => { vi.useRealTimers(); });

describe('plan limits', () => {
  it('an event: utilization 0-1 to percent, resetsAt seconds to ms; without a figure the last one holds', () => {
    const p = new PlanLimitsStore(() => NOW);
    p.fromEvent({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.83, resetsAt: (NOW + H) / 1000 });
    expect(p.get().five_hour).toEqual({ status: 'allowed_warning', utilization: 83, resetsAt: NOW + H, updated: NOW });
    p.fromEvent({ status: 'rejected', rateLimitType: 'five_hour' });
    expect(p.get().five_hour).toMatchObject({ status: 'rejected', utilization: 83, resetsAt: NOW + H });
    // the rejection lifts: a new window, its figure unknown
    p.fromEvent({ status: 'allowed', rateLimitType: 'five_hour' });
    expect(p.get().five_hour).toMatchObject({ status: 'allowed', utilization: null });
    p.fromEvent({ status: 'allowed' } as any);
    expect(Object.keys(p.get())).toEqual(['five_hour']);
  });

  it('/usage: percent and ISO times; full is rejected; a warning holds within the same window', () => {
    const p = new PlanLimitsStore(() => NOW);
    p.fromEvent({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.8, resetsAt: (NOW + 50 * H) / 1000 });
    p.fromUsage({ five_hour: { utilization: 100, resets_at: iso(NOW + H) }, seven_day: { utilization: 81, resets_at: iso(NOW + 50 * H) }, seven_day_opus: null, extra_usage: { is_enabled: false } });
    expect(p.get().five_hour).toMatchObject({ status: 'rejected', utilization: 100, resetsAt: NOW + H });
    expect(p.get().seven_day).toMatchObject({ status: 'allowed_warning', utilization: 81 });
    p.fromUsage({ seven_day: { utilization: 3, resets_at: iso(NOW + 200 * H) } });
    expect(p.get().seven_day).toMatchObject({ status: 'allowed', utilization: 3 });
    p.fromUsage(null);
    expect(Object.keys(p.get()).sort()).toEqual(['five_hour', 'seven_day']);
  });

  it('broadcasts only changes, and at the reset time the window renews (and says so if it was rejected)', () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const p = new PlanLimitsStore();
    const changes = vi.fn(), renewed = vi.fn();
    p.on('cambio', changes); p.on('renovado', renewed);
    p.fromEvent({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: (NOW + H) / 1000 });
    p.fromEvent({ status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt: (NOW + H) / 1000 });
    expect(changes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(H);
    expect(renewed).toHaveBeenCalledWith('five_hour');
    expect(p.get().five_hour).toMatchObject({ status: 'allowed', utilization: 0, resetsAt: null });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('levels for the top bar', () => {
    const l = (status: any, utilization: number | null) => ({ status, utilization, resetsAt: null, updated: 0 });
    expect(limitLevel(undefined)).toBe('desconocido');
    expect(limitLevel(l('allowed', null))).toBe('desconocido');
    expect(limitLevel(l('allowed', 20))).toBe('bajo');
    expect(limitLevel(l('allowed_warning', 50))).toBe('medio');
    expect(limitLevel(l('allowed', 75))).toBe('medio');
    expect(limitLevel(l('allowed', 92))).toBe('alto');
    expect(limitLevel(l('rejected', null))).toBe('agotado');
    expect(rejectedWindows({ a: l('rejected', 100), b: l('allowed', 2) })).toEqual(['a']);
  });
});
