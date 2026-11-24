import { describe, expect, it } from 'vitest';
import { epicOrder, holoSlot, helperSpots, type HoloRoom } from './copySpot';

// 12 m room on the right: slots run -5.1..5.1, the visitor's spot (x = -3.5) blocks -4.9..-2.1
const room = (width = 12): HoloRoom => ({ width, side: 'right', workstations: [], devices: [], walkZones: [], obstacles: [] });
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

describe('epicOrder', () => {
  const xs = (m: Map<string, number>) => Object.fromEntries(m);

  it('puts an epic\'s copies side by side in task order, numerically', () => {
    const m = epicOrder([
      { id: 'a', x: -3, epic: 'ABC-1', task: 'ABC-12' }, { id: 'b', x: 0, task: 'FAN-5' }, { id: 'c', x: 3, epic: 'ABC-1', task: 'ABC-7' },
    ]);
    expect(m.get('c')! < m.get('a')!).toBe(true);
    expect(Math.abs(m.get('c')! - m.get('a')!)).toBe(3);   // next to each other: no copy between them
    expect([...m.values()].sort((p, q) => p - q)).toEqual([-3, 0, 3]);   // over the same slots
  });

  it('moves nobody when the row is already in order, nor copies without an epic', () => {
    const row = [{ id: 'a', x: -4, task: 'X-1' }, { id: 'b', x: -1, epic: 'E-1', task: 'E-2' }, { id: 'c', x: 1, epic: 'E-1', task: 'E-10' }, { id: 'd', x: 4 }];
    expect(xs(epicOrder(row))).toEqual({ a: -4, b: -1, c: 1, d: 4 });
    expect(xs(epicOrder([{ id: 'a', x: 2, task: 'X-9' }, { id: 'b', x: -2, task: 'X-1' }]))).toEqual({ a: 2, b: -2 });
  });

  it('a late sibling joins its oldest one, and the copies in between make room keeping their order', () => {
    // E-5 the oldest, at the far end; E-3 new at the other end, two loners between
    const m = xs(epicOrder([{ id: 'e5', x: 4.5, epic: 'E', task: 'E-5' }, { id: 'p', x: -1.5 }, { id: 'q', x: 1.5 }, { id: 'e3', x: -4.5, epic: 'E', task: 'E-3' }]));
    expect(m).toEqual({ p: -4.5, q: -1.5, e3: 1.5, e5: 4.5 });
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
