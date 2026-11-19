// Dig a room from GitHub (githubClone.ts): the repo typed or pasted, the list (the network mocked), what's already
// cloned, the clone's folder and the clone itself (from a local repo, no network)
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Clones, cloneDestination, cloneUrl, clonedRepos, explainClone, listRepos, originOf, progressOf, repoInfo, repoRef, type StateClone } from './githubClone.ts';

const base = mkdtempSync(path.join(os.tmpdir(), 'github-clone-'));
const repoWithOrigin = (dir: string, url: string) => { mkdirSync(path.join(dir, '.git'), { recursive: true }); writeFileSync(path.join(dir, '.git', 'config'), `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/other/fork.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`); return dir; };

describe('repoRef', () => {
  it('owner/name, https and ssh URLs, with or without .git or a path after it', () => {
    expect(repoRef('acme/web-app')).toBe('acme/web-app');
    expect(repoRef('  https://github.com/acme/web-app.git ')).toBe('acme/web-app');
    expect(repoRef('github.com/acme/web-app/pull/12')).toBe('acme/web-app');
    expect(repoRef('git@github.com:acme/web.app.git')).toBe('acme/web.app');
    expect(repoRef('ssh://git@github.com/acme/x')).toBe('acme/x');
  });
  it('nothing else: other hosts, paths, flags', () => {
    for (const x of ['acme', 'https://gitlab.com/acme/x', 'acme/x/y', '../x', 'acme/..', '-x/y', 'a b/c', '']) expect(repoRef(x), x).toBeUndefined();
  });
});

