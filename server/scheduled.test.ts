import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWhen, holdWeekend, checkWhen, due, isLate, ofConversation, mergePart, PACK_MAX_MS, type ScheduledMessage, type UsageWindow } from '../shared/scheduled.ts';
import { Scheduled, deliveryTo, type CtxScheduled } from './scheduled.ts';
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
const SESS: SessionSummary = { id: 's1', dwellerId: 'remi', roomId: 'express', claudeId: 'c-111', cwd: '/r/express', worktree: '/r/wt/abc-1', state: 'working', unread: false, title: 'ABC-1', pendingCount: 0, helpers: [], tools: 0, turns: 1, created: 0, updated: 0 } as SessionSummary;
function ctx(timer: { t: number }, o: { fails?: boolean; usage?: UsageWindow; self?: boolean; busy?: Set<string>; running?: Set<string> } = {}) {
  const conversations: { claudeId?: string; cwd: string; text: string }[] = [], toRooms: { room: string; key?: string; text: string }[] = [], notices: string[] = [], changes: number[] = [];
  const c: CtxScheduled = {
    session: id => (id === SESS.id ? SESS : undefined),
    rooms: () => [{ id: 'express', name: 'app-web', dweller: {} }, { id: 'pagos', name: 'pagos', dweller: {} }, { id: 'empty', name: 'vacía' }],
    toConversation: async (x, text) => { if (o.fails) throw new Error('sigue abierta fuera'); conversations.push({ claudeId: x.target.claudeId, cwd: x.target.cwd, text }); return 'nueva'; },
    toRoom: async (x, text) => { if (o.self && x.target.key) return { ok: false, permanent: true, text: 'ya eres la conversación' }; toRooms.push({ room: x.target.room, key: x.target.key, text }); return { ok: true, text: 'ok' }; },
    changed: l => changes.push(l.length),
    notice: t => notices.push(t),
    now: () => timer.t,
    usage: () => o.usage ?? {},
    busy: d => !!o.busy && (o.busy.has(d.sessionId ?? '') || o.busy.has(d.claudeId ?? '')),
    settled: url => !o.running?.has(url),
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
    expect(p.list()[0]).toMatchObject({ when: L(16, 9), target: { type: 'conversation', roomId: 'express', claudeId: 'c-111', cwd: '/r/wt/abc-1' } });
    expect(JSON.parse(readFileSync(path.join(dir, 'scheduled-messages.json'), 'utf8')).items).toHaveLength(1);

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
    expect(p.list()[0].target).toEqual({ type: 'room', room: 'pagos', key: 'ABC-2' });
    expect(p.schedule('express', 's1', { when: '2026-11-17', message: 'x', room: 'pagos', key: 'Preflight-Popover' }).ok).toBe(true);
    expect(p.list()[1].target).toEqual({ type: 'room', room: 'pagos', key: 'preflight-popover' });
    timer.t = L(16, 11);
    await p.sweep();
    expect(x.toRooms).toEqual([{ room: 'pagos', key: 'ABC-2', text: expect.stringContaining('Check the API') }]);
    expect(x.conversations).toEqual([]);
  });

  it('rechaza fechas malas, salas sin habitante, claves raras y pasar del límite por conversación', () => {
    const p = new Scheduled(dir, ctx({ t: NOW }).c);
    expect(p.schedule('express', 's1', { when: 'Monday', message: 'x' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: '  ' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: 'x', room: 'empty' }).ok).toBe(false);
    expect(p.schedule('express', 's1', { when: '2026-11-16', message: 'x', room: 'pagos', key: 'not a key!' }).ok).toBe(false);
    expect(p.schedule('express', 'other', { when: '2026-11-16', message: 'x' }).ok).toBe(false);   // sin conversación conocida
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
    expect(p.ofConversation('other')).toEqual([]);
    expect(ofConversation(p.list(), { claudeId: 'c-111' })).toHaveLength(1);   // tras reiniciar, por su id de Claude Code
    expect(p.cancel(id, 'other')).toBe(false);
    expect(p.edit(id, { when: '2026-11-21T10:00', message: ' b ' })).toMatchObject({ when: L(23, 9), message: 'b' });   // sábado → lunes
    expect(() => p.edit(id, { when: '2026-11-01' })).toThrow();
    expect(p.cancel(id)).toBe(true);
    expect(p.list()).toEqual([]);
    expect(existsSync(path.join(dir, 'scheduled-messages.json'))).toBe(true);
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

describe('scheduled messages: a PR\'s notices packed', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });
  const target = { roomId: 'express', sessionId: 's1', claudeId: 'c-111', cwd: '/r/wt/abc-1', title: 'ABC-1' };
  const A = 'https://github.com/o/r/pull/1', B = 'https://github.com/o/r/pull/2';
  const part = (url: string, kind: 'ci' | 'review', text: string) => ({ url, label: url.endsWith('1') ? 'o/r#1' : 'o/r#2', kind, text });

  it('merges parts: the same text once, a newer CI failure in place of the older one, reviews added', () => {
    const ci1 = { kind: 'ci' as const, text: '🚨 commit a' }, rv = { kind: 'review' as const, text: '🔎 cursor' };
    expect(mergePart([ci1, rv], { kind: 'review', text: '🔎 cursor' })).toEqual([ci1, rv]);
    expect(mergePart([ci1, rv], { kind: 'ci', text: '🚨 commit b' })).toEqual([{ kind: 'ci', text: '🚨 commit b' }, rv]);
    expect(mergePart([ci1, rv], { kind: 'review', text: '🔎 Ana' })).toEqual([ci1, rv, { kind: 'review', text: '🔎 Ana' }]);
  });

  it('one pending message per PR and conversation, keeping its place; it goes once the turn ends and the PR\'s checks finish', async () => {
    const timer = { t: NOW }, busy = new Set(['s1']), running = new Set([A]);
    const x = ctx(timer, { busy, running });
    const p = new Scheduled(dir, x.c);
    const first = p.pack(target, part(A, 'ci', '🚨 #1 commit a'), { roomId: 'express' });
    timer.t += 60_000; p.pack(target, part(B, 'review', '🔎 #2 cursor'), { roomId: 'express' });
    timer.t += 60_000; p.pack(target, part(A, 'review', '🔎 #1 cursor'), { roomId: 'express' });
    timer.t += 60_000; p.pack(target, part(A, 'ci', '🚨 #1 commit b'), { roomId: 'express' });
    timer.t += 60_000; p.pack(target, part(A, 'review', '🔎 #1 cursor'), { roomId: 'express' });
    expect(p.list()).toHaveLength(2);
    const packed = p.list().find(y => y.id === first.id)!;
    expect(packed).toMatchObject({ afterTurn: true, from: { kind: 'game' }, created: NOW, pr: { label: 'o/r#1' } });
    expect(packed.pr!.parts.map(y => y.text)).toEqual(['🚨 #1 commit b', '🔎 #1 cursor']);
    expect(packed.message).toContain('📦 2 notices about o/r#1');
    expect(packed.message).not.toContain('commit a');
    // the turn ends: #2 (settled) goes; #1 waits for its checks
    busy.clear(); await p.sweep();
    expect(x.conversations.map(c => c.text)).toEqual(['🔎 #2 cursor']);
    running.clear(); await p.sweep();
    expect(x.conversations.at(-1)!.text).toBe(packed.message);
    expect(p.list()).toEqual([]);
  });

  it('a check stuck running holds it at most PACK_MAX_MS; the Overseer\'s edit stops the merging', async () => {
    const timer = { t: NOW }, running = new Set([A]);
    const x = ctx(timer, { running });
    const p = new Scheduled(dir, x.c);
    const a = p.pack(target, part(A, 'ci', '🚨 a'), { roomId: 'express' });
    p.edit(a.id, { message: 'just look at the lint job' });
    p.pack(target, part(A, 'review', '🔎 b'), { roomId: 'express' });
    expect(p.list().map(y => y.message)).toEqual(['just look at the lint job', '🔎 b']);
    // the edited one is the Overseer's own message now: it goes when the conversation is free; the pack waits for the checks
    await p.sweep();
    expect(x.conversations.map(c => c.text)).toEqual(['just look at the lint job']);
    await p.sweep();
    expect(x.conversations).toHaveLength(1);
    timer.t = NOW + PACK_MAX_MS; await p.sweep();
    expect(x.conversations.map(c => c.text)).toEqual(['just look at the lint job', '🔎 b']);
  });
});

