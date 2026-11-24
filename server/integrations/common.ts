// Piezas comunes de los conectores reales: campos de la cámara acorazada, configuración (públicos en el estado, secretos en el
// llavero), base del conector con sus tres estados y un `pedir` de red con errores claros en español.
import type { Store } from '../state.ts';
import type { Adapter, SourceState, Notice, Polling, SourceId } from './adapters.ts';
import { readSecret, saveSecret, eraseSecret } from './keychain.ts';
import { t, tIs } from '../../shared/language.ts';

export type { SourceId };

// Lo que la cámara acorazada pinta para cada fuente: qué pegar, si es secreto y una ayuda de dónde sacarlo
export interface Field { name: string; label: string; secret?: boolean; optional?: boolean; help: string; example?: string }

export class ErrorSource extends Error {
  constructor(message: string, public retryIn?: number, public code?: string) { super(message); }
}
export const message = (e: unknown) => e instanceof Error ? e.message : String(e);

export class ConfigSource {
  private cache = new Map<string, string | null>();
  constructor(private store: Store, readonly id: SourceId, readonly fields: Field[]) {}
  private get registry() { return this.store.state.integrations[this.id] ?? { mode: 'demo' as const }; }
  publicFields(): Record<string, string> { return { ...(this.registry.fields ?? {}) }; }
  saved(): string[] { return [...(this.registry.secrets ?? [])]; }
  has(name: string) { const c = this.fields.find(x => x.name === name); return c?.secret || !c ? this.saved().includes(name) : !!this.publicFields()[name]; }
  // Listo para sondear: todos los obligatorios presentes (los secretos, según la marca de guardado)
  ready() { return this.fields.every(c => c.optional || this.has(c.name)); }

  async secret(name: string): Promise<string | null> {
    if (this.cache.has(name)) return this.cache.get(name)!;
    if (!this.saved().includes(name)) return null;
    const v = await readSecret(`${this.id}.${name}`);
    this.cache.set(name, v); return v;
  }
  async setSecret(name: string, value: string | null) {
    const count = `${this.id}.${name}`;
    if (value) await saveSecret(count, value); else await eraseSecret(count);
    this.cache.set(name, value || null);
    this.store.change(e => {
      const r = e.integrations[this.id] ??= { mode: 'demo' };
      const s = new Set(r.secrets ?? []); if (value) s.add(name); else s.delete(name); r.secrets = [...s];
    });
  }
  // Mezcla lo que llega de la cámara acorazada con lo guardado: un secreto vacío significa «conservar el que hay»
  async combine(input: Record<string, string> = {}): Promise<Record<string, string>> {
    const v: Record<string, string> = {};
    for (const c of this.fields) {
      const newer = (input[c.name] ?? '').trim();
      v[c.name] = newer || (c.secret ? (await this.secret(c.name)) ?? '' : input[c.name] !== undefined ? '' : this.publicFields()[c.name] ?? '');
    }
    return v;
  }
  missing(v: Record<string, string>) { return this.fields.filter(c => !c.optional && !v[c.name]).map(c => tIs(c.label)); }
  async save(input: Record<string, string>) {
    const publicFields = this.publicFields();
    for (const c of this.fields) {
      if (!(c.name in input)) continue;
      const v = (input[c.name] ?? '').trim();
      if (c.secret) { if (v) await this.setSecret(c.name, v); }
      else if (v) publicFields[c.name] = v; else delete publicFields[c.name];
    }
    this.store.change(e => { (e.integrations[this.id] ??= { mode: 'demo' }).fields = publicFields; });
  }
  async forget() {
    for (const n of this.saved()) await this.setSecret(n, null);
    this.cache.clear();
    this.store.change(e => { const r = e.integrations[this.id] ??= { mode: 'demo' }; r.fields = {}; r.secrets = []; r.mode = 'off'; });
  }
  forgetCache() { this.cache.clear(); }
  // las etiquetas y ayudas son datos en español: salen en el idioma del juego al pedirlas
  description() { return { fields: this.fields.map(c => ({ ...c, label: tIs(c.label), help: tIs(c.help), ...(c.example ? { example: tIs(c.example) } : {}) })), values: this.publicFields(), saved: this.saved() }; }
}

