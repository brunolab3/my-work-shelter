import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRoom, workPrompt, dispatch, updatePlan, notifyRoom, type CtxAssignment, type AssignmentRoom } from './dispatch.ts';
import { Plans, textPlan, tasksOrder } from './plans.ts';
import { worktreeName } from './sessions.ts';
import { jiraKeys } from '../shared/board.ts';

const ROOMS: AssignmentRoom[] = [
  { id: 'api', name: 'api', path: '/raiz/api', dweller: 'Remi', inIsWing: true },
  { id: 'web', name: 'Web', path: '/raiz/web', dweller: 'Lola', inIsWing: true },
  { id: 'vacia', name: 'vacia', path: '/raiz/vacia', inIsWing: true },
];
const pathRoom = (r: string) => ROOMS.find(s => r === s.path || r.startsWith(s.path + '/'))?.id;
function ctxFake(fail: string[] = [], closed: string[] = []) {
  const started: { roomId: string; prompt: string }[] = [];
  const notices: { sessionId: string; text: string }[] = [], trips: { since: string; a: string[] }[] = [];
  const ctx: CtxAssignment = {
    rooms: () => ROOMS, pathRoom,
    start: async (roomId, prompt) => { if (fail.includes(roomId)) throw new Error('límite de sesiones'); started.push({ roomId, prompt }); return { sessionId: 's-' + roomId, dweller: ROOMS.find(s => s.id === roomId)!.dweller! }; },
    plans: new Plans(mkdtempSync(path.join(os.tmpdir(), 'planes-'))),
    notify: (sessionId, text) => { if (closed.includes(sessionId)) return false; notices.push({ sessionId, text }); return true; },
    messenger: (since, a) => { trips.push({ since, a }); },
  };
  return { ctx, started, notices, trips };
}
const OPTION = { coordination: 'Planificación', roomId: 'tareas', sessionId: 's-plan', ask: async () => true };

describe('buscarSala', () => {
  it('por id, por nombre sin mayúsculas o por una carpeta dentro del repo', () => {
    expect(findRoom(ROOMS, 'api', pathRoom)?.id).toBe('api');
    expect(findRoom(ROOMS, 'web', pathRoom)?.id).toBe('web');
    expect(findRoom(ROOMS, '/raiz/web/src', pathRoom)?.id).toBe('web');
    expect(findRoom(ROOMS, 'otra', pathRoom)).toBeUndefined();
  });
});

describe('promptTrabajo', () => {
  it('empieza por la clave y el título, así la rama del worktree lleva la clave y el tablero cruza sus PR con la tarea', () => {
    const p = workPrompt({ room: 'api', title: 'Endpoint de reservas', instructions: 'Añade POST /reservas.' }, { key: 'ABC-12', coordination: 'raiz', others: [{ room: 'Web', title: 'Formulario' }] });
    expect(p.split('\n')[0]).toBe('ABC-12 Endpoint de reservas');
    expect(jiraKeys(worktreeName(p.slice(0, 80)), new Set(['ABC']))).toEqual(['ABC-12']);
    expect(p).toContain('Añade POST /reservas.');
    expect(p).toContain('Web (Formulario)');
  });
});

