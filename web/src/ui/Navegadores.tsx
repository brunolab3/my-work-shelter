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
import { cliente, vivo } from '../red/cliente';
import { pagesInText, samePage, relativeLinks, linksPages, type PageAnswer } from '@shared/paginasSesion';
import { t } from '@shared/idioma';
import { SFX } from '../audio/sonido';
import { nextZ, windowShortcut, WindowButtons, CMD } from './ventanas';

// dominios: los de la web (y sus subdominios), para abrir dentro sus enlaces; electron/main.cjs tiene sus familias
// desvios: rutas de la web que llevan a otra (p. ej. avisos que no aplican aquí): se va directamente a la de destino
// chrome: agente de usuario de Chrome, sin «Electron/x»: con él, webs como Discord leen la versión de Electron como la
// de Chrome («Chrome 44», de 2015) y tratan la sesión como sospechosa (Discord no manda el SMS del doble factor)
// remoto: la web vive en el Chrome sin ventana de electron/chromeRemoto.cjs (solo Spotify)
// local: una página HTML del Mac que sirve el servidor del refugio (server/paginasLocales.ts), en un <iframe> aislado
export interface Spot { id: string; nombre: string; inicio: string; domains: string[]; detours?: Record<string, string>; chrome?: boolean; remoto?: boolean; local?: boolean }
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
  // los planes, informes y comparaciones en HTML que enlazan los habitantes: dentro, no en la app del Mac para los .html
  pagina: { id: 'pagina', get nombre() { return t('windows.page'); }, inicio: 'about:blank', domains: [], local: true },
};
const isLocal = (id: string) => !!SPOTS[id]?.local;

export const IN_ELECTRON = /\bElectron\//.test(navigator.userAgent);
const AGENT_CHROME = navigator.userAgent.replace(/ (Electron|work-shelter(-public)?)\/\S+/g, '');
const PARTICION = 'persist:navegador';

// sesion: la conversación que enlazó la página (la ventana «Página»), a la que van las notas que se le dejen; ruta: el
// archivo del Mac de una página de /pagina/ (sus notas se guardan por archivo)
interface WindowNav { id: string; url: string; titulo: string; cargando: boolean; minimizada: boolean; maximizada: boolean; z: number; sesion?: string; ruta?: string }

