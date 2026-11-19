import { describe, it, expect } from 'vitest';
import { nextEvent, urgency, alertDue, type MeetingEvent } from './meeting.ts';

const MIN = 60_000, AHORA = 1_000_000_000;
const ev = (id: string, enMin: number, durMin = 30, allElDay = false): MeetingEvent =>
  ({ id, fuente: 'google', titulo: id, inicio: AHORA + enMin * MIN, fin: AHORA + (enMin + durMin) * MIN, allElDay });

describe('nextEvent', () => {
  it('the earliest not yet ended, a timed one before an all-day one', () => {
    expect(nextEvent([ev('luego', 40), ev('fiesta', -600, 1440, true), ev('pasada', -60)], AHORA)?.id).toBe('luego');
    expect(nextEvent([ev('fiesta', -600, 1440, true)], AHORA)?.id).toBe('fiesta');
    expect(nextEvent([], AHORA)).toBeNull();
  });
  it('a meeting about to start beats one under way', () => {
    expect(nextEvent([ev('en-curso', -20), ev('luego', 30)], AHORA)?.id).toBe('en-curso');
    expect(nextEvent([ev('en-curso', -20), ev('pronto', 8)], AHORA)?.id).toBe('pronto');
  });
});

describe('urgency and the alert', () => {
  it('amber at 10 min, red at 3, nothing once started or all day', () => {
    expect(urgency(ev('a', 11), AHORA)).toBe('');
    expect(urgency(ev('a', 10), AHORA)).toBe('pronto');
    expect(urgency(ev('a', 3), AHORA)).toBe('inminente');
    expect(urgency(ev('a', 0), AHORA)).toBe('');
    expect(urgency(ev('a', 2, 60, true), AHORA)).toBe('');
  });
  it('the alert, in the last minute, once', () => {
    expect(alertDue(ev('a', 2), AHORA, new Set())).toBe(false);
    expect(alertDue(ev('a', 1), AHORA, new Set())).toBe(true);
    expect(alertDue(ev('a', 1), AHORA, new Set(['a']))).toBe(false);
    expect(alertDue(ev('a', 0), AHORA, new Set())).toBe(false);
  });
});
