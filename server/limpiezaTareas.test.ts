import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { finishedTasks, leftovers, TasksCleanup, type RoomCleanup, type CtxCleanup, type Leftover } from './limpiezaTareas.ts';
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

// con git de verdad: un remoto (bare), su clon (la copia principal de la sala) y worktrees de tareas
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' } });
const git = (cwd: string, args: string[]) => Promise.resolve().then(() => sh(cwd, ...args));
function repo() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'limpieza-git-')));
  const remoto = path.join(base, 'remoto.git'), sala = path.join(base, 'express');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remoto]);
  execFileSync('git', ['clone', '-q', remoto, sala]);
  writeFileSync(path.join(sala, 'a.txt'), 'a\n'); sh(sala, 'add', '.'); sh(sala, 'commit', '-qm', 'base'); sh(sala, 'push', '-q', 'origin', 'HEAD:main');
  // la tarea: su rama con un commit subido, en un worktree
  const wt = path.join(sala, '.claude', 'worktrees', 'shelter-ref-212');
  sh(sala, 'worktree', 'add', '-q', '-b', 'ref-212-barra', wt);
  writeFileSync(path.join(wt, 'b.txt'), 'b\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'REF-212 barra'); sh(wt, 'push', '-q', '-u', 'origin', 'ref-212-barra');
  return { base, remoto, sala, wt };
}
const infoWt = (ruta: string, rama = 'ref-212-barra') => wt(ruta, rama);

describe('leftovers (git de verdad)', () => {
  it('nada, con todo subido; cambios sin commit, stash de su rama y commits sin subir, sí', async () => {
    const r = repo();
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([]);
    writeFileSync(path.join(r.wt, 'c.txt'), 'c\n');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ tipo: 'cambios', n: 1 }]);
    sh(r.wt, 'stash', '-u', '-q');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ tipo: 'stash', n: 1 }]);
    sh(r.wt, 'stash', 'drop', '-q');
    writeFileSync(path.join(r.wt, 'd.txt'), 'd\n'); sh(r.wt, 'add', '.'); sh(r.wt, 'commit', '-qm', 'sin subir');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ tipo: 'commits', n: 1 }]);
  });
  it('commits que ya no están en el remoto (rama borrada tras un squash) pero sí en la rama del PR: valen', async () => {
    const r = repo();
    const cabeza = sh(r.wt, 'rev-parse', 'HEAD').trim();
    sh(r.sala, 'push', '-q', 'origin', '--delete', 'ref-212-barra'); sh(r.sala, 'fetch', '-q', '--prune');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ tipo: 'commits', n: 1 }]);
    expect(await leftovers(git, infoWt(r.wt), [{ ...pr(42, 'ref-212-barra', 'fusionado'), cabeza }], [])).toEqual([]);
  });
  it('una conversación abierta en el worktree', async () => {
    const r = repo();
    const s = [{ id: 's1', estado: 'ociosa', cwd: r.wt, salaId: 'express', actualizada: 0 }] as unknown as SessionSummary[];
    expect(await leftovers(git, infoWt(r.wt), [], s)).toEqual([{ tipo: 'conversacion' }]);
  });
});

describe('TasksCleanup (git de verdad)', () => {
  let quitarlo: (() => Promise<void>) | undefined;
  const ctx = (r: ReturnType<typeof repo>, prs: PRBoard[], ev: string[], sesiones: SessionSummary[] = []): CtxCleanup => ({
    connection: async () => ({ real: true }),
    prs: async () => prs,
    salas: async () => [{ id: 'express', nombre: 'Express', ruta: r.sala, repo: 'refugio/express', worktrees: [{ ruta: r.sala, rama: 'main', principal: true, cambios: 0, advanced: 0 }, infoWt(r.wt)] }],
    sesiones: () => sesiones,
    git,
    quitado: (_s, x, w) => ev.push(`quitado ${x.tarea} ${path.basename(w.ruta)}`),
    preguntar: (_s, x, _w, que: Leftover[], quitar) => { ev.push(`pregunta ${x.tarea} ${que.map(q => q.tipo).join(',')}`); quitarlo = quitar; },
    cambiado: () => ev.push('cambiado'),
  });
  it('con todos sus PR fusionados o cerrados y nada pendiente, quita el worktree y su rama local; la del remoto se queda', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'ref-212-otra', 'cerrado')], ev)).sondear();
    expect(ev).toEqual(['quitado REF-212 shelter-ref-212', 'cambiado']);
    expect(existsSync(r.wt)).toBe(false);
    expect(sh(r.sala, 'branch', '--list', 'ref-212-barra').trim()).toBe('');
    expect(sh(r.remoto, 'branch', '--list', 'ref-212-barra').trim()).toBe('ref-212-barra');
  });
  it('con un PR aún abierto no toca nada', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'fusionado'), pr(43, 'ref-212-otra', 'abierto')], ev)).sondear();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
  it('si queda algo lo deja, pregunta una vez y lo quita cuando ya no queda nada', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    writeFileSync(path.join(r.wt, 'c.txt'), 'c\n');
    const prs = [pr(42, 'ref-212-barra', 'fusionado')];
    await new TasksCleanup(dir, ctx(r, prs, ev)).sondear();
    await new TasksCleanup(dir, ctx(r, prs, ev)).sondear();
    expect(ev).toEqual(['pregunta REF-212 cambios']);
    expect(existsSync(path.join(r.wt, 'c.txt'))).toBe(true);
    sh(r.wt, 'clean', '-fq');
    await new TasksCleanup(dir, ctx(r, prs, ev)).sondear();
    expect(ev.slice(1)).toEqual(['quitado REF-212 shelter-ref-212', 'cambiado']);
  });
  it('si el Supervisor dice que sí, lo quita aunque tenga cambios sin commit', async () => {
    const r = repo(), ev: string[] = [];
    writeFileSync(path.join(r.wt, 'c.txt'), 'c\n'); writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'fusionado')], ev)).sondear();
    expect(existsSync(r.wt)).toBe(true);
    await quitarlo!();
    expect(ev).toEqual(['pregunta REF-212 cambios', 'quitado REF-212 shelter-ref-212', 'cambiado']);
    expect(existsSync(r.wt)).toBe(false);
  });
  it('con una conversación abierta no pregunta ni lo quita: espera', async () => {
    const r = repo(), ev: string[] = [];
    writeFileSync(path.join(r.wt, 'c.txt'), 'c\n');
    const s = [{ id: 's1', estado: 'trabajando', cwd: r.wt, salaId: 'express', actualizada: 0 }] as unknown as SessionSummary[];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'fusionado')], ev, s)).sondear();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
  it('sin GitHub conectado de verdad no hace nada', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), { ...ctx(r, [pr(42, 'ref-212-barra', 'fusionado')], ev), connection: async () => ({ real: false }) }).sondear();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
});
