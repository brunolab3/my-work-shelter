// Ventanas del refugio (terminales e intercomunicadores): lo que tienen en común para que se manejen igual, como
// las de un sistema operativo. Botones de minimizar, ampliar y cerrar; pestañas; confirmación al cerrar con algo en
// marcha; y los mismos atajos en todas:
//   ⌘T pestaña nueva · ⌘W cerrar la pestaña · ⌘⇧W cerrar la ventana · ⌘1…⌘9 y ⌃Tab cambiar de pestaña
//   ⌘↑ ampliar · ⌘↓ restaurar (si está ampliada) o minimizar · ⌘M minimizar
//   ⌘⇧E sacar la pestaña a una terminal de tu escritorio (iTerm): «salir a la superficie»
//   ⌘⇧A list of every tab (filter, go, close)
// Minimizar deja la ventana en la barra de abajo a la izquierda (Barra.tsx) con todo en marcha.
import React, { useEffect, useRef, useState } from 'react';
import { t } from '@shared/idioma';
import { taskColor } from '@shared/tareas';
import { knowTasks, useColorsTasks } from './tareas';
import { orderTabs, type TabState } from './ordenPestanas';
export { nthTab, nextTab, type TabState } from './ordenPestanas';

export const MAC = /Mac/.test(navigator.platform);
// en macOS, ⌘; en el resto, Ctrl+Shift (como las terminales de Linux)
export const CMD = MAC ? '⌘' : 'Ctrl+Shift+';

// orden de apilado común a todas las ventanas
let z = 50;
export const nextZ = () => ++z;

export interface WindowActions {
  maximizada: boolean;
  newTab?: () => void;
  closeTab: () => void;
  closeWindow: () => void;
  minimizar: () => void;
  toggleMaximize: () => void;
  goTab: (n: number) => void;       // 1…8; 9 es la última
  lista?: () => void;                    // list of every tab
  moveTab: (paso: number) => void;
  sacar?: () => void;                    // a una terminal de tu escritorio
}
/** Atajos de ventana; devuelve true si la tecla era uno de ellos (y ya se ha hecho). */
export function windowShortcut(e: KeyboardEvent | React.KeyboardEvent, a: WindowActions): boolean {
  let f: (() => void) | null = null;
  const cmd = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
  if (e.ctrlKey && !e.metaKey && e.key === 'Tab') f = () => a.moveTab(e.shiftKey ? -1 : 1);
  else if (cmd && !e.altKey) {
    if (e.code === 'KeyT' && a.newTab) f = a.newTab;
    else if (e.code === 'KeyW') f = e.shiftKey && MAC ? a.closeWindow : a.closeTab;
    else if (e.code === 'KeyM') f = a.minimizar;
    else if (e.code === 'KeyE' && e.shiftKey && a.sacar) f = a.sacar;
    else if (e.code === 'KeyA' && (e.shiftKey || !MAC) && a.lista) f = a.lista;
    else if (e.key === 'ArrowUp') f = () => { if (!a.maximizada) a.toggleMaximize(); };
    else if (e.key === 'ArrowDown') f = a.maximizada ? a.toggleMaximize : a.minimizar;
    else if (/^Digit[1-9]$/.test(e.code)) { const n = Number(e.code.slice(5)); f = () => a.goTab(n); }
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') f = () => a.moveTab(e.code === 'BracketLeft' ? -1 : 1);
  }
  if (!f) return false;
  e.preventDefault(); e.stopPropagation(); f();
  return true;
}

