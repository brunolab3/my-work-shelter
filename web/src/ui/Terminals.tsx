// Terminales de sala: shell de login real sobre PTY en la carpeta de la sala, para lo que solo el humano puede hacer
// (sudo, prompts interactivos, logins, Claude Code a mano). Se manejan como las de un sistema operativo corriente:
// - cada ventana tiene pestañas, se minimiza a la barra de abajo a la izquierda (Bar.tsx) y al volver se ve lo mismo
//   que antes (el shell y lo que corra dentro siguen vivos), se amplía (también con doble clic en la cabecera) y se
//   cierra; si dentro hay algo en marcha (Claude Code, un build, vim…) pide confirmación, porque cerrar lo termina.
//   Botones, pestañas y atajos son los de todas las ventanas del refugio (windows.tsx).
// Esc y Ctrl+C van siempre al programa, como en iTerm: paran a Claude Code, salen de él o de lo que sea; nunca
// cierran ni esconden la ventana. Para volver al refugio: minimizar o hacer clic fuera.
// El teclado se comporta como en iTerm: protocolo de teclado de kitty para quien lo pida (Claude Code: Shift+Enter es
// salto de línea), ⌘←/⌘→/⌘⌫ de edición de línea, ⌘K limpia, ⌘+clic abre enlaces y ⌥+arrastrar selecciona.
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon, type IClipboardProvider } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { client, live } from '../net/client';
import { Store } from './store';
import { t } from '@shared/language';
import { SFX } from '../audio/sound';
import { physicsKey } from '../audio/keyboard';
import { MAC, nextZ, windowShortcut, WindowButtons, Tabs, Confirmation } from './windows';
import { pathWorktree, worktreesKnown } from './copies';
import { worktreeTask } from '@shared/tasks';
import { takeASurface } from './surface';

// una pestaña es un PTY; su id es el de la ventana (la primera) o el de la ventana con «::n» (las siguientes)
// fuera: cuántas terminales de tu escritorio la tienen abierta (./shelter enganchar): es el mismo PTY, en los dos sitios
interface Tab { id: string; inPrompt: boolean; program?: string; outside?: number }
interface WindowTerm {
  id: string; roomId: string; title: string; cwd: string; tabs: Tab[]; active: string;
  minimized: boolean; maximized: boolean; x: number; y: number; w: number; h: number; z: number;
  confirm?: string[];   // pestañas que se quieren cerrar con algo en marcha dentro
}
export const terminals = new Store<{ list: WindowTerm[] }>({ list: [] });

const xterms = new Map<string, { t: Terminal; fit: FitAddon }>();
const input = (id: string, data: string) => client.send({ t: 'terminalInput', id, data });
const windowOf = (tabId: string) => tabId.replace(/::\d+$/, '');
const number = (tabId: string) => Number(/::(\d+)$/.exec(tabId)?.[1] ?? 1);
const folderName = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd;

