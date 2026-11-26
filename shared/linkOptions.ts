// The ways to open a link of a reply (web/src/ui/linkOptions.ts draws them): the first one is the default, which a
// click runs directly (a right click shows them all). Inside the game first whenever it can be seen there.
import { t } from './language.ts';

export type LinkAction = 'juego' | 'browser' | 'mac' | 'finder' | 'copy';
export interface LinkOption { action: LinkAction; text: string }
// where the server would open a file of the Mac (server/open.ts, localKind)
export type LocalKind = 'folder' | 'web' | 'preview' | 'editor' | 'finder';

/** A web link: inside (its site's browser, the «Web» window or, for a page another program serves on this Mac, the
 *  «Página» one) when it can, the system browser (or mail) and copying it */
export function webLinkOptions(href: string, o: { inside: boolean; spot?: string }): LinkOption[] {
  const email = /^mailto:/i.test(href);
  return [
    ...(o.inside && !email ? [{ action: 'juego' as const, text: o.spot ? t('windows.linkOpenInSpot', { name: o.spot }) : t('windows.linkOpenInGame') }] : []),
    { action: 'browser', text: email ? t('windows.linkOpenInMail') : t('windows.linkOpenInBrowser') },
    { action: 'copy', text: email ? t('windows.linkCopyAddress') : t('windows.linkCopy') },
  ];
}

const ON_MAC: Record<LocalKind, string | null> = {
  folder: 'windows.linkOpenInFinder', web: 'windows.linkOpenWithDefaultApp', preview: 'windows.linkOpenInPreview', editor: 'windows.linkOpenInEditor', finder: null,
};
/** A file of the Mac (null: it isn't there): in the game (a page, an image or text), where the Mac opens it without running
 *  anything, revealed in Finder and copying its path */
export function fileLinkOptions(type: { juego: boolean; mac: LocalKind } | null): LinkOption[] {
  const onMac = type && ON_MAC[type.mac];
  return [
    ...(type?.juego ? [{ action: 'juego' as const, text: t('windows.linkOpenInGame') }] : []),
    ...(onMac ? [{ action: 'mac' as const, text: t(onMac) }] : []),
    ...(type && type.mac !== 'folder' ? [{ action: 'finder' as const, text: t('windows.linkRevealInFinder') }] : []),
    { action: 'copy', text: t('windows.linkCopyPath') },
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
export function pageLinkTarget(link: unknown, page: string): { path: string } | { href: string } | null {
  const href = typeof link === 'string' ? link.trim() : '';
  if (!href || href.startsWith('#')) return null;
  if (href.startsWith('~/')) return { path: href.split(/[?#]/)[0] };
  let u: URL; try { u = new URL(href, new URL('file://' + encodeURI(page))); } catch { return null; }
  if (/^(https?|mailto):$/.test(u.protocol)) return { href: u.href };
  if (u.protocol !== 'file:') return null;
  const path = decodeURIComponent(u.pathname);
  return LOCAL.test(path) ? { path } : null;
}