export function WindowButtons({ maximizada, minimizar, toggleMaximize, cerrar, closesThat, sacar, takesThat, wingApp, remoto }: { maximizada: boolean; minimizar: () => void; toggleMaximize: () => void; cerrar: () => void; closesThat: string; sacar?: () => void; takesThat?: string; wingApp?: () => void; remoto?: () => void }) {
  return (
    <span className="botones-ventana">
      {remoto && <button className="consola-x" onClick={remoto} title={t('windows.continueOnYourPhone')}>📱</button>}
      {wingApp && <button className="consola-x" onClick={wingApp} title={t('windows.continueThisConversationInThe')}>✳</button>}
      {sacar &&<button className="consola-x" onClick={sacar} title={t('windows.popQueOutToA', { que: takesThat ?? t('windows.thisTab'), shortcut: `${CMD}${MAC ? '⇧' : ''}E` })}>↗</button>}
      <button className="consola-x" onClick={minimizar} title={t('windows.minimizeToTheBarBelow', { shortcut: `${CMD}↓` })}>_</button>
      <button className="consola-x" onClick={toggleMaximize} title={maximizada ? t('windows.restoreSizeAtajo', { shortcut: `${CMD}↓` }) : t('windows.expandToFullScreenAtajo', { shortcut: `${CMD}↑` })}>{maximizada ? '❐' : '▢'}</button>
      <button className="consola-x" onClick={cerrar} title={t('windows.closeQue', { que: closesThat }) + (MAC ? ' (⌘⇧W)' : '')}>×</button>
    </span>
  );
}

const PILOT: Record<TabState, string> = { esperando: 'esperando', sinLeer: 'terminada', error: 'error', trabajando: 'trabajando', ociosa: 'ociosa' };
const stateLabel = (e: TabState) => ({ esperando: t('windows.waitingForYou'), sinLeer: t('windows.tabUnread'), error: t('windows.fault'), trabajando: t('windows.working'), ociosa: t('windows.tabIdle') })[e];
const LIST_SHORTCUT = `${CMD}${MAC ? '⇧' : ''}A`;

// grupo: with «group by room», tabs of a group sit together under its header; quien: whose it is (another window)
export interface ItemTab { id: string; nombre: string; estado?: TabState; titulo?: string; sala?: string; tarea?: string; actividad?: string; grupo?: string; quien?: string }

/** The visible order: the tab you are using stays put; it is re-sorted when you switch to another. */
export function useTabOrder<T extends { id: string; estado?: TabState; grupo?: string }>(items: T[], activa: string, agrupar = false): T[] {
  const antes = useRef<{ activa: string; estado?: TabState; orden: string[] } | null>(null);
  const a = antes.current?.activa === activa ? antes.current : undefined;
  // it sorts (and weighs on its group) with the state it had when you switched to it
  const estado = a ? a.estado : items.find(x => x.id === activa)?.estado;
  const ordenados = orderTabs(items.map(x => ({ id: x.id, grupo: x.grupo, estado: x.id === activa ? estado : x.estado, x })),
    a ? { id: activa, i: a.orden.indexOf(activa) } : undefined, agrupar).map(y => y.x);
  antes.current = { activa, estado, orden: ordenados.map(x => x.id) };
  return ordenados;
}
/** «Group by room», remembered by this page */
const GROUPING = 'refugio.pestanas.agrupar';
export function useGrouping(): [boolean, (b: boolean) => void] {
  const [b, setB] = useState(() => localStorage.getItem(GROUPING) !== '0');
  return [b, (x: boolean) => { localStorage.setItem(GROUPING, x ? '1' : '0'); setB(x); }];
}
export function Tabs({ items, activa, activar, cerrar, nueva, opensThat, lista, agrupar, confirmando }: { items: ItemTab[]; activa: string; activar: (id: string) => void; cerrar: (ids: string[]) => void; nueva?: () => void; opensThat: string; lista?: React.MutableRefObject<(() => void) | null>; agrupar?: [boolean, (b: boolean) => void]; confirmando?: boolean }) {
  const rotulos = !!agrupar?.[0];
  const [abierta, setAbierta] = useState(false);
  const tira = useRef<HTMLDivElement>(null);
  if (lista) lista.current = () => setAbierta(x => !x);
  useColorsTasks();
  const tareas = items.map(p => p.tarea).join(' ');
  useEffect(() => { knowTasks(tareas.split(' ')); }, [tareas]);
  // with many tabs the strip scrolls (also with the wheel) and the active one stays in view
  useEffect(() => {
    const c = tira.current, el = c?.querySelector<HTMLElement>('.vt-pestana.activa');
    if (!c || !el) return;
    if (el.offsetLeft < c.scrollLeft) c.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > c.scrollLeft + c.clientWidth) c.scrollLeft = el.offsetLeft + el.offsetWidth - c.clientWidth + 8;
  }, [activa, items.length]);
  return (
    <div className="vt-pestanas">
      <div className="vt-pestanas-tira" ref={tira} onWheel={e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}>
        {items.map((p, i) => (<React.Fragment key={p.id}>
          {rotulos && p.grupo !== items[i - 1]?.grupo && <span className="vt-grupo">{p.grupo}</span>}
          <div className={'vt-pestana' + (p.id === activa ? ' activa' : '') + (p.estado ? ' e-' + p.estado : '') + (p.tarea ? ' con-tarea' : '')} style={p.tarea ? { '--tarea': taskColor(p.tarea) } as React.CSSProperties : undefined}
            onClick={() => activar(p.id)} onAuxClick={e => { if (e.button === 1) cerrar([p.id]); }}
            title={[p.titulo || p.nombre, p.estado && stateLabel(p.estado), p.quien, p.tarea, i < 9 ? `${CMD}${i + 1}` : ''].filter(Boolean).join(' · ')}>
            <span className={'piloto ' + PILOT[p.estado ?? 'ociosa']} />
            <span className="vt-pestana-nombre">{p.nombre}</span>
            <button className="vt-pestana-x" onClick={e => { e.stopPropagation(); cerrar([p.id]); }} title={t('windows.closeTabAtajo', { shortcut: `${CMD}W` })}>×</button>
          </div>
        </React.Fragment>))}
      </div>
      {nueva && <button className="vt-nueva" onClick={nueva} title={`${opensThat} (${CMD}T)`}>+</button>}
      {items.length > 1 && <button className={'vt-todas' + (abierta ? ' activa' : '')} onClick={() => setAbierta(x => !x)} title={t('windows.allTabs', { n: items.length, shortcut: LIST_SHORTCUT })}>⋯ {items.length}</button>}
      {/* the list steps aside while a close is being confirmed */}
      {abierta && !confirmando && <TabList items={items} agrupar={agrupar} activa={activa} activar={id => { activar(id); setAbierta(false); }} cerrar={cerrar} salir={() => setAbierta(false)} />}
    </div>
  );
}

