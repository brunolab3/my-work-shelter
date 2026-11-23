// Barra de ventanas, abajo a la izquierda: está siempre que haya alguna ventana abierta. Una fila por tipo, una
// encima de otra: intercomunicadores (COM, one chip per room: room · state · count; those that don't fit behind «+N»,
// sticky so switching conversations doesn't reshuffle the row; and ⋯ N with every open conversation), terminales (TERM), navegadores (NAV), el cliente de git (GIT) y los archivos (ARCH). Las minimizadas van hundidas. Un clic abre la ventana o la trae delante; si ya estaba delante, la minimiza.
// Con teclado: ⌘B desde cualquier sitio (o B en el refugio) entra en la barra; ←→ eligen, ↑↓ cambian de fila,
// Intro abre, X cierra (con lo de siempre: si hay algo en marcha, pregunta) y Esc (o ⌘B) sale.
import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { t } from '@shared/language';
import { terminals, onFront, minimize, askClose as closeTerminal } from './Terminals';
import { intercoms, type WindowCom, minimizeIntercom, restoreIntercom, sessionPilot, roomTalkers, TalkerRow, ComTabs, withText, openConversation, askClose as closeIntercom, useFlags } from './Dialog';
import { juego, type DwellerSummary } from './gameState';
import type { SessionSummary } from '@shared/protocol';
import { recentFirst, sessionRecency } from '@shared/recent';
import { flaggedIn } from '@shared/flagged';
import { live } from '../net/client';
import { Store } from './store';
import { writing } from '../engine/keyboard';
import { SFX } from '../audio/sound';
import { MAC, CMD, FlagMark } from './windows';
import { interlocutor } from './copies';
import { overflowChips } from './tabOrder';
import { browsers, SPOTS, pageTitle, onFront as navOnFront, minimize as navMinimize, close as navClose } from './Browsers';
import { windowGit, onFrontGit, minimizeGit, closeGit } from './git/window';
import { filesWindow, onFrontFiles, minimizeFiles, closeFiles } from './files/window';

const STATE_TEXT: Record<string, string> = { arrancando: t('windows.starting'), trabajando: t('windows.working'), esperando: t('windows.waitingForYou'), error: t('windows.fault'), terminada: t('windows.finished'), ociosa: t('windows.ready') };
const URGENCY: Record<string, number> = { esperando: 0, error: 1, trabajando: 2, arrancando: 2, terminada: 3, ociosa: 4 };

// the intercoms grouped by room: one chip per room, opening the one with the most recent conversation (or the last
// one in front); its hover list holds one row per intercom panel of the room (its dweller, each hologram)
type Com = { v: WindowCom; h: DwellerSummary; sess: SessionSummary[] };
export function comRooms(list: WindowCom[], sessions: Record<string, SessionSummary>, who: (id: string) => DwellerSummary | null | undefined) {
  const rooms = new Map<string, { room: string; name: string; coms: Com[] }>();
  for (const v of list) {
    const h = who(v.dwellerId); if (!h) continue;
    const sess = v.tabs.map(p => (p.view.type === 'sesion' ? sessions[p.view.sessionId] : undefined)).filter(Boolean) as SessionSummary[];
    const g = rooms.get(h.room) ?? { room: h.room, name: h.nameRoom, coms: [] };
    g.coms.push({ v, h, sess }); rooms.set(h.room, g);
  }
  return [...rooms.values()].map(g => {
    const last = (c: Com) => Math.max(0, ...c.sess.map(s => s.updated));
    const latest = [...g.coms].sort((a, b) => last(b) - last(a) || b.v.z - a.v.z)[0];
    const sess = g.coms.flatMap(c => c.sess.map(s => ({ s, h: c.h }))).sort((a, b) => (URGENCY[a.s.state] ?? 5) - (URGENCY[b.s.state] ?? 5) || recentFirst(sessionRecency(a.s), sessionRecency(b.s)));
    // what a click opens: the conversation with something for you (waiting, failed, unread), on its tab; else the latest
    const aTi = sess.find(x => x.s.state === 'esperando' || x.s.state === 'error' || (x.s.state === 'terminada' && x.s.unread));
    return { ...g, latest, sess, aTi, open: () => (aTi ? openConversation(aTi.s.id) : restoreIntercom(latest.v.dwellerId)) };
  });
}

