import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluate, newlyEarned, parseLadder, trophyState, type TrophyRule } from './trophies.ts';
import { emptyLedger, mergePRs, mergeTasks, mergeVerified } from './workLog.ts';
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
