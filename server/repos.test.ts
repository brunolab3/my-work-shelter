import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// la carpeta de Claude Code de prueba, antes de cargar nada que la lea
const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'reubicada-')));
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
const { cwdBeforeRelocation, projectFolder, suggestions, visitedOfReflog } = await import('./repos.ts');
const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');

const ID = '0f8a2c1e-4b6d-4e2f-9a1b-3c5d7e9f1a2b';
const repo = path.join(root, 'repo'), wt = path.join(repo, '.claude', 'worktrees', 'tarea');
const msg = (cwd: string, n: number, type = n % 2 ? 'assistant' : 'user') => ({
  type, cwd, sessionId: ID, uuid: `u${n}`, parentUuid: n ? `u${n - 1}` : null, timestamp: new Date(Date.UTC(2026, 10, 12, 10, n)).toISOString(),
  message: type === 'user' ? { role: 'user', content: `pregunta ${n}` } : { role: 'assistant', content: [{ type: 'text', text: `respuesta ${n}` }] },
});
// como la deja Claude Code al cerrar fuera una conversación de un worktree que creó él: movida al proyecto del repo
// principal, con los metadatos (y la marca «relocated») al final
const relocated = (cwds: string[]) => [
  ...cwds.map((c, i) => msg(c, i)),
  { type: 'ai-title', aiTitle: 'Plan de la tarea', sessionId: ID },
  { type: 'worktree-state', worktreeSession: { originalCwd: repo, worktreePath: wt, worktreeName: 'tarea' }, sessionId: ID },
  { type: 'relocated', sessionId: ID, relocatedCwd: repo },
  { type: 'worktree-state', worktreeSession: null, sessionId: ID },
].map(l => JSON.stringify(l)).join('\n') + '\n';
const file = () => path.join(projectFolder(repo), ID + '.jsonl');
const write = (txt: string) => { mkdirSync(projectFolder(repo), { recursive: true }); writeFileSync(file(), txt); };

beforeAll(() => { mkdirSync(wt, { recursive: true }); });
afterAll(() => { if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before; rmSync(root, { recursive: true, force: true }); });

describe('conversación que Claude Code se llevó de su worktree al repo principal', () => {
  it('Claude Code la da por del repo principal, pero es del worktree donde se habló', async () => {
    write(relocated([wt, wt, wt, wt]));
    const s = (await listSessions({ dir: repo, includeProgrammatic: true })).find(x => x.sessionId === ID);
    expect(s?.cwd).toBe(repo);
    expect(cwdBeforeRelocation(file())).toBe(wt);
  });
  it('si después se siguió en el repo principal, es de allí', () => {
    write(relocated([wt, wt, repo, repo]));
    expect(cwdBeforeRelocation(file())).toBe(repo);
  });
  it('sin la marca, o con el worktree ya borrado, no cambia nada', () => {
    write([msg(wt, 0), msg(wt, 1)].map(l => JSON.stringify(l)).join('\n') + '\n');
    expect(cwdBeforeRelocation(file())).toBeUndefined();
    write(relocated([path.join(repo, '.claude', 'worktrees', 'borrado'), path.join(repo, '.claude', 'worktrees', 'borrado')]));
    expect(cwdBeforeRelocation(file())).toBeUndefined();
    expect(cwdBeforeRelocation(path.join(root, 'no-existe.jsonl'))).toBeUndefined();
  });
  it('encuentra el último mensaje aunque los metadatos del final ocupen más del primer trozo', () => {
    const filler = JSON.stringify({ type: 'tools-used', tools: ['x'.repeat(70 << 10)], sessionId: ID });
    write(relocated([wt, wt]).replace('{"type":"ai-title"', filler + '\n{"type":"ai-title"'));
    // la marca va detrás del relleno, en la cola: el último mensaje queda más atrás de los primeros 64 KB
    expect(cwdBeforeRelocation(file())).toBe(wt);
  });
});

describe('Main Gate suggestions', () => {
  // ~/Fever: a repo, a plain folder, and the group `dice` (no git) with two repos, a project and a stray folder
  const fever = path.join(root, 'Fever'), dir = (...p: string[]) => path.join(fever, ...p);
  const create = (p: string, git = false, mtime = 0) => { mkdirSync(p, { recursive: true }); if (git) mkdirSync(path.join(p, '.git')); if (mtime) utimesSync(p, mtime, mtime); };
  beforeAll(() => {
    create(dir('dice', 'bowie'), true, 5_000); create(dir('dice', 'crm'), true, 1_000); create(dir('dice', 'docs'));
    create(dir('dice', 'tool')); writeFileSync(dir('dice', 'tool', 'package.json'), '{}'); utimesSync(dir('dice', 'tool'), 2_000, 2_000);
    create(dir('notas', 'sub'), false); create(dir('notas', 'sub', 'inner'), true);
    utimesSync(dir('dice'), 3_000, 3_000); utimesSync(dir('notas'), 500, 500);
    create(dir('api'), true); create(dir('api', 'packages', 'x'), true); utimesSync(dir('api'), 4_000, 4_000);
  });
  it("lists a group's repos and projects one level deep, most recent first, with the group still admittable", () => {
    const s = suggestions(fever, []);
    expect(s.map(x => (x.group ? x.group + '/' : '') + x.name)).toEqual(['dice/bowie', 'api', 'dice', 'dice/tool', 'dice/crm', 'notas']);
    expect(s.find(x => x.name === 'bowie')).toMatchObject({ path: dir('dice', 'bowie'), isGit: true, group: 'dice' });
    expect(s.find(x => x.name === 'dice')?.group).toBeUndefined();
  });
  it('leaves out the folders that already have a room, but still opens a taken group', () => {
    const s = suggestions(fever, [dir('dice'), dir('dice', 'crm')]);
    expect(s.map(x => (x.group ? x.group + '/' : '') + x.name)).toEqual(['dice/bowie', 'api', 'dice/tool', 'notas']);
  });
});

describe('branches a worktree had (HEAD reflog)', () => {
  it('each branch checked out, from or to, with the last time it was there', () => {
    const out = [
      'HEAD@{300}\tcheckout: moving from feature/B2BI-16924-3b to feature/B2BI-16867-6a',
      'HEAD@{250}\tcommit: B2BI-16924 - Warn when an explicit pack sells after its first day',
      'HEAD@{200}\tcheckout: moving from feature/B2BI-16867-6b to feature/B2BI-16924-3b',
      'HEAD@{100}\tcheckout: moving from worktree-x to feature/B2BI-16867-6b',
    ].join('\n');
    expect(visitedOfReflog(out)).toEqual({ 'feature/B2BI-16924-3b': 300, 'feature/B2BI-16867-6a': 300, 'feature/B2BI-16867-6b': 200, 'worktree-x': 100 });
    expect(visitedOfReflog('')).toEqual({});
  });
});
