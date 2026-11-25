// ⌘F: find text in what has focus (findKind in findText.ts), with a small bar at the top right of it. Enter or ↓ goes to
// the next match, ⇧Enter or ↑ to the previous one, Esc closes and gives the focus back.
// - The intercom: the whole conversation, counted by the server (Sessions.find: memory, then the transcript on disk). The
//   entries it holds are marked in place (CSS Custom Highlights, without touching the log's DOM); a match in an entry not
//   held yet brings in the older pages until it is, as scrolling to the top does. New entries are counted as they come.
// - A browser («Web» and the work sites, a <webview>): Electron's own findInPage.
// - The «Página» window (a sandboxed <iframe>): server/page/notes.js finds inside the page and answers by postMessage;
//   a page another program serves has no notes layer and says it can't be searched.
// With the focus inside a <webview> or the <iframe>, ⌘F doesn't reach this page: Electron's Edit → Find menu item calls
// window.__findShortcut (electron/main.cjs) when the page there didn't take ⌘F itself.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Store } from './store';
import { live, findInLog, loadOlder } from '../net/client';
import { t } from '@shared/language';
import { MAC } from './windows';
import { FIND_MAX, findKind, matchOffsets, stepMatch, type FindKind } from './findText';
import { hitAt, indexOfHit, type LogHit, type LogHits } from '@shared/findText';

interface Runner { search(query: string, dir: 1 | -1, again: boolean): void; clear(): void; stop(): void }
interface FindState { open: boolean; kind: FindKind | null; host: HTMLElement | null; target: HTMLElement | null; query: string; n: number; i: number; unavailable: boolean }
const CLOSED: FindState = { open: false, kind: null, host: null, target: null, query: '', n: 0, i: -1, unavailable: false };
export const finder = new Store<FindState>(CLOSED);
let runner: Runner | null = null, before: HTMLElement | null = null;
const input = { el: null as HTMLInputElement | null };
const report = (n: number, i: number) => finder.set({ n, i, unavailable: false });

/** The conversation to search: the one with the focus (its composer is in its window), else the first one on screen */
function intercomSession(active: Element | null): HTMLElement | null {
  const own = active?.closest('.console');
  const pool = [...(own ?? document).querySelectorAll<HTMLElement>(own ? '.session' : '.console .session')];
  return pool.find(s => s.checkVisibility?.() ?? true) ?? null;
}

/** ⌘F: opens the bar on what has focus (or back to its field if it's open); false if there's nothing to search there */
export function findShortcut(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (finder.get().open && active?.closest('.bar-find')) { input.el?.select(); return true; }
  const session = intercomSession(active);
  const kind = findKind(active, !!session);
  if (!kind) return false;
  const target = kind === 'intercom' ? session?.querySelector<HTMLElement>('.canvas') ?? null : active;
  const host = kind === 'intercom' ? session : target?.closest<HTMLElement>('.vn-body');
  if (!target || !host) return false;
  const { open, target: was, query } = finder.get();
  if (open && was === target) { input.el?.focus(); input.el?.select(); return true; }
  closeFind(false);
  before = active && active !== document.body ? active : null;
  runner = kind === 'intercom' ? logRunner(host.getAttribute('data-session') ?? '', target) : kind === 'web' ? webviewRunner(target as Webview) : frameRunner(target as HTMLIFrameElement);
  finder.set({ ...CLOSED, open: true, kind, host, target, query });
  if (query) runner.search(query, 1, false);
  return true;
}

export function closeFind(backToFocus = true) {
  if (!finder.get().open) return;
  runner?.stop(); runner = null;
  finder.set({ ...CLOSED, query: finder.get().query });
  if (backToFocus && before?.isConnected) before.focus({ preventScroll: true });
  before = null;
}

