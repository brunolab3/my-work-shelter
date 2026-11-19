// Dig a room from GitHub (the Main Gate's «From GitHub…»): your repos and your organisations' (read-only, with the
// GitHub integration's token or the `gh` session), the ones already cloned under the repos root, and `git clone` into a
// new folder inside the root with your own git credentials (the game holds no token for it). The clone is a foreign
// repo: its folder is a trust boundary (sessions.ts, confianza()), so a trusted parent folder doesn't cover it.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { entornoGit } from './gitEnv.ts';
import { remoteRepo } from './prReviews.ts';
import { t } from '../shared/language.ts';

export type RepoGitHub = { repo: string; nombre: string; privado: boolean; archivado: boolean; descripcion: string; pushed: number };
export type Cloned = { ruta: string; corta: string; sala?: string };   // corta: the path with ~ for the panel
export type Gh = (args: string[]) => Promise<string>;

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** owner/name from what was typed or pasted: `owner/name`, an https URL (with or without .git, a path after it) or
 *  an ssh one (git@github.com:owner/name.git) */
export function repoRef(texto: string): string | undefined {
  const s = texto.trim();
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
  return { repo, nombre: repo.split('/')[1], privado: !!x.private, archivado: !!x.archived, descripcion: String(x.description ?? '').slice(0, 200), pushed: Date.parse(x.pushed_at) || 0 };
};

/** Your repos, as owner, collaborator or member of an organisation, most recently pushed first (a few pages: the
 *  rest are reached by typing owner/name) */
export async function listRepos(gh: Gh, pages = 5): Promise<RepoGitHub[]> {
  const page = async (p: number) => { const x = JSON.parse(await gh(['api', `/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc&per_page=100&page=${p}`])); return Array.isArray(x) ? x : []; };
  // the first page, and only if it's full the rest at once (each one takes a second or two)
  const first = await page(1);
  const lotes = [first, ...(first.length < 100 ? [] : await Promise.all(Array.from({ length: pages - 1 }, (_, i) => page(i + 2))))];
  const out = new Map<string, RepoGitHub>();
  for (const x of lotes.flat()) { const r = fromApi(x); if (r && !out.has(r.repo.toLowerCase())) out.set(r.repo.toLowerCase(), r); }
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
export function clonedRepos(raiz: string, salas: { ruta?: string; nombre: string }[]): Map<string, Cloned> {
  const out = new Map<string, Cloned>(), home = os.homedir();
  const add = (repo: string | undefined, ruta: string, sala?: string) => { if (repo && !out.has(repo)) out.set(repo, { ruta, corta: ruta.startsWith(home + path.sep) ? '~' + ruta.slice(home.length) : ruta, ...(sala ? { sala } : {}) }); };
  for (const s of salas) if (s.ruta) add(originOf(s.ruta), s.ruta, s.nombre);
  const r = path.resolve(raiz);
  if (r === path.parse(r).root) return out;
  const hijos = (d: string) => { try { return readdirSync(d).filter(n => !n.startsWith('.')).map(n => path.join(d, n)).filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } }); } catch { return []; } };
  for (const a of hijos(r)) {
    if (existsSync(path.join(a, '.git'))) { add(originOf(a), a); continue; }
    if (r === home) continue;   // ~/Library, ~/Documents…: not groups of repos
    for (const b of hijos(a)) add(originOf(b), b);
  }
  return out;
}

/** The clone's folder: a new one inside the repos root (a group subfolder too), whose segments are plain names, not
 *  a room's and not inside another repo. Returns it resolved, or the reason it can't be */
export function cloneDestination(ruta: string, raiz: string, taken: string[]): string {
  const r = path.resolve(raiz), d = path.resolve(ruta);
  if (r === path.parse(r).root || !d.startsWith(r + path.sep)) throw new Error(t('server.newFoldersInsideRoot', { raiz }));
  const tramos = path.relative(r, d).split(path.sep);
  if (tramos.some(x => !/^[\w.\-áéíóúñ ]+$/i.test(x) || x === '.' || x === '..' || x.startsWith('.'))) throw new Error(t('server.cloneFolderBadName'));
  if (existsSync(d)) throw new Error(t('server.cloneFolderExists'));
  // a room's folder above it is fine: the root is Logistics' folder, and a group folder can be a wing
  if (taken.includes(d)) throw new Error(t('server.thatFolderAlreadyHasA'));
  for (let p = path.dirname(d); p !== r; p = path.dirname(p)) if (existsSync(path.join(p, '.git'))) throw new Error(t('server.cloneInsideRepo', { repo: path.basename(p) }));
  return d;
}

