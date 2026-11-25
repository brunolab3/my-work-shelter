// Conexión con el servidor local del refugio: WebSocket con reconexión, peticiones con respuesta y almacén de datos vivos.
import type { ClientMessage, ServerMessage, SessionSummary, LogInput, InfoRepo, Visitor, MusicState, NoticeQuestion } from '@shared/protocol';
import type { ScheduledMessage } from '@shared/scheduled';
import type { VerificationSummary } from '@shared/verification';
import type { PlanLimits } from '@shared/planLimits';
import type { ReviewBoard } from '@shared/reviews';
import { Store } from '../ui/store';
import { DEFAULT_LOG_PAGE, LOG_PAGE_SIZES, prependOlder, trimToLatest, withLatest, type LogPage } from '@shared/logPages';
import type { LogHits } from '@shared/findText';
import { t, roomNameIs } from '@shared/language';

export interface LiveData {
  connected: boolean;
  attempts: number;
  restarting: boolean;                     // el servidor se está reiniciando: al volver, se recarga la página
  claudeOk: boolean;
  versionClaude?: string;
  state: any | null;                       // EstadoRefugio del servidor
  sessions: Record<string, SessionSummary>;
  entries: Record<string, LogInput[]>;    // the page(s) of each open conversation's log held here (loadLog, loadOlder)
  older: Record<string, boolean>;          // its older entries not held, asked for when scrolling to the top
  partial: Record<string, string>;          // narración en streaming por sesión
  repos: Record<string, InfoRepo>;
  visitors: Visitor[];
  notifications: any[];
  events: any[];
  integrations: Record<string, any>;
  notices: Notice[];
  music: MusicState | null;              // lo que suena en la discoteca (Spotify web; lo pone Disco.tsx)
  scheduled: ScheduledMessage[];         // mensajes programados pendientes (server/scheduled.ts)
  verifications: Record<string, VerificationSummary>;   // each task's production verification (server/verifications.ts)
  planLimits: PlanLimits;                // the Claude plan's usage windows (server/planLimits.ts)
  reviews: ReviewBoard;                  // the Review room's PRs (server/reviewRoom.ts)
}

// a notice (teletype): its id is its arrival time in ms (plus a fraction, so two never collide)
export type Notice = { id: number; level: string; text: string; question?: NoticeQuestion };

export const live = new Store<LiveData>({ connected: false, attempts: 0, restarting: false, claudeOk: false, state: null, sessions: {}, entries: {}, older: {}, partial: {}, repos: {}, visitors: [], notifications: [], events: [], integrations: {}, notices: [], music: null, scheduled: [], verifications: {}, planLimits: {}, reviews: { state: 'reading', reviews: [] } });

// Notices stay until read (the older ones folded into one group: Avisos in web/src/ui/Bridge.tsx), up to the latest
// MAX_NOTICES; questions don't count and stay until answered
const MAX_NOTICES = 30;
export function addNotice(level: string, text: string, question?: NoticeQuestion) {
  live.set(e => {
    const l = [...e.notices, { id: Date.now() + Math.random(), level, text, question }];
    let excess = l.filter(a => !a.question).length - MAX_NOTICES;
    return { notices: l.filter(a => a.question || excess-- <= 0) };
  });
}

