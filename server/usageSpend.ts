// Tokens spent, read from the session transcripts Claude Code writes (~/.claude/projects/<folder>/<session>.jsonl and
// their subagents' <session>/subagents/*.jsonl), the dwellers' and every other session of the Overseer's. Read only.
// Each assistant line carries `message.usage` and a top-level ISO `timestamp`; one API response spans several lines
// (one per content block) with the same `message.id` and usage, so it counts once. Files are appended to: a file that
// grew is read from where the last read stopped, one that shrank or was rewritten from the start, an untouched one
// not at all; files untouched for over a week are skipped. The buckets are kept for a short while (shared/usageSpend.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DAYS_SPAN, spendSummary, usageTokens, type SpendBuckets, type UsageRecord } from '../shared/usageSpend.ts';

const KEEP = DAYS_SPAN + 86400_000;   // a day more than the week: the first daily bucket starts before now - 7 d
const TTL = 60_000;

interface FileRead { size: number; mtimeMs: number; offset: number; records: Map<string, UsageRecord> }

export class UsageSpendReader {
  private files = new Map<string, FileRead>();
  private cached: SpendBuckets | null = null;
  private running: Promise<SpendBuckets> | null = null;
  constructor(private root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'), private now: () => number = Date.now, private ttl = TTL) {}

  // the buckets, read again only once the last ones are older than the TTL; reads never overlap
  buckets(): Promise<SpendBuckets> {
    if (this.cached && this.now() - this.cached.at < this.ttl) return Promise.resolve(this.cached);
    return this.running ??= this.read().then(b => { this.cached = b; return b; }).finally(() => { this.running = null; });
  }

  private async read(): Promise<SpendBuckets> {
    const now = this.now(), since = now - KEEP;
    const seen = new Set<string>();
    for (const f of await this.transcripts()) {
      const st = await fs.promises.stat(f).catch(() => null);
      if (!st || st.mtimeMs < since) continue;
      seen.add(f);
      await this.update(f, st.size, st.mtimeMs, since).catch(() => {});
    }
    for (const f of this.files.keys()) if (!seen.has(f)) this.files.delete(f);
    // the same message in two files (a resumed or forked session) counts once
    const all = new Map<string, UsageRecord>();
    for (const r of this.files.values()) for (const [id, x] of r.records) if (x.at >= since) all.set(id, x); else r.records.delete(id);
    return spendSummary([...all.values()], now);
  }

  private async transcripts(): Promise<string[]> {
    const out: string[] = [];
    const ls = (d: string) => fs.promises.readdir(d, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    for (const project of await ls(this.root)) {
      if (!project.isDirectory()) continue;
      const dir = path.join(this.root, project.name);
      for (const e of await ls(dir)) {
        if (e.isFile() && e.name.endsWith('.jsonl')) out.push(path.join(dir, e.name));
        else if (e.isDirectory()) for (const s of await ls(path.join(dir, e.name, 'subagents'))) if (s.isFile() && s.name.endsWith('.jsonl')) out.push(path.join(dir, e.name, 'subagents', s.name));
      }
    }
    return out;
  }

  private async update(file: string, size: number, mtimeMs: number, since: number) {
    let r = this.files.get(file);
    if (r && r.size === size && r.mtimeMs === mtimeMs) return;
    if (!r || size < r.offset) this.files.set(file, r = { size: 0, mtimeMs: 0, offset: 0, records: new Map() });
    // only whole lines: a line still being written is read next time
    let pending = '', offset = r.offset;
    const stream = fs.createReadStream(file, { start: r.offset, encoding: 'utf8', highWaterMark: 256 * 1024 });
    for await (const chunk of stream) {
      const text = pending + chunk;
      const last = text.lastIndexOf('\n');
      if (last < 0) { pending = text; continue; }
      for (const line of text.slice(0, last).split('\n')) this.line(line, r.records, since);
      offset += Buffer.byteLength(text.slice(0, last + 1));
      pending = text.slice(last + 1);
    }
    r.offset = offset; r.size = size; r.mtimeMs = mtimeMs;
  }

  private line(line: string, records: Map<string, UsageRecord>, since: number) {
    // inside a JSON string the quotes are escaped: only a line's own type matches
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) return;
    let d: any;
    try { d = JSON.parse(line); } catch { return; }
    if (d?.type !== 'assistant' || !d.message?.usage) return;
    const at = Date.parse(d.timestamp);
    if (!(at >= since)) return;
    const id = d.message.id ?? d.requestId ?? d.uuid;
    if (!id) return;
    records.set(String(id), { at, ...usageTokens(d.message.usage) });
  }
}

export const usageSpend = new UsageSpendReader();
