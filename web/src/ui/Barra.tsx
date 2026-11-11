// Barra de ventanas, abajo a la izquierda: está siempre que haya alguna ventana abierta. Una fila por tipo, una
// encima de otra: intercomunicadores (COM), terminales (TERM), navegadores (NAV), el cliente de git (GIT) y los archivos (ARCH). Las minimizadas van hundidas. Un clic abre la ventana o la trae delante; si ya estaba delante, la minimiza.
// Con teclado: ⌘B desde cualquier sitio (o B en el refugio) entra en la barra; ←→ eligen, ↑↓ cambian de fila,
// Intro abre, X cierra (con lo de siempre: si hay algo en marcha, pregunta) y Esc (o ⌘B) sale.
import { useEffect, useRef } from 'react';
import { t } from '@shared/idioma';
import { terminales, onFront, minimizar, askClose as closeTerminal } from './Terminales';
import { intercoms, minimizeIntercom, restoreIntercom, sessionPilot, askClose as closeIntercom } from './Dialogo';
import { juego } from './estadoJuego';
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

interface Elemento { clave: string; abierto: boolean; abrir: () => void; minimizar: () => void; cerrar: () => void }
// las dos filas tal como se ven (las usan el ratón y el teclado)
function filas(): Elemento[][] {
  const talking = juego.get().talkingWith;
  const terms = terminales.get().lista, visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const coms: Elemento[] = intercoms.get().lista.filter(v => interlocutor(v.dwellerId)).map(v => ({
    clave: 'c:' + v.dwellerId, abierto: talking === v.dwellerId,
    abrir: () => { if (talking !== v.dwellerId) restoreIntercom(v.dwellerId); }, minimizar: minimizeIntercom,
    // si pregunta (algo en marcha), la pregunta sale en la ventana: se abre
    cerrar: () => { closeIntercom(v.dwellerId); if (intercoms.get().lista.find(x => x.dwellerId === v.dwellerId)?.confirmar && talking !== v.dwellerId) restoreIntercom(v.dwellerId); },
  }));
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
  // un clic fuera de la barra la suelta
  useEffect(() => { if (!sel) return; const f = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) salir(false); }; addEventListener('pointerdown', f, true); return () => removeEventListener('pointerdown', f, true); }, [!!sel]);
  const fs = filas();
  if (!hasSomething(fs)) return null;
  const visibles = terms.filter(v => !v.minimizada);
  const ahead = visibles.length ? visibles.reduce((a, b) => (b.z > a.z ? b : a)).id : null;
  const marcado = (fila: number, i: number) => !!sel && validRow(fs, sel.fila) === fila && Math.min(sel.i, fs[fila].length - 1) === i;
  const items = coms.map(v => ({ v, h: quien(v.dwellerId) })).filter(x => x.h);
  return (
    <div ref={caja} className={'barra-ventanas interactivo' + (sel ? ' seleccionando' : '')}>
      {sel && <div className="barra-ayuda"><kbd>←→</kbd> {t('menu.select')} <kbd>↑↓</kbd> {t('windows.row')} <kbd>{t('windows.enter')}</kbd> {t('windows.open')} <kbd>X</kbd> {t('menu.close')} <kbd>M</kbd> {t('windows.minimize2')} <kbd>Esc</kbd> {t('windows.exit')}</div>}
      {items.length > 0 && (
        <div className="barra-fila com">
          <span className="barra-tipo" title={t('windows.intercoms')}>COM</span>
          {items.map(({ v, h }, i) => {
            const ses = v.pestanas.map(p => (p.vista.tipo === 'sesion' ? sesiones[p.vista.sesionId] : undefined)).filter(Boolean).sort((a, b) => (URGENCY[a!.estado] ?? 5) - (URGENCY[b!.estado] ?? 5));
            const worst = ses[0], abierto = talking === v.dwellerId;
            return (
              <button key={v.dwellerId} className={'chip-terminal' + (h!.copia ? ' de-copia' : '') + (abierto ? ' delante' : ' minimizada') + (worst?.estado === 'esperando' ? ' urgente' : '') + (marcado(0, i) ? ' marcado' : '')}
                onClick={() => (abierto ? minimizeIntercom() : restoreIntercom(v.dwellerId))}
                title={`${t('windows.intercomWithQuien', { quien: h!.copia ? t('windows.autorSHolographicCopyBranch', { autor: h!.copia.nameAuthor, rama: h!.copia.rama }) : h!.nombre })} (${h!.nameRoom})\n${abierto ? t('windows.clickToMinimize') : t('windows.clickToGoBackTo', { nombre: h!.nombre })}`}>
                <span className={'piloto ' + sessionPilot(worst)} />
                {h!.copia ? <span className="marca-copia">◇ </span> : null}{h!.nombre}{worst ? ` · ${STATE_TEXT[worst.estado] ?? worst.estado}` : ''}{ses.length > 1 ? <small> ({ses.length})</small> : null}
              </button>
            );
          })}
        </div>
      )}
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
