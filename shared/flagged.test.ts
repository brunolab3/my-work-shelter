import { describe, it, expect } from 'vitest';
import { flaggedIds, setFlag, isFlagged, flaggedIn, flagOf, flagMark, FLAGGED_MAX } from './flagged';
import type { SessionSummary } from './protocol';

const s = (claudeId: string | undefined, state: SessionSummary['state'] = 'terminada') => ({ claudeId, state }) as SessionSummary;

describe('conversations marked as pending', () => {
  it('reads the flagged ids from the settings, ignoring anything else', () => {
    expect([...flaggedIds({ flaggedConversations: ['a', 3, 'b'] })]).toEqual(['a', 'b']);
    expect(flaggedIds({}).size).toBe(0);
    expect(flaggedIds(null).size).toBe(0);
    expect(flaggedIds({ flaggedConversations: 'a' }).size).toBe(0);
  });
  it('sets and clears a flag once, keeping the newest when there are too many', () => {
    expect(setFlag(undefined, 'a', true)).toEqual(['a']);
    expect(setFlag(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(setFlag(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(setFlag(['a'], '', true)).toEqual(['a']);
    const many = Array.from({ length: FLAGGED_MAX }, (_, i) => `c${i}`);
    const r = setFlag(many, 'new', true);
    expect(r).toHaveLength(FLAGGED_MAX);
    expect(r[0]).toBe('c1');
    expect(r.at(-1)).toBe('new');
  });
  it('shows on open conversations whose Claude Code session is flagged, never a closed or starting one', () => {
    const ids = new Set(['a', 'b']);
    expect(isFlagged(s('a'), ids)).toBe(true);
    expect(isFlagged(s('a', 'trabajando'), ids)).toBe(true);
    expect(isFlagged(s('a', 'cerrada'), ids)).toBe(false);
    expect(isFlagged(s(undefined), ids)).toBe(false);
    expect(isFlagged(s('z'), ids)).toBe(false);
    expect(isFlagged(undefined, ids)).toBe(false);
    expect(flaggedIn([s('a'), s('b', 'cerrada'), s('z'), undefined, s('b')], ids)).toBe(2);
  });
  it('can be set only on an open conversation that has its Claude Code session', () => {
    const ids = new Set(['a']);
    expect(flagOf(s('a'), ids)).toBe(true);
    expect(flagOf(s('b'), ids)).toBe(false);
    expect(flagOf(s(undefined, 'arrancando'), ids)).toBeUndefined();
    expect(flagOf(s('a', 'cerrada'), ids)).toBeUndefined();
    expect(flagOf(undefined, ids)).toBeUndefined();
  });
  it('tags show ⚑ for one pending conversation and ⚑ n for several', () => {
    expect(flagMark(0)).toBeUndefined();
    expect(flagMark(1)).toBe('⚑');
    expect(flagMark(3)).toBe('⚑ 3');
  });
});
