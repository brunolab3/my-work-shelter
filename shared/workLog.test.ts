import { describe, expect, it } from 'vitest';
import { emptyLedger, ledgerOf, logRows, mergeConversations, mergePRs, mergeReviews, mergeTasks, mergeWorktrees, prRollup, rangeStart, syncText } from './workLog.ts';
import type { PRBoard, TaskJira } from './board.ts';
import type { ReviewPR } from './reviews.ts';

const D = 864e5, NOW = 100 * D;
const task = (key: string, category: TaskJira['category'], updated = NOW - D, state = category === 'done' ? 'Done' : 'In Progress'): TaskJira =>
  ({ key, title: `Task ${key}`, url: `https://x.atlassian.net/browse/${key}`, state, category, updated });
const pr = (number: number, repo: string, branch: string, state: PRBoard['state'], extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, repo, branch, state, updated: NOW - D, ...extra });

describe('work log ledger', () => {
  it('merges idempotently: the same read twice changes nothing', () => {
    const l = emptyLedger();
    expect(mergeTasks(l, [task('ABC-1', 'indeterminate')], NOW)).toBe(true);
    expect(mergeTasks(l, [task('ABC-1', 'indeterminate')], NOW + 1000)).toBe(false);
    expect(mergePRs(l, [pr(5, 'org/api', 'ABC-1-x', 'abierto')], NOW)).toBe(true);
    expect(mergePRs(l, [pr(5, 'org/api', 'ABC-1-x', 'abierto')], NOW + 1000)).toBe(false);
  });

  it('dates a task done when it moves to done, and clears it when reopened', () => {
    const l = emptyLedger();
    mergeTasks(l, [task('ABC-1', 'indeterminate')], NOW);
    mergeTasks(l, [task('ABC-1', 'done', NOW + 5)], NOW + 10);
    expect(l.tasks['ABC-1'].doneAt).toBe(NOW + 10);
    mergeTasks(l, [task('ABC-1', 'indeterminate', NOW + 20)], NOW + 20);
    expect(l.tasks['ABC-1'].doneAt).toBeUndefined();
    // first seen already done: Jira's last update
    mergeTasks(l, [task('ABC-2', 'done', NOW - 3 * D)], NOW);
    expect(l.tasks['ABC-2'].doneAt).toBe(NOW - 3 * D);
  });

  it("takes GitHub's merge date, and keeps a PR the sources no longer return", () => {
    const l = emptyLedger();
    mergePRs(l, [pr(5, 'org/api', 'ABC-1-x', 'fusionado', { mergedAt: NOW - 2 * D })], NOW);
    mergePRs(l, [], NOW + D);
    expect(l.prs['org/api#5']).toMatchObject({ task: 'ABC-1', mergedAt: NOW - 2 * D });
  });

  it('marks a worktree gone only when its room was read without it', () => {
    const l = emptyLedger();
    const w = { path: '/r/api/.claude/worktrees/abc-1-thing', roomId: 'api', branch: 'ABC-1-thing' };
    mergeWorktrees(l, [w, { path: '/r/api/.claude/worktrees/misc', roomId: 'api' }], ['api'], NOW);
    expect(Object.keys(l.worktrees)).toEqual([w.path]);   // without a task, not logged
    mergeWorktrees(l, [], ['web'], NOW + D);
    expect(l.worktrees[w.path].goneAt).toBeUndefined();
    mergeWorktrees(l, [], ['api'], NOW + 2 * D);
    expect(l.worktrees[w.path].goneAt).toBe(NOW + 2 * D);
  });

  it("logs conversations in a task's worktree and others' PRs reviewed", () => {
    const l = emptyLedger();
    mergeConversations(l, [
      { claudeId: 'c1', title: 'Fix it', roomId: 'api', cwd: '/r/api/.claude/worktrees/shelter-abc-1-fix', updated: NOW },
      { claudeId: 'c2', title: 'Main copy', roomId: 'api', cwd: '/r/api', updated: NOW },
    ], NOW);
    expect(Object.keys(l.conversations)).toEqual(['c1']);
    expect(l.conversations.c1.task).toBe('ABC-1');
    const rp = (n: number, reviewed: boolean): ReviewPR => ({ repo: 'org/web', number: n, url: 'u', title: 'XYZ-9 thing', author: 'ana', draft: false, branch: 'b', head: 'h', base: 'main', updated: NOW, requested: !reviewed, reviewed });
    mergeReviews(l, [rp(1, true), rp(2, false)], NOW);
    mergeReviews(l, [rp(1, true)], NOW + D);
    expect(Object.values(l.reviews)).toEqual([expect.objectContaining({ ref: 'org/web#1', task: 'XYZ-9', at: NOW })]);
  });

  it('reads a broken file as an empty ledger', () => {
    expect(ledgerOf(null)).toEqual(emptyLedger());
    expect(ledgerOf({ tasks: [], notified: 'x' })).toEqual(emptyLedger());
  });
});

