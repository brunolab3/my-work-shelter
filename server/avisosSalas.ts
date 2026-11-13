// Mensajes entre salas: cualquier habitante le pasa algo al de otra sala con enviar_a_sala (un servidor MCP en proceso en
// cada conversación). Con la clave de una tarea (ABC-123), a la conversación abierta de esa tarea en la sala; si no la
// hay, una conversación nueva en el worktree de la tarea (y si la sala aún no tiene ninguno, en uno nuevo con la clave en
// su nombre, para que los siguientes mensajes de la tarea lleguen ahí). Sin
// clave, siempre una conversación nueva con el habitante en su copia principal: los mensajes entre salas son para
// empezar trabajo, no para charlar. Para repartir un plan entre varios repos sigue estando repartir_trabajo (reparto.ts).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'node:path';
import { t as tr } from '../shared/idioma.ts';
import type { InfoWorktree } from '../shared/protocolo.ts';
import { nombreWorktree } from './sesiones.ts';

export interface RoomInfo { id: string; nombre: string; habitante?: { id: string; nombre: string } }
export interface CtxRooms {
  salas(): RoomInfo[];
  // la conversación abierta en el worktree de la tarea, en esa sala
  sesionDeTarea(salaId: string, clave: string): string | undefined;
  // el worktree de la tarea en esa sala (la clave en su rama o en su carpeta)
  worktreeDeTarea(salaId: string, clave: string): string | undefined;
  avisar(sesionId: string, texto: string): boolean;
  // una conversación nueva con el habitante, en automático: en `cwd`, en un worktree nuevo llamado `worktree` o, sin
  // ninguno, en la carpeta de la sala
  empezar(salaId: string, dwellerId: string, prompt: string, donde?: { cwd?: string; worktree?: string }): Promise<string>;
  mensajero(desde: string, a: string[], motivo: 'cambio'): void;
  aviso(texto: string): void;
  ahora?(): number;
}

// sin bucles: como mucho LIMITE mensajes por minuto de una sala a otra
const LIMITE = 3, VENTANA = 60_000;
const enviados = new Map<string, number[]>();
export const forgetLimits = () => enviados.clear();

// el worktree de una tarea entre los de una sala: la clave en su rama (o, sin rama, en el nombre de su carpeta)
export function taskWorktree(worktrees: InfoWorktree[], clave: string): string | undefined {
  const k = clave.toLowerCase();
  return worktrees.find(w => !w.principal && (w.rama || path.basename(w.ruta)).toLowerCase().includes(k))?.ruta;
}

const findRoom = (salas: RoomInfo[], q: string) => { const k = q.trim().toLowerCase(); return salas.find(s => s.id.toLowerCase() === k) ?? salas.find(s => s.nombre.toLowerCase() === k); };
const KEY = /^[A-Z][A-Z0-9]+-\d+$/i;

export async function sendToRoom(ctx: CtxRooms, desde: string, { sala, mensaje, clave }: { sala: string; mensaje: string; clave?: string }): Promise<{ ok: boolean; texto: string }> {
  const salas = ctx.salas();
  const origen = salas.find(s => s.id === desde), destino = findRoom(salas, sala);
  if (!destino) return { ok: false, texto: tr('tool.rooms.noRoom', { sala, salas: salas.map(s => `${s.id} (${s.nombre})`).join(', ') }) };
  if (destino.id === desde) return { ok: false, texto: tr('tool.rooms.ownRoom') };
  if (!destino.habitante) return { ok: false, texto: tr('tool.rooms.noDweller', { sala: destino.nombre }) };
  if (!mensaje.trim()) return { ok: false, texto: tr('tool.rooms.empty') };
  const k = clave?.trim().toUpperCase() || undefined;
  if (k && !KEY.test(k)) return { ok: false, texto: tr('tool.rooms.badKey', { clave: clave ?? '' }) };
  const ahora = ctx.ahora?.() ?? Date.now(), par = `${desde}>${destino.id}`;
  const recientes = (enviados.get(par) ?? []).filter(x => ahora - x < VENTANA);
  if (recientes.length >= LIMITE) return { ok: false, texto: tr('tool.rooms.limit', { n: LIMITE, sala: destino.nombre }) };
  const texto = [
    tr('prompt.room.from', { sala: origen?.nombre ?? desde, habitante: origen?.habitante?.nombre ?? '?', tarea: k ? tr('prompt.room.task', { clave: k }) : '' }),
    '', mensaje.trim(), '', tr('prompt.room.reply', { salaId: desde }),
  ].join('\n');
  let como: string;
  const abierta = k ? ctx.sesionDeTarea(destino.id, k) : undefined;
  if (abierta && ctx.avisar(abierta, texto)) como = tr('tool.rooms.toOpen', { clave: k! });
  else {
    const cwd = k ? ctx.worktreeDeTarea(destino.id, k) : undefined;
    // sin worktree de la tarea, uno nuevo: la clave y el asunto en su nombre (la primera línea, sin repetir la clave)
    const worktree = k && !cwd ? nombreWorktree(`${k} ${mensaje.trim().split('\n')[0].replace(new RegExp(k, 'ig'), '')}`, ahora) : undefined;
    try { await ctx.empezar(destino.id, destino.habitante.id, texto, cwd ? { cwd } : worktree ? { worktree } : undefined); }
    catch (e) { return { ok: false, texto: tr('tool.rooms.couldNotStart', { sala: destino.nombre, error: (e as Error).message }) }; }
    como = cwd ? tr('tool.rooms.inTaskWorktree', { clave: k! }) : worktree ? tr('tool.rooms.inNewWorktree', { clave: k!, worktree }) : tr('tool.rooms.inMainCopy');
  }
  enviados.set(par, [...recientes, ahora]);
  ctx.mensajero(desde, [destino.id], 'cambio');
  const resumen = mensaje.trim().replace(/\s+/g, ' ');
  ctx.aviso(tr('server.roomMessage', { desde: origen?.nombre ?? desde, a: destino.nombre, resumen: resumen.length > 90 ? resumen.slice(0, 89) + '…' : resumen }));
  return { ok: true, texto: tr('tool.rooms.sent', { habitante: destino.habitante.nombre, sala: destino.nombre, como }) };
}

const texto = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function mcpRooms(ctx: CtxRooms, desde: string) {
  const otras = ctx.salas().filter(s => s.id !== desde && s.habitante);
  return createSdkMcpServer({
    name: 'salas', version: '1.0.0',
    tools: [
      tool('enviar_a_sala', tr('tool.rooms.description', { salas: otras.map(s => `${s.id} (${s.nombre})`).join(', ') }),
        {
          sala: z.string().describe(tr('tool.param.room')),
          mensaje: z.string().describe(tr('tool.rooms.paramMessage')),
          clave: z.string().optional().describe(tr('tool.rooms.paramKey')),
        },
        async (args) => { const r = await sendToRoom(ctx, desde, args); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
    ],
  });
}
