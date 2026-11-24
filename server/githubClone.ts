// Dig a room from GitHub (the Main Gate's «From GitHub…»): your repos and your organisations' (read-only, with the
// GitHub integration's token or the `gh` session), the ones already cloned under the repos root, and `git clone` into a
// new folder inside the root with your own git credentials (the game holds no token for it). The clone is a foreign
// repo: its folder is a trust boundary (sessions.ts, confianza()), so a trusted parent folder doesn't cover it.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gitEnvironment } from './gitEnv.ts';
import { remoteRepo } from './prReviews.ts';
import { t } from '../shared/language.ts';

export type RepoGitHub = { repo: string; name: string; isPrivate: boolean; archived: boolean; description: string; pushed: number };
export type Cloned = { path: string; corta: string; room?: string };   // corta: the path with ~ for the panel
export type Gh = (args: string[]) => Promise<string>;

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** owner/name from what was typed or pasted: `owner/name`, an https URL (with or without .git, a path after it) or
 *  an ssh one (git@github.com:owner/name.git) */
export function repoRef(text: string): string | undefined {
  const s = text.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(s)
    ?? /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s#?]+)$/i.exec(s)
    ?? /^([^/\s:]+)\/([^/\s:]+)$/.exec(s);
  if (!m) return;
  const owner = m[1], name = m[2].replace(/\.git$/i, '');
  return OWNER.test(owner) && NAME.test(name) && name !== '.' && name !== '..' ? `${owner}/${name}` : undefined;
}

const fromApi = (x: any): RepoGitHub | undefined => {
  const repo = typeof x?.full_name === 'string' ? repoRef(x.full_name) : undefined;
  if (!repo) return;
  return { repo, name: repo.split('/')[1], isPrivate: !!x.private, archived: !!x.archived, description: String(x.description ?? '').slice(0, 200), pushed: Date.parse(x.pushed_at) || 0 };
};

/** Your repos, as owner, collaborator or member of an organisation, most recently pushed first (a few pages: the
 *  rest are reached by typing owner/name) */
export async function listRepos(gh: Gh, pages = 5): Promise<RepoGitHub[]> {
  const page = async (p: number) => { const x = JSON.parse(await gh(['api', `/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100&page=${p}`])); return Array.isArray(x) ? x : []; };
  // the first page, and only if it's full the rest at once (each one takes a second or two)
  const first = await page(1);
  const batches = [first, ...(first.length < 100 ? [] : await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2))))];
  const out = new Map<string, RepoGitHub>();
  for (const x of batches.flat()) { const r = fromApi(x); if (r && !out.has(r.repo.toLowerCase())) out.set(r.repo.toLowerCase(), r); }
  return [...out.values()].sort((a, b) => b.pushed - a.pushed);
}

/** One repo, typed or pasted: confirms it exists and you can read it */
export async function repoInfo(gh: Gh, repo: string): Promise<RepoGitHub> {
  let x: any;
  try { x = JSON.parse(await gh(['api', `/repos/${repo}`])); }
  catch (e) { throw new Error(/404|not found/i.test((e as Error).message) ? t('server.githubRepoNotFound', { repo }) : (e as Error).message); }
  const r = fromApi(x);
  if (!r) throw new Error(t('server.githubRepoNotFound', { repo }));
  return r;
}

/** The `origin` of a repo's .git/config (owner/name in lower case), without running git on a foreign folder */
export function originOf(dir: string): string | undefined {
  let config: string;
  try { config = readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch { return; }
  const m = /^\s*\[remote\s+"origin"\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(config);
  const url = m && /^\s*url\s*=\s*(.+?)\s*$/m.exec(m[1]);
  return url ? remoteRepo(url[1]) : undefined;
}

/** Repos already on the Mac: the rooms' folders, and the root's folders and its group subfolders' (two levels) */
export function clonedRepos(root: string, rooms: { path?: string; name: string }[]): Map<string, Cloned> {
  const out = new Map<string, Cloned>(), home = os.homedir();
  const add = (repo: string | undefined, filePath: string, room?: string) => { if (repo && !out.has(repo)) out.set(repo, { path: filePath, corta: filePath.startsWith(home + path.sep) ? '~' + filePath.slice(home.length) : filePath, ...(room ? { room } : {}) }); };
  for (const s of rooms) if (s.path) add(originOf(s.path), s.path, s.name);
  const r = path.resolve(root);
  if (r === path.parse(r).root) return out;
  const children = (d: string) => { try { return readdirSync(d).filter(n => !n.startsWith('.')).map(n => path.join(d, n)).filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } }); } catch { return []; } };
  for (const a of children(r)) {
    if (existsSync(path.join(a, '.git'))) { add(originOf(a), a); continue; }
    if (r === home) continue;   // ~/Library, ~/Documents…: not groups of repos
    for (const b of children(a)) add(originOf(b), b);
  }
  return out;
}

