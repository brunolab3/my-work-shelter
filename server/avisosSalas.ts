// Mensajes entre salas: cualquier habitante le pasa algo al de otra sala con send_to_room (un servidor MCP en proceso en
// cada conversación). With a task key (ABC-123, or a descriptive slug outside Jira: preflight-popover), always a
// conversation with the task's history: its open one if idle; if busy, a read-only fork of it that answers and passes
// code changes back to it, queued; with none open, the last one in the task's worktree, resumed; with none there, a new
// one in it (and if the room has no worktree for it yet, in a new one with the key in its name, so the task's next
// messages land there). Sin
// clave, una conversación nueva con el habitante en su copia principal; the same conversation's next messages to that room
// continue in it while it is open, and its replies come back to the conversation that wrote; from a conversation in a task
// worktree to another room that has that task's conversation or worktree, it carries the task's key. With a thread (`cleanup`), to that thread's open conversation in the main copy, so
// its messages queue there one at a time; request_worktree_cleanup sends a worktree's cleanup through `cleanup`.
// Also inside the same room: a dweller hands a task (or a part that goes alone) to its worktree's hologram and keeps the
// Overseer's conversation; he carries it himself, or the messenger robot does if he's busy (web/src/mundo/mensajero.ts),
// and never to the sender's own conversation. Para repartir un plan entre varios repos sigue estando assign_work (reparto.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'node:path';
import { t as tr } from '../shared/idioma.ts';
import type { InfoWorktree } from '../shared/protocolo.ts';
import { nombreWorktree, worktreeSuffix } from './sesiones.ts';
import { isJiraKey, slugWorktreeName, taskKey, worktreeHasTask, worktreeTask } from '../shared/tareas.ts';
import { describeWhen, MAX_PER_CONVERSATION, MAX_DAYS, type ScheduledMessage } from '../shared/programados.ts';
import { MCP } from './servidoresMcp.ts';

export interface RoomInfo { id: string; nombre: string; habitante?: { id: string; nombre: string } }
export interface CtxRooms {
  salas(): RoomInfo[];
  // la conversación abierta en el worktree de la tarea, en esa sala
  sesionDeTarea(salaId: string, clave: string): string | undefined;
  // el worktree de la tarea en esa sala (la clave en su rama o en su carpeta), leído de git al momento: uno recién creado
  // aún no está en el último repaso de los repos
  worktreeDeTarea(salaId: string, clave: string): Promise<string | undefined>;
  avisar(sesionId: string, texto: string): boolean;
  // una conversación nueva con el habitante, en automático: en `cwd`, en un worktree nuevo llamado `worktree` o, sin
  // ninguno, en la carpeta de la sala; `enWorktree` dice si el worktree pedido sigue en pie (falso si la carpeta de la
  // sala no es un repo git y la conversación arrancó en ella)
  empezar(salaId: string, dwellerId: string, prompt: string, donde?: { cwd?: string; worktree?: string }): Promise<{ id: string; enWorktree: boolean }>;
  mensajero(desde: string, a: string[], motivo: 'cambio'): void;
  // dentro de la misma sala no hay robot: el habitante se lo da en mano al holograma de la conversación que lo recibe
  entrega?(salaId: string, a: { worktree?: string; sesionId?: string }): void;
  aviso(texto: string): void;
  ahora?(): number;
  // los mensajes programados (programados.ts): schedule_message, list_scheduled y cancel_scheduled
  programados?: {
    programar(desde: string, desdeSesion: string | undefined, a: { cuando: string; mensaje: string; sala?: string; clave?: string }): { ok: boolean; texto: string };
    deConversacion(sesionId?: string): ScheduledMessage[];
    cancelar(id: string, desdeSesion?: string): boolean;
  };
  // a conversation is busy (starting, working or waiting for the Overseer): a task message then goes to a fork of it
  ocupada?(sesionId: string): boolean;
  // a read-only fork (plan mode) of an open conversation, in its folder and with its history: the new conversation's id
  bifurcar?(salaId: string, sesionId: string, prompt: string): Promise<string>;
  // the last conversation in a folder (never a fork, nor one still open outside the game), resumed with `prompt`: its
  // id, or none if there is no such conversation
  retomar?(salaId: string, cwd: string, prompt: string): Promise<string | undefined>;
  // the worktree a conversation runs in (its cwd inside one), its branch, and whether the repo has a `local` branch
  worktreeDeSesion?(salaId: string, sesionId: string): Promise<{ ruta: string; rama: string; local: boolean } | undefined>;
}

