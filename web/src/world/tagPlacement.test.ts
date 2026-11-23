import { describe, expect, it } from 'vitest';
import { placeTags } from './tagPlacement';

describe('placeTags', () => {
  const a = { name: 'a' }, b = { name: 'b' };
  it('a tag that collides climbs above the one placed before it', () => {
    const [pa, pb] = placeTags([{ k: a, x: 100, y: 200, width: 100, height: 20 }, { k: b, x: 110, y: 205, width: 20, height: 20 }]);
    expect(pa.y1).toBe(200);
    expect(pb.y1).toBe(pa.y0 - 3);
    expect(pb.lift).toBe(205 - pb.y1);
  });
  it('a pointed tag that grows keeps its lift, so it stays under the pointer, and the others move out of its way', () => {
    // b's glyph sat above a's tag; pointed, b grows wide over a: it keeps its place and a climbs above it
    const glyph = placeTags([{ k: a, x: 100, y: 200, width: 100, height: 20 }, { k: b, x: 110, y: 205, width: 20, height: 20 }])[1];
    const pointer = { x: 110, y: (glyph.y0 + glyph.y1) / 2 };
    for (let frame = 0; frame < 3; frame++) {
      const placed = placeTags([{ k: a, x: 100, y: 200, width: 100, height: 20 }, { k: b, x: 110, y: 205, width: 300, height: 20, aimed: true, lift: glyph.lift }]);
      const pb = placed.find(q => q.k === b)!, pa = placed.find(q => q.k === a)!;
      expect(placed[0].k).toBe(b);
      expect(pointer.y > pb.y0 && pointer.y < pb.y1 && pointer.x > pb.x0 && pointer.x < pb.x1).toBe(true);
      expect(pa.y1 <= pb.y0 || pa.y0 >= pb.y1).toBe(true);
    }
  });
});
