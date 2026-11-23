import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWhen, holdWeekend, checkWhen, due, isLate, ofConversation, type ScheduledMessage, type UsageWindow } from '../shared/scheduled.ts';
import { Scheduled, type CtxScheduled } from './scheduled.ts';
import { setLanguage } from '../shared/language.ts';
import type { SessionSummary } from '../shared/protocol.ts';

// todo en hora local: viernes 13 de noviembre de 2026 a las 16:00
const L = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();
const NOW = L(13, 16);

describe('mensajes programados: fechas', () => {
  it('un día sin hora es a las 9:00 locales; con hora, esa hora local', () => {
    expect(parseWhen('2026-11-16')).toEqual({ ms: L(16, 9), noTime: true });
    expect(parseWhen('2026-11-16T14:30')).toEqual({ ms: L(16, 14, 30), noTime: false });
    expect(parseWhen('2026-11-16 14:30:00')?.ms).toBe(L(16, 14, 30));
  });
  it('con zona, el instante exacto', () => {
    expect(parseWhen('2026-11-16T08:00:00Z')?.ms).toBe(Date.UTC(2026, 10, 16, 8));
    expect(parseWhen('2026-11-16T09:00+01:00')?.ms).toBe(Date.UTC(2026, 10, 16, 8));
  });
  it('lo que no es una fecha ISO (o no existe) no vale', () => {
    for (const x of ['el lunes', 'monday', '16/11/2026', '2026-02-30', '2026-13-01', '2026-11-16T25:00', '']) expect(parseWhen(x)).toBeUndefined();
  });
  it('sábado y domingo se aplazan al lunes a las 9:00; entre semana, tal cual', () => {
    expect(holdWeekend(L(14, 18))).toBe(L(16, 9));
    expect(holdWeekend(L(15, 7))).toBe(L(16, 9));
    expect(holdWeekend(L(16, 14))).toBe(L(16, 14));
    expect(holdWeekend(L(13, 23, 59))).toBe(L(13, 23, 59));
  });
  it('comprueba pasado, demasiado lejos y fin de semana', () => {
    expect(checkWhen('2026-11-12', NOW)).toEqual({ ok: false, error: 'past' });
    expect(checkWhen('2027-03-01', NOW)).toEqual({ ok: false, error: 'tooFar' });
    expect(checkWhen('mañana', NOW)).toEqual({ ok: false, error: 'badDate' });
    expect(checkWhen('2026-11-14', NOW)).toEqual({ ok: true, when: L(16, 9), postponed: true });
    expect(checkWhen('2026-11-16', NOW)).toEqual({ ok: true, when: L(16, 9), postponed: false });
  });
  it('vencidos en orden; con retraso solo pasados unos minutos', () => {
    const x = (id: string, when: number) => ({ id, when } as ScheduledMessage);
    expect(due([x('b', L(13, 15)), x('a', L(13, 14)), x('c', L(16, 9))], NOW).map(y => y.id)).toEqual(['a', 'b']);
    expect(isLate(x('a', NOW - 60_000), NOW)).toBe(false);
    expect(isLate(x('a', L(13, 9)), NOW)).toBe(true);
  });
});

// un contexto que apunta las entregas; `falla` hace que la conversación no se pueda retomar
const SESS: SessionSummary = { id: 's1', dwellerId: 'remi', roomId: 'express', claudeId: 'c-111', cwd: '/r/express', worktree: '/r/wt/abc-1', state: 'trabajando', unread: false, title: 'ABC-1', pendingCount: 0, helpers: [], tools: 0, turns: 1, created: 0, updated: 0 } as SessionSummary;
function ctx(timer: { t: number }, o: { fails?: boolean; usage?: UsageWindow; self?: boolean; busy?: Set<string> } = {}) {
  const conversations: { claudeId?: string; cwd: string; text: string }[] = [], toRooms: { room: string; key?: string; text: string }[] = [], notices: string[] = [], changes: number[] = [];
  const c: CtxScheduled = {
    session: id => (id === SESS.id ? SESS : undefined),
    rooms: () => [{ id: 'express', name: 'app-web', dweller: {} }, { id: 'pagos', name: 'pagos', dweller: {} }, { id: 'vacia', name: 'vacía' }],
    toConversation: async (x, text) => { if (o.fails) throw new Error('sigue abierta fuera'); conversations.push({ claudeId: x.target.claudeId, cwd: x.target.cwd, text }); return 'nueva'; },
    toRoom: async (x, text) => { if (o.self && x.target.key) return { ok: false, permanent: true, text: 'ya eres la conversación' }; toRooms.push({ room: x.target.room, key: x.target.key, text }); return { ok: true, text: 'ok' }; },
    changed: l => changes.push(l.length),
    notice: t => notices.push(t),
    now: () => timer.t,
    usage: () => o.usage ?? {},
    busy: d => !!o.busy && (o.busy.has(d.sessionId ?? '') || o.busy.has(d.claudeId ?? '')),
  };
  return { c, conversations, toRooms, notices, changes };
}

