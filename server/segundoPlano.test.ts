// Sesiones con tareas en segundo plano (sesiones.ts): el turno acaba con subagentes o terminales aún vivos y la sesión
// sigue trabajando hasta que terminan; no se da por terminada (ni se cierra por ociosa) con ellos en marcha
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from './sesiones.ts';

function session() {
  const ses = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', salaId: 'sala', cwd: '/tmp', estado: 'trabajando', sinLeer: false, titulo: 'Trabajo', pendientes: 0, ayudantes: [], herramientas: 0, turns: 0 };
  const x = { r, viva: true, closing: false, interrupting: false, sent: new Map(), pendientes: [], entradas: [], herramientas: new Map(), ayudantes: new Map(), taskAHelper: new Map(), fondo: new Set(), awaitingBackground: false, comandos: [], stderr: '', opciones: {}, partialText: '', shipments: Promise.resolve() };
  ses.s.set('w1', x);
  const m = (msg: any) => ses.manejar(x, { session_id: 'c1', uuid: crypto.randomUUID(), ...msg });
  return {
    r, m,
    tasks: (...ids: string[]) => m({ type: 'system', subtype: 'background_tasks_changed', tasks: ids.map(task_id => ({ task_id, task_type: 'local_agent', description: task_id })) }),
    result: () => m({ type: 'result', subtype: 'success', is_error: false, result: 'Hecho', duration_ms: 1000 }),
    assistant: () => m({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Sigo' }] } }),
  };
}

describe('sesión con tareas en segundo plano', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('acaba el turno con un subagente vivo: sigue trabajando, sin «sin leer», y cuenta lo que queda', () => {
    const s = session();
    s.tasks('agente-1'); s.result();
    expect([s.r.estado, s.r.sinLeer, s.r.segundoPlano]).toEqual(['trabajando', false, 1]);
  });

  it('cuando el subagente acaba y Claude Code retoma el turno con su aviso, termina al acabar ese turno', () => {
    const s = session();
    s.tasks('agente-1'); s.result();
    s.tasks(); s.assistant();
    vi.advanceTimersByTime(10_000);
    expect(s.r.estado).toBe('trabajando');
    s.result();
    expect([s.r.estado, s.r.sinLeer, s.r.segundoPlano]).toEqual(['terminada', true, undefined]);
  });

  it('si al acabar la última tarea no se retoma el turno, se da por terminada a los pocos segundos', () => {
    const s = session();
    s.tasks('terminal-1', 'agente-1'); s.result();
    s.tasks('agente-1');
    vi.advanceTimersByTime(10_000);
    expect(s.r.estado).toBe('trabajando');
    s.tasks();
    vi.advanceTimersByTime(4_000);
    expect(s.r.estado).toBe('trabajando');
    vi.advanceTimersByTime(2_000);
    expect([s.r.estado, s.r.sinLeer]).toEqual(['terminada', true]);
  });

  it('las tareas «ambient» (vigilantes que no son trabajo) no la retienen', () => {
    const s = session();
    s.m({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'vigia', task_type: 'monitor', description: 'vigía', ambient: true }] });
    s.result();
    expect(s.r.estado).toBe('terminada');
  });
});
