// Scheduled messages: with schedule_message (MCP `rooms`, roomNotices.ts) a dweller leaves a message for later («let's
// review it on Monday and answer everything») and the game delivers it at that time. Without a room it comes back to the
// same conversation: the open one or, if it was closed, resumed by its Claude Code id in its folder (in plan mode), with
// all its context; with a room (and key), it is delivered like send_to_room. Saved in DATOS/mensajes-programados.json and
// checked every minute and on start: what fell due with the game closed is delivered on return, marked «late».
// What can't be delivered (the conversation is still open outside, the sessions limit) is retried on the next round,
// warning once. "Not urgent" ones (`when: "next-window"`, the intercom's ⌥Enter) wait for the plan's final 5-hour
// usage window of the day and go out one at a time, a few minutes apart (`windowNext` in shared/scheduled.ts).
// The game's CI failures and reviews of a PR pack into one message per PR and conversation (`pack`), released together
// once its checks finish; a room's messages from one conversation to one place pack the same way while they wait
// (`joinMessage`). The text stays on the Mac: it never goes anywhere.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { t } from '../shared/language.ts';
import { checkWhen, describeWhen, due, forTarget, holdWeekend, isLate, finalWindowStart, mergePart, messagesText, ofConversation, packText, sameSender, turnDue, windowNext, MAX_PER_CONVERSATION, MAX_DAYS, NEXT_WINDOW, AFTER_TURN, type PackPart, type ScheduledMessage, type ScheduledTarget, type UsageWindow } from '../shared/scheduled.ts';
import type { MessageOrigin, SessionSummary } from '../shared/protocol.ts';
import { taskKey } from '../shared/tasks.ts';

const MAX_TOTAL = 300, MAX_TEXT = 20_000;
// el error de una fecha pedida (checkWhen), con las claves escritas enteras (shared/language.test.ts las busca)
type WhenVars = { when: string; days: number };
const WHEN_ERROR: Record<'badDate' | 'past' | 'tooFar', (v: WhenVars) => string> = { badDate: v => t('tool.schedule.badDate', v), past: v => t('tool.schedule.past', v), tooFar: v => t('tool.schedule.tooFar', v) };
const whenError = (e: keyof typeof WHEN_ERROR, when: string) => WHEN_ERROR[e]({ when, days: MAX_DAYS });

export interface CtxScheduled {
  session(id: string): SessionSummary | undefined;
  rooms(): { id: string; name: string; dweller?: unknown }[];
  // a conversation is busy (a turn running, waiting for the Overseer): by game id or, closed, by Claude Code id
  busy?(target: { sessionId?: string; claudeId?: string }): boolean;
  // la entrega: el id de la conversación que lo recibe (lanza un error si no se pudo: se reintenta)
  toConversation(x: ScheduledMessage & { target: Extract<ScheduledTarget, { type: 'conversacion' }> }, text: string): Promise<string>;
  // `limited`: still over send_to_room's per-minute limit, retried on the next round without a warning
  // `permanent`: no later try can deliver it (the sender is the receiving conversation): dropped with a notice
  toRoom(x: ScheduledMessage & { target: Extract<ScheduledTarget, { type: 'sala' }> }, text: string): Promise<{ ok: boolean; text: string; limited?: boolean; permanent?: boolean }>;
  // a sweep at that time (an over-limit message is due within the minute)
  wake?(at: number): void;
  changed(list: ScheduledMessage[]): void;
  notice(text: string): void;
  now?(): number;
  usage?(): UsageWindow;   // the plan's 5-hour window, as the sessions last reported it (none: unknown)
  settled?(prUrl: string): boolean;   // no check of that PR still running (unknown: settled)
}

export interface ScheduleArgs { when: string; message: string; room?: string; key?: string }

