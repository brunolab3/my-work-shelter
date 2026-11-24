// A conversation's log by pages: the intercom holds only its latest entries (a page, `LOG_PAGE_SIZES`, chosen in the
// options) and asks for older ones when the Overseer scrolls to the top (server: Sessions.page, from memory and then the
// transcript on disk). Pure: the client, the server and the tests use it.

export const LOG_PAGE_SIZES = [50, 100, 200, 500];
export const DEFAULT_LOG_PAGE = 100;

interface Logged { id: string; ts: number }
export interface LogPage<T> { entries: T[]; more: boolean }
/** The oldest entry the client holds: older pages end right before it */
export type LogCursor = Logged;

/** The `limit` entries right before `before`, or the latest ones without it, and whether older ones remain. When
 *  `before` is not among them (cut from memory, another reading of the transcript), those older than its time */
export function logPage<T extends Logged>(entries: T[], limit: number, before?: LogCursor): LogPage<T> {
  let end = entries.length;
  if (before) {
    const i = entries.findIndex(e => e.id === before.id);
    end = i >= 0 ? i : (k => (k < 0 ? entries.length : k))(entries.findIndex(e => e.ts >= before.ts));
  }
  const start = Math.max(0, end - Math.max(1, limit));
  return { entries: entries.slice(start, end), more: start > 0 };
}

/** An older page put before what is held, without repeating any entry */
export function prependOlder<T extends Logged>(held: T[], older: T[]): T[] {
  const ids = new Set(held.map(e => e.id));
  return [...older.filter(e => !ids.has(e.id)), ...held];
}

/** The latest page as it arrives, with whatever came live meanwhile (entries not in it, from its last time on) */
export function withLatest<T extends Logged>(page: T[], held: T[]): T[] {
  const ids = new Set(page.map(e => e.id)), since = page.at(-1)?.ts ?? 0;
  return [...page, ...held.filter(e => !ids.has(e.id) && e.ts >= since)];
}

/** Back at the bottom, only the latest `keep` stay held; `trimmed`: older ones can be asked for again */
export function trimToLatest<T>(held: T[], keep: number): { entries: T[]; trimmed: boolean } {
  return held.length > keep ? { entries: held.slice(-keep), trimmed: true } : { entries: held, trimmed: false };
}

/** Where the scroll goes once older entries are added above, so what was in view stays in place */
export const scrollAfterPrepend = (top: number, heightBefore: number, heightAfter: number) => top + Math.max(0, heightAfter - heightBefore);
