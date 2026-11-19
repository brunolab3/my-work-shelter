import { describe, it, expect } from 'vitest';
import { nextEvent, urgency, alertDue, type MeetingEvent } from './meeting.ts';

const MIN = 60_000, NOW = 1_000_000_000;
const ev = (id: string, inMin: number, durMin = 30, allDay = false): MeetingEvent =>
  ({ id, source: 'google', title: id, start: NOW + inMin * MIN, end: NOW + (inMin + durMin) * MIN, allDay });

describe('nextEvent', () => {
  it('the earliest not yet ended, a timed one before an all-day one', () => {
    expect(nextEvent([ev('luego', 40), ev('fiesta', -600, 1440, true), ev('pasada', -60)], NOW)?.id).toBe('luego');
    expect(nextEvent([ev('fiesta', -600, 1440, true)], NOW)?.id).toBe('fiesta');
    expect(nextEvent([], NOW)).toBeNull();
  });
  it('a meeting about to start beats one under way', () => {
    expect(nextEvent([ev('en-curso', -20), ev('luego', 30)], NOW)?.id).toBe('en-curso');
    expect(nextEvent([ev('en-curso', -20), ev('pronto', 8)], NOW)?.id).toBe('pronto');
  });
});

describe('urgency and the alert', () => {
  it('amber at 10 min, red at 3, nothing once started or all day', () => {
    expect(urgency(ev('a', 11), NOW)).toBe('');
    expect(urgency(ev('a', 10), NOW)).toBe('pronto');
    expect(urgency(ev('a', 3), NOW)).toBe('inminente');
    expect(urgency(ev('a', 0), NOW)).toBe('');
    expect(urgency(ev('a', 2, 60, true), NOW)).toBe('');
  });
  it('the alert, in the last minute, once', () => {
    expect(alertDue(ev('a', 2), NOW, new Set())).toBe(false);
    expect(alertDue(ev('a', 1), NOW, new Set())).toBe(true);
    expect(alertDue(ev('a', 1), NOW, new Set(['a']))).toBe(false);
    expect(alertDue(ev('a', 0), NOW, new Set())).toBe(false);
  });
});