describe('mensajes programados: almacén y entrega', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });

  it('sin sala, vuelve a la misma conversación (su id de Claude Code y su worktree) a su hora, también tras reiniciar', async () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    const p = new Scheduled(dir, x.c);
    const r = p.schedule('express', 's1', { when: '2026-11-16', message: 'Review with Ana: two-step design; tracker comment.' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('09:00');
    expect(p.list()[0]).toMatchObject({ when: L(16, 9), target: { type: 'conversacion', roomId: 'express', claudeId: 'c-111', cwd: '/r/wt/abc-1' } });
    expect(JSON.parse(readFileSync(path.join(dir, 'mensajes-programados.json'), 'utf8')).items).toHaveLength(1);

    await p.sweep();
    expect(x.conversations).toEqual([]);   // aún no toca

    // el servidor se reinicia y vuelve el lunes a las 9:00: lo lee del disco y lo entrega
    timer.t = L(16, 9, 1);
    const y = ctx(timer);
    const q = new Scheduled(dir, y.c);
    await q.sweep();
    expect(y.conversations).toHaveLength(1);
    expect(y.conversations[0]).toMatchObject({ claudeId: 'c-111', cwd: '/r/wt/abc-1' });
    expect(y.conversations[0].text).toContain('⏰ Scheduled on');
    expect(y.conversations[0].text).toContain('two-step design');
    expect(y.conversations[0].text).not.toContain('late');
    expect(q.list()).toEqual([]);
    expect(new Scheduled(dir, y.c).list()).toEqual([]);
  });

  it('lo que venció con el juego cerrado llega al arrancar, marcado con retraso', async () => {
    const timer = { t: NOW };
    const p = new Scheduled(dir, ctx(timer).c);
    p.schedule('express', 's1', { when: '2026-11-16T10:00', message: 'x' });
    timer.t = L(17, 8);
    const y = ctx(timer);
    await new Scheduled(dir, y.c).sweep();
    expect(y.conversations[0].text).toContain('late');
  });

  it('con sala y clave, a esa sala como send_to_room', async () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    const p = new Scheduled(dir, x.c);
    expect(p.schedule('express', 's1', { when: '2026-11-16T11:00', message: 'Check the API', room: 'pagos', key: 'abc-2' }).ok).toBe(true);
    expect(p.list()[0].target).toEqual({ type: 'sala', room: 'pagos', key: 'ABC-2' });
    expect(p.schedule('express', 's1', { when: '2026-11-17', message: 'x', room: 'pagos', key: 'Preflight-Popover' }).ok).toBe(true);
    expect(p.list()[1].target).toEqual({ type: 'sala', room: 'pagos', key: 'preflight-popover' });
    timer.t = L(16, 11);
    await p.sweep();
    expect(x.toRooms).toEqual([{ room: 'pagos', key: 'ABC-2', text: expect.stringContaining('Check the API') }]);
    expect(x.conversations).toEqual([]);
  });

  it('rechaza fechas malas, salas sin habitante, claves raras y pasar del límite por conversación', () => {
    const p = new Scheduled(dir, ctx({ t: NOW }).c);
    expect(p.schedule('express', 's1', { when: 'Monday', message: 'x' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: '  ' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: 'x', room: 'vacia' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: 'x', room: 'pagos', key: 'not a key!' }).ok).toBe(false);
    expect(p.schedule('express', 'otra', { when: '2026-11-16', message: 'x' }).ok).toBe(false);   // sin conversación conocida
    for (let i = 0; i < 10; i++) expect(p.schedule('express', 's1', { when: '2026-11-16', message: 'x' + i }).ok).toBe(true);
    const r = p.schedule('express', 's1', { when: '2026-11-16', message: 'once' });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('10');
    expect(p.list()).toHaveLength(10);
  });

  it('sin poder entregarlo, se queda, avisa una vez y lo reintenta', async () => {
    const timer = { t: NOW };
    const x = ctx(timer, { fails: true });
    const p = new Scheduled(dir, x.c);
    p.schedule('express', 's1', { when: '2026-11-13T16:30', message: 'x' });
    timer.t = L(13, 16, 31);
    await p.sweep(); await p.sweep();
    expect(x.notices).toHaveLength(1);
    expect(p.list()).toHaveLength(1);
  });

  it('un habitante solo ve y cancela los suyos; el Supervisor edita y cancela cualquiera', () => {
    const p = new Scheduled(dir, ctx({ t: NOW }).c);
    p.schedule('express', 's1', { when: '2026-11-16', message: 'a' });
    const id = p.list()[0].id;
    expect(p.ofConversation('s1').map(x => x.id)).toEqual([id]);
    expect(p.ofConversation('otra')).toEqual([]);
    expect(ofConversation(p.list(), { claudeId: 'c-111' })).toHaveLength(1);   // tras reiniciar, por su id de Claude Code
    expect(p.cancel(id, 'otra')).toBe(false);
    expect(p.edit(id, { when: '2026-11-21T10:00', message: ' b ' })).toMatchObject({ when: L(23, 9), message: 'b' });   // sábado → lunes
    expect(() => p.edit(id, { when: '2026-11-01' })).toThrow();
    expect(p.cancel(id)).toBe(true);
    expect(p.list()).toEqual([]);
    expect(existsSync(path.join(dir, 'mensajes-programados.json'))).toBe(true);
  });
});

