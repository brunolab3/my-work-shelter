// Order of a window's tabs (ventanas.tsx): the order they were opened in, never by state; ⌘1…⌘9 and ⌃Tab follow it.
import { recentFirst, type Recency } from '@shared/recientes';

export type TabState = 'esperando' | 'sinLeer' | 'error' | 'trabajando' | 'ociosa';
const RANK: Record<TabState, number> = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };

/** With «group by room», each group where its first tab is, keeping the order inside it. */
export function groupTabs<T extends { grupo?: string }>(items: T[]): T[] {
  const grupos = new Map<string, number>();   // group → its first appearance
  for (const x of items) if (!grupos.has(x.grupo ?? '')) grupos.set(x.grupo ?? '', grupos.size);
  return [...items].sort((a, b) => grupos.get(a.grupo ?? '')! - grupos.get(b.grupo ?? '')!);
}
/** Lists of talkers (the intercom's selector, the bar's hover list): by their most urgent conversation's state as the
 *  tabs (waiting, unread, failed, working, ready), then by recency (`recentFirst`: by the minute, then by name). Those
 *  without a conversation go last, in the order given (a stable sort keeps dwellers before holograms). */
export const talkerFirst = (a: Recency & { estado?: TabState }, b: Recency & { estado?: TabState }) =>
  (a.estado ? RANK[a.estado] : 5) - (b.estado ? RANK[b.estado] : 5) || (a.estado && b.estado ? recentFirst(a, b) : 0);

/** The bar's COM row when its chips don't all fit in `cabe`: they are placed by rank (lowest first, then in order)
 *  wherever they still fit beside the «+N» chip of width `mas`; returns the indices left out, by rank. */
export function overflowChips(anchos: number[], rangos: number[], cabe: number, mas: number): number[] {
  if (anchos.reduce((a, b) => a + b, 0) <= cabe) return [];
  let usado = mas; const fuera: number[] = [];
  for (const i of anchos.map((_, i) => i).sort((a, b) => rangos[a] - rangos[b] || a - b)) {
    if (usado + anchos[i] <= cabe) usado += anchos[i]; else fuera.push(i);
  }
  return fuera;
}

/** ⌘1…⌘8 the n-th visible tab, ⌘9 the last; ⌃Tab the next one. */
export const nthTab = (orden: { id: string }[], n: number) => (n === 9 ? orden.at(-1) : orden[n - 1])?.id;
export const nextTab = (orden: { id: string }[], activa: string, paso: number) => {
  const i = orden.findIndex(x => x.id === activa);
  return orden.length > 1 ? orden[(i + paso + orden.length) % orden.length].id : undefined;
};

