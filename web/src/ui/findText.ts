// ⌘F, the pure part (web/src/ui/FindBar.tsx draws the bar; server/page/notes.js does the same matching inside a page):
// where the matches of a text are, which one comes next, and what has focus to search in.

/** Matches beyond this many are not marked (the bar says «N+») */
export const FIND_MAX = 1000;

/** Where `query` starts in `text`, ignoring case, without overlapping, at most `max` */
export function matchOffsets(text: string, query: string, max = FIND_MAX): number[] {
  if (!query) return [];
  // lowercasing may change the length of some letters (İ): then the offsets wouldn't be the text's, so only exact case
  const low = text.toLowerCase(), q = query.toLowerCase();
  const [hay, needle] = low.length === text.length && q.length === query.length ? [low, q] : [text, query];
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < max; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/** The match after (`dir` 1) or before (−1) `current` among `n`, wrapping around; −1 with none */
export const stepMatch = (current: number, n: number, dir: 1 | -1) => (n <= 0 ? -1 : current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n);

/** After the text changed (new entries in the log), the match at or right after where the current one was */
export function keepNear(offsets: number[], at: number | undefined): number {
  if (!offsets.length) return -1;
  if (at === undefined) return 0;
  const i = offsets.findIndex(o => o >= at);
  return i < 0 ? offsets.length - 1 : i;
}

export type FindKind = 'intercom' | 'web' | 'page';
interface Focused { tagName: string; closest(selector: string): unknown }
/** What ⌘F searches from what has focus: a browser's <webview> («Web» and the work sites), the «Página» window's
 *  <iframe>, or the intercom (its composer or anything in it, or nothing focused while it's on screen). Any other field,
 *  terminal or editor keeps ⌘F to itself (null) */
export function findKind(active: Focused | null, intercomShown: boolean): FindKind | null {
  if (!active || active.tagName === 'BODY' || active.tagName === 'HTML') return intercomShown ? 'intercom' : null;
  if (active.tagName === 'WEBVIEW' && active.closest('.ventana-navegador')) return 'web';
  if (active.tagName === 'IFRAME' && active.closest('.ventana-navegador')) return 'page';
  if (active.closest('.consola')) return 'intercom';
  return null;
}
