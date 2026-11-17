// Integraciones (Microsoft 365, Google, Discord, Slack, GitHub, Linear): tres estados por fuente (demo, configurada, error).
// El modo demo pasa por el mismo camino que el real: un adaptador que produce notificaciones y eventos normalizados.
import type { WebSocket } from 'ws';
import type { Store } from '../estado.ts';
import type { ServerMessage } from '../../shared/protocolo.ts';
import { createAdapters, type Adapter, type Aviso, type Notification, type Evento, type SourceState } from './adaptadores.ts';
import { groupNotices, type Conversation } from './normalizar.ts';
import { t } from '../../shared/idioma.ts';

export class Integraciones {
  private adaptadores: Adapter[];
  private mensajes: Notification[] = [];   // tal como llegan, uno por mensaje
  notificaciones: Conversation[] = [];      // lo que se difunde: una por conversación
  private difundidas = '';
  eventos: Evento[] = [];
  private clocks: NodeJS.Timeout[] = [];
  constructor(private almacen: Store, private broadcast: (m: ServerMessage) => void) { this.adaptadores = createAdapters(almacen, (id, aviso) => this.onNotify(id, aviso)); }

  // Avisos de los conectores reales: difundir su estado, sondear ya (Discord en tiempo real) o pasar a real (OAuth hecho)
  private onNotify(id: Adapter['id'], aviso: Aviso) {
    const a = this.adaptadores.find(x => x.id === id); if (!a) return;
    if (aviso === 'estado') this.broadcast({ t: 'integracion', id, estado: a.estado() });
    else if (aviso === 'sondear') this.pollOne(a);
    else if (aviso === 'activar') this.changeMode(a, 'real').catch(() => {});
  }

  estados(): Record<string, SourceState> { return Object.fromEntries(this.adaptadores.map(a => [a.id, a.estado()])); }

  greet(ws: WebSocket, enviar: (ws: WebSocket, m: ServerMessage) => void) {
    enviar(ws, { t: 'notificaciones', lista: this.notificaciones });
    enviar(ws, { t: 'eventos', lista: this.eventos });
    for (const [id, estado] of Object.entries(this.estados())) enviar(ws, { t: 'integracion', id, estado });
  }

  private async pollOne(a: Adapter) {
    try {
      const r = await a.sondear();
      if (r.complete || r.notificaciones?.length) this.receive(a.id, r.notificaciones ?? [], !!r.complete);
      if (r.leidos?.length) this.leer(a.id, r.leidos);
      if (r.eventos) { this.eventos = [...this.eventos.filter(e => e.fuente !== a.id), ...r.eventos].sort((x, y) => x.inicio - y.inicio); this.broadcast({ t: 'eventos', lista: this.eventos }); }
    } catch (e) { a.error = (e as Error).message; }
    this.broadcast({ t: 'integracion', id: a.id, estado: a.estado() });
  }

  arrancar() {
    for (const a of this.adaptadores) {
      this.pollOne(a);
      this.clocks.push(setInterval(() => this.pollOne(a), a.intervalMs));
    }
  }

  // Cambio de modo (demo ⇄ real): se vacía lo de esa fuente y se sondea de nuevo por el mismo camino
  private async changeMode(a: Adapter, modo: 'off' | 'demo' | 'real') {
    this.almacen.cambiar(e => { e.integraciones[a.id] = { ...(e.integraciones[a.id] ?? {}), modo }; });
    a.reiniciar();
    this.mensajes = this.mensajes.filter(n => n.fuente !== a.id); this.eventos = this.eventos.filter(n => n.fuente !== a.id);
    this.publish(); this.broadcast({ t: 'eventos', lista: this.eventos });
    await this.pollOne(a);
    return a.estado();
  }
  parar() { for (const r of this.clocks) clearInterval(r); this.clocks = []; for (const a of this.adaptadores) a.parar?.(); }

