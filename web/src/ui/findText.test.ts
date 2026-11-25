import { describe, expect, it } from 'vitest';
import { findKind, keepNear, matchOffsets, stepMatch } from './findText';

describe('matchOffsets', () => {
  it('finds every match ignoring case, without overlapping', () => {
    expect(matchOffsets('Push to main, then PUSH again', 'push')).toEqual([0, 19]);
    expect(matchOffsets('aaaa', 'aa')).toEqual([0, 2]);
  });
  it('nothing for an empty query or no match', () => {
    expect(matchOffsets('abc', '')).toEqual([]);
    expect(matchOffsets('abc', 'x')).toEqual([]);
  });
  it('stops at the limit', () => {
    expect(matchOffsets('x'.repeat(50), 'x', 10)).toHaveLength(10);
  });
  it('keeps the offsets of the text when lowercasing would change its length', () => {
    const text = 'İstanbul istanbul';
    expect(matchOffsets(text, 'istanbul')).toEqual([9]);
  });
});

describe('stepMatch', () => {
  it('starts at the first going down and at the last going up', () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
  });
  it('wraps around both ways', () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
  });
  it('none without matches', () => { expect(stepMatch(0, 0, 1)).toBe(-1); });
});

describe('keepNear', () => {
  it('stays on the match where the current one was, or the next one after it', () => {
    expect(keepNear([5, 20, 40], 20)).toBe(1);
    expect(keepNear([5, 22, 40], 20)).toBe(1);
    expect(keepNear([5, 10], 20)).toBe(1);
    expect(keepNear([5, 10], undefined)).toBe(0);
    expect(keepNear([], 3)).toBe(-1);
  });
});

describe('findKind', () => {
  const el = (tagName: string, inside: string[] = []) => ({ tagName, closest: (s: string) => (s.split(',').some(x => inside.includes(x.trim())) ? {} : null) });
  it('a browser or the page window with the focus', () => {
    expect(findKind(el('WEBVIEW', ['.window-browser']), true)).toBe('web');
    expect(findKind(el('IFRAME', ['.window-browser']), true)).toBe('page');
  });
  it('the intercom: its composer or anything in it, or nothing focused while it is on screen', () => {
    expect(findKind(el('TEXTAREA', ['.console']), true)).toBe('intercom');
    expect(findKind(el('BODY'), true)).toBe('intercom');
    expect(findKind(null, true)).toBe('intercom');
    expect(findKind(el('BODY'), false)).toBeNull();
  });
  it('other fields, terminals and editors keep ⌘F', () => {
    expect(findKind(el('TEXTAREA', ['.window-terminal']), true)).toBeNull();
    expect(findKind(el('TEXTAREA', ['.ventana-archivos']), true)).toBeNull();
    expect(findKind(el('INPUT'), true)).toBeNull();
    expect(findKind(el('TEXTAREA', ['.window-browser']), true)).toBeNull();   // Spotify's keyboard field
  });
});
