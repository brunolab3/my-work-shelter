// Páginas HTML del Mac dentro del juego: un enlace a «/Users/…/plan.html» en la respuesta de un habitante (un plan, un
// informe, una comparación) se ve en una ventana del refugio, no en la app que el Mac tenga para los .html (que puede ser
// un editor). El servidor la sirve en /pagina/<llave>/<archivo>: la llave es aleatoria y vale solo para la carpeta de esa
// página (sus imágenes y estilos relativos), sin salir de ella ni por enlaces. La página va aislada: cabecera
// `sandbox` (origen opaco: no ve el juego, su secreto ni su almacenamiento) y sin pedir datos (connect-src 'none'). Solo
// carga de fuera scripts, estilos y fuentes de los CDN públicos de siempre (CDNS): las páginas que escriben los habitantes
// traen marked, mermaid o highlight.js de ahí y sin ellos se quedan en blanco. Un .md se ve igual: el servidor lo pasa a
// HTML (con sus diagramas mermaid) en vez de abrirlo en el editor. A cada página se le añade la capa de notas del
// Supervisor (server/page/notes.js). Una imagen enlazada también se ve en el juego, pero su llave vale solo para ella
// (no para su carpeta): es lo que piden las miniaturas de las respuestas (imageThumbnail). A text or code file (.ts,
// .json, .log…, OF_TEXT in open.ts) is shown too, as a read-only page of its own: escaped, monospace, with line numbers,
// its first TEXT_CAP bytes only, and a «:12» in the link marks and scrolls to that line (#L12). Its key is for that file only.
import { randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';
import { marked } from 'marked';
import { linkPath, localKind, openLocal, realInside, realOfLink, OF_TEXT } from './open.ts';
import { t } from '../shared/language.ts';
import type { LocalKind } from '../shared/linkOptions.ts';
import { IMAGE_FILE } from '../shared/sessionPages.ts';

const OF_PAGE = /\.(html?|md|markdown)$/i;
const OF_MARKDOWN = /\.(md|markdown)$/i;
// text and code shown as a read-only page: what the Mac would open in the editor that isn't already a page
const isText = (real: string) => OF_TEXT.test(real) && !OF_PAGE.test(real);
export const TEXT_CAP = 512 * 1024;
const CDNS = 'https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const PAGE_CSP = `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' ${CDNS}; style-src 'self' 'unsafe-inline' ${CDNS}; img-src 'self' data: blob:; font-src 'self' data: ${CDNS}; media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'`;

// key → the page's folder, or a single image or text file (the latest; forgotten when the server restarts)
const keys = new Map<string, { folder: string; file?: string; text?: boolean }>();
const MAX_KEYS = 300;

export interface LocalPage { url: string; title: string; path: string }

// la capa de notas, al final de la página (se lee una vez; «</script» no puede salir dentro)
const NOTES_LAYER = `<script>${readFileSync(path.join(import.meta.dirname, 'page', 'notes.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
export const withNotes = (html: string) => (/<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${NOTES_LAYER}</body>`) : html + NOTES_LAYER);

// un .md como página: oscura, y los bloques ```mermaid, dibujados
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const MD_STYLE = 'body{background:#0d1117;color:#e6edf3;font:15px/1.6 -apple-system,sans-serif;margin:0 auto;max-width:980px;padding:24px 40px}a{color:#58a6ff}h1,h2{border-bottom:1px solid #30363d;padding-bottom:.3em}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #30363d;padding:6px 10px;vertical-align:top}th{background:#161b22}code{background:#161b22;padding:2px 5px;border-radius:4px;font-size:13px}pre{background:#161b22;padding:12px;border-radius:6px;overflow:auto}pre code{padding:0}pre.mermaid{text-align:center}blockquote{color:#8b949e;border-left:3px solid #30363d;margin:0;padding-left:12px}img{max-width:100%}';
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function markdownPage(md: string, title: string) {
  const body = (marked.parse(md, { async: false, gfm: true }) as string)
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, c) => `<pre class="mermaid">${c}</pre>`);
  const diagrams = body.includes('<pre class="mermaid">') ? `<script src="${MERMAID}"></script><script>mermaid.initialize({startOnLoad:true,theme:'dark'})</script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${MD_STYLE}</style></head><body>${body}${diagrams}</body></html>`;
}

