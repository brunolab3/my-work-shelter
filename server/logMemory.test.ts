// The app's memory: a conversation's log is served by pages (memory first, then its transcript on disk), so a closed
// conversation opens again with its whole history; a failed tool's output goes to disk and the log keeps one line of it
import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Sessions } from './sessions.ts';
import { ToolOutputs, outputSummary, FIRST_LINE_MAX } from './toolOutputs.ts';
import { prependOlder } from '../shared/logPages.ts';

const entry = (i: number) => ({ id: `m${i}-0`, ts: 1000 + i, type: 'asistente' as const, text: `message ${i}` });

function session(outputs?: ToolOutputs) {
  const sess = new Sessions({ pathRoom: () => undefined }, undefined, outputs) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'sala', cwd: '/tmp', state: 'trabajando', unread: false, title: 'Trabajo', pending: 0, helpers: [], tools: 0, turns: 0, claudeId: 'c1' };
  const x: any = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve() };
  sess.s.set('w1', x);
  return { sess, x, r };
}

describe('a conversation log by pages', { timeout: 20_000 }, () => {
  it('a resumed conversation pages from memory into its transcript, down to its first message', async () => {
    const { sess, x } = session();
    const disk = Array.from({ length: 1000 }, (_, i) => entry(i));
    sess.transcript = async () => disk;
    // resumed: memory holds the last 800 of the transcript, the rest stays on disk
    x.entries = disk.slice(-800); x.olderOnDisk = true;
    let p = await sess.page('w1', 100);
    expect([p.entries[0].id, p.entries.at(-1).id, p.more]).toEqual(['m900-0', 'm999-0', true]);
    let held = p.entries;
    while (p.more) { p = await sess.page('w1', 100, held[0]); held = prependOlder(held, p.entries); }
    expect(held.map((e: any) => e.id)).toEqual(disk.map(e => e.id));
  });

  it('a page crossing the start of memory takes the rest from disk, in order', async () => {
    const { sess, x } = session();
    const disk = Array.from({ length: 300 }, (_, i) => entry(i));
    sess.transcript = async () => disk;
    x.entries = disk.slice(-150); x.olderOnDisk = true;
    const p = await sess.page('w1', 100, x.entries[50]);
    expect(p.entries.map((e: any) => e.id)).toEqual(disk.slice(100, 200).map(e => e.id));
  });

  it('a conversation all in memory never reads its transcript', async () => {
    const { sess, x } = session();
    sess.transcript = async () => { throw new Error('read'); };
    x.entries = Array.from({ length: 30 }, (_, i) => entry(i));
    expect(await sess.page('w1', 100)).toEqual({ entries: x.entries, more: false });
  });
});

describe('failed tool outputs on disk', { timeout: 20_000 }, () => {
  it('the log keeps the size and first line; the whole text is read back, and goes with its session', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'salidas-'));
    const outputs = new ToolOutputs(dir);
    const { sess, x } = session(outputs);
    const long = '\nError: boom\n' + 'line\n'.repeat(5000);
    x.tools.set('t1', { name: 'Bash' });
    sess.handle(x, { type: 'user', session_id: 'c1', uuid: 'u1', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: long }] } });
    const e = x.entries.at(-1);
    expect([e.tool, e.detail, e.output]).toEqual(['Bash', undefined, { size: Buffer.byteLength(long), first: 'Error: boom' }]);
    expect(outputs.read('w1', e.id)).toBe(long);
    outputs.drop('w1');
    expect(outputs.read('w1', e.id)).toBeNull();
    outputs.save('w2', 'e1', 'x'); outputs.clear();
    expect(existsSync(dir)).toBe(false);
  });

  it('no path outside its folder, and a long first line shortened', () => {
    const outputs = new ToolOutputs(mkdtempSync(path.join(os.tmpdir(), 'salidas-')));
    expect(() => outputs.save('../x', 'e', 'a')).toThrow();
    expect(outputs.read('w1', '../../etc/passwd')).toBeNull();
    expect(outputSummary('a'.repeat(500)).first.length).toBe(FIRST_LINE_MAX);
  });
});
