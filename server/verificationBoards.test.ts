import { describe, expect, it } from 'vitest';
import { autoLink, boardsSetup, doneTransition, migrateJira, saveBoard, startupNotices, taskTracker, type CtxTrackers, type TrackerSettings } from './verificationBoards.ts';

// a made-up Jira with two projects that share their statuses, and a Linear team
const JIRA_STATES = { states: ['To Do', 'In progress', 'PROD CHECK', 'Done', 'Discarded'], done: ['Done', 'Discarded'] };
function ctx(s: TrackerSettings = { jira: { test: 'Prod check', done: 'Done' }, boards: {} }, states: Record<string, any> = { ABC: JIRA_STATES, XY: JIRA_STATES }): CtxTrackers & { s: TrackerSettings; asked: string[] } {
  const asked: string[] = [];
  return {
    s, asked, settings: () => s, save: p => { Object.assign(s, p); }, connected: f => f === 'jira' || f === 'linear',
    action: async (name, d) => {
      if (name === 'boardStates') { asked.push(`${d.source}:${d.board}`); if (d.source === 'linear') return { states: ['Todo', 'QA', 'Done'] }; const x = states[String(d.board)]; if (!x) throw new Error('no project'); return x; }
      if (name === 'panel' && d.source === 'jira') return { tareas: [{ key: 'ABC-1', state: 'PROD CHECK', category: 'indeterminate' }, { key: 'XY-2', state: 'In progress', category: 'indeterminate' }] };
      if (name === 'panel') return { myIssues: [{ issues: [{ identifier: 'ENG-3', state: { name: 'QA' } }] }] };
      return {};
    },
  };
}

