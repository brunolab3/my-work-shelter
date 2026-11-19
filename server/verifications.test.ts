import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Verifications, planText } from './verifications.ts';
import { isApproved } from '../shared/verification.ts';

const CPS = { checkpoints: [{ id: 'final', kind: 'final' as const, signals: [{ id: 'ran', kind: 'must-run', what: 'it runs', where: 'log «ok» in worker', baseline: '~1,000 a day' }] }] };

describe('Verifications', () => {
  it('saves plans by task, approves the current version, and turns them inconclusive when read past the deadline', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-'));
    let now = 0;
    const v = new Verifications(dir, () => now);
    expect(v.propose('ABC-1', CPS).ok).toBe(true);
    expect(isApproved(v.approve('ABC-1')!)).toBe(true);
    expect(v.report('ABC-1', { checkpoint: 'final', event: 'live' })?.ok).toBe(true);
    expect(v.report('ABC-2', { checkpoint: 'final', event: 'live' })).toBeUndefined();
    now = 25 * 3_600_000;
    const other = new Verifications(dir, () => now);   // read back from disk
    const p = other.get('ABC-1')!;
    expect([isApproved(p), p.points[0].state]).toEqual([true, 'inconclusive']);
    expect(planText(p)).toContain('log «ok» in worker');
  });
});

describe('Verifications.repasar', () => {
  const H = 3_600_000;
  const PLAN = { checkpoints: [
    { id: 'pr-10', kind: 'pr' as const, pr: 'acme/api#10', signals: [{ id: 'gone', kind: 'must-disappear', what: 'the timeout', where: 'errors in api' }] },
    { id: 'final', kind: 'final' as const, signals: [{ id: 'ran', kind: 'must-run', what: 'it runs', where: 'log «ok»' }] },
  ] };
  const conv = { roomId: 'api', sessionId: 's1', claudeId: 'c1', cwd: '/r/api-abc-1' };
  function mount() {
    let now = new Date(2026, 10, 17, 10, 0).getTime();   // a Tuesday
    const v = new Verifications(mkdtempSync(path.join(os.tmpdir(), 'verif-')), () => now);
    const scheduled = new Map<string, { when: number; message: string }>(), notices: string[] = [];
    let merged = false, n = 0;
    const ctx = {
      prs: async () => [{ ref: 'acme/api#10', merged }], inProdCheck: async () => false,
      schedule: (_c: unknown, when: number, message: string) => { const id = 'p' + ++n; scheduled.set(id, { when, message }); return id; },
      pending: (id: string) => scheduled.has(id), cancel: (id: string) => { scheduled.delete(id); }, notify: (text: string) => { notices.push(text); },
    };
    v.propose('ABC-1', PLAN, conv);
    return { v, ctx, scheduled, notices, merge: () => { merged = true; }, visit: (ms: number) => { now += ms; }, now: () => now };
  }

  it('on merge it opens the PR checkpoint and keeps exactly one recheck scheduled, backing off', async () => {
    const m = mount();
    await m.v.sweep(m.ctx);
    expect(m.scheduled.size).toBe(0);
    m.merge(); await m.v.sweep(m.ctx);
    expect([...m.scheduled.values()].map(x => x.when)).toEqual([m.now() + 30 * 60_000]);
    expect([...m.scheduled.values()][0].message).toContain('verification_report');
    await m.v.sweep(m.ctx);
    expect(m.scheduled.size).toBe(1);
    m.scheduled.clear(); await m.v.sweep(m.ctx);   // delivered: the next one, two hours later
    expect([...m.scheduled.values()].map(x => x.when)).toEqual([m.now() + 2 * H]);
    expect(m.v.get('ABC-1')!.points[0].rechecks).toBe(2);
  });

  it('a closed checkpoint drops its pending recheck and is told once; one out of time asks its conversation', async () => {
    const m = mount();
    m.merge(); await m.v.sweep(m.ctx);
    m.v.report('ABC-1', { checkpoint: 'pr-10', event: 'live' });
    m.v.report('ABC-1', { checkpoint: 'pr-10', event: 'evidenced', signal: 'gone', evidence: '0 since the deploy' });
    await m.v.sweep(m.ctx);
    // the final one opened too (every PR merged): its own recheck is the one left
    expect(m.v.get('ABC-1')!.points.map(c => [c.state, !!c.scheduled])).toEqual([['evidenced', false], ['waiting-deploy', true]]);
    expect(m.scheduled.size).toBe(1);
    expect(m.notices).toHaveLength(1);
    m.visit(25 * H); await m.v.sweep(m.ctx); await m.v.sweep(m.ctx);
    expect(m.v.get('ABC-1')!.points[1].state).toBe('inconclusive');
    expect(m.notices).toHaveLength(2);
    expect([...m.scheduled.values()].map(x => [x.when, x.message.includes('AskUserQuestion')])).toEqual([[m.now(), true]]);
  });
});
