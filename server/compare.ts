// La comparación de cambios para revisar antes de subir: lo que lleva una rama (y lo que aún no está en un commit)
// frente a su base, como una página HTML oscura al estilo de GitHub. La pide el habitante con la herramienta
// `compare_changes` (mcpReview) y la enlaza en su respuesta: el Supervisor la abre en la ventana «Página» del juego,
// deja notas en las líneas que quiera y le llegan a esa misma conversación (server/localPages.ts y
// server/page/notes.js). Solo lee el repo: git diff y poco más, con el entorno de git del juego.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { gitEnvironment } from './gitEnv.ts';
import { DATA, ROOMS_FOLDERS } from './state.ts';
import { pageLink } from '../shared/sessionPages.ts';
import { t, language } from '../shared/language.ts';
import { MCP } from './mcpServers.ts';

/** Where the pages are saved: in the game's data (git-ignored), never in the compared repo. A path without spaces, so
 *  the link also works outside the game; they used to live in Application Support, which has one */
export const COMPARES_FOLDER = path.join(DATA, 'compares');
const OLD_COMPARES_FOLDER = path.join(path.dirname(ROOMS_FOLDERS), 'comparaciones');
const MAX_LINES_FILE = 4000, MAX_LINES = 30000;

const git = (cwd: string, args: string[]) => new Promise<string>((ok, fail) =>
  execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: gitEnvironment(), timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => (err ? fail(new Error(String(errOut || err.message).trim())) : ok(out))));
const gitOr = (cwd: string, args: string[]) => git(cwd, args).then(s => s.trim(), () => '');

/** La base con la que comparar: la pedida; si no, lo ya subido de la rama (la remota que sigue u origin/<rama>); si la
 *  rama no se ha subido nunca, la principal del remoto (o la local) */
export async function compareBase(cwd: string, requested?: string): Promise<string> {
  const exists = async (c: string) => !!c && !!(await gitOr(cwd, ['rev-parse', '--verify', '--quiet', c + '^{commit}']));
  if (requested) { if (!(await exists(requested))) throw new Error(t('tool.compare.noSuchBase', { base: requested })); return requested; }
  const branch = await gitOr(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = await gitOr(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const remote = await gitOr(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  for (const c of [upstream, `origin/${branch}`, remote, 'origin/main', 'origin/master', 'main', 'master']) if (c && c !== branch && await exists(c)) return c;
  throw new Error(t('tool.compare.noBase'));
}

interface Line { type: ' ' | '+' | '-' | '@'; text: string; old?: number; newer?: number }
interface FileDiff { path: string; before?: string; state: 'new' | 'deleted' | 'renamed' | 'changed'; binary: boolean; more: number; deletions: number; lines: Line[]; truncated: boolean }

/** Un diff unificado de git, por archivos y líneas (con sus números a cada lado) */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []; let f: FileDiff | null = null; let old = 0, newer = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(l);
      f = { path: m?.[2] ?? l.slice(11), state: 'changed', binary: false, more: 0, deletions: 0, lines: [], truncated: false }; files.push(f); continue;
    }
    if (!f) continue;
    if (l.startsWith('new file mode')) f.state = 'new';
    else if (l.startsWith('deleted file mode')) f.state = 'deleted';
    else if (l.startsWith('rename from ')) { f.state = 'renamed'; f.before = l.slice(12); }
    else if (l.startsWith('rename to ')) f.path = l.slice(10);
    else if (l.startsWith('Binary files ')) f.binary = true;
    else if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
      old = Number(m?.[1] ?? 0); newer = Number(m?.[2] ?? 0);
      if (f.lines.length < MAX_LINES_FILE) f.lines.push({ type: '@', text: l });
    } else if (/^[ +-]/.test(l) && !l.startsWith('+++ ') && !l.startsWith('--- ')) {
      const type = l[0] as ' ' | '+' | '-';
      if (type === '+') f.more++; else if (type === '-') f.deletions++;
      if (f.lines.length >= MAX_LINES_FILE) { f.truncated = true; if (type !== '-') newer++; if (type !== '+') old++; continue; }
      f.lines.push({ type, text: l.slice(1), old: type === '+' ? undefined : old, newer: type === '-' ? undefined : newer });
      if (type !== '-') newer++; if (type !== '+') old++;
    }
  }
  return files;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const anchor = (path: string) => 'f-' + path.replace(/[^a-zA-Z0-9]+/g, '-');
