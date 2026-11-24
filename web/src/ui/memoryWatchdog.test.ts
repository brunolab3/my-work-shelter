import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@shared/protocol';
import { memoryWatch, reloadButton, type ReloadInput } from './memoryWatchdog';
import { restoredIntercoms, savedIntercoms, type WindowCom } from './intercomSync';

const ses = (id: string, state: string) => ({ id, dwellerId: 'ana', state }) as unknown as SessionSummary;
const byId = (...l: SessionSummary[]) => Object.fromEntries(l.map(s => [s.id, s]));
const base: ReloadInput = { mb: 2500, limit: 2048, sessions: {}, intercoms: [] };
const button = (o: Partial<ReloadInput>) => reloadButton({ ...base, ...o });
const uploading = (a: object): WindowCom[] => [{ dwellerId: 'ana', tabs: [{ id: 'p1', view: { type: 'nuevo' }, attachments: [{ id: 'a1', name: 'x.png', image: true, ...a }] }], active: 'p1', maximized: false, z: 1, known: [] }];

describe('reloadButton: «Reload now» in the memory row', () => {
  it('is not shown under the limit, with no limit or before the first sample', () => {
    expect(button({ mb: 1800 }).show).toBe(false);
    expect(button({ limit: 0 }).show).toBe(false);
    expect(button({ mb: null }).show).toBe(false);
  });

  it('is enabled over the limit when no turn is running', () => {
    expect(button({ sessions: byId(ses('s1', 'terminada'), ses('s2', 'ociosa'), ses('s3', 'esperando')) })).toEqual({ show: true });
  });

  it('is disabled, with its reason, while a turn starts or is in progress', () => {
    expect(button({ sessions: byId(ses('s1', 'trabajando')) })).toEqual({ show: true, reason: 'menu.memoryReloadTurnRunning' });
    expect(button({ sessions: byId(ses('s1', 'arrancando')) })).toEqual({ show: true, reason: 'menu.memoryReloadTurnRunning' });
  });

  it('is disabled while an attachment is still uploading, enabled once it is up or failed', () => {
    expect(button({ intercoms: uploading({}) }).reason).toBe('menu.memoryReloadUploading');
    expect(button({ intercoms: uploading({ path: '/tmp/x.png' }) }).reason).toBeUndefined();
    expect(button({ intercoms: uploading({ error: 'too big' }) }).reason).toBeUndefined();
  });
});

describe('memoryWatch: only the click reloads', () => {
  const fake = () => {
    const calls: string[] = [];
    let send: (mb: number) => void = () => {};
    const w = { onMemory: (f: (mb: number) => void) => { send = f; }, reloadForMemory: async () => { calls.push('reload'); } };
    return { w, calls, sample: (mb: number) => send(mb) };
  };
  const setup = (sessions: Record<string, SessionSummary> = {}) => {
    const f = fake(), reported: number[] = [];
    const watch = memoryWatch(f.w, { report: mb => reported.push(mb), input: mb => ({ ...base, mb, sessions }), save: () => f.calls.push('save') });
    return { ...f, watch, reported };
  };

  it('never reloads by itself, however far over the limit the samples go', () => {
    const s = setup();
    s.sample(3000); s.sample(5000);
    expect(s.reported).toEqual([3000, 5000]);
    expect(s.calls).toEqual([]);
  });

  it('on the click, writes the drafts down before reloading', () => {
    const s = setup();
    s.sample(3000);
    expect(s.watch.reload()).toBe(true);
    expect(s.calls).toEqual(['save', 'reload']);
  });

  it('does nothing on the click while a turn is in progress or under the limit', () => {
    const busy = setup(byId(ses('s1', 'trabajando')));
    busy.sample(3000);
    expect(busy.watch.reload()).toBe(false);
    const low = setup();
    low.sample(1000);
    expect(low.watch.reload()).toBe(false);
    expect([...busy.calls, ...low.calls]).toEqual([]);
  });
});

describe('savedIntercoms / restoredIntercoms: drafts survive a reload', () => {
  const list: WindowCom[] = [
    { dwellerId: 'ana', maximized: true, z: 3, known: ['s1'], active: 'p2', tabs: [
      { id: 'p1', view: { type: 'sesion', sessionId: 's1' }, draft: 'half a reply' },
      { id: 'p2', view: { type: 'nuevo' }, draft: 'a new job', attachments: [{ id: 'a1', name: 'shot.png', image: true, path: '/up/shot.png', view: 'blob:xyz' }, { id: 'a2', name: 'bad.pdf', image: false, error: 'too big' }] },
      { id: 'p3', view: { type: 'menu' } },
    ] },
    { dwellerId: 'eva', maximized: false, z: 4, known: [], active: 'p4', tabs: [{ id: 'p4', view: { type: 'historial' } }] },
  ];
  // through JSON, as in localStorage
  let n = 0;
  const back = restoredIntercoms(JSON.parse(JSON.stringify(savedIntercoms(list))), () => 'n' + (++n), () => 10);

  it('keeps every tab with a conversation or a draft, with its text and its uploaded attachments', () => {
    expect(back.map(v => v.dwellerId)).toEqual(['ana']);
    const [a] = back;
    expect(a.tabs.map(p => [p.view, p.draft])).toEqual([[{ type: 'sesion', sessionId: 's1' }, 'half a reply'], [{ type: 'nuevo' }, 'a new job']]);
    expect(a.tabs[1].attachments).toEqual([{ id: expect.any(String), name: 'shot.png', image: true, path: '/up/shot.png' }]);
    expect(a.known).toEqual(['s1']);
  });

  it('brings back the tab that was in view', () => {
    expect(back[0].active).toBe(back[0].tabs[1].id);
  });

  it('drops empty tabs and windows left with none', () => {
    expect(back[0].tabs.some(p => p.view.type === 'menu')).toBe(false);
    expect(restoredIntercoms('not a list', () => 'x', () => 1)).toEqual([]);
  });
});
