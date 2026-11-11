// Markdown seguro para las respuestas de los habitantes (bloques de código con botón de copiar).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t } from '@shared/idioma';

marked.setOptions({ gfm: true, breaks: false });
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
// file: también vale como enlace (DOMPurify, de serie, lo quita): lo de arriba lo convierte en «abrir en el Mac»
const URI_ALLOWED = /^(?:(?:(?:f|ht)tps?|mailto|tel|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export function markdown(texto: string): string {
  const html = marked.parse(texto ?? '', { async: false }) as string;
  const limpio = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ALLOWED_URI_REGEXP: URI_ALLOWED });
  // envolver los bloques de código para añadir «copiar»
  return limpio.replace(/<pre><code([^>]*)>/g, '<div class="codigo"><button class="copiar" data-copiar tabindex="-1">' + t('windows.copy') + '</button><pre><code$1>').replace(/<\/code><\/pre>/g, '</code></pre></div>');
}

// un enlace a un archivo del Mac: lo abre el servidor (antes que nada: si no, la ventana abriría el juego otra vez)
addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a[data-local]') as HTMLAnchorElement | null;
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  cliente.accion('enlace.local', { ruta: a.getAttribute('data-local') }).then(() => SFX.clic()).catch(() => SFX.noAllowed());
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
