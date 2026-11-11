// Navegadores del refugio: una web de trabajo (Linear, Outlook, Discord, Slack, GitHub) dentro del juego, sin pestañas ni barra de direcciones, para
// no salir a un navegador lleno de distracciones. Cada sitio tiene su ventana, que se maneja como las demás
// (ventanas.tsx): minimizar a la barra (fila NAV), ampliar a toda la pantalla y cerrar. No se arrastra ni cambia de
// tamaño: normal es un cuadro centrado al 75 % del ancho en 16:9; ampliado, toda la pantalla.
// Por dentro es un <webview> de Electron (electron/main.cjs): sesión propia que se guarda (los logins duran), se queda
// en el dominio de su web y lo de fuera va al navegador del sistema. ⌘R recarga, ⌘[ y ⌘] van atrás y adelante,
// ⌘+ y ⌘- acercan; ⌘M minimiza y ⌘W cierra; Esc y lo demás, a la página. Fuera de Electron, se abre fuera.
// Spotify es distinto (remoto): suena en un Google Chrome sin ventana (electron/chromeRemoto.cjs: su DRM no admite el
// Electron del juego) y aquí se ve su página y se le pasan ratón, rueda y teclado (VistaRemota).
import React, { useEffect, useRef } from 'react';
import { Store } from './almacen';
import { t } from '@shared/idioma';
import { SFX } from '../audio/sonido';
import { nextZ, windowShortcut, WindowButtons, CMD } from './ventanas';

// dominios: los de la web (y sus subdominios), para abrir dentro sus enlaces; electron/main.cjs tiene sus familias
// desvios: rutas de la web que llevan a otra (p. ej. avisos que no aplican aquí): se va directamente a la de destino
// chrome: agente de usuario de Chrome, sin «Electron/x»: con él, webs como Discord leen la versión de Electron como la
// de Chrome («Chrome 44», de 2015) y tratan la sesión como sospechosa (Discord no manda el SMS del doble factor)
// remoto: la web vive en el Chrome sin ventana de electron/chromeRemoto.cjs (solo Spotify)
export interface Spot { id: string; nombre: string; inicio: string; domains: string[]; detours?: Record<string, string>; chrome?: boolean; remoto?: boolean }
// webs que se pueden abrir dentro; cada sala especial que quiera la suya, la pide con su id
export const SPOTS: Record<string, Spot> = {
  // Linear: se entra por /login, no por la portada. Su verificación (Cloudflare Turnstile) solo pasa con «Electron» en el
  // agente de usuario, y la web pública manda a /browser-compatibility («Incompatible Browser») a quien lo lleva; ese
  // aviso no aplica (su propio enlace «continue» va a /login), así que se salta
  linear: { id: 'linear', nombre: 'Linear', inicio: 'https://linear.app/login', domains: ['linear.app'], detours: { '/browser-compatibility': '/login' } },
  // las de Comunicaciones: para abrir un aviso del tablón o entrar a mano y contestar (eso lo hace el Supervisor, no el refugio)
  outlook: { id: 'outlook', nombre: 'Outlook', inicio: 'https://outlook.cloud.microsoft/mail/', domains: ['outlook.cloud.microsoft', 'outlook.office.com', 'outlook.office365.com'] },
  discord: { id: 'discord', nombre: 'Discord', inicio: 'https://discord.com/channels/@me', domains: ['discord.com'], chrome: true },
  slack: { id: 'slack', nombre: 'Slack', inicio: 'https://app.slack.com/client', domains: ['slack.com'], chrome: true },
  github: { id: 'github', nombre: 'GitHub', inicio: 'https://github.com/notifications', domains: ['github.com'] },
  // Gmail no: Google rechaza el inicio de sesión en cualquier Chromium empotrado; sus avisos se abren en el navegador del sistema
  // Spotify, la música de la discoteca: suena en Google Chrome (su DRM solo da licencias a navegadores certificados) y
  // aquí se ve y se maneja; minimizado, la pletina (Discoteca.tsx) lo controla
  spotify: { id: 'spotify', nombre: 'Spotify', inicio: 'https://open.spotify.com/', domains: ['spotify.com'], remoto: true },
};

