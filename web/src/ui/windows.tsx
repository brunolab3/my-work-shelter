// Ventanas del refugio (terminales e intercomunicadores): lo que tienen en común para que se manejen igual, como
// las de un sistema operativo. Botones de minimizar, ampliar y cerrar; pestañas; confirmación al cerrar con algo en
// marcha; y los mismos atajos en todas:
//   ⌘T pestaña nueva · ⌘W cerrar la pestaña · ⌘⇧W cerrar la ventana · ⌘1…⌘9 y ⌃Tab cambiar de pestaña
//   ⌘↑ ampliar · ⌘↓ restaurar (si está ampliada) o minimizar · ⌘M minimizar
//   ⌘⇧E sacar la pestaña a una terminal de tu escritorio (iTerm): «salir a la superficie»
//   ⌘⇧A list of every tab (filter, go, close)
// Minimizar deja la ventana en la barra de abajo a la izquierda (Bar.tsx) con todo en marcha.
import React, { useEffect, useRef, useState } from 'react';
import { t } from '@shared/language';
import { taskColor } from '@shared/tasks';
import { knowTasks, taskEpic, useColorsTasks } from './tasks';
import { type TabState } from './tabOrder';
export { nthTab, nextTab, type TabState } from './tabOrder';

export const MAC = /Mac/.test(navigator.platform);
// en macOS, ⌘; en el resto, Ctrl+Shift (como las terminales de Linux)
export const CMD = MAC ? '⌘' : 'Ctrl+Shift+';

// orden de apilado común a todas las ventanas
let z = 50;
export const nextZ = () => ++z;

export interface WindowActions {
  maximized: boolean;
  newTab?: () => void;
  closeTab: () => void;
  closeWindow: () => void;
  minimize: () => void;
  toggleMaximize: () => void;
  goTab: (n: number) => void;       // 1…8; 9 es la última
  list?: () => void;                    // list of every tab
  moveTab: (step: number) => void;
  takeOut?: () => void;                    // a una terminal de tu escritorio
}
/** Atajos de ventana; devuelve true si la tecla era uno de ellos (y ya se ha hecho). */
export function windowShortcut(e: KeyboardEvent | React.KeyboardEvent, a: WindowActions): boolean {
  let f: (() => void) | null = null;
  const cmd = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
  if (e.ctrlKey && !e.metaKey && e.key === 'Tab') f = () => a.moveTab(e.shiftKey ? -1 : 1);
  else if (cmd && !e.altKey) {
    if (e.code === 'KeyT' && a.newTab) f = a.newTab;
    else if (e.code === 'KeyW') f = e.shiftKey && MAC ? a.closeWindow : a.closeTab;
    else if (e.code === 'KeyM') f = a.minimize;
    else if (e.code === 'KeyE' && e.shiftKey && a.takeOut) f = a.takeOut;
    else if (e.code === 'KeyA' && (e.shiftKey || !MAC) && a.list) f = a.list;
    else if (e.key === 'ArrowUp') f = () => { if (!a.maximized) a.toggleMaximize(); };
    else if (e.key === 'ArrowDown') f = a.maximized ? a.toggleMaximize : a.minimize;
    else if (/^Digit[1-9]$/.test(e.code)) { const n = Number(e.code.slice(5)); f = () => a.goTab(n); }
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') f = () => a.moveTab(e.code === 'BracketLeft' ? -1 : 1);
  }
  if (!f) return false;
  e.preventDefault(); e.stopPropagation(); f();
  return true;
}

