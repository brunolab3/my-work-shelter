// Navegadores del refugio: una web de trabajo (Linear, Outlook, Discord, Slack, GitHub) dentro del juego, sin pestañas ni barra de direcciones, para
// no salir a un navegador lleno de distracciones. Cada sitio tiene su ventana, que se maneja como las demás
// (windows.tsx): minimizar a la barra (fila NAV), ampliar a toda la pantalla y cerrar. No se arrastra ni cambia de
// tamaño: normal es un cuadro centrado al 75 % del ancho en 16:9; ampliado, toda la pantalla.
// Por dentro es un <webview> de Electron (electron/main.cjs): sesión propia que se guarda (los logins duran), se queda
// en el dominio de su web y lo de fuera va al navegador del sistema. ⌘R recarga, ⌘[ y ⌘] van atrás y adelante,
// ⌘+ y ⌘- acercan; ⌘M minimiza y ⌘W cierra; Esc y lo demás, a la página. Fuera de Electron, se abre fuera.
// Spotify es distinto (remoto): suena en un Google Chrome sin ventana (electron/remoteChrome.cjs: su DRM no admite el
// Electron del juego) y aquí se ve su página y se le pasan ratón, rueda y teclado (VistaRemota).
import React, { useEffect, useRef } from 'react';
import { Store } from './store';
import { client, live } from '../net/client';
import { pagesInText, samePage, relativeLinks, linksPages, IMAGE_FILE, type PageAnswer } from '@shared/sessionPages';
import { t } from '@shared/language';
import { SFX } from '../audio/sound';
import { nextZ, windowShortcut, WindowButtons, CMD } from './windows';
import { followLink } from './linkOptions';
import { pageLinkTarget } from '@shared/linkOptions';

// dominios: los de la web (y sus subdominios), para abrir dentro sus enlaces; electron/main.cjs tiene sus familias
// desvios: rutas de la web que llevan a otra (p. ej. avisos que no aplican aquí): se va directamente a la de destino
// chrome: agente de usuario de Chrome, sin «Electron/x»: con él, webs como Discord leen la versión de Electron como la
// de Chrome («Chrome 44», de 2015) y tratan la sesión como sospechosa (Discord no manda el SMS del doble factor)
// remoto: la web vive en el Chrome sin ventana de electron/remoteChrome.cjs (solo Spotify)
// local: una página HTML del Mac que sirve el servidor del refugio (server/localPages.ts), en un <iframe> aislado
// suelta: any https web a reply links («Web»), in a session of its own (electron/main.cjs), on whatever domain it opened
export interface Spot { id: string; name: string; start: string; domains: string[]; detours?: Record<string, string>; chrome?: boolean; remote?: boolean; local?: boolean; loose?: boolean }
// webs que se pueden abrir dentro; cada sala especial que quiera la suya, la pide con su id
export const SPOTS: Record<string, Spot> = {
  // Linear: se entra por /login, no por la portada. Su verificación (Cloudflare Turnstile) solo pasa con «Electron» en el
  // agente de usuario, y la web pública manda a /browser-compatibility («Incompatible Browser») a quien lo lleva; ese
  // aviso no aplica (su propio enlace «continue» va a /login), así que se salta
  linear: { id: 'linear', name: 'Linear', start: 'https://linear.app/login', domains: ['linear.app'], detours: { '/browser-compatibility': '/login' } },
  // las de Comunicaciones: para abrir un aviso del tablón o entrar a mano y contestar (eso lo hace el Supervisor, no el refugio)
  outlook: { id: 'outlook', name: 'Outlook', start: 'https://outlook.cloud.microsoft/mail/', domains: ['outlook.cloud.microsoft', 'outlook.office.com', 'outlook.office365.com'] },
  discord: { id: 'discord', name: 'Discord', start: 'https://discord.com/channels/@me', domains: ['discord.com'], chrome: true },
  slack: { id: 'slack', name: 'Slack', start: 'https://app.slack.com/client', domains: ['slack.com'], chrome: true },
  github: { id: 'github', name: 'GitHub', start: 'https://github.com/notifications', domains: ['github.com'] },
  // Gmail no: Google rechaza el inicio de sesión en cualquier Chromium empotrado; sus avisos se abren en el navegador del sistema
  // Spotify, la música de la discoteca: suena en Google Chrome (su DRM solo da licencias a navegadores certificados) y
  // aquí se ve y se maneja; minimizado, la pletina (Disco.tsx) lo controla
  spotify: { id: 'spotify', name: 'Spotify', start: 'https://open.spotify.com/', domains: ['spotify.com'], remote: true },
  // los planes, informes y comparaciones en HTML que enlazan los habitantes: dentro, no en la app del Mac para los .html
  page: { id: 'page', get name() { return t('windows.page'); }, start: 'about:blank', domains: [], local: true },
  // any other web a reply links, opened inside from its options (linkOptions.ts)
  web: { id: 'web', get name() { return t('windows.web'); }, start: 'about:blank', domains: [], loose: true },
};
const isLocal = (id: string) => !!SPOTS[id]?.local;

