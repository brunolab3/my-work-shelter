// Reparto del trabajo desde la sala de coordinación (la carpeta raíz con todos los repos): su habitante planifica una
// tarea con acceso a todos los repos y, cuando el plan está claro, la reparte: cada parte es un trabajo nuevo en la sala
// de su repo, en un worktree propio, para avanzar en paralelo e iterar en cada proyecto por separado.
// Herramientas del juego en el propio proceso (como roomDecor.ts): un servidor MCP por sesión. Lanzar trabajos
// siempre lo confirma el Supervisor (el diálogo de permisos), sea cual sea el modo de permisos de la sesión.
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { InputView, MessageOrigin } from '../shared/protocol.ts';
import { textPlan, type Plans, type Plan, type PartOfPlan } from './plans.ts';
import { t as tr } from '../shared/language.ts';
import { MCP } from './mcpServers.ts';

export interface AssignmentRoom { id: string; name: string; path: string; branch?: string; dweller?: string; inIsWing: boolean }
export interface CtxAssignment {
  rooms(): AssignmentRoom[];                                          // las salas de repo del refugio
  pathRoom(path: string): string | undefined;
  start(roomId: string, prompt: string): Promise<{ sessionId: string; dweller: string }>;
  plans: Plans;
  /** un mensaje a una conversación (del mensajero del refugio); false si ya no está */
  notify(sessionId: string, text: string, origin?: MessageOrigin): boolean;
  /** la conversación abierta de una sala en el worktree de una tarea (su carpeta lleva la clave), si la hay */
  sessionOfTask?(roomId: string, key: string): string | undefined;
  /** el robot mensajero corre con el plan de una sala a otras (solo se ve) */
  messenger(since: string, a: string[], reason: 'reparto' | 'cambio' | 'propuesta'): void;
}
export interface AssignmentOptions { coordination: string; roomId: string; sessionId?: string; ask: Ask }
export interface Job { room: string; title: string; instructions: string; waits_on?: string[] }
type Ask = (title: string, input: InputView[]) => Promise<boolean>;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** La sala de un trabajo: por id, por nombre (sin distinguir mayúsculas) o por una ruta dentro de su repo */
export function findRoom(rooms: AssignmentRoom[], q: string, pathRoom: (r: string) => string | undefined): AssignmentRoom | undefined {
  const k = q.trim();
  return rooms.find(s => s.id === k) ?? rooms.find(s => s.name.toLowerCase() === k.toLowerCase())
    ?? (path.isAbsolute(k) ? rooms.find(s => s.id === pathRoom(path.resolve(k))) : undefined);
}

/** Lo que recibe el habitante de cada sala. Empieza por la clave y el título: el worktree y su rama se llaman así, y el
 *  tablero de Logística cruza los PR con la tarea por la clave de la rama */
export function workPrompt(t: Job, o: { key?: string; coordination: string; others: { room: string; title: string }[]; plan?: string; wait?: string[] }): string {
  return [
    `${o.key ? o.key + ' ' : ''}${t.title}`.trim(),
    '',
    t.instructions.trim(),
    '',
    '---',
    tr('prompt.job.partOf', { sala: o.coordination, tarea: o.key ? tr('prompt.job.forTask', { clave: o.key }) : '' }),
    ...(o.others.length ? [tr('prompt.job.others', { otros: o.others.map(x => `${x.room} (${x.title})`).join('; ') })] : []),
    ...(o.wait?.length ? [tr('prompt.job.after', { salas: o.wait.join(', ') })] : []),
    ...(o.plan ? [tr('prompt.job.sharedPlan', { plan: o.plan })] : []),
    tr('prompt.job.worktree'),
  ].join('\n');
}

