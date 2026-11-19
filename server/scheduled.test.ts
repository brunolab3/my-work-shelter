import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseWhen, holdWeekend, checkWhen, due, isLate, ofConversation, type ScheduledMessage } from '../shared/scheduled.ts';
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
function ctx(timer: { t: number }, o: { fails?: boolean } = {}) {
  const conversations: { claudeId?: string; cwd: string; text: string }[] = [], toRooms: { room: string; key?: string; text: string }[] = [], notices: string[] = [], changes: number[] = [];
  const c: CtxScheduled = {
    session: id => (id === SESS.id ? SESS : undefined),
    rooms: () => [{ id: 'express', name: 'app-web', dweller: {} }, { id: 'pagos', name: 'pagos', dweller: {} }, { id: 'vacia', name: 'vacía' }],
    toConversation: async (x, text) => { if (o.fails) throw new Error('sigue abierta fuera'); conversations.push({ claudeId: x.target.claudeId, cwd: x.target.cwd, text }); return 'nueva'; },
    toRoom: async (x, text) => { toRooms.push({ room: x.target.room, key: x.target.key, text }); return { ok: true, text: 'ok' }; },
    changed: l => changes.push(l.length),
    notice: t => notices.push(t),
    now: () => timer.t,
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
