import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkLog, type WorkLogSources } from './workLog.ts';
import type { PRBoard, TaskJira } from '../shared/board.ts';

const EXAMPLE = path.join(import.meta.dirname, '..', 'docs', 'ladder.example.json');
const D = 864e5, NOW = 400 * D;
const sources = (over: Partial<WorkLogSources> = {}, notices: string[] = []): WorkLogSources => ({
  jira: async () => ({ tareas: [{ key: 'ABC-1', title: 'Thing', url: 'u', state: 'Done', category: 'done', updated: NOW - D } as TaskJira] }),
  prs: async () => ({ prs: [{ number: 5, title: 'ABC-1 thing', url: 'p', repo: 'org/api', branch: 'ABC-1-thing', state: 'fusionado', updated: NOW - D, mergedAt: NOW - D } as PRBoard] }),
  worktrees: () => ({ rooms: ['api'], live: [{ path: '/r/api/.claude/worktrees/abc-1-thing', roomId: 'api', branch: 'ABC-1-thing' }] }),
  sessions: () => [],
  reviews: () => null,
  verified: () => [],
  notify: text => notices.push(text),
  ...over,
});

describe('WorkLog', () => {
  it('saves what it merges, announces a trophy once, and keeps it across restarts', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-')), notices: string[] = [];
    const w = new WorkLog(dir, EXAMPLE, () => NOW);
    await w.sweep(sources({}, notices), true);
    expect(notices).toHaveLength(1);                     // first-merge (the example ladder)
    await w.sweep(sources({}, notices), true);
    expect(notices).toHaveLength(1);
    const again = new WorkLog(dir, EXAMPLE, () => NOW);
    const r = await again.read(sources({ jira: async () => null, prs: async () => null }));
    expect(r.ledger.prs['org/api#5'].mergedAt).toBe(NOW - D);
    expect(r.ledger.worktrees['/r/api/.claude/worktrees/abc-1-thing'].task).toBe('ABC-1');
    expect(r.ladder.source).toBe('example');
    expect(r.career.trophies.find(x => x.rule.id === 'first-merge')?.earnedAt).toBe(NOW - D);
  });

  it('never saves DEMO data, and shows a sample log when both sources are in DEMO', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
    const w = new WorkLog(dir, EXAMPLE, () => NOW);
    const demo = sources({ jira: async () => ({ tareas: [{ key: 'REF-1', title: 'Demo', url: 'u', state: 'Done', category: 'done', updated: NOW } as TaskJira], demo: true }),
      prs: async () => ({ prs: [], demo: true }), worktrees: () => ({ rooms: [], live: [] }) });
    await w.sweep(demo, true);
    expect(existsSync(path.join(dir, 'bitacora.json'))).toBe(false);
    const r = await w.read(demo);
    expect(r.demo).toBe(true);
    expect(Object.keys(r.ledger.tasks)).toEqual(['REF-1']);
  });

  it("uses the Overseer's ladder once it exists, made from the example", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
    const w = new WorkLog(dir, EXAMPLE, () => NOW);
    const file = w.ensureLadder();
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(EXAMPLE, 'utf8'));
    writeFileSync(file, '{ "trophies": [{ "id": "z", "kind": "nope" }] }');
    const r = await w.read(sources());
    expect(r.ladder).toMatchObject({ source: 'local', file });
    expect(r.ladder.errors).toEqual([expect.stringContaining("nope")]);
  });
});

describe('Friday digest', () => {
  it('starts counting on the first sweep, then writes the prompt each Friday with the ladder\'s medal requirements', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
    let now = new Date('2026-11-24T12:00').getTime();
    const w = new WorkLog(dir, EXAMPLE, () => now);
    expect(w.digest()).toBeUndefined();
    now = new Date('2026-11-27T09:05').getTime();
    const prompt = w.digest() ?? '';
    expect(prompt).toMatch(/award_propose/);
    expect(prompt).toMatch(/aligner: .*— .*\[github, digest\]/);
    expect(w.digest()).toBeUndefined();
    expect(w.digestRoom()).toBe('logistica');
    expect(prompt).toMatch(/Slack (is off|está apagado)/);   // the example has a Slack award, and no connector has been seen
    const r = w.proposeMedal({ award: 'voice', source: 'digest', text: 'Asked Ana to challenge the spec', evidence: ['conversation abc'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(w.decideMedal(r.medal.id, true)?.state).toBe('accepted');
    expect(new WorkLog(dir, EXAMPLE, () => now).digest()).toBeUndefined();   // saved: not due again after a restart
  });

  it('the Slack source is on only while the digest room reports a connected Slack connector', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
    let now = new Date('2026-11-24T12:00').getTime();
    const w = new WorkLog(dir, EXAMPLE, () => now);
    const slack = { award: 'thanked', source: 'slack' as const, text: 'Thanked by Platform for the CI template', evidence: ['https://fever.slack.com/archives/C01/p1764000000123456'], date: '2026-11-23' };
    expect(w.proposeMedal(slack).ok).toBe(false);
    w.seeConnectors([{ name: 'claude.ai Slack', status: 'needs-auth' }]);
    expect(w.proposeMedal(slack).ok).toBe(false);
    w.seeConnectors([{ name: 'claude.ai Slack', status: 'connected' }]);
    w.digest(); now = new Date('2026-11-27T09:05').getTime();
    const prompt = new WorkLog(dir, EXAMPLE, () => now).digest() ?? '';   // remembered across a restart
    expect(prompt).toMatch(/claude\.ai Slack/);
    expect(prompt).toMatch(/(ONLY the message's permalink|SOLO el enlace permanente)/);
    expect(w.proposeMedal(slack).ok).toBe(true);
    const saved: any = Object.values(JSON.parse(readFileSync(path.join(dir, 'bitacora.json'), 'utf8')).medals)[0];
    expect(Object.keys(saved).sort()).toEqual(['award', 'date', 'evidence', 'id', 'proposedAt', 'requirement', 'source', 'state', 'text']);
  });
});

describe('ladder verification', () => {
  it('builds the prompt from the rules and the log, and records the settled result in the file only under "progress"', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
    const w = new WorkLog(dir, EXAMPLE, () => NOW);
    await w.sweep(sources(), true);
    const prompt = w.verifyPrompt();
    expect(prompt).toMatch(/ladder_progress/);
    expect(prompt).toMatch(/delivers: .*first-merge 1\/1 ✔/);
    const before = JSON.parse(readFileSync(w.ladderFile, 'utf8'));
    const r = w.recordProgress({ summary: 'ok', requirements: [{ id: 'mentoring', verdict: 'met', evidence: ['https://slack.example/t/2'] }] });
    expect(r.ok).toBe(true);
    const after = JSON.parse(readFileSync(w.ladderFile, 'utf8'));
    expect({ ...after, progress: undefined }).toEqual({ ...before, progress: undefined });
    expect(after.progress.requirements.mentoring).toMatchObject({ verdict: 'met', byRules: false });
    expect((await w.read(sources())).progress?.summary).toBe('ok');
    writeFileSync(w.ladderFile, '{ broken');
    expect(w.recordProgress({ requirements: [] }).ok).toBe(false);
  });
});