export const IN_ELECTRON = /\bElectron\//.test(navigator.userAgent);
const AGENT_CHROME = navigator.userAgent.replace(/ (Electron|work-shelter(-public)?)\/\S+/g, '');
const PARTICION = 'persist:navegador';

interface WindowNav { id: string; url: string; titulo: string; cargando: boolean; minimizada: boolean; maximizada: boolean; z: number }
export const navegadores = new Store<{ lista: WindowNav[] }>({ lista: [] });

// lo que el <webview> sabe hacer y usamos aquí
export interface Webview extends HTMLElement { getWebContentsId(): number; loadURL(u: string): Promise<void>; getURL(): string; canGoBack(): boolean; goBack(): void; reload(): void; executeJavaScript(codigo: string, gesture?: boolean): Promise<unknown> }
const webviews = new Map<string, Webview>();

// el puente con el Chrome de Spotify (electron/precarga.cjs)
interface RemoteBridge { orden<T = unknown>(orden: string, ...a: unknown[]): Promise<T>; onFrame(f: (jpeg: Uint8Array, ancho: number, alto: number) => void): void; onState(f: (e: { url: string; titulo: string; cargando: boolean; vivo: boolean }) => void): void }
const remoto: RemoteBridge | undefined = (window as any).shelterRemoto;
const isRemote = (id: string) => !!SPOTS[id]?.remoto;
const remoteOrder = <T = unknown>(orden: string, ...a: unknown[]) => (remoto ? remoto.orden<T>(orden, ...a) : Promise.reject(new Error('sin Chrome')));
const remoteFields = new Map<string, HTMLTextAreaElement>();
/** Código en la página de un navegador abierto (la pletina de la discoteca pregunta así a Spotify) */
export async function evaluateIn(id: string, codigo: string, gesture = false): Promise<unknown> {
  if (!ventana(id)) return null;
  if (isRemote(id)) return remoteOrder('evaluar', codigo).catch(() => null);
  const w = webviews.get(id); if (!w) return null;
  return w.executeJavaScript(codigo, gesture).catch(() => null);
}

const ventana = (id: string) => navegadores.get().lista.find(v => v.id === id);
function actualizar(id: string, p: Partial<WindowNav> | ((v: WindowNav) => Partial<WindowNav>)) {
  navegadores.set(e => ({ lista: e.lista.map(v => (v.id === id ? { ...v, ...(typeof p === 'function' ? p(v) : p) } : v)) }));
}
const dropFocus = (id: string) => { webviews.get(id)?.blur(); remoteFields.get(id)?.blur(); (document.activeElement as HTMLElement | null)?.blur?.(); };
const enfocar = (id: string) => setTimeout(() => { const v = ventana(id); if (v && !v.minimizada) (webviews.get(id) ?? remoteFields.get(id))?.focus(); }, 30);
// el título de la página sin el nombre de la web, que ya se ve en la ventana («Linear – …», «… · Linear»)
export function pageTitle(v: { id: string; titulo: string }) {
  const n = SPOTS[v.id]?.nombre ?? v.id;
  const t = v.titulo.replace(new RegExp(`^${n}\\s*[–—|·:-]\\s*|\\s*[–—|·:-]\\s*${n}$`, 'i'), '').trim();
  return t === n ? '' : t;
}
export const urlSpot = (url: string) => { try { const h = new URL(url).hostname; return Object.values(SPOTS).find(s => s.domains.some(d => h === d || h.endsWith('.' + d))); } catch { return undefined; } };