/** The URL to clone with: ssh if `gh` is set to it (git_protocol), https otherwise; git's own credentials do the rest */
export const cloneUrl = (repo: string, protocolo?: string) => protocolo?.trim() === 'ssh' ? `git@github.com:${repo}.git` : `https://github.com/${repo}.git`;

/** The last line of git's progress (it rewrites it with \r) and its percentage */
export function progressOf(salida: string): { linea: string; pct?: number } {
  const lineas = salida.split(/[\r\n]+/).map(l => l.replace(/^remote:\s*/, '').trim()).filter(Boolean);
  const linea = lineas[lineas.length - 1] ?? '';
  const pct = /(\d{1,3})%/.exec(linea)?.[1];
  return { linea: linea.slice(0, 160), pct: pct === undefined ? undefined : Math.min(100, Number(pct)) };
}

export type StateClone = { id: string; repo: string; ruta: string; estado: 'clonando' | 'hecho' | 'error' | 'cancelado'; linea: string; pct?: number; error?: string };

/** The clones in progress (one at a time per folder): started, read by the panel and cancelled */
export class Clones {
  private lista = new Map<string, StateClone & { proc?: ChildProcess; salida: string }>();
  constructor(private lanzar: (args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcess = (args, cwd, env) => spawn('git', args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] }), private alAcabar: (c: StateClone) => void = () => {}) {}

  empezar(repo: string, destino: string, url: string): StateClone {
    if ([...this.lista.values()].some(c => c.estado === 'clonando' && c.ruta === destino)) throw new Error(t('server.cloneFolderExists'));
    mkdirSync(path.dirname(destino), { recursive: true });
    // no prompts (they'd hang with nobody to answer), and no ssh host-key or password questions either
    const env = entornoGit({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) });
    const c: StateClone & { proc?: ChildProcess; salida: string } = { id: randomUUID(), repo, ruta: destino, estado: 'clonando', linea: t('server.cloneStarting'), salida: '' };
    this.lista.set(c.id, c);
    const proc = this.lanzar(['clone', '--progress', '--', url, destino], path.dirname(destino), env);
    c.proc = proc;
    proc.stderr?.on('data', (b: Buffer) => { c.salida = (c.salida + b.toString()).slice(-8000); const p = progressOf(c.salida); if (p.linea) { c.linea = p.linea; c.pct = p.pct; } });
    const fin = (code: number | null, err?: Error) => {
      if (c.estado !== 'clonando') return;
      c.proc = undefined;
      if (code === 0 && existsSync(destino)) { c.estado = 'hecho'; c.pct = 100; }
      else { c.estado = 'error'; c.error = err?.message ?? explainClone(c.salida); }
      this.alAcabar(this.ver(c.id)!);
    };
    proc.on('error', e => fin(null, e));
    proc.on('close', code => fin(code));
    return this.ver(c.id)!;
  }
  ver(id: string): StateClone | undefined {
    const c = this.lista.get(id);
    if (!c) return;
    const { proc: _p, salida: _s, ...x } = c;
    return x;
  }
  cancelar(id: string) {
    const c = this.lista.get(id);
    if (!c || c.estado !== 'clonando') return false;
    c.estado = 'cancelado'; c.proc?.kill('SIGTERM');   // git removes the half-made folder when it's interrupted
    return true;
  }
}

/** git's error, readable: the lines starting with fatal/error, or the last ones */
export function explainClone(salida: string): string {
  const lineas = salida.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const malas = lineas.filter(l => /^(fatal|error|ERROR)\b|denied|could not read/i.test(l));
  const texto = (malas.length ? malas : lineas.slice(-3)).join(' · ').slice(0, 400);
  if (/terminal prompts disabled|could not read Username|Authentication failed|Permission denied \(publickey\)|Host key verification failed/i.test(texto)) return t('server.cloneNoCredentials', { detalle: texto });
  return texto || t('server.cloneFailed');
}