export function WindowButtons({ maximized, minimize, toggleMaximize, close, closesThat, takeOut, takesThat, wingApp, remote }: { maximized: boolean; minimize: () => void; toggleMaximize: () => void; close: () => void; closesThat: string; takeOut?: () => void; takesThat?: string; wingApp?: () => void; remote?: () => void }) {
  return (
    <span className="botones-ventana">
      {remote && <button className="consola-x" onClick={remote} title={t('windows.continueOnYourPhone')}>📱</button>}
      {wingApp && <button className="consola-x" onClick={wingApp} title={t('windows.continueThisConversationInThe')}>✳</button>}
      {takeOut &&<button className="consola-x" onClick={takeOut} title={t('windows.popQueOutToA', { que: takesThat ?? t('windows.thisTab'), shortcut: `${CMD}${MAC ? '⇧' : ''}E` })}>↗</button>}
      <button className="consola-x" onClick={minimize} title={t('windows.minimizeToTheBarBelow', { shortcut: `${CMD}↓` })}>_</button>
      <button className="consola-x" onClick={toggleMaximize} title={maximized ? t('windows.restoreSizeAtajo', { shortcut: `${CMD}↓` }) : t('windows.expandToFullScreenAtajo', { shortcut: `${CMD}↑` })}>{maximized ? '❐' : '▢'}</button>
      <button className="consola-x" onClick={close} title={t('windows.closeQue', { que: closesThat }) + (MAC ? ' (⌘⇧W)' : '')}>×</button>
    </span>
  );
}

export const PILOT: Record<TabState, string> = { esperando: 'esperando', sinLeer: 'terminada', error: 'error', trabajando: 'trabajando', ociosa: 'ociosa' };
export const stateLabel = (e: TabState) => ({ esperando: t('windows.waitingForYou'), sinLeer: t('windows.tabUnread'), error: t('windows.fault'), trabajando: t('windows.working'), ociosa: t('windows.tabIdle') })[e];
const LIST_SHORTCUT = `${CMD}${MAC ? '⇧' : ''}A`;
/** ✎ on a tab, a list row or a talker with something typed and not sent: quieter than the state flags */
/** A task's epic, beside its color marker: a small diamond in the epic's color (not round, so it's never taken for a state
 *  light); nothing for tasks without one. Repaints with useColorsTasks */
export function EpicMark({ taskKey }: { taskKey?: string }) {
  const e = taskEpic(taskKey);
  return e ? <span className="marca-epica" style={{ '--epica': taskColor(e.key) } as React.CSSProperties} title={t('windows.epicOf', { clave: e.key, titulo: e.title })} /> : null;
}
/** A task's color marker and, if it has one, its epic's */
export const TaskMark = ({ taskKey, color }: { taskKey?: string; color?: string }) => <><span className="marca-tarea" style={{ '--tarea': color ?? taskColor(taskKey) } as React.CSSProperties} title={taskKey} /><EpicMark taskKey={taskKey} /></>;

export const DraftMark = () => <span className="marca-borrador" title={t('windows.unsentDraft')}>✎</span>;
// messages waiting in the conversation's queue (shared/messageQueue.ts)
export const QueuedMark = ({ n }: { n?: number }) => n ? <span className="marca-cola" title={t('windows.queue.markTitle', { n })}>{t('windows.queue.mark', { n })}</span> : null;

// grupo: with «group by room», tabs of a group sit together under its header; quien: whose it is (another window);
// borrador: it has unsent text or attachments (DraftMark); queued: messages its conversation has not taken yet (QueuedMark)
export interface ItemTab { id: string; name: string; state?: TabState; title?: string; room?: string; task?: string; activity?: string; group?: string; who?: string; draft?: boolean; queued?: number }

