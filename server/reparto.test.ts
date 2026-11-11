import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buscarSala, promptTrabajo, repartir, updatePlan, notifyRoom, type CtxAssignment, type AssignmentRoom } from './reparto.ts';
import { Plans, textPlan, tasksOrder } from './planes.ts';
import { nombreWorktree } from './sesiones.ts';
import { clavesJira } from '../shared/tablero.ts';

const SALAS: AssignmentRoom[] = [
  { id: 'api', nombre: 'api', ruta: '/raiz/api', habitante: 'Remi', inIsWing: true },
  { id: 'web', nombre: 'Web', ruta: '/raiz/web', habitante: 'Lola', inIsWing: true },
  { id: 'vacia', nombre: 'vacia', ruta: '/raiz/vacia', inIsWing: true },
];
const pathRoom = (r: string) => SALAS.find(s => r === s.ruta || r.startsWith(s.ruta + '/'))?.id;
function ctxFake(fail: string[] = [], closed: string[] = []) {
  const empezados: { salaId: string; prompt: string }[] = [];
  const avisos: { sesionId: string; texto: string }[] = [], trips: { desde: string; a: string[] }[] = [];
  const ctx: CtxAssignment = {
    salas: () => SALAS, pathRoom,
    empezar: async (salaId, prompt) => { if (fail.includes(salaId)) throw new Error('límite de sesiones'); empezados.push({ salaId, prompt }); return { sesionId: 's-' + salaId, habitante: SALAS.find(s => s.id === salaId)!.habitante! }; },
    planes: new Plans(mkdtempSync(path.join(os.tmpdir(), 'planes-'))),
    avisar: (sesionId, texto) => { if (closed.includes(sesionId)) return false; avisos.push({ sesionId, texto }); return true; },
    mensajero: (desde, a) => { trips.push({ desde, a }); },
  };
  return { ctx, empezados, avisos, trips };
}
const OPTION = { coordinacion: 'Planificación', salaId: 'tareas', sesionId: 's-plan', preguntar: async () => true };

describe('buscarSala', () => {
  it('por id, por nombre sin mayúsculas o por una carpeta dentro del repo', () => {
    expect(buscarSala(SALAS, 'api', pathRoom)?.id).toBe('api');
    expect(buscarSala(SALAS, 'web', pathRoom)?.id).toBe('web');
    expect(buscarSala(SALAS, '/raiz/web/src', pathRoom)?.id).toBe('web');
    expect(buscarSala(SALAS, 'otra', pathRoom)).toBeUndefined();
  });
});

describe('promptTrabajo', () => {
  it('empieza por la clave y el título, así la rama del worktree lleva la clave y el tablero cruza sus PR con la tarea', () => {
    const p = promptTrabajo({ sala: 'api', titulo: 'Endpoint de reservas', instrucciones: 'Añade POST /reservas.' }, { clave: 'ABC-12', coordinacion: 'raiz', otros: [{ sala: 'Web', titulo: 'Formulario' }] });
    expect(p.split('\n')[0]).toBe('ABC-12 Endpoint de reservas');
    expect(clavesJira(nombreWorktree(p.slice(0, 80)), new Set(['ABC']))).toEqual(['ABC-12']);
    expect(p).toContain('Añade POST /reservas.');
    expect(p).toContain('Web (Formulario)');
  });
});