// Every tab of the window in a list: state, title, task, room or owner and last activity; type to filter, go to one,
// and close (one, the selected ones, the read or idle ones, or a task's).
function TabList({ items, activa, activar, cerrar, salir, agrupar }: { items: ItemTab[]; activa: string; activar: (id: string) => void; cerrar: (ids: string[]) => void; salir: () => void; agrupar?: [boolean, (b: boolean) => void] }) {
  const [filtro, setFiltro] = useState('');
  const [i, setI] = useState(() => Math.max(0, items.findIndex(p => p.id === activa)));
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const caja = useRef<HTMLDivElement>(null);
  const q = filtro.trim().toLowerCase();
  const vistas = q ? items.filter(p => [p.nombre, p.sala, p.tarea, p.quien, p.estado && stateLabel(p.estado)].some(x => x?.toLowerCase().includes(q))) : items;
  const sel = vistas[Math.min(i, vistas.length - 1)];
  const abiertas = new Set(items.map(p => p.id));
  const elegidas = marcadas.filter(id => abiertas.has(id));
  const ociosas = items.filter(p => p.estado === 'ociosa').map(p => p.id);
  const deTarea = sel?.tarea ? items.filter(p => p.tarea === sel.tarea).map(p => p.id) : [];
  // on closing, the keyboard goes back where it was (the terminal, the intercom's text box)
  const [antes] = useState(() => document.activeElement as HTMLElement | null);   // before the filter takes it
  useEffect(() => () => { setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) antes?.focus(); }); }, []);
  useEffect(() => {
    const fuera = (e: PointerEvent) => { const el = e.target as HTMLElement; if (!caja.current?.contains(el) && !el.closest?.('.vt-todas, .vt-confirmar')) salir(); };
    addEventListener('pointerdown', fuera, true); return () => removeEventListener('pointerdown', fuera, true);
  }, []);
  useEffect(() => { caja.current?.querySelector('.vt-lista-fila.sel')?.scrollIntoView({ block: 'nearest' }); }, [i, q]);
  const tecla = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k !== 'Escape' && k !== 'ArrowDown' && k !== 'ArrowUp' && !(k === 'Enter' && sel)) return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'Escape') salir();
    else if (k === 'Enter') activar(sel.id);
    else setI(x => Math.max(0, Math.min(vistas.length - 1, x + (k === 'ArrowDown' ? 1 : -1))));
  };
  const boton = (texto: string, ids: string[]) => ids.length ? <button className="consola-x" onClick={() => { cerrar(ids); setMarcadas(m => m.filter(x => !ids.includes(x))); }}>{texto}</button> : null;
  return (
    <div className="vt-lista" ref={caja} onKeyDown={tecla}>
      <input className="vt-lista-filtro" autoFocus value={filtro} placeholder={t('windows.filterTabs')} spellCheck={false} onChange={e => { setFiltro(e.target.value); setI(0); }} />
      <div className="vt-lista-filas">
        {vistas.map((p, k) => (<React.Fragment key={p.id}>
          {agrupar?.[0] && p.grupo !== vistas[k - 1]?.grupo && <div className="vt-lista-grupo">{p.grupo}</div>}
          <div className={'vt-lista-fila' + (p === sel ? ' sel' : '') + (p.id === activa ? ' activa' : '') + (p.estado ? ' e-' + p.estado : '')} onMouseMove={() => setI(k)} onClick={() => activar(p.id)}>
            <input type="checkbox" checked={marcadas.includes(p.id)} title={t('windows.selectTab')} onClick={e => e.stopPropagation()} onChange={() => setMarcadas(m => (m.includes(p.id) ? m.filter(x => x !== p.id) : [...m, p.id]))} />
            <span className={'piloto ' + PILOT[p.estado ?? 'ociosa']} />
            <span className="vt-lista-estado">{p.estado ? stateLabel(p.estado) : ''}</span>
            <span className="vt-lista-nombre">{p.nombre}</span>
            <span className="vt-lista-tarea">{p.tarea && <><span className="marca-tarea" style={{ '--tarea': taskColor(p.tarea) } as React.CSSProperties} />{p.tarea}</>}</span>
            <span className="vt-lista-sala">{p.quien ?? p.sala}</span>
            <span className="vt-lista-cuando">{p.actividad}</span>
            <button className="vt-pestana-x" onClick={e => { e.stopPropagation(); cerrar([p.id]); }} title={t('windows.closeTabAtajo', { shortcut: `${CMD}W` })}>×</button>
          </div>
        </React.Fragment>))}
        {!vistas.length && <div className="vt-lista-vacia">{t('windows.noTabsMatch')}</div>}
      </div>
      <div className="vt-lista-pie">
        {boton(t('windows.closeSelected', { n: elegidas.length }), elegidas)}
        {boton(t('windows.closeIdle', { n: ociosas.length }), ociosas)}
        {sel?.tarea && boton(t('windows.closeTask', { tarea: sel.tarea, n: deTarea.length }), deTarea)}
        {agrupar && <label className="vt-lista-agrupar"><input type="checkbox" checked={agrupar[0]} onChange={e => agrupar[1](e.target.checked)} /> {t('windows.groupByRoom')}</label>}
        <span className="vt-lista-ayuda">{t('windows.tabListHelp')}</span>
      </div>
    </div>
  );
}

// Cerrar termina lo que hay en marcha: se pregunta. Intro cierra, Esc cancela; o se minimiza y sigue.
export function Confirmation({ titulo, texto, cerrar, minimizar, cancelar, boton = t('windows.closeAndEndEnter') }: { titulo: string; texto: React.ReactNode; cerrar: () => void; minimizar: () => void; cancelar: () => void; boton?: string }) {
  const si = useRef<HTMLButtonElement>(null);
  useEffect(() => { si.current?.focus(); }, []);
  return (
    <div className="vt-confirmar" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); cancelar(); } }}>
      <div className="vt-confirmar-caja">
        <p><b>{titulo}</b></p>
        <p>{texto}</p>
        <div className="vt-confirmar-botones">
          <button ref={si} className="consola-x" onClick={cerrar}>{boton}</button>
          <button className="consola-x" onClick={minimizar}>{t('windows.minimize')}</button>
          <button className="consola-x" onClick={cancelar}>{t('windows.cancelEsc')}</button>
        </div>
      </div>
    </div>
  );
}
