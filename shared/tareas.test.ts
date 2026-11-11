import { describe, expect, it } from 'vitest';
import { TASKS_PALETTE, assignColors, textKey, taskColor, pRTask, worktreeTask, remoteName } from './tareas';

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
