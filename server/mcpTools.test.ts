// The game's MCP tools as a dweller sees them: English tool and parameter names, and the English parameters reach the
// handlers (they map them to the internal Spanish fields).
import { describe, it, expect, beforeEach } from 'vitest';
import { mcpRooms, forgetLimits, type CtxRooms } from './roomNotices.ts';
import { mcpReview } from './compare.ts';
import { mcpAssignment, mcpPlan } from './dispatch.ts';
import { mcpDecor } from './roomDecor.ts';
import { MCP, mcpTool } from './mcpServers.ts';
import { describeTool } from './tools.ts';
import { t } from '../shared/language.ts';

const tools = (s: any): Record<string, any> => s.instance._registeredTools;
const params = (x: any): string[] => { const sh = x.inputSchema?.shape ?? {}; return Object.keys(sh).flatMap(k => { const el = sh[k]?.unwrap?.()?.element ?? sh[k]?.element; return [k, ...Object.keys(el?.shape ?? {})]; }); };
const call = (s: any, name: string, args: unknown) => { const x = tools(s)[name]; return (x.handler ?? x.callback)(args, {}); };
const SPANISH = /^(sala|mensaje|clave|cuando|trabajos|titulo|instrucciones|espera_a|cambios|afectadas|orden|propuesta|buscar|decorado|sinCommit|carpeta|estado|nota)$/;

describe('game MCP tools', () => {
  beforeEach(() => forgetLimits());

  const plans = { get: () => undefined, ofRoom: () => [] } as any;
  const allServers = () => [
    mcpRooms({ rooms: () => [] } as any, 'a', undefined, true),
    mcpReview(() => '/tmp', { state: async () => '', respond: async () => '' }),
    mcpAssignment({ rooms: () => [], plans } as any, { coordination: 'c', roomId: 'c', ask: async () => true }),
    mcpPlan({ plans } as any, { roomId: 'a', room: 'A' }),
    mcpDecor('a', { room: () => undefined } as any),
  ];

  it('servers, tools and parameters are named in English', () => {
    const servers = allServers();
    expect(servers.map(s => s.name)).toEqual([MCP.rooms, MCP.review, MCP.assignment, MCP.plan, MCP.shelter]);
    expect(servers.map(s => s.name)).toEqual(['rooms', 'review', 'assignment', 'plan', 'shelter']);
    const all = servers.flatMap(s => Object.entries(tools(s)));
    expect(all.map(([n]) => n).sort()).toEqual(['apply_decor', 'assign_work', 'compare_changes', 'current_decor', 'notify_room', 'preflight_answer', 'preflight_status',
      'propose_plan_change', 'props_catalogue', 'read_plan', 'remove_decor', 'request_worktree_cleanup', 'send_to_room', 'shared_plan', 'shelter_rooms', 'update_plan', 'view_room']);
    const byName = Object.fromEntries(all);
    expect(params(byName.send_to_room)).toEqual(['room', 'message', 'purpose', 'key', 'thread']);
    // only a job, a result, a blocker or a question: required, and status is not an option
    const purpose = byName.send_to_room.inputSchema.shape.purpose;
    expect(purpose.isOptional()).toBe(false);
    expect(purpose.options).toEqual(['job', 'result', 'blocker', 'question']);
    expect(purpose.safeParse('status').success).toBe(false);
    expect(params(byName.request_worktree_cleanup)).toEqual(['note']);
    expect(params(byName.assign_work)).toEqual(['key', 'plan', 'jobs', 'room', 'title', 'instructions', 'wait_for']);
    expect(all.flatMap(([n, x]) => params(x).filter(p => SPANISH.test(p)).map(p => `${n}.${p}`))).toEqual([]);
  });

  // sessions.ts keys each server by its name, so `mcp__<name>__<tool>` is what a session sees: the activity labels must match it
  it('the activity labels name tools the servers really have', () => {
    const generic = (n: string) => t('server.activity.using', { nombre: n.split('__').slice(1).join(' › ') });
    const labelled = [...new Set([...allServers(), mcpRooms({ rooms: () => [], scheduled: {}, verifications: {} } as any, 'a', 's1')].flatMap(sv => Object.keys(tools(sv)).map(tl => mcpTool(sv.name as any, tl))))].filter(n => describeTool(n, {}, '/tmp') !== generic(n));
    expect(labelled.sort()).toEqual(['mcp__assignment__assign_work', 'mcp__assignment__shelter_rooms', 'mcp__rooms__schedule_message', 'mcp__rooms__send_to_room', 'mcp__rooms__verification_plan', 'mcp__rooms__verification_report',
      'mcp__shelter__apply_decor', 'mcp__shelter__current_decor', 'mcp__shelter__props_catalogue', 'mcp__shelter__remove_decor', 'mcp__shelter__view_room']);
  });

  it('send_to_room takes room, message and key', async () => {
    const started: { roomId: string; prompt: string }[] = [];
    const ctx: CtxRooms = {
      rooms: () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'Bravo', dweller: { id: 'hb', name: 'Bea' } }],
      sessionOfTask: () => undefined, worktreeOfTask: async () => '/repo/b-wt', notify: () => false,
      start: async (roomId, _d, prompt) => { started.push({ roomId, prompt }); return { id: 's1', inWorktree: true }; },
      notice: () => {},
    };
    const r = await call(mcpRooms(ctx, 'a'), 'send_to_room', { room: 'b', message: 'look at the API', purpose: 'job', key: 'abc-12' });
    expect(r.isError).toBeFalsy();
    expect(started).toHaveLength(1);
    expect(started[0].roomId).toBe('b');
    expect(started[0].prompt).toContain('look at the API');
    expect(started[0].prompt).toContain('ABC-12');
  });

  it('preflight_answer maps status and note', async () => {
    const got: unknown[] = [];
    const s = mcpReview(() => '/tmp/wt', { state: async () => '', respond: async (cwd, item, state, note) => { got.push([cwd, item, state, note]); return 'ok'; } });
    await call(s, 'preflight_answer', { item: '2', status: 'pending', note: 'later' });
    await call(s, 'preflight_answer', { item: '3', status: 'n/a', note: 'no UI' });
    expect(got).toEqual([['/tmp/wt', '2', 'pendiente', 'later'], ['/tmp/wt', '3', 'n/a', 'no UI']]);
  });
});

