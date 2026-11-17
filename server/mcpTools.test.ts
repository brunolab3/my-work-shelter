// The game's MCP tools as a dweller sees them: English tool and parameter names, and the English parameters reach the
// handlers (they map them to the internal Spanish fields).
import { describe, it, expect, beforeEach } from 'vitest';
import { mcpRooms, forgetLimits, type CtxRooms } from './avisosSalas.ts';
import { mcpReview } from './comparar.ts';
import { mcpAssignment, mcpPlan } from './reparto.ts';
import { mcpDecor } from './decoradoSala.ts';
import { MCP, mcpTool } from './servidoresMcp.ts';
import { describeTool } from './herramientas.ts';
import { t } from '../shared/idioma.ts';

const tools = (s: any): Record<string, any> => s.instance._registeredTools;
const params = (x: any): string[] => { const sh = x.inputSchema?.shape ?? {}; return Object.keys(sh).flatMap(k => { const el = sh[k]?.unwrap?.()?.element ?? sh[k]?.element; return [k, ...Object.keys(el?.shape ?? {})]; }); };
const call = (s: any, name: string, args: unknown) => { const x = tools(s)[name]; return (x.handler ?? x.callback)(args, {}); };
const SPANISH = /^(sala|mensaje|clave|cuando|trabajos|titulo|instrucciones|espera_a|cambios|afectadas|orden|propuesta|buscar|decorado|sinCommit|carpeta|estado|nota)$/;

describe('game MCP tools', () => {
  beforeEach(() => forgetLimits());

  const plans = { get: () => undefined, ofRoom: () => [] } as any;
  const allServers = () => [
    mcpRooms({ salas: () => [] } as any, 'a', undefined, true),
    mcpReview(() => '/tmp', { estado: async () => '', responder: async () => '' }),
    mcpAssignment({ salas: () => [], planes: plans } as any, { coordinacion: 'c', salaId: 'c', preguntar: async () => true }),
    mcpPlan({ planes: plans } as any, { salaId: 'a', sala: 'A' }),
    mcpDecor('a', { sala: () => undefined } as any),
  ];

  it('servers, tools and parameters are named in English', () => {
    const servers = allServers();
    expect(servers.map(s => s.name)).toEqual([MCP.rooms, MCP.review, MCP.assignment, MCP.plan, MCP.shelter]);
    expect(servers.map(s => s.name)).toEqual(['rooms', 'review', 'assignment', 'plan', 'shelter']);
    const all = servers.flatMap(s => Object.entries(tools(s)));
    expect(all.map(([n]) => n).sort()).toEqual(['apply_decor', 'assign_work', 'compare_changes', 'current_decor', 'notify_room', 'preflight_answer', 'preflight_status',
      'propose_plan_change', 'props_catalogue', 'read_plan', 'remove_decor', 'request_worktree_cleanup', 'send_to_room', 'shared_plan', 'shelter_rooms', 'update_plan', 'view_room']);
    const byName = Object.fromEntries(all);
    expect(params(byName.send_to_room)).toEqual(['room', 'message', 'key', 'thread']);
    expect(params(byName.request_worktree_cleanup)).toEqual(['note']);
    expect(params(byName.assign_work)).toEqual(['key', 'plan', 'jobs', 'room', 'title', 'instructions', 'wait_for']);
    expect(all.flatMap(([n, x]) => params(x).filter(p => SPANISH.test(p)).map(p => `${n}.${p}`))).toEqual([]);
  });

  // sesiones.ts keys each server by its name, so `mcp__<name>__<tool>` is what a session sees: the activity labels must match it
  it('the activity labels name tools the servers really have', () => {
    const generic = (n: string) => t('server.activity.using', { nombre: n.split('__').slice(1).join(' › ') });
    const labelled = [...new Set([...allServers(), mcpRooms({ salas: () => [], programados: {} } as any, 'a', 's1')].flatMap(sv => Object.keys(tools(sv)).map(tl => mcpTool(sv.name as any, tl))))].filter(n => describeTool(n, {}, '/tmp') !== generic(n));
    expect(labelled.sort()).toEqual(['mcp__assignment__assign_work', 'mcp__assignment__shelter_rooms', 'mcp__rooms__schedule_message', 'mcp__rooms__send_to_room',
      'mcp__shelter__apply_decor', 'mcp__shelter__current_decor', 'mcp__shelter__props_catalogue', 'mcp__shelter__remove_decor', 'mcp__shelter__view_room']);
  });

  it('send_to_room takes room, message and key', async () => {
    const started: { salaId: string; prompt: string }[] = [];
    const ctx: CtxRooms = {
      salas: () => [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'Bravo', habitante: { id: 'hb', nombre: 'Bea' } }],
      sesionDeTarea: () => undefined, worktreeDeTarea: async () => '/repo/b-wt', avisar: () => false,
      empezar: async (salaId, _d, prompt) => { started.push({ salaId, prompt }); return { id: 's1', enWorktree: true }; },
      mensajero: () => {}, aviso: () => {},
    };
    const r = await call(mcpRooms(ctx, 'a'), 'send_to_room', { room: 'b', message: 'look at the API', key: 'abc-12' });
    expect(r.isError).toBeFalsy();
    expect(started).toHaveLength(1);
    expect(started[0].salaId).toBe('b');
    expect(started[0].prompt).toContain('look at the API');
    expect(started[0].prompt).toContain('ABC-12');
  });

  it('preflight_answer maps status and note', async () => {
    const got: unknown[] = [];
    const s = mcpReview(() => '/tmp/wt', { estado: async () => '', responder: async (cwd, item, estado, nota) => { got.push([cwd, item, estado, nota]); return 'ok'; } });
    await call(s, 'preflight_answer', { item: '2', status: 'pending', note: 'later' });
    await call(s, 'preflight_answer', { item: '3', status: 'n/a', note: 'no UI' });
    expect(got).toEqual([['/tmp/wt', '2', 'pendiente', 'later'], ['/tmp/wt', '3', 'n/a', 'no UI']]);
  });
});

describe('scheduled messages tools', () => {
  it('schedule_message takes when, message, room and key', async () => {
    const got: unknown[] = [];
    const programados = { programar: (d: string, s: string | undefined, a: unknown) => { got.push([d, s, a]); return { ok: true, texto: 'ok' }; }, deConversacion: () => [], cancelar: () => true };
    const s = mcpRooms({ salas: () => [], programados } as any, 'a', 's1');
    expect(Object.keys(tools(s)).sort()).toEqual(['cancel_scheduled', 'list_scheduled', 'schedule_message', 'send_to_room']);
    expect(params(tools(s).schedule_message)).toEqual(['when', 'message', 'room', 'key']);
    await call(s, 'schedule_message', { when: '2026-11-17', message: 'review', room: 'b', key: 'ABC-1' });
    expect(got).toEqual([['a', 's1', { cuando: '2026-11-17', mensaje: 'review', sala: 'b', clave: 'ABC-1' }]]);
  });
});