export const IN_ELECTRON = /\bElectron\//.test(navigator.userAgent);
const AGENT_CHROME = navigator.userAgent.replace(/ (Electron|work-shelter(-public)?)\/\S+/g, '');
const PARTITION = 'persist:navegador', PARTITION_WEB = 'persist:web';

// sesion: la conversación que enlazó la página (la ventana «Página»), a la que van las notas que se le dejen; ruta: el
// archivo del Mac de una página de /pagina/ (sus notas se guardan por archivo)
// generacion: the «Web» window's <webview> is made again for another domain (each one stays on the domain it opened with)
interface WindowNav { id: string; url: string; title: string; loading: boolean; minimized: boolean; maximized: boolean; z: number; session?: string; path?: string; generation?: number }

// Notas del Supervisor en las páginas de /pagina/ (las marca server/page/notes.js dentro de la página): se guardan
// aquí, por archivo, hasta mandarlas a la conversación
export interface PageNote { id: string; quote: string; section?: string; text: string; start?: number | null }
const NOTES = 'shelter.pageNotes';
export const pageNotes = new Store<Record<string, PageNote[]>>((() => { try { return JSON.parse(localStorage.getItem(NOTES) || '{}'); } catch { return {}; } })());
pageNotes.subscribe(() => { try { localStorage.setItem(NOTES, JSON.stringify(pageNotes.get())); } catch {} });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
/** Lo que manda la página, saneado: viene de dentro del <iframe> */
export function cleanNotes(v: unknown): PageNote[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((n: any) => {
    const id = str(n?.id, 40), quote = str(n?.quote, 2000), text = str(n?.text, 5000);
    return id && quote && text.trim() ? [{ id, quote, text, section: str(n?.section, 300) || undefined, start: Number.isInteger(n?.start) ? n.start : null }] : [];
  });
}
/** El mensaje a la conversación con las notas de una página */
export function notesMessage(path: string, notes: PageNote[]) {
  const line = (n: PageNote, i: number) => n.section ? t('windows.noteItemSection', { n: i + 1, meeting: n.quote, section: n.section, text: n.text }) : t('windows.noteItem', { n: i + 1, meeting: n.quote, text: n.text });
  return [t('windows.notesOnThePage', { path: path }), ...notes.map(line)].join('\n\n');
}
// Lo que el Supervisor ha hecho con cada página de cada conversación (mandarle notas o validarla): el intercomunicador
// lista las páginas de la conversación y marca las que quedan por revisar (shared/sessionPages.ts)
const ANSWERS = 'shelter.pageAnswers';
// por dónde iba cada página (ruta → px), para volver ahí al recargarla
const scrollOf = new Map<string, number>();
// (las de más de un mes se olvidan: esas páginas ya no salen en la lista)
export const pageAnswers = new Store<Record<string, Record<string, PageAnswer>>>((() => {
  try {
    const all = JSON.parse(localStorage.getItem(ANSWERS) || '{}') as Record<string, Record<string, PageAnswer>>, limit = Date.now() - 30 * 86_400_000;
    return Object.fromEntries(Object.entries(all).map(([s, l]) => [s, Object.fromEntries(Object.entries(l ?? {}).filter(([, r]) => r?.ts > limit))]).filter(([, l]) => Object.keys(l).length));
  } catch { return {}; }
})());
pageAnswers.subscribe(() => { try { localStorage.setItem(ANSWERS, JSON.stringify(pageAnswers.get())); } catch {} });
// (por la conversación de Claude Code, que sigue siendo la misma al retomarla tras un reinicio; sin ella, por la sesión)
export const answersKey = (session: string) => live.get().sessions[session]?.claudeId ?? session;
export function answerPage(session: string, path: string, state: PageAnswer['state']) {
  // el servidor ata la de las comparaciones a su commit (pre-flight, server/preflight.ts); las demás páginas las ignora
  if (state !== 'quitada') client.action('pages.answer', { path, state }).catch(() => {});
  session = answersKey(session);
  pageAnswers.set(x => {
    const y = { ...x }, theirs = Object.fromEntries(Object.entries(y[session] ?? {}).filter(([k]) => !samePage(k, path)));
    y[session] = { ...theirs, [path]: { state, ts: Date.now() } };
    return y;
  });
}
/** Validar una página sin notas: se le dice a la conversación que siga */
export function validatePage(session: string, path: string) {
  if (live.get().sessions[session]) client.send({ t: 'send', sessionId: session, text: t('windows.pageValidated', { path: path }) });
  answerPage(session, path, 'validated'); SFX.shortSuccess();
}
/** Una página en el Finder, seleccionada (para compartirla desde allí) */
export function revealPage(path: string) {
  client.action('link.reveal', { path }).then(() => SFX.click()).catch(() => SFX.notAllowed());
}
/** La conversación que enlazó una página la última vez (una página abierta sin saber de qué conversación: sus notas
 *  van a esa) */
