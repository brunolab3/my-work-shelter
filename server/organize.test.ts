import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { groupByTask, roomPlan, applyPlan, promptTask } from './organize.ts';
import { sessionOfPR } from './prReviews.ts';
import type { PRBoard } from '../shared/board.ts';

const pr = (number: number, branch: string, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title: 'PR ' + number, url: 'https://github.com/o/r/pull/' + number, repo: 'o/r', branch, base: 'main', state: 'open', updated: 0, ...extra });

describe('agruparPorTarea', () => {
  it('una tarea por clave; los apilados van juntos aunque no la lleven, de la base hacia arriba; fusionados fuera', () => {
    const g = groupByTask([
      pr(14, 'abc-1-arriba', { base: 'abc-1-medio' }), pr(12, 'abc-1-base'), pr(13, 'abc-1-medio', { base: 'abc-1-base' }),
      pr(20, 'sin-clave-encima', { base: 'abc-1-arriba' }),
      pr(30, 'arreglo-suelto'), pr(31, 'other', { title: 'XYZ-9 algo' }), pr(32, 'xyz-9-b'),
      pr(40, 'abc-1-viejo', { state: 'merged' }),
    ]);
    expect(g.map(x => [x.id, x.name, x.prs.map(p => p.number)])).toEqual([
      ['ABC-1', 'shelter-abc-1', [12, 13, 14, 20]],
      ['pr-30', 'shelter-pr-30', [30]],
      ['XYZ-9', 'shelter-xyz-9', [31, 32]],
    ]);
  });
});

describe('planDeSala', () => {
  it('reutiliza el worktree de la tarea (por rama o por nombre), usa la copia principal si su rama está ahí y no duplica conversaciones', () => {
    const groups = groupByTask([pr(1, 'abc-1-x'), pr(2, 'def-2-y'), pr(3, 'ghi-3-z'), pr(4, 'jkl-4')]);
    const wts = [{ path: '/r', branch: 'jkl-4', main: true, changes: 0, advanced: 0 }, { path: '/r/.claude/worktrees/shelter-abc-1-cosas-a1b2', branch: 'other', main: false, changes: 0, advanced: 0 }, { path: '/r/.claude/worktrees/w', branch: 'def-2-y', main: false, changes: 0, advanced: 0 }];
    const sess = [{ id: 's1', roomId: 'r', cwd: '/r/.claude/worktrees/w', state: 'idle' }] as any;
    const p = roomPlan({ path: '/r', branch: 'jkl-4', worktrees: wts }, groups, sess);
    expect(p.map(x => [x.group.id, path.basename(x.path), x.create, x.main, x.session ?? null])).toEqual([
      ['ABC-1', 'shelter-abc-1-cosas-a1b2', false, false, null],
      ['DEF-2', 'w', false, false, 's1'],
      ['GHI-3', 'shelter-ghi-3', true, false, null],
      ['JKL-4', 'r', false, true, null],
    ]);
  });
  it('el mensaje dice el orden de la pila y que se trabaje de uno en uno', () => {
    const [g] = groupByTask([pr(2, 'abc-1-b', { base: 'abc-1-a' }), pr(1, 'abc-1-a')]);
    const t = promptTask(g, 'o/r');
    expect(t.split('\n')[0]).toBe('ABC-1 · tus 2 PR abiertos en o/r');
    expect(t).toContain('1. #1 «PR 1» · rama `abc-1-a` sobre `main`');
    expect(t).toContain('De uno en uno'); expect(t).toContain('rebasa los de encima');
  });
  it('las revisiones de un PR sin clave van a la conversación del worktree que lleva su número', () => {
    const rooms = [{ id: 'r', name: 'r', path: '/r', worktrees: [], repo: 'o/r' }];
    const sess = [{ id: 's', roomId: 'r', cwd: '/r/.claude/worktrees/shelter-pr-30-31', worktree: '/r/.claude/worktrees/shelter-pr-30-31', state: 'idle', updated: 1 }] as any;
    expect(sessionOfPR({ repo: 'o/r', branch: 'otra-rama', number: 31 }, rooms, sess)?.session.id).toBe('s');
  });
});

describe('aplicarPlan con git de verdad', () => {
  it('crea el worktree de la tarea en la rama de la base de la pila y deja las de encima como ramas locales del remoto', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'organizar-'));
    const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' } });
    const origin = path.join(dir, 'origen.git'), work = path.join(dir, 'trabajo'), room = path.join(dir, 'room');
    execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'ignore' });
    execFileSync('git', ['clone', origin, work], { stdio: 'ignore' });
    writeFileSync(path.join(work, 'a.txt'), 'a'); g(work, 'add', '.'); g(work, 'commit', '-m', 'inicio'); g(work, 'push', 'origin', 'main');
    g(work, 'checkout', '-b', 'abc-1-base'); writeFileSync(path.join(work, 'b.txt'), 'b'); g(work, 'add', '.'); g(work, 'commit', '-m', 'base');
    g(work, 'checkout', '-b', 'abc-1-arriba'); writeFileSync(path.join(work, 'c.txt'), 'c'); g(work, 'add', '.'); g(work, 'commit', '-m', 'arriba');
    g(work, 'push', 'origin', 'abc-1-base', 'abc-1-arriba');
    execFileSync('git', ['clone', origin, room], { stdio: 'ignore' });
    const groups = groupByTask([pr(2, 'abc-1-arriba', { base: 'abc-1-base' }), pr(1, 'abc-1-base')]);
    const steps = roomPlan({ path: room, branch: 'main', worktrees: [{ path: room, branch: 'main', main: true, changes: 0, advanced: 0 }] }, groups, []);
    const started: [string, string][] = [];
    const done = await applyPlan({ git: async (cwd, a) => g(cwd, ...a), start: async (_s, cwd, prompt) => { started.push([cwd, prompt.split('\n')[0]]); return 'x'; } }, { id: 'room', path: room }, steps, 'o/r', () => 5);
    const wt = path.join(room, '.claude', 'worktrees', 'shelter-abc-1');
    expect(done).toEqual(['ABC-1: worktree nuevo y conversación empezada.']);
    expect(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('abc-1-base');
    expect(existsSync(path.join(wt, 'b.txt')) && !existsSync(path.join(wt, 'c.txt'))).toBe(true);
    expect(g(room, 'rev-parse', '--abbrev-ref', 'abc-1-arriba@{upstream}').trim()).toBe('origin/abc-1-arriba');
    expect(started).toEqual([[wt, 'ABC-1 · tus 2 PR abiertos en o/r']]);
    // otra vez: ya existe y ya no empieza nada si se le dice que tiene conversación
    const other = roomPlan({ path: room, branch: 'main', worktrees: [{ path: room, branch: 'main', main: true, changes: 0, advanced: 0 }, { path: wt, branch: 'abc-1-base', main: false, changes: 0, advanced: 0 }] }, groups, [{ id: 's', roomId: 'room', cwd: wt, state: 'idle' } as any]);
    expect(other.map(p => [p.create, p.session])).toEqual([[false, 's']]);
  });
});
