// The queue of a busy conversation in sessions.ts: what is sent while it works waits until Claude Code takes it (its
// command_lifecycle frames), then moves into the log with who sent it; the Overseer can withdraw his own meanwhile
import { describe, expect, it } from 'vitest';
import { Sessions } from './sessions.ts';

function session(state = 'trabajando') {
  const sess = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'sala', cwd: '/tmp', state, unread: false, title: 'Trabajo', pendingCount: 0, helpers: [], tools: 0, turns: 0 };
  const metered: any[] = [], cancelled: string[] = [];
  const x: any = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve() };
  x.input = { meter: (m: any) => metered.push(m), remove: () => false };
  x.q = { cancelAsyncMessage: async (uuid: string) => { cancelled.push(uuid); return true; }, getContextUsage: async () => undefined };
  sess.s.set('w1', x);
  const summaries: any[] = [];
  sess.on('sesion', (s: any) => summaries.push(s));
  const lifecycle = (uuid: string, st: string) => sess.handle(x, { type: 'command_lifecycle', command_uuid: uuid, state: st, uuid: crypto.randomUUID(), session_id: 'c1' });
  const users = () => x.entries.filter((e: any) => e.type === 'usuario');
  return { sess, x, r, metered, cancelled, summaries, lifecycle, users };
}
const ROOM = { kind: 'room', roomId: 'puente', room: 'Command Bridge', dweller: 'Néstor' } as const;

describe('the queue of a busy conversation', () => {
  it('a message to a working conversation waits in its queue, with who sent it, and moves into the log when taken', async () => {
    const s = session();
    s.sess.send('w1', 'From the bridge', [], ROOM);
    await s.x.shipments;
    expect(s.users()).toEqual([]);
    expect(s.r.queue).toEqual([expect.objectContaining({ text: 'From the bridge', origin: ROOM })]);
    const id = s.r.queue[0].id;
    expect(s.metered.map(m => m.uuid)).toEqual([id]);   // the uuid Claude Code reports it by
    s.lifecycle(id, 'queued');
    expect(s.r.queue).toHaveLength(1);
    s.lifecycle(id, 'started');
    expect(s.r.queue).toBeUndefined();
    expect(s.users()).toEqual([expect.objectContaining({ text: 'From the bridge', origin: ROOM })]);
    s.lifecycle(id, 'completed');
    expect(s.users()).toHaveLength(1);
  });

  it('to an idle conversation it goes straight into the log; the Overseer\'s own carry no origin', async () => {
    const s = session('terminada');
    s.sess.send('w1', 'Next step');
    expect(s.r.queue).toBeUndefined();
    expect(s.users()).toEqual([expect.objectContaining({ text: 'Next step' })]);
    expect(s.users()[0].origin).toBeUndefined();
  });

  it('withdrawn before it reaches the input, it never does; once there, it is cancelled in Claude Code\'s queue', async () => {
    const s = session();
    s.sess.send('w1', 'Never mind');
    const first = s.r.queue[0].id;
    expect(await s.sess.withdraw('w1', first)).toBe(true);
    await s.x.shipments;
    expect(s.metered).toEqual([]);
    expect(s.cancelled).toEqual([]);
    s.sess.send('w1', 'Changed my mind');
    await s.x.shipments;
    const second = s.r.queue[0].id;
    expect(await s.sess.withdraw('w1', second)).toBe(true);
    expect(s.cancelled).toEqual([second]);
    expect(s.r.queue).toBeUndefined();
    expect(s.users()).toEqual([]);
  });

  it("another room's message can't be withdrawn, nor one already taken", async () => {
    const s = session();
    s.sess.send('w1', 'From the bridge', [], ROOM);
    expect(await s.sess.withdraw('w1', s.r.queue[0].id)).toBe(false);
    s.sess.send('w1', 'Mine');
    await s.x.shipments;
    const mine = s.r.queue[1].id;
    s.x.q.cancelAsyncMessage = async () => false;   // Claude Code took it in the meantime
    expect(await s.sess.withdraw('w1', mine)).toBe(false);
    expect(s.r.queue).toHaveLength(2);
  });

  it("without lifecycle frames, the turn's result takes what it consumed", async () => {
    const s = session();
    s.sess.send('w1', 'Folded in');
    const id = s.r.queue[0].id;
    s.sess.handle(s.x, { type: 'result', subtype: 'success', is_error: false, result: 'Done', duration_ms: 1000, user_message_uuids: ['first', id] });
    expect(s.r.queue).toBeUndefined();
    expect(s.users()).toEqual([expect.objectContaining({ text: 'Folded in' })]);
  });

  it('if the conversation ends with messages still queued, the log says they were not delivered', async () => {
    const s = session();
    s.sess.send('w1', 'Lost one');
    const q = { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) };
    s.x.q = q;
    await s.sess.consume(s.x, q);
    expect(s.r.queue).toBeUndefined();
    expect(s.x.entries.at(-1)).toEqual(expect.objectContaining({ type: 'sistema', text: expect.stringContaining('Lost one') }));
  });
});
