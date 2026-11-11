// Conexión con el servidor local del refugio: WebSocket con reconexión, peticiones con respuesta y almacén de datos vivos.
import type { ClientMessage, ServerMessage, SessionSummary, LogInput, InfoRepo, Visitante, MusicState, NoticeQuestion } from '@shared/protocolo';
import { Store } from '../ui/almacen';

export interface LiveData {
  connected: boolean;
  attempts: number;
  reiniciando: boolean;                     // el servidor se está reiniciando: al volver, se recarga la página
  claudeOk: boolean;
  versionClaude?: string;
  estado: any | null;                       // EstadoRefugio del servidor
  sesiones: Record<string, SessionSummary>;
  entradas: Record<string, LogInput[]>;
  parcial: Record<string, string>;          // narración en streaming por sesión
  repos: Record<string, InfoRepo>;
  visitantes: Visitante[];
  notificaciones: any[];
  eventos: any[];
  integraciones: Record<string, any>;
  avisos: { id: number; nivel: string; texto: string; pregunta?: NoticeQuestion }[];
  musica: MusicState | null;              // lo que suena en la discoteca (Spotify web; lo pone Discoteca.tsx)
}

export const vivo = new Store<LiveData>({ connected: false, attempts: 0, reiniciando: false, claudeOk: false, estado: null, sesiones: {}, entradas: {}, parcial: {}, repos: {}, visitantes: [], notificaciones: [], eventos: [], integraciones: {}, avisos: [], musica: null });

