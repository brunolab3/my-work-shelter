import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendToRoom, taskWorktree, forgetLimits, type CtxRooms } from './avisosSalas.ts';
import { infoRepo, worktreeList } from './repos.ts';

const SALAS = [
  { id: 'express', nombre: 'app-web', habitante: { id: 'remi', nombre: 'Remi' } },
  { id: 'pagos', nombre: 'pagos', habitante: { id: 'pilar', nombre: 'Pilar' } },
  { id: 'tareas', nombre: 'Logística', habitante: { id: 'ines', nombre: 'Inés' } },
  { id: 'vacia', nombre: 'vacía' },
];

// un contexto que apunta lo que se hace: avisos a conversaciones abiertas y conversaciones nuevas
function ctx(o: { abiertas?: Record<string, string>; worktrees?: Record<string, string>; falla?: string; reloj?: { t: number }; sinGit?: boolean; worktreeDeTarea?: CtxRooms['worktreeDeTarea'] } = {}) {
  const avisados: { sesionId: string; texto: string }[] = [], nuevas: { salaId: string; dwellerId: string; prompt: string; cwd?: string; worktree?: string }[] = [], mensajero: string[][] = [], avisos: string[] = [];
  const c: CtxRooms = {
    salas: () => SALAS,
    sesionDeTarea: (salaId, clave) => o.abiertas?.[`${salaId}/${clave}`],
    worktreeDeTarea: o.worktreeDeTarea ?? (async (salaId, clave) => o.worktrees?.[`${salaId}/${clave}`]),
    avisar: (sesionId, texto) => { avisados.push({ sesionId, texto }); return true; },
    empezar: async (salaId, dwellerId, prompt, donde) => { if (o.falla) throw new Error(o.falla); nuevas.push({ salaId, dwellerId, prompt, cwd: donde?.cwd, worktree: donde?.worktree }); return { id: 'nueva', enWorktree: !!(donde?.cwd || (donde?.worktree && !o.sinGit)) }; },
    mensajero: (desde, a) => mensajero.push([desde, ...a]),
    aviso: t => avisos.push(t),
    ahora: o.reloj && (() => o.reloj!.t),
  };
  return { c, avisados, nuevas, mensajero, avisos };
}