describe('scheduled messages: a sender\'s messages packed', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });
  const target = { roomId: 'express', sessionId: 's1', claudeId: 'c-111', cwd: '/r/wt/abc-1', title: 'ABC-1' };
  const from = { kind: 'room' as const, roomId: 'pagos', room: 'pagos', dweller: 'Gaspar' };

  it('held for a busy conversation: the same sender\'s next ones join it, in order, under one heading; other senders and targets never mix', async () => {
    const timer = { t: NOW }, busy = new Set(['s1', 's2']);
    const x = ctx(timer, { busy });
    const p = new Scheduled(dir, x.c);
    const a = p.hold(target, '📨 use v1', from, { roomId: 'pagos', sessionId: 's9' });
    p.hold(target, '🚨 CI', { kind: 'game' }, { roomId: 'express' });
    p.hold(target, '📨 another conversation of pagos', from, { roomId: 'pagos', sessionId: 's8' });
    p.hold({ ...target, sessionId: 's2', claudeId: 'c-222' }, '📨 to someone else', from, { roomId: 'pagos', sessionId: 's9' });
    timer.t += 60_000;
    expect(p.hold(target, '📨 sorry, v2', from, { roomId: 'pagos', sessionId: 's9' }).id).toBe(a.id);
    p.hold(target, '📨 sorry, v2', from, { roomId: 'pagos', sessionId: 's9' });
    expect(p.list()).toHaveLength(4);
    const packed = p.list().find(y => y.id === a.id)!;
    expect(packed.messages!.parts.map(y => y.text)).toEqual(['📨 use v1', '📨 sorry, v2']);
    expect(packed.message).toBe([
      '📦 2 messages from the “pagos” room (Gaspar), packed while they waited (in the order they were written): later ones may correct or replace earlier ones.',
      '📨 use v1', '📨 sorry, v2'].join('\n\n---\n\n'));
    // it keeps its place: first out when the turn ends, as one turn
    busy.delete('s1'); await p.sweep();
    expect(x.conversations.map(c => c.text)).toEqual([packed.message]);
    // delivered: a new one starts a new pending message
    busy.add('s1');
    expect(p.hold(target, '📨 one more', from, { roomId: 'pagos', sessionId: 's9' }).message).toBe('📨 one more');
  });

  it('scheduled to a room: joins the same sender\'s one for that place at the same time; another time, key or edited text stays apart', async () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    const p = new Scheduled(dir, x.c);
    const r1 = p.schedule('express', 's1', { when: '2026-11-16', message: 'Deploy on Monday', room: 'pagos', key: 'ABC-1' });
    const r2 = p.schedule('express', 's1', { when: '2026-11-16', message: 'Not Monday: Tuesday', room: 'pagos', key: 'ABC-1' });
    const id = p.list()[0].id;
    expect(r2).toMatchObject({ ok: true, text: expect.stringContaining(`joins your message ${id}`) });
    expect(r1.text).not.toContain('joins');
    p.schedule('express', 's1', { when: '2026-11-17', message: 'later', room: 'pagos', key: 'ABC-1' });
    p.schedule('express', 's1', { when: '2026-11-16', message: 'other task', room: 'pagos', key: 'ABC-2' });
    p.schedule('express', 's1', { when: '2026-11-16', message: 'to myself' });
    expect(p.list()).toHaveLength(4);
    expect(p.list().find(y => y.id === id)!.message).toContain('📦 2 messages from the “app-web” room');
    timer.t = L(16, 9, 1); await p.sweep();
    expect(x.toRooms).toHaveLength(2);
    expect(x.toRooms[0].text).toMatch(/Deploy on Monday[^]*Not Monday: Tuesday/);
    // the Overseer's edit makes it their own: nothing joins it
    const e = p.list().find(y => y.target.type === 'room')!;
    p.edit(e.id, { message: 'later, after the release' });
    p.schedule('express', 's1', { when: '2026-11-17', message: 'and this', room: 'pagos', key: 'ABC-1' });
    expect(p.list().filter(y => y.target.type === 'room').map(y => y.message)).toEqual(['later, after the release', 'and this']);
  });

  it('over the limit: joins the pending one for that place, but not while it is being delivered', async () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    let release!: () => void;
    x.c.toRoom = async (m, text) => { await new Promise<void>(r => { release = r; }); x.toRooms.push({ room: m.target.room, key: m.target.key, text }); return { ok: true, text: 'ok' }; };
    const p = new Scheduled(dir, x.c);
    const a = p.defer('express', 's1', { room: 'pagos', thread: 'deps', message: 'bump zod' }, NOW + 60_000)!;
    expect(p.defer('express', 's1', { room: 'pagos', thread: 'deps', message: 'and vitest' }, NOW + 120_000)).toBe(a);
    p.defer('express', 's1', { room: 'pagos', message: 'no thread' }, NOW + 120_000);
    p.defer('express', undefined, { room: 'pagos', thread: 'deps', message: 'no conversation' }, NOW + 120_000);
    expect(p.list()).toHaveLength(3);
    expect(a.when).toBe(NOW + 60_000);
    timer.t = NOW + 60_000;
    const sweeping = p.sweep();
    await new Promise(r => setTimeout(r, 0));
    const b = p.defer('express', 's1', { room: 'pagos', thread: 'deps', message: 'too late to join' }, NOW + 180_000);
    expect(b).not.toBe(a);
    release(); await sweeping;
    expect(x.toRooms[0].text).toMatch(/bump zod[^]*and vitest/);
    expect(x.toRooms[0].text).not.toContain('too late');
  });
});

