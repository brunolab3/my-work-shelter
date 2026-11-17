// Order of a window's tabs (windows.tsx): the order they were opened in, never by state; ⌘1…⌘9 and ⌃Tab follow it.
import { recentFirst, type Recency } from '@shared/recent';

export type TabState = 'esperando' | 'sinLeer' | 'error' | 'trabajando' | 'ociosa';
const RANK: Record<TabState, number> = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };

/** With «group by room», each group where its first tab is, keeping the order inside it (by `grupo`, or by `clave`). */
export function groupTabs<T extends { grupo?: string }>(items: T[], clave: (x: T) => string = x => x.grupo ?? ''): T[] {
  const grupos = new Map<string, number>();   // group → its first appearance
  for (const x of items) if (!grupos.has(clave(x))) grupos.set(clave(x), grupos.size);
  return [...items].sort((a, b) => grupos.get(clave(a))! - grupos.get(clave(b))!);
}
/** Lists of talkers (the intercom's selector, the bar's hover list): by their most urgent conversation's state as the
 *  tabs (waiting, unread, failed, working, ready), then by recency (`recentFirst`: by the minute, then by name). Those
 *  without a conversation go last, in the order given (a stable sort keeps dwellers before holograms). */
export const talkerFirst = (a: Recency & { estado?: TabState }, b: Recency & { estado?: TabState }) =>
  (a.estado ? RANK[a.estado] : 5) - (b.estado ? RANK[b.estado] : 5) || (a.estado && b.estado ? recentFirst(a, b) : 0);

/** The bar's COM row when its chips don't all fit in `cabe` beside the «+N» chip of width `mas`: which are left out,
 *  sticky so that switching conversations doesn't reshuffle it. Those left out before (`antes`) stay out and the rest
 *  stay in, but the one in front (`delante`, -1 for none) always shows; while they don't fit, the least relevant leave
 *  (highest rank, then the last one), and those out come back by rank (lowest first, then in order) wherever they still
 *  fit. With nothing before, the most urgent stay in view. Returns the indices left out, by rank. */
export function overflowChips(anchos: number[], rangos: number[], cabe: number, mas: number, antes: number[] = [], delante = -1): number[] {
  if (anchos.reduce((a, b) => a + b, 0) <= cabe) return [];
  const porRango = (a: number, b: number) => rangos[a] - rangos[b] || a - b;
  const dentro = new Set(anchos.map((_, i) => i).filter(i => i === delante || !antes.includes(i)));
  let usado = mas + [...dentro].reduce((a, i) => a + anchos[i], 0);
  while (usado > cabe) {
    const sale = [...dentro].filter(i => i !== delante).sort(porRango).at(-1);
    if (sale === undefined) break;
    dentro.delete(sale); usado -= anchos[sale];
  }
  for (const i of anchos.map((_, i) => i).filter(i => !dentro.has(i)).sort(porRango)) {
    if (usado + anchos[i] <= cabe) { dentro.add(i); usado += anchos[i]; }
  }
  return anchos.map((_, i) => i).filter(i => !dentro.has(i)).sort(porRango);
}

/** ⌘1…⌘8 the n-th visible tab, ⌘9 the last; ⌃Tab the next one. */
export const nthTab = (orden: { id: string }[], n: number) => (n === 9 ? orden.at(-1) : orden[n - 1])?.id;
export const nextTab = (orden: { id: string }[], activa: string, paso: number) => {
  const i = orden.findIndex(x => x.id === activa);
  return orden.length > 1 ? orden[(i + paso + orden.length) % orden.length].id : undefined;
};

