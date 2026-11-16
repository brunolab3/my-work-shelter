// Barra de ventanas, abajo a la izquierda: está siempre que haya alguna ventana abierta. Una fila por tipo, una
// encima de otra: intercomunicadores (COM, one chip per room), terminales (TERM), navegadores (NAV), el cliente de git (GIT) y los archivos (ARCH). Las minimizadas van hundidas. Un clic abre la ventana o la trae delante; si ya estaba delante, la minimiza.
// Con teclado: ⌘B desde cualquier sitio (o B en el refugio) entra en la barra; ←→ eligen, ↑↓ cambian de fila,
// Intro abre, X cierra (con lo de siempre: si hay algo en marcha, pregunta) y Esc (o ⌘B) sale.
import { useEffect, useRef, useState } from 'react';
import { t } from '@shared/idioma';
import { terminales, onFront, minimizar, askClose as closeTerminal } from './Terminales';
import { intercoms, type WindowCom, minimizeIntercom, restoreIntercom, sessionPilot, openConversation, hace, askClose as closeIntercom } from './Dialogo';
import { juego, type DwellerSummary } from './estadoJuego';
import type { SessionSummary } from '@shared/protocolo';
import { recentFirst, sessionRecency } from '@shared/recientes';
import { vivo } from '../red/cliente';
import { Store } from './almacen';
import { writing } from '../motor/teclado';
import { SFX } from '../audio/sonido';
import { MAC, CMD } from './ventanas';
import { interlocutor } from './copias';
import { navegadores, SPOTS, pageTitle, onFront as navOnFront, minimizar as navMinimize, cerrar as navClose } from './Navegadores';
import { windowGit, onFrontGit, minimizeGit, closeGit } from './git/ventana';
import { filesWindow, onFrontFiles, minimizeFiles, closeFiles } from './archivos/ventana';

const STATE_TEXT: Record<string, string> = { arrancando: t('windows.starting'), trabajando: t('windows.working'), esperando: t('windows.waitingForYou'), error: t('windows.fault'), terminada: t('windows.finished'), ociosa: t('windows.ready') };
const URGENCY: Record<string, number> = { esperando: 0, error: 1, trabajando: 2, arrancando: 2, terminada: 3, ociosa: 4 };

// the intercoms grouped by room: one chip per room, opening the one with the most recent conversation (or the last
// one in front); its hover list holds every conversation of the room, of whoever it is
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
    return { ...g, reciente, ses };
  });
}

