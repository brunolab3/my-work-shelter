import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendToRoom, taskWorktree, forgetLimits, type CtxRooms } from './avisosSalas.ts';
import { infoRepo } from './repos.ts';

const SALAS = [
  { id: 'express', nombre: 'fever2', habitante: { id: 'remi', nombre: 'Remi' } },
  { id: 'partners', nombre: 'partners', habitante: { id: 'pilar', nombre: 'Pilar' } },
  { id: 'tareas', nombre: 'Logística', habitante: { id: 'ines', nombre: 'Inés' } },
  { id: 'vacia', nombre: 'vacía' },
];

// un contexto que apunta lo que se hace: avisos a conversaciones abiertas y conversaciones nuevas
function ctx(o: { abiertas?: Record<string, string>; worktrees?: Record<string, string>; falla?: string; reloj?: { t: number } } = {}) {
  const avisados: { sesionId: string; texto: string }[] = [], nuevas: { salaId: string; dwellerId: string; prompt: string; cwd?: string }[] = [], mensajero: string[][] = [], avisos: string[] = [];
  const c: CtxRooms = {
    salas: () => SALAS,
    sesionDeTarea: (salaId, clave) => o.abiertas?.[`${salaId}/${clave}`],
    worktreeDeTarea: (salaId, clave) => o.worktrees?.[`${salaId}/${clave}`],
    avisar: (sesionId, texto) => { avisados.push({ sesionId, texto }); return true; },
    empezar: async (salaId, dwellerId, prompt, cwd) => { if (o.falla) throw new Error(o.falla); nuevas.push({ salaId, dwellerId, prompt, cwd }); return 'nueva'; },
    mensajero: (desde, a) => mensajero.push([desde, ...a]),
    aviso: t => avisos.push(t),
    ahora: o.reloj && (() => o.reloj!.t),
  };
  return { c, avisados, nuevas, mensajero, avisos };
}

describe('mensajes entre salas', () => {
  beforeEach(() => forgetLimits());

  it('sin clave, una conversación nueva con el habitante en su copia principal, aunque tenga otra abierta', async () => {
    const x = ctx({ abiertas: { 'express/FIC-1': 'abierta' } });
    const r = await sendToRoom(x.c, 'tareas', { sala: 'fever2', mensaje: '  Investiga los saltos del bloqueo de LTD  ' });
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
    expect(x.avisos[0]).toContain('Logística → fever2: Investiga los saltos');
  });

  it('con clave, a la conversación abierta de esa tarea en la sala', async () => {
    const x = ctx({ abiertas: { 'partners/FIC-4375': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'partners', clave: 'fic-4375', mensaje: 'El endpoint cambia de nombre' });
    expect(r.ok).toBe(true);
    expect(x.nuevas).toEqual([]);
    expect(x.avisados).toHaveLength(1);
    expect(x.avisados[0].sesionId).toBe('ses-tarea');
    expect(x.avisados[0].texto).toContain('FIC-4375');
  });

  it('con clave y sin conversación abierta, una nueva en el worktree de la tarea; sin worktree, en la copia principal', async () => {
    const x = ctx({ worktrees: { 'partners/FIC-1': '/repos/partners/.claude/worktrees/FIC-1' } });
    await sendToRoom(x.c, 'express', { sala: 'partners', clave: 'FIC-1', mensaje: 'a' });
    await sendToRoom(x.c, 'express', { sala: 'partners', clave: 'FIC-2', mensaje: 'b' });
    expect(x.nuevas.map(n => n.cwd)).toEqual(['/repos/partners/.claude/worktrees/FIC-1', undefined]);
  });

  it('rechaza su propia sala, una que no existe (con la lista), una sin habitante y una clave que no lo es', async () => {
    const x = ctx();
    expect((await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'a' })).ok).toBe(false);
    const r = await sendToRoom(x.c, 'express', { sala: 'nada', mensaje: 'a' });
    expect(r.ok).toBe(false); expect(r.texto).toContain('partners (partners)');
    expect((await sendToRoom(x.c, 'express', { sala: 'vacia', mensaje: 'a' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'partners', clave: 'lo de ayer', mensaje: 'a' })).ok).toBe(false);
    expect(x.nuevas).toEqual([]);
  });

  it('como mucho 3 por minuto de una sala a otra; los que fallan no cuentan', async () => {
    const reloj = { t: 1_000_000 };
    const mal = ctx({ falla: 'Ya hay 4 sesiones vivas', reloj });
    const e = await sendToRoom(mal.c, 'express', { sala: 'partners', mensaje: 'x' });
    expect(e.ok).toBe(false); expect(e.texto).toContain('Ya hay 4 sesiones vivas');
    const x = ctx({ reloj });
    for (let i = 0; i < 3; i++) expect((await sendToRoom(x.c, 'express', { sala: 'partners', mensaje: 'x' })).ok).toBe(true);
    expect((await sendToRoom(x.c, 'express', { sala: 'partners', mensaje: 'x' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'tareas', mensaje: 'x' })).ok).toBe(true);   // otra sala, otra cuenta
    reloj.t += 61_000;
    expect((await sendToRoom(x.c, 'express', { sala: 'partners', mensaje: 'x' })).ok).toBe(true);
    expect(x.nuevas).toHaveLength(5);
  });

  it('encuentra el worktree de la tarea en los de un repo de verdad (por su rama), nunca la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'feature/FIC-9-principal'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    const wt = path.join(dir, '.claude', 'worktrees', 'otra-carpeta');
    g('worktree', 'add', '-b', 'feature/FIC-4375-tax-coverage', wt);
    const info = await infoRepo(dir);
    expect(taskWorktree(info.worktrees, 'fic-4375')).toBe(wt);
    expect(taskWorktree(info.worktrees, 'FIC-9')).toBeUndefined();
    expect(taskWorktree(info.worktrees, 'FIC-1')).toBeUndefined();
  }, 30_000);
});