describe('scheduled messages tools', () => {
  it('schedule_message takes when, message, room and key', async () => {
    const got: unknown[] = [];
    const scheduled = { schedule: (d: string, s: string | undefined, a: unknown) => { got.push([d, s, a]); return { ok: true, text: 'ok' }; }, ofConversation: () => [], cancel: () => true };
    const s = mcpRooms({ rooms: () => [], scheduled } as any, 'a', 's1');
    expect(Object.keys(tools(s)).sort()).toEqual(['cancel_scheduled', 'list_scheduled', 'schedule_message', 'send_to_room']);
    expect(params(tools(s).schedule_message)).toEqual(['when', 'message', 'room', 'key']);
    await call(s, 'schedule_message', { when: '2026-11-17', message: 'review', room: 'b', key: 'ABC-1' });
    expect(got).toEqual([['a', 's1', { when: '2026-11-17', message: 'review', room: 'b', key: 'ABC-1' }]]);
  });
});

describe('verification tools', () => {
  it('verification_plan and verification_report take the task of the conversation\'s worktree, or a key', async () => {
    const got: unknown[] = [];
    const plan = { key: 'ABC-1', version: 1, updated: 0, points: [] };
    const plans = { get: () => plan, propose: (k: string, i: unknown, c: unknown) => { got.push(['plan', k, i, c]); return { ok: true, value: plan }; }, report: (k: string, r: unknown) => { got.push(['report', k, r]); return { ok: false, error: 'notLive', vars: { id: 'final' } }; } };
    const s = mcpRooms({ rooms: () => [], verifications: { plans, taskOfSession: (id: string) => (id === 's1' ? 'ABC-1' : undefined) } } as any, 'a', 's1');
    expect(params(tools(s).verification_report)).toEqual(['key', 'checkpoint', 'event', 'signal', 'service', 'evidence', 'hours']);
    const cps = [{ id: 'final', kind: 'final', signals: [{ id: 'ran', kind: 'must-run', what: 'it runs', where: 'log «ok»' }] }];
    expect((await call(s, 'verification_plan', { checkpoints: cps })).isError).toBeFalsy();
    const r = await call(s, 'verification_report', { key: 'xyz-9', checkpoint: 'final', event: 'evidenced', signal: 'ran', evidence: 'ran twice' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe(t('verification.error.notLive', { id: 'final' }));
    expect(got).toEqual([['plan', 'ABC-1', { checkpoints: cps }, undefined], ['report', 'XYZ-9', { checkpoint: 'final', event: 'evidenced', signal: 'ran', evidence: 'ran twice' }]]);
    const withoutTask = mcpRooms({ rooms: () => [], verifications: { plans, taskOfSession: () => undefined } } as any, 'a', 's2');
    expect((await call(withoutTask, 'verification_plan', { checkpoints: cps })).isError).toBe(true);
  });
});
