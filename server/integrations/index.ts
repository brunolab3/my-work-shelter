// Integraciones (Microsoft 365, Google, Discord, Slack, GitHub, Linear): tres estados por fuente (demo, configurada, error).
// El modo demo pasa por el mismo camino que el real: un adaptador que produce notificaciones y eventos normalizados.
import type { WebSocket } from 'ws';
import type { Store } from '../state.ts';
import type { ServerMessage } from '../../shared/protocol.ts';
import { createAdapters, type Adapter, type Notice, type Notification, type CalendarEvent, type SourceState } from './adapters.ts';
import { groupNotices, type Conversation } from './normalize.ts';
import { t } from '../../shared/language.ts';

export class Integrations {
  private adapters: Adapter[];
  private messages: Notification[] = [];   // tal como llegan, uno por mensaje
  notifications: Conversation[] = [];      // lo que se difunde: una por conversación
  private lastBroadcast = '';
  events: CalendarEvent[] = [];
  private clocks: NodeJS.Timeout[] = [];
  constructor(private store: Store, private broadcast: (m: ServerMessage) => void) { this.adapters = createAdapters(store, (id, notice) => this.onNotify(id, notice)); }

  // Avisos de los conectores reales: difundir su estado, sondear ya (Discord en tiempo real) o pasar a real (OAuth hecho)
  private onNotify(id: Adapter['id'], notice: Notice) {
    const a = this.adapters.find(x => x.id === id); if (!a) return;
    if (notice === 'state') this.broadcast({ t: 'integration', id, state: a.state() });
    else if (notice === 'poll') this.pollOne(a);
    else if (notice === 'activate') this.changeMode(a, 'real').catch(() => {});
  }

  states(): Record<string, SourceState> { return Object.fromEntries(this.adapters.map(a => [a.id, a.state()])); }

  greet(ws: WebSocket, send: (ws: WebSocket, m: ServerMessage) => void) {
    send(ws, { t: 'notifications', list: this.notifications });
    send(ws, { t: 'events', list: this.events });
    for (const [id, state] of Object.entries(this.states())) send(ws, { t: 'integration', id, state });
  }

  private async pollOne(a: Adapter) {
    try {
      const r = await a.poll();
      if (r.complete || r.notifications?.length) this.receive(a.id, r.notifications ?? [], !!r.complete);
      if (r.read?.length) this.read(a.id, r.read);
      if (r.events) { this.events = [...this.events.filter(e => e.source !== a.id), ...r.events].sort((x, y) => x.start - y.start); this.broadcast({ t: 'events', list: this.events }); }
    } catch (e) { a.error = (e as Error).message; }
    this.broadcast({ t: 'integration', id: a.id, state: a.state() });
  }

  start() {
    for (const a of this.adapters) {
      this.pollOne(a);
      this.clocks.push(setInterval(() => this.pollOne(a), a.intervalMs));
    }
  }

  // Cambio de modo (demo ⇄ real): se vacía lo de esa fuente y se sondea de nuevo por el mismo camino
  private async changeMode(a: Adapter, mode: 'off' | 'demo' | 'real') {
    this.store.change(e => { e.integrations[a.id] = { ...(e.integrations[a.id] ?? {}), mode }; });
    a.restart();
    this.messages = this.messages.filter(n => n.source !== a.id); this.events = this.events.filter(n => n.source !== a.id);
    this.publish(); this.broadcast({ t: 'events', list: this.events });
    await this.pollOne(a);
    return a.state();
  }
  stop() { for (const r of this.clocks) clearInterval(r); this.clocks = []; for (const a of this.adapters) a.stop?.(); }

  // completas: lo de esa fuente se sustituye entero (lo leído allí desaparece); si no, se añade lo que no estaba
  private receive(source: Adapter['id'], ns: Notification[], complete: boolean) {
    const views = new Set(this.store.state.viewsNotifications);
    const withView = (n: Notification) => ({ ...n, view: views.has(n.id) });
    if (complete) this.messages = [...this.messages.filter(n => n.source !== source), ...ns.map(withView)];
    else { const already = new Set(this.messages.map(n => n.id)); this.messages.push(...ns.filter(n => !already.has(n.id)).map(withView)); }
    this.messages = this.messages.sort((a, b) => b.date - a.date).slice(0, 600);
    this.publish();
  }
  // Lo ya leído en la fuente (he contestado allí): esos mensajes pasan a vistos, como si se marcaran en el tablón
  private read(source: Adapter['id'], read: { thread: string; until: number }[]) {
    const ids = this.messages.filter(n => n.source === source && !n.view && read.some(l => l.thread === n.thread && n.date <= l.until)).map(n => n.id);
    if (!ids.length) return;
    this.store.change(e => { for (const id of ids) if (!e.viewsNotifications.includes(id)) e.viewsNotifications.push(id); e.viewsNotifications = e.viewsNotifications.slice(-3000); });
    for (const n of this.messages) if (ids.includes(n.id)) n.view = true;
    this.publish();
  }
  // Se difunde solo si cambia algo (las fuentes completas se sondean cada 5–60 s y casi siempre traen lo mismo)
  private publish() {
    const list = groupNotices(this.messages), json = JSON.stringify(list);
    if (json === this.lastBroadcast) return;
    this.lastBroadcast = json; this.notifications = list;
    this.broadcast({ t: 'notifications', list });
  }

  async action(name: string, d: Record<string, any>) {
    const a = this.adapters.find(x => x.id === d.source);
    switch (name) {
      case 'markSeen': {
        const ids: string[] = d.ids ?? [d.id];
        this.store.change(e => { for (const id of ids) if (!e.viewsNotifications.includes(id)) e.viewsNotifications.push(id); e.viewsNotifications = e.viewsNotifications.slice(-3000); });
        for (const n of this.messages) if (ids.includes(n.id)) n.view = true;
        this.publish(); return true;
      }
      case 'states': return this.states();
      case 'test': if (!a) throw new Error(t('integrations.unknownSource')); return a.attempt(d.fields ?? {});
      // Guardar: datos públicos al estado y secretos al llavero; si la prueba pasa, la fuente pasa a real (d.activar=false lo evita)
      case 'save': if (!a) throw new Error(t('integrations.unknownSource')); { const r = await a.configure(d.fields ?? {}); if (r.ok && d.activate !== false) await this.changeMode(a, 'real'); else this.broadcast({ t: 'integration', id: a.id, state: a.state() }); return r; }
      case 'mode': {
        if (!a) throw new Error(t('integrations.unknownSource'));
        const mode = d.mode === 'real' ? 'real' : d.mode === 'off' ? 'off' : 'demo';
        this.store.change(e => { const r = e.integrations[a.id] ??= { mode }; r.options = { ...r.options, demoChosen: mode === 'demo' || undefined }; });
        return this.changeMode(a, mode);
      }
      case 'refresh': if (!a) throw new Error(t('integrations.unknownSource')); await this.pollOne(a); return a.state();
      case 'forget': if (!a?.action) throw new Error(t('integrations.unknownSource')); { await a.action('forget', d); return this.changeMode(a, 'off'); }
      default: if (a?.action) return a.action(name, d); throw new Error(t('integrations.unknownAction', { name: name }));
    }
  }
}