export class Scheduled {
  private items: ScheduledMessage[] = [];
  private file: string;
  private failed = new Set<string>();   // ya avisados de que no se pudo entregar (una vez por mensaje)
  private sweeping = false;
  private again = false;   // a sweep asked for while one ran (a turn ended): one more after it
  private lastWindow: number | undefined;   // the last next-window delivery (or attempt): the next one is spaced from it
  private delivering = new Set<string>();   // being delivered: nothing joins them any more
  constructor(dir: string, private ctx: CtxScheduled) {
    this.file = path.join(dir, 'mensajes-programados.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); if (Array.isArray(j?.items)) this.items = j.items.filter(valid); } } catch {}
  }
  private now() { return this.ctx.now?.() ?? Date.now(); }
  private usage() { return this.ctx.usage?.() ?? {}; }
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
    const next = isNextWindow(a.when);
    const w = next ? { ok: true as const, when: finalWindowStart(now, this.usage()), postponed: false } : checkWhen(String(a.when ?? ''), now);
    if (!w.ok) return { ok: false, text: whenError(w.error, String(a.when ?? '')) };
    const s = fromSession ? this.ctx.session(fromSession) : undefined;
    const origin = { roomId: since, sessionId: fromSession, claudeId: s?.claudeId };
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
    // to a room, at the same time as one of its own still pending for that place: joins it
    const d = target.type === 'sala' ? target : undefined;
    const into = d && this.joinable(y => !y.overLimit && !y.afterTurn && sameSala(y.target, d) && sameSender(y.origin, origin) && !!y.nextWindow === next && (next || y.when === w.when));
    if (into) { this.joinMessage(into, message); return { ok: true, text: t('tool.schedule.doneRoom', { cuando: describeWhen(into.when), id: into.id, sala: a.room ?? '' }) + ' ' + t('tool.rooms.packed', { id: into.id }) }; }
    if (ofConversation(this.items, { id: fromSession, claudeId: s?.claudeId }).length >= MAX_PER_CONVERSATION || this.items.length >= MAX_TOTAL)
      return { ok: false, text: t('tool.schedule.limit', { n: MAX_PER_CONVERSATION }) };
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when: w.when, requested: String(a.when), message, origin, target, ...(next ? { nextWindow: true as const } : {}),
      ...(d ? { messages: this.messagesOf(since, message) } : {}) };
    this.items.push(x); this.save();
    const when = describeWhen(x.when);
    if (next) return { ok: true, text: t(target.type === 'sala' ? 'tool.schedule.doneWindowRoom' : 'tool.schedule.doneWindow', { cuando: when, id: x.id, sala: a.room ?? '' }) };
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
   *  `when` with no weekend hold. Counts towards the conversation's list; none when it is full. One of the same sender's
   *  still waiting for that place takes it instead (`joinMessage`), and goes at its own time */
  defer(since: string, fromSession: string | undefined, a: { room: string; key?: string; thread?: string; message: string }, when: number): ScheduledMessage | undefined {
    const s = fromSession ? this.ctx.session(fromSession) : undefined;
    const target: ScheduledTarget = { type: 'sala', room: a.room, ...(a.key ? { key: a.key } : {}), ...(a.thread ? { thread: a.thread } : {}) };
    const origin = { roomId: since, sessionId: fromSession, claudeId: s?.claudeId };
    const into = this.joinable(y => !!y.overLimit && sameSala(y.target, target) && sameSender(y.origin, origin));
    if (into) return this.joinMessage(into, a.message);
    if (ofConversation(this.items, { id: fromSession, claudeId: s?.claudeId }).length >= MAX_PER_CONVERSATION || this.items.length >= MAX_TOTAL) return undefined;
    const now = this.now();
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when, requested: new Date(when).toISOString(), message: a.message.slice(0, MAX_TEXT),
      origin, target, overLimit: true, messages: this.messagesOf(since, a.message) };
    this.items.push(x); this.save(); this.ctx.wake?.(when);
    return x;
  }
  /** When the pending over-limit messages from one room to another go out */
  overLimit(since: string, roomId: string) { return this.items.filter(x => x.overLimit && x.origin.roomId === since && x.target.type === 'sala' && x.target.room === roomId).map(x => x.when); }
  pending(id: string) { return this.items.some(x => x.id === id); }

  /** The Overseer's composer in the intercom (⌥Enter, ⏳ or ⏰ Schedule): to a conversation (an open one, one to resume,
   *  or a new one in `cwd`), at a dated time (checked like schedule_message's, with its per-conversation limit) or, by
   *  default, as background work for the day's final 5-hour window (only the total limit) */
  scheduleOverseer(c: { roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }, message: string, requested: string = NEXT_WINDOW): ScheduledMessage {
    const m = message.trim();
    if (!m) throw new Error(t('tool.rooms.empty'));
    if (this.items.length >= MAX_TOTAL) throw new Error(t('server.scheduledFull', { n: MAX_TOTAL }));
    if (isAfterTurn(requested)) {
      if (!c.sessionId) throw new Error(t('server.scheduledAfterTurnNoConversation'));
      return this.hold(c, m, { kind: 'overseer' }, { roomId: c.roomId, sessionId: c.sessionId, claudeId: c.claudeId });
    }
    const now = this.now(), next = isNextWindow(requested);
    const w = next ? { ok: true as const, when: finalWindowStart(now, this.usage()) } : checkWhen(requested, now);
    if (!w.ok) throw new Error(whenError(w.error, requested));
    if (!next && (c.sessionId || c.claudeId) && ofConversation(this.items, { id: c.sessionId, claudeId: c.claudeId }).length >= MAX_PER_CONVERSATION)
      throw new Error(t('tool.schedule.limit', { n: MAX_PER_CONVERSATION }));
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when: w.when, requested: next ? NEXT_WINDOW : requested, message: m.slice(0, MAX_TEXT),
      origin: { roomId: c.roomId, sessionId: c.sessionId, claudeId: c.claudeId }, target: { type: 'conversacion', ...c }, ...(next ? { nextWindow: true as const } : {}), overseer: true };
    this.items.push(x); this.save();
    return x;
  }

  /** A message to a busy conversation (ctxPlan.notify, server/main.ts) or the Overseer's «When it finishes»: held until
   *  its turn ends, then delivered verbatim from `from` as a turn of its own. `origin`: who wrote it (the sending room
   *  and conversation, whose ⏰ list shows it too); the receiver's room for the game's own notices. No per-conversation
   *  limit: the game never drops a message for that. Another room's, while one of the same sender's waits for that
   *  conversation, joins it (`joinMessage`) */
  hold(c: { roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }, message: string, from: MessageOrigin, origin: ScheduledMessage['origin']): ScheduledMessage {
    const now = this.now();
    if (from.kind === 'room') {
      const into = this.joinable(y => !!y.afterTurn && y.from?.kind === 'room' && forTarget(y, { id: c.sessionId, claudeId: c.claudeId }) && sameSender(y.origin, origin));
      if (into) return this.joinMessage(into, message);
    }
    const x: ScheduledMessage = { id: randomUUID().slice(0, 8), created: now, when: now, requested: AFTER_TURN, message: message.slice(0, MAX_TEXT),
      origin, target: { type: 'conversacion', ...c }, afterTurn: true, from, ...(from.kind === 'overseer' ? { overseer: true as const } : {}),
      ...(from.kind === 'room' ? { messages: { room: from.room, dweller: from.dweller, parts: [{ kind: 'message' as const, text: message }] } } : {}) };
    this.items.push(x); this.save();
    return x;
  }
  /** A CI failure or review of a PR for a conversation that is busy or whose PR's checks still run (main.ts: notifyPR):
   *  merged into the pending one for that PR and conversation (`mergePart`), which keeps its place in the queue, or held
   *  as a new one. It goes when the turn ends and the PR's checks have finished (`turnDue`) */
  pack(c: { roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }, pr: PackPart & { url: string; label: string }, origin: ScheduledMessage['origin']): ScheduledMessage {
    const part: PackPart = { kind: pr.kind, text: pr.text };
    const x = this.items.find(y => y.afterTurn && y.pr?.url === pr.url && forTarget(y, { id: c.sessionId, claudeId: c.claudeId }));
    if (!x) {
      const y = this.hold(c, pr.text, { kind: 'game' }, origin);
      y.pr = { url: pr.url, label: pr.label, parts: [part] }; this.save();
      return y;
    }
    x.pr!.parts = mergePart(x.pr!.parts, part);
    x.message = packText(x.pr!.label, x.pr!.parts).slice(0, MAX_TEXT);
    this.failed.delete(x.id); this.save();
    return x;
  }
  /** A pending message of a sender's that a later one may join: one with its `messages` (not edited since) that isn't
   *  being delivered */
  private joinable(f: (y: ScheduledMessage) => boolean) { return this.items.find(y => y.messages && !this.delivering.has(y.id) && f(y)); }
  private messagesOf(roomId: string, text: string): NonNullable<ScheduledMessage['messages']> {
    const r = this.ctx.rooms().find(x => x.id === roomId);
    return { room: r?.name ?? roomId, dweller: (r?.dweller as { name?: string } | undefined)?.name, parts: [{ kind: 'message', text }] };
  }
  /** A sender's later message to the same place, added to its pending one after the others (the same text once): it
   *  keeps that one's place and time, and they go as one turn */
  private joinMessage(x: ScheduledMessage, text: string): ScheduledMessage {
    x.messages!.parts = mergePart(x.messages!.parts, { kind: 'message', text });
    x.message = messagesText(x.messages!).slice(0, MAX_TEXT);
    this.failed.delete(x.id); this.save();
    return x;
  }
  /** A turn ended: what waited for it goes out (on the next tick, after the turn's last event) */
  turnEnded(target: { sessionId?: string; claudeId?: string }) {
    if (!this.items.some(x => x.afterTurn && (x.target.type === 'conversacion') && ((target.sessionId && x.target.sessionId === target.sessionId) || (target.claudeId && x.target.claudeId === target.claudeId)))) return;
    setTimeout(() => { this.sweep().catch(() => {}); }, 0);
  }

  /** ▶ in the intercom's ⏰ list: a next-window message goes out now, without waiting */
  sendNow(id: string) {
    const x = this.items.find(y => y.id === id);
    if (!x) throw new Error(t('server.scheduledGone'));
    // a held one goes into its conversation's queue now, taken at its next tool boundary
    delete x.nextWindow; x.when = this.now(); this.failed.delete(id);
    if (x.afterTurn) { delete x.afterTurn; this.save(); return this.deliver(x, true).then(() => {}); }
    this.save();
    return this.sweep();
  }

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
    if (c.when !== undefined && isAfterTurn(c.when)) {
      if (x.target.type !== 'conversacion') throw new Error(t('server.scheduledAfterTurnNoConversation'));
      delete x.nextWindow; x.afterTurn = true; x.when = this.now(); x.requested = AFTER_TURN;
    }
    else if (c.when !== undefined && isNextWindow(c.when)) { x.nextWindow = true; x.when = finalWindowStart(this.now(), this.usage()); x.requested = NEXT_WINDOW; }
    else if (c.when !== undefined) {
      const w = checkWhen(String(c.when), this.now());
      if (!w.ok) throw new Error(whenError(w.error, String(c.when)));
      delete x.nextWindow; delete x.afterTurn; x.when = w.when; x.requested = String(c.when);
    }
    // their own text: no longer merged with later notices of that PR or messages of that sender
    if (c.message !== undefined) { const m = String(c.message).trim(); if (!m) throw new Error(t('tool.rooms.empty')); if (m !== x.message) { delete x.pr; delete x.messages; } x.message = m.slice(0, MAX_TEXT); }
    this.failed.delete(id); this.save();
    return x;
  }

  /** El mensaje que recibe el habitante: cuándo se programó (y si llega tarde) y el texto */
  text(x: ScheduledMessage, now = this.now()) {
    if (x.overLimit || x.from) return x.message;
    const title = x.overseer ? t('prompt.scheduled.overseer', { creado: describeWhen(x.created) }) : t('prompt.scheduled.title', { creado: describeWhen(x.created) });
    return [title + (!x.nextWindow && isLate(x, now) ? ' ' + t('prompt.scheduled.late', { cuando: describeWhen(x.when) }) : ''), '', x.message].join('\n');
  }

  /** Cada minuto y al arrancar: entrega lo vencido */
  async sweep() {
    if (this.sweeping) { this.again = true; return; }
    this.sweeping = true; this.again = false;
    // over-limit messages go out in order: one that couldn't holds the next ones to the same room
    const held = new Set<string>();
    try {
      for (const x of due(this.items, this.now())) {
        if (!this.items.includes(x)) continue;   // cancelado mientras se entregaba otro
        const pair = x.overLimit && x.target.type === 'sala' ? `${x.origin.roomId}>${x.target.room}` : undefined;
        if (pair && held.has(pair)) continue;
        if (!(await this.deliver(x)) && pair) held.add(pair);
      }
      // the next-window ones: one per round at most, a few minutes apart, none while a limit stops everything
      const now = this.now(), x = windowNext(this.items, now, this.usage(), this.lastWindow, this.failed);
      if (x) { this.lastWindow = now; await this.deliver(x); }
      // what waited for a turn to end, one per conversation: once delivered, it is busy again and the next one waits
      const busy = (s: { sessionId?: string; claudeId?: string }) => !!this.ctx.busy?.(s);
      const started = new Set<string>();
      for (const y of turnDue(this.items, busy, url => this.ctx.settled?.(url) ?? true, now)) {
        const d = y.target as Extract<ScheduledTarget, { type: 'conversacion' }>, k = d.claudeId ?? d.sessionId ?? '';
        if (started.has(k) || !this.items.includes(y) || busy(d)) continue;
        started.add(k);
        await this.deliver(y);
      }
    } finally { this.sweeping = false; }
    if (this.again) await this.sweep();
  }

  /** Delivered (and dropped from the list), or not: an error is warned once and retried; a room over its limit, quietly */
  private async deliver(x: ScheduledMessage, now = false): Promise<boolean> {
    let error: string | undefined;
    // a dated one falling due while its conversation is busy waits for its turn to end too (▶ sends it anyway)
    if (!now && !x.afterTurn && x.target.type === 'conversacion' && this.ctx.busy?.(x.target)) { x.afterTurn = true; this.save(); return false; }
    this.delivering.add(x.id);
    try {
      if (x.target.type === 'sala') {
        const r = await this.ctx.toRoom(x as any, this.text(x));
        if (!r.ok && r.limited) return false;
        if (!r.ok && r.permanent) { this.ctx.notice(t('server.scheduledDropped', { resumen: summary(x.message), error: r.text.split('\n')[0].slice(0, 160) })); this.drop(x); return true; }
        if (!r.ok) error = r.text;
      }
      else await this.ctx.toConversation(x as any, this.text(x));
    } catch (e) { error = (e as Error).message; }
    finally { this.delivering.delete(x.id); }
    if (error) {
      if (!this.failed.has(x.id)) { this.failed.add(x.id); this.ctx.notice(t('server.scheduledRetry', { resumen: summary(x.message), error: error.split('\n')[0].slice(0, 160) })); }
      return false;
    }
    this.drop(x);
    return true;
  }
  private drop(x: ScheduledMessage) { this.items = this.items.filter(y => y !== x); this.failed.delete(x.id); this.save(); }

}

const sameSala = (a: ScheduledTarget, b: ScheduledTarget) => a.type === 'sala' && b.type === 'sala' && a.room === b.room && a.key === b.key && a.thread === b.thread;
const isNextWindow = (when: unknown) => typeof when === 'string' && when.trim().toLowerCase() === NEXT_WINDOW;
const isAfterTurn = (when: unknown) => typeof when === 'string' && when.trim().toLowerCase() === AFTER_TURN;
export const summary = (s: string) => { const r = s.trim().replace(/\s+/g, ' '); return r.length > 90 ? r.slice(0, 89) + '…' : r; };

function valid(x: any): x is ScheduledMessage {
  return x && typeof x.id === 'string' && Number.isFinite(x.when) && typeof x.message === 'string' && x.origin && typeof x.origin.roomId === 'string'
    && x.target && (x.target.type === 'sala' ? typeof x.target.room === 'string' : x.target.type === 'conversacion' && typeof x.target.roomId === 'string' && typeof x.target.cwd === 'string');
}
