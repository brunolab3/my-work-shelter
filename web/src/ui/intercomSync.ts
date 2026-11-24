// The intercoms from the live sessions (`sync` in Dialog.tsx), as pure logic. Each live conversation has its tab: one
// that starts by itself (a room message, a scheduled message, a task from `send_to_room`, a restart) opens quietly in
// its talker's window, which waits in the bar if it had none, and never changes the tab in view of any window: the
// Overseer may be typing there, and only what he does (a click, ⌘K, talking to a dweller) changes what is in front.
// The one exception follows the Overseer: when the conversation he is looking at moves to a worktree, its tab (with
// what he had typed) moves to the copy's window, in front there, and the intercom switches to that copy (`handoff`).
// A conversation that took over from another with a handoff (`handoffFrom`) takes that one's tab, with what was typed.
// Tabs of closed conversations go, unless something is typed in them or they are in view: they stay to resume it.
// Tabs with no conversation (a new job, the archive, the menu, a closed one to resume) go once the Overseer leaves
// them, unless something is typed or attached in them (`dropLeft`).
import type { SessionSummary, HistoryElement } from '@shared/protocol';
import type { AttachmentLocal } from './inputLine';

export type View = { type: 'menu' } | { type: 'nuevo'; resume?: HistoryElement } | { type: 'historial' } | { type: 'visitantes' } | { type: 'ficha' } | { type: 'sesion'; sessionId: string };
// memory: the tab's conversation (to resume it with what was typed if it closes without the Overseer closing it)
export interface TabCom { id: string; view: View; draft?: string; attachments?: AttachmentLocal[]; reason?: { request: string; text: string }; sessionWait?: boolean; memory?: HistoryElement }
export interface WindowCom { dwellerId: string; tabs: TabCom[]; active: string; maximized: boolean; z: number; known: string[]; confirm?: string[] }

export const readyAttachments = (l?: AttachmentLocal[]) => (l ?? []).filter(a => a.path && !a.error);
export const withText = (p: TabCom) => !!p.draft?.trim() || readyAttachments(p.attachments).length > 0;
/** No conversation, nothing typed and no attachment (ready or still uploading): leaving it loses nothing */
export const unused = (p: TabCom) => p.view.type !== 'sesion' && !p.sessionWait && !p.draft?.trim() && !(p.attachments ?? []).some(a => !a.error);

/** What is in view: the intercom in front and its tab */
export interface InView { talking: string | null; active?: string }
/** The intercoms after the Overseer left a tab (another tab, or the intercom itself): an unused one he left goes, and
 *  so do every unused tab of an intercom he left and that intercom if none remain; `list` itself when nothing goes */
export function dropLeft(list: WindowCom[], before: InView, now: InView): WindowCom[] {
  if (!before.talking || (before.talking === now.talking && before.active === now.active)) return list;
  const v = list.find(x => x.dwellerId === before.talking); if (!v) return list;
  const sameWindow = before.talking === now.talking;
  const tabs = v.tabs.filter(p => !unused(p) || (sameWindow ? p.id !== before.active || p.id === now.active : false));
  if (tabs.length === v.tabs.length) return list;
  if (!tabs.length) return list.filter(x => x !== v);
  const confirm = v.confirm?.filter(id => tabs.some(p => p.id === id));
  const active = tabs.some(p => p.id === v.active) ? v.active : tabs[Math.min(Math.max(0, v.tabs.findIndex(p => p.id === v.active)), tabs.length - 1)].id;
  return list.map(x => (x === v ? { ...v, tabs, active, confirm: confirm?.length ? confirm : undefined } : x));
}

