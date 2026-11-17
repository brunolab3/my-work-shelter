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
const AHORA = L(13, 16);

describe('mensajes programados: fechas', () => {
  it('un día sin hora es a las 9:00 locales; con hora, esa hora local', () => {
    expect(parseWhen('2026-11-16')).toEqual({ ms: L(16, 9), sinHora: true });
    expect(parseWhen('2026-11-16T14:30')).toEqual({ ms: L(16, 14, 30), sinHora: false });
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
    expect(checkWhen('2026-11-12', AHORA)).toEqual({ ok: false, error: 'past' });
    expect(checkWhen('2027-03-01', AHORA)).toEqual({ ok: false, error: 'tooFar' });
    expect(checkWhen('mañana', AHORA)).toEqual({ ok: false, error: 'badDate' });
    expect(checkWhen('2026-11-14', AHORA)).toEqual({ ok: true, cuando: L(16, 9), aplazado: true });
    expect(checkWhen('2026-11-16', AHORA)).toEqual({ ok: true, cuando: L(16, 9), aplazado: false });
  });
  it('vencidos en orden; con retraso solo pasados unos minutos', () => {
    const x = (id: string, cuando: number) => ({ id, cuando } as ScheduledMessage);
    expect(due([x('b', L(13, 15)), x('a', L(13, 14)), x('c', L(16, 9))], AHORA).map(y => y.id)).toEqual(['a', 'b']);
    expect(isLate(x('a', AHORA - 60_000), AHORA)).toBe(false);
    expect(isLate(x('a', L(13, 9)), AHORA)).toBe(true);
  });
});

// un contexto que apunta las entregas; `falla` hace que la conversación no se pueda retomar
const SES: SessionSummary = { id: 's1', dwellerId: 'remi', salaId: 'express', claudeId: 'c-111', cwd: '/r/express', worktree: '/r/wt/abc-1', estado: 'trabajando', sinLeer: false, titulo: 'ABC-1', pendientes: 0, ayudantes: [], herramientas: 0, turns: 1, created: 0, actualizada: 0 } as SessionSummary;
function ctx(reloj: { t: number }, o: { falla?: boolean } = {}) {
  const conversaciones: { claudeId?: string; cwd: string; texto: string }[] = [], aSalas: { sala: string; clave?: string; texto: string }[] = [], avisos: string[] = [], cambios: number[] = [];
  const c: CtxScheduled = {
    sesion: id => (id === SES.id ? SES : undefined),
    salas: () => [{ id: 'express', nombre: 'app-web', habitante: {} }, { id: 'pagos', nombre: 'pagos', habitante: {} }, { id: 'vacia', nombre: 'vacía' }],
    aConversacion: async (x, texto) => { if (o.falla) throw new Error('sigue abierta fuera'); conversaciones.push({ claudeId: x.destino.claudeId, cwd: x.destino.cwd, texto }); return 'nueva'; },
    aSala: async (x, texto) => { aSalas.push({ sala: x.destino.sala, clave: x.destino.clave, texto }); return { ok: true, texto: 'ok' }; },
    cambiado: l => cambios.push(l.length),
    aviso: t => avisos.push(t),
    ahora: () => reloj.t,
  };
  return { c, conversaciones, aSalas, avisos, cambios };
}

