import { describe, expect, it } from 'vitest';
import { holoSlot, type HoloRoom } from './sitioCopia';

// 12 m room on the right: slots run -5.1..5.1, the visitor's spot (x ≈ -4.9) blocks the near end up to about -3.5
const sala = (ancho = 12): HoloRoom => ({ ancho, lado: 'der', puestos: [], devices: [], walkZones: [], obstacles: [] });
const holgura = (x: number, otros: number[]) => Math.min(...otros.map(o => Math.abs(o - x)));

describe('holoSlot', () => {
  it('takes a gap between copies instead of landing on top of the one at the row\'s end', () => {
    const otros = [-3.3, -1.3, 0.7, 2.7, 4.7];   // 2 m gaps, the last copy close to the far end
    const x = holoSlot(sala(), otros, 1, 1);
    expect(holgura(x, otros)).toBeGreaterThan(0.85);
    expect(x).toBeLessThan(4.7);
  });

  it('goes to the slot farthest from the nearest copy', () => {
    const otros = [-3.3, -0.9, 1.5, 3.3, 5.1];   // the widest gap, -3.3..-0.9, has its middle at -2.1
    expect(holoSlot(sala(), otros, 1, 1)).toBeCloseTo(-2.1, 5);
  });

  it('lands on top of a copy only when no other slot is left', () => {
    // 4 m room: slots -1.1..1.1, every one of them within 0.5 m of a copy
    const otros = [-1.1, -0.5, 0.1, 0.7];
    const x = holoSlot(sala(4), otros, 1, 1);
    expect(holgura(x, otros)).toBeLessThan(0.5);
    // with one slot farther out, that one
    expect(holgura(holoSlot(sala(4), [-1.1, -0.5, 0.1], 1, 1), [-1.1, -0.5, 0.1])).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps clear of where dwellers stand when there is room', () => {
    const x = holoSlot({ ...sala(), puestos: [{ x: 4.8, peso: 300 }] }, [], 1, 1);
    expect(Math.abs(x - 4.8)).toBeGreaterThanOrEqual(1.3);
  });
});