interface Elemento { clave: string; abierto: boolean; abrir: () => void; minimizar: () => void; cerrar: () => void }
// las dos filas tal como se ven (las usan el ratón y el teclado)
function filas(): Elemento[][] {
  const talking = juego.get().talkingWith;
  const terms = terminales.get().lista, visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const coms: Elemento[] = comRooms(intercoms.get().lista, vivo.get().sesiones, id => interlocutor(id)).map(g => {
    const enSala = g.coms.some(c => c.v.dwellerId === talking);
    return {
      clave: 'c:' + g.sala, abierto: enSala,
      abrir: () => { if (!enSala) restoreIntercom(g.reciente.v.dwellerId); }, minimizar: minimizeIntercom,
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
  const navs = navegadores.usar(e => e.lista);
  const git = windowGit.usar(e => e);
  const arch = filesWindow.usar(e => e);
  const repos = vivo.usar(e => e.repos);
  const sel = seleccion.usar(e => e.actual);
  const caja = useRef<HTMLDivElement>(null);
  // hovering an intercom chip shows its conversations, to go straight to one (fixed: the row clips what overflows it)
  const [asomo, setAsomo] = useState<{ id: string; x: number; y: number } | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quedarse = () => clearTimeout(reloj.current);
  const irse = () => { clearTimeout(reloj.current); reloj.current = setTimeout(() => setAsomo(null), 200); };
  // un clic fuera de la barra la suelta
  useEffect(() => { if (!sel) return; const f = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) salir(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [!!sel]);
  const fs = filas();
  if (!hasSomething(fs)) return null;
  const visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const marcado = (fila: number, i: number) => !!sel && validRow(fs, sel.fila) === fila && Math.min(sel.i, fs[fila].length - 1) === i;
  const salas = comRooms(coms, sesiones, quien);
  const quienEs = (h: DwellerSummary) => h.copia ? t('windows.autorSHolographicCopyBranch', { autor: h.copia.nameAuthor, rama: h.copia.rama }) : h.nombre;
  return (
    <div ref={caja} className={'barra-ventanas interactivo' + (sel ? ' seleccionando' : '')}>
      {sel && <div className="barra-ayuda"><kbd>←→</kbd> {t('menu.select')} <kbd>↑↓</kbd> {t('windows.row')} <kbd>{t('windows.enter')}</kbd> {t('windows.open')} <kbd>X</kbd> {t('menu.close')} <kbd>M</kbd> {t('windows.minimize2')} <kbd>Esc</kbd> {t('windows.exit')}</div>}
      {salas.length > 0 && (
        <div className="barra-fila com">
          <span className="barra-tipo" title={t('windows.intercoms')}>COM</span>
          {salas.map((g, i) => {
            const worst = g.ses[0]?.s, abierto = g.coms.some(c => c.v.dwellerId === talking);
            const h = (g.coms.find(c => c.v.dwellerId === talking) ?? g.reciente).h;
            return (
              <button key={g.sala} onMouseEnter={e => { quedarse(); const r = e.currentTarget.getBoundingClientRect(); if (g.ses.length > 1 || g.coms.length > 1) setAsomo({ id: g.sala, x: r.left, y: r.top }); else setAsomo(null); }} onMouseLeave={irse}
                className={'chip-terminal' + (h.copia ? ' de-copia' : '') + (abierto ? ' delante' : ' minimizada') + (worst?.estado === 'esperando' ? ' urgente' : '') + (marcado(0, i) ? ' marcado' : '')}
                onClick={() => (abierto ? minimizeIntercom() : restoreIntercom(g.reciente.v.dwellerId))}
                title={`${g.nombre}: ${g.coms.map(c => quienEs(c.h)).join(', ')}\n${abierto ? t('windows.clickToMinimize') : t('windows.clickToGoBackTo', { nombre: quienEs(g.reciente.h) })}`}>
                <span className={'piloto ' + sessionPilot(worst)} />
                <span className="tipo">{g.nombre}</span>
                {h.copia ? <span className="marca-copia">◇ </span> : null}{h.nombre}{worst ? ` · ${STATE_TEXT[worst.estado] ?? worst.estado}` : ''}{g.ses.length > 1 ? <small> ({g.ses.length})</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {asomo && (() => {
        const g = salas.find(x => x.sala === asomo.id);
        return g?.ses.length ? (
          <div className="barra-asomo" style={{ left: asomo.x, bottom: innerHeight - asomo.y + 4 }} onMouseEnter={quedarse} onMouseLeave={irse}>
            {g.ses.map(({ s, h }) => (
              <button key={s.id} className={'barra-asomo-fila' + (s.estado === 'esperando' ? ' urgente' : '') + (s.estado === 'terminada' && s.sinLeer ? ' sin-leer' : '')} onClick={() => { setAsomo(null); openConversation(s.id); }}>
                <span className={'piloto ' + (s.estado === 'terminada' && s.sinLeer ? 'terminada' : sessionPilot(s))} /><span className="barra-asomo-estado">{s.estado === 'terminada' && s.sinLeer ? t('windows.tabUnread') : STATE_TEXT[s.estado] ?? s.estado}</span>
                <span className="barra-asomo-titulo">{g.coms.length > 1 ? <b className={h.copia ? 'marca-copia' : undefined}>{h.nombre} · </b> : null}{s.titulo || t('windows.conversation')}</span><small>{hace(s.actualizada)}</small>
              </button>
            ))}
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
