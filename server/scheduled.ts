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
import { checkWhen, describeWhen, due, holdWeekend, isLate, ofConversation, MAX_PER_CONVERSATION, MAX_DAYS, type ScheduledMessage, type ScheduledTarget } from '../shared/scheduled.ts';
import type { SessionSummary } from '../shared/protocol.ts';
import { taskKey } from '../shared/tasks.ts';

const MAX_TOTAL = 300, MAX_TEXT = 20_000;
// el error de una fecha pedida (checkWhen), con las claves escritas enteras (shared/language.test.ts las busca)
type WhenVars = { when: string; days: number };
const WHEN_ERROR: Record<'badDate' | 'past' | 'tooFar', (v: WhenVars) => string> = { badDate: v => t('tool.schedule.badDate', v), past: v => t('tool.schedule.past', v), tooFar: v => t('tool.schedule.tooFar', v) };
const whenError = (e: keyof typeof WHEN_ERROR, when: string) => WHEN_ERROR[e]({ when, days: MAX_DAYS });

export interface CtxScheduled {
  session(id: string): SessionSummary | undefined;
  rooms(): { id: string; name: string; dweller?: unknown }[];
  // la entrega: el id de la conversación que lo recibe (lanza un error si no se pudo: se reintenta)
  toConversation(x: ScheduledMessage & { target: Extract<ScheduledTarget, { type: 'conversacion' }> }, text: string): Promise<string>;
  // `limited`: still over send_to_room's per-minute limit, retried on the next round without a warning
  toRoom(x: ScheduledMessage & { target: Extract<ScheduledTarget, { type: 'sala' }> }, text: string): Promise<{ ok: boolean; text: string; limited?: boolean }>;
  // a sweep at that time (an over-limit message is due within the minute)
  wake?(at: number): void;
  changed(list: ScheduledMessage[]): void;
  notice(text: string): void;
  now?(): number;
}

export interface ScheduleArgs { when: string; message: string; room?: string; key?: string }