/** Abre (o trae delante) el navegador de un sitio; con url, además lo lleva a esa página. */
export function openBrowser(spotId: string, url?: string) {
  const s = SPOTS[spotId]; if (!s) { SFX.noAllowed(); return; }
  if (!IN_ELECTRON) { window.open(url ?? s.inicio, '_blank'); SFX.clic(); return; }
  if (ventana(s.id)) { if (url) { if (s.remoto) remoteOrder('navegar', url).catch(() => {}); else webviews.get(s.id)?.loadURL(url).catch(() => {}); } onFront(s.id); return; }
  crear(s.id, url ?? s.inicio, false, false);
  SFX.abrir(); enfocar(s.id);
}
/** La página de pull requests de GitHub (los tuyos, los que te piden revisar y las menciones), en su navegador */
export const openPRsGitHub = () => openBrowser('github', 'https://github.com/pulls');
/** Un aviso del tablón o del calendario: su enlace, dentro si su web tiene navegador; si es de DEMO (enlaces de
 *  ejemplo, como linear.app a secas, que no son tu web), el navegador de su fuente en la página de inicio. */
export function openNotice(a: { fuente: string; enlace?: string; demo?: boolean }) {
  if (a.demo && SPOTS[a.fuente]) openBrowser(a.fuente); else openLink(a.enlace);
}
/** Un enlace de una web que tiene navegador propio se abre dentro; el resto, fuera. */
export function openLink(url?: string) {
  if (!url) { SFX.noAllowed(); return; }
  const s = urlSpot(url);
  if (s) openBrowser(s.id, url); else { window.open(url, '_blank'); SFX.clic(); }
}
function crear(id: string, url: string, minimizada: boolean, maximizada: boolean) {
  // un solo navegador a la vista: los demás se minimizan (ocuparían el mismo sitio)
  const z = nextZ();
  navegadores.set(e => ({ lista: [...e.lista.map(x => (minimizada ? x : { ...x, minimizada: true })), { id, url, titulo: SPOTS[id]?.nombre ?? id, cargando: true, minimizada, maximizada, z }] }));
}
export function onFront(id: string) {
  const v = ventana(id); if (!v) return;
  if (v.minimizada) SFX.abrir();
  const z = nextZ();
  navegadores.set(e => ({ lista: e.lista.map(x => (x.id === id ? { ...x, z, minimizada: false } : x.minimizada ? x : { ...x, minimizada: true })) }));
  enfocar(id);
}
export function minimizar(id: string) {
  const v = ventana(id); if (!v || v.minimizada) return;
  dropFocus(id); actualizar(id, { minimizada: true }); SFX.cerrar();
}
// cerrar no pierde nada que no esté ya en la web (la sesión se queda): sin preguntar
export function cerrar(id: string) {
  if (!ventana(id)) return;
  dropFocus(id); webviews.delete(id);
  if (isRemote(id)) remoteOrder('cerrar').catch(() => {});   // y su Chrome (y la música)
  navegadores.set(e => ({ lista: e.lista.filter(x => x.id !== id) })); SFX.cerrar();
}
function toggleMaximize(id: string) { actualizar(id, v => ({ maximizada: !v.maximizada })); SFX.clic(); enfocar(id); }

const acciones = (v: WindowNav) => ({
  maximizada: v.maximizada, closeTab: () => cerrar(v.id), closeWindow: () => cerrar(v.id), minimizar: () => minimizar(v.id),
  toggleMaximize: () => toggleMaximize(v.id), goTab: () => {}, moveTab: () => {},
});
// con el foco dentro de la web, las teclas no pasan por la página del juego: Electron manda aquí las de ventana
(window as any).__browserShortcut = (wcId: number, k: { code: string; key: string; shiftKey: boolean }) => {
  const id = [...webviews].find(([, w]) => { try { return w.getWebContentsId() === wcId; } catch { return false; } })?.[0];
  const v = id ? ventana(id) : undefined; if (!v) return;
  const e = new KeyboardEvent('keydown', { code: k.code, key: k.key, shiftKey: k.shiftKey, metaKey: true, bubbles: true, cancelable: true });
  // ⌘B (la barra) escucha en la ventana; el resto son de esta ventana del navegador
  if (k.code === 'KeyB') dispatchEvent(e); else windowShortcut(e, acciones(v));
};