// sin bucles: como mucho LIMITE mensajes por minuto de una sala a otra
const LIMITE = 3, VENTANA = 60_000;
const enviados = new Map<string, number[]>();
export const forgetLimits = () => enviados.clear();
// each thread's conversation, per room and thread: in memory only, since "Restart the game" closes every conversation
const hilos = new Map<string, string>();
// conversation follow-ups, per sender conversation and room (`${sesión}>${sala}`): where its last message without key or
// thread went, and the way back for replies; in memory too
const seguimientos = new Map<string, { sesion: string; respuesta: boolean }>();
// the forks a busy task conversation got (fork → original): what they send to their own room with the task's key
// queues in the original, and the task's messages go to the original, not to them
const bifurcaciones = new Map<string, string>();
export const forgetThreads = () => { hilos.clear(); seguimientos.clear(); bifurcaciones.clear(); };
const threadOf = (h: string) => { const x = h.trim().toLowerCase(); return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x) && x.length <= 40 ? x : undefined; };

// the worktree of a task among a room's: its key in its folder name or its branch (shared/tareas.ts: worktreeHasTask)
export function taskWorktree(worktrees: InfoWorktree[], clave: string): string | undefined {
  return worktrees.find(w => !w.principal && worktreeHasTask(w, clave))?.ruta;
}

const findRoom = (salas: RoomInfo[], q: string) => { const k = q.trim().toLowerCase(); return salas.find(s => s.id.toLowerCase() === k) ?? salas.find(s => s.nombre.toLowerCase() === k); };

