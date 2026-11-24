// Cliente de git del refugio (sala de Control de Versiones): lo que hace un cliente de git de barra lateral, con el
// git de tu máquina. Estado del repo, diffs, preparar y quitar (archivos, bloques o líneas sueltas), descartar,
// commits (y enmendar), historial con su grafo, ramas, cajón (stash) y sincronizar con el remoto.
// Solo sobre carpetas del refugio (las salas y sus worktrees): la ruta la valida quien llama (`rutaPermitida`).
// Nada pregunta por la terminal (GIT_TERMINAL_PROMPT=0) ni abre un editor (GIT_EDITOR=true): si git necesita algo
// que no se le puede dar desde aquí, falla con su mensaje y el cliente lo enseña.
// La matriz de contribuciones y los pull requests salen de GitHub con `gh`, solo si GitHub está conectado en la cámara
// acorazada (con su token o con la sesión de `gh`); si no, DEMO, como el resto de integraciones. Conectado pero sin
// `gh`, la matriz se cuenta con tus commits en los repos del refugio.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openInEditor } from './open.ts';
import { gitEnvironment } from './gitEnv.ts';
import type { PRBoard } from '../shared/board.ts';
import type { ReviewLedger } from '../shared/reviewCount.ts';
import { dependenciesInText } from '../shared/deploy.ts';
import { t } from '../shared/language.ts';
import { inDemoLanguage } from './integrations/demoEnglish.ts';

const environment = () => gitEnvironment({ GIT_EDITOR: 'true', GIT_PAGER: 'cat', GCM_INTERACTIVE: 'never' });
const MAX_DIFF = 1_500_000;   // un diff más grande se corta (y se avisa)
const MAX_FILES = 3000;

interface Output { out: string; err: string; code: number }
function run(cwd: string, args: string[], o: { input?: string; timeout?: number; codes?: number[] } = {}): Promise<Output> {
  return new Promise((ok, fail) => {
    const p = spawn('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args], { env: environment(), stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = []; let length = 0;
    p.stdout.on('data', (b: Buffer) => { length += b.length; if (length < 64 * 1024 * 1024) out.push(b); });
    p.stderr.on('data', (b: Buffer) => err.push(b));
    const timer = setTimeout(() => { p.kill('SIGTERM'); }, o.timeout ?? 20_000);
    p.on('error', e => { clearTimeout(timer); fail(e); });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      const r = { out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8').trim(), code: code ?? -1 };
      if (signal) return fail(new Error(t('server.gitTookTooLongAnd', { args: args[0] })));
      if (r.code !== 0 && !(o.codes ?? []).includes(r.code)) return fail(new Error(cleanError(r.err || r.out) || `git ${args[0]} ha fallado (${r.code}).`));
      ok(r);
    });
    if (o.input !== undefined) p.stdin.end(o.input); else p.stdin.end();
  });
}
const git = async (cwd: string, args: string[], timeout?: number) => (await run(cwd, args, { timeout })).out;
const cleanError = (t: string) => t.split('\n').filter(l => !/^hint:/.test(l)).join('\n').trim().slice(0, 1200);

// ---------------------------------------------------------------- estado
export type Letter = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';
export interface FileGit { path: string; origin?: string; letter: Letter }
export interface StateGit {
  path: string; branch: string | null; head: string | null; upstream: string | null; ahead: number; behind: number;
  staged: FileGit[]; changes: FileGit[]; conflicts: FileGit[];
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; truncated: boolean; lastMessage: string; remote: string[]; drawer: number;
}

