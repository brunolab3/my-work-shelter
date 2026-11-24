// Conversations stopped by the Claude usage limit resume on their own once it renews: a few minutes past `resetsAt`,
// one at a time a few minutes apart (most recently stopped first) so they don't burn the fresh window at once, and the
// whole queue waits again if a new `rejected` arrives. Saved in DATOS/reanudar-limite.json and resumed by Claude Code
// id in its folder, so it survives "Restart the game". Conversations already stopped by a limit before this existed
// (or whose queue was lost) are picked up from their transcript: its last message is the limit error.
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { t } from '../shared/language.ts';
import { projectFolder } from './repos.ts';

export const MARGIN_MS = 2 * 60_000, STAGGER_MS = 4 * 60_000, UNKNOWN_RESET_MS = 60 * 60_000;
// transcripts older than this are not picked up again: an old limit stop is a conversation left behind
export const SCAN_WINDOW_MS = 3 * 24 * 3600_000;

export interface LimitResume {
  claudeId: string; cwd: string; roomId?: string; dwellerId?: string; title?: string;
  permissions?: string; model?: string; effort?: string;
  stoppedAt: number; resetsAt: number; resumeAt: number;
}

/** `resetsAt` comes in seconds from the API (and in ms from some callers): always ms */
export const resetMs = (v: unknown): number | undefined => typeof v === 'number' && v > 0 ? (v < 1e12 ? v * 1000 : v) : undefined;

/** A `rate_limit_event` that stops work: rejected and not running on extra usage */
export const stopsWork = (i: any) => i?.status === 'rejected' && !i.isUsingOverage;

/** Resume times: from the latest reset (plus a margin, never in the past), most recently stopped first, staggered */
export function plan(items: LimitResume[], now: number, resetsAt?: number): LimitResume[] {
  const reset = Math.max(resetsAt ?? 0, ...items.map(x => x.resetsAt));
  const base = Math.max(now, reset + MARGIN_MS);
  return [...items].sort((a, b) => b.stoppedAt - a.stoppedAt).map((x, i) => ({ ...x, resetsAt: Math.max(x.resetsAt, resetsAt ?? 0), resumeAt: base + i * STAGGER_MS }));
}

/** The next one due, if any */
export const due = (items: LimitResume[], now: number) => [...items].sort((a, b) => a.resumeAt - b.resumeAt).find(x => x.resumeAt <= now);

/** The transcript's last message, if it is a usage limit stop: when, until when, and its permission mode */
export function limitStopIn(lines: string[]): { at: number; resetsAt?: number; permissions?: string } | undefined {
  let permissions: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    let d: any; try { d = JSON.parse(lines[i]); } catch { continue; }
    if ((d.type !== 'user' && d.type !== 'assistant') || d.isSidechain || d.isMeta) continue;
    if (d.type === 'assistant' && (d.apiError === 'usage_limit_reached' || d.apiError === 'rate_limit' || d.apiErrorParams?.rate_limit_info?.status === 'rejected')) {
      for (let k = i - 1; k >= 0 && !permissions; k--) { const m = lines[k].match(/"permissionMode":"([a-zA-Z]+)"/); if (m) permissions = m[1]; }
      return { at: Date.parse(d.timestamp) || 0, resetsAt: resetMs(d.apiErrorParams?.rate_limit_info?.resetsAt), permissions };
    }
    return undefined;
  }
  return undefined;
}

function tail(file: string, bytes = 256 << 10): string[] {
  const size = statSync(file).size, n = Math.min(bytes, size), buf = Buffer.alloc(n);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
  const lines = buf.toString('utf8').split('\n');
  return n < size ? lines.slice(1) : lines;
}