// Protocolo de teclado de kitty (https://sw.kovidgoyal.net/kitty/keyboard-protocol/), lo que hace iTerm: el programa
// pregunta con CSI ? u, apila sus banderas con CSI > f u y las quita con CSI < n u. Con «desambiguar» (bandera 1),
// Esc y Enter/Tab/Retroceso con modificadores llegan como CSI código;mods u: así Claude Code distingue Shift+Enter
// (salto de línea) de Enter (enviar). El resto de teclas siguen como siempre (se entienden igual).
const kitty = new Map<string, number[]>();
const flags = (id: string) => { const p = kitty.get(id); return p?.length ? p[p.length - 1] : 0; };
const CODE_KITTY: Record<string, number> = { Enter: 13, Tab: 9, Backspace: 127, Escape: 27 };
function keyKitty(id: string, e: KeyboardEvent) {
  if (!(flags(id) & 1) || e.metaKey) return null;
  const cod = CODE_KITTY[e.key]; if (!cod) return null;
  const mods = (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
  if (!mods && cod !== 27) return null;
  return `\x1b[${cod}${mods ? ';' + (mods + 1) : ''}u`;
}
// atajos de ⌘ de iTerm (preajuste de edición natural) que el navegador no traduce
function shortcutMac(t: Terminal, e: KeyboardEvent): string | boolean | null {
  if (!MAC || !e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === 'ArrowLeft') return '\x01';     // principio de línea
  if (e.key === 'ArrowRight') return '\x05';    // final de línea
  if (e.key === 'Backspace') return '\x15';     // borrar hasta el principio
  if (e.key === 'k' || e.key === 'K') { t.clear(); return true; }
  if (e.key === 'a' || e.key === 'A') { t.selectAll(); return true; }
  return null;
}
// OSC 52: un programa de la terminal puede copiar al portapapeles, pero nunca leerlo (la consulta «?» recibe vacío);
// si no, cualquier cosa que se imprima en la terminal (un cat, un log, un repo clonado) se llevaría lo copiado
const CLIPBOARD_ONLY_WRITE: IClipboardProvider = {
  readText: () => '',
  writeText: (sel, text) => (sel === 'c' ? navigator.clipboard.writeText(text).catch(() => {}) : undefined),
};
const openLink = (e: MouseEvent, uri: string) => { if (e.metaKey || e.ctrlKey) window.open(uri, '_blank', 'noopener'); };

// ---------------------------------------------------------------- ventanas y pestañas
export const windowTerminal = (id: string) => win(id);
const win = (id: string) => terminals.get().list.find(v => v.id === id);
function update(id: string, p: Partial<WindowTerm> | ((v: WindowTerm) => Partial<WindowTerm>)) {
  terminals.set(e => ({ list: e.list.map(v => (v.id === id ? { ...v, ...(typeof p === 'function' ? p(v) : p) } : v)) }));
}
function focus(id: string) { setTimeout(() => { const v = win(id); if (v && !v.minimized && !v.confirm) xterms.get(v.active)?.t.focus(); }, 30); }
export function onFront(id: string) {
  const v = win(id); if (!v) return;
  if (v.minimized) SFX.open();
  const z = nextZ();
  terminals.set(e => ({ list: e.list.map(x => (x.id === id ? { ...x, z, minimized: false } : x)) }));
  focus(id);
}
export function minimize(id: string) {
  const v = win(id); if (!v || v.minimized) return;
  xterms.get(v.active)?.t.blur();
  update(id, { minimized: true }); SFX.close();
}
function toggleMaximize(id: string) { update(id, v => ({ maximized: !v.maximized })); SFX.click(); focus(id); }
function activate(id: string, tabId: string) { update(id, { active: tabId }); focus(id); }
function moveTab(id: string, step: number) {
  const v = win(id); if (!v || v.tabs.length < 2) return;
  const i = v.tabs.findIndex(p => p.id === v.active);
  activate(id, v.tabs[(i + step + v.tabs.length) % v.tabs.length].id);
}
function newTab(id: string) {
  const v = win(id); if (!v) return;
  const pid = `${v.id}::${Math.max(...v.tabs.map(p => number(p.id))) + 1}`;
  const z = nextZ();
  terminals.set(e => ({ list: e.list.map(x => (x.id === id ? { ...x, z, minimized: false, active: pid, tabs: [...x.tabs, { id: pid, inPrompt: true }] } : x)) }));
  SFX.open(); focus(id);
}
// cerrar termina lo que corre dentro: si hay algo en marcha, primero se pregunta
export function askClose(id: string, ids?: string[]) {
  const v = win(id); if (!v) return;
  const which = ids ?? v.tabs.map(p => p.id);
  if (v.tabs.some(p => which.includes(p.id) && !p.inPrompt)) { onFront(id); update(id, { confirm: which }); SFX.lowNotice(); return; }
  closeAlready(which);
}
function closeAlready(ids: string[]) { for (const pid of ids) { client.send({ t: 'terminalClose', id: pid }); removeTab(pid); } SFX.close(); }
function cancelClosing(id: string) { update(id, { confirm: undefined }); focus(id); }
function removeTab(pid: string) {
  xterms.get(pid)?.t.dispose(); xterms.delete(pid); kitty.delete(pid); repaint.delete(pid); pending.delete(pid);
  const vid = windowOf(pid), v = win(vid); if (!v || !v.tabs.some(p => p.id === pid)) return false;
  const rest = v.tabs.filter(p => p.id !== pid);
  if (!rest.length) { terminals.set(e => ({ list: e.list.filter(x => x.id !== vid) })); return true; }
  const i = v.tabs.findIndex(p => p.id === pid);
  const confirm = v.confirm?.filter(x => x !== pid);
  update(vid, { tabs: rest, active: v.active === pid ? rest[Math.min(i, rest.length - 1)].id : v.active, confirm: confirm?.length ? confirm : undefined });
  if (v.active === pid) focus(vid);
  return true;
}

export function openTerminal(roomId: string) {
  const room = live.get().state?.rooms?.find((s: any) => s.id === roomId);
  openTerminalIn('sala:' + roomId, roomId, room?.name ?? roomId, room?.folder ?? room?.path ?? '');
}
export function openTerminalIn(id: string, roomId: string, title: string, cwd: string) {
  if (win(id)) { onFront(id); return; }
  if (!cwd) { SFX.notAllowed(); return; }
  delete remembered[id];   // una terminal nueva no hereda cómo estaba otra cerrada con el mismo nombre
  create(id, id, roomId, title, cwd);
  SFX.open();
}

// tras una recarga o un reinicio, cada ventana vuelve donde estaba, con sus pestañas y como estaba
interface Remembered { roomId: string; title: string; cwd: string; tabs: string[]; active: string; minimized: boolean; maximized: boolean; x: number; y: number; w: number; h: number }
const REMEMBERED = 'refugio.terminales';
const remembered: Record<string, Remembered> = (() => {
  try { const l = JSON.parse(sessionStorage.getItem(REMEMBERED) || '[]'); sessionStorage.removeItem(REMEMBERED); return Object.fromEntries(l.filter((v: any) => Array.isArray(v.tabs)).map((v: any) => [v.id, v])); } catch { return {}; }
})();
addEventListener('pagehide', () => {
  try {
    sessionStorage.setItem(REMEMBERED, JSON.stringify(terminals.get().list.map(({ id, roomId, title, cwd, tabs, active, minimized, maximized, x, y, w, h }) =>
      ({ id, roomId, title, cwd, tabs: tabs.map(p => p.id), active, minimized, maximized, x, y, w, h }))));
  } catch {}
});

function create(id: string, tabId: string, roomId: string, title: string, cwd: string, minimized = false) {
  const r = remembered[id];
  if (r) {
    const x = Math.min(r.x, innerWidth - 120), y = Math.min(r.y, innerHeight - 40);
    const z = nextZ();
    terminals.set(e => ({ list: [...e.list, { id, roomId: r.roomId ?? roomId, title: r.title ?? title, cwd: r.cwd ?? cwd, tabs: [{ id: tabId, inPrompt: true }], active: tabId, minimized: r.minimized, maximized: !!r.maximized, x, y, w: r.w, h: r.h, z }] }));
    return;
  }
  const n = terminals.get().list.length;
  const w = Math.min(880, innerWidth * 0.55), h = Math.min(520, innerHeight * 0.5);
  const z = nextZ();
  terminals.set(e => ({ list: [...e.list, { id, roomId, title, cwd, tabs: [{ id: tabId, inPrompt: true }], active: tabId, minimized, maximized: false, x: innerWidth * 0.22 + n * 28, y: innerHeight * 0.3 + n * 24, w, h, z }] }));
}
// una pestaña que ya existía en el servidor (recarga, reinicio, otra ventana) vuelve a su ventana y en su orden
function recover(pid: string) {
  const vid = windowOf(pid), r = remembered[vid];
  if (!win(vid)) {
    const roomId = vid.replace(/^sala:/, '').replace(/^wt:/, ''); const room = live.get().state?.rooms?.find((s: any) => s.id === roomId);
    create(vid, pid, roomId, room?.name ?? roomId, room?.folder ?? room?.path ?? '', true);
  } else {
    const orden = (p: string) => { const i = r?.tabs.indexOf(p) ?? -1; return i >= 0 ? i : 100 + number(p); };
    update(vid, v => ({ tabs: [...v.tabs, { id: pid, inPrompt: true }].sort((a, b) => orden(a.id) - orden(b.id)) }));
  }
  if (r?.active === pid) update(vid, { active: pid });
}

// mensajes del servidor: datos (también de terminales que sobreviven a una recarga) y estado
client.listen(m => {
  if (m.t === 'terminalData') {
    if (!win(windowOf(m.id))?.tabs.some(p => p.id === m.id)) {
      recover(m.id);
      pending.set(m.id, m.repaint ? m.data : (pending.get(m.id) ?? '') + m.data);
    } else {
      const x = xterms.get(m.id);
      // un repintado (al reengancharse) sustituye lo que hubiera: no se duplica la pantalla
      if (x) { if (m.repaint) repaint.get(m.id)?.(m.data); else x.t.write(m.data); }
      else pending.set(m.id, m.repaint ? m.data : (pending.get(m.id) ?? '') + m.data);
    }
  } else if (m.t === 'terminalState') {
    // el shell ha terminado (exit, o se cerró desde otra pestaña): la pestaña se va, y la ventana con la última
    if (!m.live) { if (removeTab(m.id)) SFX.close(); return; }
    const vid = windowOf(m.id);
    update(vid, v => ({ tabs: v.tabs.map(p => (p.id === m.id ? { ...p, inPrompt: m.inPrompt, program: m.program, outside: m.outside } : p)) }));
    // de vuelta en el shell, el programa que pidió el protocolo de kitty ya no está (aunque no lo quitara al salir)
    if (m.inPrompt) kitty.get(m.id)?.splice(0);
  }
});
const pending = new Map<string, string>();
const repaint = new Map<string, (data: string) => void>();
window.addEventListener('refugio:terminal', (e: any) => openTerminal(e.detail.roomId));

// ---------------------------------------------------------------- interfaz
export function Terminals() {
  const { list } = terminals.use(e => e);
  return <>{list.map(v => <WindowTerminal key={v.id} v={v} />)}</>;
}

function WindowTerminal({ v }: { v: WindowTerm }) {
  const frame = useRef<HTMLDivElement>(null);
  const active = v.tabs.find(p => p.id === v.active);
  const list = useRef<(() => void) | null>(null);
  // los atajos de ventana se cogen antes de que lleguen a la terminal (y al refugio)
  const shortcuts = (e: React.KeyboardEvent) => windowShortcut(e, {
    maximized: v.maximized, newTab: () => newTab(v.id), closeTab: () => askClose(v.id, [v.active]), closeWindow: () => askClose(v.id),
    minimize: () => minimize(v.id), toggleMaximize: () => toggleMaximize(v.id), moveTab: d => moveTab(v.id, d),
    goTab: n => { const p = n === 9 ? v.tabs.at(-1) : v.tabs[n - 1]; if (p) activate(v.id, p.id); },
    takeOut: () => takeASurface({ terminals: [v.active] }), list: () => list.current?.(),
  });
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || v.maximized) return;
    onFront(v.id);
    const x0 = e.clientX - v.x, y0 = e.clientY - v.y;
    const move = (ev: PointerEvent) => update(v.id, { x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - x0)), y: Math.max(0, Math.min(innerHeight - 40, ev.clientY - y0)) });
    const drop = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', drop); };
    addEventListener('pointermove', move); addEventListener('pointerup', drop);
  };
  const style: React.CSSProperties = v.maximized
    ? { left: 0, top: 0, width: '100vw', height: '100vh', resize: 'none' }
    : { left: v.x, top: v.y, width: v.w, height: v.h };
  const inRunning = v.confirm ? v.tabs.filter(p => v.confirm!.includes(p.id) && !p.inPrompt) : [];
  const path = pathWorktree(v.cwd, worktreesKnown()), wtTask = path ? worktreeTask({ path }) : undefined;
  return (
    <div ref={frame} className={'ventana-terminal interactivo' + (v.maximized ? ' maximizada' : '')} style={{ ...style, zIndex: v.maximized ? 200000 + v.z : v.z, display: v.minimized ? 'none' : undefined }}
      onPointerDown={() => onFront(v.id)} onKeyDownCapture={shortcuts}
      onMouseUp={() => { if (v.maximized) return; const r = frame.current?.getBoundingClientRect(); if (r && (Math.abs(r.width - v.w) > 2 || Math.abs(r.height - v.h) > 2)) update(v.id, { w: r.width, h: r.height }); }}>
      <div className="vt-cabeza" onPointerDown={drag} onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(v.id); }}>
        <span className="rejilla" /><span className={'pilot ' + (v.tabs.some(p => !p.inPrompt) ? 'working' : 'idle')} />
        <span className="vt-titulo">{t('windows.terminal')} · {v.title}</span><span className="vt-ruta">{v.cwd}{active?.program ? ` · ${active.program}` : ''}{active?.outside ? ` · ${t('windows.alsoOnYourDesktop')}` : ''}</span>
        <WindowButtons takeOut={() => takeASurface({ terminals: [v.active] })} takesThat={t('windows.thisTerminalTheSameOne')} maximized={v.maximized} minimize={() => minimize(v.id)} toggleMaximize={() => toggleMaximize(v.id)} close={() => askClose(v.id)} closesThat={t('windows.theTerminalAndAllIts')} />
      </div>
      {/* in opening order: a program starting does not move its tab */}
      <Tabs list={list} confirming={!!v.confirm} items={v.tabs.map(p => ({ id: p.id, name: (p.outside ? '↗ ' : '') + (p.program ?? folderName(v.cwd)), state: p.inPrompt ? 'idle' as const : 'working' as const, task: wtTask, title: (p.program ? t('windows.programaRunning', { program: p.program }) : t('windows.atThePrompt')) + (p.outside ? ` · ${t('windows.alsoOpenOnYourDesktop')}` : '') }))}
        active={v.active} activate={pid => activate(v.id, pid)} close={pids => askClose(v.id, pids)} onNew={() => newTab(v.id)} opensThat={t('windows.newTabInTheSame')} />
      <div className="vt-cuerpo">
        {v.tabs.map(p => <TabTerminal key={p.id} id={p.id} cwd={v.cwd} visible={!v.minimized && p.id === v.active} />)}
        {v.confirm && <Confirm v={v} inRunning={inRunning} />}
      </div>
    </div>
  );
}