describe('the 1-working-day range', () => {
  const at = (y: number, m: number, d: number, h = 10) => new Date(y, m, d, h).getTime();
  it('starts at midnight of the previous working day: a Monday looks back to Friday, a Tuesday to Monday', () => {
    expect(rangeStart('day', at(2026, 10, 23))).toBe(at(2026, 10, 20, 0));   // Mon 23 Nov → Fri 20
    expect(rangeStart('day', at(2026, 10, 24, 15))).toBe(at(2026, 10, 23, 0));   // Tue 24 Nov → Mon 23
    expect(rangeStart('day', at(2026, 10, 21))).toBe(at(2026, 10, 20, 0));   // Sat 21 Nov → Fri 20
  });

  it('counts a task by its PRs moving, not by Jira alone', () => {
    const l = emptyLedger();
    mergeTasks(l, [task('ABC-1', 'indeterminate', NOW - 9 * D), task('ABC-2', 'indeterminate', NOW - 9 * D)], NOW);
    mergePRs(l, [pr(5, 'org/api', 'ABC-1-x', 'abierto', { updated: NOW - 9 * D + 1 }), pr(6, 'org/web', 'ABC-2-y', 'abierto', { updated: NOW - 0.5 * D })], NOW);
    expect(logRows(l, NOW - D).map(r => r.key)).toEqual(['ABC-2']);
  });
});

describe('work log rows', () => {
  const l = emptyLedger();
  mergeTasks(l, [task('ABC-1', 'done', NOW - D), task('ABC-2', 'new', NOW - D), task('ABC-3', 'indeterminate', NOW - 40 * D)], NOW);
  mergePRs(l, [pr(5, 'org/api', 'ABC-1-x', 'fusionado'), pr(6, 'org/web', 'feature/ABC-1-y', 'abierto'), pr(7, 'org/web', 'tidy', 'abierto')], NOW);
  mergeWorktrees(l, [{ path: '/r/web/.claude/worktrees/shelter-preflight-popover--ab12', roomId: 'web', branch: 'worktree-shelter-preflight-popover--ab12' }], ['web'], NOW);

  it('one row per task with its facts; to-do tasks and old ones out of range; keyless last', () => {
    const rows = logRows(l, NOW - 7 * D);
    expect(rows.map(r => r.key)).toEqual(['ABC-1', 'preflight-popover', 'PR-7']);
    expect(rows[0]).toMatchObject({ jira: true, repos: ['org/api', 'org/web'] });
    expect(prRollup(rows[0].prs)).toBe('1 fusionado · 1 abierto');
    expect(logRows(l, 0).map(r => r.key)).toContain('ABC-3');
  });

  it('copies as Markdown: the task line and its PRs underneath', () => {
    const text = syncText(logRows(l, NOW - 7 * D).slice(0, 1));
    expect(text.split('\n')).toEqual([
      '- ABC-1 Task ABC-1 (Done) — 1 fusionado · 1 abierto',
      '  - api#5 PR 5 — fusionado https://github.com/org/api/pull/5',
      '  - web#6 PR 6 — abierto https://github.com/org/web/pull/6',
    ]);
  });
});