// Base de un conector real: estado propio (conectada / error / sin-configurar), errores capturados con su motivo
export abstract class ConnectorBase implements Adapter {
  abstract id: SourceId;
  intervalMs = 60_000;
  error?: string;
  notify?: (a: Notice) => void;
  protected situation: { state: 'conectada' | 'error' | 'sin-configurar'; detail?: string } = { state: 'sin-configurar' };
  protected last?: number;
  protected waitUntil = 0;   // límite de peticiones: no se vuelve a pedir hasta entonces
  constructor(protected store: Store, readonly config: ConfigSource) {}

  protected abstract pollReal(): Promise<Polling>;
  protected abstract tryReal(v: Record<string, string>): Promise<{ ok: boolean; detail: string }>;
  protected missingConfig() { return t('integrations.missingConfig', { campos: this.config.fields.filter(c => !c.optional && !this.config.has(c.name)).map(c => tIs(c.label)).join(', ') }); }
  protected ready() { return this.config.ready(); }

  state(): SourceState { return { mode: 'real', state: this.situation.state, detail: this.situation.detail, last: this.last, fields: this.config.publicFields() }; }
  protected good(detail?: string) { this.situation = { state: 'conectada', detail }; this.error = undefined; }
  protected fail(detail: string) { this.situation = { state: 'error', detail }; this.error = detail; }

  async poll() {
    if (!this.ready()) { this.situation = { state: 'sin-configurar', detail: this.missingConfig() }; return {}; }
    if (Date.now() < this.waitUntil) return {};
    try { const r = await this.pollReal(); this.last = Date.now(); return r; }
    catch (e) {
      if (e instanceof ErrorSource && e.retryIn) this.waitUntil = Date.now() + e.retryIn;
      this.fail(message(e)); throw e;
    }
  }
  async attempt(input: Record<string, string>) {
    const v = await this.config.combine(input);
    const missing = this.config.missing(v);
    if (missing.length) return { ok: false, detail: t('integrations.missing', { campos: missing.join(', ') }) };
    try { return await this.tryReal(v); } catch (e) { return { ok: false, detail: message(e) }; }
  }
  async configure(input: Record<string, string>) {
    try { await this.config.save(input); } catch (e) { return { ok: false, detail: message(e) }; }
    this.restart();
    const r = await this.attempt({});
    if (r.ok) this.good(r.detail); else this.fail(r.detail);
    return r;
  }
  restart() { this.config.forgetCache(); this.waitUntil = 0; this.situation = { state: 'sin-configurar' }; this.error = undefined; this.onRestart(); }
  protected onRestart() {}
  stop() { this.onRestart(); }
  async action(name: string, d: Record<string, any>): Promise<unknown> {
    if (name === 'fields') return this.config.description();
    if (name === 'forget') { this.onRestart(); await this.config.forget(); this.restart(); this.notify?.('estado'); return this.state(); }
    return this.ownAction(name, d);
  }
  protected async ownAction(name: string, _d: Record<string, any>): Promise<unknown> { throw new Error(t('integrations.unknownActionFor', { id: this.id, nombre: name })); }
}

// Petición HTTP con tiempo límite. No lanza por estado HTTP (lo interpreta quien llama); sí por red caída.
export interface HttpResponse { state: number; headers: Headers; text: string; json: any }
export async function ask(url: string, op: { service: string; method?: string; headers?: Record<string, string>; body?: string; timeout?: number }): Promise<HttpResponse> {
  let r: Response;
  try { r = await fetch(url, { method: op.method ?? 'GET', headers: op.headers, body: op.body, signal: AbortSignal.timeout(op.timeout ?? 20_000), redirect: 'follow' }); }
  catch (e) {
    const cause = (e as any)?.name === 'TimeoutError' ? t('integrations.didNotRespondInTime') : ((e as any)?.cause?.code === 'ENOTFOUND' ? t('integrations.addressNotFound') : (e as any)?.cause?.code || message(e));
    throw new ErrorSource(t('server.noConnectionToIsThe', { servicio: op.service, causa: cause }), 60_000, 'red');
  }
  const text = await r.text();
  let json: any; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { state: r.status, headers: r.headers, text, json };
}
// Segundos de Retry-After (o un valor por defecto) en milisegundos
export const delay = (r: HttpResponse, fallback = 60) => Math.max(1, Number(r.headers.get('retry-after')) || fallback) * 1000;
