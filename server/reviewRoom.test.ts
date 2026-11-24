import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { ReviewRoom, type CtxReviewRoom } from './reviewRoom.ts';
import { hideWorktreesUnder, worktreeList } from './repos.ts';
import type { SessionSummary } from '../shared/protocol.ts';

const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@shelter.example', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@shelter.example' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV, stdio: 'pipe' }).trim();

/** An "origin" with a PR (refs/pull/12/head, as GitHub keeps it) and the room's clone of it */
function setup() {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'review-room-')));
  const origin = path.join(tmp, 'origin'), clone = path.join(tmp, 'web'), root = path.join(tmp, 'salas', 'review');
  execFileSync('git', ['init', '-q', '-b', 'main', origin], { env: ENV });
  writeFileSync(path.join(origin, 'a.txt'), 'one\n'); sh(origin, 'add', '.'); sh(origin, 'commit', '-qm', 'base');
  sh(origin, 'checkout', '-qb', 'ABC-1-thing');
  writeFileSync(path.join(origin, 'a.txt'), 'two\n'); sh(origin, 'commit', '-qam', 'pr');
  const head = sh(origin, 'rev-parse', 'HEAD');
  sh(origin, 'update-ref', 'refs/pull/12/head', head); sh(origin, 'checkout', '-q', 'main');
  execFileSync('git', ['clone', '-q', origin, clone], { env: ENV });
  return { tmp, origin, clone, root, head };
}
/** A new commit on the PR in the origin: its new head */
let pushes = 0;
function push(origin: string) {
  sh(origin, 'checkout', '-q', 'ABC-1-thing');
  writeFileSync(path.join(origin, 'a.txt'), `push ${++pushes}\n`); sh(origin, 'commit', '-qam', 'more');
  const head = sh(origin, 'rev-parse', 'HEAD');
  sh(origin, 'update-ref', 'refs/pull/12/head', head); sh(origin, 'checkout', '-q', 'main');
  return head;
}
const node = (head: string, o: any = {}) => ({ number: 12, url: 'https://github.com/acme/web/pull/12', title: 'ABC-1 Thing', isDraft: false, updatedAt: '2026-11-20T10:00:00Z',
  headRefName: 'ABC-1-thing', headRefOid: head, baseRefName: 'main', author: { login: 'ana' }, repository: { nameWithOwner: 'acme/web' },
  reviewRequests: { nodes: [] }, latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [] }, ...o });

function room(s: ReturnType<typeof setup>) {
  const told: string[] = [], opened: string[] = [], asked: { text: string; yes: () => Promise<void> }[] = [], notices: string[] = [];
  let answer: any = { data: { viewer: { login: 'me' }, requested: { nodes: [node(s.head)] }, reviewed: { nodes: [] } } };
  let sessions: SessionSummary[] = [];
  const ctx: CtxReviewRoom = {
    connection: async () => ({ real: true }),
    query: async () => answer,
    rooms: async () => [{ id: 'web', path: s.clone, repo: 'acme/web' }],
    root: () => s.root,
    git: async (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV, stdio: 'pipe' }),
    sessions: () => sessions,
    open: async (folder, text) => { opened.push(text); return 'sess-1'; },
    tell: async (folder, text) => { told.push(text); return true; },
    jira: async () => ({ title: 'The thing', status: 'In review', description: 'Do the thing' }),
    trash: async paths => { for (const p of paths) rmSync(p, { recursive: true, force: true }); },
    ask: (text, yes) => { asked.push({ text, yes }); },
    notice: text => { notices.push(text); },
    changed: () => {},
  };
  const r = new ReviewRoom(s.tmp, ctx);
  return { r, told, opened, asked, notices, set: (a: any) => { answer = a; }, setSessions: (x: SessionSummary[]) => { sessions = x; } };
}
const empty = { data: { viewer: { login: 'me' }, requested: { nodes: [] }, reviewed: { nodes: [] } } };