export async function state(filePath: string): Promise<StateGit> {
  const [st, message, remote, drawer, gitDir] = await Promise.all([
    run(filePath, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']).then(r => r.out),
    git(filePath, ['log', '-1', '--format=%B']).catch(() => ''),
    git(filePath, ['remote']).catch(() => ''),
    git(filePath, ['stash', 'list', '--format=%gd']).catch(() => ''),
    git(filePath, ['rev-parse', '--absolute-git-dir']).catch(() => ''),
  ]);
  const e: StateGit = { path: filePath, branch: null, head: null, upstream: null, ahead: 0, behind: 0, staged: [], changes: [], conflicts: [], operation: null, truncated: false, lastMessage: message.trim(), remote: remote.split('\n').filter(Boolean), drawer: drawer.split('\n').filter(Boolean).length };
  const regs = st.split('\0');
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i]; if (!r) continue;
    if (r.startsWith('# branch.oid ')) { const v = r.slice(13); e.head = v === '(initial)' ? null : v; }
    else if (r.startsWith('# branch.head ')) { const v = r.slice(14); e.branch = v === '(detached)' ? null : v; }
    else if (r.startsWith('# branch.upstream ')) e.upstream = r.slice(18);
    else if (r.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(r); if (m) { e.ahead = +m[1]; e.behind = +m[2]; } }
    else if (r[0] === '?') e.changes.push({ path: r.slice(2), letter: '?' });
    else if (r[0] === 'u') e.conflicts.push({ path: r.split(' ').slice(10).join(' '), letter: 'U' });
    else if (r[0] === '1' || r[0] === '2') {
      const parts = r.split(' '), xy = parts[1];
      const file = parts.slice(r[0] === '1' ? 8 : 9).join(' ');
      const origin = r[0] === '2' ? regs[++i] : undefined;
      if (xy[0] !== '.') e.staged.push({ path: file, letter: xy[0] as Letter, ...(origin ? { origin } : {}) });
      if (xy[1] !== '.') e.changes.push({ path: file, letter: xy[1] as Letter });
    }
  }
  for (const l of [e.staged, e.changes]) if (l.length > MAX_FILES) { l.length = MAX_FILES; e.truncated = true; }
  if (gitDir.trim()) {
    const d = gitDir.trim();
    e.operation = existsSync(path.join(d, 'rebase-merge')) || existsSync(path.join(d, 'rebase-apply')) ? 'rebase' : existsSync(path.join(d, 'MERGE_HEAD')) ? 'merge' : existsSync(path.join(d, 'CHERRY_PICK_HEAD')) ? 'cherry-pick' : existsSync(path.join(d, 'REVERT_HEAD')) ? 'revert' : null;
  }
  return e;
}

// ---------------------------------------------------------------- diffs
export interface Diff { text: string; binary: boolean; truncated: boolean }
function diffOf(text: string): Diff {
  const truncated = text.length > MAX_DIFF;
  return { text: truncated ? text.slice(0, MAX_DIFF) : text, binary: /^Binary files .* differ$/m.test(text) || /^GIT binary patch$/m.test(text), truncated };
}
const safeFile = (a: unknown) => { const s = String(a ?? ''); if (!s || s.includes('\0') || path.isAbsolute(s) || s.split('/').includes('..')) throw new Error(t('server.invalidFilePath')); return s; };

