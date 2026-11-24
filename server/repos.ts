// Información de repositorios para las salas: rama, cambios sin commitear, último commit, tipo de proyecto, worktrees.
import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { InfoRepo, InfoWorktree } from '../shared/protocol.ts';
import { isCloneOfExample } from './examples.ts';
import { gitEnvironment } from './gitEnv.ts';
import { t } from '../shared/language.ts';

function git(cwd: string, args: string[], timeout = 6000): Promise<string> {
  return new Promise(res => execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, env: gitEnvironment() }, (err, out) => res(err ? '' : String(out))));
}

export const expand = (p: string) => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

export function projectType(filePath: string): string {
  try {
    const pj = path.join(filePath, 'package.json');
    if (existsSync(pj)) {
      const j = JSON.parse(readFileSync(pj, 'utf8'));
      const d = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
      if (['remotion', 'fluent-ffmpeg', '@ffmpeg/ffmpeg', 'hls.js', 'video.js', 'motion-canvas', '@motion-canvas/core'].some(k => d[k])) return 'vídeo';
      if (Object.keys(d).some(k => k.startsWith('@storybook/')) || d['style-dictionary']) return 'diseño';
      if (d.next) return 'web Next.js';
      if (d.astro) return 'web Astro';
      if (d['@sveltejs/kit']) return 'web SvelteKit';
      if (d.vite || d.react) return 'web';
      if (d.electron) return 'escritorio';
      return 'node';
    }
    if (existsSync(path.join(filePath, 'pyproject.toml')) || existsSync(path.join(filePath, 'requirements.txt'))) return 'python';
    if (existsSync(path.join(filePath, 'Cargo.toml'))) return 'rust';
    if (existsSync(path.join(filePath, 'go.mod'))) return 'go';
  } catch {}
  return 'carpeta';
}

// Estilo visual de la sala según el repo (lo que usa y cómo se llama): las escenas hechas a mano para los proyectos de
// vídeo, de diseño y las webs de escaparate; lo demás, la plantilla de su tipo
export function roomStyle(filePath: string, type: string): 'web' | 'video' | 'marca' | 'landing' | 'generico' {
  const n = path.basename(filePath).toLowerCase();
  if (type === 'vídeo' || /video|film|movie|anima/.test(n)) return 'video';
  if (type === 'diseño' || /design|brand|marca|tokens|styleguide|ui-?kit|icons/.test(n)) return 'marca';
  if (type === 'web Astro' || /landing|homepage|portfolio|website|showcase/.test(n)) return 'landing';
  if (type.startsWith('web')) return 'web';
  return 'generico';
}

// Worktrees that belong to no repo room: the Review room's (server/reviewRoom.ts) live under its folder and are left out
// of every room's list (holograms, task board, task cleanup, one worktree per task)
let hiddenUnder: string[] = [];
export const hideWorktreesUnder = (dirs: string[]) => { hiddenUnder = dirs.map(d => path.resolve(d) + path.sep); };
const hidden = (p: string) => hiddenUnder.some(d => (path.resolve(p) + path.sep).startsWith(d));

// solo la lista (ruta, rama, principal), sin `git status`: al momento aunque el repo sea enorme (los visitantes)
export async function worktreeList(filePath: string): Promise<InfoWorktree[]> {
  const out = await git(filePath, ['worktree', 'list', '--porcelain']);
  const list: InfoWorktree[] = [];
  let current: Partial<InfoWorktree> | null = null;
  for (const l of out.split('\n')) {
    if (l.startsWith('worktree ')) { if (current?.path) list.push(current as InfoWorktree); current = { path: l.slice(9), branch: '', main: list.length === 0, changes: 0, advanced: 0 }; }
    else if (l.startsWith('branch ') && current) current.branch = l.slice(7).replace('refs/heads/', '');
    else if (l === 'detached' && current) current.branch = t('server.noBranch');
  }
  if (current?.path) list.push(current as InfoWorktree);
  return list.filter(w => w.main || !hidden(w.path));
}

/** The branches a worktree has had checked out (its HEAD's reflog), each with the last time it was there (unix seconds):
 *  where a PR's branch was made or worked on after the worktree moved to another (prReviews.ts: homeOfBranch) */
