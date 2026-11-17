// Barra de ventanas, abajo a la izquierda: está siempre que haya alguna ventana abierta. Una fila por tipo, una
// encima de otra: intercomunicadores (COM, one chip per room: room · state · count; those that don't fit behind «+N»,
// sticky so switching conversations doesn't reshuffle the row; and ⋯ N with every open conversation), terminales (TERM), navegadores (NAV), el cliente de git (GIT) y los archivos (ARCH). Las minimizadas van hundidas. Un clic abre la ventana o la trae delante; si ya estaba delante, la minimiza.
// Con teclado: ⌘B desde cualquier sitio (o B en el refugio) entra en la barra; ←→ eligen, ↑↓ cambian de fila,
// Intro abre, X cierra (con lo de siempre: si hay algo en marcha, pregunta) y Esc (o ⌘B) sale.
import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { t } from '@shared/idioma';
import { terminales, onFront, minimizar, askClose as closeTerminal } from './Terminales';
import { intercoms, type WindowCom, minimizeIntercom, restoreIntercom, sessionPilot, roomTalkers, TalkerRow, ComTabs, withText, openConversation, askClose as closeIntercom } from './Dialogo';
import { juego, type DwellerSummary } from './estadoJuego';
import type { SessionSummary } from '@shared/protocolo';
import { recentFirst, sessionRecency } from '@shared/recientes';
import { vivo } from '../red/cliente';
import { Store } from './almacen';
import { writing } from '../motor/teclado';
import { SFX } from '../audio/sonido';
import { MAC, CMD } from './ventanas';
import { interlocutor } from './copias';
import { overflowChips } from './ordenPestanas';
import { navegadores, SPOTS, pageTitle, onFront as navOnFront, minimizar as navMinimize, cerrar as navClose } from './Navegadores';
import { windowGit, onFrontGit, minimizeGit, closeGit } from './git/ventana';
import { filesWindow, onFrontFiles, minimizeFiles, closeFiles } from './archivos/ventana';

const STATE_TEXT: Record<string, string> = { arrancando: t('windows.starting'), trabajando: t('windows.working'), esperando: t('windows.waitingForYou'), error: t('windows.fault'), terminada: t('windows.finished'), ociosa: t('windows.ready') };
const URGENCY: Record<string, number> = { esperando: 0, error: 1, trabajando: 2, arrancando: 2, terminada: 3, ociosa: 4 };

// the intercoms grouped by room: one chip per room, opening the one with the most recent conversation (or the last
// one in front); its hover list holds one row per intercom panel of the room (its dweller, each hologram)
type Com = { v: WindowCom; h: DwellerSummary; ses: SessionSummary[] };
export function comRooms(lista: WindowCom[], sesiones: Record<string, SessionSummary>, quien: (id: string) => DwellerSummary | null | undefined) {
  const salas = new Map<string, { sala: string; nombre: string; coms: Com[] }>();
  for (const v of lista) {
    const h = quien(v.dwellerId); if (!h) continue;
    const ses = v.pestanas.map(p => (p.vista.tipo === 'sesion' ? sesiones[p.vista.sesionId] : undefined)).filter(Boolean) as SessionSummary[];
    const g = salas.get(h.sala) ?? { sala: h.sala, nombre: h.nameRoom, coms: [] };
    g.coms.push({ v, h, ses }); salas.set(h.sala, g);
  }
  return [...salas.values()].map(g => {
    const ultima = (c: Com) => Math.max(0, ...c.ses.map(s => s.actualizada));
    const reciente = [...g.coms].sort((a, b) => ultima(b) - ultima(a) || b.v.z - a.v.z)[0];
    const ses = g.coms.flatMap(c => c.ses.map(s => ({ s, h: c.h }))).sort((a, b) => (URGENCY[a.s.estado] ?? 5) - (URGENCY[b.s.estado] ?? 5) || recentFirst(sessionRecency(a.s), sessionRecency(b.s)));
    // what a click opens: the conversation with something for you (waiting, failed, unread), on its tab; else the latest
    const aTi = ses.find(x => x.s.estado === 'esperando' || x.s.estado === 'error' || (x.s.estado === 'terminada' && x.s.sinLeer));
    return { ...g, reciente, ses, aTi, abrir: () => (aTi ? openConversation(aTi.s.id) : restoreIntercom(reciente.v.dwellerId)) };
  });
}

