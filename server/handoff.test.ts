// The new-session suggestion: offered once per conversation past the threshold, only when the turn ends; «New session
// with a handoff» asks the dweller for the summary and starts the new session with it, closing (never deleting) the old one
import { describe, expect, it, vi } from 'vitest';
import { Sessions } from './sessions.ts';
import { startFromHandoff } from './handoff.ts';
import { t } from '../shared/language.ts';

function session(used: number, offered = new Set<string>()) {
  const sess = new Sessions({ pathRoom: () => undefined, handoff: { threshold: () => 250_000, offered: id => offered.has(id), mark: id => { offered.add(id); } } }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'room', cwd: '/tmp/wt', claudeId: 'c1', state: 'working', unread: false, title: 'Trabajo', pending: 0, helpers: [], tools: 0, turns: 0, model: 'opus', permissionMode: 'auto' };
  const sent: string[] = [];
  const x = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve(),
    input: { meter: (m: any) => sent.push(m.message.content) },
    q: { getContextUsage: async () => ({ totalTokens: used, maxTokens: 1_000_000, percentage: used / 10_000 }) } };
  sess.s.set('w1', x);
  const m = (msg: any) => sess.handle(x, { session_id: 'c1', uuid: crypto.randomUUID(), ...msg });
  const tick = () => new Promise(res => setTimeout(res, 0));
  return { sess, r, x, sent, offered, tick, result: async (text = '') => { m({ type: 'result', subtype: 'success', is_error: false, result: text, duration_ms: 1000 }); await tick(); } };
}

describe('new-session suggestion', () => {
  it('is offered when the turn ends past the threshold, not below it', async () => {
    const below = session(200_000); await below.result();
    expect(below.r.handoff).toBeUndefined();
    const above = session(260_000); await above.result();
    expect(above.r.handoff).toBe('offered');
  });

  it('never mid-turn: a measure while working offers nothing', async () => {
    const s = session(300_000);
    s.sess.measureContext(s.x); await s.tick();
    expect(s.r.handoff).toBeUndefined();
  });

  it('once per conversation: replying clears it and it does not come back', async () => {
    const s = session(300_000); await s.result();
    expect(s.r.handoff).toBe('offered');
    s.sess.send('w1', 'sigue');
    expect(s.r.handoff).toBeUndefined();
    await s.result();
    expect(s.r.handoff).toBeUndefined();
    // nor after a restart: the mark is kept by Claude Code id
    const again = session(300_000, s.offered); await again.result();
    expect(again.r.handoff).toBeUndefined();
  });

  it('the handoff asks for the summary and hands it on when that turn ends', async () => {
    const s = session(300_000); await s.result();
    const got = vi.fn(); s.sess.on('handoff', got);
    s.sess.handoff('w1'); await s.tick();
    expect(s.sent.at(-1)).toBe(t('prompt.handoff.write'));
    expect(s.r.handoff).toBe('writing');
    await s.result('## Goal\nShip it');
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }), '## Goal\nShip it');
    expect(s.r.handoff).toBeUndefined();
  });

  it('not while a turn is running', () => {
    const s = session(300_000);
    expect(() => s.sess.handoff('w1')).toThrow();
  });
});

describe('startFromHandoff', () => {
  const old: any = { id: 'w1', dwellerId: 'h1', roomId: 'room', cwd: '/tmp/wt', model: 'opus', effort: 'high', permissionMode: 'acceptEdits' };
  it('starts the new session with the summary as its first message and closes, never deletes, the old one', async () => {
    const start = vi.fn(async () => 'w2'), close = vi.fn();
    expect(await startFromHandoff({ start, close }, old, '  ## Goal\nShip it  ')).toBe('w2');
    expect(start).toHaveBeenCalledWith({ dwellerId: 'h1', roomId: 'room', prompt: t('prompt.handoff.start', { resumen: '## Goal\nShip it' }), options: { cwd: '/tmp/wt', model: 'opus', effort: 'high', permissions: 'acceptEdits', worktree: false, handoffFrom: 'w1' } });
    expect(t('prompt.handoff.start', { resumen: 'X' })).toContain('X');
    expect(close).toHaveBeenCalledWith('w1');
  });
  it('keeps the old one open if the new one cannot start', async () => {
    const close = vi.fn();
    await expect(startFromHandoff({ start: async () => { throw new Error('limit'); }, close }, old, 'x')).rejects.toThrow('limit');
    expect(close).not.toHaveBeenCalled();
  });
});
