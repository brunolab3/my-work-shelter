// ⌘F's matching, shared by the client (web/src/ui/findText.ts, FindBar.tsx) and the server, which counts a conversation's
// matches in its whole log (Sessions.find): where a text's matches are, and which entry each of a log's matches is in.

/** Matches beyond this many are not counted (the bar says «N+») */
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

/** The entries holding matches, oldest first, with how many each holds */
export interface LogHit { id: string; n: number }
export interface LogHits { hits: LogHit[]; total: number }

/** The matches of `query` in a log's entries (their text), up to `max` in all, the newest ones when there are more (the
 *  search starts at the newest); `total` is the count the bar shows */
export function logHits(entries: { id: string; text: string }[], query: string, max = FIND_MAX): LogHits {
  const hits: LogHit[] = [];
  let total = 0;
  for (let i = entries.length - 1; i >= 0 && total < max; i--) {
    const n = Math.min(matchOffsets(entries[i].text, query).length, max - total);
    if (n) { hits.push({ id: entries[i].id, n }); total += n; }
  }
  return { hits: hits.reverse(), total };
}

/** The match number `i` (from 0, oldest first) as its entry and its place among that entry's matches */
export function hitAt(hits: LogHit[], i: number): { id: string; k: number } | null {
  let left = i;
  for (const h of hits) {
    if (left < h.n) return { id: h.id, k: left };
    left -= h.n;
  }
  return null;
}

/** The number of the match `k` in entry `id` (clamped to its last one), −1 when the entry has no matches */
export function indexOfHit(hits: LogHit[], id: string, k: number): number {
  let before = 0;
  for (const h of hits) {
    if (h.id === id) return before + Math.min(Math.max(0, k), h.n - 1);
    before += h.n;
  }
  return -1;
}

/** The match after (`dir` 1) or before (−1) `current` among `n`, wrapping around; −1 with none */
export const stepMatch = (current: number, n: number, dir: 1 | -1) => (n <= 0 ? -1 : current < 0 ? (dir > 0 ? 0 : n - 1) : (current + dir + n) % n);