// a text file as a page: each line a numbered <span id="L…">, the linked one highlighted (:target)
const TEXT_STYLE = 'body{background:#0d1117;color:#e6edf3;margin:0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}pre{margin:0;padding:8px 0;font:inherit;counter-reset:n}.l{display:block;padding-right:16px;white-space:pre-wrap;word-break:break-all;padding-left:5.5em;text-indent:-5.5em;counter-increment:n;scroll-margin-top:35vh}.l::before{content:counter(n);display:inline-block;width:4.5em;margin-right:1em;text-align:right;color:#6e7681;text-indent:0;user-select:none}.l:target{background:#bb800933}.l:target::before{color:#e3b341}.cap{position:sticky;top:0;background:#3d2e00;color:#e3b341;padding:6px 14px;font:13px -apple-system,sans-serif;border-bottom:1px solid #9e6a03}';
export function textPage(text: string, title: string, size: number) {
  const capped = size > TEXT_CAP;
  // a cut file ends at its last whole line (and a half character never shows)
  const shown = capped ? text.slice(0, Math.max(0, text.lastIndexOf('\n'))) : text.replace(/\n$/, '');
  const lines = shown.split('\n').map((l, i) => `<span class="l" id="L${i + 1}">${escapeHtml(l)}</span>`).join('');
  const notice = capped ? `<div class="cap">${escapeHtml(t('server.textPageCapped', { shown: kb(TEXT_CAP), size: kb(size) }))}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${TEXT_STYLE}</style></head><body>${notice}<pre>${lines}</pre></body></html>`;
}
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
async function readStart(real: string, bytes: number) {
  const f = await fs.open(real, 'r');
  try { const buf = Buffer.alloc(bytes); const { bytesRead } = await f.read(buf, 0, bytes, 0); return buf.subarray(0, bytesRead).toString('utf8'); }
  finally { await f.close(); }
}

/** Registra una página del Mac para verla en el juego */
export async function registerPage(real: string): Promise<LocalPage> {
  return register(real, false);
}
/** An image of the Mac to see in the game: its key serves that file only, unless its folder already has a page's key */
const registerImage = (real: string) => register(real, true);
function register(real: string, image: boolean, text = false): LocalPage {
  const folder = path.dirname(real);
  // an image: its own key, or else its folder's; a page: its folder's; a text file: its own (its folder's serves it raw)
  const theirs = image || text ? [...keys].find(([, k]) => k.file === real && !!k.text === text) : undefined;
  let key = (theirs ?? (text ? undefined : [...keys].find(([, k]) => k.folder === folder && !k.file)))?.[0];
  if (key) { const k = keys.get(key)!; keys.delete(key); keys.set(key, k); }   // the latest used go last
  else {
    key = randomBytes(16).toString('hex'); keys.set(key, text ? { folder, file: real, text } : image ? { folder, file: real } : { folder });
    while (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value!);
  }
  return { url: `/pagina/${key}/${encodeURIComponent(path.basename(real))}`, title: path.basename(real), path: real };
}

// the real path of a link to a file of the Mac whose name matches `tipo` (null if it isn't one)
async function linkedFile(link: string, home: string, type: RegExp) {
  const path = linkPath(link, home);
  const real = path ? await fs.realpath(path).catch(() => null) : null;
  return real && type.test(real) && (await fs.stat(real)).isFile() ? real : null;
}

/** Un enlace a un archivo del Mac: una página HTML, un .md, una imagen o un archivo de texto o código se ve en el
 *  juego; lo demás se abre como siempre (open.ts). With `fuera`, outside the game even if it could be seen inside (the
 *  link's options) */
