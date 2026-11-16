// Mensajes entre salas: cualquier habitante le pasa algo al de otra sala con send_to_room (un servidor MCP en proceso en
// cada conversación). Con la clave de una tarea (ABC-123, o un slug descriptivo fuera de Jira: preflight-popover), a la conversación abierta de esa tarea en la sala; si no la
// hay, una conversación nueva en el worktree de la tarea (y si la sala aún no tiene ninguno, en uno nuevo con la clave en
// su nombre, para que los siguientes mensajes de la tarea lleguen ahí). Sin
// clave, siempre una conversación nueva con el habitante en su copia principal: los mensajes entre salas son para
// empezar trabajo, no para charlar. También dentro de la misma sala: así un habitante pasa una tarea (o una parte que va
// sola) al holograma de su worktree y sigue con la conversación del Supervisor; sin robot mensajero, que no sale de la
// sala, y nunca a la propia conversación. Para repartir un plan entre varios repos sigue estando assign_work (reparto.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'node:path';
import { t as tr } from '../shared/idioma.ts';
import type { InfoWorktree } from '../shared/protocolo.ts';
import { nombreWorktree, worktreeSuffix } from './sesiones.ts';
import { isJiraKey, slugWorktreeName, taskKey, worktreeHasTask } from '../shared/tareas.ts';

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
}

// sin bucles: como mucho LIMITE mensajes por minuto de una sala a otra
const LIMITE = 3, VENTANA = 60_000;
const enviados = new Map<string, number[]>();
export const forgetLimits = () => enviados.clear();

// the worktree of a task among a room's: its key in its folder name or its branch (shared/tareas.ts: worktreeHasTask)
export function taskWorktree(worktrees: InfoWorktree[], clave: string): string | undefined {
  return worktrees.find(w => !w.principal && worktreeHasTask(w, clave))?.ruta;
}

const findRoom = (salas: RoomInfo[], q: string) => { const k = q.trim().toLowerCase(); return salas.find(s => s.id.toLowerCase() === k) ?? salas.find(s => s.nombre.toLowerCase() === k); };

/** `desdeSesion`: la conversación que lo envía (en su misma sala, no puede ser la que lo recibe) */
export async function sendToRoom(ctx: CtxRooms, desde: string, { sala, mensaje, clave }: { sala: string; mensaje: string; clave?: string }, desdeSesion?: string): Promise<{ ok: boolean; texto: string }> {
  const salas = ctx.salas();
  const origen = salas.find(s => s.id === desde), destino = findRoom(salas, sala);
  if (!destino) return { ok: false, texto: tr('tool.rooms.noRoom', { sala, salas: salas.map(s => `${s.id} (${s.nombre})`).join(', ') }) };
  const misma = destino.id === desde;
  if (!destino.habitante) return { ok: false, texto: tr('tool.rooms.noDweller', { sala: destino.nombre }) };
  if (!mensaje.trim()) return { ok: false, texto: tr('tool.rooms.empty') };
  const k = clave?.trim() ? taskKey(clave) : undefined;
  if (clave?.trim() && !k) return { ok: false, texto: tr('tool.rooms.badKey', { clave: clave ?? '' }) };
  const ahora = ctx.ahora?.() ?? Date.now(), par = `${desde}>${destino.id}`;
  const recientes = (enviados.get(par) ?? []).filter(x => ahora - x < VENTANA);
  if (recientes.length >= LIMITE) return { ok: false, texto: tr('tool.rooms.limit', { n: LIMITE, sala: destino.nombre }) };
  const texto = [
    tr('prompt.room.from', { sala: origen?.nombre ?? desde, habitante: origen?.habitante?.nombre ?? '?', tarea: k ? tr('prompt.room.task', { clave: k }) : '' }),
    '', mensaje.trim(), '', tr('prompt.room.reply', { salaId: desde }),
  ].join('\n');
  let como: string, recibe: string | undefined, cwd: string | undefined;
  const abierta = k ? ctx.sesionDeTarea(destino.id, k) : undefined;
  if (misma && abierta && abierta === desdeSesion) return { ok: false, texto: tr('tool.rooms.ownConversation', { clave: k! }) };
  if (abierta && ctx.avisar(abierta, texto)) { como = tr('tool.rooms.toOpen', { clave: k! }); recibe = abierta; }
  else {
    cwd = k ? await ctx.worktreeDeTarea(destino.id, k) : undefined;
    // sin worktree de la tarea, uno nuevo: la clave y el asunto en su nombre (la primera línea, sin repetir la clave); a
    // slug is descriptive already, so it goes alone and verbatim, recoverable from the name (shared/tareas.ts: slugKeyOf)
    const worktree = !k || cwd ? undefined : isJiraKey(k)
      ? nombreWorktree(`${k} ${mensaje.trim().split('\n')[0].replace(new RegExp(k, 'ig'), '')}`, ahora)
      : slugWorktreeName(k, worktreeSuffix(ahora));
    let enWorktree: boolean;
    try { ({ id: recibe, enWorktree } = await ctx.empezar(destino.id, destino.habitante.id, texto, cwd ? { cwd } : worktree ? { worktree } : undefined)); }
    catch (e) { return { ok: false, texto: tr('tool.rooms.couldNotStart', { sala: destino.nombre, error: (e as Error).message }) }; }
    // dónde ha caído de verdad: si no se pudo hacer el worktree, se dice (nunca a la copia principal en silencio)
    como = cwd ? tr('tool.rooms.inTaskWorktree', { clave: k! }) : !worktree ? tr('tool.rooms.inMainCopy')
      : enWorktree ? tr('tool.rooms.inNewWorktree', { clave: k!, worktree }) : tr('tool.rooms.inMainCopyNoGit', { clave: k! });
  }
  enviados.set(par, [...recientes, ahora]);
  if (!misma) ctx.mensajero(desde, [destino.id], 'cambio');
  else ctx.entrega?.(destino.id, { worktree: cwd, sesionId: recibe });
  const resumen = mensaje.trim().replace(/\s+/g, ' ');
  ctx.aviso(tr('server.roomMessage', { desde: origen?.nombre ?? desde, a: destino.nombre, resumen: resumen.length > 90 ? resumen.slice(0, 89) + '…' : resumen }));
  return { ok: true, texto: tr('tool.rooms.sent', { habitante: destino.habitante.nombre, sala: destino.nombre, como }) };
}

const texto = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function mcpRooms(ctx: CtxRooms, desde: string, desdeSesion?: string) {
  const salas = ctx.salas().filter(s => s.habitante);
  return createSdkMcpServer({
    name: 'rooms', version: '1.0.0',
    tools: [
      tool('send_to_room', tr('tool.rooms.description', { salas: salas.map(s => `${s.id} (${s.nombre})` + (s.id === desde ? tr('tool.rooms.thisRoom') : '')).join(', ') }),
        {
          room: z.string().describe(tr('tool.param.room')),
          message: z.string().describe(tr('tool.rooms.paramMessage')),
          key: z.string().optional().describe(tr('tool.rooms.paramKey')),
        },
        async ({ room, message, key }) => { const r = await sendToRoom(ctx, desde, { sala: room, mensaje: message, clave: key }, desdeSesion); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
    ],
  });
}