export const branchesVisited = async (filePath: string) => visitedOfReflog(await git(filePath, ['reflog', '--date=unix', '--format=%gd%x09%gs', '-n', '2000']));
export function visitedOfReflog(out: string): Record<string, number> {
  const r: Record<string, number> = {};
  // newest first: the first time a branch shows up is the last time it was there
  for (const l of out.split('\n')) {
    const m = /^[^@]*@\{(\d+)\}\tcheckout: moving from (\S+) to (\S+)$/.exec(l);
    if (m) { r[m[2]] ??= Number(m[1]); r[m[3]] ??= Number(m[1]); }
  }
  return r;
}

export const hasBranch = async (filePath: string, branch: string) => !!(await git(filePath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).trim();

export async function worktrees(filePath: string): Promise<InfoWorktree[]> {
  const list = await worktreeList(filePath);
  const main = list[0]?.branch;
  await Promise.all(list.map(async w => {
    w.changes = (await git(w.path, ['status', '--porcelain'])).split('\n').filter(Boolean).length;
    if (!w.main && main) w.advanced = parseInt((await git(filePath, ['rev-list', '--count', `${main}..${w.branch}`])).trim() || '0', 10) || 0;
    w.external = !w.main && !w.path.includes(path.join(filePath, '.claude', 'worktrees')) && !w.path.startsWith(filePath);
  }));
  return list;
}

export async function infoRepo(rawPath: string): Promise<InfoRepo> {
  const filePath = expand(rawPath);
  const example = isCloneOfExample(filePath) ? { example: true } : {};
  if (!existsSync(filePath)) return { path: filePath, exists: false, isGit: false, changes: 0, type: 'desconocido', worktrees: [], ...example };
  const isGit = existsSync(path.join(filePath, '.git'));
  const info: InfoRepo = { path: filePath, exists: true, isGit, changes: 0, type: projectType(filePath), worktrees: [], ...example };
  if (!isGit) {
    // ¿carpeta con varios repos dentro? → ala con sala de coordinación
    try { info.subrepos = readdirSync(filePath).filter(n => !n.startsWith('.') && existsSync(path.join(filePath, n, '.git'))).map(n => path.join(filePath, n)); } catch {}
    return info;
  }
  const [branch, state, last, wts] = await Promise.all([
    git(filePath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(filePath, ['status', '--porcelain']),
    git(filePath, ['log', '-6', '--format=%h%x1f%s%x1f%an%x1f%ct']),
    worktrees(filePath),
  ]);
  info.branch = branch.trim() || undefined;
  info.changes = state.split('\n').filter(Boolean).length;
  const lines = last.trim().split('\n').filter(Boolean).map(l => { const [hash, message, author, date] = l.split('\x1f'); return { hash, message, author, date: Number(date) * 1000 }; });
  if (lines[0]?.hash) info.lastCommit = lines[0];
  info.commits = lines.slice(0, 6);
  info.worktrees = wts;
  return info;
}

// Sugerencias para la Puerta Principal: carpetas de la raíz de repos que aún no tienen sala
// Con la raíz en el hogar (sin ~/Sites ni parecidas) se saltan las carpetas de macOS: ni son proyectos ni conviene
// asomarse a Escritorio, Documentos o Descargas (macOS pide permiso para cada una)
// A group is a root folder without git that holds repos (`~/Fever/dice/*`): its repos and projects are suggested too,
// one level deep, with `grupo` set to the group's folder name. The group itself stays admittable
const SYSTEM_OF = new Set(['Applications', 'Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public']);
export type Suggestion = { path: string; name: string; isGit: boolean; type: string; modified: number; group?: string };
const subfolders = (dir: string, skip = (_n: string) => false) => {
  try { return readdirSync(dir).filter(n => !n.startsWith('.') && !skip(n)).map(n => path.join(dir, n)).filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } }); }
  catch { return []; }
};
export function suggestions(root: string, already: string[]): Suggestion[] {
  const r = expand(root), isHome = r === os.homedir();
  const card = (p: string, group?: string): Suggestion => ({ path: p, name: path.basename(p), isGit: existsSync(path.join(p, '.git')), type: projectType(p), modified: statSync(p).mtimeMs, ...(group ? { group } : {}) });
  try {
    const out: Suggestion[] = [];
    for (const p of subfolders(r, n => isHome && SYSTEM_OF.has(n))) {
      const isGit = existsSync(path.join(p, '.git'));
      if (!already.includes(p)) out.push(card(p));
      if (isGit) continue;
      const children = subfolders(p).map(h => ({ h, isGit: existsSync(path.join(h, '.git')) }));
      if (!children.some(x => x.isGit)) continue;
      for (const x of children) if (!already.includes(x.h) && (x.isGit || projectType(x.h) !== 'carpeta')) out.push(card(x.h, path.basename(p)));
    }
    return out.sort((a, b) => b.modified - a.modified);
  } catch { return []; }
}