export async function diff(filePath: string, d: { file: string; origin?: string; prepared?: boolean; withoutFollow?: boolean; context?: number }): Promise<Diff> {
  const file = safeFile(d.file), u = `-U${Math.max(0, Math.min(100_000, Number(d.context) || 3))}`;
  if (d.withoutFollow) return diffOf((await run(filePath, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', u, '--', '/dev/null', file], { codes: [1] })).out);
  const paths = d.origin ? ['--', safeFile(d.origin), file] : ['--', file];
  return diffOf(await git(filePath, ['diff', ...(d.prepared ? ['--cached', '-M'] : []), '--no-ext-diff', '--no-textconv', u, ...paths]));
}

// ---------------------------------------------------------------- preparar, quitar, descartar
const batch = async (filePath: string, args: string[], files: string[]) => { for (let i = 0; i < files.length; i += 200) await git(filePath, [...args, '--', ...files.slice(i, i + 200)], 60_000); };

export async function stage(filePath: string, files: string[]) { await batch(filePath, ['add', '-A'], files.map(safeFile)); }
export async function remove(filePath: string, files: string[]) {
  const hasHead = await git(filePath, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  await batch(filePath, hasHead ? ['restore', '--staged'] : ['rm', '--cached', '-r', '-q'], files.map(safeFile));
}
/** Descarta cambios de la copia de trabajo: los de archivos seguidos vuelven a lo preparado; los nuevos se borran. */
export async function discard(filePath: string, files: string[], withoutFollow: string[] = []) {
  if (files.length) await batch(filePath, ['restore', '--worktree'], files.map(safeFile));
  if (withoutFollow.length) await batch(filePath, ['clean', '-f', '-q'], withoutFollow.map(safeFile));
}
/** Aplica un trozo de diff (bloques o líneas elegidas, armado por el cliente) al índice o a la copia de trabajo. */
export async function applyPatch(filePath: string, patch: string, mode: 'preparar' | 'quitar' | 'descartar') {
  if (!patch.startsWith('diff --git ') || patch.length > MAX_DIFF) throw new Error(t('server.invalidPatch'));
  const args = ['apply', '--recount', '--whitespace=nowarn', ...(mode === 'descartar' ? ['--reverse'] : ['--cached', ...(mode === 'quitar' ? ['--reverse'] : [])]), '-'];
  await run(filePath, args, { input: patch.endsWith('\n') ? patch : patch + '\n' });
}

// ---------------------------------------------------------------- commits
export async function commit(filePath: string, d: { message: string; amend?: boolean; all?: boolean }) {
  const message = String(d.message ?? '').trim();
  if (!message && !d.amend) throw new Error(t('server.writeACommitMessage'));
  if (d.all) await git(filePath, ['add', '-A'], 60_000);
  const args = ['commit', ...(message ? ['-m', message] : ['--no-edit']), ...(d.amend ? ['--amend'] : [])];
  const r = await run(filePath, args, { timeout: 180_000 });   // los ganchos (lint, tests) pueden tardar
  return { hash: (await git(filePath, ['rev-parse', '--short', 'HEAD'])).trim(), output: (r.out + '\n' + r.err).trim().slice(-2000) };
}
/** Deshace el último commit y deja sus cambios preparados (como «Deshacer el último commit» de los editores). */
export async function undoCommit(filePath: string) {
  const parent = await git(filePath, ['rev-parse', '--verify', '-q', 'HEAD~1']).then(() => true, () => false);
  if (!parent) throw new Error(t('server.thisIsTheRepoS'));
  const message = (await git(filePath, ['log', '-1', '--format=%B'])).trim();
  await git(filePath, ['reset', '--soft', 'HEAD~1']);
  return { message };
}

// ---------------------------------------------------------------- historial
export interface CommitGit { hash: string; parents: string[]; author: string; email: string; date: number; subject: string; refs: string[] }
export async function history(filePath: string, d: { all?: boolean; n?: number; since?: number }): Promise<{ commits: CommitGit[]; more: boolean }> {
  const n = Math.max(20, Math.min(1000, Number(d.n) || 300)), jump = Math.max(0, Number(d.since) || 0);
  const hasUp = await git(filePath, ['rev-parse', '--verify', '-q', '@{upstream}']).then(() => true, () => false);
  const refs = d.all ? ['--branches', '--remotes', '--tags'] : ['HEAD', ...(hasUp ? ['@{upstream}'] : [])];
  const out = await git(filePath, ['log', '--topo-order', '--decorate=full', `--skip=${jump}`, '-n', String(n + 1), '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%D%x1e', ...refs, '--']).catch(e => { if (/does not have any commits|bad default revision|unknown revision/i.test(e.message)) return ''; throw e; });
  const commits = out.split('\x1e').map(l => l.replace(/^\n/, '')).filter(Boolean).map(l => {
    const [hash, parents, author, email, date, subject, decor] = l.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], author, email, date: Number(date) * 1000, subject, refs: (decor ?? '').split(', ').map(x => x.trim()).filter(Boolean).map(x => x.replace('HEAD -> ', 'HEAD → ').replace(/refs\/heads\//g, '').replace(/refs\/remotes\//g, '').replace(/^tag: refs\/tags\//, 'tag: ')).filter(x => !/\/HEAD$/.test(x)) };
  });
  return { commits: commits.slice(0, n), more: commits.length > n };
}
const hashSafe = (h: unknown) => { const s = String(h ?? ''); if (!/^[0-9a-f]{4,64}$/i.test(s)) throw new Error(t('server.invalidCommit')); return s; };
export async function detailCommit(filePath: string, hash: string) {
  const h = hashSafe(hash);
  const [header, numstat, names] = await Promise.all([
    git(filePath, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%cn%x1f%ct%x1f%B', h]),
    git(filePath, ['show', '--format=', '--numstat', '-M', '--first-parent', '-m', h]),
    git(filePath, ['show', '--format=', '--name-status', '-M', '--first-parent', '-m', h]),
  ]);
  const [hash2, parents, author, email, date, , , body] = header.split('\x1f');
  const stats = numstat.split('\n').filter(Boolean).map(l => { const [a, b] = l.split('\t'); return { more: a === '-' ? null : +a, deletions: b === '-' ? null : +b }; });
  const files = names.split('\n').filter(Boolean).map((l, i) => { const p = l.split('\t'); const letter = p[0][0] as Letter; return { letter, path: p[p.length - 1], ...(p.length > 2 ? { origin: p[1] } : {}), ...stats[i] }; });
  return { hash: hash2, parents: parents ? parents.split(' ') : [], author, email, date: Number(date) * 1000, message: (body ?? '').trim(), files };
}
export async function diffCommit(filePath: string, hash: string, file: string, origin?: string) {
  const h = hashSafe(hash), a = safeFile(file);
  const paths = origin ? ['--', safeFile(origin), a] : ['--', a];
  const hasParent = await git(filePath, ['rev-parse', '--verify', '-q', h + '^']).then(() => true, () => false);
  return diffOf(hasParent ? await git(filePath, ['diff', '-M', '--no-ext-diff', '--no-textconv', h + '^', h, ...paths]) : await git(filePath, ['show', '--format=', '--no-ext-diff', '--no-textconv', h, ...paths]));
}

// ---------------------------------------------------------------- ramas y cajón
export async function branches(filePath: string) {
  const out = await git(filePath, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)%1f%(contents:subject)', 'refs/heads', 'refs/remotes']);
  return out.split('\n').filter(Boolean).map(l => {
    const [ref, name, hash, upstream, track, date, head, subject] = l.split('\x1f');
    return { name, remote: ref.startsWith('refs/remotes/'), hash, upstream: upstream || undefined, ahead: +(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: +(/behind (\d+)/.exec(track)?.[1] ?? 0), lost: /gone/.test(track), date: Number(date) * 1000, current: head === '*', subject };
  }).filter(r => !(r.remote && r.name.endsWith('/HEAD')) && r.name !== 'origin');
}
const branchName = async (filePath: string, n: unknown) => { const s = String(n ?? '').trim(); if (!s || s.startsWith('-')) throw new Error(t('server.invalidBranchName')); await git(filePath, ['check-ref-format', '--branch', s]).catch(() => { throw new Error(t('server.isNotAValidBranch', { v: s })); }); return s; };
export async function switchBranch(filePath: string, d: { branch: string; remote?: boolean }) {
  // una remota sin rama local: se crea la local que la sigue (lo que hace `git switch` con su nombre corto)
  const branch = await branchName(filePath, d.branch);
  if (d.remote) { const local = branch.split('/').slice(1).join('/'); const exists = await git(filePath, ['rev-parse', '--verify', '-q', 'refs/heads/' + local]).then(() => true, () => false); await git(filePath, exists ? ['switch', local] : ['switch', '--track', branch], 60_000); }
  else await git(filePath, ['switch', branch], 60_000);
}
export async function createBranch(filePath: string, d: { name: string }) { await git(filePath, ['switch', '-c', await branchName(filePath, d.name)]); }
export async function deleteBranch(filePath: string, d: { name: string; force?: boolean }) { await git(filePath, ['branch', d.force ? '-D' : '-d', await branchName(filePath, d.name)]); }

export async function drawer(filePath: string) {
  const out = await git(filePath, ['stash', 'list', '--format=%gd%x1f%s%x1f%ct']);
  return out.split('\n').filter(Boolean).map(l => { const [ref, subject, date] = l.split('\x1f'); return { ref, subject, date: Number(date) * 1000 }; });
}
const refDrawer = (r: unknown) => { const s = String(r ?? ''); if (!/^stash@\{\d+\}$/.test(s)) throw new Error(t('server.invalidStashEntry')); return s; };
export async function saveInDrawer(filePath: string, d: { message?: string }) { await git(filePath, ['stash', 'push', '-u', ...(d.message ? ['-m', String(d.message).slice(0, 200)] : [])], 60_000); }
export async function takeOfDrawer(filePath: string, d: { ref: string; keep?: boolean }) { await git(filePath, ['stash', d.keep ? 'apply' : 'pop', refDrawer(d.ref)], 60_000); }
export async function throwOfDrawer(filePath: string, d: { ref: string }) { await git(filePath, ['stash', 'drop', refDrawer(d.ref)]); }

// ---------------------------------------------------------------- fusiones y rebases a medias
export async function abort(filePath: string) {
  const op = (await state(filePath)).operation;
  if (!op) throw new Error(t('server.thereIsNoMergeOr'));
  await git(filePath, [op, '--abort'], 60_000);
}
export async function continueLast(filePath: string) {
  const op = (await state(filePath)).operation;
  if (!op || op === 'merge') throw new Error(op === 'merge' ? t('server.git.mergeEndsWithCommit') : t('server.git.nothingInProgress'));
  await run(filePath, [op, '--continue'], { timeout: 180_000 });
}

/** Abre un archivo del repo en tu editor (Cursor o VS Code; si no, el de texto de macOS: nunca la app por defecto de su
 *  tipo, que para un .command o un .app de un repo clonado sería ejecutarlo; ver open.ts). */
export async function openFile(filePath: string, file: string) {
  const f = path.join(filePath, safeFile(file));
  if (!existsSync(f)) throw new Error(t('server.thatFileIsNoLonger'));
  await openInEditor(filePath, f);
}

// ---------------------------------------------------------------- remoto (solo cuando lo pide el Supervisor con su botón)
export async function sync(filePath: string, what: 'fetch' | 'pull' | 'push' | 'sync') {
  const e = await state(filePath);
  if (!e.remote.length) throw new Error(t('server.thisRepoHasNoRemote'));
  const length = 180_000;
  const push = async () => {
    if (!e.branch) throw new Error(t('server.youAreNotOnAny'));
    if (e.upstream) return (await run(filePath, ['push'], { timeout: length })).err;
    const remote = e.remote.includes('origin') ? 'origin' : e.remote[0];
    return (await run(filePath, ['push', '-u', remote, e.branch], { timeout: length })).err;
  };
  const pull = async () => (await run(filePath, ['pull', '--no-edit'], { timeout: length })).out;
  let output = '';
  if (what === 'fetch') output = (await run(filePath, ['fetch', '--all', '--prune'], { timeout: length })).err;
  else if (what === 'pull') output = await pull();
  else if (what === 'push') output = await push();
  else { if (e.upstream && e.behind) output += await pull(); if (!e.upstream || e.ahead || !e.behind) output += '\n' + await push(); }
  return { output: output.trim().slice(-2000) };
}

// ---------------------------------------------------------------- GitHub: matriz de contribuciones y pull requests
export interface DayContrib { date: string; n: number; level: number }
export interface DataGitHub { source: 'github' | 'local'; demo?: boolean; user?: string; name?: string; total: number; days: DayContrib[]; prs?: { mine: PR[]; toReview: PR[]; nMine: number; nReview: number }; error?: string; ts: number }
interface PR { number: number; title: string; url: string; repo: string; draft: boolean; updated: number; review?: string }

const LEVEL: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
export const QUERY = `query {
  viewer { login name contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } }
  mine: search(query: "is:open is:pr author:@me archived:false sort:updated-desc", type: ISSUE, first: 12) { issueCount nodes { ...pr } }
  toReview: search(query: "is:open is:pr review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 12) { issueCount nodes { ...pr } }
}
fragment pr on PullRequest { number title url isDraft updatedAt reviewDecision repository { nameWithOwner } }`;

export function gh(args: string[], token?: string, timeout = 20_000): Promise<string> {
  const bin = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
  const attempt = (i: number): Promise<string> => new Promise((ok, fail) => execFile(bin[i], args, { env: token ? { ...environment(), GH_TOKEN: token } : environment(), timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT' && i + 1 < bin.length) return attempt(i + 1).then(ok, fail);
    if (err) return fail(new Error(String(errOut || err.message).trim()));
    ok(String(out));
  }));
  return attempt(0);
}

// Sin GitHub conectado: una matriz y unos PR inventados (estables por día), marcados DEMO
export function githubDemo(): DataGitHub {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 364 - start.getDay());
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days: DayContrib[] = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const h = Math.abs(Math.sin(d.getTime() / 86_400_000 * 12.9898) * 43758.5453) % 1, weekend = d.getDay() === 0 || d.getDay() === 6;
    const n = h < (weekend ? 0.75 : 0.25) ? 0 : Math.round((h - 0.2) * (weekend ? 4 : 14));
    days.push({ date: day(d), n, level: !n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 8 ? 3 : 4 });
  }
  const pr = (number: number, title: string, repo: string, hours: number, review?: string): { number: number; title: string; url: string; repo: string; draft: boolean; updated: number; review?: string } =>
    ({ number, title, url: `https://github.com/pulls#demo-${number}`, repo, draft: false, updated: Date.now() - hours * 3600_000, review });
  return inDemoLanguage({
    source: 'github', demo: true, user: 'supervisor-demo', name: 'Supervisor (DEMO)', total: days.reduce((s, d) => s + d.n, 0), days, ts: Date.now(),
    prs: { mine: [pr(42, 'Rutas con parámetros opcionales', 'refugio/express', 3, 'REVIEW_REQUIRED'), pr(17, 'El reintento respeta el timeout', 'refugio/requests', 26, 'APPROVED')], toReview: [pr(8, 'Buscar dentro de archivos comprimidos', 'refugio/ripgrep', 5)], nMine: 2, nReview: 1 },
    error: t('server.git.demoProfile'),
  });
}

// Parses QUERY's response: its aliases `mine` and `toReview` are the keys read here
export function githubOfGraphQL(j: any): DataGitHub {
  const v = j.data.viewer, cal = v.contributionsCollection.contributionCalendar;
  const pr = (n: any): PR => ({ number: n.number, title: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? '', draft: !!n.isDraft, updated: Date.parse(n.updatedAt), review: n.reviewDecision ?? undefined });
  return {
    source: 'github', user: v.login, name: v.name ?? undefined, total: cal.totalContributions, ts: Date.now(),
    days: cal.weeks.flatMap((w: any) => w.contributionDays.map((d: any) => ({ date: d.date, n: d.contributionCount, level: LEVEL[d.contributionLevel] ?? 0 }))),
    prs: { mine: (j.data.mine?.nodes ?? []).filter((n: any) => n?.number).map(pr), toReview: (j.data.toReview?.nodes ?? []).filter((n: any) => n?.number).map(pr), nMine: j.data.mine?.issueCount ?? 0, nReview: j.data.toReview?.issueCount ?? 0 },
  };
}

let cache: DataGitHub | null = null; let cacheOf = ''; let asking: Promise<DataGitHub> | null = null;
export function github(paths: string[], force = false, connection: { real: boolean; off?: boolean; token?: string } = { real: false }): Promise<DataGitHub> {
  if (connection.off) return localContributions(paths);   // GitHub apagado: tus commits locales, nada de prueba
  if (!connection.real) return Promise.resolve(githubDemo());
  const from = connection.token ? 'token' : 'gh';
  if (cache && cacheOf === from && !force && Date.now() - cache.ts < 15 * 60_000) return Promise.resolve(cache);
  if (asking) return asking;
  asking = (async () => {
    cacheOf = from;
    try {
      cache = githubOfGraphQL(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + QUERY], connection.token)));
    } catch (err) {
      cache = { ...(await localContributions(paths)), error: t('server.git.withoutGitHub', { error: String((err as Error).message).split('\n')[0].slice(0, 160) }), ts: Date.now() };
    }
    return cache;
  })().finally(() => { asking = null; });
  return asking;
}

// ---------------------------------------------------------------- PR del tablero de Logística
// Tus PR abiertos y los cerrados o fusionados en las dos últimas semanas, con su rama (de ahí sale la tarea de Jira),
// la revisión y el estado de la CI del último commit. Sin GitHub conectado, unos inventados (DEMO) que cruzan con las
// tareas de demoPanelJira().
const SEARCH_PRS = (q: string, n: number) => `query {
  prs: search(query: "${q}", type: ISSUE, first: ${n}) { nodes { ... on PullRequest {
    number title body url isDraft state updatedAt mergedAt reviewDecision mergeable headRefName headRefOid baseRefName repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
}`;
const QUERY_PRS = (since: string) => SEARCH_PRS(`is:pr author:@me archived:false updated:>=${since} sort:updated-desc`, 60);
export function prsOfGitHub(j: any): PRBoard[] {
  return (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRBoard => ({
    number: n.number, title: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? '', branch: n.headRefName ?? '',
    state: n.state === 'MERGED' ? 'fusionado' : n.state === 'CLOSED' ? 'cerrado' : n.isDraft ? 'borrador' : 'abierto',
    review: n.reviewDecision ?? undefined, checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? undefined, updated: Date.parse(n.updatedAt),
    ...(n.mergedAt ? { mergedAt: Date.parse(n.mergedAt) } : {}),
    conflicts: n.mergeable === 'CONFLICTING' ? true : n.mergeable === 'MERGEABLE' ? false : undefined,
    base: n.baseRefName ?? undefined, head: n.headRefOid ?? undefined, dependencies: dependenciesInText(`${n.title ?? ''}\n${n.body ?? ''}`, n.repository?.nameWithOwner ?? ''),
  }));
}
export function demoPRsBoard(): PRBoard[] {
  const pr = (number: number, title: string, repo: string, branch: string, state: PRBoard['state'], hours: number, review?: PRBoard['review'], checks?: PRBoard['checks']): PRBoard =>
    ({ number, title, url: `https://github.com/pulls#demo-${number}`, repo, branch, state, review, checks, updated: Date.now() - hours * 3600_000 });
  return inDemoLanguage([
    pr(42, 'Rutas con parámetros opcionales', 'refugio/express', 'ref-212-barra-final', 'abierto', 3, 'REVIEW_REQUIRED', 'PENDING'),
    pr(51, 'Buscar en .zip y .tar.gz', 'refugio/ripgrep', 'feature/REF-240-comprimidos', 'abierto', 5, 'APPROVED', 'SUCCESS'),
    pr(17, 'REF-236 Reutilizar las conexiones de la sesión', 'refugio/requests', 'sesiones-persistentes', 'abierto', 20, 'CHANGES_REQUESTED', 'FAILURE'),
    pr(18, 'REF-236 Pruebas de la sesión con proxy', 'refugio/requests', 'ref-236-pruebas', 'borrador', 22, undefined, 'SUCCESS'),
    pr(39, 'Nuevo router: rutas anidadas', 'refugio/express', 'REF-219-router', 'fusionado', 26),
    pr(9, 'Ordenar la lista por temas', 'refugio/awesome', 'ordenar-temas', 'abierto', 8, 'REVIEW_REQUIRED', 'SUCCESS'),
  ].map(p => ({ ...p, base: p.number === 18 ? 'sesiones-persistentes' : 'main', dependencies: p.number === 42 ? ['refugio/express#39', 'refugio/ripgrep#51'] : [],
    ...(p.number === 17 ? { ledger: { unresolved: 3, outdated: 1, unansweredSummaries: 1 } } : {}), ...(p.number === 9 ? { conflicts: true } : {}) })));   // #18 stacked on #17; #42 waits for #39 and #51; #17 with reviews to answer; #9 with conflicts
}
export async function prsBoard(connection: { real: boolean; off?: boolean; token?: string }): Promise<{ prs: PRBoard[]; demo?: boolean; error?: string }> {
  if (connection.off) return { prs: [], error: t('server.git.connectGitHub') };
  if (!connection.real) return { prs: demoPRsBoard(), demo: true, error: t('server.git.demoPRs') };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  try { return { prs: prsOfGitHub(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + QUERY_PRS(since)], connection.token))) }; }
  catch (err) { return { prs: [], error: t('server.git.couldNotReadPRs', { error: String((err as Error).message).split('\n')[0].slice(0, 160) }) }; }
}