// Notas del Supervisor en las páginas de /pagina/ (las marca server/pagina/notas.js dentro de la página): se guardan
// aquí, por archivo, hasta mandarlas a la conversación
export interface PageNote { id: string; cita: string; seccion?: string; texto: string; inicio?: number | null }
const NOTAS = 'refugio.notasPaginas';
export const pageNotes = new Store<Record<string, PageNote[]>>((() => { try { return JSON.parse(localStorage.getItem(NOTAS) || '{}'); } catch { return {}; } })());
pageNotes.subscribe(() => { try { localStorage.setItem(NOTAS, JSON.stringify(pageNotes.get())); } catch {} });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** Lo que manda la página, saneado: viene de dentro del <iframe> */
export function cleanNotes(v: unknown): PageNote[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((n: any) => {
    const id = str(n?.id, 40), cita = str(n?.cita, 2000), texto = str(n?.texto, 5000);
    return id && cita && texto.trim() ? [{ id, cita, texto, seccion: str(n?.seccion, 300) || undefined, inicio: Number.isInteger(n?.inicio) ? n.inicio : null }] : [];
  });
}
/** El mensaje a la conversación con las notas de una página */
export function notesMessage(ruta: string, notas: PageNote[]) {
  const linea = (n: PageNote, i: number) => n.seccion ? t('windows.noteItemSection', { n: i + 1, cita: n.cita, seccion: n.seccion, texto: n.texto }) : t('windows.noteItem', { n: i + 1, cita: n.cita, texto: n.texto });
  return [t('windows.notesOnThePage', { ruta }), ...notas.map(linea)].join('\n\n');
}
// Lo que el Supervisor ha hecho con cada página de cada conversación (mandarle notas o validarla): el intercomunicador
// lista las páginas de la conversación y marca las que quedan por revisar (shared/paginasSesion.ts)
const RESPUESTAS = 'refugio.respuestasPaginas';
// por dónde iba cada página (ruta → px), para volver ahí al recargarla
const scrollOf = new Map<string, number>();
// (las de más de un mes se olvidan: esas páginas ya no salen en la lista)
export const pageAnswers = new Store<Record<string, Record<string, PageAnswer>>>((() => {
  try {
    const todas = JSON.parse(localStorage.getItem(RESPUESTAS) || '{}') as Record<string, Record<string, PageAnswer>>, limite = Date.now() - 30 * 86_400_000;
    return Object.fromEntries(Object.entries(todas).map(([s, l]) => [s, Object.fromEntries(Object.entries(l ?? {}).filter(([, r]) => r?.ts > limite))]).filter(([, l]) => Object.keys(l).length));
  } catch { return {}; }
})());
pageAnswers.subscribe(() => { try { localStorage.setItem(RESPUESTAS, JSON.stringify(pageAnswers.get())); } catch {} });
// (por la conversación de Claude Code, que sigue siendo la misma al retomarla tras un reinicio; sin ella, por la sesión)
export const answersKey = (sesion: string) => vivo.get().sesiones[sesion]?.claudeId ?? sesion;
export function answerPage(sesion: string, ruta: string, estado: PageAnswer['estado']) {
  sesion = answersKey(sesion);
  pageAnswers.set(x => {
    const y = { ...x }, suyas = Object.fromEntries(Object.entries(y[sesion] ?? {}).filter(([k]) => !samePage(k, ruta)));
    y[sesion] = { ...suyas, [ruta]: { estado, ts: Date.now() } };
    return y;
  });
}
/** Validar una página sin notas: se le dice a la conversación que siga */
export function validatePage(sesion: string, ruta: string) {
  if (vivo.get().sesiones[sesion]) cliente.enviar({ t: 'enviar', sesionId: sesion, texto: t('windows.pageValidated', { ruta }) });
  answerPage(sesion, ruta, 'validada'); SFX.shortSuccess();
}
/** Una página en el Finder, seleccionada (para compartirla desde allí) */
export function revealPage(ruta: string) {
  cliente.accion('enlace.revelar', { ruta }).then(() => SFX.clic()).catch(() => SFX.noAllowed());
}
/** La conversación que enlazó una página la última vez (una página abierta sin saber de qué conversación: sus notas
 *  van a esa) */
export function sessionThatLinked(ruta: string): string | undefined {
  let mejor: { id: string; ts: number } | undefined;
  for (const [id, l] of Object.entries(vivo.get().entradas)) {
    const s = vivo.get().sesiones[id], base = s && (s.worktree ?? s.cwd);
    for (const e of l) if (linksPages(e) && (!mejor || e.ts > mejor.ts) && pagesInText(relativeLinks(e.texto, base)).some(r => samePage(r, ruta))) mejor = { id, ts: e.ts };
  }
  return mejor?.id;
}
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
/** Una página de este Mac en la ventana de páginas del refugio: un archivo HTML (lo sirve el servidor con su llave,
 *  /pagina/…) o una que sirve una herramienta en local (http://127.0.0.1:<puerto>/…, como una página de revisión con
 *  notas). Con `sesion`, la ventana puede avisar a esa conversación de que tiene notas que aplicar. */
export function openPage(url: string, titulo: string, sesion?: string, ruta?: string) {
  // a la izquierda, al lado del intercomunicador (a la derecha): si este estaba ampliado, deja sitio
  dispatchEvent(new CustomEvent('refugio:pagina-al-lado'));
  if (ventana('pagina')) { actualizar('pagina', { url, titulo, sesion, ruta }); onFront('pagina'); return; }
  crear('pagina', url, false, false, titulo);
  actualizar('pagina', { sesion, ruta });
  SFX.abrir();
}
/** Al abrir un intercomunicador sin ampliar: lo ampliado que lo taparía deja sitio. La ventana «Página» vuelve a su
 *  sitio de la izquierda (se ven las dos); un navegador ampliado se minimiza */
