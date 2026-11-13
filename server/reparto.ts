// Reparto del trabajo desde la sala de coordinación (la carpeta raíz con todos los repos): su habitante planifica una
// tarea con acceso a todos los repos y, cuando el plan está claro, la reparte: cada parte es un trabajo nuevo en la sala
// de su repo, en un worktree propio, para avanzar en paralelo e iterar en cada proyecto por separado.
// Herramientas del juego en el propio proceso (como decoradoSala.ts): un servidor MCP por sesión. Lanzar trabajos
// siempre lo confirma el Supervisor (el diálogo de permisos), sea cual sea el modo de permisos de la sesión.
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { InputView } from '../shared/protocolo.ts';
import { textPlan, type Plans, type Plan, type PartOfPlan } from './planes.ts';
import { t as tr } from '../shared/idioma.ts';

export interface AssignmentRoom { id: string; nombre: string; ruta: string; rama?: string; habitante?: string; inIsWing: boolean }
export interface CtxAssignment {
  salas(): AssignmentRoom[];                                          // las salas de repo del refugio
  pathRoom(ruta: string): string | undefined;
  empezar(salaId: string, prompt: string): Promise<{ sesionId: string; habitante: string }>;
  planes: Plans;
  /** un mensaje a una conversación (del mensajero del refugio); false si ya no está */
  avisar(sesionId: string, texto: string): boolean;
  /** la conversación abierta de una sala en el worktree de una tarea (su carpeta lleva la clave), si la hay */
  sesionDeTarea?(salaId: string, clave: string): string | undefined;
  /** el robot mensajero corre con el plan de una sala a otras (solo se ve) */
  mensajero(desde: string, a: string[], motivo: 'reparto' | 'cambio' | 'propuesta'): void;
}
export interface AssignmentOptions { coordinacion: string; salaId: string; sesionId?: string; preguntar: Ask }
export interface Trabajo { sala: string; titulo: string; instrucciones: string; espera_a?: string[] }
type Ask = (titulo: string, entrada: InputView[]) => Promise<boolean>;

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** La sala de un trabajo: por id, por nombre (sin distinguir mayúsculas) o por una ruta dentro de su repo */
export function buscarSala(salas: AssignmentRoom[], q: string, pathRoom: (r: string) => string | undefined): AssignmentRoom | undefined {
  const k = q.trim();
  return salas.find(s => s.id === k) ?? salas.find(s => s.nombre.toLowerCase() === k.toLowerCase())
    ?? (path.isAbsolute(k) ? salas.find(s => s.id === pathRoom(path.resolve(k))) : undefined);
}

/** Lo que recibe el habitante de cada sala. Empieza por la clave y el título: el worktree y su rama se llaman así, y el
 *  tablero de Logística cruza los PR con la tarea por la clave de la rama */
export function promptTrabajo(t: Trabajo, o: { clave?: string; coordinacion: string; otros: { sala: string; titulo: string }[]; plan?: string; espera?: string[] }): string {
  return [
    `${o.clave ? o.clave + ' ' : ''}${t.titulo}`.trim(),
    '',
    t.instrucciones.trim(),
    '',
    '---',
    tr('prompt.job.partOf', { sala: o.coordinacion, tarea: o.clave ? tr('prompt.job.forTask', { clave: o.clave }) : '' }),
    ...(o.otros.length ? [tr('prompt.job.others', { otros: o.otros.map(x => `${x.sala} (${x.titulo})`).join('; ') })] : []),
    ...(o.espera?.length ? [tr('prompt.job.after', { salas: o.espera.join(', ') })] : []),
    ...(o.plan ? [tr('prompt.job.sharedPlan', { plan: o.plan })] : []),
    tr('prompt.job.worktree'),
  ].join('\n');
}

