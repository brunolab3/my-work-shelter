import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// la carpeta de Claude Code de prueba, antes de cargar nada que la lea
const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'reubicada-')));
const antes = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = path.join(raiz, 'claude');
const { cwdBeforeRelocation, projectFolder } = await import('./repos.ts');
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
