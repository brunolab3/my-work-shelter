import { describe, it, expect } from 'vitest';
import { placeOf, ofPlace, soonestByPlace, type ScheduledMessage, type ScheduledTarget } from './scheduled.ts';

const REPO = '/repos/acme';
const WT = `${REPO}/.claude/worktrees/ABC-12`;
const worktrees = [{ ruta: REPO, rama: 'main', principal: true }, { ruta: WT, rama: 'ABC-12-fix', principal: false }, { ruta: `${REPO}/.claude/worktrees/shelter-tidy-up--ab12`, rama: 'x', principal: false }];
let n = 0;
const msg = (destino: ScheduledTarget, cuando = 100): ScheduledMessage => ({ id: 'm' + ++n, creado: 0, cuando, pedido: '', mensaje: 'hi', origen: { salaId: 'acme', claudeId: 'c1' }, destino });

describe('scheduled messages by room and task', () => {
  it('a conversation target goes to the worktree its cwd is in, or to the room\'s main copy', () => {
    expect(placeOf(msg({ tipo: 'conversacion', salaId: 'acme', cwd: WT }), worktrees)).toEqual({ salaId: 'acme', worktree: WT });
    expect(placeOf(msg({ tipo: 'conversacion', salaId: 'acme', cwd: WT + '/web' }), worktrees)).toEqual({ salaId: 'acme', worktree: WT });
    expect(placeOf(msg({ tipo: 'conversacion', salaId: 'acme', cwd: REPO }), worktrees)).toEqual({ salaId: 'acme', worktree: undefined });
    // ABC-1 is not ABC-12, nor is a removed worktree anyone's
    expect(placeOf(msg({ tipo: 'conversacion', salaId: 'acme', cwd: `${REPO}/.claude/worktrees/ABC-1` }), worktrees).worktree).toBeUndefined();
  });
  it('a room target with a key goes to the worktree of that task, if the room has one', () => {
    expect(placeOf(msg({ tipo: 'sala', sala: 'acme', clave: 'ABC-12' }), worktrees)).toEqual({ salaId: 'acme', worktree: WT });
    expect(placeOf(msg({ tipo: 'sala', sala: 'acme', clave: 'tidy-up' }), worktrees).worktree).toBe(`${REPO}/.claude/worktrees/shelter-tidy-up--ab12`);
    expect(placeOf(msg({ tipo: 'sala', sala: 'acme', clave: 'ABC-99' }), worktrees)).toEqual({ salaId: 'acme', worktree: undefined });
    expect(placeOf(msg({ tipo: 'sala', sala: 'acme' }), worktrees)).toEqual({ salaId: 'acme', worktree: undefined });
  });
  it('ofPlace lists a dweller\'s or a hologram\'s own, soonest first', () => {
    const a = msg({ tipo: 'conversacion', salaId: 'acme', cwd: WT }, 300), b = msg({ tipo: 'sala', sala: 'acme', clave: 'ABC-12' }, 200);
    const c = msg({ tipo: 'sala', sala: 'acme' }), d = msg({ tipo: 'sala', sala: 'other' });
    const all = [a, b, c, d];
    expect(ofPlace(all, 'acme', WT, worktrees).map(x => x.id)).toEqual([b.id, a.id]);
    expect(ofPlace(all, 'acme', undefined, worktrees).map(x => x.id)).toEqual([c.id]);
    expect(ofPlace(all, 'other', undefined, []).map(x => x.id)).toEqual([d.id]);
  });
  it('soonestByPlace keeps each room\'s and worktree\'s next one', () => {
    const a = msg({ tipo: 'conversacion', salaId: 'acme', cwd: WT }, 300), b = msg({ tipo: 'sala', sala: 'acme', clave: 'ABC-12' }, 200);
    const c = msg({ tipo: 'sala', sala: 'acme' }, 500), d = msg({ tipo: 'sala', sala: 'other' }, 50);
    const m = soonestByPlace([a, b, c, d], sala => sala === 'acme' ? worktrees : []);
    expect([...m].map(([k, x]) => [k, x.id])).toEqual([[`acme|${WT}`, b.id], ['acme|', c.id], ['other|', d.id]]);
  });
});
