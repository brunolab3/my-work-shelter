import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { agruparPorTarea, planDeSala, applyPlan, promptTask } from './organizar.ts';
import { sessionOfPR } from './revisionesPR.ts';
import type { PRBoard } from '../shared/tablero.ts';

const pr = (numero: number, rama: string, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ numero, titulo: 'PR ' + numero, url: 'https://github.com/o/r/pull/' + numero, repo: 'o/r', rama, base: 'main', estado: 'abierto', actualizado: 0, ...extra });

describe('agruparPorTarea', () => {
  it('una tarea por clave; los apilados van juntos aunque no la lleven, de la base hacia arriba; fusionados fuera', () => {
    const g = agruparPorTarea([
      pr(14, 'abc-1-arriba', { base: 'abc-1-medio' }), pr(12, 'abc-1-base'), pr(13, 'abc-1-medio', { base: 'abc-1-base' }),
      pr(20, 'sin-clave-encima', { base: 'abc-1-arriba' }),
      pr(30, 'arreglo-suelto'), pr(31, 'otra', { titulo: 'XYZ-9 algo' }), pr(32, 'xyz-9-b'),
      pr(40, 'abc-1-viejo', { estado: 'fusionado' }),
    ]);
    expect(g.map(x => [x.id, x.nombre, x.prs.map(p => p.numero)])).toEqual([
      ['ABC-1', 'shelter-abc-1', [12, 13, 14, 20]],
      ['pr-30', 'shelter-pr-30', [30]],
      ['XYZ-9', 'shelter-xyz-9', [31, 32]],
    ]);
  });
});

describe('planDeSala', () => {
  it('reutiliza el worktree de la tarea (por rama o por nombre), usa la copia principal si su rama está ahí y no duplica conversaciones', () => {
    const grupos = agruparPorTarea([pr(1, 'abc-1-x'), pr(2, 'def-2-y'), pr(3, 'ghi-3-z'), pr(4, 'jkl-4')]);
    const wts = [{ ruta: '/r', rama: 'jkl-4', principal: true, cambios: 0, advanced: 0 }, { ruta: '/r/.claude/worktrees/shelter-abc-1-cosas-a1b2', rama: 'otra', principal: false, cambios: 0, advanced: 0 }, { ruta: '/r/.claude/worktrees/w', rama: 'def-2-y', principal: false, cambios: 0, advanced: 0 }];
    const ses = [{ id: 's1', salaId: 'r', cwd: '/r/.claude/worktrees/w', estado: 'ociosa' }] as any;
    const p = planDeSala({ ruta: '/r', rama: 'jkl-4', worktrees: wts }, grupos, ses);
    expect(p.map(x => [x.grupo.id, path.basename(x.ruta), x.crear, x.principal, x.sesion ?? null])).toEqual([
      ['ABC-1', 'shelter-abc-1-cosas-a1b2', false, false, null],
      ['DEF-2', 'w', false, false, 's1'],
      ['GHI-3', 'shelter-ghi-3', true, false, null],
      ['JKL-4', 'r', false, true, null],
    ]);
  });
  it('el mensaje dice el orden de la pila y que se trabaje de uno en uno', () => {
    const [g] = agruparPorTarea([pr(2, 'abc-1-b', { base: 'abc-1-a' }), pr(1, 'abc-1-a')]);
    const t = promptTask(g, 'o/r');
    expect(t.split('\n')[0]).toBe('ABC-1 · tus 2 PR abiertos en o/r');
    expect(t).toContain('1. #1 «PR 1» · rama `abc-1-a` sobre `main`');
    expect(t).toContain('De uno en uno'); expect(t).toContain('rebasa los de encima');
  });
  it('las revisiones de un PR sin clave van a la conversación del worktree que lleva su número', () => {
    const salas = [{ id: 'r', nombre: 'r', ruta: '/r', worktrees: [], repo: 'o/r' }];
    const ses = [{ id: 's', salaId: 'r', cwd: '/r/.claude/worktrees/shelter-pr-30-31', worktree: '/r/.claude/worktrees/shelter-pr-30-31', estado: 'ociosa', actualizada: 1 }] as any;
    expect(sessionOfPR({ repo: 'o/r', rama: 'otra-rama', numero: 31 }, salas, ses)?.sesion.id).toBe('s');
  });
});

describe('aplicarPlan con git de verdad', () => {
  it('crea el worktree de la tarea en la rama de la base de la pila y deja las de encima como ramas locales del remoto', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'organizar-'));
    const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' } });
    const origen = path.join(dir, 'origen.git'), trabajo = path.join(dir, 'trabajo'), sala = path.join(dir, 'sala');
    execFileSync('git', ['init', '--bare', '-b', 'main', origen], { stdio: 'ignore' });
    execFileSync('git', ['clone', origen, trabajo], { stdio: 'ignore' });
    writeFileSync(path.join(trabajo, 'a.txt'), 'a'); g(trabajo, 'add', '.'); g(trabajo, 'commit', '-m', 'inicio'); g(trabajo, 'push', 'origin', 'main');
    g(trabajo, 'checkout', '-b', 'abc-1-base'); writeFileSync(path.join(trabajo, 'b.txt'), 'b'); g(trabajo, 'add', '.'); g(trabajo, 'commit', '-m', 'base');
    g(trabajo, 'checkout', '-b', 'abc-1-arriba'); writeFileSync(path.join(trabajo, 'c.txt'), 'c'); g(trabajo, 'add', '.'); g(trabajo, 'commit', '-m', 'arriba');
    g(trabajo, 'push', 'origin', 'abc-1-base', 'abc-1-arriba');
    execFileSync('git', ['clone', origen, sala], { stdio: 'ignore' });
    const grupos = agruparPorTarea([pr(2, 'abc-1-arriba', { base: 'abc-1-base' }), pr(1, 'abc-1-base')]);
    const pasos = planDeSala({ ruta: sala, rama: 'main', worktrees: [{ ruta: sala, rama: 'main', principal: true, cambios: 0, advanced: 0 }] }, grupos, []);
    const empezadas: [string, string][] = [];
    const hecho = await applyPlan({ git: async (cwd, a) => g(cwd, ...a), empezar: async (_s, cwd, prompt) => { empezadas.push([cwd, prompt.split('\n')[0]]); return 'x'; } }, { id: 'sala', ruta: sala }, pasos, 'o/r', () => 5);
    const wt = path.join(sala, '.claude', 'worktrees', 'shelter-abc-1');
    expect(hecho).toEqual(['ABC-1: worktree nuevo y conversación empezada.']);
    expect(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('abc-1-base');
    expect(existsSync(path.join(wt, 'b.txt')) && !existsSync(path.join(wt, 'c.txt'))).toBe(true);
    expect(g(sala, 'rev-parse', '--abbrev-ref', 'abc-1-arriba@{upstream}').trim()).toBe('origin/abc-1-arriba');
    expect(empezadas).toEqual([[wt, 'ABC-1 · tus 2 PR abiertos en o/r']]);
    // otra vez: ya existe y ya no empieza nada si se le dice que tiene conversación
    const otra = planDeSala({ ruta: sala, rama: 'main', worktrees: [{ ruta: sala, rama: 'main', principal: true, cambios: 0, advanced: 0 }, { ruta: wt, rama: 'abc-1-base', principal: false, cambios: 0, advanced: 0 }] }, grupos, [{ id: 's', salaId: 'sala', cwd: wt, estado: 'ociosa' } as any]);
    expect(otra.map(p => [p.crear, p.sesion])).toEqual([[false, 's']]);
  });
});
