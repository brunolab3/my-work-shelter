// Scheduled messages: with schedule_message (MCP `rooms`, roomNotices.ts) a dweller leaves a message for later («let's
// review it on Monday and answer everything») and the game delivers it at that time. Without a room it comes back to the
// same conversation: the open one or, if it was closed, resumed by its Claude Code id in its folder (in plan mode), with
// all its context; with a room (and key), it is delivered like send_to_room. Saved in DATOS/mensajes-programados.json and
// checked every minute and on start: what fell due with the game closed is delivered on return, marked «late».
// What can't be delivered (the conversation is still open outside, the sessions limit) is retried on the next round,
// warning once. The text stays on the Mac: it never goes anywhere.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { t } from '../shared/language.ts';
import { checkWhen, describeWhen, due, isLate, ofConversation, MAX_PER_CONVERSATION, MAX_DAYS, type ScheduledMessage, type ScheduledTarget } from '../shared/scheduled.ts';
import type { SessionSummary } from '../shared/protocol.ts';
import { taskKey } from '../shared/tasks.ts';

const MAX_TOTAL = 300, MAX_TEXT = 20_000;
// el error de una fecha pedida (checkWhen), con las claves escritas enteras (shared/language.test.ts las busca)
type WhenVars = { cuando: string; dias: number };
const WHEN_ERROR: Record<'badDate' | 'past' | 'tooFar', (v: WhenVars) => string> = { badDate: v => t('tool.schedule.badDate', v), past: v => t('tool.schedule.past', v), tooFar: v => t('tool.schedule.tooFar', v) };
const whenError = (e: keyof typeof WHEN_ERROR, cuando: string) => WHEN_ERROR[e]({ cuando, dias: MAX_DAYS });

export interface CtxScheduled {
  sesion(id: string): SessionSummary | undefined;
  salas(): { id: string; nombre: string; habitante?: unknown }[];
  // la entrega: el id de la conversación que lo recibe (lanza un error si no se pudo: se reintenta)
  aConversacion(x: ScheduledMessage & { destino: Extract<ScheduledTarget, { tipo: 'conversacion' }> }, texto: string): Promise<string>;
  aSala(x: ScheduledMessage & { destino: Extract<ScheduledTarget, { tipo: 'sala' }> }, texto: string): Promise<{ ok: boolean; texto: string }>;
  cambiado(lista: ScheduledMessage[]): void;
  aviso(texto: string): void;
  ahora?(): number;
}

export interface ScheduleArgs { cuando: string; mensaje: string; sala?: string; clave?: string }

