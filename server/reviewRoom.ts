// The Review room: others' PRs that ask for the Overseer's review (shared/reviews.ts), read every minute with GitHub
// connected (one GraphQL query: those that request their review by name and those they have reviewed). Each review (a
// task key, across repos, or a lone PR) starts when the Overseer opens it: a folder of its own in the room's folder with
// one worktree per PR, detached at its head (fetched from `pull/<n>/head`, so forks work too; no local branch, nothing
// to push), and one conversation there, which drafts the review and posts nothing without the Overseer's yes
// (`reviewGate` in sessions.ts). The repos' rooms never see these worktrees (`hideWorktreesUnder` in repos.ts).
// What changes later goes to that conversation: a new PR of the task (its worktree first), new commits (the worktree
// follows them if nothing was changed in it), a request made again after a verdict, a PR that leaves. A PR leaves when
// it is merged or closed, or no longer requested and never reviewed; a review with no PRs left retires with its folder
// (waiting for an open conversation; asking the Overseer once if something was changed in a worktree).
// Read-only towards GitHub: `git fetch` with the Overseer's own credentials, as when pulling.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { SessionSummary } from '../shared/protocol.ts';
import { groupReviews, reviewColumn, reviewKey, reviewFolderName, reviewPRFolder, reviewPRsOfGitHub, type Review, type ReviewColumn, type ReviewPR } from '../shared/reviews.ts';
import { isJiraKey } from '../shared/tasks.ts';
import { t } from '../shared/language.ts';

export const REVIEW_ROOM = 'review';

const FIELDS = `number title url isDraft updatedAt headRefName headRefOid baseRefName author { login } repository { nameWithOwner }
    reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } } } }
    latestOpinionatedReviews(first: 30) { nodes { state author { login } } }
    latestReviews(first: 30) { nodes { state author { login } } }`;
export const REVIEW_ROOM_QUERY = `query {
  viewer { login }
  requested: search(query: "is:pr is:open archived:false -author:@me user-review-requested:@me sort:updated-desc", type: ISSUE, first: 50) { nodes { ... on PullRequest { ${FIELDS} } } }
  reviewed: search(query: "is:pr is:open archived:false -author:@me reviewed-by:@me sort:updated-desc", type: ISSUE, first: 50) { nodes { ... on PullRequest { ${FIELDS} } } }
}`;

export interface RepoRoom { id: string; path: string; repo?: string }
export interface TaskContext { title?: string; status?: string; epic?: string; description?: string }
/** A started review, as saved: its folder and, per PR (by URL), its worktree, the head it shows and its column */
interface Started { folder: string; prs: Record<string, { dir?: string; head: string; column: ReviewColumn; number: number; repo: string }> }

export interface CtxReviewRoom {
  connection(): Promise<{ real: boolean; token?: string }>;
  query(token?: string): Promise<any>;
  rooms(): Promise<RepoRoom[]>;                              // the repo rooms with their GitHub repo (owner/name, lowercase)
  root(): string;                                           // the Review room's folder: one folder per review inside
  git(cwd: string, args: string[]): Promise<string>;         // throws if the command fails
  sessions(): SessionSummary[];
  /** the review's conversation, with `text`: the open one in `folder` (returns its id; `text` only if `tell`), the last
   *  one there resumed, or a new one */
  open(folder: string, text: string, tell: boolean): Promise<string | undefined>;
  /** to the review's conversation only if there is one (open, or the last one there resumed): false if none */
  tell(folder: string, text: string): Promise<boolean>;
  jira(key: string): Promise<TaskContext | undefined>;
  trash(paths: string[]): Promise<void>;
  ask(text: string, yes: () => Promise<void>): void;         // a yes/no notice to the Overseer
  notice(text: string): void;
  changed(reviews: Review[]): void;                         // the board, and the room's holograms (started reviews)
}

const inside = (dir: string, p: string) => (path.resolve(p) + path.sep).startsWith(path.resolve(dir) + path.sep);