/** The clone's folder: a new one inside the repos root (a group subfolder too), whose segments are plain names, not
 *  a room's and not inside another repo. Returns it resolved, or the reason it can't be */
export function cloneDestination(filePath: string, root: string, taken: string[]): string {
  const r = path.resolve(root), d = path.resolve(filePath);
  if (r === path.parse(r).root || !d.startsWith(r + path.sep)) throw new Error(t('server.newFoldersInsideRoot', { root: root }));
  const segments = path.relative(r, d).split(path.sep);
  if (segments.some(x => !/^[\w.\-áéíóúñ ]+$/i.test(x) || x === '.' || x === '..' || x.startsWith('.'))) throw new Error(t('server.cloneFolderBadName'));
  if (existsSync(d)) throw new Error(t('server.cloneFolderExists'));
  // a room's folder above it is fine: the root is Logistics' folder, and a group folder can be a wing
  if (taken.includes(d)) throw new Error(t('server.thatFolderAlreadyHasA'));
  for (let p = path.dirname(d); p !== r; p = path.dirname(p)) if (existsSync(path.join(p, '.git'))) throw new Error(t('server.cloneInsideRepo', { repo: path.basename(p) }));
  return d;
}

/** The URL to clone with: ssh if `gh` is set to it (git_protocol), https otherwise; git's own credentials do the rest */
export const cloneUrl = (repo: string, protocol?: string) => protocol?.trim() === 'ssh' ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`;

/** The last line of git's progress (it rewrites it with \r) and its percentage */
export function progressOf(output: string): { line: string; pct?: number } {
  const lines = output.split(/[\r\n]+/).map(l => l.replace(/^remote:\s*/, '').trim()).filter(Boolean);
  const line = lines[lines.length - 1] ?? '';
  const pct = /(\d{1,3})%/.exec(line)?.[1];
  return { line: line.slice(0, 160), pct: pct === undefined ? undefined : Math.min(100, Number(pct)) };
}

export type StateClone = { id: string; repo: string; path: string; state: 'cloning' | 'done' | 'error' | 'cancelled'; line: string; pct?: number; error?: string };

/** The clones in progress (one at a time per folder): started, read by the panel and cancelled */
export class Clones {
  private list = new Map<string, StateClone & { proc?: ChildProcess; output: string }>();
  constructor(private launch: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcess = (args, cwd, env) => spawn('git', args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] }), private onFinish: (c: StateClone) => void = () => {}) {}

  start(repo: string, target: string, url: string): StateClone {
    if ([...this.list.values()].some(c => c.state === 'cloning' && c.path === target)) throw new Error(t('server.cloneFolderExists'));
    mkdirSync(path.dirname(target), { recursive: true });
    // no prompts (they'd hang with nobody to answer), and no ssh host-key or password questions either
    const env = gitEnvironment({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) });
    const c: StateClone & { proc?: ChildProcess; output: string } = { id: randomUUID(), repo, path: target, state: 'cloning', line: t('server.cloneStarting'), output: '' };
    this.list.set(c.id, c);
    const proc = this.launch(['clone', '--progress', '--', url, target], path.dirname(target), env);
    c.proc = proc;
    proc.stderr?.on('data', (b: Buffer) => { c.output = (c.output + b.toString()).slice(-8000); const p = progressOf(c.output); if (p.line) { c.line = p.line; c.pct = p.pct; } });
    const end = (code: number | null, err?: Error) => {
      if (c.state !== 'cloning') return;
      c.proc = undefined;
      if (code === 0 && existsSync(target)) { c.state = 'done'; c.pct = 100; }
      else { c.state = 'error'; c.error = err?.message ?? explainClone(c.output); }
      this.onFinish(this.check(c.id)!);
    };
    proc.on('error', e => end(null, e));
    proc.on('close', code => end(code));
    return this.check(c.id)!;
  }
  check(id: string): StateClone | undefined {
    const c = this.list.get(id);
    if (!c) return;
    const { proc: _p, output: _s, ...x } = c;
    return x;
  }
  cancel(id: string) {
    const c = this.list.get(id);
    if (!c || c.state !== 'cloning') return false;
    c.state = 'cancelled'; c.proc?.kill('SIGTERM');   // git removes the half-made folder when it's interrupted
    return true;
  }
}

/** git's error, readable: the lines starting with fatal/error, or the last ones */
export function explainClone(output: string): string {
  const lines = output.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const bad = lines.filter(l => /^(fatal|error|ERROR)\b|denied|could not read/i.test(l));
  const text = (bad.length ? bad : lines.slice(-3)).join(' · ').slice(0, 400);
  if (/terminal prompts disabled|could not read Username|Authentication failed|Permission denied \(publickey\)|Host key verification failed/i.test(text)) return t('server.cloneNoCredentials', { detail: text });
  return text || t('server.cloneFailed');
}