describe('repartir', () => {
  const ask = (answer: boolean) => { const seen: string[] = []; return { seen, ask: async (t: string) => { seen.push(t); return answer; } }; };

  it('con el sí del Supervisor, empieza un trabajo en cada sala con sus instrucciones', async () => {
    const { ctx, started } = ctxFake(); const p = ask(true);
    const r = await dispatch(ctx, { ...OPTION, ask: p.ask }, 'ABC-12', [
      { room: 'api', title: 'Endpoint', instructions: 'backend' }, { room: 'web', title: 'Formulario', instructions: 'frontend' },
    ]);
    expect(r.ok).toBe(true);
    expect(p.seen[0]).toContain('estos 2 trabajos de ABC-12');
    expect(started.map(e => e.roomId)).toEqual(['api', 'web']);
    expect(started[0].prompt).toMatch(/^ABC-12 Endpoint\n\nbackend/);
    expect(started[1].prompt).toMatch(/^ABC-12 Formulario\n\nfrontend/);
  });
  it('si el Supervisor dice que no, no empieza nada', async () => {
    const { ctx, started } = ctxFake();
    const r = await dispatch(ctx, { ...OPTION, ask: ask(false).ask }, 'ABC-12', [{ room: 'api', title: 'x', instructions: 'y' }]);
    expect(r.ok).toBe(false);
    expect(started).toEqual([]);
  });
  it('una sala que no existe, sin habitante o repetida: no pregunta ni empieza nada', async () => {
    for (const jobs of [
      [{ room: 'api', title: 'a', instructions: 'a' }, { room: 'nada', title: 'b', instructions: 'b' }],
      [{ room: 'vacia', title: 'a', instructions: 'a' }],
      [{ room: 'api', title: 'a', instructions: 'a' }, { room: '/raiz/api', title: 'b', instructions: 'b' }],
    ]) {
      const { ctx, started } = ctxFake(); const p = ask(true);
      const r = await dispatch(ctx, { ...OPTION, ask: p.ask }, undefined, jobs);
      expect(r.ok).toBe(false);
      expect(p.seen).toEqual([]);
      expect(started).toEqual([]);
    }
  });
  it('si una sala no puede empezar, las demás sí y se dice cuál falló', async () => {
    const { ctx, started } = ctxFake(['api']);
    const r = await dispatch(ctx, { ...OPTION, ask: ask(true).ask }, 'ABC-12', [
      { room: 'api', title: 'a', instructions: 'a' }, { room: 'web', title: 'b', instructions: 'b' },
    ]);
    expect(started.map(e => e.roomId)).toEqual(['web']);
    expect(r.text).toContain('api: NO ha empezado: límite de sesiones');
    expect(r.text).toContain('Web: empezado con Lola');
  });
});

describe('plan compartido', () => {
  const ask = async () => true;
  const dispatched = async (closed: string[] = []) => {
    const x = ctxFake([], closed);
    await dispatch(x.ctx, { ...OPTION, ask: ask }, 'ABC-12', [{ room: 'api', title: 'Endpoint', instructions: 'backend' }, { room: 'web', title: 'Formulario', instructions: 'frontend' }], '# Plan\nv1');
    return x;
  };
  it('al repartir se guarda con la conversación de cada parte, el robot sale hacia sus salas y cada prompt dice cómo leerlo', async () => {
    const { ctx, started, trips } = await dispatched();
    const p = ctx.plans.get('ABC-12')!;
    expect(p).toMatchObject({ version: 1, text: '# Plan\nv1', coordination: 'tareas', coordinationSession: 's-plan' });
    expect(p.parts.map(x => [x.roomId, x.sessionId])).toEqual([['api', 's-api'], ['web', 's-web']]);
    expect(trips).toEqual([{ since: 'tareas', a: ['api', 'web'] }]);
    expect(started[0].prompt).toContain('plan ABC-12');
  });
  it('un cambio con salas afectadas solo avisa a esas, con su mensaje y la clave de la tarea delante', async () => {
    const { ctx, notices } = await dispatched();
    const r = updatePlan(ctx, OPTION, { id: 'ABC-12', plan: '# Plan\nv2', changes: 'el endpoint cambia de nombre', affected: [{ room: 'Web', message: 'llama a /reservas-v2' }] });
    expect(r.ok).toBe(true);
    expect(ctx.plans.get('ABC-12')).toMatchObject({ version: 2, text: '# Plan\nv2' });
    expect(notices).toHaveLength(1);
    expect(notices[0].sessionId).toBe('s-web');
    expect(notices[0].text).toMatch(/^📋 \[ABC-12\] .*versión 2.*llama a \/reservas-v2/);
  });
  it('sin salas afectadas avisa a todas; una sala que no está en el plan no cambia nada', async () => {
    const { ctx, notices } = await dispatched();
    expect(updatePlan(ctx, OPTION, { id: 'ABC-12', plan: 'x', changes: 'c', affected: [{ room: 'vacia', message: 'm' }] }).ok).toBe(false);
    expect(ctx.plans.get('ABC-12')!.version).toBe(1);
    updatePlan(ctx, OPTION, { plan: 'x', changes: 'c' });
    expect(notices.map(a => a.sessionId)).toEqual(['s-api', 's-web']);
  });
  it('un mensaje a una sala por la clave de la tarea va a su conversación; si ya está cerrada, lo dice', async () => {
    const { ctx, notices } = await dispatched(['s-api']);
    expect(notifyRoom(ctx, OPTION, { key: 'ABC-12', room: 'web', message: 'espera al contrato' }).text).toContain('Avisadas: Web');
    expect(notices[0]).toEqual({ sessionId: 's-web', text: '📋 [ABC-12] Mensaje de la sala de logística: espera al contrato' });
    expect(notifyRoom(ctx, OPTION, { key: 'ABC-12', room: 'api', message: 'm' }).text).toContain('Sin conversación abierta');
    expect(notifyRoom(ctx, OPTION, { key: 'XYZ-1', room: 'api', message: 'm' }).ok).toBe(false);
  });
  it('si la conversación anotada ya no está, el aviso va a la abierta en el worktree de la tarea', async () => {
    const { ctx, notices } = await dispatched(['s-api']);
    ctx.sessionOfTask = (roomId, key) => (roomId === 'api' && key === 'ABC-12' ? 's-api-2' : undefined);
    notifyRoom(ctx, OPTION, { key: 'ABC-12', room: 'api', message: 'm' });
    expect(notices.map(a => a.sessionId)).toEqual(['s-api-2']);
    expect(ctx.plans.get('ABC-12')!.parts.find(x => x.roomId === 'api')!.sessionId).toBe('s-api-2');
  });
});

