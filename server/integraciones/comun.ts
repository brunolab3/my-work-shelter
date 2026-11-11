// Piezas comunes de los conectores reales: campos de la cámara acorazada, configuración (públicos en el estado, secretos en el
// llavero), base del conector con sus tres estados y un `pedir` de red con errores claros en español.
import type { Store } from '../estado.ts';
import type { Adapter, SourceState, Aviso, Polling, SourceId } from './adaptadores.ts';
import { readSecret, saveSecret, eraseSecret } from './llavero.ts';
import { t } from '../../shared/idioma.ts';

export type { SourceId };

// Lo que la cámara acorazada pinta para cada fuente: qué pegar, si es secreto y una ayuda de dónde sacarlo
export interface Field { nombre: string; etiqueta: string; secreto?: boolean; opcional?: boolean; ayuda: string; ejemplo?: string }

export class ErrorSource extends Error {
  constructor(mensaje: string, public retryIn?: number, public codigo?: string) { super(mensaje); }
}
export const mensaje = (e: unknown) => e instanceof Error ? e.message : String(e);

export class ConfigSource {
  private cache = new Map<string, string | null>();
  constructor(private almacen: Store, readonly id: SourceId, readonly campos: Field[]) {}
  private get registro() { return this.almacen.estado.integraciones[this.id] ?? { modo: 'demo' as const }; }
  publicos(): Record<string, string> { return { ...(this.registro.campos ?? {}) }; }
  guardados(): string[] { return [...(this.registro.secrets ?? [])]; }
  tiene(nombre: string) { const c = this.campos.find(x => x.nombre === nombre); return c?.secreto || !c ? this.guardados().includes(nombre) : !!this.publicos()[nombre]; }
  // Listo para sondear: todos los obligatorios presentes (los secretos, según la marca de guardado)
  listo() { return this.campos.every(c => c.opcional || this.tiene(c.nombre)); }

  async secreto(nombre: string): Promise<string | null> {
    if (this.cache.has(nombre)) return this.cache.get(nombre)!;
    if (!this.guardados().includes(nombre)) return null;
    const v = await readSecret(`${this.id}.${nombre}`);
    this.cache.set(nombre, v); return v;
  }
  async setSecret(nombre: string, valor: string | null) {
    const cuenta = `${this.id}.${nombre}`;
    if (valor) await saveSecret(cuenta, valor); else await eraseSecret(cuenta);
    this.cache.set(nombre, valor || null);
    this.almacen.cambiar(e => {
      const r = e.integraciones[this.id] ??= { modo: 'demo' };
      const s = new Set(r.secrets ?? []); if (valor) s.add(nombre); else s.delete(nombre); r.secrets = [...s];
    });
  }
  // Mezcla lo que llega de la cámara acorazada con lo guardado: un secreto vacío significa «conservar el que hay»
  async combine(entrada: Record<string, string> = {}): Promise<Record<string, string>> {
    const v: Record<string, string> = {};
    for (const c of this.campos) {
      const nuevo = (entrada[c.nombre] ?? '').trim();
      v[c.nombre] = nuevo || (c.secreto ? (await this.secreto(c.nombre)) ?? '' : entrada[c.nombre] !== undefined ? '' : this.publicos()[c.nombre] ?? '');
    }
    return v;
  }
  faltan(v: Record<string, string>) { return this.campos.filter(c => !c.opcional && !v[c.nombre]).map(c => c.etiqueta); }
  async guardar(entrada: Record<string, string>) {
    const publicos = this.publicos();
    for (const c of this.campos) {
      if (!(c.nombre in entrada)) continue;
      const v = (entrada[c.nombre] ?? '').trim();
      if (c.secreto) { if (v) await this.setSecret(c.nombre, v); }
      else if (v) publicos[c.nombre] = v; else delete publicos[c.nombre];
    }
    this.almacen.cambiar(e => { (e.integraciones[this.id] ??= { modo: 'demo' }).campos = publicos; });
  }
  async olvidar() {
    for (const n of this.guardados()) await this.setSecret(n, null);
    this.cache.clear();
    this.almacen.cambiar(e => { const r = e.integraciones[this.id] ??= { modo: 'demo' }; r.campos = {}; r.secrets = []; r.modo = 'demo'; });
  }
  forgetCache() { this.cache.clear(); }
  descripcion() { return { campos: this.campos, valores: this.publicos(), guardados: this.guardados() }; }
}