export function makeRoomForIntercom() {
  for (const v of navegadores.get().lista) if (v.maximizada && !v.minimizada) {
    if (v.id === 'pagina') actualizar(v.id, { maximizada: false }); else { dropFocus(v.id); actualizar(v.id, { minimizada: true, maximizada: false }); }
  }
}
/** Una página que sirve otro programa de este Mac (no el juego): se ve en la ventana «Página» */
export const isLocalServer = (u: URL) => u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname) && u.origin !== location.origin;
// las del servidor del juego van sin mismo origen (no ven el juego); las de otro puerto ya son otro origen y lo
// necesitan para guardar sus notas en su propio servidor
const sandboxOf = (url: string) => url.startsWith('/pagina/') ? 'allow-scripts allow-popups allow-popups-to-escape-sandbox'
  : 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads';
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
function crear(id: string, url: string, minimizada: boolean, maximizada: boolean, titulo = SPOTS[id]?.nombre ?? id) {
  // un solo navegador a la vista: los demás se minimizan (ocuparían el mismo sitio)
  const z = nextZ();
  navegadores.set(e => ({ lista: [...e.lista.map(x => (minimizada ? x : { ...x, minimizada: true })), { id, url, titulo, cargando: !isLocal(id), minimizada, maximizada, z }] }));
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
  try { sessionStorage.setItem(RECORDADOS, JSON.stringify(navegadores.get().lista.map(({ id, url, titulo, minimizada, maximizada, z, sesion, ruta }) => ({ id, url, titulo, minimizada, maximizada, z, sesion, ruta })))); } catch {}
});
// (la de páginas también fuera de Electron: es un <iframe>; su llave vale mientras siga el mismo servidor)
try {
  const l = JSON.parse(sessionStorage.getItem(RECORDADOS) || '[]'); sessionStorage.removeItem(RECORDADOS);
  for (const r of l.sort((a: any, b: any) => a.z - b.z)) {
    if (!SPOTS[r.id] || typeof r.url !== 'string' || (!IN_ELECTRON && !isLocal(r.id))) continue;
    if (isLocal(r.id)) {
      let u: URL | undefined; try { u = new URL(r.url, location.href); } catch {}
      if (r.url.startsWith('/pagina/') || (u && isLocalServer(u))) { crear(r.id, r.url, !!r.minimizada, false, String(r.titulo ?? '')); actualizar(r.id, { sesion: typeof r.sesion === 'string' ? r.sesion : undefined, ruta: typeof r.ruta === 'string' ? r.ruta : undefined }); }
    }
    else crear(r.id, urlSpot(r.url)?.id === r.id ? r.url : SPOTS[r.id].inicio, !!r.minimizada, false);
  }
} catch {}

// ---------------------------------------------------------------- interfaz
export function Navegadores() {
  const lista = navegadores.usar(e => e.lista);
  return <>{lista.map(v => <VentanaNavegador key={v.id} v={v} />)}</>;
}