export function mcpAssignment(ctx: CtxAssignment, o: AssignmentOptions) {
  return createSdkMcpServer({
    name: MCP.assignment, version: '1.0.0',
    tools: [
      tool('shelter_rooms', tr('tool.assign.roomsDescription'), {},
        async () => {
          const rooms = ctx.rooms();
          if (!rooms.length) return text(tr('tool.assign.noRooms'));
          return text(rooms.map(s => `- ${s.name} (id: ${s.id}) · ${s.path}${s.branch ? tr('tool.assign.roomBranch', { rama: s.branch }) : ''} · ${s.dweller ? tr('tool.assign.roomDweller', { habitante: s.dweller }) : tr('tool.assign.roomNoDweller')}${s.inIsWing ? '' : tr('tool.assign.roomOutside')}`).join('\n')
            + '\n\n' + tr('tool.assign.roomsMissing'));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('assign_work', tr('tool.assign.assignDescription'),
        {
          key: z.string().optional().describe(tr('tool.assign.paramKey')),
          plan: z.string().describe(tr('tool.assign.paramPlan')),
          jobs: z.array(z.object({
            room: z.string().describe(tr('tool.assign.paramRoom')),
            title: z.string().describe(tr('tool.assign.paramTitle')),
            instructions: z.string().describe(tr('tool.assign.paramInstructions')),
            wait_for: z.array(z.string()).optional().describe(tr('tool.assign.paramWaitFor')),
          })).min(1).max(12),
        },
        async ({ key, plan, jobs }) => {
          const r = await dispatch(ctx, o, key, jobs.map(j => ({ room: j.room, title: j.title, instructions: j.instructions, waits_on: j.wait_for })), plan);
          return r.ok ? text(r.text) : { ...text(r.text), isError: true };
        }, { alwaysLoad: true }),
      tool('update_plan', tr('tool.assign.updateDescription'),
        {
          plan: z.string().describe(tr('tool.assign.paramUpdatedPlan')),
          changes: z.string().describe(tr('tool.assign.paramChanges')),
          id: z.string().optional().describe(tr('tool.assign.paramPlanId')),
          affected: z.array(z.object({ room: z.string().describe(tr('tool.param.room')), message: z.string().describe(tr('tool.assign.paramAffectedMessage')) })).optional(),
          order: z.array(z.object({ room: z.string().describe(tr('tool.param.room')), wait_for: z.array(z.string()).describe(tr('tool.assign.paramOrderWaitFor')) })).optional().describe(tr('tool.assign.paramOrder')),
        },
        async ({ plan, changes, id, affected, order }) => {
          const r = updatePlan(ctx, o, { plan, changes: changes, id, affected: affected?.map(a => ({ room: a.room, message: a.message })), orden: order?.map(x => ({ room: x.room, waits_on: x.wait_for })) }); return r.ok ? text(r.text) : { ...text(r.text), isError: true }; }, { alwaysLoad: true }),
      tool('notify_room', tr('tool.assign.notifyDescription'),
        {
          key: z.string().describe(tr('tool.assign.paramKeyOrPlan')),
          room: z.string().describe(tr('tool.param.room')),
          message: z.string(),
        },
        async ({ key, room, message }) => { const r = notifyRoom(ctx, o, { key: key, room: room, message: message }); return r.ok ? text(r.text) : { ...text(r.text), isError: true }; }, { alwaysLoad: true }),
      tool('read_plan', tr('tool.assign.readDescription'),
        { id: z.string().optional().describe(tr('tool.assign.paramReadId')) },
        async ({ id }) => {
          const p = id ? ctx.plans.get(id) : ctx.plans.ofRoom(o.roomId)[0];
          return p ? text(textPlan(p)) : text(tr('tool.assign.noPlansYet'));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
    ],
  });
}

/** update_plan: una versión nueva del plan y un mensaje a la conversación de cada sala afectada (o de todas) */
export function updatePlan(ctx: CtxAssignment, o: AssignmentOptions, { plan, changes, id, affected, orden }: { plan: string; changes: string; id?: string; affected?: { room: string; message: string }[]; orden?: { room: string; waits_on: string[] }[] }): { ok: boolean; text: string } {
  const p = id ? ctx.plans.get(id) : ctx.plans.ofRoom(o.roomId).find(x => x.coordination === o.roomId);
  if (!p) return { ok: false, text: tr(id ? 'tool.assign.noPlanWithId' : 'tool.assign.noPlan', { id: id ?? '' }) };
  const target = affected?.length ? affected.map(a => ({ a, part: partOf(p, a.room) })) : p.parts.map(part => ({ a: undefined, part }));
  const outside = target.filter(d => !d.part);
  if (outside.length) return { ok: false, text: tr('tool.assign.notInPlanNothingChanged', { salas: outside.map(d => tr('tool.quoted', { v: d.a!.room })).join(', '), id: p.id, partes: p.parts.map(x => x.room).join(', ') }) };
  const newOrder = (orden ?? []).map(x => ({ part: partOf(p, x.room), wait: waitInPlan(p.parts, x.waits_on), x }));
  const badOrder = newOrder.filter(n => !n.part || n.wait.error);
  if (badOrder.length) return { ok: false, text: tr('tool.assign.badOrder', { errores: badOrder.map(n => n.part ? n.wait.error : tr('tool.assign.roomNotInPlan', { sala: n.x.room, id: p.id })).join('; '), partes: p.parts.map(x => x.room).join(', ') }) };
  for (const n of newOrder) n.part!.waitA = n.wait.ids.filter(s => s !== n.part!.roomId);
  ctx.plans.update(p.id, plan, changes);
  if (o.sessionId) { p.coordinationSession = o.sessionId; ctx.plans.save(); }
  const r = notifyParts(ctx, o.roomId, p, target.map(d => ({ part: d.part!, text: `${heading(p)} ${tr('tool.assign.planChanged', { version: p.version, cambios: (d.a?.message ?? changes).trim() })}` })), 'cambio');
  return { ok: true, text: tr('tool.assign.planAtVersion', { id: p.id, version: p.version, avisos: r }) };
}
/** notify_room: un mensaje a la sala de una tarea repartida, por la clave de la tarea, sin cambiar el plan */
export function notifyRoom(ctx: CtxAssignment, o: AssignmentOptions, { key, room, message }: { key: string; room: string; message: string }): { ok: boolean; text: string } {
  const p = ctx.plans.get(key.trim());
  if (!p) return { ok: false, text: tr('tool.assign.noPlanFor', { clave: key }) };
  const part = partOf(p, room);
  if (!part) return { ok: false, text: tr('tool.assign.roomNotInPlanParts', { sala: room, id: p.id, partes: p.parts.map(x => x.room).join(', ') }) };
  return { ok: true, text: notifyParts(ctx, o.roomId, p, [{ part, text: `${heading(p)} ${tr('tool.assign.messageFromLogistics', { mensaje: message.trim() })}` }], 'cambio') };
}
// los avisos van con la clave de la tarea delante: así cada sala sabe de qué trabajo es (puede llevar varios)
const heading = (p: Plan) => `📋 [${p.key ?? p.id}]`;
const partOf = (p: Plan, q: string) => p.parts.find(x => x.roomId === q.trim() || x.room.toLowerCase() === q.trim().toLowerCase());
/** espera_a (ids o nombres) → ids de salas del plan; error si alguna no es parte de él */
function waitInPlan(parts: Pick<PartOfPlan, 'roomId' | 'room'>[], names: string[] = []): { ids: string[]; error?: string } {
  const ids: string[] = [], bad: string[] = [];
  for (const n of names) { const x = parts.find(y => y.roomId === n.trim() || y.room.toLowerCase() === n.trim().toLowerCase()); if (x) { if (!ids.includes(x.roomId)) ids.push(x.roomId); } else bad.push(tr('tool.quoted', { v: n })); }
  return { ids, error: bad.length ? tr('tool.assign.notAPart', { salas: bad.join(', ') }) : undefined };
}
// a la conversación de cada parte en su worktree: la anotada al repartir o, si ya no está, la abierta en el worktree de la tarea
function notifyParts(ctx: Pick<CtxAssignment, 'notify' | 'messenger' | 'sessionOfTask' | 'plans'>, since: string, p: Plan, notices: { part: PartOfPlan; text: string }[], reason: 'cambio'): string {
  const notify = (x: PartOfPlan, t: string) => {
    if (x.sessionId && ctx.notify(x.sessionId, t)) return true;
    const other = p.key ? ctx.sessionOfTask?.(x.roomId, p.key) : undefined;
    if (!other || other === x.sessionId || !ctx.notify(other, t)) return false;
    x.sessionId = other; ctx.plans.save(); return true;
  };
  const notified = notices.filter(a => notify(a.part, a.text)).map(a => a.part);
  if (notified.length) ctx.messenger(since, notified.map(x => x.roomId), reason);
  const missing = notices.map(a => a.part).filter(x => !notified.includes(x));
  return tr('tool.assign.notified', { salas: notified.map(x => x.room).join(', ') || tr('tool.assign.none') }) + (missing.length ? tr('tool.assign.withoutConversation', { salas: missing.map(x => x.room).join(', ') }) : '');
}

/** Las herramientas del plan compartido en la sala de cada parte: leerlo y proponer cambios a la sala de logística */
export function mcpPlan(ctx: Pick<CtxAssignment, 'plans' | 'notify' | 'messenger'>, o: { roomId: string; room: string }) {
  const theirs = (id?: string) => (id ? ctx.plans.get(id) : ctx.plans.ofRoom(o.roomId)[0]);
  return createSdkMcpServer({
    name: MCP.plan, version: '1.0.0',
    tools: [
      tool('shared_plan', tr('tool.plan.sharedDescription'),
        { id: z.string().optional().describe(tr('tool.plan.paramId')) },
        async ({ id }) => {
          const p = theirs(id);
          if (!p) return text(tr('tool.plan.none'));
          const others = ctx.plans.ofRoom(o.roomId).filter(x => x !== p).slice(0, 5);
          return text(textPlan(p, o.roomId) + (others.length ? '\n\n' + tr('tool.plan.otherPlans', { planes: others.map(x => x.id).join(', ') }) : ''));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('propose_plan_change', tr('tool.plan.proposeDescription'),
        {
          proposal: z.string().describe(tr('tool.plan.paramProposal')),
          id: z.string().optional().describe(tr('tool.plan.paramId')),
        },
        async ({ proposal: proposal, id }) => {
          const p = theirs(id);
          if (!p) return { ...text(tr('tool.plan.none')), isError: true };
          const ok = !!p.coordinationSession && ctx.notify(p.coordinationSession, `${heading(p)} ${tr('tool.plan.proposal', { sala: o.room, version: p.version, propuesta: proposal.trim() })}`);
          if (ok) ctx.messenger(o.roomId, [p.coordination], 'propuesta');
          return ok ? text(tr('tool.plan.proposalSent'))
            : { ...text(tr('tool.plan.planningClosed')), isError: true };
        }, { alwaysLoad: true }),
    ],
  });
}

/** assign_work: todo o nada hasta la confirmación (salas que existen, con habitante y sin repetir); después, cada
 *  trabajo empieza por su cuenta y se dice cuál no ha podido */
export async function dispatch(ctx: CtxAssignment, o: AssignmentOptions, key: string | undefined, jobs: Job[], textOfPlan = ''): Promise<{ ok: boolean; text: string }> {
  const resolved = jobs.map(t => ({ t, room: findRoom(ctx.rooms(), t.room, ctx.pathRoom) }));
  const withoutRoom = resolved.filter(r => !r.room?.dweller);
  if (withoutRoom.length) return { ok: false, text: tr('tool.assign.nothingAssigned', { errores: withoutRoom.map(r => r.room ? tr('tool.assign.roomWithoutDweller', { sala: r.room.name }) : tr('tool.assign.noSuchRoom', { sala: r.t.room })).join('; ') }) };
  const repeated = resolved.filter((r, k) => resolved.findIndex(x => x.room!.id === r.room!.id) !== k);
  if (repeated.length) return { ok: false, text: tr('tool.assign.repeatedRoom', { salas: repeated.map(r => r.room!.name).join(', ') }) };
  // a quién espera cada parte para fusionarse: a las de este reparto o a las que ya estén en el plan de la tarea
  const alreadyInPlan = key ? ctx.plans.get(key)?.parts ?? [] : [];
  const candidates = [...resolved.map(r => ({ roomId: r.room!.id, room: r.room!.name })), ...alreadyInPlan];
  const waits = resolved.map(r => waitInPlan(candidates, r.t.waits_on));
  const badWait = waits.filter(e => e.error);
  if (badWait.length) return { ok: false, text: tr('tool.assign.badWait', { errores: badWait.map(e => e.error).join('; '), partes: candidates.map(c => c.room).join(', ') }) };
  const waitOf = (k: number) => waits[k].ids.filter(id => id !== resolved[k].room!.id);
  const nameOf = (id: string) => candidates.find(c => c.roomId === id)?.room ?? id;
  const si = await o.ask(tr(jobs.length === 1 ? 'tool.assign.confirmOne' : 'tool.assign.confirmMany', { n: jobs.length, tarea: key ? tr('tool.assign.confirmOf', { clave: key }) : '' }),
    resolved.flatMap((r, k) => [{ type: 'ruta' as const, text: `${r.room!.name} · ${r.room!.dweller} · ${r.t.title}${waitOf(k).length ? tr('tool.assign.after', { salas: waitOf(k).map(nameOf).join(', ') }) : ''}` }, { type: 'texto' as const, text: r.t.instructions }]));
  if (!si) return { ok: false, text: tr('tool.assign.declined') };
  // el plan compartido se guarda antes de empezar (cada parte lo lee al arrancar) y luego se anota la conversación de cada una
  const plan = textOfPlan.trim() ? ctx.plans.dispatch({ key, coordination: o.roomId, coordinationSession: o.sessionId, text: textOfPlan, parts: resolved.map((r, k) => ({ roomId: r.room!.id, room: r.room!.name, title: r.t.title, ...(waitOf(k).length ? { waitA: waitOf(k) } : {}) })) }) : undefined;
  ctx.messenger(o.roomId, resolved.map(r => r.room!.id), 'reparto');
  const lines: string[] = [];
  for (const [k, r] of resolved.entries()) {
    const others = resolved.filter(x => x !== r).map(x => ({ room: x.room!.name, title: x.t.title }));
    try {
      const s = await ctx.start(r.room!.id, workPrompt(r.t, { key, coordination: o.coordination, others, plan: plan?.id, wait: waitOf(k).map(nameOf) }));
      const part = plan?.parts.find(x => x.roomId === r.room!.id); if (part) part.sessionId = s.sessionId;
      lines.push(tr('tool.assign.started', { sala: r.room!.name, habitante: s.dweller, titulo: r.t.title }));
    } catch (e) { lines.push(tr('tool.assign.notStarted', { sala: r.room!.name, error: (e as Error).message })); }
  }
  if (plan) ctx.plans.save();
  return { ok: true, text: [tr('tool.assign.done'), ...lines,
    ...(plan ? ['', tr('tool.assign.sharedPlan', { id: plan.id, version: plan.version })] : [])].join('\n') };
}
