// Order of a window's tabs (ventanas.tsx): most urgent first (tabs that are not a conversation last), stable within a
// state; ⌘1…⌘9 and ⌃Tab follow that order.
export type TabState = 'esperando' | 'sinLeer' | 'error' | 'trabajando' | 'ociosa';
const RANK: Record<TabState, number> = { esperando: 0, sinLeer: 1, error: 2, trabajando: 3, ociosa: 4 };

/** Most urgent first, in arrival order within a state; `fija` keeps its place. Grouped, each group goes where its most
 *  urgent tab would, with the same order inside. */
export function orderTabs<T extends { id: string; estado?: TabState; grupo?: string }>(items: T[], fija?: { id: string; i: number }, agrupar = false): T[] {
  const rank = (x: T) => (x.estado ? RANK[x.estado] : 5);
  const grupos = new Map<string, [number, number]>();   // group → [its rank, its first appearance]
  if (agrupar) items.forEach((x, i) => { const g = grupos.get(x.grupo ?? ''); grupos.set(x.grupo ?? '', g ? [Math.min(g[0], rank(x)), g[1]] : [rank(x), i]); });
  const g = (x: T) => grupos.get(x.grupo ?? '') ?? [0, 0];
  const l = [...items].sort((a, b) => g(a)[0] - g(b)[0] || g(a)[1] - g(b)[1] || rank(a) - rank(b));
  const k = fija && fija.i >= 0 ? l.findIndex(x => x.id === fija.id) : -1;
  if (k < 0) return l;
  const [x] = l.splice(k, 1);
  // grouped, without leaving its group (in case the others moved)
  let i = Math.min(fija!.i, l.length);
  if (agrupar) {
    const del = l.map((y, j) => (y.grupo === x.grupo ? j : -1)).filter(j => j >= 0);
    if (del.length) i = Math.max(del[0], Math.min(del[del.length - 1] + 1, i));
  }
  l.splice(i, 0, x);
  return l;
}
/** ⌘1…⌘8 the n-th visible tab, ⌘9 the last; ⌃Tab the next one. */
export const nthTab = (orden: { id: string }[], n: number) => (n === 9 ? orden.at(-1) : orden[n - 1])?.id;
export const nextTab = (orden: { id: string }[], activa: string, paso: number) => {
  const i = orden.findIndex(x => x.id === activa);
  return orden.length > 1 ? orden[(i + paso + orden.length) % orden.length].id : undefined;
};