// lista: the ⋯ N button and its list in the strip (terminals); intercoms keep theirs in the bar (ComTabs in Dialog.tsx)
export function Tabs({ items, active, activate, close, onNew, opensThat, list, confirming }: { items: ItemTab[]; active: string; activate: (id: string) => void; close: (ids: string[]) => void; onNew?: () => void; opensThat: string; list?: React.MutableRefObject<(() => void) | null>; confirming?: boolean }) {
  const [open, setOpen] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  if (list) list.current = () => setOpen(x => !x);
  useColorsTasks();
  const tareas = items.map(p => p.task).join(' ');
  useEffect(() => { knowTasks(tareas.split(' ')); }, [tareas]);
  // with many tabs the strip scrolls (also with the wheel) and the active one stays in view
  useEffect(() => {
    const c = strip.current, el = c?.querySelector<HTMLElement>('.vt-pestana.activa');
    if (!c || !el) return;
    if (el.offsetLeft < c.scrollLeft) c.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > c.scrollLeft + c.clientWidth) c.scrollLeft = el.offsetLeft + el.offsetWidth - c.clientWidth + 8;
  }, [active, items.length]);
  return (
    <div className="vt-pestanas">
      <div className="vt-pestanas-tira" ref={strip} onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
        {items.map((p, i) => (<React.Fragment key={p.id}>
          <div className={'vt-pestana' + (p.id === active ? ' activa' : '') + (p.state ? ' e-' + p.state : '') + (p.task ? ' con-tarea' : '')} style={p.task ? { '--tarea': taskColor(p.task) } as React.CSSProperties : undefined}
            onClick={() => activate(p.id)} onAuxClick={e => { if (e.button === 1) close([p.id]); }}
            title={[p.title || p.name, p.state && stateLabel(p.state), p.draft && t('windows.unsentDraft'), p.queued && t('windows.queue.markTitle', { n: p.queued }), p.who, p.task, i < 9 ? `${CMD}${i + 1}` : ''].filter(Boolean).join(' · ')}>
            <span className={'piloto ' + PILOT[p.state ?? 'ociosa']} />
            {p.draft && <DraftMark />}
            <EpicMark taskKey={p.task} />
            <span className="vt-pestana-nombre">{p.name}</span>
            <QueuedMark n={p.queued} />
            <button className="vt-pestana-x" onClick={e => { e.stopPropagation(); close([p.id]); }} title={t('windows.closeTabAtajo', { shortcut: `${CMD}W` })}>×</button>
          </div>
        </React.Fragment>))}
      </div>
      {onNew && <button className="vt-nueva" onClick={onNew} title={`${opensThat} (${CMD}T)`}>+</button>}
      {list && items.length > 1 && <button className={'vt-todas' + (open ? ' activa' : '')} onClick={() => setOpen(x => !x)} title={t('windows.allTabs', { n: items.length, shortcut: LIST_SHORTCUT })}>⋯ {items.length}</button>}
      {/* the list steps aside while a close is being confirmed */}
      {open && !confirming && <TabList items={items} active={active} activate={id => { activate(id); setOpen(false); }} close={close} exit={() => setOpen(false)} />}
    </div>
  );
}

