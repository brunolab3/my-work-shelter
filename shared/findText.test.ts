import { describe, expect, it } from 'vitest';
import { FIND_MAX, hitAt, indexOfHit, logHits, matchOffsets } from './findText.ts';

describe('matchOffsets', () => {
  it('finds every match ignoring case, without overlapping', () => {
    expect(matchOffsets('Push to main, then PUSH again', 'push')).toEqual([0, 19]);
    expect(matchOffsets('aaaa', 'aa')).toEqual([0, 2]);
  });
  it('stops at the limit, FIND_MAX by default', () => {
    expect(matchOffsets('x'.repeat(50), 'x', 10)).toHaveLength(10);
    expect(matchOffsets('x'.repeat(FIND_MAX + 5), 'x')).toHaveLength(FIND_MAX);
  });
});

describe('logHits', () => {
  const log = [
    { id: 'a', text: 'push, push again' },
    { id: 'b', text: 'nothing here' },
    { id: 'c', text: 'Push' },
  ];
  it('counts the matches of the whole log, entry by entry, oldest first', () => {
    expect(logHits(log, 'push')).toEqual({ hits: [{ id: 'a', n: 2 }, { id: 'c', n: 1 }], total: 3 });
  });
  it('nothing for an empty query or no match', () => {
    expect(logHits(log, '')).toEqual({ hits: [], total: 0 });
    expect(logHits(log, 'zzz')).toEqual({ hits: [], total: 0 });
  });
  it('stops counting at the limit, keeping the newest matches', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, text: 'x x x' }));
    const r = logHits(many, 'x', 7);
    expect(r.total).toBe(7);
    expect(r.hits).toEqual([{ id: 'e7', n: 1 }, { id: 'e8', n: 3 }, { id: 'e9', n: 3 }]);
  });
});

describe('hitAt and indexOfHit', () => {
  const hits = [{ id: 'a', n: 2 }, { id: 'c', n: 1 }];
  it('maps a match number to its entry and its place in it', () => {
    expect(hitAt(hits, 0)).toEqual({ id: 'a', k: 0 });
    expect(hitAt(hits, 1)).toEqual({ id: 'a', k: 1 });
    expect(hitAt(hits, 2)).toEqual({ id: 'c', k: 0 });
    expect(hitAt(hits, 3)).toBeNull();
  });
  it('maps back from the entry and its place to the match number', () => {
    expect(indexOfHit(hits, 'a', 1)).toBe(1);
    expect(indexOfHit(hits, 'c', 0)).toBe(2);
    expect(indexOfHit(hits, 'b', 0)).toBe(-1);
  });
  it('clamps a place beyond the entry\'s last match', () => {
    expect(indexOfHit(hits, 'a', 5)).toBe(1);
  });
});
