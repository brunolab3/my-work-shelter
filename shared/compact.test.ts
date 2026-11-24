import { describe, expect, it } from 'vitest';
import { autoCompactWindow, AUTO_COMPACT_DEFAULT, handoffThreshold, handoffDue, HANDOFF_DEFAULT } from './compact';

describe('autoCompactWindow', () => {
  it('defaults when unset, 0 leaves it to Claude Code, and clamps to what Claude Code accepts', () => {
    expect(autoCompactWindow(undefined)).toBe(AUTO_COMPACT_DEFAULT);
    expect(autoCompactWindow(0)).toBeUndefined();
    expect(autoCompactWindow(50_000)).toBe(100_000);
    expect(autoCompactWindow(5_000_000)).toBe(1_000_000);
    expect(autoCompactWindow(250_000)).toBe(250_000);
  });
});

describe('handoffThreshold / handoffDue', () => {
  it('defaults to 250k, 0 turns it off, clamped like the auto-compact window', () => {
    expect(handoffThreshold(undefined)).toBe(HANDOFF_DEFAULT);
    expect(HANDOFF_DEFAULT).toBe(250_000);
    expect(handoffThreshold(0)).toBeUndefined();
    expect(handoffThreshold(20_000)).toBe(100_000);
    expect(handoffThreshold(180_000)).toBe(180_000);
  });
  it('passes at the threshold, or at 75 % of a small window; never when off', () => {
    expect(handoffDue({ used: 249_999, percentage: 25 }, 250_000)).toBe(false);
    expect(handoffDue({ used: 250_000, percentage: 25 }, 250_000)).toBe(true);
    expect(handoffDue({ used: 150_000, percentage: 75 }, 250_000)).toBe(true);
    expect(handoffDue({ used: 900_000, percentage: 90 }, undefined)).toBe(false);
    expect(handoffDue(undefined, 250_000)).toBe(false);
  });
});
