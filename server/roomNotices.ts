// Mensajes entre salas: cualquier habitante le pasa algo al de otra sala con send_to_room (un servidor MCP en proceso en
// cada conversación). With a task key (ABC-123, or a descriptive slug outside Jira: preflight-popover), always a
// conversation with the task's history: its open one (queued if it is busy, for when its turn ends); with none open, the
// last one in the task's worktree, resumed; with none there, a new
// one in it (and if the room has no worktree for it yet, in a new one with the key in its name, so the task's next
// messages land there). Sin
// clave, una conversación nueva con el habitante en su copia principal; the same conversation's next messages to that room
// continue in it while it is open, and its replies come back to the conversation that wrote; from a conversation in a task
// worktree to another room that has that task's conversation or worktree, it carries the task's key. With a thread (`cleanup`), to that thread's open conversation in the main copy, so
// its messages queue there one at a time; request_worktree_cleanup sends a worktree's cleanup through `cleanup`.
// Also inside the same room: a dweller hands a task (or a part that goes alone) to its worktree's hologram and keeps the
// Overseer's conversation; he carries it himself, or the messenger robot does if he's busy (web/src/world/messenger.ts),
// and never to the sender's own conversation. Para repartir un plan entre varios repos sigue estando assign_work (dispatch.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'node:path';
import { t as tr } from '../shared/language.ts';
import type { InfoWorktree, MessageOrigin } from '../shared/protocol.ts';
import { worktreeName, worktreeSuffix } from './sessions.ts';
import { isJiraKey, slugWorktreeName, taskKey, worktreeHasTask, worktreeTask } from '../shared/tasks.ts';
import { describeWhen, MAX_PER_CONVERSATION, MAX_DAYS, type ScheduledMessage } from '../shared/scheduled.ts';
import { MCP } from './mcpServers.ts';
import { REPORT_EVENTS, SIGNAL_KINDS, type PlanConversation } from '../shared/verification.ts';
import { errorText, planText, type Verifications } from './verifications.ts';

export interface RoomInfo { id: string; name: string; dweller?: { id: string; name: string } }
export interface CtxRooms {
  rooms(): RoomInfo[];
  // la conversación abierta en el worktree de la tarea, en esa sala
  sessionOfTask(roomId: string, taskKeyOf: string): string | undefined;
  // el worktree de la tarea en esa sala (la clave en su rama o en su carpeta), leído de git al momento: uno recién creado
  // aún no está en el último repaso de los repos
  worktreeOfTask(roomId: string, taskKeyOf: string): Promise<string | undefined>;
  notify(sessionId: string, text: string, origin?: MessageOrigin): boolean;
  // una conversación nueva con el habitante, en automático: en `cwd`, en un worktree nuevo llamado `worktree` o, sin
  // ninguno, en la carpeta de la sala; `inWorktree` dice si el worktree pedido sigue en pie (falso si la carpeta de la
  // sala no es un repo git y la conversación arrancó en ella)
  start(roomId: string, dwellerId: string, prompt: string, where?: { cwd?: string; worktree?: string }): Promise<{ id: string; inWorktree: boolean }>;
  messenger(since: string, a: string[], reason: 'cambio'): void;
  // dentro de la misma sala no hay robot: el habitante se lo da en mano al holograma de la conversación que lo recibe
  delivery?(roomId: string, a: { worktree?: string; sessionId?: string }): void;
  notice(text: string): void;
  now?(): number;
  // los mensajes programados (scheduled.ts): schedule_message, list_scheduled y cancel_scheduled
  scheduled?: {
    schedule(since: string, fromSession: string | undefined, a: { when: string; message: string; room?: string; key?: string }): { ok: boolean; text: string };
    ofConversation(sessionId?: string): ScheduledMessage[];
    // a send_to_room over the per-minute limit, scheduled for `when` (none if the conversation's list is full), and when
    // the pending ones from one room to another go out
    defer(since: string, fromSession: string | undefined, a: { room: string; key?: string; thread?: string; message: string }, when: number): ScheduledMessage | undefined;
    overLimit(since: string, roomId: string): number[];
    cancel(id: string, fromSession?: string): boolean;
  };
  // production verification plans (verifications.ts): verification_plan and verification_report, for the task of the
  // conversation's worktree (or the key the dweller passes)
  verifications?: { plans: Pick<Verifications, 'get' | 'propose' | 'report'>; taskOfSession(sessionId?: string): string | undefined; conversation?(sessionId?: string): PlanConversation | undefined };
  // a conversation is busy (starting, working or waiting for the Overseer): a task message then waits in its queue
  busy?(sessionId: string): boolean;
  // the last conversation in a folder (none still open outside the game), resumed with `prompt`: its
  // id, or none if there is no such conversation
  resume?(roomId: string, cwd: string, prompt: string): Promise<string | undefined>;
  // the worktree a conversation runs in (its cwd inside one), its branch, and whether the repo has a `local` branch
  worktreeOfSession?(roomId: string, sessionId: string): Promise<{ path: string; branch: string; local: boolean } | undefined>;
}

