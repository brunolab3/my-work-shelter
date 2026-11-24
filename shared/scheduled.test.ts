import { describe, it, expect } from 'vitest';
import { placeOf, ofPlace, byPlace, soonestByPlace, nextWindowStart, finalWindowStart, schedulePresets, localInput, windowNext, due, scheduledDirection, WINDOW_GAP_MS, type ScheduledMessage, type ScheduledTarget } from './scheduled.ts';

const REPO = '/repos/acme';
const WT = `${REPO}/.claude/worktrees/ABC-12`;
const worktrees = [{ path: REPO, branch: 'main', main: true }, { path: WT, branch: 'ABC-12-fix', main: false }, { path: `${REPO}/.claude/worktrees/shelter-tidy-up--ab12`, branch: 'x', main: false }];
let n = 0;
const msg = (target: ScheduledTarget, when = 100): ScheduledMessage => ({ id: 'm' + ++n, created: 0, when, requested: '', message: 'hi', origin: { roomId: 'acme', claudeId: 'c1' }, target });

describe('which way a scheduled message goes', () => {
  const here = { id: 's1', claudeId: 'c1' };
  const toHere: ScheduledTarget = { type: 'conversation', roomId: 'acme', sessionId: 's1', claudeId: 'c1', cwd: REPO };
  const from = (origin: ScheduledMessage['origin'], target: ScheduledTarget, extra: Partial<ScheduledMessage> = {}) => ({ ...msg(target), origin, ...extra });
  it('in a conversation: what it sends elsewhere goes out, what comes to it arrives', () => {
    expect(scheduledDirection(msg({ type: 'room', room: 'git', key: 'ABC-12' }), here)).toBe('out');
    expect(scheduledDirection(msg({ type: 'conversation', roomId: 'acme', claudeId: 'c2', cwd: WT }), here)).toBe('out');
    expect(scheduledDirection(from({ roomId: 'git', claudeId: 'c9' }, toHere, { from: { kind: 'room', roomId: 'git', room: 'Version Control' }, afterTurn: true }), here)).toBe('in');
    expect(scheduledDirection(from({ roomId: 'acme' }, toHere, { from: { kind: 'game' } }), here)).toBe('in');
  });
  it('a reminder it wrote to itself is its own; the Overseer\'s draft for later arrives, by either id', () => {
    expect(scheduledDirection(msg(toHere), here)).toBe('self');
    expect(scheduledDirection(msg(toHere), { id: 's1' })).toBe('in');   // origin only has the Claude Code id
    expect(scheduledDirection(msg(toHere), { claudeId: 'c1' })).toBe('self');
    expect(scheduledDirection({ ...msg(toHere), overseer: true, from: { kind: 'overseer' } }, here)).toBe('in');
  });
  it('in a place\'s list (what goes to it): a reminder by the target conversation itself, else it arrives', () => {
    expect(scheduledDirection(msg(toHere))).toBe('self');
    expect(scheduledDirection(from({ roomId: 'git', claudeId: 'c9' }, toHere))).toBe('in');
    expect(scheduledDirection(msg({ type: 'room', room: 'acme', key: 'ABC-12' }))).toBe('in');
  });
});

