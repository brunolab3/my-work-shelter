// A turn whose only reply is an API error ends as failed (or, for the usage limit, stopped until the reset) even when
// the SDK's result still says success: otherwise it shows as done and nobody notices the work never happened
import { describe, expect, it } from 'vitest';
import { Sessions } from './sessions.ts';

function session() {
  const sess = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'sala', cwd: '/tmp', state: 'trabajando', unread: false, title: 'Trabajo', pending: 0, helpers: [], tools: 0, turns: 0 };
  const x = { r, alive: true, closing: false, interrupting: false, sent: new Map(), pending: [], entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: {}, partialText: '', shipments: Promise.resolve() };
  sess.s.set('w1', x);
  const m = (msg: any) => sess.handle(x, { session_id: 'c1', uuid: crypto.randomUUID(), ...msg });
  return {
    r, x, m,
    result: () => m({ type: 'result', subtype: 'success', is_error: false, result: '', duration_ms: 1000 }),
    apiError: (error: string, text: string) => m({ type: 'assistant', parent_tool_use_id: null, error, message: { content: [{ type: 'text', text }] } }),
  };
}

describe('turn ending in an API error', { timeout: 20_000 }, () => {
  it('a usage limit stops it to resume after the reset, even if the result says success', () => {
    const s = session();
    s.m({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1795198200, rateLimitType: 'five_hour', isUsingOverage: false } });
    s.apiError('rate_limit', "You've hit your session limit · resets 7:10pm (Europe/Madrid)");
    s.result();
    expect([s.r.state, s.r.unread, s.r.limit?.resetsAt]).toEqual(['ociosa', true, 1795198200_000]);
  });

  it('other API errors fail the turn too', () => {
    const s = session();
    s.apiError('overloaded', 'Overloaded');
    s.result();
    expect([s.r.state, s.r.error]).toEqual(['error', 'Overloaded']);
  });

  it('the next turn without errors ends as done', () => {
    const s = session();
    s.apiError('overloaded', 'Overloaded'); s.result();
    s.m({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Hecho' }] } });
    s.result();
    expect(s.r.state).toBe('terminada');
  });
});
