import { describe, it, expect } from 'vitest';
import { placeOf, ofPlace, soonestByPlace, type ScheduledMessage, type ScheduledTarget } from './scheduled.ts';

const REPO = '/repos/acme';
const WT = `${REPO}/.claude/worktrees/ABC-12`;
const worktrees = [{ path: REPO, branch: 'main', main: true }, { path: WT, branch: 'ABC-12-fix', main: false }, { path: `${REPO}/.claude/worktrees/shelter-tidy-up--ab12`, branch: 'x', main: false }];
let n = 0;
const msg = (target: ScheduledTarget, when = 100): ScheduledMessage => ({ id: 'm' + ++n, created: 0, when, requested: '', message: 'hi', origin: { roomId: 'acme', claudeId: 'c1' }, target });

describe('scheduled messages by room and task', () => {
  it('a conversation target goes to the worktree its cwd is in, or to the room\'s main copy', () => {
    expect(placeOf(msg({ type: 'conversacion', roomId: 'acme', cwd: WT }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'conversacion', roomId: 'acme', cwd: WT + '/web' }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'conversacion', roomId: 'acme', cwd: REPO }), worktrees)).toEqual({ roomId: 'acme', worktree: undefined });
    // ABC-1 is not ABC-12, nor is a removed worktree anyone's
    expect(placeOf(msg({ type: 'conversacion', roomId: 'acme', cwd: `${REPO}/.claude/worktrees/ABC-1` }), worktrees).worktree).toBeUndefined();
  });
  it('a room target with a key goes to the worktree of that task, if the room has one', () => {
    expect(placeOf(msg({ type: 'sala', room: 'acme', key: 'ABC-12' }), worktrees)).toEqual({ roomId: 'acme', worktree: WT });
    expect(placeOf(msg({ type: 'sala', room: 'acme', key: 'tidy-up' }), worktrees).worktree).toBe(`${REPO}/.claude/worktrees/shelter-tidy-up--ab12`);
    expect(placeOf(msg({ type: 'sala', room: 'acme', key: 'ABC-99' }), worktrees)).toEqual({ roomId: 'acme', worktree: undefined });
    expect(placeOf(msg({ type: 'sala', room: 'acme' }), worktrees)).toEqual({ roomId: 'acme', worktree: undefined });
  });
  it('ofPlace lists a dweller\'s or a hologram\'s own, soonest first', () => {
    const a = msg({ type: 'conversacion', roomId: 'acme', cwd: WT }, 300), b = msg({ type: 'sala', room: 'acme', key: 'ABC-12' }, 200);
    const c = msg({ type: 'sala', room: 'acme' }), d = msg({ type: 'sala', room: 'other' });
    const all = [a, b, c, d];
    expect(ofPlace(all, 'acme', WT, worktrees).map(x => x.id)).toEqual([b.id, a.id]);
    expect(ofPlace(all, 'acme', undefined, worktrees).map(x => x.id)).toEqual([c.id]);
    expect(ofPlace(all, 'other', undefined, []).map(x => x.id)).toEqual([d.id]);
  });
  it('soonestByPlace keeps each room\'s and worktree\'s next one', () => {
    const a = msg({ type: 'conversacion', roomId: 'acme', cwd: WT }, 300), b = msg({ type: 'sala', room: 'acme', key: 'ABC-12' }, 200);
    const c = msg({ type: 'sala', room: 'acme' }, 500), d = msg({ type: 'sala', room: 'other' }, 50);
    const m = soonestByPlace([a, b, c, d], room => room === 'acme' ? worktrees : []);
    expect([...m].map(([k, x]) => [k, x.id])).toEqual([[`acme|${WT}`, b.id], ['acme|', c.id], ['other|', d.id]]);
  });
});
