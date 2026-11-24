import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageSpendReader } from './usageSpend.ts';

const NOW = Date.parse('2026-11-24T15:20:00Z'), H = 3_600_000, D = 86_400_000;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function root() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-spend-'));
  dirs.push(d);
  return d;
}
// an assistant line as Claude Code writes it (one per content block, the usage repeated)
const line = (id: string, at: number, usage = { input_tokens: 2, output_tokens: 8, cache_creation_input_tokens: 90, cache_read_input_tokens: 1000 }) =>
  JSON.stringify({ parentUuid: null, type: 'assistant', uuid: id + '-u', requestId: 'req_' + id, timestamp: new Date(at).toISOString(), message: { id, role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'hi' }] } }) + '\n';
const user = (text: string) => JSON.stringify({ type: 'user', timestamp: new Date(NOW).toISOString(), message: { role: 'user', content: text } }) + '\n';
const total = (b: { fresh: number; cacheRead: number }[]) => b.reduce((a, x) => ({ fresh: a.fresh + x.fresh, cacheRead: a.cacheRead + x.cacheRead }), { fresh: 0, cacheRead: 0 });

describe('usage spend from the transcripts', () => {
  it('counts each assistant message once, across sessions and subagents, cache reads apart', async () => {
    const r = root(), p = path.join(r, '-Users-x-repo');
    fs.mkdirSync(path.join(p, 's1', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(p, 's1.jsonl'), line('m1', NOW - H) + line('m1', NOW - H) + user('"type":"assistant" "usage" in a message') + line('m2', NOW - 2 * D));
    fs.writeFileSync(path.join(p, 's1', 'subagents', 'agent-a.jsonl'), line('m3', NOW - 10 * 60_000));
    // a resumed session repeats m1; a message older than the week doesn't count; a broken line is skipped
    fs.writeFileSync(path.join(p, 's2.jsonl'), line('m1', NOW - H) + line('old', NOW - 9 * D) + '{"type":"assistant","usage" broken\n');
    const s = await new UsageSpendReader(r, () => NOW).buckets();
    expect(total(s.hours)).toEqual({ fresh: 200, cacheRead: 2000 });
    expect(total(s.days)).toEqual({ fresh: 300, cacheRead: 3000 });
  });

  it('re-reads only what changed: an appended file from where it stopped, a half-written line next time', async () => {
    const r = root(), p = path.join(r, 'proj'), f = path.join(p, 's.jsonl');
    fs.mkdirSync(p);
    let now = NOW;
    const reader = new UsageSpendReader(r, () => now, 0);
    fs.writeFileSync(f, line('m1', NOW - H));
    expect(total((await reader.buckets()).hours).fresh).toBe(100);
    // the file changes between two reads: a whole line and half of the next one
    const next = line('m3', NOW);
    fs.appendFileSync(f, line('m2', NOW - 30 * 60_000) + next.slice(0, 40));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 2000));
    now += 1000;
    expect(total((await reader.buckets()).hours).fresh).toBe(200);
    fs.appendFileSync(f, next.slice(40));
    fs.utimesSync(f, new Date(), new Date(Date.now() + 4000));
    now += 1000;
    expect(total((await reader.buckets()).hours).fresh).toBe(300);
    // rewritten shorter: read again from the start
    fs.writeFileSync(f, line('m9', NOW));
    now += 1000;
    expect(total((await reader.buckets()).hours).fresh).toBe(100);
    // removed: gone from the count
    fs.rmSync(f);
    now += 1000;
    expect(total((await reader.buckets()).hours).fresh).toBe(0);
  });

  it('keeps the buckets for a short while and never runs two reads at once', async () => {
    const r = root(), p = path.join(r, 'proj'), f = path.join(p, 's.jsonl');
    fs.mkdirSync(p);
    fs.writeFileSync(f, line('m1', NOW - H));
    let now = NOW;
    const reader = new UsageSpendReader(r, () => now, 60_000);
    const [a, b] = await Promise.all([reader.buckets(), reader.buckets()]);
    expect(a).toBe(b);
    fs.appendFileSync(f, line('m2', NOW));
    now += 30_000;
    expect(await reader.buckets()).toBe(a);
    now += 31_000;
    expect(total((await reader.buckets()).hours).fresh).toBe(200);
  });

  it('no transcripts folder: empty buckets', async () => {
    const s = await new UsageSpendReader(path.join(root(), 'missing'), () => NOW).buckets();
    expect(s.hours.every(x => x.fresh === 0 && x.cacheRead === 0)).toBe(true);
    expect(s.days).toHaveLength(8);
  });
});
