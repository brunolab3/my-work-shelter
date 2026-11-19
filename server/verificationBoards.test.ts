import { describe, expect, it } from 'vitest';
import { boardsUnset, doneTransition, saveBoard, taskTracker, type CtxTrackers } from './verificationBoards.ts';

// a made-up Jira with two boards, each with its own workflow
function ctx(): CtxTrackers & { saved: Record<string, any> } {
  const s: Record<string, any> = { ABC: { test: 'Prod check', done: 'Done' } };
  return {
    saved: s, settings: () => s, save: (b, v) => { s[b] = v; }, connected: f => f === 'jira',
    action: async name => (name === 'panel' ? { tareas: [{ key: 'ABC-1', state: 'PROD CHECK', category: 'indeterminate' }, { key: 'XY-2', state: 'In progress', category: 'indeterminate' }] } : {}),
  };
}

describe('the tracker\'s side of production verification', () => {
  it('a task is in prod check by its own board\'s status; it can move to done once verified', async () => {
    const c = ctx();
    expect(await taskTracker(c, 'ABC-1')).toMatchObject({ source: 'jira', board: 'ABC', inProdCheck: true, move: false });
    expect(await taskTracker(c, 'abc-1', true)).toMatchObject({ move: true });
    expect(await taskTracker(c, 'XY-2')).toMatchObject({ inProdCheck: false });
    expect((await taskTracker(c, 'XY-2'))?.test).toBeUndefined();
    expect(await taskTracker(c, 'ZZ-9')).toBeUndefined();
  });

  it('asks for the boards still without a prod-check status, and saves each board on its own', async () => {
    const c = ctx();
    expect(await boardsUnset(c)).toEqual(['XY']);
    saveBoard(c, 'xy', { test: ' Verify ', done: '' });
    expect(c.saved.XY).toEqual({ test: 'Verify' });
    expect(await boardsUnset(c)).toEqual([]);
    expect(() => saveBoard(c, 'x y', {})).toThrow();
  });

  it('moves to done only with a single matching transition', () => {
    const tr = (id: string, a: string) => ({ id, name: a, a, category: 'done' as const });
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')], 'done')?.id).toBe('1');
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')])).toBeUndefined();
    expect(doneTransition([tr('1', 'Done')])?.id).toBe('1');
  });
});