export function sessionThatLinked(path: string): string | undefined {
  let best: { id: string; ts: number } | undefined;
  for (const [id, l] of Object.entries(live.get().entries)) {
    const s = live.get().sessions[id], base = s && (s.worktree ?? s.cwd);
    for (const e of l) if (linksPages(e) && (!best || e.ts > best.ts) && pagesInText(relativeLinks(e.text, base)).some(r => samePage(r, path))) best = { id, ts: e.ts };
  }
  return best?.id;
}
export const browsers = new Store<{ list: WindowNav[] }>({ list: [] });

// lo que el <webview> sabe hacer y usamos aquí
export interface Webview extends HTMLElement { getWebContentsId(): number; loadURL(u: string): Promise<void>; getURL(): string; canGoBack(): boolean; goBack(): void; reload(): void; executeJavaScript(code: string, gesture?: boolean): Promise<unknown> }
const webviews = new Map<string, Webview>();

// el puente con el Chrome de Spotify (electron/preload.cjs)
interface RemoteBridge { orden<T = unknown>(orden: string, ...a: unknown[]): Promise<T>; onFrame(f: (jpeg: Uint8Array, width: number, height: number) => void): void; onState(f: (e: { url: string; title: string; loading: boolean; live: boolean }) => void): void }
const remote: RemoteBridge | undefined = (window as any).shelterRemoto;
const isRemote = (id: string) => !!SPOTS[id]?.remote;
const remoteOrder = <T = unknown>(orden: string, ...a: unknown[]) => (remote ? remote.orden<T>(orden, ...a) : Promise.reject(new Error(t('windows.noChrome'))));
const remoteFields = new Map<string, HTMLTextAreaElement>();
/** Código en la página de un navegador abierto (la pletina de la discoteca pregunta así a Spotify) */
export async function evaluateIn(id: string, code: string, gesture = false): Promise<unknown> {
  if (!win(id)) return null;
  if (isRemote(id)) return remoteOrder('evaluar', code).catch(() => null);
  const w = webviews.get(id); if (!w) return null;
  return w.executeJavaScript(code, gesture).catch(() => null);
}

const win = (id: string) => browsers.get().list.find(v => v.id === id);
function update(id: string, p: Partial<WindowNav> | ((v: WindowNav) => Partial<WindowNav>)) {
  browsers.set(e => ({ list: e.list.map(v => (v.id === id ? { ...v, ...(typeof p === 'function' ? p(v) : p) } : v)) }));
}
const dropFocus = (id: string) => { webviews.get(id)?.blur(); remoteFields.get(id)?.blur(); (document.activeElement as HTMLElement | null)?.blur?.(); };
const focus = (id: string) => setTimeout(() => { const v = win(id); if (v && !v.minimized) (webviews.get(id) ?? remoteFields.get(id))?.focus(); }, 30);
// el título de la página sin el nombre de la web, que ya se ve en la ventana («Linear – …», «… · Linear»)
export function pageTitle(v: { id: string; title: string }) {
  const n = SPOTS[v.id]?.name ?? v.id;
  const t = v.title.replace(new RegExp(`^${n}\\s*[–—|·:-]\\s*|\\s*[–—|·:-]\\s*${n}$`, 'i'), '').trim();
  return t === n ? '' : t;
}
export const urlSpot = (url: string) => { try { const h = new URL(url).hostname; return Object.values(SPOTS).find(s => s.domains.some(d => h === d || h.endsWith('.' + d))); } catch { return undefined; } };

/** Abre (o trae delante) el navegador de un sitio; con url, además lo lleva a esa página. */
export function openBrowser(spotId: string, url?: string) {
  const s = SPOTS[spotId]; if (!s) { SFX.notAllowed(); return; }
  if (!IN_ELECTRON) { window.open(url ?? s.start, '_blank'); SFX.click(); return; }
  if (win(s.id)) { if (url) { if (s.remote) remoteOrder('navegar', url).catch(() => {}); else webviews.get(s.id)?.loadURL(url).catch(() => {}); } onFront(s.id); return; }
  create(s.id, url ?? s.start, false, false);
  SFX.open(); focus(s.id);
}
/** Una página de este Mac en la ventana de páginas del refugio: un archivo HTML (lo sirve el servidor con su llave,
 *  /pagina/…) o una que sirve una herramienta en local (http://127.0.0.1:<puerto>/…, como una página de revisión con
 *  notas). Con `sesion`, la ventana puede avisar a esa conversación de que tiene notas que aplicar. */
