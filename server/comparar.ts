// La comparación de cambios para revisar antes de subir: lo que lleva una rama (y lo que aún no está en un commit)
// frente a su base, como una página HTML oscura al estilo de GitHub. La pide el habitante con la herramienta
// `comparar_cambios` (mcpReview) y la enlaza en su respuesta: el Supervisor la abre en la ventana «Página» del juego,
// deja notas en las líneas que quiera y le llegan a esa misma conversación (server/paginasLocales.ts y
// server/pagina/notas.js). Solo lee el repo: git diff y poco más, con el entorno de git del juego.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { entornoGit } from './entornoGit.ts';
import { ROOMS_FOLDERS } from './estado.ts';

/** Donde se guardan las páginas: junto a las carpetas de las salas especiales, nunca en el repo */
export const COMPARES_FOLDER = path.join(path.dirname(ROOMS_FOLDERS), 'comparaciones');
const MAX_LINES_FILE = 4000, MAX_LINES = 30000;

const git = (cwd: string, args: string[]) => new Promise<string>((ok, mal) =>
  execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: entornoGit(), timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => (err ? mal(new Error(String(errOut || err.message).trim())) : ok(out))));
const gitOr = (cwd: string, args: string[]) => git(cwd, args).then(s => s.trim(), () => '');

/** La base con la que comparar: la pedida; si no, lo ya subido de la rama (la remota que sigue u origin/<rama>); si la
 *  rama no se ha subido nunca, la principal del remoto (o la local) */
