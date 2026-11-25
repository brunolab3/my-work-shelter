// ⌘F, the pure part (web/src/ui/FindBar.tsx draws the bar; server/page/notes.js does the same matching inside a page;
// shared/findText.ts counts a conversation's matches): which target has focus to search in.
export { FIND_MAX, matchOffsets, stepMatch } from '@shared/findText';

export type FindKind = 'intercom' | 'web' | 'page';
interface Focused { tagName: string; closest(selector: string): unknown }
/** What ⌘F searches from what has focus: a browser's <webview> («Web» and the work sites), the «Página» window's
 *  <iframe>, or the intercom (its composer or anything in it, or nothing focused while it's on screen). Any other field,
 *  terminal or editor keeps ⌘F to itself (null) */
export function findKind(active: Focused | null, intercomShown: boolean): FindKind | null {
  if (!active || active.tagName === 'BODY' || active.tagName === 'HTML') return intercomShown ? 'intercom' : null;
  if (active.tagName === 'WEBVIEW' && active.closest('.window-browser')) return 'web';
  if (active.tagName === 'IFRAME' && active.closest('.window-browser')) return 'page';
  if (active.closest('.console')) return 'intercom';
  return null;
}