describe('mensajes entre salas', () => {
  beforeEach(() => forgetLimits());

  it('sin clave, una conversación nueva con el habitante en su copia principal, aunque tenga otra abierta', async () => {
    const x = ctx({ abiertas: { 'express/ABC-1': 'abierta' } });
    const r = await sendToRoom(x.c, 'tareas', { sala: 'app-web', mensaje: '  Investiga los saltos del bloqueo de LTD  ' });
    expect(r.ok).toBe(true);
    expect(x.avisados).toEqual([]);
    expect(x.nuevas).toHaveLength(1);
    expect(x.nuevas[0]).toMatchObject({ salaId: 'express', dwellerId: 'remi', cwd: undefined });
    // de quién viene, el mensaje y cómo contestar
    expect(x.nuevas[0].prompt).toContain('Logística');
    expect(x.nuevas[0].prompt).toContain('Inés');
    expect(x.nuevas[0].prompt).toContain('\nInvestiga los saltos del bloqueo de LTD\n');
    expect(x.nuevas[0].prompt).toContain('tareas');
    expect(x.mensajero).toEqual([['tareas', 'express']]);
    expect(x.avisos[0]).toContain('Logística → app-web: Investiga los saltos');
  });

  it('con clave, a la conversación abierta de esa tarea en la sala', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-4375': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'abc-4375', mensaje: 'El endpoint cambia de nombre' });
    expect(r.ok).toBe(true);
    expect(x.nuevas).toEqual([]);
    expect(x.avisados).toHaveLength(1);
    expect(x.avisados[0].sesionId).toBe('ses-tarea');
    expect(x.avisados[0].texto).toContain('ABC-4375');
  });

  it('con clave y sin conversación abierta, una nueva en el worktree de la tarea; sin worktree, en uno nuevo con la clave', async () => {
    const x = ctx({ worktrees: { 'pagos/ABC-1': '/repos/pagos/.claude/worktrees/ABC-1' } });
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-1', mensaje: 'a' });
    const r = await sendToRoom(x.c, 'tareas', { sala: 'pagos', clave: 'ABC-321', mensaje: 'ABC-321 — Weekend bundle: open a PR\nmore' });
    expect(x.nuevas[0]).toMatchObject({ cwd: '/repos/pagos/.claude/worktrees/ABC-1', worktree: undefined });
    expect(x.nuevas[1].cwd).toBeUndefined();
    // la clave una sola vez y el asunto: así taskWorktree lo encuentra para los siguientes mensajes de la tarea
    expect(x.nuevas[1].worktree).toMatch(/^shelter-abc-321-weekend-bundle-open[a-z0-9-]*-[0-9a-z]{4}$/);
    expect(taskWorktree([{ ruta: '/repos/pagos/.claude/worktrees/' + x.nuevas[1].worktree, principal: false } as any], 'ABC-321')).toBeDefined();
    expect(r.texto).toContain('worktree nuevo');
  });

  it('con clave en una sala cuya carpeta no es un repo git: a su copia principal, y la respuesta lo dice', async () => {
    const x = ctx({ sinGit: true });
    const r = await sendToRoom(x.c, 'express', { sala: 'tareas', clave: 'WS-1', mensaje: 'Revisa el CI' });
    expect(r.ok).toBe(true);
    expect(x.nuevas[0].worktree).toMatch(/^shelter-ws-1-/);
    expect(r.texto).toContain('no es un repo git');
    expect(r.texto).not.toContain('worktree nuevo');
  });

  it('sin clave, nunca un worktree', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'tareas', { sala: 'pagos', mensaje: 'Revisa el plan' });
    expect(x.nuevas[0]).toMatchObject({ cwd: undefined, worktree: undefined });
  });

  it('dentro de la misma sala: con clave, al holograma de la tarea; sin robot mensajero, pero con aviso', async () => {
    const x = ctx({ worktrees: { 'express/ABC-9': '/repos/app-web/.claude/worktrees/abc-9' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'Añade los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.nuevas).toEqual([expect.objectContaining({ salaId: 'express', dwellerId: 'remi', cwd: '/repos/app-web/.claude/worktrees/abc-9' })]);
    expect(x.mensajero).toEqual([]);
    expect(x.avisos[0]).toContain('app-web → app-web: Añade los avisos de CI');
    // sin clave, otra conversación en la copia principal de la sala
    const y = ctx();
    expect((await sendToRoom(y.c, 'express', { sala: 'express', mensaje: 'Revisa el README' }, 'ses-supervisor')).ok).toBe(true);
    expect(y.nuevas[0]).toMatchObject({ salaId: 'express', cwd: undefined, worktree: undefined });
  });

  it('nunca a la propia conversación: la que envía ya es la de esa tarea', async () => {
    const x = ctx({ abiertas: { 'express/ABC-9': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'a' }, 'ses-tarea');
    expect(r.ok).toBe(false); expect(r.texto).toContain('ABC-9');
    expect(x.avisados).toEqual([]);
    // otra conversación de la misma sala sí se la pasa a la de la tarea
    expect((await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'a' }, 'ses-supervisor')).ok).toBe(true);
    expect(x.avisados[0].sesionId).toBe('ses-tarea');
  });

  it('with a descriptive slug key: kept as written, a new worktree named after it alone, found again by exact key', async () => {
    const x = ctx({ abiertas: { 'pagos/preflight-popover': 'ses-slug' } });
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'preflight-popover', mensaje: 'a' });
    expect(x.avisados[0].sesionId).toBe('ses-slug');
    expect(x.avisados[0].texto).toContain('preflight-popover');
    const r = await sendToRoom(x.c, 'tareas', { sala: 'pagos', clave: 'Holo-Front-Edge', mensaje: 'Fix the hologram front edge' });
    expect(r.ok).toBe(true);
    expect(x.nuevas[0].worktree).toMatch(/^shelter-holo-front-edge--[0-9a-z]{4}$/);
    const wts = [{ ruta: '/repos/pagos/.claude/worktrees/' + x.nuevas[0].worktree, rama: 'worktree-' + x.nuevas[0].worktree, principal: false } as any];
    expect(taskWorktree(wts, 'holo-front-edge')).toBeDefined();
    expect(taskWorktree(wts, 'front-edge')).toBeUndefined();
    expect(taskWorktree(wts, 'holo')).toBeUndefined();
  });

  it('rechaza una sala que no existe (con la lista), una sin habitante y una clave que no lo es', async () => {
    const x = ctx();
    const r = await sendToRoom(x.c, 'express', { sala: 'nada', mensaje: 'a' });
    expect(r.ok).toBe(false); expect(r.texto).toContain('pagos (pagos)');
    expect((await sendToRoom(x.c, 'express', { sala: 'vacia', mensaje: 'a' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'lo de ayer', mensaje: 'a' })).ok).toBe(false);
    expect(x.nuevas).toEqual([]);
  });

  it('como mucho 3 por minuto de una sala a otra; los que fallan no cuentan', async () => {
    const reloj = { t: 1_000_000 };
    const mal = ctx({ falla: 'Ya hay 4 sesiones vivas', reloj });
    const e = await sendToRoom(mal.c, 'express', { sala: 'pagos', mensaje: 'x' });
    expect(e.ok).toBe(false); expect(e.texto).toContain('Ya hay 4 sesiones vivas');
    const x = ctx({ reloj });
    for (let i = 0; i < 3; i++) expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(true);
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'tareas', mensaje: 'x' })).ok).toBe(true);   // otra sala, otra cuenta
    reloj.t += 61_000;
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(true);
    expect(x.nuevas).toHaveLength(5);
  });

  it('con clave, al worktree que otra conversación acaba de crear (leído de git al momento), no a la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'main'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    // como main.ts: la lista de worktrees de la carpeta de la sala en cada mensaje
    const x = ctx({ worktreeDeTarea: async (_sala, clave) => taskWorktree(await worktreeList(dir), clave) });
    const wt = path.join(path.dirname(dir), path.basename(dir) + '-ws-ci-idioma');
    g('worktree', 'add', '-b', 'ws-1-ci-idioma', wt);
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'WS-1', mensaje: 'Traduce los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.nuevas[0]).toMatchObject({ cwd: wt, worktree: undefined });
    expect(r.texto).toContain('worktree de WS-1');
  }, 30_000);

  it('encuentra el worktree de la tarea en los de un repo de verdad (por su rama), nunca la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'feature/ABC-9-principal'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    const wt = path.join(dir, '.claude', 'worktrees', 'otra-carpeta');
    g('worktree', 'add', '-b', 'feature/ABC-4375-tax-coverage', wt);
    const info = await infoRepo(dir);
    expect(taskWorktree(info.worktrees, 'abc-4375')).toBe(wt);
    expect(taskWorktree(info.worktrees, 'ABC-9')).toBeUndefined();
    expect(taskWorktree(info.worktrees, 'ABC-1')).toBeUndefined();
  }, 30_000);
});