// sin bucles: como mucho LIMITE mensajes por minuto de una sala a otra
const LIMIT = 3, WINDOW = 60_000;
const sent = new Map<string, number[]>();
export const forgetLimits = () => sent.clear();
// each thread's conversation, per room and thread: in memory only, since "Restart the game" closes every conversation
const threads = new Map<string, string>();
// conversation follow-ups, per sender conversation and room (`${sesión}>${sala}`): where its last message without key or
// thread went, and the way back for replies; in memory too
const followUps = new Map<string, { session: string; answer: boolean }>();
export const forgetThreads = () => { threads.clear(); followUps.clear(); };
const threadOf = (h: string) => { const x = h.trim().toLowerCase(); return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x) && x.length <= 40 ? x : undefined; };

// the worktree of a task among a room's: its key in its folder name or its branch (shared/tasks.ts: worktreeHasTask)
export function taskWorktree(worktrees: InfoWorktree[], taskKeyOf: string): string | undefined {
  return worktrees.find(w => !w.main && worktreeHasTask(w, taskKeyOf))?.path;
}

const findRoom = (rooms: RoomInfo[], q: string) => { const k = q.trim().toLowerCase(); return rooms.find(s => s.id.toLowerCase() === k) ?? rooms.find(s => s.name.toLowerCase() === k); };

/** `fromSession`: the conversation sending it (in its own room, it can't be the one receiving it). Over the per-minute
 *  limit, or behind other over-limit ones still waiting, it is scheduled for when the window frees up; `scheduled`: it is
 *  one of those, being delivered (`limited` if still over the limit, for the next round) */
