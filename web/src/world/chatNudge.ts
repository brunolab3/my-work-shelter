// Opening a chat leaves the camera where the player put it; it only shifts, once, when the person would be out of view
// or under the intercom (which covers the right of the screen).

export interface ChatView {
  cx: number; cy: number;   // centre of what is seen (the camera's goal plus what was dragged)
  hw: number; hh: number;   // half width and half height seen at the person's depth
  free: number;             // fraction of the width the intercom leaves free, from the left (1: no intercom)
}

/** How much to move the view (x, y) so `px`, `py` (the person's middle) is in the free part with a margin; 0, 0 if it already is. */
export function chatNudge(v: ChatView, px: number, py: number, margin = 0.15) {
  const left = v.cx - v.hw, width = 2 * v.hw * v.free;
  const shift = (p: number, lo: number, hi: number) => p < lo ? p - lo : p > hi ? p - hi : 0;
  return {
    x: shift(px, left + width * margin, left + width * (1 - margin)),
    y: shift(py, v.cy - v.hh * (1 - 2 * margin), v.cy + v.hh * (1 - 2 * margin)),
  };
}