/** Recent conversations in these folders whose last message is a usage limit stop */
export function scanStopped(folders: string[], now = Date.now()): { claudeId: string; cwd: string; at: number; resetsAt?: number; permissions?: string }[] {
  const out: { claudeId: string; cwd: string; at: number; resetsAt?: number; permissions?: string }[] = [];
  for (const cwd of new Set(folders)) {
    const dir = projectFolder(cwd);
    let files: string[]; try { files = readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      try {
        const file = path.join(dir, f);
        if (now - statSync(file).mtimeMs > SCAN_WINDOW_MS) continue;
        const s = limitStopIn(tail(file));
        if (s && now - s.at < SCAN_WINDOW_MS) out.push({ claudeId: f.slice(0, -6), cwd, ...s });
      } catch {}
    }
  }
  return out;
}

export interface CtxLimitResume {
  // resume it (the open conversation, or by Claude Code id in its folder); 'gone' if there is nothing left to resume.
  // Throws if it can't now (the sessions limit, open outside): retried on the next round
  resume(x: LimitResume, text: string): Promise<'ok' | 'gone'>;
  changed(list: LimitResume[]): void;
  notice(text: string): void;
  now?(): number;
}

export class LimitResumes {
  private items: LimitResume[] = [];
  private file: string;
  private failed = new Set<string>();
  private sweeping = false;
  constructor(dir: string, private ctx: CtxLimitResume) {
    this.file = path.join(dir, 'reanudar-limite.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); if (Array.isArray(j?.items)) this.items = j.items.filter(valid); } } catch {}
  }
  private now() { return this.ctx.now?.() ?? Date.now(); }
  private save() {
    const tmp = this.file + '.tmp';
    try { writeFileSync(tmp, JSON.stringify({ items: this.items }), { mode: 0o600 }); renameSync(tmp, this.file); } catch (e) { console.error('Reanudar tras el límite:', (e as Error).message); }
    this.ctx.changed(this.list());
  }
  list() { return [...this.items].sort((a, b) => a.resumeAt - b.resumeAt); }
  has(claudeId: string) { return this.items.some(x => x.claudeId === claudeId); }

  /** A conversation stopped by the limit: queued (replacing an older entry for it) and the queue replanned */
  add(x: Omit<LimitResume, 'resumeAt'>) {
    this.items = plan([...this.items.filter(y => y.claudeId !== x.claudeId), { ...x, resumeAt: 0 }], this.now(), x.resetsAt);
    this.save();
  }
  /** A new `rejected`: nothing resumes before this reset */
  hold(resetsAt: number) {
    if (!this.items.length || this.items.every(x => x.resumeAt >= resetsAt + MARGIN_MS)) return;
    this.items = plan(this.items, this.now(), resetsAt); this.save();
  }
  /** The Overseer continued it (or closed it for good): out of the queue */
  drop(claudeId: string) {
    if (!this.has(claudeId)) return;
    this.items = this.items.filter(x => x.claudeId !== claudeId); this.failed.delete(claudeId); this.save();
  }

  /** Every half minute: resume the next one due, one per round */
  async sweep() {
    if (this.sweeping) return;
    const x = due(this.items, this.now());
    if (!x) return;
    this.sweeping = true;
    try {
      const r = await this.ctx.resume(x, t('prompt.limitResume'));
      this.items = this.items.filter(y => y !== x); this.failed.delete(x.claudeId); this.save();
      if (r === 'ok') this.ctx.notice(t('server.limitResumed', { title: x.title || x.claudeId.slice(0, 8), n: this.items.length }));
    } catch (e) {
      if (!this.failed.has(x.claudeId)) { this.failed.add(x.claudeId); this.ctx.notice(t('server.limitResumeRetry', { title: x.title || x.claudeId.slice(0, 8), error: String((e as Error).message).split('\n')[0].slice(0, 160) })); }
    } finally { this.sweeping = false; }
  }
}

function valid(x: any): x is LimitResume {
  return x && typeof x.claudeId === 'string' && typeof x.cwd === 'string' && Number.isFinite(x.stoppedAt) && Number.isFinite(x.resetsAt) && Number.isFinite(x.resumeAt);
}