describe('scheduled messages by room and task', () => {
  it('a conversation target goes to the worktree its cwd is in, or to the room\'s main copy', () => {
    expect(placeOf(msg({ type: 'conversation', roomId: 'acme', cwd: WT }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'conversation', roomId: 'acme', cwd: WT + '/web' }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'conversation', roomId: 'acme', cwd: REPO }), worktrees)).toEqual({ roomId: 'acme', worktree: undefined });
    // ABC-1 is not ABC-12, nor is a removed worktree anyone's
    expect(placeOf(msg({ type: 'conversation', roomId: 'acme', cwd: `${REPO}/.claude/worktrees/ABC-1` }), worktrees).worktree).toBeUndefined();
  });
  it('a room target with a key goes to the worktree of that task, if the room has one', () => {
    expect(placeOf(msg({ type: 'room', room: 'acme', key: 'ABC-12' }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'room', room: 'acme', key: 'tidy-up' }), worktrees).worktree).toBe(`${REPO}/.claude/worktrees/shelter-tidy-up--ab12`);
    expect(placeOf(msg({ type: 'room', room: 'acme', key: 'ABC-99' }), worktrees)).toEqual({ roomId: 'acme', task: 'ABC-99' });   // its hologram is still to come
    expect(placeOf(msg({ type: 'room', room: 'acme' }), worktrees)).toEqual({ roomId: 'acme', worktree: undefined });
  });
  it('ofPlace lists a dweller\'s or a hologram\'s own, soonest first', () => {
    const a = msg({ type: 'conversation', roomId: 'acme', cwd: WT }, 300), b = msg({ type: 'room', room: 'acme', key: 'ABC-12' }, 200);
    const c = msg({ type: 'room', room: 'acme' }), d = msg({ type: 'room', room: 'other' });
    const all = [a, b, c, d];
    expect(ofPlace(all, 'acme', WT, worktrees).map(x => x.id)).toEqual([b.id, a.id]);
    expect(ofPlace(all, 'acme', undefined, worktrees).map(x => x.id)).toEqual([c.id]);
    expect(ofPlace(all, 'other', undefined, []).map(x => x.id)).toEqual([d.id]);
  });
  it('byPlace splits a room\'s list by hologram: the main copy first, with those of a removed worktree', () => {
    const TIDY = `${REPO}/.claude/worktrees/shelter-tidy-up--ab12`;
    const tidy = msg({ type: 'room', room: 'acme', key: 'tidy-up' }), abc = msg({ type: 'conversation', roomId: 'acme', cwd: WT });
    const gone = msg({ type: 'conversation', roomId: 'acme', cwd: `${REPO}/.claude/worktrees/ABC-7` }, 50), main = msg({ type: 'room', room: 'acme' }, 200);
    const other = msg({ type: 'room', room: 'other' });
    expect(byPlace([tidy, main, other, abc, gone], 'acme', worktrees).map(g => [g.worktree, g.items.map(x => x.id)]))
      .toEqual([[undefined, [gone.id, main.id]], [WT, [abc.id]], [TIDY, [tidy.id]]]);
    expect(byPlace([other], 'acme', worktrees)).toEqual([]);
  });
  it('a room target whose task has no worktree yet gets its own section after the worktrees, and moves once it appears', () => {
    const main = msg({ type: 'room', room: 'acme' }), abc = msg({ type: 'conversation', roomId: 'acme', cwd: WT });
    const later = msg({ type: 'room', room: 'acme', key: 'ABC-99' }, 400), soon = msg({ type: 'room', room: 'acme', key: 'XYZ-1' }, 300);
    const again = { ...msg({ type: 'room', room: 'acme', key: 'ABC-99' }, 500), origin: { roomId: 'git', claudeId: 'c7' }, from: { kind: 'room' as const, roomId: 'git', room: 'Version Control' } };
    const all = [later, main, again, abc, soon];
    expect(byPlace(all, 'acme', worktrees).map(g => [g.worktree ?? g.task, g.items.map(x => x.id)]))
      .toEqual([[undefined, [main.id]], [WT, [abc.id]], ['XYZ-1', [soon.id]], ['ABC-99', [later.id, again.id]]]);
    expect(ofPlace(all, 'acme', undefined, worktrees).map(x => x.id)).toEqual([main.id]);   // not in the main copy's
    expect(ofPlace(all, 'acme', undefined, worktrees, 'ABC-99').map(x => x.id)).toEqual([later.id, again.id]);
    expect(scheduledDirection(again)).toBe('in');
    const ABC99 = `${REPO}/.claude/worktrees/ABC-99`, created = [...worktrees, { path: ABC99, branch: 'ABC-99-x', main: false }];
    expect(byPlace(all, 'acme', created).map(g => g.worktree ?? g.task)).toEqual([undefined, WT, ABC99, 'XYZ-1']);
  });
  it('soonestByPlace keeps each room\'s and worktree\'s next one', () => {
    const a = msg({ type: 'conversation', roomId: 'acme', cwd: WT }, 300), b = msg({ type: 'room', room: 'acme', key: 'ABC-12' }, 200);
    const c = msg({ type: 'room', room: 'acme' }, 500), d = msg({ type: 'room', room: 'other' }, 50);
    const m = soonestByPlace([a, b, c, d], room => room === 'acme' ? worktrees : []);
    expect([...m].map(([k, x]) => [k, x.id])).toEqual([[`acme|${WT}`, b.id], ['acme|', c.id], ['other|', d.id]]);
  });
});