// todos tus PR sin fusionar (para organizar las salas por tareas: server/organize.ts), con su base y descripción
const OPEN_QUERY = SEARCH_PRS('is:pr is:open author:@me archived:false sort:updated-desc', 100);
export async function prsOpen(connection: { real: boolean; off?: boolean; token?: string }): Promise<{ prs: PRBoard[]; demo?: boolean }> {
  if (connection.off) return { prs: [] };
  if (!connection.real) return { prs: demoPRsBoard().filter(p => p.state === 'abierto' || p.state === 'borrador'), demo: true };
  return { prs: prsOfGitHub(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + OPEN_QUERY], connection.token))) };
}

/** Your PRs that name a task (title or description), merged or not and of any age: the pre-flight of a task that
 *  landed weeks ago, beyond the board's two weeks */
export async function prsOfTask(connection: { real: boolean; off?: boolean; token?: string }, key: string): Promise<PRBoard[]> {
  const K = key.toUpperCase();
  if (connection.off || !connection.real || !/^[A-Z][A-Z0-9]+-\d+$/.test(K)) return [];
  return prsOfGitHub(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + SEARCH_PRS(`is:pr author:@me archived:false \\"${K}\\" in:title,body sort:updated-desc`, 30)], connection.token)));
}

/** La matriz del último año con tus commits en los repos del refugio (por tu user.email de git). */
export async function localContributions(paths: string[]): Promise<DataGitHub> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 364 - start.getDay());   // de domingo a hoy, como GitHub
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const count = new Map<string, number>();
  await Promise.all(paths.map(async r => {
    const email = (await git(r, ['config', 'user.email']).catch(() => '')).trim(); if (!email) return;
    const out = await git(r, ['log', '--branches', `--since=${start.toISOString()}`, `--author=${email}`, '--format=%ct']).catch(() => '');
    for (const l of out.split('\n')) if (l) { const k = day(new Date(Number(l) * 1000)); count.set(k, (count.get(k) ?? 0) + 1); }
  }));
  const days: DayContrib[] = [];
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) days.push({ date: day(d), n: count.get(day(d)) ?? 0, level: 0 });
  // niveles por cuartiles de los días con algo, como GitHub
  const nonZero = days.map(d => d.n).filter(Boolean).sort((a, b) => a - b);
  const q = (p: number) => nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * p))] ?? 1;
  for (const d of days) d.level = !d.n ? 0 : d.n <= q(0.25) ? 1 : d.n <= q(0.5) ? 2 : d.n <= q(0.75) ? 3 : 4;
  return { source: 'local', total: days.reduce((s, d) => s + d.n, 0), days, ts: Date.now() };
}