describe('listRepos and repoInfo (gh mocked)', () => {
  const api = (x: object) => ({ full_name: 'acme/a', private: false, archived: false, description: null, pushed_at: '2026-01-01T00:00:00Z', ...x });
  it('pages until a short one, without repeats, most recently pushed first', async () => {
    const pedidas: string[] = [];
    const page1 = Array.from({ length: 100 }, (_, i) => api({ full_name: `acme/r${i}`, pushed_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z` }));
    const gh = async (args: string[]) => { pedidas.push(args[1]); return JSON.stringify(args[1].endsWith('page=1') ? page1 : args[1].endsWith('page=2') ? [api({ full_name: 'me/new', private: true, pushed_at: '2026-11-01T00:00:00Z' }), api({ full_name: 'acme/r0' })] : []); };
    const r = await listRepos(gh, 3);
    expect(pedidas).toHaveLength(3);
    expect(await listRepos(async () => JSON.stringify([api({})]))).toHaveLength(1);
    expect(pedidas[0]).toContain('affiliation=owner,collaborator,organization_member');
    expect(r).toHaveLength(101);
    expect(r[0]).toMatchObject({ repo: 'me/new', nombre: 'new', privado: true });
  });
  it('a pasted repo that GitHub doesn\'t know (or you can\'t read) says so', async () => {
    await expect(repoInfo(async () => { throw new Error('gh: Not Found (HTTP 404)'); }, 'acme/nope')).rejects.toThrow(/acme\/nope/);
    expect(await repoInfo(async () => JSON.stringify(api({ full_name: 'Acme/Web' })), 'acme/web')).toMatchObject({ repo: 'Acme/Web' });
  });
});

describe('already cloned', () => {
  it('reads origin from .git/config, not another remote', () => {
    expect(originOf(repoWithOrigin(path.join(base, 'o1'), 'git@github.com:Acme/Web.git'))).toBe('acme/web');
    expect(originOf(path.join(base, 'nada'))).toBeUndefined();
  });
  it('the rooms, the root\'s repos and those in its group subfolders', () => {
    const raiz = path.join(base, 'raiz');
    repoWithOrigin(path.join(raiz, 'web'), 'https://github.com/acme/web.git');
    repoWithOrigin(path.join(raiz, 'grupo', 'api'), 'https://github.com/acme/api');
    repoWithOrigin(path.join(raiz, 'grupo', 'api', 'deep', 'x'), 'https://github.com/acme/deep');
    const sala = repoWithOrigin(path.join(base, 'fuera', 'tools'), 'https://github.com/acme/tools.git');
    const m = clonedRepos(raiz, [{ ruta: sala, nombre: 'Tools' }, { nombre: 'Vault' }]);
    expect(m.get('acme/web')).toMatchObject({ ruta: path.join(raiz, 'web') });
    expect(m.get('acme/api')).toMatchObject({ ruta: path.join(raiz, 'grupo', 'api') });
    expect(m.get('acme/tools')).toMatchObject({ ruta: sala, sala: 'Tools' });
    expect(m.has('acme/deep')).toBe(false);
  });
});

describe('the clone\'s folder', () => {
  const raiz = path.join(base, 'destinos');
  mkdirSync(path.join(raiz, 'existe'), { recursive: true });
  repoWithOrigin(path.join(raiz, 'unrepo'), 'https://github.com/acme/unrepo');
  it('inside the root, directly or in a group subfolder (even when the root or the group is a room\'s folder)', () => {
    expect(cloneDestination(path.join(raiz, 'web'), raiz, [raiz])).toBe(path.join(raiz, 'web'));
    expect(cloneDestination(path.join(raiz, 'dice', 'web'), raiz, [])).toBe(path.join(raiz, 'dice', 'web'));
  });
  it('not outside it, not existing, not taken, not inside another repo, no hidden or odd names', () => {
    expect(() => cloneDestination(path.join(base, 'otro', 'web'), raiz, [])).toThrow();
    expect(() => cloneDestination(path.join(raiz, '..', 'web'), raiz, [])).toThrow();
    expect(() => cloneDestination(raiz, raiz, [])).toThrow();
    expect(() => cloneDestination(path.join(raiz, 'existe'), raiz, [])).toThrow();
    expect(() => cloneDestination(path.join(raiz, 'sala'), raiz, [path.join(raiz, 'sala')])).toThrow();
    expect(() => cloneDestination(path.join(raiz, 'unrepo', 'web'), raiz, [])).toThrow();
    expect(() => cloneDestination(path.join(raiz, '.oculta'), raiz, [])).toThrow();
    expect(() => cloneDestination(path.join(raiz, 'a;b'), raiz, [])).toThrow();
    expect(() => cloneDestination('/web', '/', [])).toThrow();
  });
});

describe('the clone', () => {
  it('the URL follows gh\'s git_protocol', () => {
    expect(cloneUrl('acme/web', 'ssh\n')).toBe('git@github.com:acme/web.git');
    expect(cloneUrl('acme/web', '')).toBe('https://github.com/acme/web.git');
  });
  it('git\'s progress, the last line rewritten with \\r', () => {
    expect(progressOf('Cloning into \'web\'...\nremote: Counting objects: 100% (5/5)\rReceiving objects:  12% (1/8)\rReceiving objects:  45% (4/8)\r')).toEqual({ linea: 'Receiving objects:  45% (4/8)', pct: 45 });
  });
  it('a failure without credentials says how to set them up', () => {
    expect(explainClone("Cloning into 'x'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n")).toMatch(/gh auth login/);
    expect(explainClone("Cloning into 'x'...\nfatal: repository 'https://github.com/a/b.git/' not found\n")).toMatch(/^fatal: repository/);
  });
  it('clones (a local repo here) into the new folder, creating the group subfolder, and reports it', async () => {
    const origen = path.join(base, 'origen');
    mkdirSync(origen); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: origen }); writeFileSync(path.join(origen, 'README.md'), 'hola');
    execFileSync('git', ['add', '.'], { cwd: origen }); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x'], { cwd: origen });
    const fin: StateClone[] = [];
    const clones = new Clones(undefined, c => fin.push(c));
    const destino = path.join(base, 'clones', 'grupo', 'web');
    const c = clones.empezar('acme/web', destino, origen);
    expect(c.estado).toBe('clonando');
    await new Promise<void>(ok => { const h = setInterval(() => { if (fin.length) { clearInterval(h); ok(); } }, 20); });
    expect(clones.ver(c.id)).toMatchObject({ estado: 'hecho', ruta: destino, pct: 100 });
    expect(existsSync(path.join(destino, 'README.md'))).toBe(true);
    expect(fin[0].estado).toBe('hecho');
  });
  it('a failed clone carries git\'s error', async () => {
    const fin: StateClone[] = [];
    const clones = new Clones(undefined, c => fin.push(c));
    const c = clones.empezar('acme/nope', path.join(base, 'clones', 'nope'), path.join(base, 'no-existe'));
    await new Promise<void>(ok => { const h = setInterval(() => { if (fin.length) { clearInterval(h); ok(); } }, 20); });
    expect(clones.ver(c.id)).toMatchObject({ estado: 'error' });
    expect(clones.ver(c.id)!.error).toMatch(/fatal|does not exist|not/i);
    expect(existsSync(path.join(base, 'clones', 'nope'))).toBe(false);
  });
});