describe('the tracker\'s side of production verification', () => {
  it('every Jira project uses the one pair; a task in it can move to done once verified', async () => {
    const c = ctx();
    expect(await taskTracker(c, 'ABC-1')).toMatchObject({ source: 'jira', board: 'Jira', test: 'Prod check', done: 'Done', inProdCheck: true, move: false });
    expect(await taskTracker(c, 'abc-1', true)).toMatchObject({ move: true });
    expect(await taskTracker(c, 'XY-2')).toMatchObject({ test: 'Prod check', inProdCheck: false });
    expect(await taskTracker(c, 'ZZ-9')).toBeUndefined();
    // a Linear team keeps its own
    expect(await taskTracker(c, 'ENG-3')).toMatchObject({ source: 'linear', board: 'ENG', inProdCheck: false, move: false });
    c.s.boards.ENG = { test: 'QA' };
    expect(await taskTracker(c, 'ENG-3', true)).toMatchObject({ inProdCheck: true, move: false });
  });

  it('links the pair by itself when there is no doubt', () => {
    expect(autoLink(JIRA_STATES.states, JIRA_STATES.done)).toEqual({ test: 'PROD CHECK', done: 'Done' });
    expect(autoLink(['Prueba en producción', 'Hecho', 'Descartada'], ['Hecho', 'Descartada'])).toEqual({ test: 'Prueba en producción', done: 'Hecho' });
    expect(autoLink(['Verify', 'Closed'], ['Closed'])).toEqual({ test: 'Verify', done: 'Closed' });
    // a done status named like a check is not a prod check, and the same name twice is one
    expect(autoLink(['Prod check', 'prod check', 'Verified'], ['Verified'])).toEqual({ test: 'Prod check', done: 'Verified' });
  });

  it('leaves empty what is not clear: several matches or none', () => {
    expect(autoLink(['Prod check', 'Ready for production', 'Closed', 'Resolved'], ['Closed', 'Resolved'])).toEqual({});
    expect(autoLink(['In progress', 'Done', 'Hecho'], ['Done', 'Hecho'])).toEqual({});
    expect(autoLink(['In progress', 'Done', 'Discarded'], ['Done', 'Discarded'])).toEqual({ done: 'Done' });
    expect(autoLink([], [])).toEqual({});
  });

  it('from the old per-project pairs: the one they agree on, or the most picked, naming the others', () => {
    expect(migrateJira({ ABC: { test: 'Prod check', done: 'Done' }, XY: { test: 'prod check ', done: 'Done' } }, ['ABC', 'XY'])).toEqual({ pair: { test: 'Prod check', done: 'Done' }, others: [] });
    expect(migrateJira({ ABC: { test: 'Verify' }, XY: { test: 'Prod check', done: 'Done' }, ZZ: { test: 'Prod check', done: 'Done' }, ENG: { test: 'QA' } }, ['XY', 'ABC', 'ZZ', 'ABC']))
      .toEqual({ pair: { test: 'Prod check', done: 'Done' }, others: ['ABC: Verify / —'] });
    expect(migrateJira({ ENG: { test: 'QA' } }, ['ABC'])).toBeUndefined();
  });

  it('at start: migrates once (a Linear team keeps its pair), says so when they differed, and asks for what is unset', async () => {
    const c = ctx({ boards: { ABC: { test: 'Verify', done: 'Done' }, XY: { test: 'Prod check', done: 'Done' }, ENG: { test: 'QA' } } }, {});
    const n = await startupNotices(c);
    expect(c.s.jira).toEqual({ test: 'Verify', done: 'Done' });   // a tie: the first project in order
    expect(c.s.boards.ENG).toEqual({ test: 'QA' });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/XY: Prod check \/ Done/);
    expect(await startupNotices(c)).toEqual([]);
  });

  it('at start without a pair: links it from the statuses of all projects of open tasks, or asks once for Jira', async () => {
    const c = ctx({ boards: {} });
    const n = await startupNotices(c);
    expect(c.asked.sort()).toEqual(['jira:ABC', 'jira:XY']);
    expect(c.s.jira).toEqual({ test: 'PROD CHECK', done: 'Done' });
    expect(n).toHaveLength(2);   // what it linked, and ENG still unset
    expect(n[1]).toMatch(/ENG/);
    expect(n[1]).not.toMatch(/Jira, /);

    // the projects' statuses together leave two prod checks: only done is linked, and Jira is asked for once
    const d = ctx({ boards: {} }, { ABC: JIRA_STATES, XY: { states: ['Production check', 'Done'], done: ['Done'] } });
    const m = await startupNotices(d);
    expect(d.s.jira).toEqual({ done: 'Done' });
    expect(m).toHaveLength(2);
    expect(m[1]).toMatch(/Jira, ENG/);
  });

  it('the vault shows Jira as one board with every project\'s statuses, and never overwrites what is saved', async () => {
    const c = ctx({ jira: { done: 'Done' }, boards: {} });
    const [j, eng] = await boardsSetup(c);
    expect(j).toMatchObject({ source: 'jira', board: 'Jira', done: 'Done', states: JIRA_STATES.states });
    expect(j.test).toBeUndefined();
    expect(j.linked).toBeUndefined();
    expect(eng).toMatchObject({ source: 'linear', board: 'ENG', states: ['Todo', 'QA', 'Done'] });
    const d = ctx({ boards: {} });
    expect((await boardsSetup(d, 'jira'))).toEqual([expect.objectContaining({ test: 'PROD CHECK', done: 'Done', linked: ['test', 'done'] })]);
  });

  it('saves Jira\'s pair once for all projects, and a Linear team\'s on its own', () => {
    const c = ctx({ boards: {} });
    saveBoard(c, 'jira', 'Jira', { test: ' Verify ', done: '' });
    expect(c.s.jira).toEqual({ test: 'Verify' });
    saveBoard(c, 'linear', 'eng', { test: 'QA' });
    expect(c.s.boards).toEqual({ ENG: { test: 'QA' } });
    expect(() => saveBoard(c, 'linear', 'x y', {})).toThrow();
  });

  it('moves to done only with a single matching transition, to the one pair\'s done status', async () => {
    const tr = (id: string, a: string) => ({ id, name: a, a, category: 'done' as const });
    const c = ctx({ jira: { test: 'Prod check', done: 'Discarded' }, boards: {} });
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')], (await taskTracker(c, 'XY-2'))?.done)?.id).toBe('2');
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')], 'done')?.id).toBe('1');
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')])).toBeUndefined();
    expect(doneTransition([tr('1', 'Done')])?.id).toBe('1');
  });
});