describe('mensajes programados: almacén y entrega', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'programados-')); setLanguage('en'); });

  it('sin sala, vuelve a la misma conversación (su id de Claude Code y su worktree) a su hora, también tras reiniciar', async () => {
    const reloj = { t: AHORA };
    const x = ctx(reloj);
    const p = new Scheduled(dir, x.c);
    const r = p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'Review with Ana: two-step design; tracker comment.' });
    expect(r.ok).toBe(true);
    expect(r.texto).toContain('09:00');
    expect(p.lista()[0]).toMatchObject({ cuando: L(16, 9), destino: { tipo: 'conversacion', salaId: 'express', claudeId: 'c-111', cwd: '/r/wt/abc-1' } });
    expect(JSON.parse(readFileSync(path.join(dir, 'mensajes-programados.json'), 'utf8')).items).toHaveLength(1);

    await p.repasar();
    expect(x.conversaciones).toEqual([]);   // aún no toca

    // el servidor se reinicia y vuelve el lunes a las 9:00: lo lee del disco y lo entrega
    reloj.t = L(16, 9, 1);
    const y = ctx(reloj);
    const q = new Scheduled(dir, y.c);
    await q.repasar();
    expect(y.conversaciones).toHaveLength(1);
    expect(y.conversaciones[0]).toMatchObject({ claudeId: 'c-111', cwd: '/r/wt/abc-1' });
    expect(y.conversaciones[0].texto).toContain('⏰ Scheduled on');
    expect(y.conversaciones[0].texto).toContain('two-step design');
    expect(y.conversaciones[0].texto).not.toContain('late');
    expect(q.lista()).toEqual([]);
    expect(new Scheduled(dir, y.c).lista()).toEqual([]);
  });

  it('lo que venció con el juego cerrado llega al arrancar, marcado con retraso', async () => {
    const reloj = { t: AHORA };
    const p = new Scheduled(dir, ctx(reloj).c);
    p.programar('express', 's1', { cuando: '2026-11-16T10:00', mensaje: 'x' });
    reloj.t = L(17, 8);
    const y = ctx(reloj);
    await new Scheduled(dir, y.c).repasar();
    expect(y.conversaciones[0].texto).toContain('late');
  });

  it('con sala y clave, a esa sala como send_to_room', async () => {
    const reloj = { t: AHORA };
    const x = ctx(reloj);
    const p = new Scheduled(dir, x.c);
    expect(p.programar('express', 's1', { cuando: '2026-11-16T11:00', mensaje: 'Check the API', sala: 'pagos', clave: 'abc-2' }).ok).toBe(true);
    expect(p.lista()[0].destino).toEqual({ tipo: 'sala', sala: 'pagos', clave: 'ABC-2' });
    expect(p.programar('express', 's1', { cuando: '2026-11-17', mensaje: 'x', sala: 'pagos', clave: 'Preflight-Popover' }).ok).toBe(true);
    expect(p.lista()[1].destino).toEqual({ tipo: 'sala', sala: 'pagos', clave: 'preflight-popover' });
    reloj.t = L(16, 11);
    await p.repasar();
    expect(x.aSalas).toEqual([{ sala: 'pagos', clave: 'ABC-2', texto: expect.stringContaining('Check the API') }]);
    expect(x.conversaciones).toEqual([]);
  });

  it('rechaza fechas malas, salas sin habitante, claves raras y pasar del límite por conversación', () => {
    const p = new Scheduled(dir, ctx({ t: AHORA }).c);
    expect(p.programar('express', 's1', { cuando: 'Monday', mensaje: 'x' }).ok).toBe(false);
    expect(p.programar('express', 's1', { cuando: '2026-11-16', mensaje: '  ' }).ok).toBe(false);
    expect(p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'x', sala: 'vacia' }).ok).toBe(false);
    expect(p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'x', sala: 'pagos', clave: 'not a key!' }).ok).toBe(false);
    expect(p.programar('express', 'otra', { cuando: '2026-11-16', mensaje: 'x' }).ok).toBe(false);   // sin conversación conocida
    for (let i = 0; i < 10; i++) expect(p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'x' + i }).ok).toBe(true);
    const r = p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'once' });
    expect(r.ok).toBe(false);
    expect(r.texto).toContain('10');
    expect(p.lista()).toHaveLength(10);
  });

  it('sin poder entregarlo, se queda, avisa una vez y lo reintenta', async () => {
    const reloj = { t: AHORA };
    const x = ctx(reloj, { falla: true });
    const p = new Scheduled(dir, x.c);
    p.programar('express', 's1', { cuando: '2026-11-13T16:30', mensaje: 'x' });
    reloj.t = L(13, 16, 31);
    await p.repasar(); await p.repasar();
    expect(x.avisos).toHaveLength(1);
    expect(p.lista()).toHaveLength(1);
  });

  it('un habitante solo ve y cancela los suyos; el Supervisor edita y cancela cualquiera', () => {
    const p = new Scheduled(dir, ctx({ t: AHORA }).c);
    p.programar('express', 's1', { cuando: '2026-11-16', mensaje: 'a' });
    const id = p.lista()[0].id;
    expect(p.deConversacion('s1').map(x => x.id)).toEqual([id]);
    expect(p.deConversacion('otra')).toEqual([]);
    expect(ofConversation(p.lista(), { claudeId: 'c-111' })).toHaveLength(1);   // tras reiniciar, por su id de Claude Code
    expect(p.cancelar(id, 'otra')).toBe(false);
    expect(p.editar(id, { cuando: '2026-11-21T10:00', mensaje: ' b ' })).toMatchObject({ cuando: L(23, 9), mensaje: 'b' });   // sábado → lunes
    expect(() => p.editar(id, { cuando: '2026-11-01' })).toThrow();
    expect(p.cancelar(id)).toBe(true);
    expect(p.lista()).toEqual([]);
    expect(existsSync(path.join(dir, 'mensajes-programados.json'))).toBe(true);
  });
});
