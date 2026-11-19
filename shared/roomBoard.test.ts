import { describe, expect, it } from 'vitest';
import { boardRows, prRollup, sessionMark, type BoardSession } from './roomBoard';
import type { PRBoard } from './board';

const R = '/repos/web-app';
const wt = (n: string, extra = {}) => ({ path: `${R}/.claude/worktrees/shelter-${n}`, branch: `worktree-shelter-${n}`, main: false, changes: 0, advanced: 0, ...extra });
const MAIN = { path: R, branch: 'main', main: true, changes: 2, advanced: 0 };
const sess = (cwd: string, state: BoardSession['state'], extra: Partial<BoardSession> = {}): BoardSession => ({ state, cwd, roomId: 'web-app', updated: 1, ...extra });
const pr = (branch: string, extra: Partial<PRBoard> = {}): PRBoard => ({ number: 1, title: 'x', url: 'u' + Math.random(), repo: 'org/web-app', branch, state: 'abierto', updated: 1, ...extra });

describe('prRollup', () => {
  it('lets what most needs someone win across the PRs', () => {
    expect(prRollup([])).toBeUndefined();
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { checks: 'FAILURE' })])).toBe('ci');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { review: 'CHANGES_REQUESTED' })])).toBe('cambios');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { review: 'REVIEW_REQUIRED' })])).toBe('revision');
    expect(prRollup([pr('a', { review: 'APPROVED' }), pr('b', { state: 'borrador' })])).toBe('aprobado');
    expect(prRollup([pr('a', { state: 'borrador' }), pr('b', { state: 'fusionado' })])).toBe('borrador');
    expect(prRollup([pr('a', { state: 'fusionado' }), pr('b', { state: 'cerrado' })])).toBe('fusionado');
    expect(prRollup([pr('a', { state: 'cerrado' })])).toBe('cerrado');
    expect(prRollup([pr('a', { conflicts: true, review: 'APPROVED' })])).toBe('conflictos');
    // a merged PR's old failing CI doesn't count
    expect(prRollup([pr('a', { state: 'fusionado', checks: 'FAILURE' })])).toBe('fusionado');
  });
});

describe('sessionMark', () => {
  it('takes the most urgent open conversation, with what it waits on or does', () => {
    expect(sessionMark([])).toEqual({});
    expect(sessionMark([sess(R, 'cerrada')])).toEqual({});
    expect(sessionMark([sess(R, 'trabajando', { activity: { text: 'editing app.ts' } }), sess(R, 'esperando', { pending: { title: 'permission: git push' } })]))
      .toEqual({ session: 'esperando', detail: 'permission: git push' });
    expect(sessionMark([sess(R, 'ociosa'), sess(R, 'trabajando', { activity: { text: 'editing app.ts' } })])).toEqual({ session: 'trabajando', detail: 'editing app.ts' });
    expect(sessionMark([sess(R, 'terminada', { unread: true })])).toEqual({ session: 'listo' });
    expect(sessionMark([sess(R, 'ociosa')])).toEqual({ session: 'abierta' });
  });
});

describe('boardRows', () => {
  it('puts the main copy first and each worktree after it, with its task, its conversations and only its PRs in this repo', () => {
    const a = wt('ABC-101'), b = wt('checkout-flow--k3x9');
    const rows = boardRows('web-app', R, [MAIN, a, b], [
      sess(a.path + '/src', 'esperando', { pending: { title: 'permission: git push' } }),
      sess(R, 'trabajando', { activity: { text: 'reading README' } }),
    ], [
      pr(a.branch, { review: 'REVIEW_REQUIRED' }),
      pr('worktree-shelter-ABC-101-api', { title: 'ABC-101 api', repo: 'org/api', checks: 'FAILURE' }),   // the same task in another room's repo
    ]);
    expect(rows.map(r => [r.main, r.key, r.session, r.pr, r.prs])).toEqual([
      [true, undefined, 'trabajando', undefined, 0],
      [false, 'ABC-101', 'esperando', 'revision', 1],
      [false, 'checkout-flow', undefined, undefined, 0],
    ]);
    expect(rows[1].detail).toBe('permission: git push');
    expect(rows[0].detail).toBe('reading README');
  });
  it('shows a worktree a conversation has just created before git lists it', () => {
    const rows = boardRows('web-app', R, [MAIN], [sess(`${R}/.claude/worktrees/shelter-ABC-9`, 'trabajando')], []);
    expect(rows.map(r => r.key)).toEqual([undefined, 'ABC-9']);
    expect(rows[1].session).toBe('trabajando');
    expect(rows[0].session).toBeUndefined();
  });
});