// the COM row's rooms left out for lack of room (by urgency), measured by the bar and kept from one measure to the
// next; the keyboard goes through them after the ones in view, on the «+N» chip
const comFuera = new Store<{ salas: string[] }>({ salas: [] });
// the rooms as the COM row goes: those in view in their order, then those behind «+N»
function comOrder<T extends { sala: string }>(salas: T[], fuera: string[]) {
  const ocultas = fuera.map(s => salas.find(g => g.sala === s)).filter(Boolean) as T[];
  return { vistas: salas.filter(g => !ocultas.includes(g)), ocultas };
}
// which rooms are most relevant to keep in view: waiting, failed, unread, then the rest in order
const roomRank = (g: ReturnType<typeof comRooms>[number]) =>
  g.aTi ? ({ esperando: 0, error: 1 } as Record<string, number>)[g.aTi.s.estado] ?? 2 : 3;

interface Elemento { clave: string; abierto: boolean; abrir: () => void; minimizar: () => void; cerrar: () => void }
// las dos filas tal como se ven (las usan el ratón y el teclado)
function filas(): Elemento[][] {
  const talking = juego.get().talkingWith;
  const terms = terminales.get().lista, visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const { vistas, ocultas } = comOrder(comRooms(intercoms.get().lista, vivo.get().sesiones, id => interlocutor(id)), comFuera.get().salas);
  const coms: Elemento[] = [...vistas, ...ocultas].map(g => {
    const enSala = g.coms.some(c => c.v.dwellerId === talking);
    return {
      clave: 'c:' + g.sala, abierto: enSala,
      abrir: () => { if (!enSala) g.abrir(); }, minimizar: minimizeIntercom,
      // closes every intercom of the room; if one asks (something running), its question shows in its window
      cerrar: () => {
        for (const c of g.coms) closeIntercom(c.v.dwellerId);
        const pregunta = g.coms.find(c => intercoms.get().lista.find(x => x.dwellerId === c.v.dwellerId)?.confirmar);
        if (pregunta && talking !== pregunta.v.dwellerId) restoreIntercom(pregunta.v.dwellerId);
      },
    };
  });
  const tes: Elemento[] = terms.map(v => ({ clave: 't:' + v.id, abierto: !v.minimizada && v.id === ahead, abrir: () => onFront(v.id), minimizar: () => minimizar(v.id), cerrar: () => closeTerminal(v.id) }));
  const navs: Elemento[] = navegadores.get().lista.map(v => ({ clave: 'n:' + v.id, abierto: !v.minimizada, abrir: () => navOnFront(v.id), minimizar: () => navMinimize(v.id), cerrar: () => navClose(v.id) }));
  const g = windowGit.get();
  const git: Elemento[] = g.abierta ? [{ clave: 'g', abierto: !g.minimizada, abrir: onFrontGit, minimizar: minimizeGit, cerrar: closeGit }] : [];
  const a = filesWindow.get();
  const arch: Elemento[] = a.abierta ? [{ clave: 'a', abierto: !a.minimizada, abrir: onFrontFiles, minimizar: minimizeFiles, cerrar: closeFiles }] : [];
  return [coms, tes, navs, git, arch];
}
const hasSomething = (fs: Elemento[][]) => fs.some(f => f.length);
// la fila con algo más cercana a la pedida (si se vació mientras se elegía)
const validRow = (fs: Elemento[][], fila: number) => { for (let d = 0; d < fs.length; d++) for (const f of [fila - d, fila + d]) if (fs[f]?.length) return f; return -1; };

