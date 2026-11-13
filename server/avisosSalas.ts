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
  if (!destino) return { ok: false, texto: `No hay ninguna sala «${sala}». Salas: ${salas.map(s => `${s.id} (${s.nombre})`).join(', ')}.` };
  if (destino.id === desde) return { ok: false, texto: 'Esa es tu propia sala: los mensajes son para otras salas.' };
  if (!destino.habitante) return { ok: false, texto: `La sala «${destino.nombre}» no tiene habitante.` };
  if (!mensaje.trim()) return { ok: false, texto: 'El mensaje está vacío.' };
  const k = clave?.trim().toUpperCase() || undefined;
  if (k && !KEY.test(k)) return { ok: false, texto: `«${clave}» no parece la clave de una tarea (ABC-123). Sin tarea, envíalo sin clave.` };
  const ahora = ctx.ahora?.() ?? Date.now(), par = `${desde}>${destino.id}`;
  const recientes = (enviados.get(par) ?? []).filter(x => ahora - x < VENTANA);
  if (recientes.length >= LIMITE) return { ok: false, texto: `Ya has enviado ${LIMITE} mensajes a «${destino.nombre}» en el último minuto: espera antes de enviar otro.` };
  const texto = [
    tr('prompt.room.from', { sala: origen?.nombre ?? desde, habitante: origen?.habitante?.nombre ?? '?', tarea: k ? tr('prompt.room.task', { clave: k }) : '' }),
    '', mensaje.trim(), '', tr('prompt.room.reply', { salaId: desde }),
  ].join('\n');
  let como: string;
  const abierta = k ? ctx.sesionDeTarea(destino.id, k) : undefined;
  if (abierta && ctx.avisar(abierta, texto)) como = `a su conversación abierta de ${k}`;
  else {
    const cwd = k ? ctx.worktreeDeTarea(destino.id, k) : undefined;
    // sin worktree de la tarea, uno nuevo: la clave y el asunto en su nombre (la primera línea, sin repetir la clave)
    const worktree = k && !cwd ? nombreWorktree(`${k} ${mensaje.trim().split('\n')[0].replace(new RegExp(k, 'ig'), '')}`, ahora) : undefined;
    try { await ctx.empezar(destino.id, destino.habitante.id, texto, cwd ? { cwd } : worktree ? { worktree } : undefined); }
    catch (e) { return { ok: false, texto: `No he podido empezar la conversación en «${destino.nombre}»: ${(e as Error).message}` }; }
    como = cwd ? `en una conversación nueva en el worktree de ${k}` : worktree ? `en una conversación nueva en un worktree nuevo para ${k} (rama worktree-${worktree}: renómbrala si el repo pide otro nombre)` : 'en una conversación nueva en su copia principal';
  }
  enviados.set(par, [...recientes, ahora]);
  ctx.mensajero(desde, [destino.id], 'cambio');
  const resumen = mensaje.trim().replace(/\s+/g, ' ');
  ctx.aviso(tr('server.roomMessage', { desde: origen?.nombre ?? desde, a: destino.nombre, resumen: resumen.length > 90 ? resumen.slice(0, 89) + '…' : resumen }));
  return { ok: true, texto: `Enviado a ${destino.habitante.nombre} («${destino.nombre}») ${como}.` };
}

const texto = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

export function mcpRooms(ctx: CtxRooms, desde: string) {
  const otras = ctx.salas().filter(s => s.id !== desde && s.habitante);
  return createSdkMcpServer({
    name: 'salas', version: '1.0.0',
    tools: [
      tool('enviar_a_sala', `work-shelter (el juego desde el que te manejan): pásale un mensaje o un encargo al habitante de otra sala del refugio (cada sala de repo es un repositorio). Sin clave, empieza una conversación nueva con él en su copia principal (para encargarle trabajo: «investiga X», «revisa Y»); con la clave de una tarea (ABC-123), va a su conversación abierta de esa tarea o, si no la hay, empieza una en el worktree de la tarea (si no tiene, en uno nuevo). Los planes y documentos que deba leer, enlázalos con su ruta absoluta (/Users/…): le salen en sus páginas. El habitante no ve esta conversación: el mensaje tiene que bastar por sí solo. Salas: ${otras.map(s => `${s.id} (${s.nombre})`).join(', ')}.`,
        {
          sala: z.string().describe('id o nombre de la sala'),
          mensaje: z.string().describe('lo que tiene que saber o hacer, con todo el contexto necesario'),
          clave: z.string().optional().describe('clave de la tarea (ABC-123), solo si el mensaje es de una tarea en la que esa sala ya trabaja'),
        },
        async (args) => { const r = await sendToRoom(ctx, desde, args); return r.ok ? texto(r.texto) : { ...texto(r.texto), isError: true }; }, { alwaysLoad: true }),
    ],
  });
}