describe('repartir', () => {
  const ask = (respuesta: boolean) => { const seen: string[] = []; return { seen, preguntar: async (t: string) => { seen.push(t); return respuesta; } }; };

  it('con el sí del Supervisor, empieza un trabajo en cada sala con sus instrucciones', async () => {
    const { ctx, empezados } = ctxFake(); const p = ask(true);
    const r = await repartir(ctx, { ...OPTION, preguntar: p.preguntar }, 'ABC-12', [
      { sala: 'api', titulo: 'Endpoint', instrucciones: 'backend' }, { sala: 'web', titulo: 'Formulario', instrucciones: 'frontend' },
    ]);
    expect(r.ok).toBe(true);
    expect(p.seen[0]).toContain('estos 2 trabajos de ABC-12');
    expect(empezados.map(e => e.salaId)).toEqual(['api', 'web']);
    expect(empezados[0].prompt).toMatch(/^ABC-12 Endpoint\n\nbackend/);
    expect(empezados[1].prompt).toMatch(/^ABC-12 Formulario\n\nfrontend/);
  });
  it('si el Supervisor dice que no, no empieza nada', async () => {
    const { ctx, empezados } = ctxFake();
    const r = await repartir(ctx, { ...OPTION, preguntar: ask(false).preguntar }, 'ABC-12', [{ sala: 'api', titulo: 'x', instrucciones: 'y' }]);
    expect(r.ok).toBe(false);
    expect(empezados).toEqual([]);
  });
  it('una sala que no existe, sin habitante o repetida: no pregunta ni empieza nada', async () => {
    for (const trabajos of [
      [{ sala: 'api', titulo: 'a', instrucciones: 'a' }, { sala: 'nada', titulo: 'b', instrucciones: 'b' }],
      [{ sala: 'vacia', titulo: 'a', instrucciones: 'a' }],
      [{ sala: 'api', titulo: 'a', instrucciones: 'a' }, { sala: '/raiz/api', titulo: 'b', instrucciones: 'b' }],
    ]) {
      const { ctx, empezados } = ctxFake(); const p = ask(true);
      const r = await repartir(ctx, { ...OPTION, preguntar: p.preguntar }, undefined, trabajos);
      expect(r.ok).toBe(false);
      expect(p.seen).toEqual([]);
      expect(empezados).toEqual([]);
    }
  });
  it('si una sala no puede empezar, las demás sí y se dice cuál falló', async () => {
    const { ctx, empezados } = ctxFake(['api']);
    const r = await repartir(ctx, { ...OPTION, preguntar: ask(true).preguntar }, 'ABC-12', [
      { sala: 'api', titulo: 'a', instrucciones: 'a' }, { sala: 'web', titulo: 'b', instrucciones: 'b' },
    ]);
    expect(empezados.map(e => e.salaId)).toEqual(['web']);
    expect(r.texto).toContain('api: NO ha empezado: límite de sesiones');
    expect(r.texto).toContain('Web: empezado con Lola');
  });
});

describe('plan compartido', () => {
  const ask = async () => true;
  const repartido = async (closed: string[] = []) => {
    const x = ctxFake([], closed);
    await repartir(x.ctx, { ...OPTION, preguntar: ask }, 'ABC-12', [{ sala: 'api', titulo: 'Endpoint', instrucciones: 'backend' }, { sala: 'web', titulo: 'Formulario', instrucciones: 'frontend' }], '# Plan\nv1');
    return x;
  };
  it('al repartir se guarda con la conversación de cada parte, el robot sale hacia sus salas y cada prompt dice cómo leerlo', async () => {
    const { ctx, empezados, trips } = await repartido();
    const p = ctx.planes.get('ABC-12')!;
    expect(p).toMatchObject({ version: 1, texto: '# Plan\nv1', coordinacion: 'tareas', coordinationSession: 's-plan' });
    expect(p.partes.map(x => [x.salaId, x.sesionId])).toEqual([['api', 's-api'], ['web', 's-web']]);
    expect(trips).toEqual([{ desde: 'tareas', a: ['api', 'web'] }]);
    expect(empezados[0].prompt).toContain('plan ABC-12');
  });
  it('un cambio con salas afectadas solo avisa a esas, con su mensaje y la clave de la tarea delante', async () => {
    const { ctx, avisos } = await repartido();
    const r = updatePlan(ctx, OPTION, { id: 'ABC-12', plan: '# Plan\nv2', cambios: 'el endpoint cambia de nombre', afectadas: [{ sala: 'Web', mensaje: 'llama a /reservas-v2' }] });
    expect(r.ok).toBe(true);
    expect(ctx.planes.get('ABC-12')).toMatchObject({ version: 2, texto: '# Plan\nv2' });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].sesionId).toBe('s-web');
    expect(avisos[0].texto).toMatch(/^📋 \[ABC-12\] .*versión 2.*llama a \/reservas-v2/);
  });
  it('sin salas afectadas avisa a todas; una sala que no está en el plan no cambia nada', async () => {
    const { ctx, avisos } = await repartido();
    expect(updatePlan(ctx, OPTION, { id: 'ABC-12', plan: 'x', cambios: 'c', afectadas: [{ sala: 'vacia', mensaje: 'm' }] }).ok).toBe(false);
    expect(ctx.planes.get('ABC-12')!.version).toBe(1);
    updatePlan(ctx, OPTION, { plan: 'x', cambios: 'c' });
    expect(avisos.map(a => a.sesionId)).toEqual(['s-api', 's-web']);
  });
  it('un mensaje a una sala por la clave de la tarea va a su conversación; si ya está cerrada, lo dice', async () => {
    const { ctx, avisos } = await repartido(['s-api']);
    expect(notifyRoom(ctx, OPTION, { clave: 'ABC-12', sala: 'web', mensaje: 'espera al contrato' }).texto).toContain('Avisadas: Web');
    expect(avisos[0]).toEqual({ sesionId: 's-web', texto: '📋 [ABC-12] Mensaje de la sala de planificación: espera al contrato' });
    expect(notifyRoom(ctx, OPTION, { clave: 'ABC-12', sala: 'api', mensaje: 'm' }).texto).toContain('Sin conversación abierta');
    expect(notifyRoom(ctx, OPTION, { clave: 'XYZ-1', sala: 'api', mensaje: 'm' }).ok).toBe(false);
  });
  it('si la conversación anotada ya no está, el aviso va a la abierta en el worktree de la tarea', async () => {
    const { ctx, avisos } = await repartido(['s-api']);
    ctx.sesionDeTarea = (salaId, clave) => (salaId === 'api' && clave === 'ABC-12' ? 's-api-2' : undefined);
    notifyRoom(ctx, OPTION, { clave: 'ABC-12', sala: 'api', mensaje: 'm' });
    expect(avisos.map(a => a.sesionId)).toEqual(['s-api-2']);
    expect(ctx.planes.get('ABC-12')!.partes.find(x => x.salaId === 'api')!.sesionId).toBe('s-api-2');
  });
});