const STATE: Record<FileDiff['state'], string> = { new: 'nuevo', deleted: 'borrado', renamed: 'renombrado', changed: '' };

/** La página: resumen, índice de archivos y cada archivo con sus líneas (data-seccion: la nota dice de qué archivo es) */
export function compareHtml(title: string, subtitle: string, files: FileDiff[]): string {
  const more = files.reduce((n, f) => n + f.more, 0), deletions = files.reduce((n, f) => n + f.deletions, 0);
  let total = 0;
  const body = files.map(f => {
    const header = `<h2 class="fh"><a href="#${anchor(f.path)}">${esc(f.before ? `${f.before} → ${f.path}` : f.path)}</a> <span class="cuenta"><b class="mas">+${f.more}</b> <b class="menos">−${f.deletions}</b>${STATE[f.state] ? ` · ${STATE[f.state]}` : ''}</span></h2>`;
    if (f.binary) return `<section id="${anchor(f.path)}" data-seccion="${esc(f.path)}">${header}<p class="nota">${t('tool.compare.binary')}</p></section>`;
    const rows = (total > MAX_LINES ? [] : f.lines).map(l => {
      total++;
      if (l.type === '@') return `<tr class="hunk"><td colspan="3">${esc(l.text)}</td></tr>`;
      const c = l.type === '+' ? 'add' : l.type === '-' ? 'del' : '';
      const line = l.newer ?? l.old;
      return `<tr class="${c}" data-seccion="${esc(`${f.path}:${line}`)}"><td class="n">${l.old ?? ''}</td><td class="n">${l.newer ?? ''}</td><td class="c"><span class="s">${l.type === ' ' ? ' ' : l.type}</span>${esc(l.text) || ' '}</td></tr>`;
    }).join('');
    const truncation = f.truncated || total > MAX_LINES ? `<p class="nota">${t('tool.compare.truncated')}</p>` : '';
    return `<section id="${anchor(f.path)}" data-seccion="${esc(f.path)}">${header}<table>${rows}</table>${truncation}</section>`;
  }).join('\n');
  const index = files.map(f => `<li><a href="#${anchor(f.path)}">${esc(f.path)}</a> <b class="mas">+${f.more}</b> <b class="menos">−${f.deletions}</b></li>`).join('');
  return `<!doctype html><html lang="${language()}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#8b949e;margin:0 0 16px}
.resumen{color:#8b949e;margin-bottom:12px}.mas{color:#3fb950}.menos{color:#f85149}
ul.indice{list-style:none;padding:0;margin:0 0 24px;border:1px solid #30363d;border-radius:6px}
ul.indice li{padding:4px 12px;border-top:1px solid #21262d}ul.indice li:first-child{border-top:0}
a{color:#58a6ff;text-decoration:none}
section{border:1px solid #30363d;border-radius:6px;margin-bottom:20px;overflow:hidden}
h2.fh{position:sticky;top:0;margin:0;padding:8px 12px;background:#161b22;border-bottom:1px solid #30363d;font:600 13px ui-monospace,Menlo,monospace;z-index:1}
h2.fh .cuenta{font-weight:400;color:#8b949e;margin-left:8px}
table{border-collapse:collapse;width:100%;font:12px/1.5 ui-monospace,Menlo,monospace}
td.n{width:1%;min-width:44px;padding:0 8px;text-align:right;color:#6e7681;user-select:none;vertical-align:top}
td.c{white-space:pre-wrap;word-break:break-word;padding:0 12px 0 4px}.s{display:inline-block;width:14px;color:#8b949e;user-select:none}
tr.add{background:rgba(46,160,67,.15)}tr.del{background:rgba(248,81,73,.15)}
tr.hunk td{background:rgba(56,139,253,.1);color:#8b949e;padding:2px 12px}
.nota{color:#8b949e;padding:8px 12px;margin:0}
</style></head><body><main>
<h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p>
<p class="resumen">${t(files.length === 1 ? 'tool.compare.filesOne' : 'tool.compare.filesMany', { n: files.length })}, <b class="mas">+${more}</b> <b class="menos">−${deletions}</b>. ${t('tool.compare.howToNote')}</p>
${files.length ? `<ul class="indice">${index}</ul>` : `<p class="nota">${t('tool.compare.noChanges')}</p>`}
${body}
</main></body></html>`;
}

