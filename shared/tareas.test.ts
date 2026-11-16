import { describe, expect, it } from 'vitest';
import { TASKS_PALETTE, assignColors, textKey, taskColor, pRTask, worktreeTask, remoteName, worktreePRs, newWorktreeOf, taskWorktreeIn, handMadeWorktree } from './tareas';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('tareas y su color', () => {
  it('la tarea sale de la rama, del título o del nombre del worktree (que manda aunque se cambie de rama dentro)', () => {
    expect(textKey('feature/abc-123-algo')).toBe('ABC-123');
    expect(pRTask({ rama: 'arreglo', titulo: 'XYZ-9 cosas', numero: 4 })).toBe('XYZ-9');
    expect(pRTask({ rama: 'arreglo', titulo: 'cosas', numero: 4 })).toBe('PR-4');
    expect(worktreeTask({ ruta: '/r/.claude/worktrees/shelter-abc-123-titulo-a1b2', rama: 'def-4-otra' })).toBe('ABC-123');
    expect(worktreeTask({ ruta: '/r/.claude/worktrees/shelter-pr-12-13', rama: 'x' })).toBe('PR-12');
    expect(worktreeTask({ ruta: '/r/.claude/worktrees/prueba', rama: 'def-4-otra' })).toBe('DEF-4');
    expect(worktreeTask({ ruta: '/r/.claude/worktrees/prueba', rama: 'main' })).toBeUndefined();
  });
  it('sin asignar, un color de la paleta por la clave (sin importar mayúsculas)', () => {
    expect(taskColor('abc-1')).toBe(taskColor('ABC-1'));
    expect(TASKS_PALETTE).toContain(taskColor('REF-236'));
  });
  it('las nuevas reciben el color menos usado: 16 tareas, 16 colores distintos; la 17.ª repite el primero libre', () => {
    const claves = Array.from({ length: 17 }, (_, i) => 'REF-' + (200 + i * 3));
    const a = assignColors({}, claves);
    expect(new Set(claves.slice(0, 16).map(k => a[k])).size).toBe(16);
    expect(a['REF-248']).toBe(0);
    expect(assignColors({ 'ABC-1': 0, 'ABC-2': 1 }, ['ABC-1', 'ABC-3'])).toEqual({ 'ABC-1': 0, 'ABC-2': 1, 'ABC-3': 2 });
  });

  it('el nombre en Remote Control es repo:TAREA (del worktree o del título) y, sin tarea, repo:título', () => {
    expect(remoteName('api-tienda', 'Arreglar fechas', { ruta: '/r/.claude/worktrees/shelter-abcd-48210-fechas-a1b2' })).toBe('api-tienda:ABCD-48210');
    expect(remoteName('api-tienda', 'ABCD-77 revisar el PR')).toBe('api-tienda:ABCD-77');
    expect(remoteName('api-tienda', 'Revisar el PR')).toBe('api-tienda:Revisar el PR');
  });
});

describe('worktreePRs', () => {
  const pr = (numero: number, rama: string, repo: string, actualizado = numero, titulo = 'PR') => ({ numero, rama, repo, titulo, actualizado });
  const prs = [
    pr(1, 'feature/ABC-1-api', 'org/api'), pr(2, 'feature/ABC-1-otra', 'org/api'), pr(3, 'arreglo', 'org/api', 3, 'ABC-1 sin clave en la rama'),
    pr(4, 'feature/ABC-1-web', 'org/web'), pr(5, 'feature/ABC-2', 'org/api'), pr(6, 'suelto', 'org/api'),
  ];
  it('todos los PR de la tarea del worktree en el repo de su sala, no solo los de su rama', () => {
    expect(worktreePRs(prs, { ruta: '/r/shelter-abc-1', rama: 'feature/ABC-1-api' }, '/Users/x/api').map(p => p.numero)).toEqual([3, 2, 1]);
  });
  it('el repo sale de los PR de su rama aunque la carpeta se llame distinto', () => {
    expect(worktreePRs(prs, { ruta: '/r/shelter-abc-1', rama: 'feature/ABC-1-web' }, '/Users/x/frontal').map(p => p.numero)).toEqual([4]);
  });
  it('sin PR de su rama, el repo sale del nombre de la carpeta de la sala', () => {
    expect(worktreePRs(prs, { ruta: '/r/shelter-abc-1', rama: 'feature/ABC-1-nueva' }, '/Users/x/web').map(p => p.numero)).toEqual([4]);
  });
  it('sin tarea, solo los de su rama', () => {
    expect(worktreePRs(prs, { ruta: '/r/suelto', rama: 'suelto' }, '/Users/x/api').map(p => p.numero)).toEqual([6]);
  });
});

describe('newWorktreeOf', () => {
  it('reconoce git worktree add (con -C y -b) y no otras órdenes', () => {
    expect(newWorktreeOf('git worktree add .claude/worktrees/abc-12-x -b feature/ABC-12-x main')).toEqual({ ruta: '.claude/worktrees/abc-12-x', rama: 'feature/ABC-12-x', cwd: undefined });
    expect(newWorktreeOf('cd repo && git -C ../api worktree add ../wt/ABC-3 ABC-3-otra')).toEqual({ ruta: '../wt/ABC-3', rama: 'ABC-3-otra', cwd: '../api' });
    expect(newWorktreeOf('git worktree add ../wt main')?.rama).toBeUndefined();
    expect(newWorktreeOf('git worktree list')).toBeNull();
    expect(newWorktreeOf('echo "git worktree add x"')).toBeNull();
  });
});

describe('handMadeWorktree', () => {
  it('only from a main copy (no worktree) and only for git worktree add', () => {
    expect(handMadeWorktree('git worktree add ../wt/ABC-3 -b ABC-3-x')).toBe(true);
    expect(handMadeWorktree('git -C ../api worktree add ../wt main', undefined)).toBe(true);
    expect(handMadeWorktree('git worktree add ../wt/ABC-3 -b ABC-3-x', '/r/.claude/worktrees/abc-3')).toBe(false);
    expect(handMadeWorktree('git worktree remove ../wt')).toBe(false);
    expect(handMadeWorktree('git worktree list')).toBe(false);
  });
});

describe('taskWorktreeIn', () => {
  it('con git de verdad: el worktree de la tarea (por su nombre o su rama), nunca la copia principal', () => {
    const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'un-worktree-')));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', env });
    g('init', '-q', '-b', 'ABC-1-en-la-principal'); writeFileSync(path.join(d, 'a'), 'a'); g('add', '.'); g('commit', '-qm', 'a');
    g('worktree', 'add', '-q', '-b', 'feature/ABC-2-x', path.join(d, '.claude', 'worktrees', 'otra'));
    g('worktree', 'add', '-q', '-b', 'suelta', path.join(d, '.claude', 'worktrees', 'shelter-abc-3'));
    const lista = g('worktree', 'list', '--porcelain');
    expect(taskWorktreeIn(lista, 'abc-2')).toEqual({ ruta: path.join(d, '.claude', 'worktrees', 'otra'), rama: 'feature/ABC-2-x' });
    expect(taskWorktreeIn(lista, 'ABC-3')?.rama).toBe('suelta');
    expect(taskWorktreeIn(lista, 'ABC-1')).toBeUndefined();
    expect(taskWorktreeIn(lista, 'ABC-9')).toBeUndefined();
  });
});