export class ReviewRoom {
  private started: Record<string, Started> = {};
  private asked: string[] = [];
  private approved: string[] = [];          // review keys the Overseer said to retire with work left
  private prs: ReviewPR[] = [];
  private repoRooms: RepoRoom[] = [];
  private read = false;                      // GitHub answered at least once
  private file: string;
  constructor(dir: string, private ctx: CtxReviewRoom) {
    this.file = path.join(dir, 'revisiones.json');
    try {
      if (existsSync(this.file)) {
        const j = JSON.parse(readFileSync(this.file, 'utf8'));
        if (j?.started && typeof j.started === 'object') this.started = j.started;
        if (Array.isArray(j?.asked)) this.asked = j.asked.filter((x: unknown) => typeof x === 'string');
        if (Array.isArray(j?.approved)) this.approved = j.approved.filter((x: unknown) => typeof x === 'string');
      }
    } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ started: this.started, asked: this.asked.slice(-500), approved: this.approved }), { mode: 0o600 }); renameSync(tmp, this.file); }

  /** The board: every review, with whether it has started */
  reviews(): Review[] {
    const folders = Object.fromEntries(Object.entries(this.started).map(([k, s]) => [k, s.folder]));
    return groupReviews(this.prs, folders, this.repoRooms.map(r => r.repo).filter((r): r is string => !!r));
  }
  /** The started reviews (their holograms), also before GitHub answers */
  startedReviews(): { key: string; folder: string; title: string; repos: string[] }[] {
    return Object.entries(this.started).map(([key, s]) => {
      const prs = this.prs.filter(p => s.prs[p.url]);
      return { key, folder: s.folder, title: prs[0]?.title ?? '', repos: [...new Set(Object.values(s.prs).map(p => p.repo))] };
    });
  }
  private publish() { this.ctx.changed(this.reviews()); }

  private inProgress?: Promise<void>;
  poll() { return this.inProgress ??= this.round().finally(() => { this.inProgress = undefined; }); }

  private async round() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const j = await this.ctx.query(c.token);
    if (!j?.data || j.errors?.length) throw new Error(String(j?.errors?.[0]?.message ?? 'GitHub'));   // never retire on a failed read
    this.prs = reviewPRsOfGitHub(j).prs;
    this.repoRooms = await this.ctx.rooms();
    this.read = true;
    let changed = false;
    for (const key of Object.keys(this.started)) changed = await this.follow(key).catch(e => { console.error(`Review ${key}:`, String((e as Error).message).split('\n')[0]); return false; }) || changed;
    if (changed) this.save();
    this.publish();
  }

  /** Opens a review (the Overseer's click): its worktrees and its conversation. The conversation's id */
  async open(key: string): Promise<string | undefined> {
    const prs = this.prs.filter(p => reviewKey(p) === key);
    if (!prs.length && !this.started[key]) throw new Error(t('reviews.notFound', { key: key }));
    if (!this.started[key]) {
      const folder = path.join(this.ctx.root(), reviewFolderName(key));
      mkdirSync(folder, { recursive: true });
      this.started[key] = { folder, prs: {} };
      for (const p of prs) await this.addPR(key, p).catch(e => this.ctx.notice(t('reviews.couldNotCheckOut', { number: p.number, repo: p.repo, error: String((e as Error).message).split('\n')[0].slice(0, 160) })));
      this.save();
      this.publish();
    }
    const s = this.started[key];
    const context = isJiraKey(key) ? await this.ctx.jira(key).catch(() => undefined) : undefined;
    return this.ctx.open(s.folder, this.prompt(key, context), false);
  }

  /** «Done with this review»: retires its worktrees and folder now (asking first if something was changed in them) */
  async finish(key: string) {
    if (!this.started[key]) return;
    await this.retire(key, true);
    this.save();
    this.publish();
  }

  private prompt(key: string, task?: TaskContext): string {
    const s = this.started[key];
    const prs = this.prs.filter(p => s.prs[p.url]);
    const lines = prs.map(p => t('reviews.promptPR', { repo: p.repo, number: p.number, title: p.title, author: p.author, url: p.url, base: p.base, branch: p.branch,
      where: s.prs[p.url].dir ? path.relative(s.folder, s.prs[p.url].dir!) : t('reviews.promptNoWorktree') }));
    const jira = task?.title ? t('reviews.promptJira', { key: key, title: task.title, state: task.status ?? '—', epic: task.epic ?? '—', description: (task.description ?? '').slice(0, 6000) || '—' })
      : isJiraKey(key) ? t('reviews.promptJiraRead', { key: key }) : t('reviews.promptNoTask');
    return t('reviews.prompt', { key: key, prs: lines.join('\n'), jira });
  }

  /** Its worktree for one PR: fetched from GitHub and detached at its head, in the review's folder */
  private async addPR(key: string, p: ReviewPR) {
    const s = this.started[key];
    const room = this.repoRooms.find(r => r.repo === p.repo.toLowerCase());
    if (!room) { s.prs[p.url] = { head: p.head, column: reviewColumn(p), number: p.number, repo: p.repo }; return; }
    const dir = path.join(s.folder, reviewPRFolder(p.repo, p.number));
    if (!existsSync(dir)) {
      await this.ctx.git(room.path, ['worktree', 'prune']).catch(() => '');
      await this.ctx.git(room.path, ['fetch', '--no-tags', 'origin', `pull/${p.number}/head`]);
      await this.ctx.git(room.path, ['worktree', 'add', '--detach', dir, p.head]);
    }
    s.prs[p.url] = { dir, head: p.head, column: reviewColumn(p), number: p.number, repo: p.repo };
  }

  /** What changed in a started review since the last round, to its worktrees and its conversation */
  private async follow(key: string): Promise<boolean> {
    const s = this.started[key];
    const now = this.prs.filter(p => reviewKey(p) === key);
    const news: string[] = [];
    let changed = false;
    for (const p of now) {
      const was = s.prs[p.url];
      const column = reviewColumn(p);
      if (!was) {
        await this.addPR(key, p).catch(e => {
          s.prs[p.url] = { head: p.head, column, number: p.number, repo: p.repo };
          this.ctx.notice(t('reviews.couldNotCheckOut', { number: p.number, repo: p.repo, error: String((e as Error).message).split('\n')[0].slice(0, 160) }));
        });
        news.push(t('reviews.newPR', { repo: p.repo, number: p.number, title: p.title, url: p.url, where: s.prs[p.url].dir ? path.relative(s.folder, s.prs[p.url].dir!) : t('reviews.promptNoWorktree') }));
        changed = true;
        continue;
      }
      if (was.head !== p.head) {
        const moved = was.dir ? await this.moveTo(was.dir, was.head, p) : false;
        news.push(t(moved || !was.dir ? 'reviews.newCommits' : 'reviews.newCommitsNotMoved', { repo: p.repo, number: p.number, before: was.head.slice(0, 7), now: p.head.slice(0, 7) }));
        was.head = p.head; changed = true;
      }
      if (column === 'review' && was.column !== 'review' && p.requested) news.push(t('reviews.requestedAgain', { repo: p.repo, number: p.number, author: p.author }));
      if (was.column !== column) { was.column = column; changed = true; }
    }
    // the PRs that left: merged, closed, or no longer asking for this review
    const gone = Object.entries(s.prs).filter(([url]) => !now.some(p => p.url === url));
    if (gone.length === Object.keys(s.prs).length && gone.length) return await this.retire(key, false) || changed;
    for (const [url, x] of gone) {
      if (x.dir && !(await this.removable(x.dir, x.head, false))) continue;
      if (x.dir) await this.removeDir(x.dir, x.repo);
      delete s.prs[url];
      news.push(t('reviews.prLeft', { repo: x.repo, number: x.number }));
      changed = true;
    }
    if (news.length) await this.ctx.tell(s.folder, t('reviews.update', { key: key, changes: news.map(n => `- ${n}`).join('\n') })).catch(() => false);
    return changed;
  }

  /** Moves a worktree to the PR's new head if nothing was changed or committed in it */
  private async moveTo(dir: string, head: string, p: ReviewPR): Promise<boolean> {
    if (!(await this.clean(dir, head))) return false;
    const room = this.repoRooms.find(r => r.repo === p.repo.toLowerCase());
    if (!room) return false;
    await this.ctx.git(room.path, ['fetch', '--no-tags', 'origin', `pull/${p.number}/head`]);
    await this.ctx.git(dir, ['checkout', '--detach', p.head]);
    return true;
  }
  private async clean(dir: string, head: string): Promise<boolean> {
    const status = (await this.ctx.git(dir, ['status', '--porcelain', '--untracked-files=no'])).trim();
    const own = (await this.ctx.git(dir, ['rev-list', '--count', `${head}..HEAD`]).catch(() => '0')).trim();
    return !status && (own === '0' || own === '');
  }

  private conversationIn(dir: string) {
    return this.ctx.sessions().some(x => x.state !== 'closed' && inside(dir, x.worktree ?? x.cwd));
  }
  /** Whether a worktree (or the review's folder) can go now: no open conversation in it and nothing changed in it (or
   *  the Overseer said so) */
  private async removable(dir: string, head: string, approved: boolean): Promise<boolean> {
    if (this.conversationIn(dir)) return false;
    if (approved || !existsSync(dir)) return true;
    return this.clean(dir, head).catch(() => true);
  }
  private async removeDir(dir: string, repo: string) {
    if (!existsSync(dir)) return;
    const room = this.repoRooms.find(r => r.repo === repo.toLowerCase());
    const loose = (await this.ctx.git(dir, ['status', '--porcelain', '-z', '--untracked-files=normal']).catch(() => '')).split('\0')
      .filter(l => l.startsWith('?? ')).map(l => path.join(dir, l.slice(3)));
    if (loose.length) await this.ctx.trash(loose);
    if (room) await this.ctx.git(room.path, ['worktree', 'remove', '--force', dir]);
    else rmSync(dir, { recursive: true, force: true });
  }

  /** Retires a review: its worktrees and its folder (what isn't git's goes to the Trash). With an open conversation it
   *  waits; with work left in a worktree it asks the Overseer once */
  private async retire(key: string, byHand: boolean): Promise<boolean> {
    const s = this.started[key];
    const approved = this.approved.includes(key);
    if (this.conversationIn(s.folder)) { if (byHand) this.ctx.notice(t('reviews.closeConversationFirst', { key: key })); return false; }
    const dirty: string[] = [];
    for (const x of Object.values(s.prs)) if (x.dir && !(await this.removable(x.dir, x.head, approved))) dirty.push(path.basename(x.dir));
    if (dirty.length) {
      const asked = `${key}|${dirty.join(',')}`;
      if (!byHand && this.asked.includes(asked)) return false;
      this.asked.push(asked);
      this.ctx.ask(t('reviews.workLeft', { key: key, where: dirty.join(', ') }), async () => {
        if (!this.started[key]) return;
        this.approved.push(key);
        await this.retire(key, true);
        this.save();
        this.publish();
      });
      return true;
    }
    for (const x of Object.values(s.prs)) if (x.dir) await this.removeDir(x.dir, x.repo);
    const loose = existsSync(s.folder) ? readdirSync(s.folder).map(n => path.join(s.folder, n)) : [];
    if (loose.length) await this.ctx.trash(loose);
    rmSync(s.folder, { recursive: true, force: true });
    delete this.started[key];
    this.approved = this.approved.filter(k => k !== key);
    this.ctx.notice(t('reviews.retired', { key: key }));
    return true;
  }

  /** Whether GitHub has answered yet (before, the board says it is reading) */
  get ready() { return this.read; }
}