export async function sendToRoom(ctx: CtxRooms, since: string, { room, message, key: taskKeyOf, thread: requestedThread }: { room: string; message: string; key?: string; thread?: string }, fromSession?: string, o: { scheduled?: boolean } = {}): Promise<{ ok: boolean; text: string; limited?: boolean }> {
  const rooms = ctx.rooms();
  const origin = rooms.find(s => s.id === since), target = findRoom(rooms, room);
  if (!target) return { ok: false, text: tr('tool.rooms.noRoom', { sala: room, salas: rooms.map(s => `${s.id} (${s.name})`).join(', ') }) };
  const same = target.id === since;
  if (!target.dweller) return { ok: false, text: tr('tool.rooms.noDweller', { sala: target.name }) };
  if (!message.trim()) return { ok: false, text: tr('tool.rooms.empty') };
  let k = taskKeyOf?.trim() ? taskKey(taskKeyOf) : undefined;
  if (taskKeyOf?.trim() && !k) return { ok: false, text: tr('tool.rooms.badKey', { clave: taskKeyOf ?? '' }) };
  const thread = requestedThread?.trim() ? threadOf(requestedThread) : undefined;
  if (requestedThread?.trim() && !thread) return { ok: false, text: tr('tool.rooms.badThread', { hilo: requestedThread }) };
  if (k && thread) return { ok: false, text: tr('tool.rooms.keyAndThread') };
  const now = ctx.now?.() ?? Date.now(), pair = `${since}>${target.id}`;
  const recent = (sent.get(pair) ?? []).filter(x => now - x < WINDOW);
  const queued = o.scheduled ? [] : ctx.scheduled?.overLimit(since, target.id) ?? [];
  if (recent.length >= LIMIT || queued.length) {
    // the first time with fewer than LIMIT sends in the minute before it, counting the ones already waiting
    const times = [...recent, ...queued].sort((a, b) => a - b);
    const when = Math.max(now, times.length >= LIMIT ? times[times.length - LIMIT] + WINDOW : now);
    const x = o.scheduled ? undefined : ctx.scheduled?.defer(since, fromSession, { room: target.id, key: k, thread, message: message.trim() }, when);
    if (x) return { ok: true, text: tr('tool.rooms.deferred', { n: LIMIT, sala: target.name, cuando: describeWhen(x.when), id: x.id }) };
    if (recent.length >= LIMIT) return { ok: false, limited: true, text: tr('tool.rooms.limit', { n: LIMIT, sala: target.name }) };
  }
  const frame = (k?: string) => [
    tr('prompt.room.from', { sala: origin?.name ?? since, habitante: origin?.dweller?.name ?? '?', tarea: k ? tr('prompt.room.task', { clave: k }) : thread ? tr('prompt.room.thread', { hilo: thread }) : '' }),
    '', message.trim(), '', ...k ? [tr('prompt.room.outside')] : [], tr('prompt.room.reply', { salaId: since }),
  ].join('\n');
  // as the receiver's intercom shows who sent it while it waits in its queue and in its log (also when it was scheduled:
  // a room's dweller wrote it)
  const from: MessageOrigin = { kind: 'room', roomId: since, room: origin?.name ?? since, dweller: origin?.dweller?.name };
  let how: string | undefined, receiver: string | undefined, cwd: string | undefined, inherited: string | undefined;
  // without key or thread: the conversation that got this one's previous message, or the one that wrote to it
  const followUp = !k && !thread && fromSession ? followUps.get(`${fromSession}>${target.id}`) : undefined;
  if (followUp && ctx.notify(followUp.session, frame(), from)) { how = tr(followUp.answer ? 'tool.rooms.toReply' : 'tool.rooms.toFollowUp'); receiver = followUp.session; }
  // else, from a conversation in a task worktree to another room: the sender's task, if that room has its conversation or
  // worktree (otherwise its main copy, as before: an unrelated question never makes a worktree there)
  else if (!k && !thread && !same && fromSession) {
    const wt = await ctx.worktreeOfSession?.(since, fromSession), t = wt && worktreeTask(wt);
    if (t && (ctx.sessionOfTask(target.id, t) || (cwd = await ctx.worktreeOfTask(target.id, t)))) k = inherited = t;
  }
  const text = frame(k);
  const open = k ? ctx.sessionOfTask(target.id, k) : undefined;
  if (same && open && open === fromSession) return { ok: false, text: tr('tool.rooms.ownConversation', { clave: k! }) };
  // a thread's conversation, while open and never the sender itself (sesiones.enviar queues it if it's busy)
  const ofThread = thread ? threads.get(`${target.id}/${thread}`) : undefined;
  if (how) { /* followed up or replied */ }
  // the task's open conversation: sessions.send queues it if it is busy, for when its turn ends
  else if (open) { const busy = !!ctx.busy?.(open); if (ctx.notify(open, text, from)) { how = tr(busy ? 'tool.rooms.toOpenQueued' : 'tool.rooms.toOpen', { clave: k! }); receiver = open; } }
  else if (ofThread && ofThread !== fromSession && ctx.notify(ofThread, text, from)) { how = tr('tool.rooms.toThread', { hilo: thread! }); receiver = ofThread; }
  if (!how) {
    cwd = k ? cwd ?? await ctx.worktreeOfTask(target.id, k) : undefined;
    // none open: the last conversation in the task's worktree, with its history
    if (cwd && ctx.resume) {
      try { receiver = await ctx.resume(target.id, cwd, text); }
      catch (e) { return { ok: false, text: tr('tool.rooms.couldNotStart', { sala: target.name, error: (e as Error).message }) }; }
      if (receiver) how = tr('tool.rooms.resumed', { clave: k! });
    }
  }
  if (!how) {
    // sin worktree de la tarea, uno nuevo: la clave y el asunto en su nombre (la primera línea, sin repetir la clave); a
    // slug is descriptive already, so it goes alone and verbatim, recoverable from the name (shared/tasks.ts: slugKeyOf)
    const worktree = !k || cwd ? undefined : isJiraKey(k)
      ? worktreeName(`${k} ${message.trim().split('\n')[0].replace(new RegExp(k, 'ig'), '')}`, now)
      : slugWorktreeName(k, worktreeSuffix(now));
    let inWorktree: boolean;
    try { ({ id: receiver, inWorktree } = await ctx.start(target.id, target.dweller.id, text, cwd ? { cwd } : worktree ? { worktree } : undefined)); }
    catch (e) { return { ok: false, text: tr('tool.rooms.couldNotStart', { sala: target.name, error: (e as Error).message }) }; }
    if (thread) threads.set(`${target.id}/${thread}`, receiver);
    // dónde ha caído de verdad: si no se pudo hacer el worktree, se dice (nunca a la copia principal en silencio)
    how = cwd ? tr('tool.rooms.inTaskWorktree', { clave: k! }) : thread ? tr('tool.rooms.inNewThread', { hilo: thread }) : !worktree ? tr('tool.rooms.inMainCopy')
      : inWorktree ? tr('tool.rooms.inNewWorktree', { clave: k!, worktree }) : tr('tool.rooms.inMainCopyNoGit', { clave: k! });
  }
  sent.set(pair, [...recent, now]);
  // never the sender's own: recibe can't be it, so neither can a follow-up
  if (fromSession && receiver && receiver !== fromSession) {
    if (!k && !thread) followUps.set(`${fromSession}>${target.id}`, { session: receiver, answer: false });
    followUps.set(`${receiver}>${since}`, { session: fromSession, answer: true });
  }
  if (!same) ctx.messenger(since, [target.id], 'cambio');
  else ctx.delivery?.(target.id, { worktree: cwd, sessionId: receiver });
  const summary = message.trim().replace(/\s+/g, ' ');
  ctx.notice(tr('server.roomMessage', { desde: origin?.name ?? since, a: target.name, resumen: summary.length > 90 ? summary.slice(0, 89) + '…' : summary }));
  return { ok: true, text: tr('tool.rooms.sent', { habitante: target.dweller.name, sala: target.name, como: how }) + (inherited ? ' ' + tr('tool.rooms.inheritedKey', { clave: inherited }) : '') };
}

