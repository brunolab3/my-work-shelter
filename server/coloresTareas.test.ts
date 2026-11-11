import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TasksColors } from './coloresTareas.ts';
import { TASKS_PALETTE } from '../shared/tareas.ts';

describe('colores de las tareas guardados', () => {
  it('cada tarea conserva su color tras reiniciar, las que se dejan de ver lo sueltan y lo que no es una clave no cuenta', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'colores-'));
    const c = new TasksColors(dir), t0 = Date.now();
    expect(c.colores(['ref-231', 'REF-236', 'REF-240', 'no vale', 'PR-9'], t0)).toEqual({ 'REF-231': TASKS_PALETTE[0], 'REF-236': TASKS_PALETTE[1], 'REF-240': TASKS_PALETTE[2], 'PR-9': TASKS_PALETTE[3] });
    expect(new TasksColors(dir).colores(['REF-240'], t0)).toEqual({ 'REF-240': TASKS_PALETTE[2] });
    // tres semanas después solo sigue REF-240 (vista hace poco): la nueva toma el primer color libre
    expect(c.colores(['REF-240', 'XYZ-1'], t0 + 21 * 86_400_000)).toEqual({ 'REF-240': TASKS_PALETTE[2], 'XYZ-1': TASKS_PALETTE[0] });
  });
});
