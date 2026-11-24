import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@shared/protocol';
import { dropLeft, syncIntercoms, type TabCom, type WindowCom } from './intercomSync';

const ses = (id: string, dwellerId: string, created = 1, extra: Partial<SessionSummary> = {}) =>
  ({ id, dwellerId, created, updated: created, state: 'trabajando', ...extra }) as unknown as SessionSummary;
const byId = (...l: SessionSummary[]) => Object.fromEntries(l.map(s => [s.id, s]));
const tab = (id: string, sessionId: string, draft?: string) => ({ id, view: { type: 'sesion' as const, sessionId }, draft });
const run = (list: WindowCom[], sessions: Record<string, SessionSummary>, talking: string | null, owner = (s: SessionSummary) => s.dwellerId) => {
  let n = 100, z = 10;
  return syncIntercoms({ list, sessions, owner, closing: new Set(), talking, newId: () => 'n' + (++n), nextZ: () => ++z });
};

describe('syncIntercoms: a conversation that opens by itself', () => {
  const ana: WindowCom = { dwellerId: 'ana', tabs: [tab('p1', 's1', 'half-typed')], active: 'p1', maximized: false, z: 5, known: ['s1'] };

  it('opens a quiet tab in the intercom in front, which keeps its tab in view, its z and what is typed', () => {
    const { next, handoff } = run([ana], byId(ses('s1', 'ana'), ses('s2', 'ana', 2)), 'ana');
    const w = next.find(v => v.dwellerId === 'ana')!;
    expect(w.tabs.map(p => p.id)).toEqual(['p1', 'n101']);
    expect(w.active).toBe('p1');
    expect(w.z).toBe(5);
    expect(w.tabs[0].draft).toBe('half-typed');
    expect(handoff).toBeNull();
  });

  it('opens in a window not in front without switching its tab in view either', () => {
    const { next } = run([ana], byId(ses('s1', 'ana'), ses('s2', 'ana', 2)), 'eva');
    expect(next[0].active).toBe('p1');
  });

  it("another dweller's (or a task's hologram's) waits in a new window in the bar; the one in front is untouched", () => {
    const { next, handoff } = run([ana], byId(ses('s1', 'ana'), ses('s9', 'holo')), 'ana');
    expect(next[0]).toBe(ana);
    expect(next[1]).toMatchObject({ dwellerId: 'holo', active: next[1].tabs[0].id, known: ['s9'] });
    expect(handoff).toBeNull();
  });

  it('changes nothing when nothing changed', () => {
    const list = [ana];
    expect(run(list, byId(ses('s1', 'ana')), 'ana').next).toBe(list);
  });
});

describe('syncIntercoms: the conversation in view moves to a worktree', () => {
  it('its tab, with what is typed, goes to the copy in front there, and the intercom follows it', () => {
    const ana: WindowCom = { dwellerId: 'ana', tabs: [tab('p1', 's0'), tab('p2', 's1', 'typing')], active: 'p2', maximized: false, z: 5, known: ['s0', 's1'] };
    const holo: WindowCom = { dwellerId: 'holo', tabs: [tab('h1', 's5')], active: 'h1', maximized: false, z: 3, known: ['s5'] };
    const owner = (s: SessionSummary) => (s.id === 's1' ? 'holo' : s.dwellerId);
    const { next, handoff } = run([ana, holo], byId(ses('s0', 'ana'), ses('s1', 'ana', 2), ses('s5', 'holo')), 'ana', owner);
    const h = next.find(v => v.dwellerId === 'holo')!;
    expect(handoff).toBe('holo');
    expect(h.tabs.find(p => p.id === h.active)).toMatchObject({ view: { sessionId: 's1' }, draft: 'typing' });
    expect(next.find(v => v.dwellerId === 'ana')!.active).toBe('p1');
  });

  it('one not in view moves quietly', () => {
    const ana: WindowCom = { dwellerId: 'ana', tabs: [tab('p1', 's0'), tab('p2', 's1')], active: 'p1', maximized: false, z: 5, known: ['s0', 's1'] };
    const holo: WindowCom = { dwellerId: 'holo', tabs: [tab('h1', 's5')], active: 'h1', maximized: false, z: 3, known: ['s5'] };
    const owner = (s: SessionSummary) => (s.id === 's1' ? 'holo' : s.dwellerId);
    const { next, handoff } = run([ana, holo], byId(ses('s0', 'ana'), ses('s1', 'ana', 2), ses('s5', 'holo')), 'ana', owner);
    expect(handoff).toBeNull();
    expect(next.find(v => v.dwellerId === 'holo')!.active).toBe('h1');
    expect(next.find(v => v.dwellerId === 'ana')!.active).toBe('p1');
  });
});