// ---------------------------------------------------------------- manejo por teclado
export const seleccion = new Store<{ actual: { fila: number; i: number } | null }>({ actual: null });
let antes: Element | null = null;
export function entrar() {
  const fs = filas();
  if (!hasSomething(fs)) { SFX.noAllowed(); return; }
  // empieza en la ventana que se está usando, o en la primera
  let fila = fs.findIndex(f => f.some(x => x.abierto)); if (fila < 0) fila = fs.findIndex(f => f.length);
  const i = Math.max(0, fs[fila].findIndex(x => x.abierto));
  antes = document.activeElement; (document.activeElement as HTMLElement | null)?.blur?.();
  seleccion.set({ actual: { fila, i } }); SFX.abrir();
}
function salir(backOnFocus = true) {
  seleccion.set({ actual: null });
  if (backOnFocus && antes instanceof HTMLElement && document.contains(antes)) antes.focus();
  antes = null;
}
addEventListener('keydown', e => {
  const cmdB = (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey) && !e.altKey && e.code === 'KeyB';
  const sel = seleccion.get().actual;
  if (!sel) {
    const j = juego.get();
    const bLoose = e.code === 'KeyB' && !e.metaKey && !e.ctrlKey && !e.altKey && !j.talkingWith && !j.panel && !writing(e);
    if (cmdB || bLoose) { e.preventDefault(); e.stopPropagation(); entrar(); }
    return;
  }
  // dentro de la barra, todas las teclas son suyas
  e.preventDefault(); e.stopPropagation();
  const fs = filas();
  const fila = validRow(fs, sel.fila);
  if (fila < 0) { salir(); return; }
  const n = fs[fila].length;
  const i = Math.min(sel.i, n - 1), el = fs[fila][i];
  if (cmdB || e.code === 'Escape') { salir(); SFX.cerrar(); }
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') { seleccion.set({ actual: { fila, i: (i + 1) % n } }); SFX.tick(); }
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { seleccion.set({ actual: { fila, i: (i - 1 + n) % n } }); SFX.tick(); }
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') {
    const paso = e.code === 'ArrowUp' || e.code === 'KeyW' ? -1 : 1;
    let otra = fila; do otra = (otra + paso + fs.length) % fs.length; while (!fs[otra].length);
    if (otra !== fila) { seleccion.set({ actual: { fila: otra, i: Math.min(i, fs[otra].length - 1) } }); SFX.tick(); }
  }
  else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { salir(false); el.abrir(); SFX.clic(); }
  else if (e.code === 'KeyX' || e.code === 'Backspace' || e.code === 'Delete') { salir(false); el.cerrar(); }
  else if (e.code === 'KeyM') { el.minimizar(); }
}, true);

