// Markdown seguro para las respuestas de los habitantes (bloques de código con botón de copiar).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { openPage, isLocalServer } from './Navegadores';
import { t } from '@shared/idioma';
import { localPathLinks } from './rutasEnlace';
import { relativeLinks, IMAGE_FILE, normalizePath } from '@shared/paginasSesion';

marked.setOptions({ gfm: true, breaks: false });
marked.use(localPathLinks);   // «/Users/…/compare.html» suelto también es un enlace
// nada se carga desde fuera al leer una respuesta (privacidad): las imágenes remotas se quedan en su texto alternativo
DOMPurify.addHook('uponSanitizeElement', (nodo: any, datos) => {
  if (datos.tagName === 'img' && /^(https?:)?\/\//i.test(nodo.getAttribute?.('src') ?? '')) { const txt = document.createTextNode(`[${t('windows.image')}: ${nodo.getAttribute('alt') || nodo.getAttribute('src')}]`); nodo.replaceWith(txt); }
});

// los enlaces de una respuesta nunca llevan la ventana del juego a otra página: se abren aparte (Electron los manda al
// navegador del sistema, solo http, https y mailto: electron/main.cjs). Los que apuntan a un archivo del Mac
// («/Users/…/informe.html», «~/…», «file:///…») no son páginas del juego: los abre el servidor (acción `enlace.local`:
// una página web en tu navegador, código en el editor…; server/abrir.ts)
export const isPathLocal = (href: string) => /^file:\/\//i.test(href) || /^~\//.test(href) || (/^\/[^/]/.test(href) && !/^\/(api|ws|assets)\b/.test(href));
DOMPurify.addHook('afterSanitizeAttributes', (nodo: any) => {
  if (nodo.tagName !== 'A' || !nodo.hasAttribute?.('href')) return;
  const href = nodo.getAttribute('href');
  if (isPathLocal(href)) { nodo.setAttribute('data-local', href); nodo.setAttribute('title', href); nodo.removeAttribute('target'); return; }
  nodo.setAttribute('target', '_blank'); nodo.setAttribute('rel', 'noopener noreferrer');
});
// an image of the Mac in a reply (`![](/Users/…/shot.png)`): the game doesn't serve it at that path, so it waits for its
// thumbnail (below)
DOMPurify.addHook('afterSanitizeAttributes', (nodo: any) => {
  const src = nodo.tagName === 'IMG' ? nodo.getAttribute?.('src') : null;
  if (src && isPathLocal(src)) { nodo.removeAttribute('src'); nodo.setAttribute('data-local-img', src); }
});
// file: también vale como enlace (DOMPurify, de serie, lo quita): lo de arriba lo convierte en «abrir en el Mac»
const URI_ALLOWED = /^(?:(?:(?:f|ht)tps?|mailto|tel|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

// con `base` (la carpeta de la conversación), sus páginas con ruta relativa («tmp/informe.md») también son enlaces
export function markdown(texto: string, base?: string): string {
  const html = marked.parse(relativeLinks(texto ?? '', base), { async: false }) as string;
  const limpio = withThumbnails(DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ALLOWED_URI_REGEXP: URI_ALLOWED }));
  // envolver los bloques de código para añadir «copiar»
  return limpio.replace(/<pre><code([^>]*)>/g, '<div class="codigo"><button class="copiar" data-copiar tabindex="-1">' + t('windows.copy') + '</button><pre><code$1>').replace(/<\/code><\/pre>/g, '</code></pre></div>');
}

// Thumbnails of the Mac's images a reply links or embeds: a small picture after the link (or in place of the embed),
// once per image, that opens it in the «Página» window like the link. Only images (IMAGE_FILE); the server gives each
// one its own key (action `enlace.miniatura`, server/paginasLocales.ts)
const isImage = (ruta: string) => IMAGE_FILE.test(normalizePath(ruta).replace(/(:\d+){1,2}$/, ''));
function withThumbnails(html: string): string {
  if (!html.includes('data-local')) return html;
  const caja = document.createElement('div'); caja.innerHTML = html;
  const vistas = new Set<string>();
  const thumbnail = (ruta: string, alt: string) => {
    const a = document.createElement('a'); a.className = 'miniatura'; a.setAttribute('data-local', ruta); a.title = ruta;
    const img = document.createElement('img'); img.setAttribute('data-miniatura', ruta); img.alt = alt; a.append(img);
    return a;
  };
  for (const el of caja.querySelectorAll<HTMLElement>('a[data-local], img[data-local-img]')) {
    const ruta = el.getAttribute('data-local') ?? el.getAttribute('data-local-img')!;
    const imagen = isImage(ruta) && !vistas.has(normalizePath(ruta));
    if (imagen) vistas.add(normalizePath(ruta));
    if (el.tagName === 'A') { if (imagen && !el.querySelector('img')) el.after(thumbnail(ruta, '')); continue; }
    // an embed: its thumbnail, or a link with its text if it isn't an image the game can show
    const a = imagen ? thumbnail(ruta, el.getAttribute('alt') || ruta) : Object.assign(document.createElement('a'), { textContent: `[${t('windows.image')}: ${el.getAttribute('alt') || ruta}]`, title: ruta });
    if (!imagen) a.setAttribute('data-local', ruta);
    el.replaceWith(a);
  }
  return caja.innerHTML;
}
// the thumbnail's address, asked once per image (a failed one, again a while later: the file may not exist yet)
const thumbnails = new Map<string, Promise<string | null>>();
const thumbnailUrl = (ruta: string) => {
  let p = thumbnails.get(ruta);
  if (!p) {
    thumbnails.set(ruta, p = cliente.accion<string | null>('enlace.miniatura', { ruta }).then(u => (typeof u === 'string' && u.startsWith('/pagina/') ? u : null), () => null));
    p.then(u => { if (!u) setTimeout(() => thumbnails.delete(ruta), 10_000); });
  }
  return p;
};
// an image that isn't there: the embed keeps its text; the one after a link goes
const missingThumbnail = (img: HTMLImageElement) => { const a = img.closest('a.miniatura'); if (img.alt) a?.replaceWith(document.createTextNode(`[${t('windows.image')}: ${img.alt}]`)); else a?.remove(); };
function showThumbnail(img: HTMLImageElement) {
  const ruta = img.getAttribute('data-miniatura')!;
  img.removeAttribute('data-miniatura');
  thumbnailUrl(ruta).then(u => {
    if (!u) { missingThumbnail(img); return; }
    // its key is gone (the server restarted): asked once more
    img.onerror = () => { img.onerror = () => missingThumbnail(img); thumbnails.delete(ruta); thumbnailUrl(ruta).then(v => { if (v) img.src = v; else missingThumbnail(img); }); };
    img.src = u;
  });
}
// replies are drawn as HTML (dangerouslySetInnerHTML): their thumbnails get their picture as soon as they show up
new MutationObserver(cambios => {
  for (const c of cambios) for (const n of c.addedNodes) {
    if (!(n instanceof Element)) continue;
    if (n.matches('img[data-miniatura]')) showThumbnail(n as HTMLImageElement);
    else n.querySelectorAll<HTMLImageElement>('img[data-miniatura]').forEach(showThumbnail);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// una sola línea (la descripción de una opción): sin el <p> que la rodea
export const markdownLine = (texto: string, base?: string) => markdown(texto, base).replace(/^<p>([\s\S]*)<\/p>\s*$/, '$1');

// un enlace a un archivo del Mac: lo abre el servidor (antes que nada: si no, la ventana abriría el juego otra vez)
addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a[data-local]') as HTMLAnchorElement | null;
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  // una página HTML (un plan, un informe) se ve dentro, en la ventana de páginas; lo demás lo abre el Mac
  cliente.accion('enlace.local', { ruta: a.getAttribute('data-local') }).then((r: any) => { if (r?.pagina) openPage(r.pagina.url, r.pagina.titulo, sessionOfLink(a), r.pagina.ruta); else SFX.clic(); }).catch(() => SFX.noAllowed());
}, true);
// la conversación en la que está el enlace (el intercomunicador marca la suya)
const sessionOfLink = (a: Element) => a.closest('[data-sesion]')?.getAttribute('data-sesion') ?? undefined;

// una página que sirve en local otro programa (una página de revisión en la que dejar notas, un servidor de desarrollo):
// también en la ventana de páginas, no fuera
addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || a.hasAttribute('data-local')) return;
  let u: URL; try { u = new URL(a.href, location.href); } catch { return; }
  if (!isLocalServer(u)) return;
  e.preventDefault(); e.stopPropagation();
  openPage(u.href, u.host + u.pathname.replace(/\/$/, ''), sessionOfLink(a));
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
