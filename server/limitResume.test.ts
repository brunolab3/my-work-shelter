import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { plan, due, resetMs, stopsWork, limitStopIn, scanStopped, LimitResumes, MARGIN_MS, STAGGER_MS, type LimitResume } from './limitResume.ts';
import { projectFolder } from './repos.ts';
import { setLanguage } from '../shared/language.ts';

const NOW = Date.UTC(2026, 10, 20, 17), RESET = NOW + 3600_000;
const item = (claudeId: string, stoppedAt: number, o: Partial<LimitResume> = {}): LimitResume => ({ claudeId, cwd: '/r', stoppedAt, resetsAt: RESET, resumeAt: 0, ...o });

describe('resuming after the usage limit: planning', () => {
  it('resetsAt in seconds or ms, always ms', () => {
    expect(resetMs(1795198200)).toBe(1795198200_000);
    expect(resetMs(1795198200_000)).toBe(1795198200_000);
    expect(resetMs(undefined)).toBeUndefined();
  });
  it('only a rejected event not on extra usage stops work', () => {
    expect(stopsWork({ status: 'rejected' })).toBe(true);
    expect(stopsWork({ status: 'rejected', isUsingOverage: true })).toBe(false);
    expect(stopsWork({ status: 'allowed_warning' })).toBe(false);
  });
  it('past the reset plus a margin, most recently stopped first, a few minutes apart', () => {
    const p = plan([item('a', NOW - 300), item('b', NOW - 100), item('c', NOW - 200)], NOW);
    expect(p.map(x => x.claudeId)).toEqual(['b', 'c', 'a']);
    expect(p.map(x => x.resumeAt)).toEqual([0, 1, 2].map(i => RESET + MARGIN_MS + i * STAGGER_MS));
  });
  it('a reset already past starts now, never in the past', () => {
    expect(plan([item('a', NOW - 9e6, { resetsAt: NOW - 5e6 })], NOW)[0].resumeAt).toBe(NOW);
  });
  it('a new reset pushes the whole queue after it', () => {
    const later = RESET + 5 * 3600_000;
    expect(plan([item('a', NOW), item('b', NOW - 1)], NOW, later).map(x => x.resumeAt)).toEqual([later + MARGIN_MS, later + MARGIN_MS + STAGGER_MS]);
  });
  it('due: the earliest one whose time has come', () => {
    expect(due([item('a', 0, { resumeAt: 10 }), item('b', 0, { resumeAt: 5 })], 20)?.claudeId).toBe('b');
    expect(due([item('a', 0, { resumeAt: 10 })], 9)).toBeUndefined();
  });
});

const line = (o: object) => JSON.stringify(o);
const stopLine = line({ type: 'assistant', timestamp: '2026-11-20T16:30:48.880Z', message: { content: [{ type: 'text', text: "You've hit your session limit" }] }, apiError: 'usage_limit_reached', apiErrorParams: { rate_limit_info: { status: 'rejected', resetsAt: 1795198200 } } });

describe('resuming after the usage limit: transcripts', () => {
  it('a transcript ending in the limit error is a limit stop, with its reset and permission mode', () => {
    const lines = [line({ type: 'user', permissionMode: 'acceptEdits', message: {} }), line({ type: 'api-request' }), stopLine, line({ type: 'last-prompt' }), ''];
    expect(limitStopIn(lines)).toEqual({ at: Date.parse('2026-11-20T16:30:48.880Z'), resetsAt: 1795198200_000, permissions: 'acceptEdits' });
  });
  it('one that went on after the limit (or never hit it) is not', () => {
    expect(limitStopIn([stopLine, line({ type: 'user', message: {} })])).toBeUndefined();
    expect(limitStopIn([line({ type: 'assistant', message: {} })])).toBeUndefined();
  });
  it('scan: only recent transcripts in the given folders', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'lim-')); process.env.CLAUDE_CONFIG_DIR = home;
    const dir = projectFolder('/repos/x'); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'c1.jsonl'), stopLine + '\n');
    writeFileSync(path.join(dir, 'c2.jsonl'), line({ type: 'assistant', message: {} }) + '\n');
    const at = Date.parse('2026-11-20T16:30:48.880Z');
    expect(scanStopped(['/repos/x', '/repos/x'], at + 3600_000).map(x => x.claudeId)).toEqual(['c1']);
    expect(scanStopped(['/repos/x'], at + 10 * 24 * 3600_000)).toEqual([]);
    delete process.env.CLAUDE_CONFIG_DIR;
  });
});

describe('resuming after the usage limit: the queue', () => {
  let dir: string, now: number, resumed: string[], fail: boolean, notices: string[];
  const make = () => new LimitResumes(dir, { resume: async x => { if (fail) throw new Error('busy'); resumed.push(x.claudeId); return 'ok'; }, changed: () => {}, notice: n => notices.push(n), now: () => now });
  beforeEach(() => { setLanguage('en'); dir = mkdtempSync(path.join(tmpdir(), 'limq-')); now = NOW; resumed = []; fail = false; notices = []; });

  it('one per round, in order, and it survives a restart', async () => {
    const q = make();
    q.add(item('a', NOW - 2)); q.add(item('b', NOW - 1));
    await q.sweep(); expect(resumed).toEqual([]);
    now = RESET + MARGIN_MS;
    const q2 = make();
    await q2.sweep(); await q2.sweep(); expect(resumed).toEqual(['b']);
    now += STAGGER_MS; await q2.sweep(); expect(resumed).toEqual(['b', 'a']);
    expect(q2.list()).toEqual([]);
  });
  it('a new rejected holds the queue; a conversation the Overseer continued leaves it', async () => {
    const q = make();
    q.add(item('a', NOW)); q.add(item('b', NOW - 1));
    q.hold(RESET + 7200_000);
    now = RESET + MARGIN_MS; await q.sweep(); expect(resumed).toEqual([]);
    q.drop('a');
    now = RESET + 7200_000 + MARGIN_MS + STAGGER_MS; await q.sweep(); expect(resumed).toEqual(['b']);
  });
  it('what cannot resume now stays and is retried, warning once', async () => {
    const q = make(); q.add(item('a', NOW)); now = RESET + MARGIN_MS; fail = true;
    await q.sweep(); await q.sweep();
    expect(notices.length).toBe(1); expect(q.has('a')).toBe(true);
    fail = false; await q.sweep(); expect(resumed).toEqual(['a']);
  });
});