// tras una recarga (aplicar cambios del juego, reiniciar), los navegadores vuelven como estaban y en su página
const RECORDADOS = 'refugio.navegadores';
addEventListener('pagehide', () => {
  try { sessionStorage.setItem(RECORDADOS, JSON.stringify(navegadores.get().lista.map(({ id, url, minimizada, maximizada, z }) => ({ id, url, minimizada, maximizada, z })))); } catch {}
});
if (IN_ELECTRON) {
  try {
    const l = JSON.parse(sessionStorage.getItem(RECORDADOS) || '[]'); sessionStorage.removeItem(RECORDADOS);
    for (const r of l.sort((a: any, b: any) => a.z - b.z)) if (SPOTS[r.id] && typeof r.url === 'string') crear(r.id, urlSpot(r.url)?.id === r.id ? r.url : SPOTS[r.id].inicio, !!r.minimizada, !!r.maximizada);
  } catch {}
}

// ---------------------------------------------------------------- interfaz
export function Navegadores() {
  const lista = navegadores.usar(e => e.lista);
  return <>{lista.map(v => <VentanaNavegador key={v.id} v={v} />)}</>;
}

function VentanaNavegador({ v }: { v: WindowNav }) {
  const caja = useRef<HTMLDivElement>(null);
  // el <webview> se crea una vez y no se vuelve a montar (moverlo o recrearlo recargaría la web)
  useEffect(() => {
    if (isRemote(v.id)) return;
    const w = document.createElement('webview') as Webview;
    w.setAttribute('partition', PARTICION);
    if (SPOTS[v.id]?.chrome) w.setAttribute('useragent', AGENT_CHROME);
    w.setAttribute('allowpopups', '');
    w.setAttribute('src', v.url);
    w.className = 'vn-web';
    const id = v.id;
    const detours = SPOTS[id]?.detours ?? {};
    const note = () => {
      let u: URL; try { u = new URL(w.getURL()); } catch { return; }
      const destino = detours[u.pathname.replace(/\/+$/, '') || '/'];
      if (destino) { w.loadURL(new URL(destino, u.origin).href).catch(() => {}); return; }
      actualizar(id, { url: u.href });
    };
    w.addEventListener('did-start-loading', () => actualizar(id, { cargando: true }));
    w.addEventListener('did-stop-loading', () => { actualizar(id, { cargando: false }); note(); });
    w.addEventListener('did-navigate', note);
    w.addEventListener('did-navigate-in-page', note);
    w.addEventListener('page-title-updated', (e: any) => actualizar(id, { titulo: e.title }));
    // un clic dentro de la web no llega al juego, pero el foco sí: la trae delante
    w.addEventListener('focus', () => { const x = ventana(id); if (x && !x.minimizada && navegadores.get().lista.some(o => o.z > x.z)) onFront(id); });
    caja.current!.appendChild(w);
    webviews.set(id, w);
    return () => { w.remove(); if (webviews.get(id) === w) webviews.delete(id); };
  }, []);
  const s = SPOTS[v.id];
  const page = pageTitle(v);
  return (
    <div className={'ventana-navegador interactivo' + (v.maximizada ? ' maximizada' : '') + (v.minimizada ? ' minimizada' : '')}
      style={{ zIndex: v.maximizada ? 200000 + v.z : v.z }} onPointerDown={() => { if (!v.minimizada) onFront(v.id); }}
      onKeyDownCapture={e => windowShortcut(e, acciones(v))} role="dialog" aria-label={t('windows.browserNombre', { nombre: s?.nombre ?? v.id })}>
      <div className="vt-cabeza vn-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(v.id); }}>
        <span className="rejilla" /><span className={'piloto ' + (v.cargando ? 'trabajando' : 'ociosa')} />
        <span className="vt-titulo">{t('windows.browser')} · {s?.nombre ?? v.id}</span>
        <span className="vt-ruta" title={v.url}>{page}</span>
        <span className="vn-mandos">
          <button className="consola-x" onClick={() => { if (isRemote(v.id)) { remoteOrder('navegar', 'atras').catch(() => {}); return; } const w = webviews.get(v.id); if (w?.canGoBack()) w.goBack(); else SFX.noAllowed(); }} title={t('windows.backAtajo', { shortcut: `${CMD}[` })}>◂</button>
          <button className="consola-x" onClick={() => { if (isRemote(v.id)) remoteOrder('navegar', 'recargar').catch(() => {}); else webviews.get(v.id)?.reload(); }} title={t('windows.reloadAtajo', { shortcut: `${CMD}R` })}>↻</button>
          <button className="consola-x" onClick={() => { window.open(v.url, '_blank'); SFX.clic(); }} title={t('windows.openThisPageInThe')}>↗</button>
        </span>
        <WindowButtons maximizada={v.maximizada} minimizar={() => minimizar(v.id)} toggleMaximize={() => toggleMaximize(v.id)} cerrar={() => cerrar(v.id)} closesThat={t('windows.theBrowserTheSessionIs')} />
      </div>
      <div ref={caja} className="vn-cuerpo">{isRemote(v.id) && <RemoteView v={v} />}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Spotify, en su Chrome sin ventana
// La imagen llega por el screencast del protocolo de depuración (JPEG, al ritmo de lo que cambia); ratón, rueda y
// teclado van de vuelta. Las teclas se recogen en un campo invisible (así funcionan los acentos y la ñ con las teclas
// muertas de macOS); ⌘M, ⌘W, ⌘B y el resto de atajos de ventana del refugio siguen siendo del juego.
let remoteCanvas: HTMLCanvasElement | null = null, painting = false, pending: Uint8Array | null = null;
async function paint(jpeg: Uint8Array) {
  if (painting) { pending = jpeg; return; }   // se pinta el último que llegue, sin cola
  painting = true;
  try {
    const c = remoteCanvas; if (!c) return;
    const img = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; }
    c.getContext('2d')!.drawImage(img, 0, 0); img.close();
  } catch {} finally {
    painting = false;
    if (pending) { const p = pending; pending = null; void paint(p); }
  }
}
if (remoto) {
  remoto.onFrame(jpeg => void paint(jpeg));
  remoto.onState(e => {
    if (remoteCanvas && (e as { cursor?: string }).cursor) remoteCanvas.style.cursor = (e as { cursor?: string }).cursor!;
    if (!ventana('spotify')) return;
    actualizar('spotify', { cargando: e.cargando, ...(e.url ? { url: e.url } : {}), ...(e.titulo ? { titulo: e.titulo } : {}) });
  });
}
const MOUSE_BUTTON = ['left', 'middle', 'right'];
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ({ alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });

function RemoteView({ v }: { v: WindowNav }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = React.useState('');
  useEffect(() => {
    const c = lienzo.current!, t = campo.current!;
    remoteCanvas = c; remoteFields.set(v.id, t);
    const measure = () => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? remoteOrder('tamano', r.width, r.height, devicePixelRatio).catch(() => {}) : Promise.resolve(); };
    // el tamaño (y la densidad de la pantalla) antes de abrir: Chrome arranca con ella
    measure().then(() => remoteOrder('abrir')).then(() => setError('')).catch(e => setError(String((e as Error).message || e).replace(/^Error invoking remote method 'remoto': (Error: )?/, '')));
    const ro = new ResizeObserver(() => void measure()); ro.observe(c);
    const pos = (e: MouseEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const raton = (type: string) => (e: MouseEvent) => {
      if (type === 'mousePressed') { e.preventDefault(); t.focus(); }
      remoteOrder('entrada', { tipo: 'raton', type, ...pos(e), button: type === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : MOUSE_BUTTON[e.button] ?? 'none', buttons: e.buttons, clickCount: type === 'mouseMoved' ? 0 : e.detail || 1, ...mods(e) }).catch(() => {});
    };
    const mover = raton('mouseMoved'), bajar = raton('mousePressed'), subir = raton('mouseReleased');
    const rueda = (e: WheelEvent) => { e.preventDefault(); const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1; remoteOrder('entrada', { tipo: 'rueda', ...pos(e), deltaX: e.deltaX * k, deltaY: e.deltaY * k, ...mods(e) }).catch(() => {}); };
    const menu = (e: MouseEvent) => e.preventDefault();
    c.addEventListener('mousemove', mover); c.addEventListener('mousedown', bajar); addEventListener('mouseup', subir);
    c.addEventListener('wheel', rueda, { passive: false }); c.addEventListener('contextmenu', menu);
    return () => {
      ro.disconnect(); c.removeEventListener('mousemove', mover); c.removeEventListener('mousedown', bajar); removeEventListener('mouseup', subir);
      c.removeEventListener('wheel', rueda); c.removeEventListener('contextmenu', menu);
      if (remoteCanvas === c) remoteCanvas = null; if (remoteFields.get(v.id) === t) remoteFields.delete(v.id);
    };
  }, []);
  // solo se pide imagen con la ventana a la vista (minimizada, la música sigue)
  useEffect(() => { remoteOrder('visible', !v.minimizada).catch(() => {}); }, [v.minimizada]);
  const tecla = (type: 'keyDown' | 'keyUp') => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const n = e.nativeEvent;
    if (n.isComposing || e.key === 'Dead' || e.key === 'Process') return;   // acentos: llegan enteros al terminar
    if (e.metaKey && (e.code === 'KeyB' || e.code === 'KeyJ')) return;        // la barra y la música del refugio
    e.preventDefault(); e.stopPropagation();
    if (type === 'keyDown' && e.metaKey && e.code === 'KeyV' && !e.shiftKey) {
      navigator.clipboard.readText().then(texto => { if (texto) remoteOrder('entrada', { tipo: 'texto', texto }).catch(() => {}); }).catch(() => {});
      return;
    }
    const texto = e.key.length === 1 ? e.key : e.key === 'Enter' ? '\r' : undefined;
    remoteOrder('entrada', { tipo: 'tecla', type, key: e.key, code: e.code, keyCode: e.keyCode, texto, ...mods(e) }).catch(() => {});
  };
  return (
    <div className="vn-remota">
      <canvas ref={lienzo} className="vn-lienzo" />
      <textarea ref={campo} className="vn-teclas" aria-label={t('windows.nombreKeyboard', { nombre: SPOTS[v.id]?.nombre ?? v.id })} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onKeyDown={tecla('keyDown')} onKeyUp={tecla('keyUp')}
        onCompositionEnd={e => { if (e.data) remoteOrder('entrada', { tipo: 'texto', texto: e.data }).catch(() => {}); e.currentTarget.value = ''; }}
        onInput={e => {
          // texto que no llega por una pulsación (dictado, métodos de entrada…): tal cual
          const n = e.nativeEvent as InputEvent; if (n.isComposing) return;
          if (n.data && n.inputType === 'insertText') remoteOrder('entrada', { tipo: 'texto', texto: n.data }).catch(() => {});
          e.currentTarget.value = '';
        }}
        onFocus={() => { const x = ventana(v.id); if (x && !x.minimizada && navegadores.get().lista.some(o => o.z > x.z)) onFront(v.id); }} />
      {error && <div className="vn-aviso">{error}</div>}
    </div>
  );
}
