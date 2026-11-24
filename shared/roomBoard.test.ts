import { describe, expect, it } from 'vitest';
import { boardRows, prRollup, sessionMark, type BoardSession } from './roomBoard';
import type { PRBoard } from './board';

const R = '/repos/web-app';
const wt = (n: string, extra = {}) => ({ path: `${R}/.claude/worktrees/shelter-${n}`, branch: `worktree-shelter-${n}`, main: false, changes: 0, advanced: 0, ...extra });
const MAIN = { path: R, branch: 'main', main: true, changes: 2, advanced: 0 };
const sess = (cwd: string, state: BoardSession['state'], extra: Partial<BoardSession> = {}): BoardSession => ({ state, cwd, roomId: 'web-app', updated: 1, ...extra });
const pr = (branch: string, extra: Partial<PRBoard> = {}): PRBoard => ({ number: 1, title: 'x', url: 'u' + Math.random(), repo: 'org/web-app', branch, state: 'open', updated: 1, ...extra });

describe('prRollup', () => {
  it('lets what most needs someone win across the PRs', () => {
    expect(prRollup([])).toBeUndefined();
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { checks: 'FAILURE' })])).toBe('ci');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { review: 'CHANGES_REQUESTED' })])).toBe('changes');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { review: 'REVIEW_REQUIRED' })])).toBe('review');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { state: 'draft' })])).toBe('approved');
    expect(prRollup([pr('a', { state: 'draft' }), pr('b', { state: 'merged' })])).toBe('draft');
    expect(prRollup([pr('a', { state: 'merged' }), pr('b', { state: 'closed' })])).toBe('merged');
    expect(prRollup([pr('a', { state: 'closed' })])).toBe('closed');
    expect(prRollup([pr('a', { conflicts: true, review: 'APPROVED' })])).toBe('conflicts');
    // a merged PR's old failing CI doesn't count
    expect(prRollup([pr('a', { state: 'merged', checks: 'FAILURE' })])).toBe('merged');
  });
});

describe('sessionMark', () => {
  it('takes the most urgent open conversation, with what it waits on or does', () => {
    expect(sessionMark([])).toEqual({});
    expect(sessionMark([sess(R, 'closed')])).toEqual({});
    expect(sessionMark([sess(R, 'working', { activity: { text: 'editing app.ts' } }), sess(R, 'waiting', { pending: { title: 'permission: git push' } })]))
      .toEqual({ session: 'waiting', detail: 'permission: git push' });
    expect(sessionMark([sess(R, 'idle'), sess(R, 'working', { activity: { text: 'editing app.ts' } })])).toEqual({ session: 'working', detail: 'editing app.ts' });
    expect(sessionMark([sess(R, 'finished', { unread: true })])).toEqual({ session: 'ready' });
    expect(sessionMark([sess(R, 'idle')])).toEqual({ session: 'open' });
  });
});

describe('boardRows', () => {
  it('puts the main copy first and each worktree after it, with its task, its conversations and only its PRs in this repo', () => {
    const a = wt('ABC-101'), b = wt('checkout-flow--k3x9');
    const rows = boardRows('web-app', R, [MAIN, a, b], [
      sess(a.path + '/src', 'waiting', { pending: { title: 'permission: git push' } }),
      sess(R, 'working', { activity: { text: 'reading README' } }),
    ], [
      pr(a.branch, { review: 'REVIEW_REQUIRED' }),
      pr('worktree-shelter-ABC-101-api', { title: 'ABC-101 api', repo: 'org/api', checks: 'FAILURE' }),   // the same task in another room's repo
    ]);
    expect(rows.map(r => [r.main, r.key, r.session, r.pr, r.prs])).toEqual([
      [true, undefined, 'working', undefined, 0],
      [false, 'ABC-101', 'waiting', 'review', 1],
      [false, 'checkout-flow', undefined, undefined, 0],
    ]);
    expect(rows[1].detail).toBe('permission: git push');
    expect(rows[0].detail).toBe('reading README');
  });
  it('shows a worktree a conversation has just created before git lists it', () => {
    const rows = boardRows('web-app', R, [MAIN], [sess(`${R}/.claude/worktrees/shelter-ABC-9`, 'working')], []);
    expect(rows.map(r => r.key)).toEqual([undefined, 'ABC-9']);
    expect(rows[1].session).toBe('working');
    expect(rows[0].session).toBeUndefined();
  });
});