// ---------------------------------------------------------------- interfaz
export function Barra() {
  const terms = terminales.usar(e => e.lista);
  const coms = intercoms.usar(e => e.lista);
  const talking = juego.usar(e => e.talkingWith);
  const quien = juego.usar(e => (id: string) => interlocutor(id, e));
  const sesiones = vivo.usar(e => e.sesiones);
  const habitantes = juego.usar(e => e.habitantes), copias = juego.usar(e => e.copias);
  const navs = navegadores.usar(e => e.lista);
  const git = windowGit.usar(e => e);
  const arch = filesWindow.usar(e => e);
  const repos = vivo.usar(e => e.repos);
  const sel = seleccion.usar(e => e.actual);
  const fuera = comFuera.usar(e => e.salas);
  const caja = useRef<HTMLDivElement>(null), medida = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { addEventListener('resize', redraw); return () => removeEventListener('resize', redraw); }, []);
  // hovering an intercom chip shows its panels, to go straight to one (fixed: the row clips what overflows it)
  const [asomo, setAsomo] = useState<{ id: string; x: number; y: number } | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quedarse = () => clearTimeout(reloj.current);
  const irse = () => { clearTimeout(reloj.current); reloj.current = setTimeout(() => setAsomo(null), 200); };
  // un clic fuera de la barra la suelta
  useEffect(() => { if (!sel) return; const f = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) salir(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [!!sel]);
  const salas = comRooms(coms, sesiones, quien);
  // how many COM chips fit: the bar is as wide as its column lets it; the chips are measured in a hidden copy of the row
  useLayoutEffect(() => {
    const m = medida.current, bar = caja.current;
    if (!m || !bar) { if (comFuera.get().salas.length) comFuera.set({ salas: [] }); return; }
    const col = getComputedStyle(bar.parentElement ?? bar), b = getComputedStyle(bar), fila = m.parentElement!;
    const px = (v: string) => parseFloat(v) || 0, gap = px(getComputedStyle(m).columnGap);
    const fijo = [...fila.children].filter(x => x !== m && !x.matches('.chip-terminal, .barra-mas')).reduce((a, x) => a + (x as HTMLElement).offsetWidth + gap, 0);
    const cabe = (px(col.maxWidth) || innerWidth) - px(b.paddingLeft) - px(b.paddingRight) - px(b.borderLeftWidth) - px(b.borderRightWidth) - 6 - fijo;
    const ws = salas.map(g => (m.querySelector(`[data-sala="${CSS.escape(g.sala)}"]`) as HTMLElement | null)?.offsetWidth ?? 0);
    const mas = (m.querySelector('.barra-mas') as HTMLElement | null)?.offsetWidth ?? 0;
    // sticky: those out stay out and the rest in; only the one in front is swapped in, for the least relevant in view
    const antes = comFuera.get().salas.map(s => salas.findIndex(g => g.sala === s)).filter(i => i >= 0);
    const delante = salas.findIndex(g => g.coms.some(c => c.v.dwellerId === talking));
    const nuevo = overflowChips(ws.map(w => w + gap), salas.map(roomRank), cabe, mas + gap, antes, delante).map(i => salas[i].sala);
    if (nuevo.join('\n') !== comFuera.get().salas.join('\n')) comFuera.set({ salas: nuevo });
  });
  const fs = filas();
  if (!hasSomething(fs)) return null;
  const visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const marcado = (fila: number, i: number) => !!sel && validRow(fs, sel.fila) === fila && Math.min(sel.i, fs[fila].length - 1) === i;
  const { vistas, ocultas } = comOrder(salas, fuera);
  // the «+N» list opens on hover or click, and by itself while the keyboard is on one of the rooms behind it
  const enOcultas = !!sel && validRow(fs, sel.fila) === 0 && Math.min(sel.i, fs[0].length - 1) >= vistas.length;
  const quienEs = (h: DwellerSummary) => h.copia ? t('windows.autorSHolographicCopyBranch', { autor: h.copia.nameAuthor, rama: h.copia.rama }) : h.nombre;
  // a room's chip: its pilot, the room, its most urgent conversation's state and how many it has open (who and what in its title)
  const chip = (g: (typeof salas)[number], marca: boolean, medir = false) => {
    const worst = g.ses[0], abierto = g.coms.some(c => c.v.dwellerId === talking);
    const h = g.coms.find(c => c.v.dwellerId === talking)?.h ?? g.aTi?.h ?? g.reciente.h;
    // something typed and not sent in one of its intercoms other than the one in front
    const borradores = g.coms.filter(c => c.v.dwellerId !== talking && c.v.pestanas.some(withText));
    const clase = 'chip-terminal' + (h.copia ? ' de-copia' : '') + (abierto ? ' delante' : ' minimizada') + (worst?.s.estado === 'esperando' ? ' urgente' : '') + (marca ? ' marcado' : '');
    const cuerpo = <>
      <span className={'piloto ' + sessionPilot(worst?.s)} />
      {g.nombre}{worst ? <small> · {STATE_TEXT[worst.s.estado] ?? worst.s.estado}</small> : null}{g.ses.length > 1 ? <small> ({g.ses.length})</small> : null}{borradores.length ? <span className="marca-borrador"> ✎</span> : null}
    </>;
    if (medir) return <button key={g.sala} tabIndex={-1} data-sala={g.sala} className={clase}>{cuerpo}</button>;
    return (
      <button key={g.sala} onMouseEnter={e => { quedarse(); const r = e.currentTarget.getBoundingClientRect(); setAsomo({ id: g.sala, x: r.left, y: r.top }); }} onMouseLeave={irse}
        className={clase} onClick={() => { if (abierto) minimizeIntercom(); else g.abrir(); }}
        title={`${g.nombre}: ${g.coms.map(c => quienEs(c.h)).join(', ')}\n${worst ? `${quienEs(worst.h)} · ${STATE_TEXT[worst.s.estado] ?? worst.s.estado} · ${worst.s.titulo || t('windows.conversation')}\n` : ''}${borradores.length ? t('windows.unsentDraftWith', { quien: borradores.map(c => quienEs(c.h)).join(', ') }) + '\n' : ''}${abierto ? t('windows.clickToMinimize') : t('windows.clickToGoBackTo', { nombre: quienEs(g.aTi?.h ?? g.reciente.h) })}`}>
        {cuerpo}
      </button>
    );
  };
  // who a room's hover and «+N» lists show: one row per open intercom panel (its dweller, each hologram), as the selector
  // above the portrait, with the one its chip opens (the most important) selected
  const talkersOf = (g: (typeof salas)[number]) => roomTalkers(g.sala, habitantes, copias, coms, sesiones).filter(q => g.coms.some(c => c.v.dwellerId === q.x.id));
  const opener = (g: (typeof salas)[number]) => (g.aTi?.h ?? g.reciente.h).id;
  const talkerRows = (g: (typeof salas)[number], sel: boolean) => talkersOf(g).map(q => (
    <TalkerRow key={q.x.id} q={q} actual={q.x.id === talking} sel={sel && q.x.id === opener(g)}
      onClick={() => { setAsomo(null); if (q.x.id !== talking) restoreIntercom(q.x.id); }} />
  ));
  return (
    <div ref={caja} className={'barra-ventanas interactivo' + (sel ? ' seleccionando' : '')}>
      {sel && <div className="barra-ayuda"><kbd>←→</kbd> {t('menu.select')} <kbd>↑↓</kbd> {t('windows.row')} <kbd>{t('windows.enter')}</kbd> {t('windows.open')} <kbd>X</kbd> {t('menu.close')} <kbd>M</kbd> {t('windows.minimize2')} <kbd>Esc</kbd> {t('windows.exit')}</div>}
      {salas.length > 0 && (
        <div className="barra-fila com">
          <span className="barra-tipo" title={t('windows.intercoms')}>COM</span>
          {vistas.map((g, i) => chip(g, marcado(0, i)))}
          {ocultas.length > 0 && (
            <button className={'chip-terminal barra-mas minimizada' + (ocultas.some(g => g.ses[0]?.s.estado === 'esperando') ? ' urgente' : '') + (enOcultas ? ' marcado' : '')}
              onMouseEnter={e => { quedarse(); const r = e.currentTarget.getBoundingClientRect(); setAsomo({ id: '+', x: r.left, y: r.top }); }} onMouseLeave={irse}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAsomo(a => (a?.id === '+' ? null : { id: '+', x: r.left, y: r.top })); }}
              title={t('windows.moreRooms', { n: ocultas.length })}>
              <span className={'piloto ' + sessionPilot(ocultas[0].ses[0]?.s)} />+{ocultas.length}
            </button>
          )}
          {/* a hidden copy of every chip, to measure what fits */}
          <div ref={medida} className="barra-medida" aria-hidden>
            {salas.map(g => chip(g, false, true))}
            <button tabIndex={-1} className="chip-terminal barra-mas"><span className="piloto" />+{salas.length}</button>
          </div>
          <ComTabs />
        </div>
      )}
      {(asomo?.id === '+' || enOcultas) && ocultas.length > 0 && (() => {
        // right above «+N», growing to the left (it sits at the row's end)
        const r = caja.current?.querySelector('.barra-fila.com > .barra-mas')?.getBoundingClientRect(); if (!r) return null;
        return (
          <div className="barra-asomo barra-asomo-mas" style={{ right: innerWidth - r.right, bottom: innerHeight - r.top + 4 }} onMouseEnter={quedarse} onMouseLeave={irse}>
            {ocultas.map((g, j) => <Fragment key={g.sala}>
              <div className="barra-asomo-grupo">{g.nombre}</div>
              {talkerRows(g, ocultas.some((_, k) => marcado(0, vistas.length + k)) ? marcado(0, vistas.length + j) : j === 0)}
            </Fragment>)}
          </div>
        );
      })()}
      {asomo && asomo.id !== '+' && (() => {
        // one row per intercom panel of the room (its dweller, each hologram), as the selector above the portrait
        const g = salas.find(x => x.sala === asomo.id);
        return g ? (
          <div className="barra-asomo" style={{ left: asomo.x, bottom: innerHeight - asomo.y + 4 }} onMouseEnter={quedarse} onMouseLeave={irse}>
            {talkerRows(g, true)}
          </div>
        ) : null;
      })()}
      {terms.length > 0 && (
        <div className="barra-fila term">
          <span className="barra-tipo" title={t('windows.terminals')}>TERM</span>
          {terms.map((v, i) => {
            const inRunning = v.pestanas.filter(p => !p.inPrompt);
            return (
              <button key={v.id} className={'chip-terminal' + (v.minimizada ? ' minimizada' : '') + (v.id === ahead ? ' delante' : '') + (marcado(1, i) ? ' marcado' : '')}
                onClick={() => (v.minimizada || v.id !== ahead ? onFront(v.id) : minimizar(v.id))}
                title={`${v.cwd}\n${v.minimizada ? t('windows.clickToOpen') : v.id === ahead ? t('windows.clickToMinimize2') : t('windows.clickToBringToFront')}`}>
                <span className={'piloto ' + (inRunning.length ? 'trabajando' : 'ociosa')} />
                {v.titulo}{inRunning.length ? ` · ${inRunning.map(p => p.program).join(', ')}` : ''}{v.pestanas.length > 1 ? <small> ({v.pestanas.length})</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {navs.length > 0 && (
        <div className="barra-fila nav">
          <span className="barra-tipo" title={t('windows.browsers')}>NAV</span>
          {navs.map((v, i) => {
            const nombre = SPOTS[v.id]?.nombre ?? v.id, page = pageTitle(v);
            return (
              <button key={v.id} className={'chip-terminal' + (v.minimizada ? ' minimizada' : ' delante') + (marcado(2, i) ? ' marcado' : '')}
                onClick={() => (v.minimizada ? navOnFront(v.id) : navMinimize(v.id))}
                title={`${v.titulo}\n${v.url}\n${v.minimizada ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
                <span className={'piloto ' + (v.cargando ? 'trabajando' : 'ociosa')} />
                {nombre}{page ? <small> · {page.length > 40 ? page.slice(0, 39) + '…' : page}</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {git.abierta && (
        <div className="barra-fila git">
          <span className="barra-tipo" title={t('world.gitClient')}>GIT</span>
          <button className={'chip-terminal' + (git.minimizada ? ' minimizada' : ' delante') + (marcado(3, 0) ? ' marcado' : '')}
            onClick={() => (git.minimizada ? onFrontGit() : minimizeGit())} title={`${git.ruta ?? ''}\n${git.minimizada ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
            <span className={'piloto ' + (git.ocupado ? 'trabajando' : 'ociosa')} />
            {git.ruta?.split('/').pop() ?? 'git'}{(() => { const r = Object.values(repos).find(x => x.ruta === git.ruta); return r?.rama ? <small> · {r.rama}{r.cambios ? ` · ${t('windows.nChanges', { n: r.cambios })}` : ''}</small> : null; })()}
          </button>
        </div>
      )}
      {arch.abierta && (
        <div className="barra-fila git">
          <span className="barra-tipo" title={t('windows.files')}>ARCH</span>
          <button className={'chip-terminal' + (arch.minimizada ? ' minimizada' : ' delante') + (marcado(4, 0) ? ' marcado' : '')}
            onClick={() => (arch.minimizada ? onFrontFiles() : minimizeFiles())} title={`${arch.raiz ?? ''}\n${arch.minimizada ? t('windows.clickToOpen2') : t('windows.clickToMinimize')}`}>
            <span className="piloto ociosa" />
            {arch.raiz?.replace(/\/$/, '').split('/').pop() ?? t('windows.files2')}
          </button>
        </div>
      )}
      {!sel && <button className="tecla pista-atajo" onClick={() => entrar()} title={t('windows.useTheBarWithThe', { shortcut: `${CMD}B` })}>{CMD}B</button>}
    </div>
  );
}
