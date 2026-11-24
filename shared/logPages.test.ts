import { describe, expect, it } from 'vitest';
import { logPage, prependOlder, withLatest, trimToLatest, scrollAfterPrepend } from './logPages.ts';

const log = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, ts: 1000 + i }));

describe('logPage', () => {
  it('without a cursor, the last page; older ones remain while it does not start at the first entry', () => {
    expect(logPage(log(250), 100)).toEqual({ entries: log(250).slice(150), more: true });
    expect(logPage(log(100), 100)).toEqual({ entries: log(100), more: false });
    expect(logPage(log(30), 100)).toEqual({ entries: log(30), more: false });
    expect(logPage([], 100)).toEqual({ entries: [], more: false });
  });
  it('with a cursor, the page right before it, down to the first page', () => {
    const l = log(250);
    const p2 = logPage(l, 100, l[150]);
    expect(p2.entries.map(e => e.id)).toEqual(l.slice(50, 150).map(e => e.id));
    expect(p2.more).toBe(true);
    const p3 = logPage(l, 100, p2.entries[0]);
    expect(p3).toEqual({ entries: l.slice(0, 50), more: false });
    expect(logPage(l, 100, l[0])).toEqual({ entries: [], more: false });
  });
  it('a cursor no longer there pages by its time', () => {
    const l = log(10);
    expect(logPage(l, 3, { id: 'gone', ts: 1005 }).entries.map(e => e.id)).toEqual(['e2', 'e3', 'e4']);
    expect(logPage(l, 3, { id: 'gone', ts: 9999 }).entries.map(e => e.id)).toEqual(['e7', 'e8', 'e9']);
  });
});

describe('putting pages together', () => {
  it('an older page goes before, without repeats', () => {
    expect(prependOlder(log(5).slice(2), log(3)).map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
  });
  it('the latest page keeps what arrived live while it was asked for', () => {
    const l = log(6);
    expect(withLatest(l.slice(0, 4), [l[3], l[4], l[5]]).map(e => e.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5']);
    expect(withLatest(l.slice(2, 4), [l[0]]).map(e => e.id)).toEqual(['e2', 'e3']);
  });
  it('back at the bottom only the last page stays, and says older ones can be loaded again', () => {
    expect(trimToLatest(log(250), 100)).toEqual({ entries: log(250).slice(150), trimmed: true });
    expect(trimToLatest(log(80), 100)).toEqual({ entries: log(80), trimmed: false });
  });
  it('the scroll position moves down by what was added above, so the view stays put', () => {
    expect(scrollAfterPrepend(10, 2000, 3500)).toBe(1510);
    expect(scrollAfterPrepend(10, 2000, 2000)).toBe(10);
  });
});