// Sesiones de Claude Code abiertas ahora mismo (terminal, Claude Desktop…), aunque lleven rato quietas: cada proceso
// deja su ficha en ~/.claude/sessions/<pid>.json con su sesión y su carpeta; solo cuentan las de procesos vivos
// `modified`: la última vez que escribió en su transcripción (si aún no tiene, la ficha: updatedAt o startedAt)
export function liveSessions(): { id: string; cwd: string; modified: number }[] {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
  const out: { id: string; cwd: string; modified: number }[] = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!/^\d+\.json$/.test(f)) continue;
      try {
        const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        if (typeof s?.sessionId !== 'string' || typeof s?.cwd !== 'string' || !Number.isInteger(s?.pid)) continue;
        try { process.kill(s.pid, 0); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'EPERM') continue; }
        const modified = lastActivity(path.join(projectFolder(s.cwd), s.sessionId + '.jsonl')) || Number(s.updatedAt) || Number(s.startedAt) || 0;
        out.push({ id: s.sessionId, cwd: s.cwd, modified });
      } catch { /* ficha a medio escribir */ }
    }
  } catch { /* sin carpeta: Claude Code antiguo */ }
  return out;
}

// Lo último que pasó en una conversación: la fecha de su último mensaje (del usuario o de Claude), como la app de Claude.
// La fecha del archivo no sirve: la app (y Claude Code al retomarla) le añaden metadatos al abrirla (un enlace de PR, con
// su propia fecha, o sin fecha) y parecería de ahora
export function lastActivity(file: string): number | undefined {
  return lastMessage(file, '"timestamp"', d => { const t = Date.parse(d.timestamp); return Number.isNaN(t) ? undefined : t; });
}

// Claude Code, al salir de un worktree que creó él (`--worktree`; p. ej. al cerrar en iTerm una conversación que salió a
// la superficie), lleva la conversación al proyecto del repo principal y la marca «relocated»: desde entonces la da por
// del repo principal (listSessions, getSessionInfo) aunque se hiciera en el worktree. Retomarla en el worktree funciona
// (la encuentra y sigue allí), así que manda dónde se habló por última vez: el `cwd` de su último mensaje, si sigue
// existiendo. La marca se vuelve a escribir al final con los metadatos, así que basta mirar la cola
export function cwdBeforeRelocation(file: string): string | undefined {
  try {
    const size = statSync(file).size, n = Math.min(64 << 10, size), buf = Buffer.alloc(n);
    const fd = openSync(file, 'r');
    try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
    if (!buf.includes('"type":"relocated"')) return;
  } catch { return; }
  const cwd = lastMessage(file, '"cwd"', d => (typeof d.cwd === 'string' && d.cwd ? d.cwd : undefined));
  return cwd && existsSync(cwd) ? cwd : undefined;
}

// lo que `pick` saca del último mensaje (del usuario o de Claude) que lo tenga, leyendo desde el final por trozos cada
// vez mayores (las transcripciones pasan de 10 MB); `marca`: el texto que debe llevar la línea para molestarse en leerla
function lastMessage<T>(file: string, mark: string, pick: (d: any) => T | undefined): T | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    for (let fileSize = 64 << 10; ; fileSize *= 4) {
      const n = Math.min(fileSize, size), buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, size - n);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= (n < size ? 1 : 0); i--) {
        if (!lines[i].includes(mark)) continue;
        let d: any; try { d = JSON.parse(lines[i]); } catch { continue; }
        const v = d?.type === 'user' || d?.type === 'assistant' ? pick(d) : undefined;
        if (v !== undefined) return v;
      }
      if (n >= size || fileSize >= 16 << 20) return;
    }
  } catch { return; } finally { if (fd !== undefined) closeSync(fd); }
}

// Visitantes: sesiones de Claude Code abiertas en una terminal en esa carpeta (transcripción escrita hace poco)
export function projectFolder(cwd: string) {
  const v = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects', v.length <= 200 ? v : v.slice(0, 200));
}
export function recentTranscripts(cwd: string, windowMs = 3 * 60_000): { id: string; modified: number }[] {
  const dir = projectFolder(cwd);
  try {
    const now = Date.now();
    return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => ({ id: f.slice(0, -6), modified: statSync(path.join(dir, f)).mtimeMs })).filter(x => now - x.modified < windowMs);
  } catch { return []; }
}
