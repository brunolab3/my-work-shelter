// Adaptadores de fuentes. Cada uno: estado (demo / configurada / error), sondeo, prueba de conexión y configuración.
// El modo demo produce datos simulados plausibles (en español, con los repos de ejemplo) por el MISMO camino que el real.
import type { Store } from '../state.ts';
import { demoNotifications, demoEvents, demoPanelLinear, demoBoardLinear, demoPanelJira } from './demo.ts';

export type Priority = 'baja' | 'media' | 'alta';
// Sources (order, names and what each brings) live in shared/sources.ts; their real connector, in CONNECTORS (export crear)
import { SOURCES, ACTIVE_SOURCES, CALENDAR_SOURCES, type SourceId } from '../../shared/sources.ts';
import { t } from '../../shared/language.ts';
export { SOURCES, CALENDAR_SOURCES, type SourceId };
export interface Notification {
  id: string; source: SourceId; channel?: string; author: string; title: string; snippet: string;
  date: number; priority: Priority; link?: string; view?: boolean; demo?: boolean;
  thread?: string;      // conversación a la que pertenece (canal de Discord o Slack, hilo de correo, issue de Linear, hilo de GitHub)
  unread?: number;   // lo que la fuente dice que queda sin leer en esa conversación (puede ser más de lo que se trae)
}
// Resultado de un sondeo. completas: las notificaciones son TODO lo pendiente de la fuente ahora mismo (lo que ya no
// viene se ha leído allí y se quita del tablón); sin ella, son mensajes nuevos que se añaden a lo que había.
// leidos: conversaciones que ya se han leído en la fuente (p. ej. he contestado en Discord) hasta esa fecha.
export interface Polling { notifications?: Notification[]; complete?: boolean; events?: CalendarEvent[]; read?: { thread: string; until: number }[] }
export interface CalendarEvent {
  id: string; source: SourceId; title: string; start: number; end: number; allDay: boolean;
  place?: string; videollamada?: string; link?: string; organizer?: string; demo?: boolean;
}
export interface SourceState {
  mode: 'off' | 'demo' | 'real'; state: 'demo' | 'conectada' | 'error' | 'sin-configurar'; detail?: string; last?: number; fields?: Record<string, string>;
}

// Avisos del conector real a las integraciones: 'estado' (difundir su estado), 'sondear' (hay datos nuevos ya, p. ej.
// un mensaje del Gateway de Discord) y 'activar' (se completó la conexión fuera de la cámara acorazada, p. ej. el OAuth de Microsoft o Google)
export type Notice = 'estado' | 'sondear' | 'activar';

export interface Adapter {
  id: SourceId;
  intervalMs: number;
  error?: string;
  notify?: (a: Notice) => void;
  state(): SourceState;
  poll(): Promise<Polling>;
  attempt(fields: Record<string, string>): Promise<{ ok: boolean; detail: string }>;
  configure(fields: Record<string, string>): Promise<{ ok: boolean; detail: string }>;
  restart(): void;
  stop?(): void;
  action?(name: string, d: Record<string, any>): Promise<unknown>;
}

// Real connector of each source. Explicit, not `./${id}.ts`: the persisted id need not match the file name
// (calendario → calendar.ts), and a renamed file breaks the type check instead of the running server.
export const CONNECTORS: Record<SourceId, () => Promise<{ create: (store: Store) => unknown }>> = {
  outlook: () => import('./outlook.ts'), google: () => import('./google.ts'), mail: () => import('./mail.ts'),
  calendario: () => import('./calendar.ts'), discord: () => import('./discord.ts'), slack: () => import('./slack.ts'),
  github: () => import('./github.ts'), linear: () => import('./linear.ts'), jira: () => import('./jira.ts'),
};

// Fábrica: si la fuente está en modo real y hay módulo real, se usa; si no, el demo (mismo contrato)
export function createAdapters(store: Store, notify?: (id: Adapter['id'], a: Notice) => void): Adapter[] {
  return ACTIVE_SOURCES.map(id => { const a = new SourceAdapter(id, store); if (notify) a.notify = x => notify(id, x); return a; });
}

class SourceAdapter implements Adapter {
  intervalMs: number; error?: string; notify?: (a: Notice) => void; private last?: number; private real: Adapter | null = null; private loading: Promise<void> | null = null;
  // Discord llega al momento por el Gateway (el sondeo solo recoge); el resto se sondea cada minuto
  constructor(public id: Adapter['id'], private store: Store) { this.intervalMs = id === 'discord' ? 15_000 : 60_000; }
  private get mode() { return this.store.state.integrations[this.id]?.mode ?? 'demo'; }
  private async withReal() {
    if (this.real) return this.real;
    if (!this.loading) this.loading = CONNECTORS[this.id]().then(m => { this.real = m.create(this.store) as Adapter; this.real.notify = a => this.notify?.(a); }).catch(e => { this.error = t('integrations.couldNotLoadConnector', { error: e.message }); });
    await this.loading; return this.real;
  }
  state(): SourceState {
    if (this.mode === 'demo') return { mode: 'demo', state: 'demo', detail: t('server.simulatedDataDemoSetIt'), last: this.last };
    if (this.mode === 'off') return { mode: 'off', state: 'sin-configurar', detail: t('server.sourceOffConnectIt') };
    if (this.real) { const e = this.real.state(); return { ...e, mode: 'real', last: e.last ?? this.last }; }
    return { mode: 'real', state: this.error ? 'error' : 'sin-configurar', detail: this.error, last: this.last };
  }
  async poll() {
    // apagada: no lee nada (ni toca el conector real); lo que hubiera de ella se vacía
    if (this.mode === 'off') return { notifications: [], events: CALENDAR_SOURCES.includes(this.id) ? [] : undefined, complete: true };
    this.last = Date.now();
    if (this.mode === 'demo') { this.error = undefined; return { notifications: demoNotifications(this.id), events: CALENDAR_SOURCES.includes(this.id) ? demoEvents(this.id) : undefined }; }
    const r = await this.withReal(); if (!r) throw new Error(this.error || t('integrations.connectorUnavailable'));
    return r.poll();
  }
  async attempt(c: Record<string, string>) { const r = await this.withReal(); if (!r) return { ok: false, detail: this.error || t('integrations.connectorUnavailable') }; return r.attempt(c); }
  async configure(c: Record<string, string>) { const r = await this.withReal(); if (!r) return { ok: false, detail: this.error || t('integrations.connectorUnavailable') }; return r.configure(c); }
  restart() { this.error = undefined; this.real?.restart(); }
  stop() { this.real?.stop?.(); }
  async action(n: string, d: Record<string, any>) { if (this.mode === 'demo' && this.id === 'linear' && n === 'panel') return demoPanelLinear(); if (this.mode === 'demo' && this.id === 'linear' && n === 'tablero') return demoBoardLinear(); if (this.mode === 'demo' && this.id === 'jira' && n === 'panel') return demoPanelJira(); if (this.mode === 'off' && (n === 'panel' || n === 'tablero')) throw new Error(t('server.sourceOffConnectIt')); const r = await this.withReal(); if (!r?.action) throw new Error(t('server.actionNotAvailable')); return r.action(n, d); }
}
