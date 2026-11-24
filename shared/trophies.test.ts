import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { digestDue, evaluate, medalRequirements, newlyEarned, parseLadder, progressOf, settleProgress, trophyState, withProgress, type TrophyRule } from './trophies.ts';
import { decideMedal, emptyLedger, mergePRs, mergeTasks, mergeVerified, proposeMedal } from './workLog.ts';
import type { PRBoard } from './board.ts';

const D = 864e5, NOW = 400 * D;
const merged = (n: number, at: number, repo = 'org/api', branch = `ABC-${n}-x`): PRBoard & { mergedAt: number } =>
  ({ number: n, title: `PR ${n}`, url: `u${n}`, repo, branch, state: 'fusionado', updated: at, mergedAt: at });
const rule = (r: Partial<TrophyRule>): TrophyRule => ({ id: 'x', name: 'X', kind: 'prsMerged', n: 1, ...r });

describe('trophies', () => {
  const l = emptyLedger();
  mergePRs(l, [merged(1, NOW - 200 * D), merged(2, NOW - 20 * D), merged(3, NOW - 10 * D), merged(4, NOW - 5 * D, 'org/web', 'XYZ-4-y')], NOW);

  it('earns at the n-th fact and keeps it; shows progress until then', () => {
    expect(trophyState(l, rule({ n: 3 }), NOW)).toMatchObject({ count: 3, progress: 1, earnedAt: NOW - 10 * D });
    expect(trophyState(l, rule({ n: 10 }), NOW)).toMatchObject({ count: 4, progress: 0.4 });
    expect(trophyState(l, rule({ n: 10 }), NOW).earnedAt).toBeUndefined();
  });

  it('within a window: n facts inside that many days', () => {
    expect(trophyState(l, rule({ n: 3, within: 30 }), NOW)).toMatchObject({ earnedAt: NOW - 5 * D });
    expect(trophyState(l, rule({ n: 4, within: 30 }), NOW)).toMatchObject({ count: 3, progress: 0.75 });
  });

  it('filters by project and date', () => {
    expect(trophyState(l, rule({ n: 9, project: 'XYZ' }), NOW).count).toBe(1);
    expect(trophyState(l, rule({ n: 9, since: NOW - 15 * D }), NOW).count).toBe(2);
  });

  it('counts done tasks across repos and verified ones', () => {
    const m = emptyLedger();
    mergeTasks(m, [{ key: 'ABC-1', title: 't', url: 'u', state: 'Done', category: 'done', updated: NOW - D }], NOW);
    mergePRs(m, [merged(1, NOW - 2 * D, 'org/api', 'ABC-1-a'), merged(2, NOW - 2 * D, 'org/web', 'ABC-1-b')], NOW);
    mergeVerified(m, ['ABC-1'], NOW);
    expect(trophyState(m, rule({ kind: 'multiRepoTasks' }), NOW).earnedAt).toBe(NOW - D);
    expect(trophyState(m, rule({ kind: 'multiRepoTasks', repos: 3 }), NOW).count).toBe(0);
    expect(trophyState(m, rule({ kind: 'verifiedInProd' }), NOW).earnedAt).toBe(NOW);
  });
});

describe('career ladder', () => {
  it('parses the repo example without errors and evaluates its steps', () => {
    const { ladder, errors } = parseLadder(readFileSync(path.join(import.meta.dirname, '..', 'docs', 'ladder.example.json'), 'utf8'));
    expect(errors).toEqual([]);
    expect(ladder.trophies.length).toBeGreaterThan(3);
    const l = emptyLedger();
    mergePRs(l, [merged(1, NOW - D)], NOW);
    const c = evaluate(ladder, l, NOW);
    expect(c.trophies.find(x => x.rule.id === 'first-merge')?.earnedAt).toBe(NOW - D);
    expect(c.current).toBe('L1');
    const l2 = c.steps.find(s => s.step.id === 'L2')!;
    expect(l2.requirements.find(r => r.req.id === 'mentoring')).toMatchObject({ measured: false, met: false });
    expect(newlyEarned(c, []).map(x => x.rule.id)).toEqual(['first-merge']);
    expect(newlyEarned(c, ['first-merge'])).toEqual([]);
  });

  it('requirements: all takes the slowest trophy, any the fastest', () => {
    const { ladder } = parseLadder(JSON.stringify({
      trophies: [{ id: 'a', kind: 'prsMerged', n: 1 }, { id: 'b', kind: 'prsMerged', n: 4 }],
      steps: [{ id: 'S', requirements: [{ id: 'all', trophies: ['a', 'b'] }, { id: 'any', trophies: ['a', 'b'], mode: 'any' }] }],
    }));
    const l = emptyLedger(); mergePRs(l, [merged(1, NOW - D)], NOW);
    const [all, any] = evaluate(ladder, l, NOW).steps[0].requirements;
    expect(all).toMatchObject({ progress: 0.25, met: false });
    expect(any).toMatchObject({ progress: 1, met: true });
  });

  it('reports what is wrong and leaves it out', () => {
    expect(parseLadder('{ nope').errors[0]).toMatch(/JSON/);
    const { ladder, errors } = parseLadder(JSON.stringify({
      trophies: [{ id: 'a', kind: 'prsMerged', n: 1 }, { id: 'a', kind: 'prsMerged' }, { id: 'b', kind: 'stars' }, { id: 'c', kind: 'tasksDone', within: 'soon' }, { kind: 'tasksDone' }],
      steps: [{ id: 'S', requirements: [{ id: 'r', trophies: ['a', 'ghost'] }] }],
    }));
    expect(ladder.trophies.map(x => x.id)).toEqual(['a']);
    expect(ladder.steps[0].requirements[0].trophies).toEqual(['a']);
    expect(errors).toHaveLength(5);
    expect(parseLadder('{}').errors).toHaveLength(1);
  });
});