describe('syncIntercoms: closed conversations', () => {
  it('a closed one with something typed stays to resume it; one without goes, and the one in view falls to its neighbour', () => {
    const ana: WindowCom = { dwellerId: 'ana', tabs: [tab('p1', 's1'), tab('p2', 's2', 'keep me'), tab('p3', 's3')], active: 'p1', maximized: false, z: 5, known: ['s1', 's2', 's3'] };
    const { next } = run([ana], byId(ses('s1', 'ana', 1, { state: 'cerrada' } as any), ses('s3', 'ana', 3)), 'ana');
    expect(next[0].tabs.map(p => [p.id, p.view.type, p.draft])).toEqual([['p2', 'nuevo', 'keep me'], ['p3', 'sesion', undefined]]);
    expect(next[0].active).toBe('p2');
  });

  it('a closed one that was noted (its memory) and is in view stays to resume even with nothing typed', () => {
    const memory = { claudeId: 'c1', title: 'Old', modified: 1, cwd: '/x' } as any;
    const ana: WindowCom = { dwellerId: 'ana', tabs: [{ id: 'p1', view: { type: 'sesion', sessionId: 's1' }, memory }], active: 'p1', maximized: false, z: 5, known: ['s1'] };
    const { next } = run([ana], byId(ses('s1', 'ana', 1, { state: 'cerrada' } as any)), 'ana');
    expect(next[0].tabs).toEqual([{ id: 'p1', view: { type: 'nuevo', resume: { ...memory, modified: expect.any(Number) } }, memory }]);
  });

  it('a closed one with nothing typed and not in view goes, even if noted', () => {
    const memory = { claudeId: 'c1', title: 'Old', modified: 1, cwd: '/x' } as any;
    const ana: WindowCom = { dwellerId: 'ana', tabs: [{ id: 'p1', view: { type: 'sesion', sessionId: 's1' }, memory }, tab('p2', 's2')], active: 'p2', maximized: false, z: 5, known: ['s1', 's2'] };
    const { next } = run([ana], byId(ses('s1', 'ana', 1, { state: 'cerrada' } as any), ses('s2', 'ana', 2)), 'ana');
    expect(next[0].tabs.map(p => p.id)).toEqual(['p2']);
  });
});

describe('dropLeft: a tab with no conversation goes once the Overseer leaves it, unless something is in it', () => {
  const menu = (id: string, extra: Partial<TabCom> = {}): TabCom => ({ id, view: { type: 'menu' }, ...extra });
  const win = (dwellerId: string, tabs: TabCom[], active: string): WindowCom => ({ dwellerId, tabs, active, maximized: false, z: 5, known: [] });

  it('an empty tab left for another tab of the same intercom goes', () => {
    const ana = win('ana', [menu('p1'), tab('p2', 's2')], 'p2');
    expect(dropLeft([ana], { talking: 'ana', active: 'p1' }, { talking: 'ana', active: 'p2' })[0].tabs.map(p => p.id)).toEqual(['p2']);
  });

  it('one with text, an attachment (even uploading) or a job starting stays', () => {
    const tabs = [menu('p1', { draft: 'half' }), menu('p2', { attachments: [{ id: 'a', name: 'x.png' } as any] }), menu('p3', { sessionWait: true }), { id: 'p4', view: { type: 'nuevo' as const }, draft: 'job' }];
    for (const left of ['p1', 'p2', 'p3', 'p4']) {
      const list = [win('ana', [...tabs, tab('p9', 's9')], 'p9')];
      expect(dropLeft(list, { talking: 'ana', active: left }, { talking: 'ana', active: 'p9' })).toBe(list);
    }
  });

  it('the tab in view stays, and so do the other empty ones while the intercom is in front', () => {
    const list = [win('ana', [menu('p1'), { id: 'p2', view: { type: 'historial' } }], 'p2')];
    expect(dropLeft(list, { talking: 'ana', active: 'p2' }, { talking: 'ana', active: 'p2' })).toBe(list);
    expect(dropLeft(list, { talking: null }, { talking: 'ana', active: 'p2' })).toBe(list);
  });

  it('leaving the intercom drops its empty tabs (a closed conversation to resume too), and the intercom if none remain', () => {
    const resume = { id: 'p3', view: { type: 'nuevo' as const, resume: { claudeId: 'c1', title: 'Old', modified: 1, cwd: '/x' } as any } };
    const ana = win('ana', [menu('p1'), tab('p2', 's2'), resume], 'p3'), eva = win('eva', [menu('e1')], 'e1');
    const next = dropLeft([ana, eva], { talking: 'ana', active: 'p3' }, { talking: null });
    expect(next.map(v => [v.dwellerId, v.tabs.map(p => p.id), v.active])).toEqual([['ana', ['p2'], 'p2'], ['eva', ['e1'], 'e1']]);
    expect(dropLeft([win('ana', [menu('p1')], 'p1')], { talking: 'ana', active: 'p1' }, { talking: 'eva', active: 'e1' })).toEqual([]);
  });
});

describe('syncIntercoms: a handoff', () => {
  const ana: WindowCom = { dwellerId: 'ana', tabs: [tab('p0', 's0'), tab('p1', 's1', 'half-typed')], active: 'p1', maximized: false, z: 5, known: ['s0', 's1'] };
  it('the new session takes the old one\'s tab, in view and with what was typed', () => {
    const { next } = run([ana], byId(ses('s0', 'ana'), ses('s1', 'ana', 1, { state: 'ociosa' }), ses('s2', 'ana', 2, { handoffFrom: 's1' })), 'ana');
    expect(next[0].tabs).toEqual([tab('p0', 's0'), { ...tab('p1', 's2', 'half-typed'), memory: undefined }]);
    expect(next[0].active).toBe('p1');
  });
  it('and keeps it once the old one closes', () => {
    const first = run([ana], byId(ses('s0', 'ana'), ses('s1', 'ana'), ses('s2', 'ana', 2, { handoffFrom: 's1' })), 'ana').next;
    const { next } = run(first, byId(ses('s0', 'ana'), ses('s1', 'ana', 1, { state: 'cerrada' }), ses('s2', 'ana', 2, { handoffFrom: 's1' })), 'ana');
    expect(next[0].tabs.map(p => p.view)).toEqual([{ type: 'sesion', sessionId: 's0' }, { type: 'sesion', sessionId: 's2' }]);
  });
});
