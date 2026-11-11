// Páginas HTML del Mac dentro del juego: un enlace a «/Users/…/plan.html» en la respuesta de un habitante (un plan, un
// informe, una comparación) se ve en una ventana del refugio, no en la app que el Mac tenga para los .html (que puede ser
// un editor). El servidor la sirve en /pagina/<llave>/<archivo>: la llave es aleatoria y vale solo para la carpeta de esa
// página (sus imágenes y estilos relativos), sin salir de ella ni por enlaces. La página va aislada: cabecera
// `sandbox` (origen opaco: no ve el juego, su secreto ni su almacenamiento) y sin conexiones (connect-src 'none').
// A cada página HTML se le añade la capa de notas del Supervisor (server/pagina/notas.js).
import { randomBytes } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';
import { linkPath, openLocal, realInside } from './abrir.ts';

const OF_PAGE = /\.html?$/i;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
export const PAGE_CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'";

// llave → carpeta de la página (las últimas; se olvidan al reiniciar el servidor)
const keys = new Map<string, string>();
const MAX_KEYS = 100;

export interface LocalPage { url: string; titulo: string; ruta: string }

// la capa de notas, al final de la página (se lee una vez; «</script» no puede salir dentro)
const NOTES_LAYER = `<script>${readFileSync(path.join(import.meta.dirname, 'pagina', 'notas.js'), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
export const withNotes = (html: string) => (/<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${NOTES_LAYER}</body>`) : html + NOTES_LAYER);

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

/** Un enlace a un archivo del Mac: una página HTML se ve en el juego; lo demás se abre como siempre (abrir.ts) */
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
    const html = Buffer.from(withNotes(await fs.readFile(real, 'utf8')));
    res.writeHead(200, { ...cabeceras, 'Content-Type': TYPES['.html'], 'Content-Length': html.length }); res.end(html);
    return true;
  }
  res.writeHead(200, { ...cabeceras, 'Content-Type': TYPES[path.extname(real).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(real).pipe(res);
  return true;
}
