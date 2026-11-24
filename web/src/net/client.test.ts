// The intercom holds a page of each open conversation's log: older pages above it, the latest one again back at the
// bottom, and nothing of a conversation once it closes (reopened, it is read again from disk)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { live, client, loadLog, loadOlder, trimLog, logPageSize } from './client';

const entry = (i: number) => ({ id: `e${i}`, ts: 1000 + i, type: 'asistente' as const, text: `m${i}` });
const disk = Array.from({ length: 250 }, (_, i) => entry(i));
const receive = (m: any) => (client as any).receive(m);

beforeEach(() => {
  live.set({ entries: {}, older: {}, partial: {}, sessions: { s1: { id: 's1' } as any } });
  vi.spyOn(client, 'ask').mockImplementation(async (m: any) => {
    const end = m.before ? disk.findIndex(e => e.id === m.before.id) : disk.length, start = Math.max(0, end - m.limit);
    return { entries: disk.slice(start, end), more: start > 0 } as any;
  });
});

describe('a conversation log held by pages', () => {
  it('opens with its last page and loads older ones up to the first, without repeats', async () => {
    expect(logPageSize()).toBe(100);
    loadLog('s1');
    await vi.waitFor(() => expect(live.get().entries.s1?.length).toBe(100));
    expect([live.get().entries.s1[0].id, live.get().older.s1]).toEqual(['e150', true]);
    expect(await loadOlder('s1')).toBe(true);
    expect(await loadOlder('s1')).toBe(true);
    expect(live.get().entries.s1.map(e => e.id)).toEqual(disk.map(e => e.id));
    expect(live.get().older.s1).toBe(false);
    expect(await loadOlder('s1')).toBe(false);   // the first page: nothing more to ask for
  });

  it('back at the bottom only the last page stays held, and older ones can be loaded again', () => {
    live.set({ entries: { s1: disk }, older: { s1: false } });
    trimLog('s1');
    expect([live.get().entries.s1.length, live.get().entries.s1[0].id, live.get().older.s1]).toEqual([100, 'e150', true]);
  });

  it('a closed conversation leaves the client: entries, older mark and streaming text', () => {
    live.set({ entries: { s1: disk.slice(-5) }, older: { s1: true }, partial: { s1: 'typing' } });
    receive({ t: 'sesionFuera', sessionId: 's1' });
    expect([live.get().entries.s1, live.get().older.s1, live.get().partial.s1]).toEqual([undefined, undefined, undefined]);
  });

  it('live entries beyond what is held cut the oldest and mark them as loadable', () => {
    live.set({ entries: { s1: [] }, older: {} });
    receive({ t: 'entradas', sessionId: 's1', entries: Array.from({ length: 1600 }, (_, i) => entry(i)) });
    expect([live.get().entries.s1.length, live.get().older.s1]).toEqual([1500, true]);
  });
});