// git diff --no-index sale con 1 cuando hay diferencias: no es un error
const newFileDiff = (cwd: string, f: string) => new Promise<string>(ok =>
  execFile('git', ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', f], { cwd, env: gitEnvironment(), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => ok(String(out ?? ''))));

/** Compares go once their task is finished (every worktree they cover removed, by the game's task cleanup or by
 *  hand) and, the rest, after two weeks: nobody reviews them any more. At startup and every few minutes (main.ts) */
export async function cleanCompares(days = 14, folders = [COMPARES_FOLDER, OLD_COMPARES_FOLDER]) {
  const limit = Date.now() - days * 86_400_000;
  for (const folder of folders) {   // the old folder too, which empties itself this way
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    for (const n of names) if (n.endsWith('.html') || n.endsWith('.json')) {
      const f = path.join(folder, n);
      const st = await fs.stat(f).catch(() => null);
      if (st && st.mtimeMs < limit) await fs.rm(f, { force: true }).catch(() => {});
      else if (n.endsWith('.json') && await taskFinished(f)) for (const x of [f, f.replace(/\.json$/, '.html')]) await fs.rm(x, { force: true }).catch(() => {});
    }
  }
}
const taskFinished = async (sidecar: string) => {
  const parts = await fs.readFile(sidecar, 'utf8').then(j => (JSON.parse(j) as CompareSidecar).parts, () => null);
  return Array.isArray(parts) && parts.length > 0 && parts.every(p => typeof p?.worktree === 'string' && !existsSync(p.worktree));
};

/** What a repo (or worktree) carries against its base, by files, at the head looked at: its HEAD, or another branch or
 *  commit of the same repo (`head`), so a branch is compared from the main copy without opening a worktree for it */
export async function compareFiles(cwd: string, o: { base?: string; uncommitted?: boolean; head?: string } = {}) {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const other = !!o.head && o.head !== 'HEAD';
  if (other && o.uncommitted) throw new Error(t('tool.compare.uncommittedOtherHead', { head: o.head! }));
  const ref = other ? o.head! : 'HEAD';
  const head = await gitOr(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
  if (other && !head) throw new Error(t('tool.compare.noSuchHead', { head: ref }));
  const base = await compareBase(root, o.base);
  const since = (await gitOr(root, ['merge-base', base, ref])) || base;
  // its name: the branch's, or the commit itself (never the checkout's branch, so the pre-flight gate only takes it for that branch)
  const branch = (await gitOr(root, ['rev-parse', '--abbrev-ref', ref])) || (other ? head.slice(0, 12) : 'HEAD');
  const uncommitted = !other && o.uncommitted !== false;
  const diff = await git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--unified=3', since, ...(uncommitted ? [] : [head || 'HEAD']), '--']);
  // los archivos nuevos que git aún no sigue también cuentan (si no, lo recién creado no saldría)
  let extra = '';
  if (uncommitted) for (const f of (await gitOr(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).slice(0, 100)) extra += await newFileDiff(root, f);
  return { root, base, branch, head, uncommitted, files: parseDiff(diff + extra) };
}

/** Lo que dice de sí una página de comparación (`<página>.json` al lado): de qué worktree, rama y commit es cada parte.
 *  Así una validación queda atada a un commit: uno nuevo la deja vieja (shared/preflight.ts) */
export interface CompareSidecar { ts: number; parts: { worktree: string; branch: string; head: string; base: string }[] }
export const sidecarOf = (file: string) => file.replace(/\.html$/, '.json');
async function writePage(file: string, html: string, sidecar: CompareSidecar) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, html);
  await fs.writeFile(sidecarOf(file), JSON.stringify(sidecar));
}
const pageName = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100) + '.html';

/** Genera la página de un repo y devuelve dónde ha quedado */
export async function buildCompare(cwd: string, o: { base?: string; uncommitted?: boolean; head?: string; title?: string } = {}, folder = COMPARES_FOLDER) {
  const { root, base, branch, head, uncommitted, files } = await compareFiles(cwd, o);
  const repo = path.basename(root);
  const title = o.title?.trim() || `${repo} · ${branch}`;
  const subtitle = t('tool.compare.subtitle', { rama: branch, base }) + (uncommitted ? t('tool.compare.withUncommitted') : '');
  const file = path.join(folder, pageName(`${repo}-${branch}`));
  await writePage(file, compareHtml(title, subtitle, files), { ts: Date.now(), parts: [{ worktree: path.resolve(root), branch, head, base }] });
  return { file, base, branch, head, files: files.length, more: files.reduce((n, f) => n + f.more, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}

/** Otra copia (worktree) del mismo repo que la conversación: solo esas, nunca una carpeta cualquiera */
export async function sameRepoWorktree(cwd: string, folder: string): Promise<string> {
  const real = (d: string) => fs.realpath(d).catch(() => path.resolve(d));   // /var → /private/var
  const requested = await real(path.resolve(cwd, folder));
  const list = await gitOr(cwd, ['worktree', 'list', '--porcelain']);
  const copies = await Promise.all(list.split('\n').filter(l => l.startsWith('worktree ')).map(l => real(l.slice(9))));
  if (!copies.includes(requested)) throw new Error(t('tool.compare.notAWorktree', { carpeta: requested }));
  return requested;
}

/** La herramienta del habitante, en la carpeta de su conversación (la del worktree, si trabaja en uno) */
export function mcpReview(cwd: () => string, preflight?: { state(cwd: string): Promise<string>; respond(cwd: string, item: string, state: 'ok' | 'n/a' | 'pending', note?: string): Promise<string> }) {
  const text = (text: string) => ({ content: [{ type: 'text' as const, text }] });
  return createSdkMcpServer({
    name: MCP.review, version: '1.0.0',
    tools: [
      // el pre-flight de su parte de la tarea (server/preflight.ts): leerlo y contestar la lista «antes de subir»
      ...(preflight ? [
        tool('preflight_status', t('tool.preflight.estadoDescription'), {}, async () => text(await preflight.state(cwd()).catch(e => (e as Error).message))),
        tool('preflight_answer', t('tool.preflight.responderDescription'),
          { item: z.string(), status: z.enum(['ok', 'n/a', 'pending']), note: z.string().optional() },
          async a => text(await preflight.respond(cwd(), a.item, a.status === 'pending' ? 'pending' : a.status, a.note).catch(e => (e as Error).message))),
      ] : []),
      tool('compare_changes', t('tool.compare.description'),
        { base: z.string().optional().describe(t('tool.compare.paramBase')), uncommitted: z.boolean().optional().describe(t('tool.compare.paramUncommitted')),
          head: z.string().optional().describe(t('tool.compare.paramHead')), title: z.string().optional(),
          folder: z.string().optional().describe(t('tool.compare.paramFolder')) },
        async ({ folder, base, uncommitted, head, title }) => {
          try {
            const r = await buildCompare(folder ? await sameRepoWorktree(cwd(), folder) : cwd(), { base, uncommitted, head, title });
            return { content: [{ type: 'text', text: t('tool.compare.ready', { enlace: pageLink(r.file), rama: r.branch, base: r.base, n: r.files, mas: r.more, menos: r.deletions }) }] };
          } catch (e) { return { content: [{ type: 'text', text: t('tool.compare.failed', { error: (e as Error).message }) }], isError: true }; }
        }),
    ],
  });
}
