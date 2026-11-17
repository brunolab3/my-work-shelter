// A main-agent AskUserQuestion with no text before it in the turn (sessions.ts, canUse): held back once with a request
// to write the message first, so the Overseer has the results and links before answering
import { describe, expect, it } from 'vitest';
import { Sessions } from './sessions.ts';

function session() {
  const ses = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', salaId: 'sala', cwd: '/tmp', estado: 'trabajando', sinLeer: false, titulo: 'Trabajo', pendientes: 0, ayudantes: [], herramientas: 0, turns: 0 };
  const x = { r, viva: true, closing: false, interrupting: false, sent: new Map(), pendientes: [], entradas: [], herramientas: new Map(), ayudantes: new Map(), taskAHelper: new Map(), fondo: new Set(), awaitingBackground: false, comandos: [], stderr: '', opciones: {}, partialText: '', shipments: Promise.resolve() };
  ses.s.set('w1', x);
  const usar = ses.canUse(x);
  const preguntar = (agentID?: string) => {
    const p = usar('AskUserQuestion', { questions: [{ question: '¿Vale?', header: 'Vale', options: [], multiSelect: false }] }, { signal: new AbortController().signal, agentID });
    return Promise.race([p, new Promise(res => setTimeout(() => res('abierta'), 20))]);
  };
  return {
    x, preguntar,
    texto: () => ses.manejar(x, { type: 'assistant', parent_tool_use_id: null, session_id: 'c1', uuid: crypto.randomUUID(), message: { content: [{ type: 'text', text: 'Hecho: [antes](/tmp/a.png)' }] } }),
    result: () => ses.manejar(x, { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', duration_ms: 1000, session_id: 'c1', uuid: crypto.randomUUID() }),
  };
}

describe('AskUserQuestion with no text before it', { timeout: 20_000 }, () => {
  it("the turn's first one without text is denied, with no ❓ entry or request; the retry opens", async () => {
    const s = session();
    expect(await s.preguntar()).toMatchObject({ behavior: 'deny' });
    expect([s.x.pendientes.length, s.x.entradas.length]).toEqual([0, 0]);
    expect(await s.preguntar()).toBe('abierta');
    expect(s.x.pendientes).toHaveLength(1);
  });

  it('with text written this turn it opens at once', async () => {
    const s = session();
    s.texto();
    expect(await s.preguntar()).toBe('abierta');
  });

  it('text from an earlier turn does not count, and each new turn holds it back once again', async () => {
    const s = session();
    s.texto(); s.result();
    expect(await s.preguntar()).toMatchObject({ behavior: 'deny' });
    s.result();
    expect(await s.preguntar()).toMatchObject({ behavior: 'deny' });
  });

  it("helpers' and subagents' questions are not held back", async () => {
    const s = session();
    expect(await s.preguntar('agente-1')).toBe('abierta');
  });
});