// ---------------------------------------------------------------- despacho
export interface CtxGit { allowedPath: (r: string) => boolean; pathsRepos: () => string[]; onChange: (filePath: string) => void; github?: () => Promise<{ real: boolean; token?: string }>; ledger?: (url: string) => ReviewLedger | undefined }
const WRITE = new Set(['abortar', 'continuar', 'preparar', 'quitar', 'descartar', 'parche', 'commit', 'deshacerCommit', 'cambiarRama', 'crearRama', 'borrarRama', 'cajonGuardar', 'cajonSacar', 'cajonTirar', 'sincronizar']);

export async function actionGit(name: string, d: Record<string, any>, ctx: CtxGit): Promise<unknown> {
  if (name === 'github') return github(ctx.pathsRepos(), !!d.force, (await ctx.github?.()) ?? { real: false });
  if (name === 'prsBoard') {
    // con lo que queda por contestar en sus revisiones, de la última vuelta de prReviews.ts
    const r = await prsBoard((await ctx.github?.()) ?? { real: false });
    if (r.demo || !ctx.ledger) return r;
    return { ...r, prs: r.prs.map(p => { const l = ctx.ledger!(p.url); return l ? { ...p, ledger: l } : p; }) };
  }
  const filePath = path.resolve(String(d.path ?? ''));
  if (!ctx.allowedPath(filePath)) throw new Error(t('server.thatFolderIsNotA'));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const r = await (async () => {
    switch (name) {
      case 'status': return state(filePath);
      case 'diff': return diff(filePath, d as any);
      case 'stage': return stage(filePath, list(d.files));
      case 'unstage': return remove(filePath, list(d.files));
      case 'discard': return discard(filePath, list(d.files), list(d.withoutFollow));
      case 'patch': return applyPatch(filePath, String(d.patch ?? ''), d.mode === 'unstage' ? 'quitar' : d.mode === 'discard' ? 'descartar' : 'preparar');
      case 'commit': return commit(filePath, d as any);
      case 'undoCommit': return undoCommit(filePath);
      case 'log': return history(filePath, d);
      case 'detail': return detailCommit(filePath, d.hash);
      case 'diffCommit': return diffCommit(filePath, d.hash, d.file, d.origin);
      case 'branches': return branches(filePath);
      case 'switchBranch': return switchBranch(filePath, d as any);
      case 'createBranch': return createBranch(filePath, d as any);
      case 'deleteBranch': return deleteBranch(filePath, d as any);
      case 'stash': return drawer(filePath);
      case 'stashSave': return saveInDrawer(filePath, d);
      case 'stashPop': return takeOfDrawer(filePath, d as any);
      case 'stashDrop': return throwOfDrawer(filePath, d as any);
      case 'abort': return abort(filePath);
      case 'continue': return continueLast(filePath);
      case 'openFile': return openFile(filePath, d.file);
      case 'sync': return sync(filePath, ['fetch', 'pull', 'push'].includes(d.what) ? d.what : 'sync');
      default: throw new Error(t('server.unknownAction', { nombre: 'git.' + name }));
    }
  })().finally(() => { if (WRITE.has(name)) ctx.onChange(filePath); });
  return r ?? true;
}
