import { describe, it, expect } from 'vitest';
import { groupReviews, reviewColumn, reviewKey, reviewFolderName, reviewPRFolder, reviewPRsOfGitHub, reviewPostOf, type ReviewPR } from './reviews';

const pr = (o: Partial<ReviewPR> = {}): ReviewPR => ({
  repo: 'acme/web', number: 1, url: `https://github.com/${o.repo ?? 'acme/web'}/pull/${o.number ?? 1}`, title: 'Something', author: 'ana', draft: false,
  branch: 'feature/ABC-1-thing', head: 'a'.repeat(40), base: 'main', updated: 1, requested: true, reviewed: false, ...o,
});

describe('Review room', () => {
  it('a PR is to review while requested (also again after a verdict) or reviewed only with comments; otherwise its verdict', () => {
    expect(reviewColumn({ requested: true })).toBe('review');
    expect(reviewColumn({ requested: true, verdict: 'APPROVED' })).toBe('review');
    expect(reviewColumn({ requested: false })).toBe('review');
    expect(reviewColumn({ requested: false, verdict: 'CHANGES_REQUESTED' })).toBe('changes');
    expect(reviewColumn({ requested: false, verdict: 'APPROVED' })).toBe('approved');
  });

  it('one review per task across repos; a PR without a key is its own, by repo and number', () => {
    expect(reviewKey(pr())).toBe('ABC-1');
    expect(reviewKey(pr({ branch: 'fix-things', title: 'ABC-7 Fix things' }))).toBe('ABC-7');
    expect(reviewKey(pr({ branch: 'fix-things', title: 'Fix things', repo: 'Acme/Api', number: 12 }))).toBe('acme/api#12');
    const g = groupReviews([
      pr({ number: 1, requested: false, verdict: 'APPROVED', updated: 5 }),
      pr({ repo: 'acme/api', number: 3, updated: 9 }),
      pr({ branch: 'chore', title: 'Chore', number: 2, requested: false, verdict: 'CHANGES_REQUESTED', updated: 1 }),
    ], { 'ABC-1': '/r/ABC-1' }, ['acme/web']);
    expect(g.map(r => [r.key, r.column, r.prs.length, r.started])).toEqual([['ABC-1', 'review', 2, true], ['acme/web#2', 'changes', 1, false]]);
    expect(g[0].missing).toEqual(['acme/api']);
    expect(g[0].folder).toBe('/r/ABC-1');
  });

  it('folder names are safe, and two PRs of one task in a repo get one folder each', () => {
    expect(reviewFolderName('acme/web#12')).toBe('acme-web-12');
    expect(reviewFolderName('ABC-1')).toBe('ABC-1');
    expect(reviewPRFolder('acme/web', 12)).toBe('web-12');
    expect(reviewPRFolder('acme/web', 13)).not.toBe(reviewPRFolder('acme/web', 12));
  });

  it('reads GitHub: requested by name, the latest verdict, without repeats or the Overseer\'s own', () => {
    const node = (n: number, o: any = {}) => ({ number: n, url: `u${n}`, title: `T${n}`, isDraft: false, updatedAt: '2026-11-20T10:00:00Z', headRefName: `ABC-${n}`, headRefOid: 'h' + n, baseRefName: 'main', author: { login: 'ana' }, repository: { nameWithOwner: 'acme/web' }, reviewRequests: { nodes: [] }, latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [] }, ...o });
    const j = { data: { viewer: { login: 'me' },
      requested: { nodes: [node(1)] },
      reviewed: { nodes: [node(1), node(2, { latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'me' } }] } }),
        node(3, { reviewRequests: { nodes: [{ requestedReviewer: { login: 'me' } }] }, latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'me' } }] } }),
        node(4, { author: { login: 'me' } }),
        node(5, { latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'bob' } }] }, latestReviews: { nodes: [{ state: 'COMMENTED', author: { login: 'me' } }] } })] } } };
    const { me, prs } = reviewPRsOfGitHub(j);
    expect(me).toBe('me');
    expect(prs.map(p => [p.number, reviewColumn(p), p.reviewed])).toEqual([[1, 'review', false], [2, 'changes', true], [3, 'review', true], [5, 'review', true]]);
    expect(prs[0]).toMatchObject({ repo: 'acme/web', head: 'h1', branch: 'ABC-1', requested: true });
  });

  it('posting on a PR is told apart from reading it', () => {
    for (const c of ['gh pr review 12 --approve', 'cd x && gh pr review --request-changes -b "no"', 'gh pr comment 3 -b hi',
      'gh api repos/a/b/pulls/12/reviews -f event=COMMENT', 'gh api -X POST repos/a/b/pulls/12/comments --input c.json',
      'gh api repos/a/b/issues/12/comments -f body=x', 'gh api --method PATCH repos/a/b/pulls/comments/99 -f body=y',
      'gh api graphql -f query=\'mutation { addPullRequestReview(input: {}) { clientMutationId } }\''])
      expect(reviewPostOf(c), c).not.toBeNull();
    for (const c of ['gh pr view 12 --comments', 'gh pr diff 12', 'gh api repos/a/b/pulls/12/reviews', 'gh api repos/a/b/pulls/12/comments --paginate',
      'gh api graphql -f query=\'query { viewer { login } }\'', 'gh pr checks 12', 'git commit -m "gh pr review"'])
      expect(reviewPostOf(c), c).toBeNull();
  });
});
