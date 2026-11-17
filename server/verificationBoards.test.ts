import { describe, expect, it } from 'vitest';
import { boardsUnset, doneTransition, saveBoard, taskTracker, type CtxTrackers } from './verificationBoards.ts';

// a made-up Jira with two boards, each with its own workflow
function ctx(): CtxTrackers & { aj: Record<string, any> } {
  const aj: Record<string, any> = { ABC: { prueba: 'Prod check', hecho: 'Done' } };
  return {
    aj, ajustes: () => aj, guardar: (b, v) => { aj[b] = v; }, conectada: f => f === 'jira',
    accion: async nombre => (nombre === 'panel' ? { tareas: [{ clave: 'ABC-1', estado: 'PROD CHECK', categoria: 'indeterminate' }, { clave: 'XY-2', estado: 'In progress', categoria: 'indeterminate' }] } : {}),
  };
}

describe('the tracker\'s side of production verification', () => {
  it('a task is in prod check by its own board\'s status; it can move to done once verified', async () => {
    const c = ctx();
    expect(await taskTracker(c, 'ABC-1')).toMatchObject({ fuente: 'jira', tablero: 'ABC', enPrueba: true, mover: false });
    expect(await taskTracker(c, 'abc-1', true)).toMatchObject({ mover: true });
    expect(await taskTracker(c, 'XY-2')).toMatchObject({ enPrueba: false });
    expect((await taskTracker(c, 'XY-2'))?.prueba).toBeUndefined();
    expect(await taskTracker(c, 'ZZ-9')).toBeUndefined();
  });

  it('asks for the boards still without a prod-check status, and saves each board on its own', async () => {
    const c = ctx();
    expect(await boardsUnset(c)).toEqual(['XY']);
    saveBoard(c, 'xy', { prueba: ' Verify ', hecho: '' });
    expect(c.aj.XY).toEqual({ prueba: 'Verify' });
    expect(await boardsUnset(c)).toEqual([]);
    expect(() => saveBoard(c, 'x y', {})).toThrow();
  });

  it('moves to done only with a single matching transition', () => {
    const tr = (id: string, a: string) => ({ id, nombre: a, a, categoria: 'done' as const });
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')], 'done')?.id).toBe('1');
    expect(doneTransition([tr('1', 'Done'), tr('2', 'Discarded')])).toBeUndefined();
    expect(doneTransition([tr('1', 'Done')])?.id).toBe('1');
  });
});