const isCmdF = (e: KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF';
// in capture, before the intercom's keys; anything else (a terminal, the files' editor, a field) keeps its ⌘F
addEventListener('keydown', e => { if (isCmdF(e) && findShortcut()) { e.preventDefault(); e.stopPropagation(); } }, true);
(window as any).__findShortcut = findShortcut;

// ---------------------------------------------------------------- the intercom: its whole conversation, marked where held
const HITS = typeof Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights ? { all: new Highlight(), current: new Highlight() } : null;
if (HITS) { HITS.current.priority = 1; CSS.highlights.set('shelter-find', HITS.all); CSS.highlights.set('shelter-find-current', HITS.current); }

function textOf(root: HTMLElement) {
  const nodes: { node: Text; start: number }[] = [];
  const shown = new Map<Element, boolean>();
  const visible = (el: Element) => { let v = shown.get(el); if (v === undefined) { v = !el.closest('.bar-find') && (el.checkVisibility?.() ?? true); shown.set(el, v); } return v; };
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && visible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  let text = '';
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) { nodes.push({ node: n, start: text.length }); text += n.data; }
  return { text, nodes };
}
// the text node holding offset `at` (the last one starting at or before it)
function nodeAt(nodes: { node: Text; start: number }[], at: number) {
  let lo = 0, hi = nodes.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].start <= at) lo = mid; else hi = mid - 1; }
  return nodes[lo];
}
function rangeAt(nodes: { node: Text; start: number }[], at: number, len: number) {
  const a = nodeAt(nodes, at), b = nodeAt(nodes, at + len - 1), r = document.createRange();
  r.setStart(a.node, at - a.start); r.setEnd(b.node, at + len - b.start);
  return r;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r(null)));

function logRunner(sid: string, root: HTMLElement): Runner {
  let query = '', hits: LogHit[] = [], total = 0, cur: { id: string; k: number } | null = null;
  let seq = 0, timer = 0, repaint = 0, lastId = live.get().entries[sid]?.at(-1)?.id;
  const index = () => (cur ? indexOfHit(hits, cur.id, cur.k) : -1);
  const held = (id: string) => (live.get().entries[sid] ?? []).some(e => e.id === id);
  const later = (f: () => void, ms: number) => { clearTimeout(timer); timer = window.setTimeout(f, ms); };

  // the marks: every match in the entries held, and the current one (its k-th match in its entry, if it's held)
  const paint = (scroll: boolean) => {
    if (!HITS) return;
    HITS.all.clear(); HITS.current.clear();
    if (!query) return;
    const all = textOf(root);
    for (const o of matchOffsets(all.text, query)) HITS.all.add(rangeAt(all.nodes, o, query.length));
    if (!cur) return;
    const entry = root.querySelector<HTMLElement>(`[data-entry="${CSS.escape(cur.id)}"]`);
    const here = entry ? textOf(entry) : null, offs = here ? matchOffsets(here.text, query) : [];
    if (!here || !offs.length) return;
    const r = rangeAt(here.nodes, offs[Math.min(cur.k, offs.length - 1)], query.length);
    HITS.current.add(r);
    if (!scroll) return;
    // the log scrolls by itself (scrollIntoView would also move the intercom's frame)
    const box = root.getBoundingClientRect(), at = r.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) root.scrollTop += at.top - box.top - box.height / 3;
  };

  // older pages come in, one at a time, until the entry is held (what scrolling to the top does)
  const reach = async (id: string, mine: number) => {
    for (let fails = 0; mine === seq && !held(id) && live.get().older[sid];) {
      if (await loadOlder(sid)) fails = 0;
      else if (++fails > 50) return;
      else await sleep(100);
    }
  };
  const show = async (mine: number, scroll: boolean) => {
    report(total, index());
    if (cur) await reach(cur.id, mine);
    if (mine !== seq) return;
    await nextFrame();   // the pages that came in are drawn
    if (mine !== seq) return;
    paint(scroll);
    report(total, index());
  };
  // the count from the server. `keep`: the match to stay on, when it's still there; else the latest one
  const refresh = async (keep: { id: string; k: number } | null, scroll: boolean) => {
    const mine = ++seq;
    let r: LogHits;
    try { r = await findInLog(sid, query); } catch { if (mine === seq) finder.set({ unavailable: true }); return; }
    if (mine !== seq) return;
    hits = r.hits; total = r.total;
    cur = keep && indexOfHit(hits, keep.id, keep.k) >= 0 ? keep : total ? hitAt(hits, total - 1) : null;
    await show(mine, scroll);
  };
  const step = (dir: 1 | -1) => {
    if (!total) return;
    const mine = ++seq;
    cur = hitAt(hits, stepMatch(index(), total, dir));
    void show(mine, true);
  };

  // the entries held repaint as the log changes (new ones, older ones loaded above)
  const observer = new MutationObserver(() => { clearTimeout(repaint); repaint = window.setTimeout(() => paint(false), 150); });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  // new entries at the bottom change the count (the match stays where it is)
  const unsub = live.subscribe(() => {
    const last = live.get().entries[sid]?.at(-1)?.id;
    if (last === lastId) return;
    lastId = last;
    if (query) later(() => void refresh(cur, false), 200);
  });
  return {
    search(q, dir, again) {
      if (q === query && again) { step(dir); return; }
      query = q;
      later(() => void refresh(null, true), 200);
    },
    clear() { query = ''; hits = []; total = 0; cur = null; seq++; clearTimeout(timer); HITS?.all.clear(); HITS?.current.clear(); report(0, -1); },
    stop() { clearTimeout(timer); clearTimeout(repaint); observer.disconnect(); unsub(); this.clear(); },
  };
}

