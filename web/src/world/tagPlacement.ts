// Where each tag over the shelter goes on screen: a tag that collides with one already placed climbs until it is free.
// Pointed tags (`aimed`) are placed first and keep the lift they had last frame (`lift`), so a hologram's tag that grows
// to its full text under the pointer stays under it: pushed away by a neighbour, the pointer would leave it, it would
// shrink back and come under the pointer again, every frame.

export type TagBox = { k: object; x: number; y: number; width: number; height: number; aimed?: boolean; lift?: number };
export type PlacedTag = { k: object; x0: number; x1: number; y0: number; y1: number; lift: number };

/** Screen boxes for tags anchored at (x, y), bottom centre, in drawing order with the pointed ones first */
export function placeTags(tags: TagBox[]): PlacedTag[] {
  const placed: PlacedTag[] = [];
  for (const it of [...tags.filter(t => t.aimed), ...tags.filter(t => !t.aimed)]) {
    const w = it.width, h = it.height;
    let y = it.y;
    if (it.aimed && it.lift !== undefined) y = it.y - it.lift;
    else for (let k = 0; k < 4; k++) {
      const choca = placed.find(q => it.x - w / 2 < q.x1 && it.x + w / 2 > q.x0 && y - h < q.y1 && y > q.y0);
      if (!choca) break;
      y = choca.y0 - 3;
    }
    placed.push({ k: it.k, x0: it.x - w / 2, x1: it.x + w / 2, y0: y - h, y1: y, lift: it.y - y });
  }
  return placed;
}