// Base de un conector real: estado propio (conectada / error / sin-configurar), errores capturados con su motivo
export abstract class ConnectorBase implements Adapter {
  abstract id: SourceId;
  intervalMs = 60_000;
  error?: string;
  avisar?: (a: Aviso) => void;
  protected situation: { estado: 'conectada' | 'error' | 'sin-configurar'; detalle?: string } = { estado: 'sin-configurar' };
  protected ultima?: number;
  protected esperarHasta = 0;   // límite de peticiones: no se vuelve a pedir hasta entonces
  constructor(protected almacen: Store, readonly config: ConfigSource) {}

  protected abstract pollReal(): Promise<Polling>;
  protected abstract tryReal(v: Record<string, string>): Promise<{ ok: boolean; detalle: string }>;
  protected missingConfig() { return 'Falta configurar: ' + this.config.campos.filter(c => !c.opcional && !this.config.tiene(c.nombre)).map(c => c.etiqueta).join(', ') + '. Hazlo en la cámara acorazada.'; }
  protected listo() { return this.config.listo(); }

  estado(): SourceState { return { modo: 'real', estado: this.situation.estado, detalle: this.situation.detalle, ultima: this.ultima, campos: this.config.publicos() }; }
  protected bien(detalle?: string) { this.situation = { estado: 'conectada', detalle }; this.error = undefined; }
  protected mal(detalle: string) { this.situation = { estado: 'error', detalle }; this.error = detalle; }

  async sondear() {
    if (!this.listo()) { this.situation = { estado: 'sin-configurar', detalle: this.missingConfig() }; return {}; }
    if (Date.now() < this.esperarHasta) return {};
    try { const r = await this.pollReal(); this.ultima = Date.now(); return r; }
    catch (e) {
      if (e instanceof ErrorSource && e.retryIn) this.esperarHasta = Date.now() + e.retryIn;
      this.mal(mensaje(e)); throw e;
    }
  }
  async probar(entrada: Record<string, string>) {
    const v = await this.config.combine(entrada);
    const faltan = this.config.faltan(v);
    if (faltan.length) return { ok: false, detalle: 'Falta: ' + faltan.join(', ') + '.' };
    try { return await this.tryReal(v); } catch (e) { return { ok: false, detalle: mensaje(e) }; }
  }
  async configurar(entrada: Record<string, string>) {
    try { await this.config.guardar(entrada); } catch (e) { return { ok: false, detalle: mensaje(e) }; }
    this.reiniciar();
    const r = await this.probar({});
    if (r.ok) this.bien(r.detalle); else this.mal(r.detalle);
    return r;
  }
  reiniciar() { this.config.forgetCache(); this.esperarHasta = 0; this.situation = { estado: 'sin-configurar' }; this.error = undefined; this.onRestart(); }
  protected onRestart() {}
  parar() { this.onRestart(); }
  async accion(nombre: string, d: Record<string, any>): Promise<unknown> {
    if (nombre === 'campos') return this.config.descripcion();
    if (nombre === 'olvidar') { this.onRestart(); await this.config.olvidar(); this.reiniciar(); this.avisar?.('estado'); return this.estado(); }
    return this.ownAction(nombre, d);
  }
  protected async ownAction(nombre: string, _d: Record<string, any>): Promise<unknown> { throw new Error('Acción desconocida para ' + this.id + ': ' + nombre); }
}

// Petición HTTP con tiempo límite. No lanza por estado HTTP (lo interpreta quien llama); sí por red caída.
export interface Respuesta { estado: number; cabeceras: Headers; texto: string; json: any }
export async function ask(url: string, op: { servicio: string; metodo?: string; cabeceras?: Record<string, string>; cuerpo?: string; tiempo?: number }): Promise<Respuesta> {
  let r: Response;
  try { r = await fetch(url, { method: op.metodo ?? 'GET', headers: op.cabeceras, body: op.cuerpo, signal: AbortSignal.timeout(op.tiempo ?? 20_000), redirect: 'follow' }); }
  catch (e) {
    const causa = (e as any)?.name === 'TimeoutError' ? 'no respondió a tiempo' : ((e as any)?.cause?.code === 'ENOTFOUND' ? 'no se encuentra la dirección' : (e as any)?.cause?.code || mensaje(e));
    throw new ErrorSource(t('server.noConnectionToIsThe', { servicio: op.servicio, causa }), 60_000, 'red');
  }
  const texto = await r.text();
  let json: any; try { json = texto ? JSON.parse(texto) : undefined; } catch { json = undefined; }
  return { estado: r.status, cabeceras: r.headers, texto, json };
}
// Segundos de Retry-After (o un valor por defecto) en milisegundos
export const retraso = (r: Respuesta, porDefecto = 60) => Math.max(1, Number(r.cabeceras.get('retry-after')) || porDefecto) * 1000;
