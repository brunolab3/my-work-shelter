import { describe, it, expect } from 'vitest';
import { applyLifecycle, takeConsumed, withdrawable, originLabel, queuedIn } from './messageQueue.ts';
import type { QueuedMessage, SessionSummary } from './protocol.ts';

const msg = (id: string, origin: QueuedMessage['origin'] = { kind: 'overseer' }): QueuedMessage => ({ id, ts: 0, text: `texto ${id}`, origin });
const queue = [msg('a'), msg('b', { kind: 'room', roomId: 'bridge', room: 'Command Bridge', dweller: 'Néstor' }), msg('c', { kind: 'scheduled' })];

describe('the queue of a busy conversation', () => {
  it('a message leaves the queue for the log when Claude Code starts it, in its own place', () => {
    const r = applyLifecycle(queue, 'b', 'started');
    expect(r.taken?.id).toBe('b');
    expect(r.queue.map(m => m.id)).toEqual(['a', 'c']);
    expect(r.dropped).toBeUndefined();
  });
  it('a completed that comes before its started still takes it; a cancelled drops it without logging it', () => {
    expect(applyLifecycle(queue, 'a', 'completed').taken?.id).toBe('a');
    const r = applyLifecycle(queue, 'c', 'cancelled');
    expect(r.taken).toBeUndefined();
    expect(r.dropped?.id).toBe('c');
    expect(r.queue.map(m => m.id)).toEqual(['a', 'b']);
  });
  it('queued frames, unknown states and uuids not in the queue change nothing (the same array back)', () => {
    expect(applyLifecycle(queue, 'a', 'queued').queue).toBe(queue);
    expect(applyLifecycle(queue, 'a', 'whatever').queue).toBe(queue);
    expect(applyLifecycle(queue, 'z', 'started').queue).toBe(queue);
  });
  it("without lifecycle frames, a result's consumed uuids take theirs, in queue order", () => {
    const r = takeConsumed(queue, ['first-prompt', 'c', 'a']);
    expect(r.taken.map(m => m.id)).toEqual(['a', 'c']);
    expect(r.queue.map(m => m.id)).toEqual(['b']);
    expect(takeConsumed(queue, undefined).taken).toEqual([]);
  });
  it("only the Overseer's own messages can be withdrawn or edited", () => {
    expect(queue.map(withdrawable)).toEqual([true, false, false]);
  });
  it('says who sent each one', () => {
    expect(queue.map(m => originLabel(m.origin))).toEqual(['TÚ', 'Command Bridge (Néstor)', 'PROGRAMADO']);
    expect(originLabel({ kind: 'room', roomId: 'git', room: 'Control de Versiones' })).toBe('Control de Versiones');
    expect(originLabel(undefined)).toBe('TÚ');
  });
  it("counts what waits in open conversations, never a closed one's", () => {
    const s = (queue: QueuedMessage[] | undefined, state: SessionSummary['state'] = 'working') => ({ state, queue }) as SessionSummary;
    expect(queuedIn([s([msg('a'), msg('b')]), s(undefined), undefined, s([msg('c')], 'closed')])).toBe(2);
  });
});
