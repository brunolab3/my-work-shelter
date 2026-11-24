import { describe, expect, it } from 'vitest';
import { fitLevel, MAX_COMPACT } from './fitBar';

// a bar whose width at each level is given; records the levels it was set to
const bar = (widths: number[]) => {
  let level = -1;
  const tried: number[] = [];
  return { set: (l: number) => { level = l; tried.push(l); }, width: () => widths[level], tried, level: () => level };
};

describe('the top bar compacting to what fits', () => {
  it('stays full when there is room', () => {
    const b = bar([900, 800, 700, 600, 500]);
    expect(fitLevel(b.set, b.width, 1000)).toBe(0);
    expect(b.tried).toEqual([0]);
  });
  it('takes the first level that fits, measured from the fullest up', () => {
    const b = bar([900, 800, 700, 600, 500]);
    expect(fitLevel(b.set, b.width, 720)).toBe(2);
    expect(b.tried).toEqual([0, 1, 2]);
    expect(b.level()).toBe(2);
  });
  it('returns to the full bar when the room comes back', () => {
    const b = bar([900, 800, 700, 600, 500]);
    fitLevel(b.set, b.width, 550);
    expect(fitLevel(b.set, b.width, 950)).toBe(0);
    expect(b.level()).toBe(0);
  });
  it('ends at the most compact level when nothing fits', () => {
    const b = bar([900, 800, 700, 600, 500]);
    expect(fitLevel(b.set, b.width, 100)).toBe(MAX_COMPACT);
    expect(b.level()).toBe(MAX_COMPACT);
  });
});