// the COM row's rooms left out for lack of room (by urgency), measured by the bar and kept from one measure to the
// next; the keyboard goes through them after the ones in view, on the «+N» chip
const comOutside = new Store<{ rooms: string[] }>({ rooms: [] });
// the rooms as the COM row goes: those in view in their order, then those behind «+N»
function comOrder<T extends { room: string }>(rooms: T[], outside: string[]) {
  const hidden = outside.map(s => rooms.find(g => g.room === s)).filter(Boolean) as T[];
  return { views: rooms.filter(g => !hidden.includes(g)), hidden };
}
// which rooms are most relevant to keep in view: waiting, failed, unread, then the rest in order
const roomRank = (g: ReturnType<typeof comRooms>[number]) =>
  g.aTi ? ({ esperando: 0, error: 1 } as Record<string, number>)[g.aTi.s.state] ?? 2 : 3;

interface Item { key: string; isOpen: boolean; open: () => void; minimize: () => void; close: () => void }
// las dos filas tal como se ven (las usan el ratón y el teclado)
function rows(): Item[][] {
  const talking = juego.get().talkingWith;
  const terms = terminals.get().list, visible = terms.filter(v => !v.minimized);
  const ahead = visible.length ? visible.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const { views, hidden } = comOrder(comRooms(intercoms.get().list, live.get().sessions, id => interlocutor(id)), comOutside.get().rooms);
  const coms: Item[] = [...views, ...hidden].map(g => {
    const inRoom = g.coms.some(c => c.v.dwellerId === talking);
    return {
      key: 'c:' + g.room, isOpen: inRoom,
      open: () => { if (!inRoom) g.open(); }, minimize: minimizeIntercom,
      // closes every intercom of the room; if one asks (something running), its question shows in its window
      close: () => {
        for (const c of g.coms) closeIntercom(c.v.dwellerId);
        const question = g.coms.find(c => intercoms.get().list.find(x => x.dwellerId === c.v.dwellerId)?.confirm);
        if (question && talking !== question.v.dwellerId) restoreIntercom(question.v.dwellerId);
      },
    };
  });
  const tes: Item[] = terms.map(v => ({ key: 't:' + v.id, isOpen: !v.minimized && v.id === ahead, open: () => onFront(v.id), minimize: () => minimize(v.id), close: () => closeTerminal(v.id) }));
  const navs: Item[] = browsers.get().list.map(v => ({ key: 'n:' + v.id, isOpen: !v.minimized, open: () => navOnFront(v.id), minimize: () => navMinimize(v.id), close: () => navClose(v.id) }));
  const g = windowGit.get();
  const git: Item[] = g.open ? [{ key: 'g', isOpen: !g.minimized, open: onFrontGit, minimize: minimizeGit, close: closeGit }] : [];
  const a = filesWindow.get();
  const arch: Item[] = a.isOpen ? [{ key: 'a', isOpen: !a.minimized, open: onFrontFiles, minimize: minimizeFiles, close: closeFiles }] : [];
  return [coms, tes, navs, git, arch];
}
const hasSomething = (fs: Item[][]) => fs.some(f => f.length);
// la fila con algo más cercana a la pedida (si se vació mientras se elegía)
const validRow = (fs: Item[][], row: number) => { for (let d = 0; d < fs.length; d++) for (const f of [row - d, row + d]) if (fs[f]?.length) return f; return -1; };

