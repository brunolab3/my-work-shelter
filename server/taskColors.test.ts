import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TasksColors } from './taskColors.ts';
import { TASKS_PALETTE } from '../shared/tasks.ts';

describe('colores de las tareas guardados', () => {
  it('cada tarea conserva su color tras reiniciar, las que se dejan de ver lo sueltan y lo que no es una clave no cuenta', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'colores-'));
    const c = new TasksColors(dir), t0 = Date.now();
    expect(c.colors(['ref-231', 'REF-236', 'REF-240', 'no vale', 'PR-9'], t0)).toEqual({ 'REF-231': TASKS_PALETTE[0], 'REF-236': TASKS_PALETTE[1], 'REF-240': TASKS_PALETTE[2], 'PR-9': TASKS_PALETTE[3] });
    expect(new TasksColors(dir).colors(['REF-240'], t0)).toEqual({ 'REF-240': TASKS_PALETTE[2] });
    // tres semanas después solo sigue REF-240 (vista hace poco): la nueva toma el primer color libre
    expect(c.colors(['REF-240', 'XYZ-1'], t0 + 21 * 86_400_000)).toEqual({ 'REF-240': TASKS_PALETTE[2], 'XYZ-1': TASKS_PALETTE[0] });
    // slug keys take no color, so they don't use up the palette
    expect(c.colors(['preflight-popover', 'XYZ-2'], t0 + 21 * 86_400_000)).toEqual({ 'XYZ-2': TASKS_PALETTE[1] });
  });
  it('epics take their own saved color from the same palette, and tasks without one get none', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'colores-'));
    const c = new TasksColors(dir), t0 = Date.now();
    const epic = { key: 'tal-1', title: 'Red fiable' };
    const r = c.paint([{ key: 'TAL-7', epic }, { key: 'TAL-8', epic }, { key: 'TAL-9' }], t0);
    expect(r).toEqual([
      { key: 'TAL-7', color: TASKS_PALETTE[1], epic: { ...epic, color: TASKS_PALETTE[0] } },
      { key: 'TAL-8', color: TASKS_PALETTE[2], epic: { ...epic, color: TASKS_PALETTE[0] } },
      { key: 'TAL-9', color: TASKS_PALETTE[3] },
    ]);
    expect(new TasksColors(dir).colors(['TAL-1'], t0)).toEqual({ 'TAL-1': TASKS_PALETTE[0] });
  });
});