export interface SyncInput {
  list: WindowCom[];
  sessions: Record<string, SessionSummary>;
  /** whose window a session's tab belongs to (a dweller or a holographic copy) */
  owner: (s: SessionSummary) => string;
  /** sessions already sent to close (they don't open a tab again) */
  closing: Set<string>;
  /** the intercom in front, if any */
  talking: string | null;
  newId: () => string;
  nextZ: () => number;
}
/** The intercoms after the sessions changed; `next` is `list` itself when nothing changed */
export function syncIntercoms({ list, sessions, owner: ownerOf, closing, talking, newId, nextZ }: SyncInput): { next: WindowCom[]; handoff: string | null } {
  let changed = false, handoff: string | null = null;
  const liveByDweller = new Map<string, SessionSummary[]>(), owner = new Map<string, string>();
  const moved = new Map<string, TabCom>();   // tabs of conversations that move to another window (a copy)
  for (const s of Object.values(sessions)) if (s.state !== 'cerrada' && !closing.has(s.id)) { const d = ownerOf(s); owner.set(s.id, d); liveByDweller.set(d, [...(liveByDweller.get(d) ?? []), s]); }
  const successor = new Map<string, SessionSummary>();
  for (const s of Object.values(sessions)) if (s.handoffFrom && owner.has(s.id)) successor.set(s.handoffFrom, s);
  for (const v of list) for (const p of v.tabs) if (p.view.type === 'sesion' && owner.has(p.view.sessionId) && owner.get(p.view.sessionId) !== v.dwellerId) moved.set(p.view.sessionId, p);
  // the conversation in view in the intercom in front, if it moves: it is followed to its new window
  const front = list.find(v => v.dwellerId === talking), inView = front?.tabs.find(p => p.id === front.active);
  const followed = inView?.view.type === 'sesion' && moved.has(inView.view.sessionId) ? inView.view.sessionId : undefined;
  let next = list.map(v => {
    let touched = false;
    let tabs = v.tabs.flatMap((p): TabCom[] => {
      if (p.view.type !== 'sesion') return [p];
      const after = successor.get(p.view.sessionId);
      if (after && owner.get(after.id) === v.dwellerId && !v.tabs.some(q => q.view.type === 'sesion' && q.view.sessionId === after.id)) {
        touched = true;
        return [{ ...p, view: { type: 'sesion', sessionId: after.id }, memory: undefined }];
      }
      const s = sessions[p.view.sessionId], d = owner.get(p.view.sessionId);
      if (s && s.state !== 'cerrada' && d === v.dwellerId) {
        // note which conversation it is, in case it later closes with something typed
        if (s.claudeId && (p.memory?.claudeId !== s.claudeId || p.memory.title !== s.title)) { touched = true; return [{ ...p, memory: { claudeId: s.claudeId, title: s.title, modified: s.updated, cwd: s.cwd } }]; }
        return [p];
      }
      if (d && d !== v.dwellerId) return [];                // moved to another window
      if (!withText(p) && !(p.memory && v === front && p.id === v.active)) return [];
      // closed (or lost in a restart) with something typed, or in view: the tab stays to resume it until the Overseer
      // closes it (or, empty, leaves it: dropLeft)
      touched = true;
      return [{ ...p, view: p.memory ? { type: 'nuevo', resume: { ...p.memory, modified: Date.now() } } : { type: 'nuevo' } }];
    });
    if (v === front && followed && !tabs.some(p => p.id === front.active)) handoff = owner.get(followed)!;
    const known = new Set(v.known);
    let active = v.active;
    for (const s of (liveByDweller.get(v.dwellerId) ?? []).sort((a, b) => a.created - b.created)) {
      if (known.has(s.id) && !moved.has(s.id)) continue;
      if (tabs.some(p => p.sessionWait)) continue;   // a tab of this window is opening it
      known.add(s.id);
      if (tabs.some(p => p.view.type === 'sesion' && p.view.sessionId === s.id)) continue;
      // a new tab, quietly at the end: the one in view stays, unless this is the followed conversation
      const id = newId(), m = moved.get(s.id);
      tabs = [...tabs, { ...m, id, view: { type: 'sesion', sessionId: s.id } }];
      if (s.id === followed) active = id;
    }
    if (!touched && tabs.length === v.tabs.length && known.size === v.known.length && active === v.active) return v;
    changed = true;
    if (!tabs.length) {
      if (talking !== v.dwellerId || handoff) return null;
      tabs = [{ id: newId(), view: { type: 'menu' } }];
    }
    // the tab in view closed: its neighbour, as closing it by hand
    if (!tabs.some(p => p.id === active)) active = tabs[Math.min(Math.max(0, v.tabs.findIndex(p => p.id === v.active)), tabs.length - 1)].id;
    return { ...v, tabs, active, known: [...known] };
  }).filter(Boolean) as WindowCom[];
  for (const [hid, sess] of liveByDweller) if (!next.some(v => v.dwellerId === hid)) {
    changed = true;
    const tabs: TabCom[] = sess.sort((a, b) => a.created - b.created).map(s => ({ ...moved.get(s.id), id: newId(), view: { type: 'sesion', sessionId: s.id } }));
    const i = followed ? sess.findIndex(s => s.id === followed) : -1;
    next = [...next, { dwellerId: hid, tabs, active: tabs[i >= 0 ? i : tabs.length - 1].id, maximized: false, z: nextZ(), known: sess.map(s => s.id) }];
  }
  return { next: changed ? next : list, handoff };
}
