import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// la carpeta de Claude Code de prueba, antes de cargar nada que la lea
const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'reubicada-')));
const antes = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = path.join(raiz, 'claude');
const { cwdBeforeRelocation, projectFolder, sugerencias } = await import('./repos.ts');
const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');

const ID = '0f8a2c1e-4b6d-4e2f-9a1b-3c5d7e9f1a2b';
const repo = path.join(raiz, 'repo'), wt = path.join(repo, '.claude', 'worktrees', 'tarea');
const msg = (cwd: string, n: number, type = n % 2 ? 'assistant' : 'user') => ({
  type, cwd, sessionId: ID, uuid: `u${n}`, parentUuid: n ? `u${n - 1}` : null, timestamp: new Date(Date.UTC(2026, 10, 12, 10, n)).toISOString(),
  message: type === 'user' ? { role: 'user', content: `pregunta ${n}` } : { role: 'assistant', content: [{ type: 'text', text: `respuesta ${n}` }] },
});
// como la deja Claude Code al cerrar fuera una conversación de un worktree que creó él: movida al proyecto del repo
// principal, con los metadatos (y la marca «relocated») al final
const reubicada = (cwds: string[]) => [
  ...cwds.map((c, i) => msg(c, i)),
  { type: 'ai-title', aiTitle: 'Plan de la tarea', sessionId: ID },
  { type: 'worktree-state', worktreeSession: { originalCwd: repo, worktreePath: wt, worktreeName: 'tarea' }, sessionId: ID },
  { type: 'relocated', sessionId: ID, relocatedCwd: repo },
  { type: 'worktree-state', worktreeSession: null, sessionId: ID },
].map(l => JSON.stringify(l)).join('\n') + '\n';
const archivo = () => path.join(projectFolder(repo), ID + '.jsonl');
const escribir = (txt: string) => { mkdirSync(projectFolder(repo), { recursive: true }); writeFileSync(archivo(), txt); };

beforeAll(() => { mkdirSync(wt, { recursive: true }); });
afterAll(() => { if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = antes; rmSync(raiz, { recursive: true, force: true }); });

describe('conversación que Claude Code se llevó de su worktree al repo principal', () => {
  it('Claude Code la da por del repo principal, pero es del worktree donde se habló', async () => {
    escribir(reubicada([wt, wt, wt, wt]));
    const s = (await listSessions({ dir: repo, includeProgrammatic: true })).find(x => x.sessionId === ID);
    expect(s?.cwd).toBe(repo);
    expect(cwdBeforeRelocation(archivo())).toBe(wt);
  });
  it('si después se siguió en el repo principal, es de allí', () => {
    escribir(reubicada([wt, wt, repo, repo]));
    expect(cwdBeforeRelocation(archivo())).toBe(repo);
  });
  it('sin la marca, o con el worktree ya borrado, no cambia nada', () => {
    escribir([msg(wt, 0), msg(wt, 1)].map(l => JSON.stringify(l)).join('\n') + '\n');
    expect(cwdBeforeRelocation(archivo())).toBeUndefined();
    escribir(reubicada([path.join(repo, '.claude', 'worktrees', 'borrado'), path.join(repo, '.claude', 'worktrees', 'borrado')]));
    expect(cwdBeforeRelocation(archivo())).toBeUndefined();
    expect(cwdBeforeRelocation(path.join(raiz, 'no-existe.jsonl'))).toBeUndefined();
  });
  it('encuentra el último mensaje aunque los metadatos del final ocupen más del primer trozo', () => {
    const relleno = JSON.stringify({ type: 'tools-used', tools: ['x'.repeat(70 << 10)], sessionId: ID });
    escribir(reubicada([wt, wt]).replace('{"type":"ai-title"', relleno + '\n{"type":"ai-title"'));
    // la marca va detrás del relleno, en la cola: el último mensaje queda más atrás de los primeros 64 KB
    expect(cwdBeforeRelocation(archivo())).toBe(wt);
  });
});

describe('Main Gate suggestions', () => {
  // ~/Fever: a repo, a plain folder, and the group `dice` (no git) with two repos, a project and a stray folder
  const fever = path.join(raiz, 'Fever'), dir = (...p: string[]) => path.join(fever, ...p);
  const crear = (p: string, git = false, mtime = 0) => { mkdirSync(p, { recursive: true }); if (git) mkdirSync(path.join(p, '.git')); if (mtime) utimesSync(p, mtime, mtime); };
  beforeAll(() => {
    crear(dir('dice', 'bowie'), true, 5_000); crear(dir('dice', 'crm'), true, 1_000); crear(dir('dice', 'docs'));
    crear(dir('dice', 'tool')); writeFileSync(dir('dice', 'tool', 'package.json'), '{}'); utimesSync(dir('dice', 'tool'), 2_000, 2_000);
    crear(dir('notas', 'sub'), false); crear(dir('notas', 'sub', 'inner'), true);
    utimesSync(dir('dice'), 3_000, 3_000); utimesSync(dir('notas'), 500, 500);
    crear(dir('api'), true); crear(dir('api', 'packages', 'x'), true); utimesSync(dir('api'), 4_000, 4_000);
  });
  it("lists a group's repos and projects one level deep, most recent first, with the group still admittable", () => {
    const s = sugerencias(fever, []);
    expect(s.map(x => (x.grupo ? x.grupo + '/' : '') + x.nombre)).toEqual(['dice/bowie', 'api', 'dice', 'dice/tool', 'dice/crm', 'notas']);
    expect(s.find(x => x.nombre === 'bowie')).toMatchObject({ ruta: dir('dice', 'bowie'), isGit: true, grupo: 'dice' });
    expect(s.find(x => x.nombre === 'dice')?.grupo).toBeUndefined();
  });
  it('leaves out the folders that already have a room, but still opens a taken group', () => {
    const s = sugerencias(fever, [dir('dice'), dir('dice', 'crm')]);
    expect(s.map(x => (x.grupo ? x.grupo + '/' : '') + x.nombre)).toEqual(['dice/bowie', 'api', 'dice/tool', 'notas']);
  });
});