export function openPage(url: string, title: string, session?: string, path?: string) {
  if (session) lastPage.set(session, { url, title, path });
  // a la izquierda, al lado del intercomunicador (a la derecha): si este estaba ampliado, deja sitio
  dispatchEvent(new CustomEvent('shelter:page-beside'));
  const already = win('page');
  if (already) {
    // la misma página: solo al frente (sin recargarla); otra, en su sitio
    if (already.url === url) update('page', { title, session: session ?? already.session, path: path ?? already.path, minimized: false }); else update('page', { url, title, session, path, minimized: false });
    onFront('page'); return;
  }
  create('page', url, false, false, title);
  update('page', { session, path });
  SFX.open();
}
// la última página que abrió cada conversación: al volver a su pestaña, vuelve la suya
const lastPage = new Map<string, { url: string; title: string; path?: string }>();
/** Cambia la conversación a la vista (otra pestaña u otro intercomunicador): la ventana «Página» solo enseña páginas de
 *  esa conversación. Si tenía una abierta, vuelve esa; si la de la ventana es de otra, se minimiza (no se pierde: está
 *  en la barra y en «📄 Páginas»). Una página abierta sin conversación se queda como está. */
export function pageForSession(session?: string) {
  const v = win('page'); if (!v || v.minimized || !v.session || v.session === session) return;
  const theirs = session ? lastPage.get(session) : undefined;
  if (theirs && theirs.url !== v.url) update('page', { ...theirs, session });
  else { dropFocus('page'); update('page', { minimized: true }); }
}
/** Al abrir un intercomunicador sin ampliar: lo ampliado que lo taparía deja sitio. La ventana «Página» vuelve a su
 *  sitio de la izquierda (se ven las dos); un navegador ampliado se minimiza */