describe('orden de fusión entre partes (espera_a)', () => {
  it('se guarda en el plan, sale en el prompt de la parte que espera y llega al tablero por repo de GitHub', async () => {
    const { ctx, empezados } = ctxFake();
    const r = await repartir(ctx, OPTION, 'ABC-12', [
      { sala: 'api', titulo: 'Endpoint', instrucciones: 'backend' }, { sala: 'web', titulo: 'Formulario', instrucciones: 'frontend', espera_a: ['api'] },
    ], 'El plan');
    expect(r.ok).toBe(true);
    const plan = ctx.planes.get('ABC-12')!;
    expect(plan.partes.map(x => [x.salaId, x.waitA])).toEqual([['api', undefined], ['web', ['api']]]);
    expect(empezados[1].prompt).toContain('Tu parte se fusiona después de la de api');
    expect(empezados[0].prompt).not.toContain('se fusiona después');
    expect(textPlan(plan)).toContain('- Web: Formulario (se fusiona después de api)');
    const repos: Record<string, string> = { api: 'refugio/api', web: 'refugio/web' };
    expect(await tasksOrder(ctx.planes.todos(), async id => repos[id])).toEqual([{ clave: 'ABC-12', repo: 'refugio/web', waitA: ['refugio/api'] }]);
  });

  it('esperar a una sala que no es parte del plan no reparte nada', async () => {
    const { ctx, empezados } = ctxFake();
    const r = await repartir(ctx, OPTION, 'ABC-12', [{ sala: 'web', titulo: 'Formulario', instrucciones: 'frontend', espera_a: ['vacia'] }], 'El plan');
    expect(r.ok).toBe(false);
    expect(r.texto).toContain('«vacia» no es una parte del plan');
    expect(empezados).toEqual([]);
  });

  it('actualizar_plan cambia el orden; vacío, ya no espera a nadie', async () => {
    const { ctx } = ctxFake();
    await repartir(ctx, OPTION, 'ABC-12', [{ sala: 'api', titulo: 'Endpoint', instrucciones: 'b' }, { sala: 'web', titulo: 'Formulario', instrucciones: 'f' }], 'El plan');
    expect(updatePlan(ctx, OPTION, { plan: 'v2', cambios: 'orden', orden: [{ sala: 'api', espera_a: ['Web'] }] }).ok).toBe(true);
    expect(ctx.planes.get('ABC-12')!.partes.find(x => x.salaId === 'api')!.waitA).toEqual(['web']);
    expect(updatePlan(ctx, OPTION, { plan: 'v3', cambios: 'sin orden', orden: [{ sala: 'api', espera_a: [] }] }).ok).toBe(true);
    expect(ctx.planes.get('ABC-12')!.partes.find(x => x.salaId === 'api')!.waitA).toEqual([]);
    const mal = updatePlan(ctx, OPTION, { plan: 'v4', cambios: 'x', orden: [{ sala: 'api', espera_a: ['otra'] }] });
    expect(mal.ok).toBe(false);
    expect(ctx.planes.get('ABC-12')!.version).toBe(3);
  });
});
