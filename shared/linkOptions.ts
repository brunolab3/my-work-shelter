// The ways to open a link of a reply (web/src/ui/linkOptions.ts draws them): the first one is the default, which a
// click runs directly (a right click shows them all). Inside the game first whenever it can be seen there.
import { t } from './language.ts';

export type LinkAction = 'juego' | 'navegador' | 'mac' | 'finder' | 'copiar';
export interface LinkOption { accion: LinkAction; texto: string }
// where the server would open a file of the Mac (server/open.ts, localKind)
export type LocalKind = 'carpeta' | 'web' | 'vista' | 'editor' | 'finder';

/** A web link: inside (its site's browser, the «Web» window or, for a page another program serves on this Mac, the
 *  «Página» one) when it can, the system browser (or mail) and copying it */
export function webLinkOptions(href: string, o: { dentro: boolean; sitio?: string }): LinkOption[] {
  const correo = /^mailto:/i.test(href);
  return [
    ...(o.dentro && !correo ? [{ accion: 'juego' as const, texto: o.sitio ? t('windows.linkOpenInSpot', { nombre: o.sitio }) : t('windows.linkOpenInGame') }] : []),
    { accion: 'navegador', texto: correo ? t('windows.linkOpenInMail') : t('windows.linkOpenInBrowser') },
    { accion: 'copiar', texto: correo ? t('windows.linkCopyAddress') : t('windows.linkCopy') },
  ];
}

const ON_MAC: Record<LocalKind, string | null> = {
  carpeta: 'windows.linkOpenInFinder', web: 'windows.linkOpenWithDefaultApp', vista: 'windows.linkOpenInPreview', editor: 'windows.linkOpenInEditor', finder: null,
};
/** A file of the Mac (null: it isn't there): in the game (a page or an image), where the Mac opens it without running
 *  anything, revealed in Finder and copying its path */
export function fileLinkOptions(tipo: { juego: boolean; mac: LocalKind } | null): LinkOption[] {
  const enMac = tipo && ON_MAC[tipo.mac];
  return [
    ...(tipo?.juego ? [{ accion: 'juego' as const, texto: t('windows.linkOpenInGame') }] : []),
    ...(enMac ? [{ accion: 'mac' as const, texto: t(enMac) }] : []),
    ...(tipo && tipo.mac !== 'carpeta' ? [{ accion: 'finder' as const, texto: t('windows.linkRevealInFinder') }] : []),
    { accion: 'copiar', texto: t('windows.linkCopyPath') },
  ];
}

/** What «copy» puts in the clipboard: the address of a mail link, the path of a file:// one, the rest as written */
export function copyText(href: string): string {
  if (/^mailto:/i.test(href)) return decodeURIComponent(href.slice(7).split('?')[0]);
  if (/^file:\/\//i.test(href)) { try { return decodeURIComponent(new URL(href).pathname); } catch {} }
  return href;
}

// files of the Mac a page may link: the same places a reply's links may point at (shared/sessionPages.ts)
const LOCAL = /^(?:\/Users\/|~\/|\/(?:private\/)?tmp\/|\/(?:private\/)?var\/folders\/)/;
/** What a link of a page of the Mac (at `pagina`) points at, from its raw href: a file of the Mac (a relative one, next
 *  to the page), a web or mail address, or nothing the game opens (null) */
export function pageLinkTarget(enlace: unknown, pagina: string): { ruta: string } | { href: string } | null {
  const href = typeof enlace === 'string' ? enlace.trim() : '';
  if (!href || href.startsWith('#')) return null;
  if (href.startsWith('~/')) return { ruta: href.split(/[?#]/)[0] };
  let u: URL; try { u = new URL(href, new URL('file://' + encodeURI(pagina))); } catch { return null; }
  if (/^(https?|mailto):$/.test(u.protocol)) return { href: u.href };
  if (u.protocol !== 'file:') return null;
  const ruta = decodeURIComponent(u.pathname);
  return LOCAL.test(ruta) ? { ruta } : null;
}
