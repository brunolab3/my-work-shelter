import { describe, expect, it } from 'vitest';
import { boardRows, prRollup, sessionMark, type BoardSession } from './roomBoard';
import type { PRBoard } from './board';

const R = '/repos/web-app';
const wt = (n: string, extra = {}) => ({ ruta: `${R}/.claude/worktrees/shelter-${n}`, rama: `worktree-shelter-${n}`, principal: false, cambios: 0, advanced: 0, ...extra });
const MAIN = { ruta: R, rama: 'main', principal: true, cambios: 2, advanced: 0 };
const ses = (cwd: string, estado: BoardSession['estado'], extra: Partial<BoardSession> = {}): BoardSession => ({ estado, cwd, salaId: 'web-app', actualizada: 1, ...extra });
const pr = (rama: string, extra: Partial<PRBoard> = {}): PRBoard => ({ numero: 1, titulo: 'x', url: 'u' + Math.random(), repo: 'org/web-app', rama, estado: 'abierto', actualizado: 1, ...extra });

describe('prRollup', () => {
  it('lets what most needs someone win across the PRs', () => {
    expect(prRollup([])).toBeUndefined();
    expect(prRollup([pr('a', { revision: 'APPROVED' }), pr('b', { checks: 'FAILURE' })])).toBe('ci');
    expect(prRollup([pr('a', { revision: 'APPROVED' }), pr('b', { revision: 'CHANGES_REQUESTED' })])).toBe('cambios');
    expect(prRollup([pr('a', { revision: 'APPROVED' }), pr('b', { revision: 'REVIEW_REQUIRED' })])).toBe('revision');
    expect(prRollup([pr('a', { revision: 'APPROVED' }), pr('b', { estado: 'borrador' })])).toBe('aprobado');
    expect(prRollup([pr('a', { estado: 'borrador' }), pr('b', { estado: 'fusionado' })])).toBe('borrador');
    expect(prRollup([pr('a', { estado: 'fusionado' }), pr('b', { estado: 'cerrado' })])).toBe('fusionado');
    expect(prRollup([pr('a', { estado: 'cerrado' })])).toBe('cerrado');
    expect(prRollup([pr('a', { conflictos: true, revision: 'APPROVED' })])).toBe('conflictos');
    // a merged PR's old failing CI doesn't count
    expect(prRollup([pr('a', { estado: 'fusionado', checks: 'FAILURE' })])).toBe('fusionado');
  });
});

describe('sessionMark', () => {
  it('takes the most urgent open conversation, with what it waits on or does', () => {
    expect(sessionMark([])).toEqual({});
    expect(sessionMark([ses(R, 'cerrada')])).toEqual({});
    expect(sessionMark([ses(R, 'trabajando', { actividad: { texto: 'editing app.ts' } }), ses(R, 'esperando', { pending: { titulo: 'permission: git push' } })]))
      .toEqual({ sesion: 'esperando', detalle: 'permission: git push' });
    expect(sessionMark([ses(R, 'ociosa'), ses(R, 'trabajando', { actividad: { texto: 'editing app.ts' } })])).toEqual({ sesion: 'trabajando', detalle: 'editing app.ts' });
    expect(sessionMark([ses(R, 'terminada', { sinLeer: true })])).toEqual({ sesion: 'listo' });
    expect(sessionMark([ses(R, 'ociosa')])).toEqual({ sesion: 'abierta' });
  });
});

describe('boardRows', () => {
  it('puts the main copy first and each worktree after it, with its task, its conversations and only its PRs in this repo', () => {
    const a = wt('ABC-101'), b = wt('checkout-flow--k3x9');
    const rows = boardRows('web-app', R, [MAIN, a, b], [
      ses(a.ruta + '/src', 'esperando', { pending: { titulo: 'permission: git push' } }),
      ses(R, 'trabajando', { actividad: { texto: 'reading README' } }),
    ], [
      pr(a.rama, { revision: 'REVIEW_REQUIRED' }),
      pr('worktree-shelter-ABC-101-api', { titulo: 'ABC-101 api', repo: 'org/api', checks: 'FAILURE' }),   // the same task in another room's repo
    ]);
    expect(rows.map(r => [r.principal, r.clave, r.sesion, r.pr, r.prs])).toEqual([
      [true, undefined, 'trabajando', undefined, 0],
      [false, 'ABC-101', 'esperando', 'revision', 1],
      [false, 'checkout-flow', undefined, undefined, 0],
    ]);
    expect(rows[1].detalle).toBe('permission: git push');
    expect(rows[0].detalle).toBe('reading README');
  });
  it('shows a worktree a conversation has just created before git lists it', () => {
    const rows = boardRows('web-app', R, [MAIN], [ses(`${R}/.claude/worktrees/shelter-ABC-9`, 'trabajando')], []);
    expect(rows.map(r => r.clave)).toEqual([undefined, 'ABC-9']);
    expect(rows[1].sesion).toBe('trabajando');
    expect(rows[0].sesion).toBeUndefined();
  });
});