export async function openLink(link: string, home: string, outside = false): Promise<string | { page: LocalPage }> {
  if (outside) return openLocal(link, home);
  const page = await linkedFile(link, home, OF_PAGE);
  if (page) return { page: await registerPage(page) };
  const image = await linkedFile(link, home, IMAGE_FILE);
  if (image) return { page: registerImage(image) };
  const text = await linkedFile(link, home, OF_TEXT);
  if (text && isText(text)) {
    const p = register(text, false, true), line = linkLine(link);
    return { page: { ...p, url: p.url + (line ? `#L${line}` : '') } };
  }
  return openLocal(link, home);
}
// the line a link points at: «:12», «:12:3» or «#L12»
const linkLine = (link: string) => Number(/(?::(\d+)(?::\d+)?|#L(\d+))$/.exec(String(link).trim())?.slice(1).find(Boolean)) || 0;

/** What a link to a file of the Mac can open in, without opening it: inside the game (a page, an image or text) and where
 *  the Mac would open it (open.ts) */
export async function linkKind(link: string, home: string): Promise<{ juego: boolean; mac: LocalKind }> {
  const real = await realOfLink(link, home);
  const mac = await localKind(real);
  return { juego: mac !== 'folder' && (OF_PAGE.test(real) || IMAGE_FILE.test(real) || isText(real)) && (await fs.stat(real)).isFile(), mac };
}

/** The thumbnail of an image a reply links: its address in the game, or null if the link isn't an image of the Mac */
export async function imageThumbnail(link: string, home: string): Promise<string | null> {
  const image = await linkedFile(link, home, IMAGE_FILE);
  return image ? registerImage(image).url : null;
}

/** GET /pagina/<llave>/<ruta>: un archivo de la carpeta de una página registrada (false si no es de aquí) */
export async function servePage(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<boolean> {
  const m = /^\/pagina\/([0-9a-f]{32})\/(.+)$/.exec(url);
  const key = m ? keys.get(m[1]) : undefined;
  if (!m || !key || req.method !== 'GET') return false;
  const real = await realInside(key.folder, path.join(key.folder, path.normalize('/' + m[2]))).catch(() => null);
  const st = real ? await fs.stat(real).catch(() => null) : null;
  if (!real || !st?.isFile() || (key.file && real !== key.file)) return false;
  const headers = { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (key.text) {
    const html = Buffer.from(withNotes(textPage(await readStart(real, TEXT_CAP), path.basename(real), st.size)));
    res.writeHead(200, { ...headers, 'Content-Type': TYPES['.html'], 'Content-Length': html.length }); res.end(html);
    return true;
  }
  if (OF_PAGE.test(real)) {
    const text = await fs.readFile(real, 'utf8');
    const html = Buffer.from(withNotes(OF_MARKDOWN.test(real) ? markdownPage(text, path.basename(real)) : text));
    res.writeHead(200, { ...headers, 'Content-Type': TYPES['.html'], 'Content-Length': html.length }); res.end(html);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(real).pipe(res);
  return true;
}

/** De unas páginas enlazadas, las que siguen en el Mac (las de un worktree ya quitado no): el intercomunicador solo
 *  lista esas */
export async function existingPages(paths: unknown, home: string): Promise<string[]> {
  return Object.keys(await pagesUpdated(paths, home));
}

/** Lo mismo con cuándo se cambió cada una por última vez (ruta → ms): el intercomunicador lo enseña en la lista */
export async function pagesUpdated(paths: unknown, home: string): Promise<Record<string, number>> {
  const list = Array.isArray(paths) ? paths.filter((r): r is string => typeof r === 'string').slice(0, 200) : [];
  const dates = await Promise.all(list.map(async r => { const p = linkPath(r, home); return p ? fs.stat(p).then(st => (st.isFile() ? st.mtimeMs : null), () => null) : null; }));
  return Object.fromEntries(list.flatMap((r, i) => (dates[i] === null ? [] : [[r, dates[i]!]])));
}
