// A click on a link of a reply (markdown.ts) or of a page in the «Página» window (Navegadores.tsx, through
// server/pagina/notas.js) opens it the first of its ways (shared/opcionesEnlace.ts), inside the game whenever it can; a
// right click opens a small list at it with all of them: the first is marked and taken with Enter, ↑↓ move, Esc or a
// click elsewhere closes it.
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t } from '@shared/idioma';
import { webLinkOptions, fileLinkOptions, copyText, type LinkOption, type LinkAction, type LocalKind } from '@shared/opcionesEnlace';
import { openPage, openWeb, canOpenInside, isLocalServer, revealPage, urlSpot } from './Navegadores';

// la conversación en la que está el enlace (el intercomunicador marca la suya)
const sessionOfLink = (a: Element) => a.closest('[data-sesion]')?.getAttribute('data-sesion') ?? undefined;

// what each option does with a link to a file of the Mac
function runFile(accion: LinkAction, ruta: string, sesion?: string) {
  if (accion === 'copiar') return copy(copyText(ruta));
  if (accion === 'finder') return revealPage(ruta);
  // in the game: a page or an image in the «Página» window; with `fuera`, where the Mac opens it (server/abrir.ts)
  cliente.accion('enlace.local', { ruta, fuera: accion === 'mac' })
    .then((r: any) => { if (r?.pagina) openPage(r.pagina.url, r.pagina.titulo, sesion, r.pagina.ruta); else SFX.clic(); })
    .catch(() => SFX.noAllowed());
}
// and with a web one
function runWeb(accion: LinkAction, u: URL, sesion?: string) {
  if (accion === 'copiar') return copy(copyText(u.href));
  if (accion === 'navegador') { window.open(u.href, '_blank', 'noopener'); SFX.clic(); return; }   // Electron: the system's (electron/main.cjs)
  if (isLocalServer(u)) openPage(u.href, u.host + u.pathname.replace(/\/$/, ''), sesion);
  else openWeb(u.href);
}
function copy(texto: string) {
  navigator.clipboard?.writeText(texto).then(() => SFX.clic(), () => SFX.noAllowed());
}

const webOptions = (u: URL) => webLinkOptions(u.href, { dentro: isLocalServer(u) || canOpenInside(u.href), sitio: urlSpot(u.href)?.nombre });

// one list at a time
let abierta: { caja: HTMLElement; volver: Element | null; elegir: (i: number) => void; botones: HTMLButtonElement[] } | null = null;
export function closeLinkOptions(devolverFoco = false) {
  if (!abierta) return;
  const { caja, volver } = abierta; abierta = null;
  caja.remove();
  if (devolverFoco) (volver as HTMLElement | null)?.focus?.();
}

function show(a: HTMLElement | undefined, x: number, y: number, opciones: LinkOption[], titulo: string, run: (accion: LinkAction) => void, aviso?: string) {
  closeLinkOptions();
  const caja = document.createElement('div');
  caja.className = 'opciones-enlace interactivo'; caja.setAttribute('role', 'menu');
  const cabeza = document.createElement('div'); cabeza.className = 'oe-titulo'; cabeza.textContent = titulo.length > 64 ? '…' + titulo.slice(-63) : titulo; cabeza.title = titulo;   // a path's end is what tells it apart
  caja.append(cabeza);
  if (aviso) { const p = document.createElement('div'); p.className = 'oe-aviso'; p.textContent = aviso; caja.append(p); }
  const elegir = (i: number) => { const o = opciones[i]; if (!o) return; closeLinkOptions(); run(o.accion); };
  const botones = opciones.map((o, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'oe-opcion' + (i === 0 ? ' oe-defecto' : ''); b.setAttribute('role', 'menuitem'); b.dataset.accion = o.accion;
    b.textContent = o.texto;
    if (i === 0) { const k = document.createElement('kbd'); k.textContent = '↵'; b.append(k); }
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); elegir(i); });
    b.addEventListener('pointerenter', () => b.focus());
    return b;
  });
  caja.append(...botones);
  const pie = document.createElement('div'); pie.className = 'oe-pie'; pie.textContent = t('windows.linkDefaultHint'); caja.append(pie);
  document.body.append(caja);
  // under the line of the link that was clicked (a link can span two lines), or above it if it doesn't fit; inside the
  // window. Without the link (one in a page's <iframe>), under the pointer
  const r = !a ? { top: y, bottom: y } : [...a.getClientRects()].find(c => x >= c.left - 1 && x <= c.right + 1 && y >= c.top - 1 && y <= c.bottom + 1) ?? a.getBoundingClientRect();
  const { width: w, height: h } = caja.getBoundingClientRect();
  const left = Math.max(8, Math.min(x - 12, innerWidth - w - 8));
  const top = r.bottom + 4 + h <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
  caja.style.left = `${left}px`; caja.style.top = `${top}px`;
  abierta = { caja, volver: document.activeElement, elegir, botones };
  botones[0]?.focus({ preventScroll: true });
  SFX.tick();
}