export function mcpAssignment(ctx: CtxAssignment, o: AssignmentOptions) {
  return createSdkMcpServer({
    name: 'reparto', version: '1.0.0',
    tools: [
      tool('salas_del_refugio', tr('tool.assign.roomsDescription'), {},
        async () => {
          const salas = ctx.salas();
          if (!salas.length) return texto(tr('tool.assign.noRooms'));
          return texto(salas.map(s => `- ${s.nombre} (id: ${s.id}) · ${s.ruta}${s.rama ? tr('tool.assign.roomBranch', { rama: s.rama }) : ''} · ${s.habitante ? tr('tool.assign.roomDweller', { habitante: s.habitante }) : tr('tool.assign.roomNoDweller')}${s.inIsWing ? '' : tr('tool.assign.roomOutside')}`).join('\n')
            + '\n\n' + tr('tool.assign.roomsMissing'));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('repartir_trabajo', tr('tool.assign.assignDescription'),
        {
          clave: z.string().optional().describe(tr('tool.assign.paramKey')),
          plan: z.string().describe(tr('tool.assign.paramPlan')),
          trabajos: z.array(z.object({
            sala: z.string().describe(tr('tool.assign.paramRoom')),
            titulo: z.string().describe(tr('tool.assign.paramTitle')),
            instrucciones: z.string().describe(tr('tool.assign.paramInstructions')),
            espera_a: z.array(z.string()).optional().describe(tr('tool.assign.paramWaitFor')),
          })).min(1).max(12),
        },
        async ({ clave, plan, trabajos }) => {
          const r = await repartir(ctx, o, clave, trabajos, plan);
          return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true };
        }, { alwaysLoad: true }),
      tool('actualizar_plan', tr('tool.assign.updateDescription'),
        {
          plan: z.string().describe(tr('tool.assign.paramUpdatedPlan')),
          cambios: z.string().describe(tr('tool.assign.paramChanges')),
          id: z.string().optional().describe(tr('tool.assign.paramPlanId')),
          afectadas: z.array(z.object({ sala: z.string().describe(tr('tool.param.room')), mensaje: z.string().describe(tr('tool.assign.paramAffectedMessage')) })).optional(),
          orden: z.array(z.object({ sala: z.string().describe(tr('tool.param.room')), espera_a: z.array(z.string()).describe(tr('tool.assign.paramOrderWaitFor')) })).optional().describe(tr('tool.assign.paramOrder')),
        },
        async (args) => { const r = updatePlan(ctx, o, args); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
      tool('avisar_sala', tr('tool.assign.notifyDescription'),
        {
          clave: z.string().describe(tr('tool.assign.paramKeyOrPlan')),
          sala: z.string().describe(tr('tool.param.room')),
          mensaje: z.string(),
        },
        async (args) => { const r = notifyRoom(ctx, o, args); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
      tool('leer_plan', tr('tool.assign.readDescription'),
        { id: z.string().optional().describe(tr('tool.assign.paramReadId')) },
        async ({ id }) => {
          const p = id ? ctx.planes.get(id) : ctx.planes.ofRoom(o.salaId)[0];
          return p ? texto(textPlan(p)) : texto(tr('tool.assign.noPlansYet'));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
    ],
  });
}

/** actualizar_plan: una versión nueva del plan y un mensaje a la conversación de cada sala afectada (o de todas) */
export function updatePlan(ctx: CtxAssignment, o: AssignmentOptions, { plan, cambios, id, afectadas, orden }: { plan: string; cambios: string; id?: string; afectadas?: { sala: string; mensaje: string }[]; orden?: { sala: string; espera_a: string[] }[] }): { ok: boolean; texto: string } {
  const p = id ? ctx.planes.get(id) : ctx.planes.ofRoom(o.salaId).find(x => x.coordinacion === o.salaId);
  if (!p) return { ok: false, texto: tr(id ? 'tool.assign.noPlanWithId' : 'tool.assign.noPlan', { id: id ?? '' }) };
  const destino = afectadas?.length ? afectadas.map(a => ({ a, parte: partOf(p, a.sala) })) : p.partes.map(parte => ({ a: undefined, parte }));
  const fuera = destino.filter(d => !d.parte);
  if (fuera.length) return { ok: false, texto: tr('tool.assign.notInPlanNothingChanged', { salas: fuera.map(d => tr('tool.quoted', { v: d.a!.sala })).join(', '), id: p.id, partes: p.partes.map(x => x.sala).join(', ') }) };
  const newOrder = (orden ?? []).map(x => ({ parte: partOf(p, x.sala), espera: waitInPlan(p.partes, x.espera_a), x }));
  const badOrder = newOrder.filter(n => !n.parte || n.espera.error);
  if (badOrder.length) return { ok: false, texto: tr('tool.assign.badOrder', { errores: badOrder.map(n => n.parte ? n.espera.error : tr('tool.assign.roomNotInPlan', { sala: n.x.sala, id: p.id })).join('; '), partes: p.partes.map(x => x.sala).join(', ') }) };
  for (const n of newOrder) n.parte!.waitA = n.espera.ids.filter(s => s !== n.parte!.salaId);
  ctx.planes.actualizar(p.id, plan, cambios);
  if (o.sesionId) { p.coordinationSession = o.sesionId; ctx.planes.guardar(); }
  const r = notifyParts(ctx, o.salaId, p, destino.map(d => ({ parte: d.parte!, texto: `${heading(p)} ${tr('tool.assign.planChanged', { version: p.version, cambios: (d.a?.mensaje ?? cambios).trim() })}` })), 'cambio');
  return { ok: true, texto: tr('tool.assign.planAtVersion', { id: p.id, version: p.version, avisos: r }) };
}
/** avisar_sala: un mensaje a la sala de una tarea repartida, por la clave de la tarea, sin cambiar el plan */
export function notifyRoom(ctx: CtxAssignment, o: AssignmentOptions, { clave, sala, mensaje }: { clave: string; sala: string; mensaje: string }): { ok: boolean; texto: string } {
  const p = ctx.planes.get(clave.trim());
  if (!p) return { ok: false, texto: tr('tool.assign.noPlanFor', { clave }) };
  const parte = partOf(p, sala);
  if (!parte) return { ok: false, texto: tr('tool.assign.roomNotInPlanParts', { sala, id: p.id, partes: p.partes.map(x => x.sala).join(', ') }) };
  return { ok: true, texto: notifyParts(ctx, o.salaId, p, [{ parte, texto: `${heading(p)} ${tr('tool.assign.messageFromLogistics', { mensaje: mensaje.trim() })}` }], 'cambio') };
}
// los avisos van con la clave de la tarea delante: así cada sala sabe de qué trabajo es (puede llevar varios)
const heading = (p: Plan) => `📋 [${p.clave ?? p.id}]`;
const partOf = (p: Plan, q: string) => p.partes.find(x => x.salaId === q.trim() || x.sala.toLowerCase() === q.trim().toLowerCase());
/** espera_a (ids o nombres) → ids de salas del plan; error si alguna no es parte de él */
function waitInPlan(partes: Pick<PartOfPlan, 'salaId' | 'sala'>[], nombres: string[] = []): { ids: string[]; error?: string } {
  const ids: string[] = [], bad: string[] = [];
  for (const n of nombres) { const x = partes.find(y => y.salaId === n.trim() || y.sala.toLowerCase() === n.trim().toLowerCase()); if (x) { if (!ids.includes(x.salaId)) ids.push(x.salaId); } else bad.push(tr('tool.quoted', { v: n })); }
  return { ids, error: bad.length ? tr('tool.assign.notAPart', { salas: bad.join(', ') }) : undefined };
}
// a la conversación de cada parte en su worktree: la anotada al repartir o, si ya no está, la abierta en el worktree de la tarea
function notifyParts(ctx: Pick<CtxAssignment, 'avisar' | 'mensajero' | 'sesionDeTarea' | 'planes'>, desde: string, p: Plan, avisos: { parte: PartOfPlan; texto: string }[], motivo: 'cambio'): string {
  const avisar = (x: PartOfPlan, t: string) => {
    if (x.sesionId && ctx.avisar(x.sesionId, t)) return true;
    const otra = p.clave ? ctx.sesionDeTarea?.(x.salaId, p.clave) : undefined;
    if (!otra || otra === x.sesionId || !ctx.avisar(otra, t)) return false;
    x.sesionId = otra; ctx.planes.guardar(); return true;
  };
  const notified = avisos.filter(a => avisar(a.parte, a.texto)).map(a => a.parte);
  if (notified.length) ctx.mensajero(desde, notified.map(x => x.salaId), motivo);
  const sin = avisos.map(a => a.parte).filter(x => !notified.includes(x));
  return tr('tool.assign.notified', { salas: notified.map(x => x.sala).join(', ') || tr('tool.assign.none') }) + (sin.length ? tr('tool.assign.withoutConversation', { salas: sin.map(x => x.sala).join(', ') }) : '');
}

/** Las herramientas del plan compartido en la sala de cada parte: leerlo y proponer cambios a la sala de logística */
export function mcpPlan(ctx: Pick<CtxAssignment, 'planes' | 'avisar' | 'mensajero'>, o: { salaId: string; sala: string }) {
  const suyo = (id?: string) => (id ? ctx.planes.get(id) : ctx.planes.ofRoom(o.salaId)[0]);
  return createSdkMcpServer({
    name: 'plan', version: '1.0.0',
    tools: [
      tool('plan_compartido', tr('tool.plan.sharedDescription'),
        { id: z.string().optional().describe(tr('tool.plan.paramId')) },
        async ({ id }) => {
          const p = suyo(id);
          if (!p) return texto(tr('tool.plan.none'));
          const otros = ctx.planes.ofRoom(o.salaId).filter(x => x !== p).slice(0, 5);
          return texto(textPlan(p, o.salaId) + (otros.length ? '\n\n' + tr('tool.plan.otherPlans', { planes: otros.map(x => x.id).join(', ') }) : ''));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('proponer_cambio_plan', tr('tool.plan.proposeDescription'),
        {
          propuesta: z.string().describe(tr('tool.plan.paramProposal')),
          id: z.string().optional().describe(tr('tool.plan.paramId')),
        },
        async ({ propuesta, id }) => {
          const p = suyo(id);
          if (!p) return { ...texto(tr('tool.plan.none')), isError: true };
          const ok = !!p.coordinationSession && ctx.avisar(p.coordinationSession, `${heading(p)} ${tr('tool.plan.proposal', { sala: o.sala, version: p.version, propuesta: propuesta.trim() })}`);
          if (ok) ctx.mensajero(o.salaId, [p.coordinacion], 'propuesta');
          return ok ? texto(tr('tool.plan.proposalSent'))
            : { ...texto(tr('tool.plan.planningClosed')), isError: true };
        }, { alwaysLoad: true }),
    ],
  });
}

/** repartir_trabajo: todo o nada hasta la confirmación (salas que existen, con habitante y sin repetir); después, cada
 *  trabajo empieza por su cuenta y se dice cuál no ha podido */
export async function repartir(ctx: CtxAssignment, o: AssignmentOptions, clave: string | undefined, trabajos: Trabajo[], textOfPlan = ''): Promise<{ ok: boolean; texto: string }> {
  const resueltos = trabajos.map(t => ({ t, sala: buscarSala(ctx.salas(), t.sala, ctx.pathRoom) }));
  const withoutRoom = resueltos.filter(r => !r.sala?.habitante);
  if (withoutRoom.length) return { ok: false, texto: tr('tool.assign.nothingAssigned', { errores: withoutRoom.map(r => r.sala ? tr('tool.assign.roomWithoutDweller', { sala: r.sala.nombre }) : tr('tool.assign.noSuchRoom', { sala: r.t.sala })).join('; ') }) };
  const repetidas = resueltos.filter((r, k) => resueltos.findIndex(x => x.sala!.id === r.sala!.id) !== k);
  if (repetidas.length) return { ok: false, texto: tr('tool.assign.repeatedRoom', { salas: repetidas.map(r => r.sala!.nombre).join(', ') }) };
  // a quién espera cada parte para fusionarse: a las de este reparto o a las que ya estén en el plan de la tarea
  const alreadyInPlan = clave ? ctx.planes.get(clave)?.partes ?? [] : [];
  const candidatas = [...resueltos.map(r => ({ salaId: r.sala!.id, sala: r.sala!.nombre })), ...alreadyInPlan];
  const waits = resueltos.map(r => waitInPlan(candidatas, r.t.espera_a));
  const badWait = waits.filter(e => e.error);
  if (badWait.length) return { ok: false, texto: tr('tool.assign.badWait', { errores: badWait.map(e => e.error).join('; '), partes: candidatas.map(c => c.sala).join(', ') }) };
  const waitOf = (k: number) => waits[k].ids.filter(id => id !== resueltos[k].sala!.id);
  const nameOf = (id: string) => candidatas.find(c => c.salaId === id)?.sala ?? id;
  const si = await o.preguntar(tr(trabajos.length === 1 ? 'tool.assign.confirmOne' : 'tool.assign.confirmMany', { n: trabajos.length, tarea: clave ? tr('tool.assign.confirmOf', { clave }) : '' }),
    resueltos.flatMap((r, k) => [{ tipo: 'ruta' as const, texto: `${r.sala!.nombre} · ${r.sala!.habitante} · ${r.t.titulo}${waitOf(k).length ? tr('tool.assign.after', { salas: waitOf(k).map(nameOf).join(', ') }) : ''}` }, { tipo: 'texto' as const, texto: r.t.instrucciones }]));
  if (!si) return { ok: false, texto: tr('tool.assign.declined') };
  // el plan compartido se guarda antes de empezar (cada parte lo lee al arrancar) y luego se anota la conversación de cada una
  const plan = textOfPlan.trim() ? ctx.planes.repartir({ clave, coordinacion: o.salaId, coordinationSession: o.sesionId, texto: textOfPlan, partes: resueltos.map((r, k) => ({ salaId: r.sala!.id, sala: r.sala!.nombre, titulo: r.t.titulo, ...(waitOf(k).length ? { waitA: waitOf(k) } : {}) })) }) : undefined;
  ctx.mensajero(o.salaId, resueltos.map(r => r.sala!.id), 'reparto');
  const lineas: string[] = [];
  for (const [k, r] of resueltos.entries()) {
    const otros = resueltos.filter(x => x !== r).map(x => ({ sala: x.sala!.nombre, titulo: x.t.titulo }));
    try {
      const s = await ctx.empezar(r.sala!.id, promptTrabajo(r.t, { clave, coordinacion: o.coordinacion, otros, plan: plan?.id, espera: waitOf(k).map(nameOf) }));
      const parte = plan?.partes.find(x => x.salaId === r.sala!.id); if (parte) parte.sesionId = s.sesionId;
      lineas.push(tr('tool.assign.started', { sala: r.sala!.nombre, habitante: s.habitante, titulo: r.t.titulo }));
    } catch (e) { lineas.push(tr('tool.assign.notStarted', { sala: r.sala!.nombre, error: (e as Error).message })); }
  }
  if (plan) ctx.planes.guardar();
  return { ok: true, texto: [tr('tool.assign.done'), ...lineas,
    ...(plan ? ['', tr('tool.assign.sharedPlan', { id: plan.id, version: plan.version })] : [])].join('\n') };
}
