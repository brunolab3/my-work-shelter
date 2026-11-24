// Sesiones con tareas en segundo plano (sessions.ts): el turno acaba con subagentes o terminales aún vivos y la sesión
// sigue trabajando hasta que terminan; no se da por terminada (ni se cierra por ociosa) con ellos en marcha
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from './sessions.ts';

function session() {
  const sess = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'room', cwd: '/tmp', state: 'working', unread: false, title: 'Trabajo', pending: 0, helpers: [], tools: 0, turns: 0 };
  const x = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve() };
  sess.s.set('w1', x);
  const m = (msg: any) => sess.handle(x, { session_id: 'c1', uuid: crypto.randomUUID(), ...msg });
  return {
    r, m,
    tasks: (...ids: string[]) => m({ type: 'system', subtype: 'background_tasks_changed', tasks: ids.map(task_id => ({ task_id, task_type: 'local_agent', description: task_id })) }),
    result: () => m({ type: 'result', subtype: 'success', is_error: false, result: 'Hecho', duration_ms: 1000 }),
    assistant: () => m({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Sigo' }] } }),
  };
}

describe('sesión con tareas en segundo plano', { timeout: 20_000 }, () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('acaba el turno con un subagente vivo: sigue trabajando, sin «sin leer», y cuenta lo que queda', () => {
    const s = session();
    s.tasks('agente-1'); s.result();
    expect([s.r.state, s.r.unread, s.r.background]).toEqual(['working', false, 1]);
  });

  it('cuando el subagente acaba y Claude Code retoma el turno con su aviso, termina al acabar ese turno', () => {
    const s = session();
    s.tasks('agente-1'); s.result();
    s.tasks(); s.assistant();
    vi.advanceTimersByTime(10_000);
    expect(s.r.state).toBe('working');
    s.result();
    expect([s.r.state, s.r.unread, s.r.background]).toEqual(['finished', true, undefined]);
  });

  it('si al acabar la última tarea no se retoma el turno, se da por terminada a los pocos segundos', () => {
    const s = session();
    s.tasks('terminal-1', 'agente-1'); s.result();
    s.tasks('agente-1');
    vi.advanceTimersByTime(10_000);
    expect(s.r.state).toBe('working');
    s.tasks();
    vi.advanceTimersByTime(4_000);
    expect(s.r.state).toBe('working');
    vi.advanceTimersByTime(2_000);
    expect([s.r.state, s.r.unread]).toEqual(['finished', true]);
  });

  it('las tareas «ambient» (vigilantes que no son trabajo) no la retienen', () => {
    const s = session();
    s.m({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'vigia', task_type: 'monitor', description: 'vigía', ambient: true }] });
    s.result();
    expect(s.r.state).toBe('finished');
  });
});