function VentanaNavegador({ v }: { v: WindowNav }) {
  const caja = useRef<HTMLDivElement>(null);
  // el <webview> se crea una vez y no se vuelve a montar (moverlo o recrearlo recargaría la web)
  const [vuelta, setVuelta] = React.useState(0);   // recargar la página local (el <iframe> se vuelve a montar)
  const marco = useRef<HTMLIFrameElement>(null);
  const [revisar, setRevisar] = React.useState(false);   // la lista de notas antes de mandarlas
  const notas = pageNotes.usar(e => (v.ruta ? e[v.ruta] : undefined)) ?? [];
  // la capa de notas de la página: pide las guardadas al cargar y avisa de cada cambio (solo las de /pagina/)
  useEffect(() => {
    if (!isLocal(v.id) || !v.ruta) return;
    const ruta = v.ruta;
    const textos = { nota: '✎ ' + t('windows.note'), guardar: t('windows.save'), cancelar: t('windows.cancel'), borrar: t('windows.delete'), placeholder: t('windows.whatShouldChangeHere') };
    const oir = (e: MessageEvent) => {
      if (e.source !== marco.current?.contentWindow || e.data?.refugio !== 'notas') return;
      if (e.data.tipo === 'hola') marco.current?.contentWindow?.postMessage({ refugio: 'notas', tipo: 'restaurar', textos, notas: pageNotes.get()[ruta] ?? [], scroll: scrollOf.get(ruta) ?? 0 }, '*');
      else if (e.data.tipo === 'scroll' && typeof e.data.y === 'number') scrollOf.set(ruta, e.data.y);
      else if (e.data.tipo === 'lista') pageNotes.set(x => { const l = cleanNotes(e.data.notas); const y = { ...x }; if (l.length) y[ruta] = l; else delete y[ruta]; return y; });
    };
    addEventListener('message', oir);
    return () => removeEventListener('message', oir);
  }, [v.id, v.ruta]);
  const cambiada = useRef<{ ruta: string; t: number } | null>(null);   // cuándo cambió el archivo de la que se ve
  // la página se recarga sola cuando cambia su archivo (el habitante rehace el plan o la comparación) y vuelve a donde
  // estaba; mientras está minimizada no se mira
  useEffect(() => {
    if (!isLocal(v.id) || !v.ruta || v.minimizada) return;
    const ruta = v.ruta;
    const mirar = () => cliente.accion<Record<string, number>>('paginas.actualizadas', { rutas: [ruta] }).then(m => {
      const ahora = m?.[ruta], antes = cambiada.current;
      if (ahora && antes?.ruta === ruta && ahora !== antes.t) setVuelta(x => x + 1);
      if (ahora) cambiada.current = { ruta, t: ahora };
    }).catch(() => {});
    mirar();
    const reloj = setInterval(mirar, 2000);
    return () => clearInterval(reloj);
  }, [v.id, v.ruta, v.url, v.minimizada]);
  // la conversación que la enlazó; si se abrió sin saberlo, la última que la enlazó
  const sesion = v.sesion ?? (v.ruta ? sessionThatLinked(v.ruta) : undefined);
  // quitar las notas de la página (ya mandadas, copiadas o descartadas)
  const [descartar, setDiscard] = React.useState(false);
  const clearNotes = () => {
    const ruta = v.ruta; if (!ruta) return;
    pageNotes.set(x => { const y = { ...x }; delete y[ruta]; return y; });
    marco.current?.contentWindow?.postMessage({ refugio: 'notas', tipo: 'limpiar' }, '*');
    setRevisar(false); setDiscard(false);
  };
  const sendPageNotes = () => {
    if (!sesion || !v.ruta || !notas.length) return;
    cliente.enviar({ t: 'enviar', sesionId: sesion, texto: notesMessage(v.ruta, notas) });
    answerPage(sesion, v.ruta, 'notas');
    clearNotes(); SFX.shortSuccess();
  };
  // sin la conversación que la enlazó (de otra sesión del juego): se copian para pegarlas donde se quiera y se quitan
  const copyPageNotes = () => {
    if (!v.ruta || !notas.length) return;
    navigator.clipboard.writeText(notesMessage(v.ruta, notas)).then(() => { clearNotes(); SFX.shortSuccess(); }).catch(() => SFX.noAllowed());
  };
  useEffect(() => {
    if (isRemote(v.id) || isLocal(v.id)) return;
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
    <div className={'ventana-navegador interactivo' + (v.maximizada ? ' maximizada' : '') + (v.minimizada ? ' minimizada' : '') + (v.id === 'pagina' ? ' al-lado' : '')}
      style={{ zIndex: v.maximizada ? 200000 + v.z : v.z }} onPointerDown={() => { if (!v.minimizada) onFront(v.id); }}
      onKeyDownCapture={e => windowShortcut(e, acciones(v))} role="dialog" aria-label={t('windows.browserNombre', { nombre: s?.nombre ?? v.id })}>
      <div className="vt-cabeza vn-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(v.id); }}>
        <span className="rejilla" /><span className={'piloto ' + (v.cargando ? 'trabajando' : 'ociosa')} />
        <span className="vt-titulo">{t('windows.browser')} · {s?.nombre ?? v.id}</span>
        <span className="vt-ruta" title={v.url}>{page}</span>
        <span className="vn-mandos">
          {isLocal(v.id) && v.ruta && notas.length > 0 && <button className="consola-x vn-notas" onClick={() => { setRevisar(x => !x); SFX.clic(); }} title={sesion ? t('windows.reviewAndSendNotes') : t('windows.openThePageFromA')}>✎ {t('windows.notesN', { n: notas.length })}</button>}
          {isLocal(v.id) && v.ruta && sesion && notas.length === 0 && <button className="consola-x vn-notas" onClick={() => validatePage(sesion, v.ruta!)} title={t('windows.validatePageHint')}>✓ {t('windows.validate')}</button>}
          {isLocal(v.id) && !v.ruta && v.sesion && <button className="consola-x vn-notas" onClick={() => sendNotes(v)} title={t('windows.sendNotesHint')}>✎ {t('windows.sendNotes')}</button>}
          <button className="consola-x" onClick={() => { if (isLocal(v.id)) { SFX.noAllowed(); return; } if (isRemote(v.id)) { remoteOrder('navegar', 'atras').catch(() => {}); return; } const w = webviews.get(v.id); if (w?.canGoBack()) w.goBack(); else SFX.noAllowed(); }} title={t('windows.backAtajo', { shortcut: `${CMD}[` })}>◂</button>
          <button className="consola-x" onClick={() => { if (isLocal(v.id)) setVuelta(n => n + 1); else if (isRemote(v.id)) remoteOrder('navegar', 'recargar').catch(() => {}); else webviews.get(v.id)?.reload(); }} title={t('windows.reloadAtajo', { shortcut: `${CMD}R` })}>↻</button>
          {isLocal(v.id) && v.ruta && <button className="consola-x" onClick={() => revealPage(v.ruta!)} title={t('windows.showInFinderHint')}>📁</button>}
          <button className="consola-x" onClick={() => { window.open(isLocal(v.id) ? new URL(v.url, location.href).href : v.url, '_blank'); SFX.clic(); }} title={t('windows.openThisPageInThe')}>↗</button>
        </span>
        <WindowButtons maximizada={v.maximizada} minimizar={() => minimizar(v.id)} toggleMaximize={() => toggleMaximize(v.id)} cerrar={() => cerrar(v.id)} closesThat={isLocal(v.id) ? t('windows.thePage') : t('windows.theBrowserTheSessionIs')} />
      </div>
      <div ref={caja} className="vn-cuerpo">
        {isRemote(v.id) && <RemoteView v={v} />}
        {/* sin allow-same-origin: la página no ve el juego (el servidor además la manda con su propia cabecera sandbox) */}
        {revisar && notas.length > 0 && <div className="vn-lista-notas">
          <ol>{notas.map(n => <li key={n.id}><div className="tenue">«{n.cita.length > 160 ? n.cita.slice(0, 160) + '…' : n.cita}»{n.seccion ? ` · ${n.seccion}` : ''}</div><div>{n.texto}</div></li>)}</ol>
          <div className="botonera">
            <button className="boton-taller" onClick={() => { setRevisar(false); setDiscard(false); }}>{t('windows.cancel')}</button>
            <button className={'boton-taller' + (descartar ? ' urgente' : '')} title={t('windows.discardNotesHint')} onClick={() => { if (descartar) { clearNotes(); SFX.clic(); } else setDiscard(true); }}>{descartar ? t('windows.discardNotesSure') : t('windows.discardNotes')}</button>
            {sesion
              ? <button className="boton-taller" onClick={sendPageNotes}>{t('windows.sendToTheConversation')}</button>
              : <button className="boton-taller" title={t('windows.copyNotesHint')} onClick={copyPageNotes}>📋 {t('windows.copyNotes')}</button>}
          </div>
        </div>}
        {isLocal(v.id) && <iframe ref={marco} key={v.url + vuelta} className="vn-web vn-pagina" src={v.url} title={v.titulo} sandbox={sandboxOf(v.url)} referrerPolicy="no-referrer" />}
      </div>
    </div>
  );
}

// las notas se quedan en la página (las guarda la herramienta que la sirve): aquí solo se le dice a la conversación
// que las aplique, como diría el Supervisor en el intercomunicador
function sendNotes(v: WindowNav) {
  if (!v.sesion) return;
  const url = v.url.startsWith('/') ? new URL(v.url, location.href).href : v.url;
  cliente.enviar({ t: 'enviar', sesionId: v.sesion, texto: t('windows.iLeftNotesOnThe', { url }) });
  SFX.clic();
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