// ---------------------------------------------------------------- manejo por teclado
export const selection = new Store<{ current: { row: number; i: number } | null }>({ current: null });
let before: Element | null = null;
export function enter() {
  const fs = rows();
  if (!hasSomething(fs)) { SFX.notAllowed(); return; }
  // empieza en la ventana que se está usando, o en la primera
  let row = fs.findIndex(f => f.some(x => x.isOpen)); if (row < 0) row = fs.findIndex(f => f.length);
  const i = Math.max(0, fs[row].findIndex(x => x.isOpen));
  before = document.activeElement; (document.activeElement as HTMLElement | null)?.blur?.();
  selection.set({ current: { row, i } }); SFX.open();
}
function exit(backOnFocus = true) {
  selection.set({ current: null });
  if (backOnFocus && before instanceof HTMLElement && document.contains(before)) before.focus();
  before = null;
}
addEventListener('keydown', e => {
  const cmdB = (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey) && !e.altKey && e.code === 'KeyB';
  const sel = selection.get().current;
  if (!sel) {
    const j = juego.get();
    const bLoose = e.code === 'KeyB' && !e.metaKey && !e.ctrlKey && !e.altKey && !j.talkingWith && !j.panel && !writing(e);
    if (cmdB || bLoose) { e.preventDefault(); e.stopPropagation(); enter(); }
    return;
  }
  // dentro de la barra, todas las teclas son suyas
  e.preventDefault(); e.stopPropagation();
  const fs = rows();
  const row = validRow(fs, sel.row);
  if (row < 0) { exit(); return; }
  const n = fs[row].length;
  const i = Math.min(sel.i, n - 1), el = fs[row][i];
  if (cmdB || e.code === 'Escape') { exit(); SFX.close(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { selection.set({ current: { row, i: (i + 1) % n } }); SFX.tick(); }
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { selection.set({ current: { row, i: (i - 1 + n) % n } }); SFX.tick(); }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') {
    const step = e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 1;
    let other = row; do other = (other + step + fs.length) % fs.length; while (!fs[other].length);
    if (other !== row) { selection.set({ current: { row: other, i: Math.min(i, fs[other].length - 1) } }); SFX.tick(); }
  }
  else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { exit(false); el.open(); SFX.click(); }
  else if (e.code === 'KeyX' || e.code === 'Backspace' || e.code === 'Delete') { exit(false); el.close(); }
  else if (e.code === 'KeyM') { el.minimize(); }
}, true);

// ---------------------------------------------------------------- interfaz
export function Bar() {
  const terms = terminals.use(e => e.list);
  const coms = intercoms.use(e => e.list);
  const talking = juego.use(e => e.talkingWith);
  const who = juego.use(e => (id: string) => interlocutor(id, e));
  const sessions = live.use(e => e.sessions);
  const dwellers = juego.use(e => e.dwellers), copies = juego.use(e => e.copies);
  const navs = browsers.use(e => e.list);
  const git = windowGit.use(e => e);
  const arch = filesWindow.use(e => e);
  const repos = live.use(e => e.repos);
  const sel = selection.use(e => e.current);
  const outside = comOutside.use(e => e.rooms);
  const flags = useFlags();
  const box = useRef<HTMLDivElement>(null), measured = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { addEventListener('resize', redraw); return () => removeEventListener('resize', redraw); }, []);
  // hovering an intercom chip shows its panels, to go straight to one (fixed: the row clips what overflows it)
  const [peek, setPeek] = useState<{ id: string; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keep = () => clearTimeout(timer.current);
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPeek(null), 200); };
  // un clic fuera de la barra la suelta
  useEffect(() => { if (!sel) return; const f = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) exit(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [!!sel]);
  const rooms = comRooms(coms, sessions, who);
  // how many COM chips fit: the bar is as wide as its column lets it; the chips are measured in a hidden copy of the row
  useLayoutEffect(() => {
    const m = measured.current, bar = box.current;
    if (!m || !bar) { if (comOutside.get().rooms.length) comOutside.set({ rooms: [] }); return; }
    const col = getComputedStyle(bar.parentElement ?? bar), b = getComputedStyle(bar), row = m.parentElement!;
    const px = (v: string) => parseFloat(v) || 0, gap = px(getComputedStyle(m).columnGap);
    const fixed = [...row.children].filter(x => x !== m && !x.matches('.chip-terminal, .barra-mas')).reduce((a, x) => a + (x as HTMLElement).offsetWidth + gap, 0);
    const fits = (px(col.maxWidth) || innerWidth) - px(b.paddingLeft) - px(b.paddingRight) - px(b.borderLeftWidth) - px(b.borderRightWidth) - 6 - fixed;
    const ws = rooms.map(g => (m.querySelector(`[data-sala="${CSS.escape(g.room)}"]`) as HTMLElement | null)?.offsetWidth ?? 0);
    const more = (m.querySelector('.barra-mas') as HTMLElement | null)?.offsetWidth ?? 0;
    // sticky: those out stay out and the rest in; only the one in front is swapped in, for the least relevant in view
    const before = comOutside.get().rooms.map(s => rooms.findIndex(g => g.room === s)).filter(i => i >= 0);
    const front = rooms.findIndex(g => g.coms.some(c => c.v.dwellerId === talking));
    const newer = overflowChips(ws.map(w => w + gap), rooms.map(roomRank), fits, more + gap, before, front).map(i => rooms[i].room);
    if (newer.join('\n') !== comOutside.get().rooms.join('\n')) comOutside.set({ rooms: newer });
  });
  const fs = rows();
  if (!hasSomething(fs)) return null;
  const visible = terms.filter(v => !v.minimized);
  const ahead = visible.length ? visible.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const marked = (row: number, i: number) => !!sel && validRow(fs, sel.row) === row && Math.min(sel.i, fs[row].length - 1) === i;
  const { views, hidden } = comOrder(rooms, outside);
  // the «+N» list opens on hover or click, and by itself while the keyboard is on one of the rooms behind it
  const inHidden = !!sel && validRow(fs, sel.row) === 0 && Math.min(sel.i, fs[0].length - 1) >= views.length;
  const whoIs = (h: DwellerSummary) => h.copy ? t('windows.autorSHolographicCopyBranch', { autor: h.copy.nameAuthor, rama: h.copy.branch }) : h.name;
  // how many of a room's open conversations are marked as pending (⚑, shared/flagged.ts)
  const flaggedOf = (g: (typeof rooms)[number]) => flaggedIn(g.sess.map(x => x.s), flags);
  // a room's chip: its pilot, the room, its most urgent conversation's state, how many it has open and its ⚑ pending ones
  // (who and what in its title); waiting goes before pending in its colour
  const chip = (g: (typeof rooms)[number], mark: boolean, measure = false) => {
    const worst = g.sess[0], open = g.coms.some(c => c.v.dwellerId === talking), nFlagged = flaggedOf(g);
    const h = g.coms.find(c => c.v.dwellerId === talking)?.h ?? g.aTi?.h ?? g.latest.h;
    // something typed and not sent in one of its intercoms other than the one in front
    const drafts = g.coms.filter(c => c.v.dwellerId !== talking && c.v.tabs.some(withText));
    const kind = 'chip-terminal' + (h.copy ? ' de-copia' : '') + (open ? ' delante' : ' minimizada') + (worst?.s.state === 'esperando' ? ' urgente' : nFlagged ? ' pendiente' : '') + (mark ? ' marcado' : '');
    const body = <>
      <span className={'piloto ' + sessionPilot(worst?.s)} />
      {g.name}{worst ? <small> · {STATE_TEXT[worst.s.state] ?? worst.s.state}</small> : null}{g.sess.length > 1 ? <small> ({g.sess.length})</small> : null}{nFlagged ? <> <FlagMark on n={nFlagged > 1 ? nFlagged : undefined} /></> : null}{drafts.length ? <span className="marca-borrador"> ✎</span> : null}
    </>;
    if (measure) return <button key={g.room} tabIndex={-1} data-sala={g.room} className={kind}>{body}</button>;
    return (
      <button key={g.room} onMouseEnter={e => { keep(); const r = e.currentTarget.getBoundingClientRect(); setPeek({ id: g.room, x: r.left, y: r.top }); }} onMouseLeave={leave}
        className={kind} onClick={() => { if (open) minimizeIntercom(); else g.open(); }}
        title={`${g.name}: ${g.coms.map(c => whoIs(c.h)).join(', ')}\n${worst ? `${whoIs(worst.h)} · ${STATE_TEXT[worst.s.state] ?? worst.s.state} · ${worst.s.title || t('windows.conversation')}\n` : ''}${nFlagged ? t(nFlagged > 1 ? 'windows.flag.marksTitle' : 'windows.flag.markTitle', { n: nFlagged }) + '\n' : ''}${drafts.length ? t('windows.unsentDraftWith', { quien: drafts.map(c => whoIs(c.h)).join(', ') }) + '\n' : ''}${open ? t('windows.clickToMinimize') : t('windows.clickToGoBackTo', { nombre: whoIs(g.aTi?.h ?? g.latest.h) })}`}>
        {body}
      </button>
    );
  };
  // who a room's hover and «+N» lists show: one row per open intercom panel (its dweller, each hologram), as the selector
  // above the portrait, with the one its chip opens (the most important) selected
  const talkersOf = (g: (typeof rooms)[number]) => roomTalkers(g.room, dwellers, copies, coms, sessions, flags).filter(q => g.coms.some(c => c.v.dwellerId === q.x.id));
  const opener = (g: (typeof rooms)[number]) => (g.aTi?.h ?? g.latest.h).id;
  const talkerRows = (g: (typeof rooms)[number], sel: boolean) => talkersOf(g).map(q => (
    <TalkerRow key={q.x.id} q={q} current={q.x.id === talking} sel={sel && q.x.id === opener(g)}
      onClick={() => { setPeek(null); if (q.x.id !== talking) restoreIntercom(q.x.id); }} />
  ));
  return (
    <div ref={box} className={'barra-ventanas interactivo' + (sel ? ' seleccionando' : '')}>
      {sel && <div className="barra-ayuda"><kbd>←→</kbd> {t('menu.select')} <kbd>↑↓</kbd> {t('windows.row')} <kbd>{t('windows.enter')}</kbd> {t('windows.open')} <kbd>X</kbd> {t('menu.close')} <kbd>M</kbd> {t('windows.minimize2')} <kbd>Esc</kbd> {t('windows.exit')}</div>}
      {rooms.length > 0 && (
        <div className="barra-fila com">
          <span className="barra-tipo" title={t('windows.intercoms')}>COM</span>
          {views.map((g, i) => chip(g, marked(0, i)))}
          {hidden.length > 0 && (
            <button className={'chip-terminal barra-mas minimizada' + (hidden.some(g => g.sess[0]?.s.state === 'esperando') ? ' urgente' : hidden.some(g => flaggedOf(g)) ? ' pendiente' : '') + (inHidden ? ' marcado' : '')}
              onMouseEnter={e => { keep(); const r = e.currentTarget.getBoundingClientRect(); setPeek({ id: '+', x: r.left, y: r.top }); }} onMouseLeave={leave}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPeek(a => (a?.id === '+' ? null : { id: '+', x: r.left, y: r.top })); }}
              title={t('windows.moreRooms', { n: hidden.length })}>
              <span className={'piloto ' + sessionPilot(hidden[0].sess[0]?.s)} />+{hidden.length}
            </button>
          )}
          {/* a hidden copy of every chip, to measure what fits */}
          <div ref={measured} className="barra-medida" aria-hidden>
            {rooms.map(g => chip(g, false, true))}
            <button tabIndex={-1} className="chip-terminal barra-mas"><span className="piloto" />+{rooms.length}</button>
          </div>
          <ComTabs />
        </div>
      )}
      {(peek?.id === '+' || inHidden) && hidden.length > 0 && (() => {
        // right above «+N», growing to the left (it sits at the row's end)
        const r = box.current?.querySelector('.barra-fila.com > .barra-mas')?.getBoundingClientRect(); if (!r) return null;
        return (
          <div className="barra-asomo barra-asomo-mas" style={{ right: innerWidth - r.right, bottom: innerHeight - r.top + 4, '--hueco': `${r.right - 8}px` } as React.CSSProperties} onMouseEnter={keep} onMouseLeave={leave}>
            {hidden.map((g, j) => <Fragment key={g.room}>
              <div className="barra-asomo-grupo">{g.name}</div>
              {talkerRows(g, hidden.some((_, k) => marked(0, views.length + k)) ? marked(0, views.length + j) : j === 0)}
            </Fragment>)}
          </div>
        );
      })()}
      {peek && peek.id !== '+' && (() => {
        // one row per intercom panel of the room (its dweller, each hologram), as the selector above the portrait
        const g = rooms.find(x => x.room === peek.id);
        return g ? (
          <div className="barra-asomo" style={{ left: peek.x, bottom: innerHeight - peek.y + 4, '--hueco': `${innerWidth - peek.x - 8}px` } as React.CSSProperties} onMouseEnter={keep} onMouseLeave={leave}>
            {talkerRows(g, true)}
          </div>
        ) : null;
      })()}
      {terms.length > 0 && (
        <div className="barra-fila term">
          <span className="barra-tipo" title={t('windows.terminals')}>TERM</span>
          {terms.map((v, i) => {
            const inRunning = v.tabs.filter(p => !p.inPrompt);
            return (
              <button key={v.id} className={'chip-terminal' + (v.minimized ? ' minimizada' : '') + (v.id === ahead ? ' delante' : '') + (marked(1, i) ? ' marcado' : '')}
                onClick={() => (v.minimized || v.id !== ahead ? onFront(v.id) : minimize(v.id))}
                title={`${v.cwd}\n${v.minimized ? t('windows.clickToOpen') : v.id === ahead ? t('windows.clickToMinimize2') : t('windows.clickToBringToFront')}`}>
                <span className={'piloto ' + (inRunning.length ? 'trabajando' : 'ociosa')} />
                {v.title}{inRunning.length ? ` · ${inRunning.map(p => p.program).join(', ')}` : ''}{v.tabs.length > 1 ? <small> ({v.tabs.length})</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {navs.length > 0 && (
        <div className="barra-fila nav">
          <span className="barra-tipo" title={t('windows.browsers')}>NAV</span>
          {navs.map((v, i) => {
            const name = SPOTS[v.id]?.name ?? v.id, page = pageTitle(v);
            return (
              <button key={v.id} className={'chip-terminal' + (v.minimized ? ' minimizada' : ' delante') + (marked(2, i) ? ' marcado' : '')}
                onClick={() => (v.minimized ? navOnFront(v.id) : navMinimize(v.id))}
                title={`${v.title}\n${v.url}\n${v.minimized ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
                <span className={'piloto ' + (v.loading ? 'trabajando' : 'ociosa')} />
                {name}{page ? <small> · {page.length > 40 ? page.slice(0, 39) + '…' : page}</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {git.open && (
        <div className="barra-fila git">
          <span className="barra-tipo" title={t('world.gitClient')}>GIT</span>
          <button className={'chip-terminal' + (git.minimized ? ' minimizada' : ' delante') + (marked(3, 0) ? ' marcado' : '')}
            onClick={() => (git.minimized ? onFrontGit() : minimizeGit())} title={`${git.path ?? ''}\n${git.minimized ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
            <span className={'piloto ' + (git.busy ? 'trabajando' : 'ociosa')} />
            {git.path?.split('/').pop() ?? 'git'}{(() => { const r = Object.values(repos).find(x => x.path === git.path); return r?.branch ? <small> · {r.branch}{r.changes ? ` · ${t('windows.nChanges', { n: r.changes })}` : ''}</small> : null; })()}
          </button>
        </div>
      )}
      {arch.isOpen && (
        <div className="barra-fila git">
          <span className="barra-tipo" title={t('windows.files')}>ARCH</span>
          <button className={'chip-terminal' + (arch.minimized ? ' minimizada' : ' delante') + (marked(4, 0) ? ' marcado' : '')}
            onClick={() => (arch.minimized ? onFrontFiles() : minimizeFiles())} title={`${arch.root ?? ''}\n${arch.minimized ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
            <span className="piloto ociosa" />
            {arch.root?.replace(/\/$/, '').split('/').pop() ?? t('windows.files2')}
          </button>
        </div>
      )}
      {!sel && <button className="tecla pista-atajo" onClick={() => enter()} title={t('windows.useTheBarWithThe', { shortcut: `${CMD}B` })}>{CMD}B</button>}
    </div>
  );
}
