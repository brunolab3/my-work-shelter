// The top bar compacts itself by measuring, not by window width: it tries each level from the fullest (0) up and keeps
// the first one whose width fits the room it has (styles.css `.regleta[data-compact]` says what each level drops;
// dropped texts stay for tooltips and screen readers). Set on the element directly, not through React, so measuring
// every level happens before the next paint and React's re-renders leave it alone.
import { useLayoutEffect, type RefObject } from 'react';

export const MAX_COMPACT = 4;

/** The first level from 0 up whose measured width is within `room` (the last level when none fits). */
export function fitLevel(setLevel: (level: number) => void, width: () => number, room: number, max = MAX_COMPACT): number {
  for (let level = 0; level <= max; level++) {
    setLevel(level);
    if (level === max || width() <= room) return level;
  }
  return max;
}

/** Keeps the bar compacted to what fits: again when the window, the bar's container or its contents change size. */
export function useFitBar(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current, parent = el?.parentElement;
    if (!el || !parent) return;
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      // a margin of one unit (the bar's font size) on each side, so it never touches the window's edges
      const room = parent.clientWidth - 2 * parseFloat(getComputedStyle(el).fontSize || '16');
      fitLevel(level => { el.dataset.compact = String(level); }, () => el.offsetWidth, room);
      fitting = false;
    };
    fit();
    // the bar's own size changes with its contents (the clock, a counter, the meeting's title); the level it lands on
    // changes it again, which only re-measures to the same level
    const ro = new ResizeObserver(fit);
    ro.observe(el); ro.observe(parent);
    // fonts arriving late change every width
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
  }, [ref]);
}
