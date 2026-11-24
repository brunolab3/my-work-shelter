import { describe, it, expect } from 'vitest';
import { flaggedIds, setFlag, isFlagged, flaggedIn, flaggedInIntercom, tabFlaggable, flagOf, flagMark, FLAGGED_MAX } from './flagged';
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
  it('counts on tags only open conversations whose Claude Code session is flagged, never a closed or starting one', () => {
    const ids = new Set(['a', 'b']);
    expect(isFlagged(s('a'), ids)).toBe(true);
    expect(isFlagged(s('a', 'trabajando'), ids)).toBe(true);
    expect(isFlagged(s('a', 'cerrada'), ids)).toBe(false);
    expect(isFlagged(s(undefined), ids)).toBe(false);
    expect(isFlagged(s('z'), ids)).toBe(false);
    expect(isFlagged(undefined, ids)).toBe(false);
    expect(flaggedIn([s('a'), s('b', 'cerrada'), s('z'), undefined, s('b')], ids)).toBe(2);
  });
  it('can be set on any conversation that has its Claude Code session, open or closed', () => {
    const ids = new Set(['a']);
    expect(flagOf(s('a'), ids)).toBe(true);
    expect(flagOf(s('b'), ids)).toBe(false);
    expect(flagOf(s(undefined, 'arrancando'), ids)).toBeUndefined();
    expect(flagOf(undefined, ids)).toBeUndefined();
  });
  it('can be set on a closed conversation, by its summary or just its Claude Code session id (one being resumed)', () => {
    const ids = new Set(['a']);
    expect(flagOf(s('a', 'cerrada'), ids)).toBe(true);
    expect(flagOf(s('b', 'cerrada'), ids)).toBe(false);
    expect(flagOf({ claudeId: 'a' }, ids)).toBe(true);
    expect(flagOf({ claudeId: 'b' }, ids)).toBe(false);
    expect(flagOf({ claudeId: '' }, ids)).toBeUndefined();
    // flagging a closed one keeps it when it is resumed, and counts on tags again once open
    const after = flaggedIds({ flaggedConversations: setFlag([], 'c', true) });
    expect(isFlagged(s('c', 'cerrada'), after)).toBe(false);
    expect(isFlagged(s('c', 'trabajando'), after)).toBe(true);
  });
  it('counts on the COM selectors every flagged conversation in an intercom, a closed one too, while tags skip it', () => {
    const ids = new Set(['a', 'b']);
    const list = [s('a', 'cerrada'), s('b'), s('z'), s(undefined, 'arrancando'), undefined];
    const sessions = Object.fromEntries(list.map((x, i) => [String(i), x])) as Record<string, SessionSummary>;
    const tabs = list.map((_, i) => ({ view: { type: 'sesion', sessionId: String(i) } }));
    expect(flaggedInIntercom(tabs, sessions, ids)).toBe(2);
    expect(flaggedIn(list, ids)).toBe(1);
  });
  it('counts on the COM selectors a closed flagged conversation waiting in its tab to be resumed, as its tab shows ⚑', () => {
    const ids = new Set(['c']);
    const tabs = [{ view: { type: 'nuevo', resume: { claudeId: 'c' } } }, { view: { type: 'nuevo', resume: { claudeId: '' } } }, { view: { type: 'nuevo' } }, { view: { type: 'menu' } }];
    expect(tabs.map(p => flagOf(tabFlaggable(p, {}), ids))).toEqual([true, undefined, undefined, undefined]);
    expect(flaggedInIntercom(tabs, {}, ids)).toBe(1);
    expect(flaggedInIntercom([{ view: { type: 'sesion', sessionId: 'gone' } }], {}, ids)).toBe(0);
  });
  it('tags show ⚑ for one pending conversation and ⚑ n for several', () => {
    expect(flagMark(0)).toBeUndefined();
    expect(flagMark(1)).toBe('⚑');
    expect(flagMark(3)).toBe('⚑ 3');
  });
});