// El secreto del arranque llega en el fragmento de la URL (#t=…, no viaja al servidor ni queda en el historial de
// peticiones); se guarda en la sesión de la pestaña para sobrevivir a recargas y se quita de la barra de direcciones.
// (window.__SHELTER_TOKEN solo existe si se arranca Vite con SHELTER_TOKEN_EN_PAGINA=1, para QA a sabiendas.)
function tokenShelter(): string {
  const m = /[#&]t=([0-9a-f]+)/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('refugio.token', m[1]); } catch {} history.replaceState(null, '', location.pathname + location.search); return m[1]; }
  try { const t = sessionStorage.getItem('refugio.token'); if (t) return t; } catch {}
  return (window as any).__SHELTER_TOKEN ?? '';
}

type Listener = (m: ServerMessage) => void;
class Client {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private pendientes = new Map<string, { ok: (v: any) => void; ko: (e: Error) => void }>();
  private listeners = new Set<Listener>();
  private n = 0;

  conectar() {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?t=' + encodeURIComponent(tokenShelter());
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      // tras un reinicio, el cliente nuevo (si lo hay) entra recargando; las terminales se reenganchan solas
      if (vivo.get().reiniciando) { location.reload(); return; }
      vivo.set({ connected: true, attempts: 0 });
      this.enviar({ t: 'hola', version: '0.1' });
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = ev => { try { this.receive(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = () => {
      vivo.set(e => ({ connected: false, attempts: e.attempts + 1 }));
      // si el servidor responde pero el WebSocket se niega varias veces, es otro arranque (otro secreto): hay que recargar
      if (vivo.get().attempts >= 4) fetch('/salud').then(r => { if (r.ok) vivo.set(e => ({ avisos: [...e.avisos.slice(-4), { id: Date.now(), nivel: 'error', texto: 'El servidor del refugio se ha reiniciado: vuelve a abrir work-shelter con ./shelter (o recarga con el enlace nuevo).' }] })); }).catch(() => {});
      const espera = Math.min(4000, 400 * (vivo.get().attempts + 1));
      setTimeout(() => this.conectar(), espera);
    };
  }

  enviar(m: ClientMessage) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s); else this.queue.push(s);
  }

  // Petición con respuesta (acciones, historial, cuaderno…)
  ask<T = unknown>(m: Record<string, unknown> & { t: ClientMessage['t'] }, espera = 60_000): Promise<T> {
    const peticion = 'p' + (++this.n);
    return new Promise<T>((ok, ko) => {
      this.pendientes.set(peticion, { ok, ko });
      this.enviar({ ...m, peticion } as any);
      setTimeout(() => { if (this.pendientes.delete(peticion)) ko(new Error('El refugio no responde.')); }, espera);
    });
  }
  accion<T = unknown>(nombre: string, datos?: Record<string, unknown>, espera?: number) { return this.ask<T>({ t: 'accion', nombre, datos }, espera); }

  escuchar(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  private receive(m: ServerMessage) {
    switch (m.t) {
      case 'bienvenida': {
        const sesiones: Record<string, SessionSummary> = {}; for (const s of m.sesiones) sesiones[s.id] = s;
        vivo.set({ claudeOk: m.claudeOk, versionClaude: m.versionClaude, estado: m.estado, sesiones, repos: m.repos });
        // tras un corte, los cuadernos abiertos se vuelven a pedir enteros (lo que llegó durante el corte no se pierde)
        wholeLogs.clear();
        for (const id of Object.keys(vivo.get().entradas)) if (sesiones[id]) loadLog(id);
        break;
      }
      case 'sesion': vivo.set(e => ({ sesiones: { ...e.sesiones, [m.sesion.id]: m.sesion }, parcial: m.sesion.estado !== 'trabajando' && m.sesion.estado !== 'arrancando' ? { ...e.parcial, [m.sesion.id]: '' } : e.parcial })); break;
      case 'sesionFuera': vivo.set(e => { const s = { ...e.sesiones }; delete s[m.sesionId]; return { sesiones: s }; }); break;
      case 'entradas': vivo.set(e => ({ entradas: { ...e.entradas, [m.sesionId]: [...(e.entradas[m.sesionId] ?? []), ...m.entradas].slice(-1500) }, parcial: m.entradas.some(x => x.tipo === 'asistente') ? { ...e.parcial, [m.sesionId]: '' } : e.parcial })); break;
      case 'texto': vivo.set(e => ({ parcial: { ...e.parcial, [m.sesionId]: (e.parcial[m.sesionId] ?? '') + m.delta } })); break;
      case 'respuesta': { const p = this.pendientes.get(m.peticion); if (p) { this.pendientes.delete(m.peticion); m.error ? p.ko(new Error(m.error)) : p.ok(m.datos); } break; }
      case 'repos': vivo.set({ repos: m.repos }); break;
      case 'visitantes': vivo.set({ visitantes: m.visitantes }); break;
      case 'notificaciones': vivo.set({ notificaciones: m.lista }); break;
      case 'eventos': vivo.set({ eventos: m.lista }); break;
      case 'integracion': vivo.set(e => ({ integraciones: { ...e.integraciones, [m.id]: m.estado } })); break;
      case 'estado': vivo.set({ estado: m.estado }); break;
      // los que preguntan no se pierden entre los demás: se quedan hasta contestarlos
      case 'aviso': vivo.set(e => ({ avisos: [...e.avisos.filter((a, i, l) => a.pregunta || i >= l.length - 4), { id: Date.now() + Math.random(), nivel: m.nivel, texto: m.texto, pregunta: m.pregunta }] })); break;
      case 'recargar': location.reload(); break;
      case 'reiniciando': vivo.set({ reiniciando: true }); break;
    }
    for (const f of this.listeners) f(m);
  }
}

export const cliente = new Client();

// El cuaderno entero de una conversación se pide una vez (y otra tras cada corte): lo que llega suelto por 'entradas'
// antes de pedirlo es solo la cola (al recargar la página con una conversación trabajando), no todo el historial. La
// respuesta lo sustituye entero: el servidor la da con todo lo enviado antes, y lo de después se suma detrás
const wholeLogs = new Set<string>();
export function loadLog(id: string) {
  if (wholeLogs.has(id)) return;
  wholeLogs.add(id);
  cliente.ask<any[]>({ t: 'cuaderno', sesionId: id }).then(lista => vivo.set(e => ({ entradas: { ...e.entradas, [id]: lista } }))).catch(() => wholeLogs.delete(id));
}
