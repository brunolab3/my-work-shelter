// Markdown seguro para las respuestas de los habitantes (bloques de código con botón de copiar).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { client } from '../net/client';
import { isLocalServer, openPage } from './Browsers';
import { linkClick } from './linkOptions';
import { t } from '@shared/language';
import { localPathLinks } from './linkPaths';
import { relativeLinks, IMAGE_FILE, normalizePath } from '@shared/sessionPages';

marked.setOptions({ gfm: true, breaks: false });
marked.use(localPathLinks);   // «/Users/…/compare.html» suelto también es un enlace
// nada se carga desde fuera al leer una respuesta (privacidad): las imágenes remotas se quedan en su texto alternativo
DOMPurify.addHook('uponSanitizeElement', (node: any, data) => {
  if (data.tagName === 'img' && /^(https?:)?\/\//i.test(node.getAttribute?.('src') ?? '')) { const txt = document.createTextNode(`[${t('windows.image')}: ${node.getAttribute('alt') || node.getAttribute('src')}]`); node.replaceWith(txt); }
});

// los enlaces de una respuesta nunca llevan la ventana del juego a otra página: un clic ofrece cómo abrirlos
// (linkOptions.ts; `data-enlace` los web y de correo). Los que apuntan a un archivo del Mac («/Users/…/informe.html»,
// «~/…», «file:///…», `data-local`) no son páginas del juego: los abre el servidor (acción `enlace.local`: una página
// o una imagen en el juego, código en el editor…; server/open.ts)
export const isPathLocal = (href: string) => /^file:\/\//i.test(href) || /^~\//.test(href) || (/^\/[^/]/.test(href) && !/^\/(api|ws|assets)\b/.test(href));
DOMPurify.addHook('afterSanitizeAttributes', (node: any) => {
  if (node.tagName !== 'A' || !node.hasAttribute?.('href')) return;
  const href = node.getAttribute('href');
  if (isPathLocal(href)) { node.setAttribute('data-local', href); node.setAttribute('title', href); node.removeAttribute('target'); return; }
  node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer');
  if (/^(https?|mailto):/i.test(href)) node.setAttribute('data-enlace', '');
});
// an image of the Mac in a reply (`![](/Users/…/shot.png)`): the game doesn't serve it at that path, so it waits for its
// thumbnail (below)
DOMPurify.addHook('afterSanitizeAttributes', (node: any) => {
  const src = node.tagName === 'IMG' ? node.getAttribute?.('src') : null;
  if (src && isPathLocal(src)) { node.removeAttribute('src'); node.setAttribute('data-local-img', src); }
});
// file: también vale como enlace (DOMPurify, de serie, lo quita): lo de arriba lo convierte en «abrir en el Mac»
const URI_ALLOWED = /^(?:(?:(?:f|ht)tps?|mailto|tel|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// con `base` (la carpeta de la conversación), sus páginas con ruta relativa («tmp/informe.md») también son enlaces
export function markdown(text: string, base?: string): string {
  const html = marked.parse(relativeLinks(text ?? '', base), { async: false }) as string;
  const clean = withThumbnails(DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ALLOWED_URI_REGEXP: URI_ALLOWED }));
  // envolver los bloques de código para añadir «copiar»
  return clean.replace(/<pre><code([^>]*)>/g, '<div class="codigo"><button class="copiar" data-copiar tabindex="-1">' + t('windows.copy') + '</button><pre><code$1>').replace(/<\/code><\/pre>/g, '</code></pre></div>');
}

// Thumbnails of the Mac's images a reply links or embeds: a small picture after the link (or in place of the embed),
// once per image, that opens it in the «Página» window like the link. Only images (IMAGE_FILE); the server gives each
// one its own key (action `enlace.miniatura`, server/localPages.ts)
const isImage = (path: string) => IMAGE_FILE.test(normalizePath(path).replace(/(:\d+){1,2}$/, ''));
function withThumbnails(html: string): string {
  if (!html.includes('data-local')) return html;
  const box = document.createElement('div'); box.innerHTML = html;
  const views = new Set<string>();
  const thumbnail = (path: string, alt: string) => {
    const a = document.createElement('a'); a.className = 'miniatura'; a.setAttribute('data-local', path); a.title = path;
    const img = document.createElement('img'); img.setAttribute('data-miniatura', path); img.alt = alt; a.append(img);
    return a;
  };
  for (const el of box.querySelectorAll<HTMLElement>('a[data-local], img[data-local-img]')) {
    const path = el.getAttribute('data-local') ?? el.getAttribute('data-local-img')!;
    const image = isImage(path) && !views.has(normalizePath(path));
    if (image) views.add(normalizePath(path));
    if (el.tagName === 'A') { if (image && !el.querySelector('img')) el.after(thumbnail(path, '')); continue; }
    // an embed: its thumbnail, or a link with its text if it isn't an image the game can show
    const a = image ? thumbnail(path, el.getAttribute('alt') || path) : Object.assign(document.createElement('a'), { textContent: `[${t('windows.image')}: ${el.getAttribute('alt') || path}]`, title: path });
    if (!image) a.setAttribute('data-local', path);
    el.replaceWith(a);
  }
  return box.innerHTML;
}
// the thumbnail's address, asked once per image (a failed one, again a while later: the file may not exist yet)
const thumbnails = new Map<string, Promise<string | null>>();
const thumbnailUrl = (path: string) => {
  let p = thumbnails.get(path);
  if (!p) {
    thumbnails.set(path, p = client.action<string | null>('enlace.miniatura', { path }).then(u => (typeof u === 'string' && u.startsWith('/pagina/') ? u : null), () => null));
    p.then(u => { if (!u) setTimeout(() => thumbnails.delete(path), 10_000); });
  }
  return p;
};
// an image that isn't there: the embed keeps its text; the one after a link goes
const missingThumbnail = (img: HTMLImageElement) => { const a = img.closest('a.miniatura'); if (img.alt) a?.replaceWith(document.createTextNode(`[${t('windows.image')}: ${img.alt}]`)); else a?.remove(); };
function showThumbnail(img: HTMLImageElement) {
  const path = img.getAttribute('data-miniatura')!;
  img.removeAttribute('data-miniatura');
  thumbnailUrl(path).then(u => {
    if (!u) { missingThumbnail(img); return; }
    // its key is gone (the server restarted): asked once more
    img.onerror = () => { img.onerror = () => missingThumbnail(img); thumbnails.delete(path); thumbnailUrl(path).then(v => { if (v) img.src = v; else missingThumbnail(img); }); };
    img.src = u;
  });
}
// replies are drawn as HTML (dangerouslySetInnerHTML): their thumbnails get their picture as soon as they show up
new MutationObserver(changes => {
  for (const c of changes) for (const n of c.addedNodes) {
    if (!(n instanceof Element)) continue;
    if (n.matches('img[data-miniatura]')) showThumbnail(n as HTMLImageElement);
    else n.querySelectorAll<HTMLImageElement>('img[data-miniatura]').forEach(showThumbnail);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// una sola línea (la descripción de una opción): sin el <p> que la rodea
export const markdownLine = (text: string, base?: string) => markdown(text, base).replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1');

// a link of a reply (to a file of the Mac or a web), before anything else (otherwise the window would open the game
// again or send it outside): a click opens it its default way, a right click shows its options
addEventListener('click', e => { linkClick(e); }, true);
addEventListener('contextmenu', e => { linkClick(e, true); }, true);

// una página que sirve en local otro programa (una página de revisión en la que dejar notas, un servidor de desarrollo)
// enlazada fuera de una respuesta: también en la ventana de páginas, no fuera
addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented) return;
  let u: URL; try { u = new URL(a.href, location.href); } catch { return; }
  if (!isLocalServer(u)) return;
  e.preventDefault(); e.stopPropagation();
  openPage(u.href, u.host + u.pathname.replace(/\/$/, ''));
}, true);

// Por si acaso (un enlace que no haya pasado por aquí): un clic en un enlace del juego a otra página no navega la
// ventana, se abre aparte
addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || a.target === '_blank' || a.hasAttribute('download')) return;
  let u: URL; try { u = new URL(a.href, location.href); } catch { return; }
  if (u.origin === location.origin && u.pathname === location.pathname) return;   // anclas de la propia página
  e.preventDefault();
  if (/^(https?|mailto):$/.test(u.protocol)) window.open(u.href, '_blank', 'noopener');
});

// Delegación: un clic en «copiar» copia el bloque
addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest?.('[data-copiar]') as HTMLButtonElement | null;
  if (!b) return;
  const code = b.parentElement?.querySelector('code')?.textContent ?? '';
  navigator.clipboard?.writeText(code).then(() => { b.textContent = t('windows.copied'); setTimeout(() => (b.textContent = t('windows.copy')), 1200); });
});