  // completas: lo de esa fuente se sustituye entero (lo leído allí desaparece); si no, se añade lo que no estaba
  private receive(fuente: Adapter['id'], ns: Notification[], complete: boolean) {
    const views = new Set(this.almacen.estado.viewsNotifications);
    const withView = (n: Notification) => ({ ...n, vista: views.has(n.id) });
    if (complete) this.mensajes = [...this.mensajes.filter(n => n.fuente !== fuente), ...ns.map(withView)];
    else { const ya = new Set(this.mensajes.map(n => n.id)); this.mensajes.push(...ns.filter(n => !ya.has(n.id)).map(withView)); }
    this.mensajes = this.mensajes.sort((a, b) => b.fecha - a.fecha).slice(0, 600);
    this.publish();
  }
  // Lo ya leído en la fuente (he contestado allí): esos mensajes pasan a vistos, como si se marcaran en el tablón
  private leer(fuente: Adapter['id'], leidos: { hilo: string; hasta: number }[]) {
    const ids = this.mensajes.filter(n => n.fuente === fuente && !n.vista && leidos.some(l => l.hilo === n.hilo && n.fecha <= l.hasta)).map(n => n.id);
    if (!ids.length) return;
    this.almacen.cambiar(e => { for (const id of ids) if (!e.viewsNotifications.includes(id)) e.viewsNotifications.push(id); e.viewsNotifications = e.viewsNotifications.slice(-3000); });
    for (const n of this.mensajes) if (ids.includes(n.id)) n.vista = true;
    this.publish();
  }
  // Se difunde solo si cambia algo (las fuentes completas se sondean cada 5–60 s y casi siempre traen lo mismo)
  private publish() {
    const lista = groupNotices(this.mensajes), json = JSON.stringify(lista);
    if (json === this.difundidas) return;
    this.difundidas = json; this.notificaciones = lista;
    this.broadcast({ t: 'notificaciones', lista });
  }

  async accion(nombre: string, d: Record<string, any>) {
    const a = this.adaptadores.find(x => x.id === d.fuente);
    switch (nombre) {
      case 'marcarVista': {
        const ids: string[] = d.ids ?? [d.id];
        this.almacen.cambiar(e => { for (const id of ids) if (!e.viewsNotifications.includes(id)) e.viewsNotifications.push(id); e.viewsNotifications = e.viewsNotifications.slice(-3000); });
        for (const n of this.mensajes) if (ids.includes(n.id)) n.vista = true;
        this.publish(); return true;
      }
      case 'estados': return this.estados();
      case 'probar': if (!a) throw new Error(t('integrations.unknownSource')); return a.probar(d.campos ?? {});
      // Guardar: datos públicos al estado y secretos al llavero; si la prueba pasa, la fuente pasa a real (d.activar=false lo evita)
      case 'guardar': if (!a) throw new Error(t('integrations.unknownSource')); { const r = await a.configurar(d.campos ?? {}); if (r.ok && d.activar !== false) await this.changeMode(a, 'real'); else this.broadcast({ t: 'integracion', id: a.id, estado: a.estado() }); return r; }
      case 'modo': {
        if (!a) throw new Error(t('integrations.unknownSource'));
        const modo = d.modo === 'real' ? 'real' : d.modo === 'off' ? 'off' : 'demo';
        this.almacen.cambiar(e => { const r = e.integraciones[a.id] ??= { modo }; r.opciones = { ...r.opciones, demoChosen: modo === 'demo' || undefined }; });
        return this.changeMode(a, modo);
      }
      case 'refrescar': if (!a) throw new Error(t('integrations.unknownSource')); await this.pollOne(a); return a.estado();
      case 'olvidar': if (!a?.accion) throw new Error(t('integrations.unknownSource')); { await a.accion('olvidar', d); return this.changeMode(a, 'off'); }
      default: if (a?.accion) return a.accion(nombre, d); throw new Error(t('integrations.unknownAction', { nombre }));
    }
  }
}