// Every tab in a list: state, title, task, room or owner and last activity; type to filter, go to one, and close (one,
// the selected ones, the read or idle ones, or a task's). agrupar: a header per group (items come grouped).
// cabecera: what heads each group instead of its name (given the tab before it), and then the rows don't repeat whose they are
export function TabList({ items, active, activate, close, exit, group, header }: { items: ItemTab[]; active: string; activate: (id: string) => void; close: (ids: string[]) => void; exit: () => void; group?: boolean; header?: (p: ItemTab, before?: ItemTab) => React.ReactNode }) {
  const [filter, setFilter] = useState('');
  const [i, setI] = useState(() => Math.max(0, items.findIndex(p => p.id === active)));
  const [marked, setMarked] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const views = q ? items.filter(p => [p.name, p.room, p.task, p.who, p.state && stateLabel(p.state)].some(x => x?.toLowerCase().includes(q))) : items;
  const sel = views[Math.min(i, views.length - 1)];
  const openSessions = new Set(items.map(p => p.id));
  const picked = marked.filter(id => openSessions.has(id));
  const idle = items.filter(p => p.state === 'ociosa').map(p => p.id);
  const taskSession = sel?.task ? items.filter(p => p.task === sel.task).map(p => p.id) : [];
  // on closing, the keyboard goes back where it was (the terminal, the intercom's text box)
  const [before] = useState(() => document.activeElement as HTMLElement | null);   // before the filter takes it
  useEffect(() => () => { setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) before?.focus(); }); }, []);
  useEffect(() => {
    const outside = (e: PointerEvent) => { const el = e.target as HTMLElement; if (!box.current?.contains(el) && !el.closest?.('.vt-todas, .vt-confirmar')) exit(); };
    addEventListener('pointerdown', outside, true); return () => removeEventListener('pointerdown', outside, true);
  }, []);
  useEffect(() => { box.current?.querySelector('.vt-lista-fila.sel')?.scrollIntoView({ block: 'nearest' }); }, [i, q]);
  const key = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k !== 'Escape' && k !== 'ArrowDown' && k !== 'ArrowUp' && !(k === 'Enter' && sel)) return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape') exit();
    else if (k === 'Enter') activate(sel.id);
    else setI(x => Math.max(0, Math.min(views.length - 1, x + (k === 'ArrowDown' ? 1 : -1))));
  };
  const button = (text: string, ids: string[]) => ids.length ? <button className="consola-x" onClick={() => { close(ids); setMarked(m => m.filter(x => !ids.includes(x))); }}>{text}</button> : null;
  return (
    <div className="vt-lista" ref={box} onKeyDown={key}>
      <input className="vt-lista-filtro" autoFocus value={filter} placeholder={t('windows.filterTabs')} spellCheck={false} onChange={e => { setFilter(e.target.value); setI(0); }} />
      <div className="vt-lista-filas">
        {views.map((p, k) => (<React.Fragment key={p.id}>
          {group && p.group !== views[k - 1]?.group && (header ? header(p, views[k - 1]) : <div className="vt-lista-grupo">{p.group}</div>)}
          <div className={'vt-lista-fila' + (p === sel ? ' sel' : '') + (p.id === active ? ' activa' : '') + (p.state ? ' e-' + p.state : '')} onMouseMove={() => setI(k)} onClick={() => activate(p.id)}>
            <input type="checkbox" checked={marked.includes(p.id)} title={t('windows.selectTab')} onClick={e => e.stopPropagation()} onChange={() => setMarked(m => (m.includes(p.id) ? m.filter(x => x !== p.id) : [...m, p.id]))} />
            <span className={'piloto ' + PILOT[p.state ?? 'ociosa']} />
            <span className="vt-lista-estado">{p.state ? stateLabel(p.state) : ''}</span>
            <span className="vt-lista-nombre">{p.draft && <DraftMark />}{p.name} <QueuedMark n={p.queued} /></span>
            <span className="vt-lista-tarea">{p.task && <><TaskMark taskKey={p.task} />{p.task}</>}</span>
            <span className="vt-lista-sala">{header ? '' : p.who ?? p.room}</span>
            <span className="vt-lista-cuando">{p.activity}</span>
            <button className="vt-pestana-x" onClick={e => { e.stopPropagation(); close([p.id]); }} title={t('windows.closeTabAtajo', { shortcut: `${CMD}W` })}>×</button>
          </div>
        </React.Fragment>))}
        {!views.length && <div className="vt-lista-vacia">{t('windows.noTabsMatch')}</div>}
      </div>
      <div className="vt-lista-pie">
        {button(t('windows.closeSelected', { n: picked.length }), picked)}
        {button(t('windows.closeIdle', { n: idle.length }), idle)}
        {sel?.task && button(t('windows.closeTask', { tarea: sel.task, n: taskSession.length }), taskSession)}
        <span className="vt-lista-ayuda">{t('windows.tabListHelp')}</span>
      </div>
    </div>
  );
}

// Cerrar termina lo que hay en marcha: se pregunta. Intro cierra, Esc cancela; o se minimiza y sigue.
export function Confirmation({ title, text, close, minimize, cancel, button = t('windows.closeAndEndEnter') }: { title: string; text: React.ReactNode; close: () => void; minimize: () => void; cancel: () => void; button?: string }) {
  const si = useRef<HTMLButtonElement>(null);
  useEffect(() => { si.current?.focus(); }, []);
  return (
    <div className="vt-confirmar" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}>
      <div className="vt-confirmar-caja">
        <p><b>{title}</b></p>
        <p>{text}</p>
        <div className="vt-confirmar-botones">
          <button ref={si} className="consola-x" onClick={close}>{button}</button>
          <button className="consola-x" onClick={minimize}>{t('windows.minimize')}</button>
          <button className="consola-x" onClick={cancel}>{t('windows.cancelEsc')}</button>
        </div>
      </div>
    </div>
  );
}
