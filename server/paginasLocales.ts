// Páginas HTML del Mac dentro del juego: un enlace a «/Users/…/plan.html» en la respuesta de un habitante (un plan, un
// informe, una comparación) se ve en una ventana del refugio, no en la app que el Mac tenga para los .html (que puede ser
// un editor). El servidor la sirve en /pagina/<llave>/<archivo>: la llave es aleatoria y vale solo para la carpeta de esa
// página (sus imágenes y estilos relativos), sin salir de ella ni por enlaces. La página va aislada: cabecera
// `sandbox` (origen opaco: no ve el juego, su secreto ni su almacenamiento) y sin pedir datos (connect-src 'none'). Solo
// carga de fuera scripts, estilos y fuentes de los CDN públicos de siempre (CDNS): las páginas que escriben los habitantes
// traen marked, mermaid o highlight.js de ahí y sin ellos se quedan en blanco. Un .md se ve igual: el servidor lo pasa a
// HTML (con sus diagramas mermaid) en vez de abrirlo en el editor. A cada página se le añade la capa de notas del
// Supervisor (server/pagina/notas.js).
import { randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';
import { marked } from 'marked';
import { linkPath, openLocal, realInside } from './abrir.ts';

const OF_PAGE = /\.(html?|md|markdown)$/i;
const OF_MARKDOWN = /\.(md|markdown)$/i;
const CDNS = 'https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const PAGE_CSP = `sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' ${CDNS}; style-src 'self' 'unsafe-inline' ${CDNS}; img-src 'self' data: blob:; font-src 'self' data: ${CDNS}; media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'`;

// llave → carpeta de la página (las últimas; se olvidan al reiniciar el servidor)
const keys = new Map<string, string>();
const MAX_KEYS = 100;

export interface LocalPage { url: string; titulo: string; ruta: string }

// la capa de notas, al final de la página (se lee una vez; «</script» no puede salir dentro)
const NOTES_LAYER = `<script>${readFileSync(path.join(import.meta.dirname, 'pagina', 'notas.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
export const withNotes = (html: string) => (/<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${NOTES_LAYER}</body>`) : html + NOTES_LAYER);

// un .md como página: oscura, y los bloques ```mermaid, dibujados
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const MD_STYLE = 'body{background:#0d1117;color:#e6edf3;font:15px/1.6 -apple-system,sans-serif;margin:0 auto;max-width:980px;padding:24px 40px}a{color:#58a6ff}h1,h2{border-bottom:1px solid #30363d;padding-bottom:.3em}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #30363d;padding:6px 10px;vertical-align:top}th{background:#161b22}code{background:#161b22;padding:2px 5px;border-radius:4px;font-size:13px}pre{background:#161b22;padding:12px;border-radius:6px;overflow:auto}pre code{padding:0}pre.mermaid{text-align:center}blockquote{color:#8b949e;border-left:3px solid #30363d;margin:0;padding-left:12px}img{max-width:100%}';
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export function markdownPage(md: string, titulo: string) {
  const cuerpo = (marked.parse(md, { async: false, gfm: true }) as string)
    .replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, c) => `<pre class="mermaid">${c}</pre>`);
  const diagramas = cuerpo.includes('<pre class="mermaid">') ? `<script src="${MERMAID}"></script><script>mermaid.initialize({startOnLoad:true,theme:'dark'})</script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title><style>${MD_STYLE}</style></head><body>${cuerpo}${diagramas}</body></html>`;
}

/** Registra una página del Mac para verla en el juego */
export async function registerPage(real: string): Promise<LocalPage> {
  const carpeta = path.dirname(real);
  let llave = [...keys].find(([, c]) => c === carpeta)?.[0];
  if (!llave) {
    llave = randomBytes(16).toString('hex'); keys.set(llave, carpeta);
    while (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value!);
  }
  return { url: `/pagina/${llave}/${encodeURIComponent(path.basename(real))}`, titulo: path.basename(real), ruta: real };
}

/** Un enlace a un archivo del Mac: una página HTML o un .md se ve en el juego; lo demás se abre como siempre (abrir.ts) */
export async function openLink(enlace: string, casa: string): Promise<string | { pagina: LocalPage }> {
  const ruta = linkPath(enlace, casa);
  const real = ruta ? await fs.realpath(ruta).catch(() => null) : null;
  if (real && OF_PAGE.test(real) && (await fs.stat(real)).isFile()) return { pagina: await registerPage(real) };
  return openLocal(enlace, casa);
}

/** GET /pagina/<llave>/<ruta>: un archivo de la carpeta de una página registrada (false si no es de aquí) */
export async function servePage(req: http.IncomingMessage, res: http.ServerResponse, url: string): Promise<boolean> {
  const m = /^\/pagina\/([0-9a-f]{32})\/(.+)$/.exec(url);
  const carpeta = m ? keys.get(m[1]) : undefined;
  if (!m || !carpeta || req.method !== 'GET') return false;
  const real = await realInside(carpeta, path.join(carpeta, path.normalize('/' + m[2]))).catch(() => null);
  const st = real ? await fs.stat(real).catch(() => null) : null;
  if (!real || !st?.isFile()) return false;
  const cabeceras = { 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (OF_PAGE.test(real)) {
    const texto = await fs.readFile(real, 'utf8');
    const html = Buffer.from(withNotes(OF_MARKDOWN.test(real) ? markdownPage(texto, path.basename(real)) : texto));
    res.writeHead(200, { ...cabeceras, 'Content-Type': TYPES['.html'], 'Content-Length': html.length }); res.end(html);
    return true;
  }
  res.writeHead(200, { ...cabeceras, 'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(real).pipe(res);
  return true;
}

/** De unas páginas enlazadas, las que siguen en el Mac (las de un worktree ya quitado no): el intercomunicador solo
 *  lista esas */
export async function existingPages(rutas: unknown, casa: string): Promise<string[]> {
  const lista = Array.isArray(rutas) ? rutas.filter((r): r is string => typeof r === 'string').slice(0, 200) : [];
  const ok = await Promise.all(lista.map(async r => { const p = linkPath(r, casa); return !!p && (await fs.stat(p).then(st => st.isFile(), () => false)); }));
  return lista.filter((_, i) => ok[i]);
}
