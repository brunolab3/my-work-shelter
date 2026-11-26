// A click on a link of a reply (markdown.ts) or of a page in the «Página» window (Browsers.tsx, through
// server/page/notes.js) opens it the first of its ways (shared/linkOptions.ts), inside the game whenever it can; a
// right click opens a small list at it with all of them: the first is marked and taken with Enter, ↑↓ move, Esc or a
// click elsewhere closes it.
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { t } from '@shared/language';
import { webLinkOptions, fileLinkOptions, copyText, type LinkOption, type LinkAction, type LocalKind } from '@shared/linkOptions';
import { openPage, openWeb, canOpenInside, isLocalServer, revealPage, urlSpot } from './Browsers';

// la conversación en la que está el enlace (el intercomunicador marca la suya)
const sessionOfLink = (a: Element) => a.closest('[data-session]')?.getAttribute('data-session') ?? undefined;

// what each option does with a link to a file of the Mac
function runFile(action: LinkAction, path: string, session?: string) {
  if (action === 'copy') return copy(copyText(path));
  if (action === 'finder') return revealPage(path);
  // in the game: a page, an image or a text file in the «Página» window; with `fuera`, where the Mac opens it (server/open.ts)
  client.action('link.local', { path, outside: action === 'mac' })
    .then((r: any) => { if (r?.page) openPage(r.page.url, r.page.title, session, r.page.path); else SFX.click(); })
    .catch(() => SFX.notAllowed());
}
// and with a web one
function runWeb(action: LinkAction, u: URL, session?: string) {
  if (action === 'copy') return copy(copyText(u.href));
  if (action === 'browser') { window.open(u.href, '_blank', 'noopener'); SFX.click(); return; }   // Electron: the system's (electron/main.cjs)
  if (isLocalServer(u)) openPage(u.href, u.host + u.pathname.replace(/\/$/, ''), session);
  else openWeb(u.href);
}
function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => SFX.click(), () => SFX.notAllowed());
}

const webOptions = (u: URL) => webLinkOptions(u.href, { inside: isLocalServer(u) || canOpenInside(u.href), spot: urlSpot(u.href)?.name });

// one list at a time
let open: { box: HTMLElement; goBack: Element | null; pick: (i: number) => void; buttons: HTMLButtonElement[] } | null = null;
export function closeLinkOptions(returnFocus = false) {
  if (!open) return;
  const { box, goBack } = open; open = null;
  box.remove();
  if (returnFocus) (goBack as HTMLElement | null)?.focus?.();
}

function show(a: HTMLElement | undefined, x: number, y: number, options: LinkOption[], title: string, run: (action: LinkAction) => void, notice?: string) {
  closeLinkOptions();
  const box = document.createElement('div');
  box.className = 'options-link interactive'; box.setAttribute('role', 'menu');
  const head = document.createElement('div'); head.className = 'oe-title'; head.textContent = title.length > 64 ? '…' + title.slice(-63) : title; head.title = title;   // a path's end is what tells it apart
  box.append(head);
  if (notice) { const p = document.createElement('div'); p.className = 'oe-notice'; p.textContent = notice; box.append(p); }
  const pick = (i: number) => { const o = options[i]; if (!o) return; closeLinkOptions(); run(o.action); };
  const buttons = options.map((o, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'oe-option' + (i === 0 ? ' oe-default' : ''); b.setAttribute('role', 'menuitem'); b.dataset.action = o.action;
    b.textContent = o.text;
    if (i === 0) { const k = document.createElement('kbd'); k.textContent = '↵'; b.append(k); }
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); pick(i); });
    b.addEventListener('pointerenter', () => b.focus());
    return b;
  });
  box.append(...buttons);
  const pie = document.createElement('div'); pie.className = 'oe-footer'; pie.textContent = t('windows.linkDefaultHint'); box.append(pie);
  document.body.append(box);
  // under the line of the link that was clicked (a link can span two lines), or above it if it doesn't fit; inside the
  // window. Without the link (one in a page's <iframe>), under the pointer
  const r = !a ? { top: y, bottom: y } : [...a.getClientRects()].find(c => x >= c.left - 1 && x <= c.right + 1 && y >= c.top - 1 && y <= c.bottom + 1) ?? a.getBoundingClientRect();
  const { width: w, height: h } = box.getBoundingClientRect();
  const left = Math.max(8, Math.min(x - 12, innerWidth - w - 8));
  const top = r.bottom + 4 + h <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - h);
  box.style.left = `${left}px`; box.style.top = `${top}px`;
  open = { box, goBack: document.activeElement, pick, buttons };
  buttons[0]?.focus({ preventScroll: true });
  SFX.tick();
}

/** A link (a file of the Mac or a web address): with `menu`, its ways at (x, y); otherwise the first one directly */
export function followLink(target: { path: string } | { href: string }, o: { x: number; y: number; menu: boolean; session?: string; anchor?: HTMLElement }) {
  const { x, y, menu, session, anchor } = o;
  const pick = (options: LinkOption[], title: string, run: (action: LinkAction) => void) =>
    menu ? show(anchor, x, y, options, title, run) : run(options[0].action);
  if ('path' in target) {
    const { path } = target;
    client.action<{ juego: boolean; mac: LocalKind }>('link.kind', { path })
      .then(type => pick(fileLinkOptions(type), copyText(path), x => runFile(x, path, session)),
        () => show(anchor, x, y, fileLinkOptions(null), copyText(path), x => runFile(x, path, session), t('windows.linkMissing')));
    return;
  }
  let u: URL; try { u = new URL(target.href, location.href); } catch { return; }
  pick(webOptions(u), copyText(u.href), x => runWeb(x, u, session));
}

/** A click on a link of a reply opens it its first way; a right click (`menu`) shows them all. True if it was one of those links */
export function linkClick(e: MouseEvent, menu = false): boolean {
  const a = (e.target as HTMLElement).closest?.('a[data-local], a[data-link]') as HTMLAnchorElement | null;
  if (!a || (!menu && e.button !== 0)) return false;
  e.preventDefault(); e.stopPropagation();
  const session = sessionOfLink(a), path = a.getAttribute('data-local');
  // a thumbnail is the picture itself: it opens it in the game directly
  if (path && !menu && a.classList.contains('thumbnail')) runFile('juego', path, session);
  else followLink(path ? { path } : { href: a.href }, { x: e.clientX, y: e.clientY, menu, session, anchor: a });
  return true;
}

// the list's keys, before anything else in the game (registered when the module loads: ahead of the intercom's)
addEventListener('keydown', e => {
  if (!open) return;
  const i = open.buttons.indexOf(document.activeElement as HTMLButtonElement), n = open.buttons.length;
  const move = (d: number) => { open!.buttons[((i < 0 ? 0 : i + d) + n) % n]?.focus(); SFX.tick(); };
  if (e.key === 'Escape') closeLinkOptions(true);
  else if (e.key === 'Enter' || e.key === ' ') open.pick(i < 0 ? 0 : i);
  else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) move(1);
  else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) move(-1);
  else if (e.metaKey || e.ctrlKey || e.altKey) { closeLinkOptions(); return; }   // a shortcut: it's for the game
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
// a click elsewhere, scrolling the reply or leaving the window closes it
addEventListener('pointerdown', e => { if (open && !open.box.contains(e.target as Node)) closeLinkOptions(); }, true);
addEventListener('scroll', e => { if (open && !open.box.contains(e.target as Node)) closeLinkOptions(); }, true);
addEventListener('blur', () => closeLinkOptions());
addEventListener('resize', () => closeLinkOptions());