export class Scheduled {
  private items: ScheduledMessage[] = [];
  private file: string;
  private failed = new Set<string>();   // ya avisados de que no se pudo entregar (una vez por mensaje)
  private sweeping = false;
  constructor(dir: string, private ctx: CtxScheduled) {
    this.file = path.join(dir, 'mensajes-programados.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); if (Array.isArray(j?.items)) this.items = j.items.filter(valid); } } catch {}
  }
  private now() { return this.ctx.now?.() ?? Date.now(); }
  private save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ items: this.items }), { mode: 0o600 }); renameSync(tmp, this.file);
    this.ctx.changed(this.list());
  }
  list() { return [...this.items].sort((a, b) => a.when - b.when); }
  ofConversation(sessionId?: string) { const s = sessionId ? this.ctx.session(sessionId) : undefined; return ofConversation(this.items, { id: sessionId, claudeId: s?.claudeId }); }

  /** schedule_message: `desde` es la sala que lo programa y `fromSession`, su conversación */
  schedule(since: string, fromSession: string | undefined, a: ScheduleArgs): { ok: boolean; text: string } {
    const now = this.now();
    const message = String(a.message ?? '').trim();
    if (!message) return { ok: false, text: t('tool.rooms.empty') };
    if (message.length > MAX_TEXT) return { ok: false, text: t('tool.schedule.tooLong', { n: MAX_TEXT }) };
    const w = checkWhen(String(a.when ?? ''), now);
    if (!w.ok) return { ok: false, text: whenError(w.error, String(a.when ?? '')) };
    const s = fromSession ? this.ctx.session(fromSession) : undefined;
    const origin = { roomId: since, sessionId: fromSession, claudeId: s?.claudeId };
    if (ofConversation(this.items, { id: fromSession, claudeId: s?.claudeId }).length >= MAX_PER_CONVERSATION || this.items.length >= MAX_TOTAL)
      return { ok: false, text: t('tool.schedule.limit', { n: MAX_PER_CONVERSATION }) };
    let target: ScheduledTarget;
    if (a.room?.trim()) {
      const q = a.room.trim().toLowerCase(), rooms = this.ctx.rooms();
      const room = rooms.find(x => x.id.toLowerCase() === q) ?? rooms.find(x => x.name.toLowerCase() === q);
      if (!room) return { ok: false, text: t('tool.rooms.noRoom', { sala: a.room, salas: rooms.map(x => `${x.id} (${x.name})`).join(', ') }) };
      if (!room.dweller) return { ok: false, text: t('tool.rooms.noDweller', { sala: room.name }) };
      const key = a.key?.trim() ? taskKey(a.key) : undefined;
      if (a.key?.trim() && !key) return { ok: false, text: t('tool.rooms.badKey', { clave: a.key ?? '' }) };
      target = { type: 'sala', room: room.id, ...(key ? { key } : {}) };
    } else {
      if (!s) return { ok: false, text: t('tool.schedule.noConversation') };
      target = { type: 'conversacion', roomId: s.roomId, sessionId: s.id, claudeId: s.claudeId, cwd: path.resolve(s.worktree ?? s.cwd), title: s.title };
    }
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when: w.when, requested: String(a.when), message, origin, target };
    this.items.push(x); this.save();
    const when = describeWhen(x.when);
    return { ok: true, text: t(target.type === 'sala' ? 'tool.schedule.doneRoom' : 'tool.schedule.done', { cuando: when, id: x.id, sala: a.room ?? '' }) + (w.postponed ? ' ' + t('tool.schedule.heldWeekend') : '') };
  }

  /** One the game itself schedules for a conversation (a production verification recheck, verifications.ts): no date to
   *  parse and no per-conversation limit, weekends held to Monday; shown in that conversation's ⏰ list. Its id, or none
   *  when the list is full */
  scheduleGame(c: { roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }, when: number, message: string): string | undefined {
    if (this.items.length >= MAX_TOTAL) return undefined;
    const now = this.now(), w = holdWeekend(Math.max(when, now));
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when: w, requested: new Date(w).toISOString(), message: message.slice(0, MAX_TEXT),
      origin: { roomId: c.roomId, sessionId: c.sessionId, claudeId: c.claudeId }, target: { type: 'conversacion', ...c } };
    this.items.push(x); this.save();
    return x.id;
  }
  /** A send_to_room over its per-minute limit (roomNotices.ts): the same room, key or thread and text, delivered at
   *  `when` with no weekend hold. Counts towards the conversation's list; none when it is full */
  defer(since: string, fromSession: string | undefined, a: { room: string; key?: string; thread?: string; message: string }, when: number): ScheduledMessage | undefined {
    const s = fromSession ? this.ctx.session(fromSession) : undefined;
    if (ofConversation(this.items, { id: fromSession, claudeId: s?.claudeId }).length >= MAX_PER_CONVERSATION || this.items.length >= MAX_TOTAL) return undefined;
    const now = this.now();
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when, requested: new Date(when).toISOString(), message: a.message.slice(0, MAX_TEXT),
      origin: { roomId: since, sessionId: fromSession, claudeId: s?.claudeId }, target: { type: 'sala', room: a.room, ...(a.key ? { key: a.key } : {}), ...(a.thread ? { thread: a.thread } : {}) }, overLimit: true };
    this.items.push(x); this.save(); this.ctx.wake?.(when);
    return x;
  }
  /** When the pending over-limit messages from one room to another go out */
  overLimit(since: string, roomId: string) { return this.items.filter(x => x.overLimit && x.origin.roomId === since && x.target.type === 'sala' && x.target.room === roomId).map(x => x.when); }
  pending(id: string) { return this.items.some(x => x.id === id); }

  /** Quitar uno: el Supervisor cualquiera; un habitante (`desdeSesion`), solo los de su conversación */
  cancel(id: string, fromSession?: string): boolean {
    const mine = fromSession !== undefined ? new Set(this.ofConversation(fromSession).map(x => x.id)) : undefined;
    const i = this.items.findIndex(x => x.id === id && (!mine || mine.has(x.id)));
    if (i < 0) return false;
    this.items.splice(i, 1); this.failed.delete(id); this.save();
    return true;
  }

  /** El Supervisor cambia la hora o el texto (✎ en el intercomunicador) */
  edit(id: string, c: { when?: string; message?: string }): ScheduledMessage {
    const x = this.items.find(y => y.id === id);
    if (!x) throw new Error(t('server.scheduledGone'));
    if (c.when !== undefined) {
      const w = checkWhen(String(c.when), this.now());
      if (!w.ok) throw new Error(whenError(w.error, String(c.when)));
      x.when = w.when; x.requested = String(c.when);
    }
    if (c.message !== undefined) { const m = String(c.message).trim(); if (!m) throw new Error(t('tool.rooms.empty')); x.message = m.slice(0, MAX_TEXT); }
    this.failed.delete(id); this.save();
    return x;
  }

  /** El mensaje que recibe el habitante: cuándo se programó (y si llega tarde) y el texto */
  text(x: ScheduledMessage, now = this.now()) {
    if (x.overLimit) return x.message;
    return [t('prompt.scheduled.title', { creado: describeWhen(x.created) }) + (isLate(x, now) ? ' ' + t('prompt.scheduled.late', { cuando: describeWhen(x.when) }) : ''), '', x.message].join('\n');
  }

  /** Cada minuto y al arrancar: entrega lo vencido */
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    // over-limit messages go out in order: one that couldn't holds the next ones to the same room
    const held = new Set<string>();
    try {
      for (const x of due(this.items, this.now())) {
        if (!this.items.includes(x)) continue;   // cancelado mientras se entregaba otro
        const pair = x.overLimit && x.target.type === 'sala' ? `${x.origin.roomId}>${x.target.room}` : undefined;
        if (pair && held.has(pair)) continue;
        let error: string | undefined;
        try {
          if (x.target.type === 'sala') {
            const r = await this.ctx.toRoom(x as any, this.text(x));
            if (!r.ok && pair) held.add(pair);
            if (!r.ok && r.limited) continue;
            if (!r.ok) error = r.text;
          }
          else await this.ctx.toConversation(x as any, this.text(x));
        } catch (e) { error = (e as Error).message; }
        if (error) {
          if (!this.failed.has(x.id)) { this.failed.add(x.id); this.ctx.notice(t('server.scheduledRetry', { resumen: summary(x.message), error: error.split('\n')[0].slice(0, 160) })); }
          continue;
        }
        this.items = this.items.filter(y => y !== x); this.failed.delete(x.id); this.save();
      }
    } finally { this.sweeping = false; }
  }
}

export const summary = (s: string) => { const r = s.trim().replace(/\s+/g, ' '); return r.length > 90 ? r.slice(0, 89) + '…' : r; };

function valid(x: any): x is ScheduledMessage {
  return x && typeof x.id === 'string' && Number.isFinite(x.when) && typeof x.message === 'string' && x.origin && typeof x.origin.roomId === 'string'
    && x.target && (x.target.type === 'sala' ? typeof x.target.room === 'string' : x.target.type === 'conversacion' && typeof x.target.roomId === 'string' && typeof x.target.cwd === 'string');
}
