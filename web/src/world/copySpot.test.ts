import { describe, expect, it } from 'vitest';
import { holoSlot, helperSpots, type HoloRoom } from './copySpot';

// 12 m room on the right: slots run -5.1..5.1, the visitor's spot (x = -3.5) blocks -4.9..-2.1
const room = (width = 12): HoloRoom => ({ width, side: 'der', workstations: [], devices: [], walkZones: [], obstacles: [] });
const clearance = (x: number, others: number[]) => Math.min(...others.map(o => Math.abs(o - x)));

describe('holoSlot', () => {
  it('takes a gap between copies instead of landing on top of the one at the row\'s end', () => {
    const others = [-3.3, -1.3, 0.7, 2.7, 4.7];   // 2 m gaps, the last copy close to the far end
    const x = holoSlot(room(), others, 1, 1);
    expect(clearance(x, others)).toBeGreaterThan(0.85);
    expect(x).toBeLessThan(4.7);
  });

  it('goes to the slot farthest from the nearest copy', () => {
    const others = [-2.0, -0.8, 0.4, 1.6, 4.2, 5.4];   // the widest gap, 1.6..4.2: its slot farthest from both is 3.0
    expect(holoSlot(room(), others, 1, 1)).toBeCloseTo(3.0, 5);
  });

  it('lands on top of a copy only when no other slot is left', () => {
    // 4 m room: slots -1.1..1.1, every one of them within 0.5 m of a copy
    const others = [-1.1, -0.5, 0.1, 0.7];
    const x = holoSlot(room(4), others, 1, 1);
    expect(clearance(x, others)).toBeLessThan(0.5);
    // with one slot farther out, that one
    expect(clearance(holoSlot(room(4), [-1.1, -0.5, 0.1], 1, 1), [-1.1, -0.5, 0.1])).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps clear of where dwellers stand when there is room', () => {
    const x = holoSlot({ ...room(), workstations: [{ x: 4.8, weight: 300 }] }, [], 1, 1);
    expect(Math.abs(x - 4.8)).toBeGreaterThanOrEqual(1.3);
  });
});

describe('helperSpots', () => {
  it('clusters next to the copy, nearest first, on both sides', () => {
    const s = helperSpots(0, [], 12);
    expect(s.slice(0, 4).map(([dx]) => Math.abs(dx))).toEqual([0.58, 0.58, 0.58, 0.58]);
    expect(new Set(s.map(([dx, dz]) => `${dx},${dz}`)).size).toBe(s.length);
  });

  it('never on a neighbouring copy or past the wall', () => {
    const s = helperSpots(4.8, [3.6], 12);
    expect(s.length).toBeGreaterThan(0);
    for (const [dx] of s) { expect(Math.abs(4.8 + dx - 3.6)).toBeGreaterThanOrEqual(0.5); expect(4.8 + dx).toBeLessThan(5.65); }
  });
});
