import { describe, expect, it } from 'vitest';
import { chatNudge } from './chatNudge';

// 20 m wide view centred at 0 (x -10..10), 10 m high (y -5..5), the intercom over the right half
const view = { cx: 0, cy: 0, hw: 10, hh: 5, free: 0.5 };

describe('chatNudge', () => {
  it('leaves the camera where it is when the person is already in the free part', () => {
    expect(chatNudge(view, -5, 0)).toEqual({ x: 0, y: 0 });
  });

  it('shifts just enough to bring a person under the intercom into the free part', () => {
    const n = chatNudge(view, 4, 0);   // free part -10..0, with a 15 % margin -8.5..-1.5
    expect(n.x).toBeCloseTo(5.5, 5);
    expect(n.y).toBe(0);
  });

  it('shifts towards a person off the left edge or another floor', () => {
    const n = chatNudge(view, -14, -9);
    expect(n.x).toBeCloseTo(-5.5, 5);
    expect(n.y).toBeCloseTo(-5.5, 5);
  });

  it('uses the whole width when there is no intercom', () => {
    expect(chatNudge({ ...view, free: 1 }, 6, 0)).toEqual({ x: 0, y: 0 });
  });
});
