// A main-agent AskUserQuestion with no text before it in the turn (sessions.ts, canUse): held back once with a request
// to write the message first, so the Overseer has the results and links before answering
import { describe, expect, it } from 'vitest';
import { Sessions } from './sessions.ts';

function session() {
  const sess = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'room', cwd: '/tmp', state: 'working', unread: false, title: 'Trabajo', pending: 0, helpers: [], tools: 0, turns: 0 };
  const x = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve() };
  sess.s.set('w1', x);
  const use = sess.canUse(x);
  const ask = (agentID?: string) => {
    const p = use('AskUserQuestion', { questions: [{ question: '¿Vale?', header: 'Vale', options: [], multiSelect: false }] }, { signal: new AbortController().signal, agentID });
    return Promise.race([p, new Promise(res => setTimeout(() => res('open'), 20))]);
  };
  return {
    x, ask,
    text: () => sess.handle(x, { type: 'assistant', parent_tool_use_id: null, session_id: 'c1', uuid: crypto.randomUUID(), message: { content: [{ type: 'text', text: 'Hecho: [antes](/tmp/a.png)' }] } }),
    result: () => sess.handle(x, { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', duration_ms: 1000, session_id: 'c1', uuid: crypto.randomUUID() }),
  };
}

describe('AskUserQuestion with no text before it', { timeout: 20_000 }, () => {
  it("the turn's first one without text is denied, with no ❓ entry or request; the retry opens", async () => {
    const s = session();
    expect(await s.ask()).toMatchObject({ behavior: 'deny' });
    expect([s.x.pending.length, s.x.entries.length]).toEqual([0, 0]);
    expect(await s.ask()).toBe('open');
    expect(s.x.pending).toHaveLength(1);
  });

  it('with text written this turn it opens at once', async () => {
    const s = session();
    s.text();
    expect(await s.ask()).toBe('open');
  });

  it('text from an earlier turn does not count, and each new turn holds it back once again', async () => {
    const s = session();
    s.text(); s.result();
    expect(await s.ask()).toMatchObject({ behavior: 'deny' });
    s.result();
    expect(await s.ask()).toMatchObject({ behavior: 'deny' });
  });

  it("helpers' and subagents' questions are not held back", async () => {
    const s = session();
    expect(await s.ask('agente-1')).toBe('open');
  });
});