export async function compareBase(cwd: string, pedida?: string): Promise<string> {
  const existe = async (c: string) => !!c && !!(await gitOr(cwd, ['rev-parse', '--verify', '--quiet', c + '^{commit}']));
  if (pedida) { if (!(await existe(pedida))) throw new Error(`No existe «${pedida}» en este repo.`); return pedida; }
  const rama = await gitOr(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = await gitOr(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  const remota = await gitOr(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  for (const c of [upstream, `origin/${rama}`, remota, 'origin/main', 'origin/master', 'main', 'master']) if (c && c !== rama && await existe(c)) return c;
  throw new Error('No encuentro con qué comparar: dime la base (una rama o un commit).');
}

interface Line { tipo: ' ' | '+' | '-' | '@'; texto: string; viejo?: number; nuevo?: number }
interface FileDiff { ruta: string; antes?: string; estado: 'nuevo' | 'borrado' | 'renombrado' | 'cambiado'; binario: boolean; mas: number; menos: number; lineas: Line[]; recortado: boolean }

/** Un diff unificado de git, por archivos y líneas (con sus números a cada lado) */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = []; let f: FileDiff | null = null; let viejo = 0, nuevo = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(l);
      f = { ruta: m?.[2] ?? l.slice(11), estado: 'cambiado', binario: false, mas: 0, menos: 0, lineas: [], recortado: false }; files.push(f); continue;
    }
    if (!f) continue;
    if (l.startsWith('new file mode')) f.estado = 'nuevo';
    else if (l.startsWith('deleted file mode')) f.estado = 'borrado';
    else if (l.startsWith('rename from ')) { f.estado = 'renombrado'; f.antes = l.slice(12); }
    else if (l.startsWith('rename to ')) f.ruta = l.slice(10);
    else if (l.startsWith('Binary files ')) f.binario = true;
    else if (l.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(l);
      viejo = Number(m?.[1] ?? 0); nuevo = Number(m?.[2] ?? 0);
      if (f.lineas.length < MAX_LINES_FILE) f.lineas.push({ tipo: '@', texto: l });
    } else if (/^[ +-]/.test(l) && !l.startsWith('+++ ') && !l.startsWith('--- ')) {
      const tipo = l[0] as ' ' | '+' | '-';
      if (tipo === '+') f.mas++; else if (tipo === '-') f.menos++;
      if (f.lineas.length >= MAX_LINES_FILE) { f.recortado = true; if (tipo !== '-') nuevo++; if (tipo !== '+') viejo++; continue; }
      f.lineas.push({ tipo, texto: l.slice(1), viejo: tipo === '+' ? undefined : viejo, nuevo: tipo === '-' ? undefined : nuevo });
      if (tipo !== '-') nuevo++; if (tipo !== '+') viejo++;
    }
  }
  return files;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ancla = (ruta: string) => 'f-' + ruta.replace(/[^a-zA-Z0-9]+/g, '-');
const ESTADO: Record<FileDiff['estado'], string> = { nuevo: 'nuevo', borrado: 'borrado', renombrado: 'renombrado', cambiado: '' };

/** La página: resumen, índice de archivos y cada archivo con sus líneas (data-seccion: la nota dice de qué archivo es) */
export function compareHtml(titulo: string, subtitulo: string, files: FileDiff[]): string {
  const mas = files.reduce((n, f) => n + f.mas, 0), menos = files.reduce((n, f) => n + f.menos, 0);
  let total = 0;
  const cuerpo = files.map(f => {
    const cab = `<h2 class="fh"><a href="#${ancla(f.ruta)}">${esc(f.antes ? `${f.antes} → ${f.ruta}` : f.ruta)}</a> <span class="cuenta"><b class="mas">+${f.mas}</b> <b class="menos">−${f.menos}</b>${ESTADO[f.estado] ? ` · ${ESTADO[f.estado]}` : ''}</span></h2>`;
    if (f.binario) return `<section id="${ancla(f.ruta)}" data-seccion="${esc(f.ruta)}">${cab}<p class="nota">Archivo binario.</p></section>`;
    const filas = (total > MAX_LINES ? [] : f.lineas).map(l => {
      total++;
      if (l.tipo === '@') return `<tr class="hunk"><td colspan="3">${esc(l.texto)}</td></tr>`;
      const c = l.tipo === '+' ? 'add' : l.tipo === '-' ? 'del' : '';
      const linea = l.nuevo ?? l.viejo;
      return `<tr class="${c}" data-seccion="${esc(`${f.ruta}:${linea}`)}"><td class="n">${l.viejo ?? ''}</td><td class="n">${l.nuevo ?? ''}</td><td class="c"><span class="s">${l.tipo === ' ' ? ' ' : l.tipo}</span>${esc(l.texto) || ' '}</td></tr>`;
    }).join('');
    const corte = f.recortado || total > MAX_LINES ? '<p class="nota">Diff recortado: es muy largo para la página.</p>' : '';
    return `<section id="${ancla(f.ruta)}" data-seccion="${esc(f.ruta)}">${cab}<table>${filas}</table>${corte}</section>`;
  }).join('\n');
  const indice = files.map(f => `<li><a href="#${ancla(f.ruta)}">${esc(f.ruta)}</a> <b class="mas">+${f.mas}</b> <b class="menos">−${f.menos}</b></li>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
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
<h1>${esc(titulo)}</h1><p class="sub">${esc(subtitulo)}</p>
<p class="resumen">${files.length} ${files.length === 1 ? 'archivo cambiado' : 'archivos cambiados'}, <b class="mas">+${mas}</b> <b class="menos">−${menos}</b>. Selecciona cualquier trozo para dejar una nota.</p>
${files.length ? `<ul class="indice">${indice}</ul>` : '<p class="nota">Sin cambios frente a la base.</p>'}
${cuerpo}
</main></body></html>`;
}

// git diff --no-index sale con 1 cuando hay diferencias: no es un error
const newFileDiff = (cwd: string, f: string) => new Promise<string>(ok =>
  execFile('git', ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', f], { cwd, env: entornoGit(), timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => ok(String(out ?? ''))));

/** Genera la página de un repo y devuelve dónde ha quedado */
export async function buildCompare(cwd: string, o: { base?: string; sinCommit?: boolean; titulo?: string } = {}) {
  const raiz = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
  const base = await compareBase(raiz, o.base);
  const desde = (await gitOr(raiz, ['merge-base', base, 'HEAD'])) || base;
  const rama = (await gitOr(raiz, ['rev-parse', '--abbrev-ref', 'HEAD'])) || 'HEAD';
  const sinCommit = o.sinCommit !== false;
  const diff = await git(raiz, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '--unified=3', desde, ...(sinCommit ? [] : ['HEAD']), '--']);
  // los archivos nuevos que git aún no sigue también cuentan (si no, lo recién creado no saldría)
  let extra = '';
  if (sinCommit) for (const f of (await gitOr(raiz, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).slice(0, 100)) extra += await newFileDiff(raiz, f);
  const files = parseDiff(diff + extra);
  const repo = path.basename(raiz);
  const titulo = o.titulo?.trim() || `${repo} · ${rama}`;
  const subtitulo = `${rama} frente a ${base}${sinCommit ? ' (con lo que aún no está en un commit)' : ''}`;
  await fs.mkdir(COMPARES_FOLDER, { recursive: true });
  const archivo = path.join(COMPARES_FOLDER, `${repo}-${rama}`.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 100) + '.html');
  await fs.writeFile(archivo, compareHtml(titulo, subtitulo, files));
  return { archivo, base, rama, archivos: files.length, mas: files.reduce((n, f) => n + f.mas, 0), menos: files.reduce((n, f) => n + f.menos, 0) };
}

/** La herramienta del habitante, en la carpeta de su conversación (la del worktree, si trabaja en uno) */
export function mcpReview(cwd: () => string) {
  return createSdkMcpServer({
    name: 'revision', version: '1.0.0',
    tools: [
      tool('comparar_cambios', 'work-shelter (el juego desde el que te manejan): genera la página de comparación de tus cambios (la rama frente a su base, con lo que aún no está en un commit) para que el Supervisor los revise antes de subirlos. Enlaza la ruta que devuelve en tu respuesta, como enlace Markdown: el Supervisor la abre en el juego, deja notas en las líneas y te llegan aquí. Úsala antes de cada push, o cuando te pida ver los cambios.',
        { base: z.string().optional().describe('Rama o commit con el que comparar; si no, la rama remota que sigue o la principal'), sinCommit: z.boolean().optional().describe('Incluir lo que aún no está en un commit (por defecto, sí)'), titulo: z.string().optional() },
        async a => {
          try {
            const r = await buildCompare(cwd(), a);
            return { content: [{ type: 'text', text: `Página lista: [${path.basename(r.archivo)}](${r.archivo}) — ${r.rama} frente a ${r.base}: ${r.archivos} archivos, +${r.mas} −${r.menos}. Enlázala así en tu respuesta para que el Supervisor la abra en el juego.` }] };
          } catch (e) { return { content: [{ type: 'text', text: `No se pudo generar: ${(e as Error).message}` }], isError: true }; }
        }),
    ],
  });
}