/** A link (a file of the Mac or a web address): with `menu`, its ways at (x, y); otherwise the first one directly */
export function followLink(destino: { ruta: string } | { href: string }, o: { x: number; y: number; menu: boolean; sesion?: string; anchor?: HTMLElement }) {
  const { x, y, menu, sesion, anchor } = o;
  const elegir = (opciones: LinkOption[], titulo: string, run: (accion: LinkAction) => void) =>
    menu ? show(anchor, x, y, opciones, titulo, run) : run(opciones[0].accion);
  if ('ruta' in destino) {
    const { ruta } = destino;
    cliente.accion<{ juego: boolean; mac: LocalKind }>('enlace.tipo', { ruta })
      .then(tipo => elegir(fileLinkOptions(tipo), copyText(ruta), x => runFile(x, ruta, sesion)),
        () => show(anchor, x, y, fileLinkOptions(null), copyText(ruta), x => runFile(x, ruta, sesion), t('windows.linkMissing')));
    return;
  }
  let u: URL; try { u = new URL(destino.href, location.href); } catch { return; }
  elegir(webOptions(u), copyText(u.href), x => runWeb(x, u, sesion));
}

/** A click on a link of a reply opens it its first way; a right click (`menu`) shows them all. True if it was one of those links */
export function linkClick(e: MouseEvent, menu = false): boolean {
  const a = (e.target as HTMLElement).closest?.('a[data-local], a[data-enlace]') as HTMLAnchorElement | null;
  if (!a || (!menu && e.button !== 0)) return false;
  e.preventDefault(); e.stopPropagation();
  const sesion = sessionOfLink(a), ruta = a.getAttribute('data-local');
  // a thumbnail is the picture itself: it opens it in the game directly
  if (ruta && !menu && a.classList.contains('miniatura')) runFile('juego', ruta, sesion);
  else followLink(ruta ? { ruta } : { href: a.href }, { x: e.clientX, y: e.clientY, menu, sesion, anchor: a });
  return true;
}

// the list's keys, before anything else in the game (registered when the module loads: ahead of the intercom's)
addEventListener('keydown', e => {
  if (!abierta) return;
  const i = abierta.botones.indexOf(document.activeElement as HTMLButtonElement), n = abierta.botones.length;
  const mover = (d: number) => { abierta!.botones[((i < 0 ? 0 : i + d) + n) % n]?.focus(); SFX.tick(); };
  if (e.key === 'Escape') closeLinkOptions(true);
  else if (e.key === 'Enter' || e.key === ' ') abierta.elegir(i < 0 ? 0 : i);
  else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) mover(1);
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) mover(-1);
  else if (e.metaKey || e.ctrlKey || e.altKey) { closeLinkOptions(); return; }   // a shortcut: it's for the game
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
// a click elsewhere, scrolling the reply or leaving the window closes it
addEventListener('pointerdown', e => { if (abierta && !abierta.caja.contains(e.target as Node)) closeLinkOptions(); }, true);
addEventListener('scroll', e => { if (abierta && !abierta.caja.contains(e.target as Node)) closeLinkOptions(); }, true);
addEventListener('blur', () => closeLinkOptions());
addEventListener('resize', () => closeLinkOptions());