export class Scheduled {
  private items: ScheduledMessage[] = [];
  private archivo: string;
  private fallidos = new Set<string>();   // ya avisados de que no se pudo entregar (una vez por mensaje)
  private repasando = false;
  constructor(dir: string, private ctx: CtxScheduled) {
    this.archivo = path.join(dir, 'mensajes-programados.json');
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); if (Array.isArray(j?.items)) this.items = j.items.filter(valid); } } catch {}
  }
  private ahora() { return this.ctx.ahora?.() ?? Date.now(); }
  private guardar() {
    const tmp = this.archivo + '.tmp';
    writeFileSync(tmp, JSON.stringify({ items: this.items }), { mode: 0o600 }); renameSync(tmp, this.archivo);
    this.ctx.cambiado(this.lista());
  }
  lista() { return [...this.items].sort((a, b) => a.cuando - b.cuando); }
  deConversacion(sesionId?: string) { const s = sesionId ? this.ctx.sesion(sesionId) : undefined; return ofConversation(this.items, { id: sesionId, claudeId: s?.claudeId }); }

  /** schedule_message: `desde` es la sala que lo programa y `desdeSesion`, su conversación */
  programar(desde: string, desdeSesion: string | undefined, a: ScheduleArgs): { ok: boolean; texto: string } {
    const ahora = this.ahora();
    const mensaje = String(a.mensaje ?? '').trim();
    if (!mensaje) return { ok: false, texto: t('tool.rooms.empty') };
    if (mensaje.length > MAX_TEXT) return { ok: false, texto: t('tool.schedule.tooLong', { n: MAX_TEXT }) };
    const w = checkWhen(String(a.cuando ?? ''), ahora);
    if (!w.ok) return { ok: false, texto: whenError(w.error, String(a.cuando ?? '')) };
    const s = desdeSesion ? this.ctx.sesion(desdeSesion) : undefined;
    const origen = { salaId: desde, sesionId: desdeSesion, claudeId: s?.claudeId };
    if (ofConversation(this.items, { id: desdeSesion, claudeId: s?.claudeId }).length >= MAX_PER_CONVERSATION || this.items.length >= MAX_TOTAL)
      return { ok: false, texto: t('tool.schedule.limit', { n: MAX_PER_CONVERSATION }) };
    let destino: ScheduledTarget;
    if (a.sala?.trim()) {
      const q = a.sala.trim().toLowerCase(), salas = this.ctx.salas();
      const sala = salas.find(x => x.id.toLowerCase() === q) ?? salas.find(x => x.nombre.toLowerCase() === q);
      if (!sala) return { ok: false, texto: t('tool.rooms.noRoom', { sala: a.sala, salas: salas.map(x => `${x.id} (${x.nombre})`).join(', ') }) };
      if (!sala.habitante) return { ok: false, texto: t('tool.rooms.noDweller', { sala: sala.nombre }) };
      const clave = a.clave?.trim() ? taskKey(a.clave) : undefined;
      if (a.clave?.trim() && !clave) return { ok: false, texto: t('tool.rooms.badKey', { clave: a.clave ?? '' }) };
      destino = { tipo: 'sala', sala: sala.id, ...(clave ? { clave } : {}) };
    } else {
      if (!s) return { ok: false, texto: t('tool.schedule.noConversation') };
      destino = { tipo: 'conversacion', salaId: s.salaId, sesionId: s.id, claudeId: s.claudeId, cwd: path.resolve(s.worktree ?? s.cwd), titulo: s.titulo };
    }
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), creado: ahora, cuando: w.cuando, pedido: String(a.cuando), mensaje, origen, destino };
    this.items.push(x); this.guardar();
    const cuando = describeWhen(x.cuando);
    return { ok: true, texto: t(destino.tipo === 'sala' ? 'tool.schedule.doneRoom' : 'tool.schedule.done', { cuando, id: x.id, sala: a.sala ?? '' }) + (w.aplazado ? ' ' + t('tool.schedule.heldWeekend') : '') };
  }

  /** Quitar uno: el Supervisor cualquiera; un habitante (`desdeSesion`), solo los de su conversación */
  cancelar(id: string, desdeSesion?: string): boolean {
    const mios = desdeSesion !== undefined ? new Set(this.deConversacion(desdeSesion).map(x => x.id)) : undefined;
    const i = this.items.findIndex(x => x.id === id && (!mios || mios.has(x.id)));
    if (i < 0) return false;
    this.items.splice(i, 1); this.fallidos.delete(id); this.guardar();
    return true;
  }

  /** El Supervisor cambia la hora o el texto (✎ en el intercomunicador) */
  editar(id: string, c: { cuando?: string; mensaje?: string }): ScheduledMessage {
    const x = this.items.find(y => y.id === id);
    if (!x) throw new Error(t('server.scheduledGone'));
    if (c.cuando !== undefined) {
      const w = checkWhen(String(c.cuando), this.ahora());
      if (!w.ok) throw new Error(whenError(w.error, String(c.cuando)));
      x.cuando = w.cuando; x.pedido = String(c.cuando);
    }
    if (c.mensaje !== undefined) { const m = String(c.mensaje).trim(); if (!m) throw new Error(t('tool.rooms.empty')); x.mensaje = m.slice(0, MAX_TEXT); }
    this.fallidos.delete(id); this.guardar();
    return x;
  }

  /** El mensaje que recibe el habitante: cuándo se programó (y si llega tarde) y el texto */
  texto(x: ScheduledMessage, ahora = this.ahora()) {
    return [t('prompt.scheduled.title', { creado: describeWhen(x.creado) }) + (isLate(x, ahora) ? ' ' + t('prompt.scheduled.late', { cuando: describeWhen(x.cuando) }) : ''), '', x.mensaje].join('\n');
  }

  /** Cada minuto y al arrancar: entrega lo vencido */
  async repasar() {
    if (this.repasando) return;
    this.repasando = true;
    try {
      for (const x of due(this.items, this.ahora())) {
        if (!this.items.includes(x)) continue;   // cancelado mientras se entregaba otro
        let error: string | undefined;
        try {
          if (x.destino.tipo === 'sala') { const r = await this.ctx.aSala(x as any, this.texto(x)); if (!r.ok) error = r.texto; }
          else await this.ctx.aConversacion(x as any, this.texto(x));
        } catch (e) { error = (e as Error).message; }
        if (error) {
          if (!this.fallidos.has(x.id)) { this.fallidos.add(x.id); this.ctx.aviso(t('server.scheduledRetry', { resumen: summary(x.mensaje), error: error.split('\n')[0].slice(0, 160) })); }
          continue;
        }
        this.items = this.items.filter(y => y !== x); this.fallidos.delete(x.id); this.guardar();
      }
    } finally { this.repasando = false; }
  }
}

export const summary = (s: string) => { const r = s.trim().replace(/\s+/g, ' '); return r.length > 90 ? r.slice(0, 89) + '…' : r; };

function valid(x: any): x is ScheduledMessage {
  return x && typeof x.id === 'string' && Number.isFinite(x.cuando) && typeof x.mensaje === 'string' && x.origen && typeof x.origen.salaId === 'string'
    && x.destino && (x.destino.tipo === 'sala' ? typeof x.destino.sala === 'string' : x.destino.tipo === 'conversacion' && typeof x.destino.salaId === 'string' && typeof x.destino.cwd === 'string');
}