// a worktree's cleanup, written by the game from the sender's cwd and sent through its own room's `cleanup` thread
export async function requestCleanup(ctx: CtxRooms, since: string, fromSession: string | undefined, note?: string): Promise<{ ok: boolean; text: string }> {
  const wt = fromSession ? await ctx.worktreeOfSession?.(since, fromSession) : undefined;
  if (!wt) return { ok: false, text: tr('tool.cleanup.notInWorktree') };
  const message = [tr('prompt.cleanup.request', { ruta: wt.path, rama: wt.branch, merge: wt.local ? tr('prompt.cleanup.mergeLocal', { rama: wt.branch }) : '' }), note?.trim() ?? ''].filter(Boolean).join('\n\n');
  return sendToRoom(ctx, since, { room: since, message, thread: 'cleanup' }, fromSession);
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function mcpRooms(ctx: CtxRooms, since: string, fromSession?: string, inWorktree = false) {
  const rooms = ctx.rooms().filter(s => s.dweller);
  return createSdkMcpServer({
    name: MCP.rooms, version: '1.0.0',
    tools: [
      tool('send_to_room', tr('tool.rooms.description', { salas: rooms.map(s => `${s.id} (${s.name})` + (s.id === since ? tr('tool.rooms.thisRoom') : '')).join(', ') }),
        {
          room: z.string().describe(tr('tool.param.room')),
          message: z.string().describe(tr('tool.rooms.paramMessage')),
          key: z.string().optional().describe(tr('tool.rooms.paramKey')),
          thread: z.string().optional().describe(tr('tool.rooms.paramThread')),
        },
        async ({ room, message, key, thread }) => { const r = await sendToRoom(ctx, since, { room: room, message: message, key: key, thread: thread }, fromSession); return r.ok ? text(r.text) : { ...text(r.text), isError: true }; }, { alwaysLoad: true }),
      ...(ctx.scheduled ? scheduleTools(ctx.scheduled, since, fromSession) : []),
      ...(ctx.verifications ? verificationTools(ctx.verifications, fromSession) : []),
      ...inWorktree ? [tool('request_worktree_cleanup', tr('tool.cleanup.description'), { note: z.string().optional().describe(tr('tool.cleanup.paramNote')) },
        async ({ note }) => { const r = await requestCleanup(ctx, since, fromSession, note); return r.ok ? text(r.text) : { ...text(r.text), isError: true }; }, { alwaysLoad: true })] : [],
    ],
  });
}

// mensajes programados (scheduled.ts): para más adelante, a esta misma conversación o a una sala
function scheduleTools(p: NonNullable<CtxRooms['scheduled']>, since: string, fromSession?: string) {
  const line = (x: ScheduledMessage) => `- ${x.id} · ${describeWhen(x.when)} · ${x.target.type === 'sala' ? tr('tool.schedule.toRoom', { sala: x.target.room + (x.target.key ?? x.target.thread ? ' ' + (x.target.key ?? x.target.thread) : '') }) : tr('tool.schedule.toThis')}: ${x.message.replace(/\s+/g, ' ').slice(0, 160)}`;
  return [
    tool('schedule_message', tr('tool.schedule.description', { n: MAX_PER_CONVERSATION, dias: MAX_DAYS }),
      {
        when: z.string().describe(tr('tool.schedule.paramWhen')),
        message: z.string().describe(tr('tool.schedule.paramMessage')),
        room: z.string().optional().describe(tr('tool.schedule.paramRoom')),
        key: z.string().optional().describe(tr('tool.rooms.paramKey')),
      },
      async ({ when, message, room, key }) => { const r = p.schedule(since, fromSession, { when: when, message: message, room: room, key: key }); return r.ok ? text(r.text) : { ...text(r.text), isError: true }; }, { alwaysLoad: true }),
    tool('list_scheduled', tr('tool.schedule.listDescription'), {},
      async () => { const l = p.ofConversation(fromSession); return text(l.length ? l.map(line).join('\n') : tr('tool.schedule.none')); }),
    tool('cancel_scheduled', tr('tool.schedule.cancelDescription'), { id: z.string().describe(tr('tool.schedule.paramId')) },
      async ({ id }) => (p.cancel(id.trim(), fromSession ?? '') ? text(tr('tool.schedule.cancelled', { id })) : { ...text(tr('tool.schedule.notFound', { id })), isError: true })),
  ];
}

// production verification (verifications.ts): the plan before the merge, the evidence after the deploy
function verificationTools(v: NonNullable<CtxRooms['verifications']>, fromSession?: string) {
  const taskKeyOf = (key?: string) => (key?.trim() ? taskKey(key) : v.taskOfSession(fromSession));
  const error = (s: string) => ({ ...text(s), isError: true });
  const signal = z.object({ id: z.string(), kind: z.enum(SIGNAL_KINDS as [string, ...string[]]), what: z.string(), where: z.string(), baseline: z.string().optional() });
  const checkpoint = z.object({
    id: z.string(), kind: z.enum(['pr', 'final']), pr: z.string().optional(), title: z.string().optional(),
    services: z.array(z.string()).optional(), deadline_hours: z.number().optional(), signals: z.array(signal),
  });
  return [
    tool('verification_plan', tr('tool.verification.planDescription'),
      { key: z.string().optional().describe(tr('tool.verification.paramKey')), checkpoints: z.array(checkpoint).describe(tr('tool.verification.paramCheckpoints')) },
      async ({ key, checkpoints }) => {
        const k = taskKeyOf(key); if (!k) return error(key?.trim() ? tr('tool.rooms.badKey', { clave: key }) : tr('tool.verification.noTask'));
        const r = v.plans.propose(k, { checkpoints: checkpoints as any }, v.conversation?.(fromSession));
        return r.ok ? text(tr('tool.verification.saved', { clave: k }) + '\n\n' + planText(r.value)) : error(errorText(r));
      }),
    tool('verification_report', tr('tool.verification.reportDescription'),
      {
        key: z.string().optional().describe(tr('tool.verification.paramKey')),
        checkpoint: z.string().describe(tr('tool.verification.paramCheckpoint')),
        event: z.enum(REPORT_EVENTS as [string, ...string[]]),
        signal: z.string().optional().describe(tr('tool.verification.paramSignal')),
        service: z.string().optional().describe(tr('tool.verification.paramService')),
        evidence: z.string().optional().describe(tr('tool.verification.paramEvidence')),
        hours: z.number().optional().describe(tr('tool.verification.paramHours')),
      },
      async ({ key, ...r }) => {
        const k = taskKeyOf(key); if (!k) return error(key?.trim() ? tr('tool.rooms.badKey', { clave: key }) : tr('tool.verification.noTask'));
        const x = v.plans.report(k, r as any);
        return !x ? error(tr('tool.verification.noPlan', { clave: k })) : x.ok ? text(planText(x.value)) : error(errorText(x));
      }),
  ];
}