describe('scheduled messages: a handoff', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });

  it('what is pending for the old conversation, or that it scheduled, moves to the new one; its Claude Code id is learnt at init', async () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    const p = new Scheduled(dir, x.c);
    p.schedule('express', 's1', { when: '2026-11-16', message: 'Monday review' });
    p.schedule('express', 's1', { when: '2026-11-16T11:00', message: 'Check the API', room: 'pagos', key: 'abc-2' });
    p.scheduleOverseer({ roomId: 'express', claudeId: 'c-111', cwd: '/r/wt/abc-1' }, 'From the Overseer', '2026-11-16T12:00');
    const other = p.scheduleGame({ roomId: 'express', sessionId: 's9', claudeId: 'c-999', cwd: '/r/express' }, L(16, 9), 'someone else');

    p.retarget(SESS, 's2');
    const [mine, toRoom, overseer] = [p.list().find(y => y.message === 'Monday review')!, p.list().find(y => y.message === 'Check the API')!, p.list().find(y => y.message === 'From the Overseer')!];
    expect(mine.target).toMatchObject({ type: 'conversation', sessionId: 's2', cwd: '/r/wt/abc-1' });
    expect(mine.target).not.toHaveProperty('claudeId');
    expect(mine.origin).toEqual({ roomId: 'express', sessionId: 's2' });
    expect(toRoom.origin).toEqual({ roomId: 'express', sessionId: 's2' });
    expect(toRoom.target).toEqual({ type: 'room', room: 'pagos', key: 'ABC-2' });
    expect(overseer.target).toMatchObject({ sessionId: 's2' });
    expect(p.list().find(y => y.id === other)).toMatchObject({ target: { sessionId: 's9', claudeId: 'c-999' }, origin: { sessionId: 's9', claudeId: 'c-999' } });
    // saved
    expect(new Scheduled(dir, x.c).list().find(y => y.message === 'Monday review')!.target).toMatchObject({ sessionId: 's2' });

    p.learnClaudeId('s2', 'c-222');
    expect(p.list().find(y => y.message === 'Monday review')).toMatchObject({ target: { sessionId: 's2', claudeId: 'c-222' }, origin: { sessionId: 's2', claudeId: 'c-222' } });
    timer.t = L(16, 9, 1);
    await p.sweep();
    expect(x.conversations.map(y => y.claudeId)).toEqual(['c-222', 'c-999']);
  });

  it('nothing to move: nothing saved', () => {
    const timer = { t: NOW };
    const x = ctx(timer);
    const p = new Scheduled(dir, x.c);
    p.scheduleGame({ roomId: 'express', sessionId: 's9', claudeId: 'c-999', cwd: '/r/express' }, L(16, 9), 'someone else');
    const n = x.changes.length;
    p.retarget(SESS, 's2'); p.learnClaudeId('s9', 'c-000');
    expect(x.changes.length).toBe(n);
  });
});