describe('ReviewRoom', () => {
  it('lists a requested PR without touching anything until the Overseer opens it', async () => {
    const s = setup(), x = room(s);
    await x.r.poll();
    expect(x.r.reviews().map(v => [v.key, v.column, v.started])).toEqual([['ABC-1', 'review', false]]);
    expect(existsSync(s.root)).toBe(false);
  });

  it('opening it checks out each PR detached at its head, hidden from the repo room, and starts one conversation with the task', async () => {
    const s = setup(), x = room(s);
    await x.r.poll();
    expect(await x.r.open('ABC-1')).toBe('sess-1');
    const dir = path.join(s.root, 'ABC-1', 'web-12');
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(s.head);
    expect(sh(dir, 'branch', '--show-current')).toBe('');
    expect(x.opened[0]).toContain('acme/web#12');
    expect(x.opened[0]).toContain('web-12');
    expect(x.opened[0]).toContain('Do the thing');
    hideWorktreesUnder([s.root]);
    expect((await worktreeList(s.clone)).map(w => w.path)).toEqual([s.clone]);
    hideWorktreesUnder([]);
    expect((await worktreeList(s.clone)).length).toBe(2);
    expect(x.r.startedReviews()).toEqual([{ key: 'ABC-1', folder: path.join(s.root, 'ABC-1'), title: 'ABC-1 Thing', repos: ['acme/web'] }]);
  });

  it('follows new commits when nothing was changed in the copy, and says so when something was', async () => {
    const s = setup(), x = room(s);
    await x.r.poll(); await x.r.open('ABC-1');
    const dir = path.join(s.root, 'ABC-1', 'web-12');
    const second = push(s.origin);
    x.set({ data: { viewer: { login: 'me' }, requested: { nodes: [node(second)] }, reviewed: { nodes: [] } } });
    await x.r.poll();
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(second);
    expect(x.told.at(-1)).toContain(second.slice(0, 7));
    writeFileSync(path.join(dir, 'a.txt'), 'mine\n');
    const third = push(s.origin);
    x.set({ data: { viewer: { login: 'me' }, requested: { nodes: [node(third)] }, reviewed: { nodes: [] } } });
    await x.r.poll();
    expect(sh(dir, 'rev-parse', 'HEAD')).toBe(second);
    expect(x.told.length).toBe(2);
  });

  it('a verdict moves the card; a request made again goes back to review and tells the conversation', async () => {
    const s = setup(), x = room(s);
    await x.r.poll(); await x.r.open('ABC-1');
    x.set({ data: { viewer: { login: 'me' }, requested: { nodes: [] }, reviewed: { nodes: [node(s.head, { latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'me' } }] } })] } } });
    await x.r.poll();
    expect(x.r.reviews()[0].column).toBe('changes');
    x.set({ data: { viewer: { login: 'me' }, requested: { nodes: [node(s.head, { latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'me' } }] } })] }, reviewed: { nodes: [] } } });
    await x.r.poll();
    expect(x.r.reviews()[0].column).toBe('review');
    expect(x.told.at(-1)).toContain('ana');
  });

  it('retires when no PR is left: waits for an open conversation, asks once with changes left, otherwise removes everything', async () => {
    const s = setup(), x = room(s);
    await x.r.poll(); await x.r.open('ABC-1');
    const folder = path.join(s.root, 'ABC-1'), dir = path.join(folder, 'web-12');
    x.setSessions([{ id: 'sess-1', state: 'idle', cwd: folder } as SessionSummary]);
    x.set(empty);
    await x.r.poll();
    expect(existsSync(dir)).toBe(true);
    x.setSessions([]);
    writeFileSync(path.join(dir, 'a.txt'), 'mine\n');
    await x.r.poll(); await x.r.poll();
    expect(x.asked.length).toBe(1);
    expect(existsSync(dir)).toBe(true);
    await x.asked[0].yes();
    expect(existsSync(folder)).toBe(false);
    expect(sh(s.clone, 'worktree', 'list')).not.toContain('web-12');
    expect(x.r.startedReviews()).toEqual([]);
  });

  it('a failed read never retires anything', async () => {
    const s = setup(), x = room(s);
    await x.r.poll(); await x.r.open('ABC-1');
    x.set({ errors: [{ message: 'rate limited' }] });
    await expect(x.r.poll()).rejects.toThrow('rate limited');
    expect(existsSync(path.join(s.root, 'ABC-1', 'web-12'))).toBe(true);
  });

  it('«Done with this review» removes it now, and the PR stays on the board', async () => {
    const s = setup(), x = room(s);
    await x.r.poll(); await x.r.open('ABC-1');
    await x.r.finish('ABC-1');
    expect(existsSync(path.join(s.root, 'ABC-1'))).toBe(false);
    expect(x.r.reviews().map(v => [v.key, v.started])).toEqual([['ABC-1', false]]);
  });
});
