// ⌘F: find text in what has focus (findKind in findText.ts), with a small bar at the top right of it. Enter or ↓ goes to
// the next match, ⇧Enter or ↑ to the previous one, Esc closes and gives the focus back.
// - The intercom: the conversation in view, only the entries it holds (a page of the log, shared/logPages.ts; scrolling
//   up brings older ones, and they're searched too). Marked with CSS Custom Highlights, without touching the log's DOM.
// - A browser («Web» and the work sites, a <webview>): Electron's own findInPage.
// - The «Página» window (a sandboxed <iframe>): server/page/notes.js finds inside the page and answers by postMessage;
//   a page another program serves has no notes layer and says it can't be searched.
// With the focus inside a <webview> or the <iframe>, ⌘F doesn't reach this page: Electron's Edit → Find menu item calls
// window.__findShortcut (electron/main.cjs) when the page there didn't take ⌘F itself.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Store } from './store';
import { live } from '../net/client';
import { t } from '@shared/language';
import { MAC } from './windows';
import { FIND_MAX, findKind, keepNear, matchOffsets, stepMatch, type FindKind } from './findText';

interface Runner { search(query: string, dir: 1 | -1, again: boolean): void; clear(): void; stop(): void }
interface FindState { open: boolean; kind: FindKind | null; host: HTMLElement | null; target: HTMLElement | null; query: string; n: number; i: number; unavailable: boolean }
const CLOSED: FindState = { open: false, kind: null, host: null, target: null, query: '', n: 0, i: -1, unavailable: false };
export const finder = new Store<FindState>(CLOSED);
let runner: Runner | null = null, before: HTMLElement | null = null;
const input = { el: null as HTMLInputElement | null };
const report = (n: number, i: number) => finder.set({ n, i, unavailable: false });

const intercomLog = () => document.querySelector<HTMLElement>('.console .session .canvas');

/** ⌘F: opens the bar on what has focus (or back to its field if it's open); false if there's nothing to search there */
export function findShortcut(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (finder.get().open && active?.closest('.bar-find')) { input.el?.select(); return true; }
  const kind = findKind(active, !!intercomLog());
  if (!kind) return false;
  const log = intercomLog();
  const target = kind === 'intercom' ? log : active;
  const host = kind === 'intercom' ? log?.closest<HTMLElement>('.session') : target?.closest<HTMLElement>('.vn-body');
  if (!target || !host) return false;
  const { open, target: was, query } = finder.get();
  if (open && was === target) { input.el?.focus(); input.el?.select(); return true; }
  closeFind(false);
  before = active && active !== document.body ? active : null;
  runner = kind === 'intercom' ? domRunner(target) : kind === 'web' ? webviewRunner(target as Webview) : frameRunner(target as HTMLIFrameElement);
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

// ---------------------------------------------------------------- the intercom: its log's text, marked in place
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

function domRunner(root: HTMLElement): Runner {
  let ranges: Range[] = [], offsets: number[] = [], current = -1, query = '';
  const paint = (scroll: boolean) => {
    if (!HITS) return;
    HITS.current.clear();
    const r = ranges[current];
    if (!r) return;
    HITS.current.add(r);
    if (!scroll) return;
    // the log scrolls by itself (scrollIntoView would also move the intercom's frame)
    const box = root.getBoundingClientRect(), at = r.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) root.scrollTop += at.top - box.top - box.height / 3;
  };
  const run = (keepAt?: number) => {
    HITS?.all.clear();
    const { text, nodes } = textOf(root);
    offsets = matchOffsets(text, query);
    ranges = offsets.map(o => {
      const a = nodeAt(nodes, o), b = nodeAt(nodes, o + query.length - 1), r = document.createRange();
      r.setStart(a.node, o - a.start); r.setEnd(b.node, o + query.length - b.start);
      return r;
    });
    for (const r of ranges) HITS?.all.add(r);
    current = keepAt === undefined ? -1 : keepNear(offsets, keepAt);
  };
  // new entries (or older ones loaded above) while it's open: searched again, staying on the same match
  let timer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => { if (!query) return; run(offsets[current]); paint(false); report(offsets.length, current); }, 250);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return {
    search(q, dir, again) {
      if (q !== query || !again) { query = q; run(); }
      current = stepMatch(current, offsets.length, dir);
      paint(true); report(offsets.length, current);
    },
    clear() { query = ''; offsets = []; ranges = []; current = -1; HITS?.all.clear(); HITS?.current.clear(); report(0, -1); },
    stop() { clearTimeout(timer); observer.disconnect(); this.clear(); },
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
  const sessionId = s.kind === 'intercom' ? s.host?.getAttribute('data-session') ?? '' : '';
  const partial = live.use(e => !!sessionId && !!e.older[sessionId]);
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
      {partial && <span className="bar-find-partial" title={t('windows.find.loadedOnlyHint')}>{t('windows.find.loadedOnly')}</span>}
      <button className="console-x" onClick={() => go(-1)} disabled={!s.n} title={t('windows.find.previous')}>↑</button>
      <button className="console-x" onClick={() => go(1)} disabled={!s.n} title={t('windows.find.next')}>↓</button>
      <button className="console-x" onClick={() => closeFind()} title={t('windows.find.close')}>×</button>
    </div>,
    s.host,
  );
}