function Confirm({ v, inRunning }: { v: WindowTerm; inRunning: Tab[] }) {
  const all = v.confirm!.length === v.tabs.length && v.tabs.length > 1;
  const what = inRunning.map(p => p.program ?? t('windows.aProcess')).join(', ') || t('windows.aProcess');
  return <Confirmation title={all ? t('windows.closeTheTerminalAndIts') : t('windows.closeThisTab')}
    text={<>{t('windows.somethingIsRunning')} <b>{what}</b>. {inRunning.length > 1 ? t('windows.ifYouCloseItThey') : t('windows.ifYouCloseItIt')} {t('windows.toKeepItGoingWithout')}</>}
    close={() => { const ids = v.confirm!; update(v.id, { confirm: undefined }); closeAlready(ids); }}
    minimize={() => { minimize(v.id); update(v.id, { confirm: undefined }); }} cancel={() => cancelClosing(v.id)} />;
}

function TabTerminal({ id, cwd, visible }: { id: string; cwd: string; visible: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const adjust = useRef(() => {});
  useEffect(() => {
    const t = new Terminal({ fontFamily: "\"Refugio Mono\", \"MesloLGS NF\", \"MesloLGS Nerd Font\", \"Hack Nerd Font\", \"JetBrainsMono Nerd Font\", Menlo, monospace", fontSize: 13, lineHeight: 1.15, cursorBlink: true, allowProposedApi: true, scrollback: 10000,
      macOptionClickForcesSelection: true, linkHandler: { activate: openLink, allowNonHttpProtocols: false },
      theme: { background: '#06120c', foreground: '#b9ffcf', cursor: '#ffb347', selectionBackground: 'rgba(157,255,184,0.3)', black: '#0a0f0c', green: '#7dff9f', yellow: '#ffb347', red: '#ff6a5a', blue: '#8ac8ff', magenta: '#e3a6c8', cyan: '#8fe8e0', white: '#e8f5ea', brightBlack: '#4f7a5f' } });
    const fit = new FitAddon(); t.loadAddon(fit);
    const u11 = new Unicode11Addon(); t.loadAddon(u11); t.unicode.activeVersion = '11';   // anchos de emoji y símbolos como iTerm
    t.loadAddon(new WebLinksAddon(openLink)); t.loadAddon(new ClipboardAddon(undefined, CLIPBOARD_ONLY_WRITE));   // ⌘+clic en URLs; OSC 52 (solo copiar desde programas)
    t.open(box.current!);
    xterms.set(id, { t, fit });
    // protocolo de teclado de kitty: una pila de banderas por pestaña
    const stack: number[] = []; kitty.set(id, stack);
    let playing = false;   // al repintar lo que ya había no se contesta a preguntas viejas (irían al shell como texto)
    const respond = (s: string) => { if (!playing) input(id, s); };
    const num = (x: number | number[] | undefined, def: number) => { const n = Array.isArray(x) ? x[0] : x; return Number.isFinite(n) && n! > 0 ? n! : def; };
    t.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => { respond(`\x1b[?${flags(id)}u`); return true; });
    t.parser.registerCsiHandler({ prefix: '>', final: 'u' }, p => { if (stack.length >= 16) stack.shift(); stack.push(num(p[0], 0)); return true; });
    t.parser.registerCsiHandler({ prefix: '<', final: 'u' }, p => { stack.splice(Math.max(0, stack.length - num(p[0], 1))); return true; });
    t.parser.registerCsiHandler({ prefix: '=', final: 'u' }, p => {
      const f = num(p[0], 0), mode = num(p[1], 1), already = flags(id), fresh = mode === 2 ? already | f : mode === 3 ? already & ~f : f;
      if (stack.length) stack[stack.length - 1] = fresh; else stack.push(fresh);
      return true;
    });
    const play = (data: string) => { playing = true; t.write(data, () => { playing = false; }); };
    repaint.set(id, data => { t.reset(); stack.splice(0); play(data); });
    const p = pending.get(id); if (p) { play(p); pending.delete(id); }
    t.onData(d => { if (!playing) input(id, d); });
    let swallowed = '';   // la tecla resuelta aquí no vuelve a entrar por keypress
    // Esc y Ctrl+C no se tocan: van al programa (con el protocolo de kitty si lo pidió), como en iTerm
    t.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && !playing) physicsKey(e);   // teclado mecánico (solo suena: no toca la tecla)
      if (e.type === 'keypress') { if (swallowed && e.key === swallowed) { swallowed = ''; return false; } return true; }
      if (e.type !== 'keydown') return true;
      swallowed = '';
      const k = keyKitty(id, e);
      const mac = k === null ? shortcutMac(t, e) : null;
      if (k !== null || mac !== null) {
        e.preventDefault(); swallowed = e.key;
        const data = k ?? (typeof mac === 'string' ? mac : '');
        if (data) { t.scrollToBottom(); input(id, data); }
        return false;
      }
      return true;
    });
    // el tamaño se manda solo con la pestaña a la vista (oculta no mide nada) y si ha cambiado
    let last = '';
    adjust.current = () => {
      if (!box.current?.offsetParent) return;
      try { fit.fit(); } catch { return; }
      const k = `${t.cols}x${t.rows}`; if (k === last) return; last = k;
      client.send({ t: 'terminalResize', id, cols: t.cols, rows: t.rows });
    };
    requestAnimationFrame(() => {
      if (box.current?.offsetParent) { try { fit.fit(); } catch {} last = `${t.cols}x${t.rows}`; }
      client.send({ t: 'terminalOpen', id, cwd, cols: t.cols, rows: t.rows });
    });
    const ro = new ResizeObserver(() => adjust.current()); ro.observe(box.current!);
    return () => { ro.disconnect(); };
  }, []);
  useEffect(() => { if (visible) setTimeout(() => { adjust.current(); xterms.get(id)?.t.focus(); }, 30); }, [visible]);
  return <div ref={box} className="vt-xterm" style={{ display: visible ? undefined : 'none' }} />;
}