describe('medals', () => {
  const ladder = parseLadder(JSON.stringify({
    digestRoom: 'comunicaciones',
    trophies: [{ id: 'voice', kind: 'awards', requirement: 'voice', n: 2 }, { id: 'bad', kind: 'awards', requirement: 'nope' }],
    steps: [{ id: 'S', requirements: [{ id: 'voice', text: 'Speaks up', evidence: 'asked a teammate to question a task', trophies: ['voice'] }] }],
  }));

  it('an awards trophy needs a requirement that takes medals; the digest room is read', () => {
    expect(ladder.ladder.trophies.map(x => x.id)).toEqual(['voice']);
    expect(ladder.errors).toEqual([expect.stringContaining('nope')]);
    expect(ladder.ladder.digestRoom).toBe('comunicaciones');
    expect(medalRequirements(ladder.ladder).map(q => q.id)).toEqual(['voice']);
    expect(parseLadder(JSON.stringify({ digestRoom: 'bar', trophies: [{ id: 'a', kind: 'prsMerged' }] })).errors).toHaveLength(1);
  });

  it('proposed medals count only once accepted, and fill the trophy', () => {
    const l = emptyLedger();
    expect(proposeMedal(l, { requirement: 'other', text: 'x', evidence: ['u'] }, ['voice'], NOW).ok).toBe(false);
    expect(proposeMedal(l, { requirement: 'voice', text: 'x', evidence: [' '] }, ['voice'], NOW).ok).toBe(false);
    const a = proposeMedal(l, { requirement: 'voice', text: 'Asked Ana to challenge the spec', evidence: ['https://slack/x'] }, ['voice'], NOW);
    const b = proposeMedal(l, { requirement: 'voice', text: 'Pushed back in planning', evidence: ['conversation abc'] }, ['voice'], NOW + 1);
    if (!a.ok || !b.ok) throw new Error('not proposed');
    const rule = ladder.ladder.trophies[0];
    expect(trophyState(l, rule, NOW).count).toBe(0);
    decideMedal(l, a.medal.id, true, NOW + 10);
    expect(trophyState(l, rule, NOW + 10)).toMatchObject({ count: 1, progress: 0.5 });
    decideMedal(l, b.medal.id, false, NOW + 20);
    expect(decideMedal(l, b.medal.id, true, NOW + 30)).toBeUndefined();   // decided stays decided
    expect(trophyState(l, rule, NOW + 30).earnedAt).toBeUndefined();
  });

  it('the Friday digest is due once each Friday from 09:00, never on the first sweep', () => {
    const at = (s: string) => new Date(s).getTime();
    expect(digestDue(undefined, at('2026-11-27T10:00'))).toBe(false);
    expect(digestDue(at('2026-11-24T12:00'), at('2026-11-27T08:59'))).toBe(false);   // Tuesday → Friday before 9
    expect(digestDue(at('2026-11-24T12:00'), at('2026-11-27T09:00'))).toBe(true);
    expect(digestDue(at('2026-11-27T09:01'), at('2026-11-30T10:00'))).toBe(false);   // done this Friday
    expect(digestDue(at('2026-11-27T09:01'), at('2026-12-04T09:30'))).toBe(true);
  });
});

describe('ladder verification', () => {
  const text = JSON.stringify({
    note: 'mine', trophies: [{ id: 'a', kind: 'prsMerged', n: 1 }, { id: 'b', kind: 'prsMerged', n: 3 }],
    steps: [
      { id: 'L1', requirements: [{ id: 'ships', trophies: ['a'] }, { id: 'people', trophies: [] }] },
      { id: 'L2', requirements: [{ id: 'volume', trophies: ['b'] }] },
    ],
  }, null, 4);
  const { ladder } = parseLadder(text);
  const l = emptyLedger(); mergePRs(l, [merged(1, NOW - D)], NOW);
  const career = evaluate(ladder, l, NOW);

  it('the rules decide what they measure; the session the rest, only with evidence; the level is the last step fully met', () => {
    const r = settleProgress(ladder, career, { level: 'L2', summary: 'Close to L2', requirements: [
      { id: 'ships', verdict: 'not-met' }, { id: 'people', verdict: 'met', evidence: ['https://slack/t/1'] }, { id: 'volume', verdict: 'met', evidence: ['x'] },
    ] }, NOW);
    expect(r.overridden).toEqual(['ships', 'volume']);
    expect(r.progress.requirements.ships).toMatchObject({ verdict: 'met', byRules: true, evidence: ['u1'] });
    expect(r.progress.requirements.volume).toMatchObject({ verdict: 'partial', byRules: true });
    expect(r.progress.requirements.people).toMatchObject({ verdict: 'met', byRules: false });
    expect(r.progress.level).toBe('L1');
    const bare = settleProgress(ladder, career, { requirements: [{ id: 'people', verdict: 'met' }] }, NOW);
    expect(bare.unproven).toEqual(['people']);
    expect(bare.progress.level).toBeUndefined();
  });

  it('writes only the "progress" key, keeping the rest and the indent', () => {
    const { progress } = settleProgress(ladder, career, { requirements: [] }, NOW);
    const out = withProgress(text, progress);
    expect(out.startsWith('{\n    "note": "mine"')).toBe(true);
    const j = JSON.parse(out);
    expect({ ...j, progress: undefined }).toEqual({ ...JSON.parse(text), progress: undefined });
    expect(progressOf(j)?.at).toBe(NOW);
    expect(progressOf({ progress: { at: 'x' } })).toBeUndefined();
  });
});
