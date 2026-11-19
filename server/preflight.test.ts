import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cachedPRs, cachedTaskPRs, localBranches, preflightOf, PageReviews, gatePush, preflightTools, repoChecks, type CtxPreflight } from './preflight.ts';
import { mkdirSync } from 'node:fs';
import { buildCompare } from './compare.ts';
import type { RoomPR } from './prReviews.ts';
import type { PRBoard } from '../shared/board.ts';

// con git de verdad: dos repos (api y web) con un remoto cada uno, su clon (la copia principal de la sala) y el worktree
// de la tarea; sin la configuración global del Supervisor
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();
const git = (cwd: string, args: string[]) => new Promise<string>((ok, fail) => execFile('git', ['-C', cwd, ...args], { env: ENV }, (err, o, e) => err ? fail(new Error(String(e || err.message))) : ok(String(o))));
const commit = (cwd: string, file: string, text: string) => { writeFileSync(path.join(cwd, file), text); sh(cwd, 'add', '.'); sh(cwd, 'commit', '-q', '-m', text); return sh(cwd, 'rev-parse', 'HEAD'); };

function repo(base: string, name: string) {
  const remote = path.join(base, name + '.git'), filePath = path.join(base, name);
  sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
  sh(base, 'clone', '-q', remote, filePath);
  commit(filePath, 'README', 'inicio');
  sh(filePath, 'push', '-q', 'origin', 'main');
  return { remote, path: filePath };
}
const pr = (repo: string, number: number, branch: string, head: string, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title: 'PR ' + number, url: `https://github.com/${repo}/pull/${number}`, repo, branch, state: 'abierto', updated: 0, base: 'main', checks: 'SUCCESS', review: 'REVIEW_REQUIRED', head, ...extra });