export function makeRoomForIntercom() {
  for (const v of browsers.get().list) if (v.maximized && !v.minimized) {
    if (v.id === 'page') update(v.id, { maximized: false }); else { dropFocus(v.id); update(v.id, { minimized: true, maximized: false }); }
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
export function openNotice(a: { source: string; link?: string; demo?: boolean }) {
  if (a.demo && SPOTS[a.source]) openBrowser(a.source); else openLink(a.link);
}
/** Un enlace de una web que tiene navegador propio se abre dentro; el resto, fuera. */
export function openLink(url?: string) {
  if (!url) { SFX.notAllowed(); return; }
  const s = urlSpot(url);
  if (s) openBrowser(s.id, url); else { window.open(url, '_blank'); SFX.click(); }
}
/** A web inside the game: its own browser if it has one (Linear, GitHub…), else the «Web» window. Only https (the
 *  <webview> takes nothing else, electron/main.cjs) and in Electron */
export const canOpenInside = (url: string) => { try { return IN_ELECTRON && new URL(url).protocol === 'https:'; } catch { return false; } };
export function openWeb(url: string) {
  const s = urlSpot(url);
  if (s) { openBrowser(s.id, url); return; }
  if (!canOpenInside(url)) { window.open(url, '_blank', 'noopener'); SFX.click(); return; }
  const already = win('web');
  if (!already) { create('web', url, false, false, new URL(url).hostname); SFX.open(); focus('web'); return; }
  // the same site: it goes there; another one, in a new <webview> confined to that one
  if (siteOf(already.url) === siteOf(url)) webviews.get('web')?.loadURL(url).catch(() => {});
  else update('web', v => ({ url, title: new URL(url).hostname, loading: true, generation: (v.generation ?? 0) + 1 }));
  onFront('web');
}
const siteOf = (url: string) => { try { return new URL(url).hostname.split('.').slice(-2).join('.'); } catch { return ''; } };
function create(id: string, url: string, minimized: boolean, maximized: boolean, title = SPOTS[id]?.name ?? id) {
  // un solo navegador a la vista: los demás se minimizan (ocuparían el mismo sitio)
  const z = nextZ();
  browsers.set(e => ({ list: [...e.list.map(x => (minimized ? x : { ...x, minimized: true })), { id, url, title, loading: !isLocal(id), minimized, maximized, z }] }));
}
export function onFront(id: string) {
  const v = win(id); if (!v) return;
  if (v.minimized) SFX.open();
  const z = nextZ();
  browsers.set(e => ({ list: e.list.map(x => (x.id === id ? { ...x, z, minimized: false } : x.minimized ? x : { ...x, minimized: true })) }));
  focus(id);
}
export function minimize(id: string) {
  const v = win(id); if (!v || v.minimized) return;
  dropFocus(id); update(id, { minimized: true }); SFX.close();
}
// cerrar no pierde nada que no esté ya en la web (la sesión se queda): sin preguntar
export function close(id: string) {
  if (!win(id)) return;
  dropFocus(id); webviews.delete(id);
  if (isRemote(id)) remoteOrder('cerrar').catch(() => {});   // y su Chrome (y la música)
  browsers.set(e => ({ list: e.list.filter(x => x.id !== id) })); SFX.close();
}
function toggleMaximize(id: string) { update(id, v => ({ maximized: !v.maximized })); SFX.click(); focus(id); }

const actions = (v: WindowNav) => ({
  maximized: v.maximized, closeTab: () => close(v.id), closeWindow: () => close(v.id), minimize: () => minimize(v.id),
  toggleMaximize: () => toggleMaximize(v.id), goTab: () => {}, moveTab: () => {},
});
// con el foco dentro de la web, las teclas no pasan por la página del juego: Electron manda aquí las de ventana
(window as any).__browserShortcut = (wcId: number, k: { code: string; key: string; shiftKey: boolean }) => {
  const id = [...webviews].find(([, w]) => { try { return w.getWebContentsId() === wcId; } catch { return false; } })?.[0];
  const v = id ? win(id) : undefined; if (!v) return;
  const e = new KeyboardEvent('keydown', { code: k.code, key: k.key, shiftKey: k.shiftKey, metaKey: true, bubbles: true, cancelable: true });
  // ⌘B (la barra) escucha en la ventana; el resto son de esta ventana del navegador
  if (k.code === 'KeyB') dispatchEvent(e); else windowShortcut(e, actions(v));
};

// tras una recarga (aplicar cambios del juego, reiniciar), los navegadores vuelven como estaban y en su página
const REMEMBERED = 'shelter.browsers';
addEventListener('pagehide', () => {
  try { sessionStorage.setItem(REMEMBERED, JSON.stringify(browsers.get().list.map(({ id, url, title, minimized, maximized, z, session, path }) => ({ id, url, title, minimized, maximized, z, session, path })))); } catch {}
});
// (la de páginas también fuera de Electron: es un <iframe>; su llave vale mientras siga el mismo servidor)
try {
  const l = JSON.parse(sessionStorage.getItem(REMEMBERED) || '[]'); sessionStorage.removeItem(REMEMBERED);
  for (const r of l.sort((a: any, b: any) => a.z - b.z)) {
    if (!SPOTS[r.id] || typeof r.url !== 'string' || (!IN_ELECTRON && !isLocal(r.id))) continue;
    if (isLocal(r.id)) {
      let u: URL | undefined; try { u = new URL(r.url, location.href); } catch {}
      if (r.url.startsWith('/pagina/') || (u && isLocalServer(u))) { create(r.id, r.url, !!r.minimized, false, String(r.title ?? '')); update(r.id, { session: typeof r.session === 'string' ? r.session : undefined, path: typeof r.path === 'string' ? r.path : undefined }); }
    }
    else if (SPOTS[r.id].loose) { if (canOpenInside(r.url)) create(r.id, r.url, !!r.minimized, false, String(r.title ?? '')); }
    else create(r.id, urlSpot(r.url)?.id === r.id ? r.url : SPOTS[r.id].start, !!r.minimized, false);
  }
} catch {}

// ---------------------------------------------------------------- interfaz
export function Browsers() {
  const list = browsers.use(e => e.list);
  return <>{list.map(v => <BrowserWindow key={v.id + (v.generation ?? '')} v={v} />)}</>;
}

function BrowserWindow({ v }: { v: WindowNav }) {
  const box = useRef<HTMLDivElement>(null);
  // el <webview> se crea una vez y no se vuelve a montar (moverlo o recrearlo recargaría la web)
  const [round, setRound] = React.useState(0);   // recargar la página local (el <iframe> se vuelve a montar)
  const frame = useRef<HTMLIFrameElement>(null);
  const [toReview, setReview] = React.useState(false);   // la lista de notas antes de mandarlas
  const notes = pageNotes.use(e => (v.path ? e[v.path] : undefined)) ?? [];
  // la capa de notas de la página: pide las guardadas al cargar y avisa de cada cambio (solo las de /pagina/)
  useEffect(() => {
    if (!isLocal(v.id) || !v.path) return;
    const path = v.path;
    const texts = { note: '✎ ' + t('windows.note'), save: t('windows.save'), cancel: t('windows.cancel'), deleteMessage: t('windows.delete'), placeholder: t('windows.whatShouldChangeHere') };
    const listen = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.shelter !== 'notes') return;
      if (e.data.type === 'hello') frame.current?.contentWindow?.postMessage({ shelter: 'notes', type: 'restore', texts, notes: pageNotes.get()[path] ?? [], scroll: scrollOf.get(path) ?? 0 }, '*');
      else if (e.data.type === 'scroll' && typeof e.data.y === 'number') scrollOf.set(path, e.data.y);
      else if (e.data.type === 'link') {
        // a link of the page: like one of a reply, at the pointer (the <iframe>'s coordinates are its own)
        const target = pageLinkTarget(e.data.href, path), r = frame.current?.getBoundingClientRect();
        if (target && r) followLink(target, { x: r.left + (Number(e.data.x) || 0), y: r.top + (Number(e.data.y) || 0), menu: !!e.data.menu, session: v.session ?? sessionThatLinked(path) });
      }
      else if (e.data.type === 'lista') pageNotes.set(x => { const l = cleanNotes(e.data.notes); const y = { ...x }; if (l.length) y[path] = l; else delete y[path]; return y; });
    };
    addEventListener('message', listen);
    return () => removeEventListener('message', listen);
  }, [v.id, v.path, v.session]);
  const changed = useRef<{ path: string; t: number } | null>(null);   // cuándo cambió el archivo de la que se ve
  // la página se recarga sola cuando cambia su archivo (el habitante rehace el plan o la comparación) y vuelve a donde
  // estaba; mientras está minimizada no se mira
  useEffect(() => {
    if (!isLocal(v.id) || !v.path || v.minimized) return;
    const path = v.path;
    const watch = () => client.action<Record<string, number>>('pages.updated', { paths: [path] }).then(m => {
      const now = m?.[path], before = changed.current;
      if (now && before?.path === path && now !== before.t) setRound(x => x + 1);
      if (now) changed.current = { path, t: now };
    }).catch(() => {});
    watch();
    const timer = setInterval(watch, 2000);
    return () => clearInterval(timer);
  }, [v.id, v.path, v.url, v.minimized]);
  // la conversación que la enlazó; si se abrió sin saberlo, la última que la enlazó
  const session = v.session ?? (v.path ? sessionThatLinked(v.path) : undefined);
  // quitar las notas de la página (ya mandadas, copiadas o descartadas)
  const [discard, setDiscard] = React.useState(false);
  const clearNotes = () => {
    const path = v.path; if (!path) return;
    pageNotes.set(x => { const y = { ...x }; delete y[path]; return y; });
    frame.current?.contentWindow?.postMessage({ shelter: 'notes', type: 'clear' }, '*');
    setReview(false); setDiscard(false);
  };
  const sendPageNotes = () => {
    if (!session || !v.path || !notes.length) return;
    client.send({ t: 'send', sessionId: session, text: notesMessage(v.path, notes) });
    answerPage(session, v.path, 'notes');
    clearNotes(); SFX.shortSuccess();
  };
  // sin la conversación que la enlazó (de otra sesión del juego): se copian para pegarlas donde se quiera y se quitan
  const copyPageNotes = () => {
    if (!v.path || !notes.length) return;
    navigator.clipboard.writeText(notesMessage(v.path, notes)).then(() => { clearNotes(); SFX.shortSuccess(); }).catch(() => SFX.notAllowed());
  };
  useEffect(() => {
    if (isRemote(v.id) || isLocal(v.id)) return;
    const w = document.createElement('webview') as Webview;
    w.setAttribute('partition', SPOTS[v.id]?.loose ? PARTITION_WEB : PARTITION);
    if (SPOTS[v.id]?.chrome) w.setAttribute('useragent', AGENT_CHROME);
    w.setAttribute('allowpopups', '');
    w.setAttribute('src', v.url);
    w.className = 'vn-web';
    const id = v.id;
    const detours = SPOTS[id]?.detours ?? {};
    const note = () => {
      let u: URL; try { u = new URL(w.getURL()); } catch { return; }
      const target = detours[u.pathname.replace(/\/+$/, '') || '/'];
      if (target) { w.loadURL(new URL(target, u.origin).href).catch(() => {}); return; }
      update(id, { url: u.href });
    };
    w.addEventListener('did-start-loading', () => update(id, { loading: true }));
    w.addEventListener('did-stop-loading', () => { update(id, { loading: false }); note(); });
    w.addEventListener('did-navigate', note);
    w.addEventListener('did-navigate-in-page', note);
    w.addEventListener('page-title-updated', (e: any) => update(id, { title: e.title }));
    // un clic dentro de la web no llega al juego, pero el foco sí: la trae delante
    w.addEventListener('focus', () => { const x = win(id); if (x && !x.minimized && browsers.get().list.some(o => o.z > x.z)) onFront(id); });
    box.current!.appendChild(w);
    webviews.set(id, w);
    return () => { w.remove(); if (webviews.get(id) === w) webviews.delete(id); };
  }, []);
  const s = SPOTS[v.id];
  const page = pageTitle(v);
  // an image of the Mac (server/localPages.ts): drawn by the game, with no notes to leave on it
  const image = isLocal(v.id) && !!v.path && IMAGE_FILE.test(v.path);
  const [realSize, setRealSize] = React.useState(false);
  return (
    <div className={'window-browser interactive' + (v.maximized ? ' maximized' : '') + (v.minimized ? ' minimized' : '') + (v.id === 'page' ? ' beside' : '')}
      style={{ zIndex: v.maximized ? 200000 + v.z : v.z }} onPointerDown={() => { if (!v.minimized) onFront(v.id); }}
      onKeyDownCapture={e => windowShortcut(e, actions(v))} role="dialog" aria-label={t('windows.browserName', { name: s?.name ?? v.id })}>
      <div className="vt-head vn-head" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(v.id); }}>
        <span className="grid" /><span className={'pilot ' + (v.loading ? 'working' : 'idle')} />
        <span className="vt-title">{t('windows.browser')} · {s?.name ?? v.id}</span>
        <span className="vt-path" title={v.url}>{page}</span>
        <span className="vn-controls">
          {isLocal(v.id) && v.path && notes.length > 0 && <button className="console-x vn-notas" onClick={() => { setReview(x => !x); SFX.click(); }} title={session ? t('windows.reviewAndSendNotes') : t('windows.openThePageFromA')}>✎ {t('windows.notesN', { n: notes.length })}</button>}
          {isLocal(v.id) && v.path && !image && session && notes.length === 0 && <button className="console-x vn-notas" onClick={() => validatePage(session, v.path!)} title={t('windows.validatePageHint')}>✓ {t('windows.validate')}</button>}
          {isLocal(v.id) && !v.path && v.session && <button className="console-x vn-notas" onClick={() => sendNotes(v)} title={t('windows.sendNotesHint')}>✎ {t('windows.sendNotes')}</button>}
          <button className="console-x" onClick={() => { if (isLocal(v.id)) { SFX.notAllowed(); return; } if (isRemote(v.id)) { remoteOrder('navegar', 'atras').catch(() => {}); return; } const w = webviews.get(v.id); if (w?.canGoBack()) w.goBack(); else SFX.notAllowed(); }} title={t('windows.backShortcut', { shortcut: `${CMD}[` })}>◂</button>
          <button className="console-x" onClick={() => { if (isLocal(v.id)) setRound(n => n + 1); else if (isRemote(v.id)) remoteOrder('navegar', 'recargar').catch(() => {}); else webviews.get(v.id)?.reload(); }} title={t('windows.reloadShortcut', { shortcut: `${CMD}R` })}>↻</button>
          {isLocal(v.id) && v.path && <button className="console-x" onClick={() => revealPage(v.path!)} title={t('windows.showInFinderHint')}>📁</button>}
          <button className="console-x" onClick={() => { window.open(isLocal(v.id) ? new URL(v.url, location.href).href : v.url, '_blank'); SFX.click(); }} title={t('windows.openThisPageInThe')}>↗</button>
        </span>
        <WindowButtons maximized={v.maximized} minimize={() => minimize(v.id)} toggleMaximize={() => toggleMaximize(v.id)} close={() => close(v.id)} closesThat={isLocal(v.id) ? t('windows.thePage') : t('windows.theBrowserTheSessionIs')} />
      </div>
      <div ref={box} className="vn-body">
        {isRemote(v.id) && <RemoteView v={v} />}
        {/* sin allow-same-origin: la página no ve el juego (el servidor además la manda con su propia cabecera sandbox) */}
        {toReview && notes.length > 0 && <div className="vn-list-notes">
          <ol>{notes.map(n => <li key={n.id}><div className="dim">«{n.quote.length > 160 ? n.quote.slice(0, 160) + '…' : n.quote}»{n.section ? ` · ${n.section}` : ''}</div><div>{n.text}</div></li>)}</ol>
          <div className="button-bar">
            <button className="button-workshop" onClick={() => { setReview(false); setDiscard(false); }}>{t('windows.cancel')}</button>
            <button className={'button-workshop' + (discard ? ' urgent' : '')} title={t('windows.discardNotesHint')} onClick={() => { if (discard) { clearNotes(); SFX.click(); } else setDiscard(true); }}>{discard ? t('windows.discardNotesSure') : t('windows.discardNotes')}</button>
            {session
              ? <button className="button-workshop" onClick={sendPageNotes}>{t('windows.sendToTheConversation')}</button>
              : <button className="button-workshop" title={t('windows.copyNotesHint')} onClick={copyPageNotes}>📋 {t('windows.copyNotes')}</button>}
          </div>
        </div>}
        {image && <div className={'vn-web vn-image' + (realSize ? ' real' : '')} onClick={() => setRealSize(x => !x)}><img src={round ? `${v.url}?v=${round}` : v.url} alt={v.title} /></div>}
        {isLocal(v.id) && !image && <iframe ref={frame} key={v.url + round} className="vn-web vn-page" src={v.url} title={v.title} sandbox={sandboxOf(v.url)} referrerPolicy="no-referrer" />}
      </div>
    </div>
  );
}