describe('orden de fusión entre partes (espera_a)', () => {
  it('se guarda en el plan, sale en el prompt de la parte que espera y llega al tablero por repo de GitHub', async () => {
    const { ctx, started } = ctxFake();
    const r = await dispatch(ctx, OPTION, 'ABC-12', [
      { room: 'api', title: 'Endpoint', instructions: 'backend' }, { room: 'web', title: 'Formulario', instructions: 'frontend', waits_on: ['api'] },
    ], 'El plan');
    expect(r.ok).toBe(true);
    const plan = ctx.plans.get('ABC-12')!;
    expect(plan.parts.map(x => [x.roomId, x.waitA])).toEqual([['api', undefined], ['web', ['api']]]);
    expect(started[1].prompt).toContain('Tu parte se fusiona después de la de api');
    expect(started[0].prompt).not.toContain('se fusiona después');
    expect(textPlan(plan)).toContain('- Web: Formulario (se fusiona después de api)');
    const repos: Record<string, string> = { api: 'refugio/api', web: 'refugio/web' };
    expect(await tasksOrder(ctx.plans.all(), async id => repos[id])).toEqual([{ key: 'ABC-12', repo: 'refugio/web', waitA: ['refugio/api'] }]);
  });

  it('esperar a una sala que no es parte del plan no reparte nada', async () => {
    const { ctx, started } = ctxFake();
    const r = await dispatch(ctx, OPTION, 'ABC-12', [{ room: 'web', title: 'Formulario', instructions: 'frontend', waits_on: ['vacia'] }], 'El plan');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('«vacia» no es una parte del plan');
    expect(started).toEqual([]);
  });

  it('update_plan cambia el orden; vacío, ya no espera a nadie', async () => {
    const { ctx } = ctxFake();
    await dispatch(ctx, OPTION, 'ABC-12', [{ room: 'api', title: 'Endpoint', instructions: 'b' }, { room: 'web', title: 'Formulario', instructions: 'f' }], 'El plan');
    expect(updatePlan(ctx, OPTION, { plan: 'v2', changes: 'orden', orden: [{ room: 'api', waits_on: ['Web'] }] }).ok).toBe(true);
    expect(ctx.plans.get('ABC-12')!.parts.find(x => x.roomId === 'api')!.waitA).toEqual(['web']);
    expect(updatePlan(ctx, OPTION, { plan: 'v3', changes: 'sin orden', orden: [{ room: 'api', waits_on: [] }] }).ok).toBe(true);
    expect(ctx.plans.get('ABC-12')!.parts.find(x => x.roomId === 'api')!.waitA).toEqual([]);
    const fail = updatePlan(ctx, OPTION, { plan: 'v4', changes: 'x', orden: [{ room: 'api', waits_on: ['otra'] }] });
    expect(fail.ok).toBe(false);
    expect(ctx.plans.get('ABC-12')!.version).toBe(3);
  });
});