describe('pre-flight con git de verdad', () => {
  it('una tarea en dos repos: sincronía local frente a la cabeza del PR (un bot empujó, cambios sin commitear) y el bloqueo entre ellos', async () => {
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'preflight-')));
    const api = repo(base, 'api'), web = repo(base, 'web');
    // api: el worktree de la tarea, empujado; luego un bot empuja un arreglo desde otro clon
    const wtApi = path.join(base, 'wt', 'api-abc-7');
    sh(api.path, 'worktree', 'add', '-q', '-b', 'feature/ABC-7-contrato', wtApi);
    commit(wtApi, 'contrato.txt', 'contrato');
    sh(wtApi, 'push', '-q', 'origin', 'feature/ABC-7-contrato');
    const bot = path.join(base, 'bot');
    sh(base, 'clone', '-q', '-b', 'feature/ABC-7-contrato', api.remote, bot);
    const apiHead = commit(bot, 'contrato.txt', 'arreglo del bot');
    sh(bot, 'push', '-q', 'origin', 'feature/ABC-7-contrato');
    // web: el worktree de la tarea al día con su PR, pero con un archivo sin commitear
    const wtWeb = path.join(base, 'wt', 'web-abc-7');
    sh(web.path, 'worktree', 'add', '-q', '-b', 'ABC-7-pantalla', wtWeb);
    const webHead = commit(wtWeb, 'pantalla.txt', 'pantalla');
    writeFileSync(path.join(wtWeb, 'pantalla.txt'), 'a medias');
    // otra tarea en web: no sale
    sh(web.path, 'branch', 'ABC-8-otra');

    const prs = [
      pr('acme/api', 1, 'feature/ABC-7-contrato', apiHead, { checks: 'FAILURE' }),
      pr('acme/web', 2, 'ABC-7-pantalla', webHead, { dependencies: ['acme/api#1'] }),
      pr('acme/web', 3, 'ABC-8-otra', 'zzz'),
    ];
    const rooms: RoomPR[] = [
      { id: 'api', name: 'API', path: api.path, branch: 'main', repo: 'acme/api', worktrees: [{ path: api.path, branch: 'main' }, { path: wtApi, branch: 'feature/ABC-7-contrato' }] },
      { id: 'web', name: 'Web', path: web.path, branch: 'main', repo: 'acme/web', worktrees: [{ path: web.path, branch: 'main' }, { path: wtWeb, branch: 'ABC-7-pantalla' }] },
    ];
    const local = await localBranches('ABC-7', prs, rooms, git);
    expect(local.map(l => [l.roomId, l.branch, l.worktree, l.changes, l.headless ?? false])).toEqual([
      ['api', 'feature/ABC-7-contrato', wtApi, 0, true],     // la cabeza del bot no está en local (sin fetch)
      ['web', 'ABC-7-pantalla', wtWeb, 1, false],
    ]);
    // tras un fetch, la cabeza está: un commit detrás, ninguno sin empujar
    sh(api.path, 'fetch', '-q', 'origin');
    const api2 = (await localBranches('ABC-7', prs, rooms, git)).find(l => l.roomId === 'api')!;
    expect([api2.headless ?? false, api2.behind, api2.ahead]).toEqual([false, 1, 0]);

    const ctx: CtxPreflight = {
      prs: async () => ({ prs }), rooms: async () => rooms, manual: () => [], orden: async () => [],
      plan: () => [{ roomId: 'api', room: 'API', title: 'El contrato' }, { roomId: 'web', room: 'Web', title: 'La pantalla', waitA: ['api'] }],
      color: () => '#4dabff', git, compares: () => reviewed.compares(),
      ciChecks: url => url.endsWith('/1') ? [{ name: 'build', state: 'mal' as const }, { name: 'lint', state: 'ok' as const }] : undefined,
      checklist: () => ({ items: ['Compare revisado', 'Pruebas con datos reales'], answers: k => reviewed.checklistOf(k) }),
      reviews: url => url.endsWith('/2') ? { ledger: { unresolved: 1, outdated: 0, unansweredSummaries: 0 }, threads: [{ file: 'pantalla.txt', line: 1, author: 'revisora', text: '¿Seguro?', url: url + '#discussion_r1', outdated: false }] } : {},
    };
    // la comparación de web (en una carpeta de pruebas), validada en su commit
    const folder = mkdtempSync(path.join(base, 'comparaciones-')), data = mkdtempSync(path.join(base, 'datos-'));
    const reviewed = new PageReviews(data, folder);
    const cmp = await buildCompare(wtWeb, { base: 'main' }, folder);
    expect(JSON.parse(readFileSync(cmp.file.replace(/\.html$/, '.json'), 'utf8')).parts).toEqual([{ worktree: wtWeb, branch: 'ABC-7-pantalla', head: webHead, base: 'main' }]);
    expect(reviewed.respond(cmp.file, 'validada')).toBe(true);
    expect(reviewed.respond(path.join(base, 'otra.html'), 'validada')).toBe(false);   // fuera de la carpeta, no cuenta
    const r = await preflightOf('abc-7', ctx);
    expect(r.key).toBe('ABC-7');
    expect(r.color).toBe('#4dabff');
    const pApi = r.parts.find(p => p.roomId === 'api')!, pWeb = r.parts.find(p => p.roomId === 'web')!;
    expect([pApi.sync.mark, pApi.ci.mark, pApi.plan]).toEqual(['aviso', 'mal', 'El contrato']);
    expect([pWeb.sync.mark, pWeb.ci.mark, pWeb.blockers.mark]).toEqual(['aviso', 'ok', 'aviso']);   // la CI roja es de api
    expect(pWeb.waitsOn.map(l => l.ref)).toEqual(['acme/api#1']);
    expect(r.waves).toEqual([['acme/api#1'], ['acme/web#2']]);
    expect(r.parts.some(p => p.pr?.number === 3)).toBe(false);
    expect(pApi.ciChecks.map(c => `${c.name}:${c.state}`)).toEqual(['build:mal', 'lint:ok']);   // cada check de su PR
    expect([pWeb.compare.mark, pApi.compare.mark]).toEqual(['ok', 'mal']);
    expect(pWeb.review.text).toMatch(/1/);                // el hilo sin resolver, en la revisión
    expect(pWeb.threads.map(h => `${h.file}:${h.line} ${h.author}`)).toEqual(['pantalla.txt:1 revisora']);
    // un commit nuevo deja vieja la validación
    sh(wtWeb, 'commit', '-qam', 'otro paso');
    expect((await preflightOf('ABC-7', ctx)).parts.find(p => p.roomId === 'web')!.compare.mark).toBe('aviso');
    // a new compare at the new commit, validated, counts again
    const cmp2 = await buildCompare(wtWeb, { base: 'main' }, folder);
    expect(reviewed.respond(cmp2.file, 'validada')).toBe(true);
    expect((await preflightOf('ABC-7', ctx)).parts.find(p => p.roomId === 'web')!.compare.mark).toBe('ok');

    // fase 3: la lista «antes de subir» y la puerta de git push, desde la carpeta del worktree
    const tools = preflightTools(ctx, (k, w, h, item, a) => reviewed.answer(k, w, h, item, a));
    let g = await gatePush(path.join(wtWeb), ctx);
    expect(g?.key).toBe('ABC-7');
    expect(g?.missing.join(' ')).toMatch(/0\/2/);                       // compare validated, list not answered
    expect(await tools.respond(wtWeb, '9', 'ok')).toMatch(/no está en la lista|not in the list/);
    expect(await tools.respond(wtWeb, '2', 'n/a')).toMatch(/nota|note/);
    await tools.respond(wtWeb, '1', 'ok', 'revisado en el juego');
    await tools.respond(wtWeb, 'pruebas con datos reales', 'n/a', 'solo cambia un texto');
    g = await gatePush(wtWeb, ctx);
    expect(g?.missing).toEqual([]);
    expect(await tools.state(wtWeb)).toMatch(/2\/2[\s\S]*solo cambia un texto/);
    // un commit nuevo pide contestarla otra vez (y el compare queda viejo)
    writeFileSync(path.join(wtWeb, 'pantalla.txt'), 'más'); sh(wtWeb, 'commit', '-qam', 'más');
    expect((await gatePush(wtWeb, ctx))?.missing).toHaveLength(2);
    // la copia principal no es de ninguna tarea: sin puerta
    expect(await gatePush(web.path, ctx)).toBeNull();
    expect(await tools.state(web.path)).toMatch(/no es el worktree|not a task worktree/);
  }, 30_000);

  it('una clave que no lo es, fuera', async () => {
    const ctx: CtxPreflight = { prs: async () => ({ prs: [] }), rooms: async () => [], manual: () => [], orden: async () => [], plan: () => undefined, color: () => undefined, git, compares: async () => [], reviews: () => ({}), ciChecks: () => undefined, checklist: () => ({ items: [], answers: () => ({}) }) };
    await expect(preflightOf('rm -rf', ctx)).rejects.toThrow();
  });
});

