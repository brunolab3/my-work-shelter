// The game's MCP tools as a dweller sees them: English tool and parameter names, and the English parameters reach the
// handlers (they map them to the internal Spanish fields).
import { describe, it, expect, beforeEach } from 'vitest';
import { mcpRooms, forgetLimits, type CtxRooms } from './avisosSalas.ts';
import { mcpReview } from './comparar.ts';
import { mcpAssignment, mcpPlan } from './reparto.ts';
import { mcpDecor } from './decoradoSala.ts';

const tools = (s: any): Record<string, any> => s.instance._registeredTools;
const params = (x: any): string[] => { const sh = x.inputSchema?.shape ?? {}; return Object.keys(sh).flatMap(k => { const el = sh[k]?.unwrap?.()?.element ?? sh[k]?.element; return [k, ...Object.keys(el?.shape ?? {})]; }); };
const call = (s: any, name: string, args: unknown) => { const x = tools(s)[name]; return (x.handler ?? x.callback)(args, {}); };
const SPANISH = /^(sala|mensaje|clave|cuando|trabajos|titulo|instrucciones|espera_a|cambios|afectadas|orden|propuesta|buscar|decorado|sinCommit|carpeta|estado|nota)$/;

describe('game MCP tools', () => {
  beforeEach(() => forgetLimits());

  it('servers, tools and parameters are named in English', () => {
    const plans = { get: () => undefined, ofRoom: () => [] } as any;
    const servers = [
      mcpRooms({ salas: () => [] } as any, 'a', undefined, true),
      mcpReview(() => '/tmp', { estado: async () => '', responder: async () => '' }),
      mcpAssignment({ salas: () => [], planes: plans } as any, { coordinacion: 'c', salaId: 'c', preguntar: async () => true }),
      mcpPlan({ planes: plans } as any, { salaId: 'a', sala: 'A' }),
      mcpDecor('a', { sala: () => undefined } as any),
    ];
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