/** `desdeSesion`: la conversación que lo envía (en su misma sala, no puede ser la que lo recibe) */
export async function sendToRoom(ctx: CtxRooms, desde: string, { sala, mensaje, clave, hilo: hiloPedido }: { sala: string; mensaje: string; clave?: string; hilo?: string }, desdeSesion?: string): Promise<{ ok: boolean; texto: string }> {
  const salas = ctx.salas();
  const origen = salas.find(s => s.id === desde), destino = findRoom(salas, sala);
  if (!destino) return { ok: false, texto: tr('tool.rooms.noRoom', { sala, salas: salas.map(s => `${s.id} (${s.nombre})`).join(', ') }) };
  const misma = destino.id === desde;
  if (!destino.habitante) return { ok: false, texto: tr('tool.rooms.noDweller', { sala: destino.nombre }) };
  if (!mensaje.trim()) return { ok: false, texto: tr('tool.rooms.empty') };
  let k = clave?.trim() ? taskKey(clave) : undefined;
  if (clave?.trim() && !k) return { ok: false, texto: tr('tool.rooms.badKey', { clave: clave ?? '' }) };
  const hilo = hiloPedido?.trim() ? threadOf(hiloPedido) : undefined;
  if (hiloPedido?.trim() && !hilo) return { ok: false, texto: tr('tool.rooms.badThread', { hilo: hiloPedido }) };
  if (k && hilo) return { ok: false, texto: tr('tool.rooms.keyAndThread') };
  const ahora = ctx.ahora?.() ?? Date.now(), par = `${desde}>${destino.id}`;
  const recientes = (enviados.get(par) ?? []).filter(x => ahora - x < VENTANA);
  if (recientes.length >= LIMITE) return { ok: false, texto: tr('tool.rooms.limit', { n: LIMITE, sala: destino.nombre }) };
  const marco = (k?: string) => [
    tr('prompt.room.from', { sala: origen?.nombre ?? desde, habitante: origen?.habitante?.nombre ?? '?', tarea: k ? tr('prompt.room.task', { clave: k }) : hilo ? tr('prompt.room.thread', { hilo }) : '' }),
    '', mensaje.trim(), '', ...k ? [tr('prompt.room.outside')] : [], tr('prompt.room.reply', { salaId: desde }),
  ].join('\n');
  let como: string | undefined, recibe: string | undefined, cwd: string | undefined, heredada: string | undefined;
  // without key or thread: the conversation that got this one's previous message, or the one that wrote to it
  const sigue = !k && !hilo && desdeSesion ? seguimientos.get(`${desdeSesion}>${destino.id}`) : undefined;
  if (sigue && ctx.avisar(sigue.sesion, marco())) { como = tr(sigue.respuesta ? 'tool.rooms.toReply' : 'tool.rooms.toFollowUp'); recibe = sigue.sesion; }
  // else, from a conversation in a task worktree to another room: the sender's task, if that room has its conversation or
  // worktree (otherwise its main copy, as before: an unrelated question never makes a worktree there)
  else if (!k && !hilo && !misma && desdeSesion) {
    const wt = await ctx.worktreeDeSesion?.(desde, desdeSesion), t = wt && worktreeTask(wt);
    if (t && (ctx.sesionDeTarea(destino.id, t) || (cwd = await ctx.worktreeDeTarea(destino.id, t)))) k = heredada = t;
  }
  const texto = marco(k);
  // a fork writing to its own room with the task's key: to the conversation it comes from, queued
  const original = misma && k && desdeSesion ? bifurcaciones.get(desdeSesion) : undefined;
  const deTarea = k ? ctx.sesionDeTarea(destino.id, k) : undefined;
  const abierta = original ?? (deTarea && (bifurcaciones.get(deTarea) ?? deTarea));
  if (misma && abierta && abierta === desdeSesion) return { ok: false, texto: tr('tool.rooms.ownConversation', { clave: k! }) };
  const ocupada = !original && !!abierta && !!ctx.ocupada?.(abierta);
  // a thread's conversation, while open and never the sender itself (sesiones.enviar queues it if it's busy)
  const delHilo = hilo ? hilos.get(`${destino.id}/${hilo}`) : undefined;
  if (como) { /* followed up or replied */ }
  else if (abierta && ocupada && ctx.bifurcar) {
    // busy: a read-only fork answers, and the original keeps working; if it can't start, the message queues there
    try { recibe = await ctx.bifurcar(destino.id, abierta, [texto, '', tr('prompt.room.fork', { salaId: destino.id, clave: k! })].join('\n')); bifurcaciones.set(recibe, abierta); como = tr('tool.rooms.toFork', { clave: k! }); }
    catch (e) { if (ctx.avisar(abierta, texto)) { recibe = abierta; como = tr('tool.rooms.toOpenQueued', { clave: k!, error: (e as Error).message }); } }
  }
  else if (abierta && ctx.avisar(abierta, texto)) { como = tr(original ? 'tool.rooms.toOriginal' : 'tool.rooms.toOpen', { clave: k! }); recibe = abierta; }
  else if (delHilo && delHilo !== desdeSesion && ctx.avisar(delHilo, texto)) { como = tr('tool.rooms.toThread', { hilo: hilo! }); recibe = delHilo; }
  if (!como) {
    cwd = k ? cwd ?? await ctx.worktreeDeTarea(destino.id, k) : undefined;
    // none open: the last conversation in the task's worktree, with its history
    if (cwd && ctx.retomar) {
      try { recibe = await ctx.retomar(destino.id, cwd, texto); }
      catch (e) { return { ok: false, texto: tr('tool.rooms.couldNotStart', { sala: destino.nombre, error: (e as Error).message }) }; }
      if (recibe) como = tr('tool.rooms.resumed', { clave: k! });
    }
  }
  if (!como) {
    // sin worktree de la tarea, uno nuevo: la clave y el asunto en su nombre (la primera línea, sin repetir la clave); a
    // slug is descriptive already, so it goes alone and verbatim, recoverable from the name (shared/tareas.ts: slugKeyOf)
    const worktree = !k || cwd ? undefined : isJiraKey(k)
      ? nombreWorktree(`${k} ${mensaje.trim().split('\n')[0].replace(new RegExp(k, 'ig'), '')}`, ahora)
      : slugWorktreeName(k, worktreeSuffix(ahora));
    let enWorktree: boolean;
    try { ({ id: recibe, enWorktree } = await ctx.empezar(destino.id, destino.habitante.id, texto, cwd ? { cwd } : worktree ? { worktree } : undefined)); }
    catch (e) { return { ok: false, texto: tr('tool.rooms.couldNotStart', { sala: destino.nombre, error: (e as Error).message }) }; }
    if (hilo) hilos.set(`${destino.id}/${hilo}`, recibe);
    // dónde ha caído de verdad: si no se pudo hacer el worktree, se dice (nunca a la copia principal en silencio)
    como = cwd ? tr('tool.rooms.inTaskWorktree', { clave: k! }) : hilo ? tr('tool.rooms.inNewThread', { hilo }) : !worktree ? tr('tool.rooms.inMainCopy')
      : enWorktree ? tr('tool.rooms.inNewWorktree', { clave: k!, worktree }) : tr('tool.rooms.inMainCopyNoGit', { clave: k! });
  }
  enviados.set(par, [...recientes, ahora]);
  // never the sender's own: recibe can't be it, so neither can a follow-up
  if (desdeSesion && recibe && recibe !== desdeSesion) {
    if (!k && !hilo) seguimientos.set(`${desdeSesion}>${destino.id}`, { sesion: recibe, respuesta: false });
    seguimientos.set(`${recibe}>${desde}`, { sesion: desdeSesion, respuesta: true });
  }
  if (!misma) ctx.mensajero(desde, [destino.id], 'cambio');
  else ctx.entrega?.(destino.id, { worktree: cwd, sesionId: recibe });
  const resumen = mensaje.trim().replace(/\s+/g, ' ');
  ctx.aviso(tr('server.roomMessage', { desde: origen?.nombre ?? desde, a: destino.nombre, resumen: resumen.length > 90 ? resumen.slice(0, 89) + '…' : resumen }));
  return { ok: true, texto: tr('tool.rooms.sent', { habitante: destino.habitante.nombre, sala: destino.nombre, como }) + (heredada ? ' ' + tr('tool.rooms.inheritedKey', { clave: heredada }) : '') };
}