describe('scheduled messages: which conversation receives one', () => {
  const d = { type: 'conversation' as const, roomId: 'express', sessionId: 's1', claudeId: 'c-111', cwd: '/r/wt/abc-1', title: 'ABC-1' };
  const at = (o: Partial<Parameters<typeof deliveryTo>[1]> = {}) => ({ open: [], exists: () => true, roomFolder: '/r/express', transcript: () => true, ...o });

  it('the open one, by its game id or its Claude Code id', () => {
    expect(deliveryTo(d, at({ open: [{ id: 's1', claudeId: 'c-other' }] }))).toEqual({ open: 's1' });
    expect(deliveryTo(d, at({ open: [{ id: 's7', claudeId: 'c-111' }] }))).toEqual({ open: 's7' });
  });
  it('closed: resumed by its Claude Code id in its folder or, with that worktree removed, from the room\'s folder', () => {
    expect(deliveryTo(d, at())).toEqual({ cwd: '/r/wt/abc-1', resume: 'c-111' });
    // the FIC-4375 recheck: its worktree was gone when it fell due, and it started a new conversation in the main copy
    expect(deliveryTo(d, at({ exists: dir => dir !== '/r/wt/abc-1' }))).toEqual({ cwd: '/r/express', resume: 'c-111' });
  });
  it('a new one only with no Claude Code id or no transcript left', () => {
    expect(deliveryTo(d, at({ transcript: () => false }))).toEqual({ cwd: '/r/wt/abc-1', fresh: true });
    expect(deliveryTo({ ...d, claudeId: undefined }, at())).toEqual({ cwd: '/r/wt/abc-1', fresh: true });
  });
});