describe('scheduled messages: the day\'s final 5-hour window', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-ventana-')); setLanguage('en'); });

  it('a dweller\'s `when: "next-window"` waits for the day\'s final window, never as a dated one', async () => {
    const timer = { t: NOW };
    const x = ctx(timer, { usage: { endsAt: L(13, 17) } }), p = new Scheduled(dir, x.c);
    const r = p.schedule('express', 's1', { when: 'next-window', message: 'Refactor the importer' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('⏳');
    // the running window ends at 17:00, the next one at 22:00: that one is the day's last
    expect(p.list()[0]).toMatchObject({ nextWindow: true, when: L(13, 22), requested: 'next-window' });
    timer.t = L(13, 21, 59); await p.sweep();
    expect(x.conversations).toEqual([]);
    timer.t = L(13, 22); await p.sweep();   // Friday 22:00: no weekend rule, it is about the window
    expect(x.conversations).toHaveLength(1);
    expect(p.list()).toEqual([]);
  });

  it('several go out one at a time, five minutes apart, oldest first; with no window known, from 19:00', async () => {
    const timer = { t: L(13, 19) };
    const x = ctx(timer), p = new Scheduled(dir, x.c);
    for (const m of ['a', 'b', 'c']) { p.scheduleOverseer({ roomId: 'express', cwd: '/r/express' }, m); timer.t += 1000; }
    const out: number[] = [];
    for (; timer.t < L(13, 19, 20); timer.t += 60_000) { const before = x.conversations.length; await p.sweep(); if (x.conversations.length > before) out.push(Math.round((timer.t - L(13, 19)) / 60_000)); }
    expect(out).toEqual([0, 5, 10]);
    expect(x.conversations.map(c => c.text.split('\n').pop())).toEqual(['a', 'b', 'c']);
    expect(x.conversations[0].text).toContain('Overseer');
  });

  it('the Overseer\'s ⏰ Schedule: a dated one, checked like schedule_message\'s and with its per-conversation limit', async () => {
    const timer = { t: NOW };
    const x = ctx(timer), p = new Scheduled(dir, x.c), c = { roomId: 'express', claudeId: 'c9', cwd: '/r/express' };
    const a = p.scheduleOverseer(c, 'Review the PR', '2026-11-14T10:00');   // Saturday: held to Monday 09:00
    expect(a).toMatchObject({ when: L(16, 9), requested: '2026-11-14T10:00', overseer: true });
    expect(a.nextWindow).toBeUndefined();
    expect(() => p.scheduleOverseer(c, 'x', '2026-11-12T10:00')).toThrow();
    expect(() => p.scheduleOverseer(c, 'x', 'tomorrow')).toThrow();
    for (let i = 1; i < 10; i++) p.scheduleOverseer(c, 'm' + i, '2026-11-17T10:00');
    expect(() => p.scheduleOverseer(c, 'one too many', '2026-11-17T10:00')).toThrow(/10/);
    timer.t = L(16, 9); await p.sweep();
    expect(x.conversations.map(v => v.text.split('\n').pop())).toEqual(['Review the PR']);
  });

  it('holds while a limit stops everything, and goes once it lifts', async () => {
    const timer = { t: NOW }, usage: { endsAt?: number; blockedUntil?: number } = { blockedUntil: L(13, 19) };
    const x = ctx(timer, { usage }), p = new Scheduled(dir, x.c);
    p.scheduleOverseer({ roomId: 'express', cwd: '/r/express' }, 'later');
    expect(p.list()[0].when).toBe(L(13, 19));
    timer.t = L(13, 19); usage.blockedUntil = L(13, 20);   // still at the limit
    await p.sweep();
    expect(x.conversations).toEqual([]);
    delete usage.blockedUntil; await p.sweep();
    expect(x.conversations).toHaveLength(1);
  });

  it('send now, edit the text, move to a date and back to the next window', async () => {
    const timer = { t: NOW };
    const x = ctx(timer, { usage: { endsAt: L(13, 18) } }), p = new Scheduled(dir, x.c);   // 18:00, then 23:00
    const a = p.scheduleOverseer({ roomId: 'express', cwd: '/r/express' }, 'one');
    const b = p.scheduleOverseer({ roomId: 'express', cwd: '/r/express' }, 'two');
    await p.sendNow(a.id);
    expect(x.conversations.map(c => c.text.split('\n').pop())).toEqual(['one']);
    p.edit(b.id, { message: 'two, edited' });
    expect(p.list()[0]).toMatchObject({ nextWindow: true, message: 'two, edited' });
    p.edit(b.id, { when: '2026-11-17T10:00' });
    expect(p.list()[0].nextWindow).toBeUndefined();
    p.edit(b.id, { when: 'next-window' });
    expect(p.list()[0]).toMatchObject({ nextWindow: true, when: L(13, 23) });
  });
});

describe('mensajes programados: entrega fuera del límite', () => {
  it('una entrega que nunca se podrá hacer (la propia conversación) se quita con aviso, sin retener las demás', async () => {
    const timer = { t: NOW }, x = ctx(timer, { self: true });
    const p = new Scheduled(mkdtempSync(path.join(tmpdir(), 'prog-')), x.c);
    p.defer('express', 's1', { room: 'express', key: 'ABC-1', message: 'a' }, NOW - 2000);
    p.defer('express', 's1', { room: 'express', message: 'b' }, NOW - 1000);
    await p.sweep();
    expect(p.list()).toEqual([]);
    expect(x.notices).toHaveLength(1);
    expect(x.notices[0]).toContain('a');
    expect(x.toRooms).toEqual([{ room: 'express', key: undefined, text: expect.stringContaining('b') }]);
  });

});

describe('scheduled messages: after the turn', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });

  it('a message to a busy conversation waits for its turn to end, then goes verbatim, one per turn, from its sender', async () => {
    const timer = { t: NOW }, busy = new Set(['s1']);
    const x = ctx(timer, { busy });
    const p = new Scheduled(dir, x.c);
    const target = { roomId: 'express', sessionId: 's1', claudeId: 'c-111', cwd: '/r/wt/abc-1', title: 'ABC-1' };
    const from = { kind: 'room' as const, roomId: 'pagos', room: 'pagos', dweller: 'Gaspar' };
    const a = p.hold(target, '📨 first', from, { roomId: 'pagos', sessionId: 's9' });
    p.hold(target, '🚨 CI', { kind: 'game' }, { roomId: 'express' });
    expect(a).toMatchObject({ afterTurn: true, from });
    await p.sweep();
    expect(x.conversations).toEqual([]);
    // the sender's conversation lists it while it waits
    expect(p.ofConversation('s9')).toHaveLength(1);
    // the turn ends: the oldest one goes, as it was written; the next waits for that one's turn
    busy.clear();
    p.turnEnded({ sessionId: 's1' });
    await new Promise(r => setTimeout(r, 5));
    expect(x.conversations.map(c => c.text)).toEqual(['📨 first']);
    expect(p.list()).toHaveLength(1);
    // (here the conversation would be busy again with it; free, the next one goes on the next sweep)
    await p.sweep();
    expect(x.conversations.map(c => c.text)).toEqual(['📨 first', '🚨 CI']);
    expect(p.list()).toEqual([]);
  });

  it('a dated one falling due while its conversation is busy waits for the turn to end; ▶ sends a held one anyway', async () => {
    const timer = { t: NOW }, busy = new Set(['s1']);
    const x = ctx(timer, { busy });
    const p = new Scheduled(dir, x.c);
    p.schedule('express', 's1', { when: '2026-11-16', message: 'Monday review' });
    timer.t = L(16, 9, 1);
    await p.sweep();
    expect(x.conversations).toEqual([]);
    expect(p.list()[0].afterTurn).toBe(true);
    busy.clear(); await p.sweep();
    expect(x.conversations).toHaveLength(1);
    expect(x.conversations[0].text).toContain('Monday review');
    busy.add('s1');
    const h = p.scheduleOverseer({ roomId: 'express', sessionId: 's1', claudeId: 'c-111', cwd: '/r/wt/abc-1' }, 'then this', 'after-turn');
    expect(h).toMatchObject({ afterTurn: true, overseer: true, from: { kind: 'overseer' } });
    await p.sendNow(h.id);
    expect(x.conversations.at(-1)!.text).toBe('then this');
    expect(() => p.scheduleOverseer({ roomId: 'express', cwd: '/r/express' }, 'x', 'after-turn')).toThrow();
  });
});
