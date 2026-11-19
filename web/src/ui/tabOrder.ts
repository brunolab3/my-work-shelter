// Order of a window's tabs (windows.tsx): the order they were opened in, never by state; ⌘1…⌘9 and ⌃Tab follow it.
import { recentFirst, type Recency } from '@shared/recent';

export type TabState = 'esperando' | 'sinLeer' | 'error' | 'trabajando' | 'ociosa';
const RANK: Record<TabState, number> = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };

/** With «group by room», each group where its first tab is, keeping the order inside it (by `grupo`, or by `clave`). */
export function groupTabs<T extends { group?: string }>(items: T[], key: (x: T) => string = x => x.group ?? ''): T[] {
  const groups = new Map<string, number>();   // group → its first appearance
  for (const x of items) if (!groups.has(key(x))) groups.set(key(x), groups.size);
  return [...items].sort((a, b) => groups.get(key(a))! - groups.get(key(b))!);
}
/** Lists of talkers (the intercom's selector, the bar's hover list): by their most urgent conversation's state as the
 *  tabs (waiting, unread, failed, working, ready), then by recency (`recentFirst`: by the minute, then by name). Those
 *  without a conversation go last, in the order given (a stable sort keeps dwellers before holograms). */
export const talkerFirst = (a: Recency & { state?: TabState }, b: Recency & { state?: TabState }) =>
  (a.state ? RANK[a.state] : 5) - (b.state ? RANK[b.state] : 5) || (a.state && b.state ? recentFirst(a, b) : 0);

/** The bar's COM row when its chips don't all fit in `cabe` beside the «+N» chip of width `mas`: which are left out,
 *  sticky so that switching conversations doesn't reshuffle it. Those left out before (`antes`) stay out and the rest
 *  stay in, but the one in front (`delante`, -1 for none) always shows; while they don't fit, the least relevant leave
 *  (highest rank, then the last one), and those out come back by rank (lowest first, then in order) wherever they still
 *  fit. With nothing before, the most urgent stay in view. Returns the indices left out, by rank. */
export function overflowChips(widths: number[], ranks: number[], fits: number, more: number, before: number[] = [], front = -1): number[] {
  if (widths.reduce((a, b) => a + b, 0) <= fits) return [];
  const byRank = (a: number, b: number) => ranks[a] - ranks[b] || a - b;
  const inside = new Set(widths.map((_, i) => i).filter(i => i === front || !before.includes(i)));
  let used = more + [...inside].reduce((a, i) => a + widths[i], 0);
  while (used > fits) {
    const sale = [...inside].filter(i => i !== front).sort(byRank).at(-1);
    if (sale === undefined) break;
    inside.delete(sale); used -= widths[sale];
  }
  for (const i of widths.map((_, i) => i).filter(i => !inside.has(i)).sort(byRank)) {
    if (used + widths[i] <= fits) { inside.add(i); used += widths[i]; }
  }
  return widths.map((_, i) => i).filter(i => !inside.has(i)).sort(byRank);
}

/** ⌘1…⌘8 the n-th visible tab, ⌘9 the last; ⌃Tab the next one. */
export const nthTab = (orden: { id: string }[], n: number) => (n === 9 ? orden.at(-1) : orden[n - 1])?.id;
export const nextTab = (orden: { id: string }[], active: string, step: number) => {
  const i = orden.findIndex(x => x.id === active);
  return orden.length > 1 ? orden[(i + step + orden.length) % orden.length].id : undefined;
};