describe('cachedPRs', () => {
  it('una lectura por minuto como mucho; forzar la repite y un error no se queda', async () => {
    let n = 0, fail = false;
    const readPage = cachedPRs(async () => { n++; if (fail) throw new Error('sin red'); return { prs: [] }; }, 60_000);
    await readPage(); await readPage();
    expect(n).toBe(1);
    await readPage(true);
    expect(n).toBe(2);
    fail = true;
    await expect(readPage(true)).rejects.toThrow('sin red');
    fail = false;
    await readPage();
    expect(n).toBe(4);
  });
});

describe('cachedTaskPRs', () => {
  it('one read a minute per task; another task reads its own', async () => {
    const read: string[] = [];
    const readPage = cachedTaskPRs(async k => { read.push(k); return []; }, 60_000);
    await readPage('ABC-1'); await readPage('ABC-1'); await readPage('ABC-2'); await readPage('ABC-1', true);
    expect(read).toEqual(['ABC-1', 'ABC-2', 'ABC-1']);
  });
});

describe('preflightOf with a task merged weeks ago', () => {
  it('its PRs come from the task search when the board no longer has them', async () => {
    const old = pr('acme/api', 7, 'ABC-3-viejo', 'h7', { state: 'fusionado' });
    const ctx: CtxPreflight = {
      prs: async () => ({ prs: [] }), taskPrs: async () => [old], rooms: async () => [], manual: () => [], orden: async () => [],
      plan: () => undefined, color: () => undefined, compares: async () => [], reviews: () => ({}), ciChecks: () => undefined,
      checklist: () => ({ items: [], answers: () => ({}) }), git: async () => '',
    };
    const r = await preflightOf('ABC-3', ctx);
    expect(r.parts.map(p => p.pr?.number)).toEqual([7]);
    expect(r.waves).toEqual([['acme/api#7']]);
  });
});

describe('repoChecks', () => {
  it('lo que pide comprobar un repo: su CLAUDE.md, sus skills de comprobación y sus órdenes; solo leyendo archivos', async () => {
    const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'repo-checks-')));
    writeFileSync(path.join(d, 'CLAUDE.md'), '# Repo\n\n## Before opening a PR\n\n1. **Migrations reviewed.** Check them.\n');
    writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .', 'test:unit': 'vitest', dev: 'vite', 'test:watch': 'vitest -w', typecheck: 'tsc' } }));
    writeFileSync(path.join(d, 'Makefile'), 'test:\n\tpytest\nserve:\n\tpython -m http.server\nVAR := 1\n');
    writeFileSync(path.join(d, '.pre-commit-config.yaml'), 'repos: []\n');
    for (const [n, desc] of [['acceptance-criteria', 'Write acceptance criteria in Gherkin'], ['deploy-prod', 'Deploys to production'], ['changelog', 'Writes the changelog']]) {
      mkdirSync(path.join(d, '.claude', 'skills', n), { recursive: true });
      writeFileSync(path.join(d, '.claude', 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: ${desc}\n---\nbody`);
    }
    expect(await repoChecks(d)).toEqual(['CLAUDE.md · Migrations reviewed', 'skill · acceptance-criteria', 'npm run lint', 'npm run test:unit', 'npm run typecheck', 'make test', 'pre-commit run --all-files']);
    expect(await repoChecks(mkdtempSync(path.join(os.tmpdir(), 'repo-vacio-')))).toEqual([]);
  });
});