const bg = (id: string, created: number, when: number): ScheduledMessage => ({ ...msg({ type: 'room', room: 'acme' }, when), id, created, nextWindow: true });

const L = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();   // local time, November 2026

describe('the day\'s final 5-hour window', () => {
  it('the latest start still today on the running window\'s 5-hour grid, never before the next free one', () => {
    expect(finalWindowStart(L(20, 7), { endsAt: L(20, 9) })).toBe(L(20, 19));    // 9, 14, 19
    expect(finalWindowStart(L(20, 7), { endsAt: L(20, 8) })).toBe(L(20, 23));    // 8, 13, 18, 23
    expect(finalWindowStart(L(20, 22), { endsAt: L(20, 23) })).toBe(L(20, 23));
    expect(finalWindowStart(L(20, 23), { endsAt: L(21, 2) })).toBe(L(21, 2));    // the next one is already tomorrow
  });
  it('with no window known, the one ending at midnight (19:00); past that, now; after a limit, when it lifts', () => {
    expect(finalWindowStart(L(20, 7), {})).toBe(L(20, 19));
    expect(finalWindowStart(L(20, 7), { endsAt: L(20, 6) })).toBe(L(20, 19));    // a stale window
    expect(finalWindowStart(L(20, 21), {})).toBe(L(20, 21));
    expect(finalWindowStart(L(20, 20), { blockedUntil: L(20, 22) })).toBe(L(20, 22));
  });
});

describe('the ⏰ Schedule presets', () => {
  const keys = (now: number) => schedulePresets(now).map(x => [x.key, localInput(x.when)]);
  it('in 1 h, in 3 h, the next working day and next Monday at 09:00', () => {
    expect(keys(L(18, 10, 30))).toEqual([['in1h', '2026-11-18T11:30'], ['in3h', '2026-11-18T13:30'], ['tomorrow', '2026-11-19T09:00'], ['monday', '2026-11-23T09:00']]);
    expect(keys(L(16, 8))).toContainEqual(['monday', '2026-11-23T09:00']);   // on a Monday, the next one
  });
  it('on Friday and at the weekend, "tomorrow" is Monday: shown once', () => {
    for (const d of [20, 21, 22]) expect(keys(L(d, 12)).slice(2)).toEqual([['tomorrow', '2026-11-23T09:00']]);
  });
});

describe('next-window delivery', () => {
  it('starts when the running window ends, after any limit; now if none is known', () => {
    expect(nextWindowStart(100, {})).toBe(100);
    expect(nextWindowStart(100, { endsAt: 500 })).toBe(500);
    expect(nextWindowStart(100, { endsAt: 50 })).toBe(100);
    expect(nextWindowStart(100, { endsAt: 500, blockedUntil: 900 })).toBe(900);
  });
  it('one at a time, oldest first (failed ones last), five minutes apart, none while blocked', () => {
    const list = [bg('b', 2, 0), bg('a', 1, 0), bg('later', 0, 10 * 60_000)];
    expect(windowNext(list, 1000, {}, undefined)?.id).toBe('a');
    expect(windowNext(list, 1000, {}, undefined, new Set(['a']))?.id).toBe('b');
    expect(windowNext(list, WINDOW_GAP_MS - 1, {}, 0)).toBeUndefined();
    expect(windowNext(list, WINDOW_GAP_MS, {}, 0)?.id).toBe('a');
    expect(windowNext(list, 1000, { blockedUntil: 2000 }, undefined)).toBeUndefined();
    expect(windowNext([list[2]], 1000, {}, undefined)).toBeUndefined();   // not due yet
  });
  it('dated delivery skips them', () => {
    expect(due([bg('a', 1, 0), { ...msg({ type: 'room', room: 'acme' }, 0), id: 'dated' }], 1000).map(x => x.id)).toEqual(['dated']);
  });
});