// El secreto del arranque llega en el fragmento de la URL (#t=…, no viaja al servidor ni queda en el historial de
// peticiones); se guarda en la sesión de la pestaña para sobrevivir a recargas y se quita de la barra de direcciones.
// (window.__SHELTER_TOKEN solo existe si se arranca Vite con SHELTER_TOKEN_EN_PAGINA=1, para QA a sabiendas.)
function tokenShelter(): string {
  const m = /[#&]t=([0-9a-f]+)/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('shelter.token', m[1]); } catch {} history.replaceState(null, '', location.pathname + location.search); return m[1]; }
  try { const t = sessionStorage.getItem('shelter.token'); if (t) return t; } catch {}
  return (window as any).__SHELTER_TOKEN ?? '';
}

type Listener = (m: ServerMessage) => void;
// room names in the chosen language (the service rooms keep theirs as Spanish data), from the first state on
const shownState = (e: any) => (e?.rooms ? { ...e, rooms: (e.rooms as any[]).map((s: any) => ({ ...s, name: roomNameIs(s) })) } : e);

class Client {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private pending = new Map<string, { ok: (v: any) => void; ko: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private n = 0;

  connect() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?t=' + encodeURIComponent(tokenShelter());
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      // tras un reinicio, el cliente nuevo (si lo hay) entra recargando; las terminales se reenganchan solas
      if (live.get().restarting) { location.reload(); return; }
      live.set({ connected: true, attempts: 0 });
      this.send({ t: 'hello', version: '0.1' });
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = ev => { try { this.receive(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = () => {
      live.set(e => ({ connected: false, attempts: e.attempts + 1 }));
      // si el servidor responde pero el WebSocket se niega varias veces, es otro arranque (otro secreto): hay que recargar
      if (live.get().attempts >= 4) fetch('/salud').then(r => { if (r.ok) addNotice('error', t('windows.serverRestartedReopen')); }).catch(() => {});
      const wait = Math.min(4000, 400 * (live.get().attempts + 1));
      setTimeout(() => this.connect(), wait);
    };
  }

  send(m: ClientMessage) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s); else this.queue.push(s);
  }

  // Petición con respuesta (acciones, historial, cuaderno…)
  ask<T = unknown>(m: Record<string, unknown> & { t: ClientMessage['t'] }, wait = 60_000): Promise<T> {
    const request = 'p' + (++this.n);
    return new Promise<T>((ok, ko) => {
      this.pending.set(request, { ok, ko });
      this.send({ ...m, request } as any);
      setTimeout(() => { if (this.pending.delete(request)) ko(new Error(t('windows.theShelterIsNotResponding'))); }, wait);
    });
  }
  action<T = unknown>(name: string, data?: Record<string, unknown>, wait?: number) { return this.ask<T>({ t: 'action', name, data }, wait); }

  listen(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  private receive(m: ServerMessage) {
    switch (m.t) {
      case 'welcome': {
        const sessions: Record<string, SessionSummary> = {}; for (const s of m.sessions) sessions[s.id] = s;
        live.set({ claudeOk: m.claudeOk, versionClaude: m.versionClaude, state: shownState(m.state), sessions, repos: m.repos });
        // tras un corte, los cuadernos abiertos se vuelven a pedir enteros (lo que llegó durante el corte no se pierde)
        wholeLogs.clear();
        for (const id of Object.keys(live.get().entries)) if (sessions[id]) loadLog(id); else dropLog(id);
        break;
      }
      case 'session': live.set(e => ({ sessions: { ...e.sessions, [m.session.id]: m.session }, partial: m.session.state !== 'working' && m.session.state !== 'starting' ? { ...e.partial, [m.session.id]: '' } : e.partial })); break;
      // a closed conversation leaves the client's memory: reopened, it is read again from its transcript
      case 'sessionRemoved': live.set(e => { const s = { ...e.sessions }; delete s[m.sessionId]; return { sessions: s }; }); dropLog(m.sessionId); break;
      case 'entries': live.set(e => ({ ...held(e, m.sessionId, [...(e.entries[m.sessionId] ?? []), ...m.entries], MAX_HELD), partial: m.entries.some(x => x.type === 'asistente') ? { ...e.partial, [m.sessionId]: '' } : e.partial })); break;
      case 'text': live.set(e => ({ partial: { ...e.partial, [m.sessionId]: (e.partial[m.sessionId] ?? '') + m.delta } })); break;
      case 'response': { const p = this.pending.get(m.request); if (p) { this.pending.delete(m.request); m.error ? p.ko(new Error(m.error)) : p.ok(m.data); } break; }
      case 'repos': live.set({ repos: m.repos }); break;
      case 'visitors': live.set({ visitors: m.visitors }); break;
      case 'scheduled': live.set({ scheduled: m.list }); break;
      case 'verifications': live.set({ verifications: m.states }); break;
      case 'reviews': live.set({ reviews: m.board }); break;
      case 'limits': live.set({ planLimits: m.limits }); break;
      case 'notifications': live.set({ notifications: m.list }); break;
      case 'events': live.set({ events: m.list }); break;
      case 'integration': live.set(e => ({ integrations: { ...e.integrations, [m.id]: m.state } })); break;
      case 'state': live.set({ state: shownState(m.state) }); break;
      // los que preguntan no se pierden entre los demás: se quedan hasta contestarlos
      case 'notice': addNotice(m.level, m.text, m.question); break;
      case 'reload': location.reload(); break;
      case 'restarting': live.set({ restarting: true }); break;
    }
    for (const f of this.listeners) f(m);
  }
}

export const client = new Client();

// A conversation's log is held by pages (shared/logPages.ts): its latest page is asked for once (and again after each
// disconnection), older ones when the Overseer scrolls to the top, and back at the bottom only the latest page stays.
// What arrives through 'entradas' meanwhile is kept after it. Page size: an option, saved in this browser
const PAGE_KEY = 'shelter.logPage';
const MAX_HELD = 1500;
export function logPageSize(): number {
  try { const n = Number(localStorage.getItem(PAGE_KEY)); if (LOG_PAGE_SIZES.includes(n)) return n; } catch {}
  return DEFAULT_LOG_PAGE;
}
export function setLogPageSize(n: number) { try { localStorage.setItem(PAGE_KEY, String(n)); } catch {} }

// a conversation's held entries, at most `keep` (the older ones cut can be asked for again)
const held = (e: LiveData, id: string, list: LogInput[], keep: number) => {
  const t = trimToLatest(list, keep);
  return { entries: { ...e.entries, [id]: t.entries }, older: t.trimmed && !e.older[id] ? { ...e.older, [id]: true } : e.older };
};
const wholeLogs = new Set<string>();
export function loadLog(id: string) {
  if (wholeLogs.has(id)) return;
  wholeLogs.add(id);
  client.ask<LogPage<LogInput>>({ t: 'logPage', sessionId: id, limit: logPageSize() })
    .then(p => live.set(e => ({ entries: { ...e.entries, [id]: withLatest(p.entries, e.entries[id] ?? []) }, older: { ...e.older, [id]: p.more } })))
    .catch(() => wholeLogs.delete(id));
}
/** ⌘F in a conversation: the matches in its whole log, not only the entries held (Sessions.find on the server) */
export const findInLog = (id: string, query: string) => client.ask<LogHits>({ t: 'logFind', sessionId: id, query });
const loadingOlder = new Set<string>();
/** The page before the oldest entry held, put above it; false if there was nothing to ask for */
export async function loadOlder(id: string): Promise<boolean> {
  const first = live.get().entries[id]?.[0];
  if (!first || !live.get().older[id] || loadingOlder.has(id)) return false;
  loadingOlder.add(id);
  try {
    const p = await client.ask<LogPage<LogInput>>({ t: 'logPage', sessionId: id, limit: logPageSize(), before: { id: first.id, ts: first.ts } });
    live.set(e => ({ entries: { ...e.entries, [id]: prependOlder(e.entries[id] ?? [], p.entries) }, older: { ...e.older, [id]: p.more } }));
    return true;
  } catch { return false; } finally { loadingOlder.delete(id); }
}
/** Back at the bottom: only the latest page stays held */
export function trimLog(id: string) {
  const list = live.get().entries[id];
  if (list && list.length > logPageSize() * 2) live.set(e => held(e, id, e.entries[id] ?? [], logPageSize()));
}
function dropLog(id: string) {
  wholeLogs.delete(id);
  live.set(e => {
    if (!(id in e.entries) && !(id in e.partial)) return {};
    const entries = { ...e.entries }, older = { ...e.older }, partial = { ...e.partial };
    delete entries[id]; delete older[id]; delete partial[id];
    return { entries, older, partial };
  });
}
