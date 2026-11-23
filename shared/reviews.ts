// The Review room: others' PRs that ask for the Overseer's review, in three columns, grouped by task (one review per
// Jira key, across repos; a PR without one is its own review). Pure: used by the client, the server and the tests.
import { branchTask, textKey } from './tasks.ts';

export type ReviewColumn = 'review' | 'changes' | 'approved';
export const REVIEW_COLUMNS: ReviewColumn[] = ['review', 'changes', 'approved'];

/** One PR the Overseer reviews, as read from GitHub */
export interface ReviewPR {
  repo: string; number: number; url: string; title: string; author: string; draft: boolean;
  branch: string; head: string; base: string; updated: number;
  requested: boolean;                                   // their review is requested by name right now
  verdict?: 'APPROVED' | 'CHANGES_REQUESTED';           // their latest approval or change request
  reviewed: boolean;                                    // they have left a review (any kind)
}
export interface ReviewPRCard extends ReviewPR { column: ReviewColumn }
/** A review: every PR of one task (or a lone PR), with where its worktrees and conversation stand */
export interface Review {
  key: string; title: string; column: ReviewColumn; prs: ReviewPRCard[]; updated: number;
  started: boolean;                                     // its worktrees and conversation exist (opened by the Overseer)
  folder?: string;                                      // the conversation's folder, once started
  missing?: string[];                                   // repos of its PRs with no room in the shelter (no worktree)
}

/** What the Review room shows: GitHub's state (`off` not connected, `reading` before its first answer) and the reviews */
export interface ReviewBoard { state: 'off' | 'reading' | 'ok' | 'error'; reviews: Review[]; error?: string }

/** The column of a PR: a pending request (also one made again after a verdict) or a review with only comments is still
 *  to review; otherwise, their latest verdict */
export function reviewColumn(p: Pick<ReviewPR, 'requested' | 'verdict'>): ReviewColumn {
  if (p.requested || !p.verdict) return 'review';
  return p.verdict === 'CHANGES_REQUESTED' ? 'changes' : 'approved';
}

/** The review a PR belongs to: its task (branch, then title) or, without one, the PR itself (`owner/repo#12`: `PR-12`
 *  would mix PRs of different repos) */
export const reviewKey = (p: Pick<ReviewPR, 'branch' | 'title' | 'repo' | 'number'>) =>
  branchTask(p.branch) ?? textKey(p.title) ?? `${p.repo.toLowerCase()}#${p.number}`;

/** The folder name of a review's conversation (a key as a safe file name: `owner/repo#12` → `owner-repo-12`) */
export const reviewFolderName = (key: string) => key.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'review';

/** A PR's worktree folder inside its review: the repo's name and the PR's number (`webclient-1234`), so two PRs of
 *  one task in the same repo get one each */
export const reviewPRFolder = (repo: string, number: number) => reviewFolderName(`${repo.split('/').pop() ?? repo}-${number}`);

const URGENCY: Record<ReviewColumn, number> = { review: 0, changes: 1, approved: 2 };

/** The reviews of a set of PRs: grouped by key, each in the most urgent column of its PRs, most recently updated first */
export function groupReviews(prs: ReviewPR[], started: Record<string, string> = {}, rooms: string[] = []): Review[] {
  const by = new Map<string, ReviewPRCard[]>();
  for (const p of prs) {
    const k = reviewKey(p);
    const list = by.get(k) ?? [];
    if (!list.some(x => x.url === p.url)) list.push({ ...p, column: reviewColumn(p) });
    by.set(k, list);
  }
  const known = new Set(rooms.map(r => r.toLowerCase()));
  return [...by].map(([key, list]): Review => {
    list.sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
    const column = list.map(p => p.column).sort((a, b) => URGENCY[a] - URGENCY[b])[0];
    const missing = [...new Set(list.map(p => p.repo).filter(r => !known.has(r.toLowerCase())))];
    return {
      key, title: list[0].title, column, prs: list, updated: Math.max(...list.map(p => p.updated)),
      started: key in started, ...(started[key] ? { folder: started[key] } : {}), ...(missing.length ? { missing } : {}),
    };
  }).sort((a, b) => b.updated - a.updated);
}

/** PRs read from GitHub's GraphQL answer to REVIEW_ROOM_QUERY (server/reviewRoom.ts): requested ones and reviewed ones,
 *  without repeats and without the Overseer's own */
export function reviewPRsOfGitHub(j: any): { me: string; prs: ReviewPR[] } {
  const me = String(j?.data?.viewer?.login ?? '');
  const seen = new Set<string>(), prs: ReviewPR[] = [];
  const asked = (j?.data?.requested?.nodes ?? []).map((n: any) => [n, true] as const);
  for (const [n, fromSearch] of [...asked, ...(j?.data?.reviewed?.nodes ?? []).map((n: any) => [n, false] as const)]) {
    if (!n?.number || !n.url || seen.has(n.url) || n.author?.login === me) continue;
    seen.add(n.url);
    const requested = fromSearch || (n.reviewRequests?.nodes ?? []).some((r: any) => r?.requestedReviewer?.login === me);
    const opinion = (n.latestOpinionatedReviews?.nodes ?? []).find((r: any) => r?.author?.login === me)?.state;
    const reviewed = !!opinion || (n.latestReviews?.nodes ?? []).some((r: any) => r?.author?.login === me);
    const updated = Date.parse(n.updatedAt ?? '');
    prs.push({
      repo: n.repository?.nameWithOwner ?? '', number: n.number, url: n.url, title: n.title ?? '', author: n.author?.login ?? '',
      draft: !!n.isDraft, branch: n.headRefName ?? '', head: n.headRefOid ?? '', base: n.baseRefName ?? '',
      updated: Number.isFinite(updated) ? updated : 0, requested,
      ...(opinion === 'APPROVED' || opinion === 'CHANGES_REQUESTED' ? { verdict: opinion } : {}), reviewed,
    });
  }
  return { me, prs };
}

/** If a Bash command posts on a PR with `gh` (a review, a comment, a reply in a thread; `gh api` writes to its reviews or
 *  comments, or a GraphQL mutation): what it does, for the Overseer's confirmation; otherwise null */
export function reviewPostOf(cmd: string): string | null {
  for (const chunk of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = chunk.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;
    if (!/(^|\/)gh$/.test(w[i] ?? '')) continue;
    const [a, b] = [w[i + 1], w[i + 2]];
    if (a === 'pr' && (b === 'review' || b === 'comment')) return chunk.trim();
    if (a !== 'api') continue;
    const rest = w.slice(i + 2);
    const method = rest.find((x, k) => rest[k - 1] === '-X' || rest[k - 1] === '--method') ?? rest.find(x => x.startsWith('--method='))?.slice(9) ?? rest.find(x => /^-X[A-Z]+$/.test(x))?.slice(2);
    const fields = rest.some(x => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(x));
    const writes = method ? !/^GET$/i.test(method) : fields;
    if (rest[0] === 'graphql' ? /\bmutation\b/.test(chunk) : writes && rest.some(x => /(pulls\/\d+\/(reviews|comments)|pulls\/comments\/\d+|issues\/\d+\/comments|issues\/comments\/\d+)/.test(x))) return chunk.trim();
  }
  return null;
}
