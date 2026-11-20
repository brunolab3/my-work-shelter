import { describe, expect, it } from 'vitest';
import { autoCompactWindow, AUTO_COMPACT_DEFAULT } from './compact';

describe('autoCompactWindow', () => {
  it('defaults when unset, 0 leaves it to Claude Code, and clamps to what Claude Code accepts', () => {
    expect(autoCompactWindow(undefined)).toBe(AUTO_COMPACT_DEFAULT);
    expect(autoCompactWindow(0)).toBeUndefined();
    expect(autoCompactWindow(50_000)).toBe(100_000);
    expect(autoCompactWindow(5_000_000)).toBe(1_000_000);
    expect(autoCompactWindow(250_000)).toBe(250_000);
  });
});
