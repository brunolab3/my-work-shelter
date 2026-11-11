import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finishedTasks, cleanupMessage, TasksCleanup, type RoomCleanup, type CtxCleanup } from './limpiezaTareas.ts';
import type { PRBoard } from '../shared/tablero.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocolo.ts';

const pr = (numero: number, rama: string, estado: PRBoard['estado'], repo = 'refugio/express', titulo = 'Algo'): PRBoard =>
  ({ numero, titulo, url: `https://github.com/${repo}/pull/${numero}`, repo, rama, estado, actualizado: 0 });
const wt = (ruta: string, rama: string, extra: Partial<InfoWorktree> = {}): InfoWorktree => ({ ruta, rama, principal: false, cambios: 0, advanced: 0, ...extra });
const sala = (worktrees: InfoWorktree[]): RoomCleanup => ({
  id: 'express', nombre: 'Express', ruta: '/r/express', repo: 'refugio/express',
  worktrees: [{ ruta: '/r/express', rama: 'main', principal: true, cambios: 0, advanced: 0 }, ...worktrees],
});

describe('finishedTasks', () => {
  it('una tarea con todos sus PR fusionados y su worktree en la sala', () => {
    const s = sala([wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra'), wt('/r/express/.claude/worktrees/otra', 'otra')]);
    const out = finishedTasks(s, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'REF-212-pruebas', 'fusionado')]);
    expect(out.map(x => [x.tarea, x.prs.map(p => p.numero), x.worktrees.map(w => w.ruta)]))
      .toEqual([['REF-212', [42, 43], ['/r/express/.claude/worktrees/shelter-ref-212']]]);
  });
  it('no, si queda un PR de la tarea abierto o en borrador', () => {
    const s = sala([wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra')]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'ref-212-pruebas', 'abierto')])).toEqual([]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'ref-212-pruebas', 'borrador')])).toEqual([]);
  });
  it('sí, con sus PR cerrados sin fusionar (se reabren si hace falta)', () => {
    const s = sala([wt('/r/x/shelter-ref-212', 'ref-212-barra')]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'cerrado')]).map(x => x.tarea)).toEqual(['REF-212']);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'ref-212-otra', 'cerrado')]).map(x => x.prs.map(p => p.numero))).toEqual([[42, 43]]);
  });
  it('no, sin worktree de la tarea, en la copia principal o con PR de otro repo', () => {
    expect(finishedTasks(sala([]), [pr(42, 'ref-212-barra', 'fusionado')])).toEqual([]);
    expect(finishedTasks(sala([]), [pr(42, 'main', 'fusionado')])).toEqual([]);
    expect(finishedTasks(sala([wt('/r/x/shelter-ref-212', 'ref-212-barra')]), [pr(42, 'ref-212-barra', 'fusionado', 'refugio/otro')])).toEqual([]);
  });
  it('sin clave: por su rama o por su número en el nombre del worktree', () => {
    const s = sala([wt('/r/x/rapido', 'arreglo-rapido'), wt('/r/x/shelter-pr-7', 'detached')]);
    const out = finishedTasks(s, [pr(5, 'arreglo-rapido', 'fusionado'), pr(7, 'otra-cosa', 'fusionado')]);
    expect(out.map(x => [x.tarea, x.worktrees.map(w => w.ruta)])).toEqual([['PR #5', ['/r/x/rapido']], ['PR #7', ['/r/x/shelter-pr-7']]]);
  });
});

describe('cleanupMessage', () => {
  it('lista los PR y avisa de cambios y conversaciones abiertas en cada worktree', () => {
    const w = wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra', { cambios: 3 });
    const sesiones = [{ id: 's1', estado: 'ociosa', cwd: w.ruta, salaId: 'express', actualizada: 0 }] as unknown as SessionSummary[];
    const m = cleanupMessage('refugio/express', [{ tarea: 'REF-212', prs: [pr(42, 'ref-212-barra', 'fusionado'), pr(44, 'ref-212-x', 'cerrado')], worktrees: [w] }], sesiones);
    expect(m).toContain('REF-212');
    expect(m).toContain('#42');
    expect(m).toMatch(/#42, #44 cerrado sin fusionar/);
    expect(m).toMatch(/`\/r\/express\/\.claude\/worktrees\/shelter-ref-212` \(ref-212-barra\) · 3 .* · /);
    expect(m).toContain('git worktree remove');
  });
});

describe('TasksCleanup', () => {
  const ctx = (prs: PRBoard[], enviar: (salaId: string, cwd: string, texto: string) => Promise<boolean>, entregas: string[][]): CtxCleanup => ({
    connection: async () => ({ real: true }),
    prs: async () => prs,
    salas: async () => [sala([wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra')])],
    sesiones: () => [],
    enviar,
    delivered: (_s, tareas) => entregas.push(tareas.map(x => x.tarea)),
  });

  it('avisa a la copia principal de la sala una sola vez por tarea, también tras reiniciar', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    const enviados: [string, string][] = [], entregas: string[][] = [];
    const enviar = async (salaId: string, cwd: string) => { enviados.push([salaId, cwd]); return true; };
    const prs = [pr(42, 'ref-212-barra', 'fusionado')];
    const a = new TasksCleanup(dir, ctx(prs, enviar, entregas));
    await a.sondear(); await a.sondear();
    await new TasksCleanup(dir, ctx(prs, enviar, entregas)).sondear();
    expect(enviados).toEqual([['express', '/r/express']]);
    expect(entregas).toEqual([['REF-212']]);
  });
  it('si no se ha podido entregar, lo vuelve a intentar', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    let ok = false, n = 0;
    const c = new TasksCleanup(dir, ctx([pr(42, 'ref-212-barra', 'fusionado')], async () => { n++; return ok; }, []));
    await c.sondear(); ok = true; await c.sondear(); await c.sondear();
    expect(n).toBe(2);
  });
  it('sin GitHub conectado de verdad no hace nada', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    let n = 0;
    const c = new TasksCleanup(dir, { ...ctx([pr(42, 'ref-212-barra', 'fusionado')], async () => { n++; return true; }, []), connection: async () => ({ real: false }) });
    await c.sondear();
    expect(n).toBe(0);
  });
});