// a worktree's cleanup, written by the game from the sender's cwd and sent through its own room's `cleanup` thread
export async function requestCleanup(ctx: CtxRooms, desde: string, desdeSesion: string | undefined, nota?: string): Promise<{ ok: boolean; texto: string }> {
  const wt = desdeSesion ? await ctx.worktreeDeSesion?.(desde, desdeSesion) : undefined;
  if (!wt) return { ok: false, texto: tr('tool.cleanup.notInWorktree') };
  const mensaje = [tr('prompt.cleanup.request', { ruta: wt.ruta, rama: wt.rama, merge: wt.local ? tr('prompt.cleanup.mergeLocal', { rama: wt.rama }) : '' }), nota?.trim() ?? ''].filter(Boolean).join('\n\n');
  return sendToRoom(ctx, desde, { sala: desde, mensaje, hilo: 'cleanup' }, desdeSesion);
}

const texto = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function mcpRooms(ctx: CtxRooms, desde: string, desdeSesion?: string, enWorktree = false) {
  const salas = ctx.salas().filter(s => s.habitante);
  return createSdkMcpServer({
    name: MCP.rooms, version: '1.0.0',
    tools: [
      tool('send_to_room', tr('tool.rooms.description', { salas: salas.map(s => `${s.id} (${s.nombre})` + (s.id === desde ? tr('tool.rooms.thisRoom') : '')).join(', ') }),
        {
          room: z.string().describe(tr('tool.param.room')),
          message: z.string().describe(tr('tool.rooms.paramMessage')),
          key: z.string().optional().describe(tr('tool.rooms.paramKey')),
          thread: z.string().optional().describe(tr('tool.rooms.paramThread')),
        },
        async ({ room, message, key, thread }) => { const r = await sendToRoom(ctx, desde, { sala: room, mensaje: message, clave: key, hilo: thread }, desdeSesion); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
      ...(ctx.programados ? scheduleTools(ctx.programados, desde, desdeSesion) : []),
      ...enWorktree ? [tool('request_worktree_cleanup', tr('tool.cleanup.description'), { note: z.string().optional().describe(tr('tool.cleanup.paramNote')) },
        async ({ note }) => { const r = await requestCleanup(ctx, desde, desdeSesion, note); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true })] : [],
    ],
  });
}

// mensajes programados (programados.ts): para más adelante, a esta misma conversación o a una sala
function scheduleTools(p: NonNullable<CtxRooms['programados']>, desde: string, desdeSesion?: string) {
  const linea = (x: ScheduledMessage) => `- ${x.id} · ${describeWhen(x.cuando)} · ${x.destino.tipo === 'sala' ? tr('tool.schedule.toRoom', { sala: x.destino.sala + (x.destino.clave ? ' ' + x.destino.clave : '') }) : tr('tool.schedule.toThis')}: ${x.mensaje.replace(/\s+/g, ' ').slice(0, 160)}`;
  return [
    tool('schedule_message', tr('tool.schedule.description', { n: MAX_PER_CONVERSATION, dias: MAX_DAYS }),
      {
        when: z.string().describe(tr('tool.schedule.paramWhen')),
        message: z.string().describe(tr('tool.schedule.paramMessage')),
        room: z.string().optional().describe(tr('tool.schedule.paramRoom')),
        key: z.string().optional().describe(tr('tool.rooms.paramKey')),
      },
      async ({ when, message, room, key }) => { const r = p.programar(desde, desdeSesion, { cuando: when, mensaje: message, sala: room, clave: key }); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
    tool('list_scheduled', tr('tool.schedule.listDescription'), {},
      async () => { const l = p.deConversacion(desdeSesion); return texto(l.length ? l.map(linea).join('\n') : tr('tool.schedule.none')); }),
    tool('cancel_scheduled', tr('tool.schedule.cancelDescription'), { id: z.string().describe(tr('tool.schedule.paramId')) },
      async ({ id }) => (p.cancelar(id.trim(), desdeSesion ?? '') ? texto(tr('tool.schedule.cancelled', { id })) : { ...texto(tr('tool.schedule.notFound', { id })), isError: true })),
  ];
}