// las notas se quedan en la página (las guarda la herramienta que la sirve): aquí solo se le dice a la conversación
// que las aplique, como diría el Supervisor en el intercomunicador
function sendNotes(v: WindowNav) {
  if (!v.session) return;
  const url = v.url.startsWith('/') ? new URL(v.url, location.href).href : v.url;
  client.send({ t: 'send', sessionId: v.session, text: t('windows.iLeftNotesOnThe', { url }) });
  SFX.click();
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
if (remote) {
  remote.onFrame(jpeg => void paint(jpeg));
  remote.onState(e => {
    if (remoteCanvas && (e as { cursor?: string }).cursor) remoteCanvas.style.cursor = (e as { cursor?: string }).cursor!;
    if (!win('spotify')) return;
    update('spotify', { loading: e.loading, ...(e.url ? { url: e.url } : {}), ...(e.title ? { title: e.title } : {}) });
  });
}
const MOUSE_BUTTON = ['left', 'middle', 'right'];
const mods = (e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ({ alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey });

function RemoteView({ v }: { v: WindowNav }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = React.useState('');
  useEffect(() => {
    const c = canvas.current!, t = field.current!;
    remoteCanvas = c; remoteFields.set(v.id, t);
    const measure = () => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? remoteOrder('tamano', r.width, r.height, devicePixelRatio).catch(() => {}) : Promise.resolve(); };
    // el tamaño (y la densidad de la pantalla) antes de abrir: Chrome arranca con ella
    measure().then(() => remoteOrder('abrir')).then(() => setError('')).catch(e => setError(String((e as Error).message || e).replace(/^Error invoking remote method 'remoto': (Error: )?/, '')));
    const ro = new ResizeObserver(() => void measure()); ro.observe(c);
    const pos = (e: MouseEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const mouse = (type: string) => (e: MouseEvent) => {
      if (type === 'mousePressed') { e.preventDefault(); t.focus(); }
      remoteOrder('entrada', { kind: 'raton', type, ...pos(e), button: type === 'mouseMoved' ? (e.buttons & 1 ? 'left' : 'none') : MOUSE_BUTTON[e.button] ?? 'none', buttons: e.buttons, clickCount: type === 'mouseMoved' ? 0 : e.detail || 1, ...mods(e) }).catch(() => {});
    };
    const move = mouse('mouseMoved'), download = mouse('mousePressed'), upload = mouse('mouseReleased');
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1; remoteOrder('entrada', { kind: 'rueda', ...pos(e), deltaX: e.deltaX * k, deltaY: e.deltaY * k, ...mods(e) }).catch(() => {}); };
    const menu = (e: MouseEvent) => e.preventDefault();
    c.addEventListener('mousemove', move); c.addEventListener('mousedown', download); addEventListener('mouseup', upload);
    c.addEventListener('wheel', onWheel, { passive: false }); c.addEventListener('contextmenu', menu);
    return () => {
      ro.disconnect(); c.removeEventListener('mousemove', move); c.removeEventListener('mousedown', download); removeEventListener('mouseup', upload);
      c.removeEventListener('wheel', onWheel); c.removeEventListener('contextmenu', menu);
      if (remoteCanvas === c) remoteCanvas = null; if (remoteFields.get(v.id) === t) remoteFields.delete(v.id);
    };
  }, []);
  // solo se pide imagen con la ventana a la vista (minimizada, la música sigue)
  useEffect(() => { remoteOrder('visible', !v.minimized).catch(() => {}); }, [v.minimized]);
  const key = (type: 'keyDown' | 'keyUp') => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const n = e.nativeEvent;
    if (n.isComposing || e.key === 'Dead' || e.key === 'Process') return;   // acentos: llegan enteros al terminar
    if (e.metaKey && (e.code === 'KeyB' || e.code === 'KeyJ')) return;        // la barra y la música del refugio
    e.preventDefault(); e.stopPropagation();
    if (type === 'keyDown' && e.metaKey && e.code === 'KeyV' && !e.shiftKey) {
      navigator.clipboard.readText().then(text => { if (text) remoteOrder('entrada', { kind: 'texto', text }).catch(() => {}); }).catch(() => {});
      return;
    }
    const text = e.key.length === 1 ? e.key : e.key === 'Enter' ? '\r' : undefined;
    remoteOrder('entrada', { kind: 'tecla', type, key: e.key, code: e.code, keyCode: e.keyCode, text, ...mods(e) }).catch(() => {});
  };
  return (
    <div className="vn-remote">
      <canvas ref={canvas} className="vn-canvas" />
      <textarea ref={field} className="vn-keys" aria-label={t('windows.nameKeyboard', { name: SPOTS[v.id]?.name ?? v.id })} autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onKeyDown={key('keyDown')} onKeyUp={key('keyUp')}
        onCompositionEnd={e => { if (e.data) remoteOrder('entrada', { kind: 'texto', text: e.data }).catch(() => {}); e.currentTarget.value = ''; }}
        onInput={e => {
          // texto que no llega por una pulsación (dictado, métodos de entrada…): tal cual
          const n = e.nativeEvent as InputEvent; if (n.isComposing) return;
          if (n.data && n.inputType === 'insertText') remoteOrder('entrada', { kind: 'texto', text: n.data }).catch(() => {});
          e.currentTarget.value = '';
        }}
        onFocus={() => { const x = win(v.id); if (x && !x.minimized && browsers.get().list.some(o => o.z > x.z)) onFront(v.id); }} />
      {error && <div className="vn-notice">{error}</div>}
    </div>
  );
}