// ---------------------------------------------------------------- a browser: Electron's findInPage
interface Webview extends HTMLElement { findInPage(text: string, o?: { forward?: boolean; findNext?: boolean }): number; stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void }
function webviewRunner(w: Webview): Runner {
  let asked = 0;
  // findInPage may take the focus into the web: it goes back to the bar while the Overseer is typing there
  const found = (e: any) => {
    const r = e.result; if (!r || !r.finalUpdate) return;
    report(r.matches ?? 0, (r.activeMatchOrdinal ?? 0) - 1);
    if (Date.now() - asked < 600 && document.activeElement !== input.el) input.el?.focus({ preventScroll: true });
  };
  w.addEventListener('found-in-page', found);
  let last = '';
  return {
    search(q, dir, again) {
      asked = Date.now();
      try { w.findInPage(q, { forward: dir > 0, findNext: !(again && q === last) }); last = q; } catch { finder.set({ unavailable: true }); }
    },
    clear() { last = ''; try { w.stopFindInPage('clearSelection'); } catch {} report(0, -1); },
    stop() { w.removeEventListener('found-in-page', found); try { w.stopFindInPage('keepSelection'); } catch {} },
  };
}

// ---------------------------------------------------------------- the «Página» window: asked to the page's notes layer
function frameRunner(frame: HTMLIFrameElement): Runner {
  const post = (m: object) => frame.contentWindow?.postMessage({ shelter: 'notes', ...m }, '*');
  let waiting = 0;
  const listen = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow || e.data?.shelter !== 'notes' || e.data.type !== 'found') return;
    clearTimeout(waiting); report(Number(e.data.n) || 0, Number.isInteger(e.data.i) ? e.data.i : -1);
  };
  addEventListener('message', listen);
  return {
    search(q, dir, again) {
      post({ type: 'find', query: q, dir, again });
      // no answer: a page without the notes layer (another local program's)
      clearTimeout(waiting); waiting = window.setTimeout(() => finder.set({ unavailable: true }), 800);
    },
    clear() { clearTimeout(waiting); post({ type: 'findClear' }); report(0, -1); },
    stop() { this.clear(); removeEventListener('message', listen); },
  };
}

// ---------------------------------------------------------------- the bar
const go = (dir: 1 | -1, again = true) => { const q = finder.get().query; if (q && runner) runner.search(q, dir, again); };
export function FindBar() {
  const s = finder.use(e => e);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { input.el = field.current; if (s.open) { field.current?.focus(); field.current?.select(); } }, [s.open, s.host]);
  // its window closed, minimized or showing something else: the bar goes
  useEffect(() => {
    if (!s.open) return;
    const timer = setInterval(() => { const x = finder.get(); if (!x.target?.isConnected || !x.host?.isConnected || !(x.host.checkVisibility?.() ?? true)) closeFind(false); }, 500);
    return () => clearInterval(timer);
  }, [s.open]);
  if (!s.open || !s.host) return null;
  const count = !s.query ? '' : s.unavailable ? t('windows.find.unavailable') : s.n ? `${s.i + 1}/${s.n}${s.n >= FIND_MAX && s.kind !== 'web' ? '+' : ''}` : t('windows.find.none');
  const change = (q: string) => { finder.set({ query: q }); if (q) runner?.search(q, 1, false); else runner?.clear(); };
  return createPortal(
    <div className="bar-find interactive" role="search" onPointerDown={e => e.stopPropagation()}>
      <input ref={field} value={s.query} placeholder={t('windows.find.placeholder')} aria-label={t('windows.find.placeholder')} spellCheck={false}
        onChange={e => change(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
          else if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); go(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1); }
        }} />
      <span className={'bar-find-count' + (s.query && !s.n ? ' empty' : '')}>{count}</span>
      <button className="console-x" onClick={() => go(-1)} disabled={!s.n} title={t('windows.find.previous')}>↑</button>
      <button className="console-x" onClick={() => go(1)} disabled={!s.n} title={t('windows.find.next')}>↓</button>
      <button className="console-x" onClick={() => closeFind()} title={t('windows.find.close')}>×</button>
    </div>,
    s.host,
  );
}
