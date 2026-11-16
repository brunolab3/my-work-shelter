import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cachedPRs, cachedTaskPRs, localBranches, preflightOf, PageReviews, gatePush, preflightTools, repoChecks, type CtxPreflight } from './preflight.ts';
import { mkdirSync } from 'node:fs';
import { buildCompare } from './comparar.ts';
import type { RoomPR } from './revisionesPR.ts';
import type { PRBoard } from '../shared/tablero.ts';

// con git de verdad: dos repos (api y web) con un remoto cada uno, su clon (la copia principal de la sala) y el worktree
// de la tarea; sin la configuración global del Supervisor
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: ENV }).trim();
const git = (cwd: string, args: string[]) => new Promise<string>((ok, mal) => execFile('git', ['-C', cwd, ...args], { env: ENV }, (err, o, e) => err ? mal(new Error(String(e || err.message))) : ok(String(o))));
const commit = (cwd: string, archivo: string, texto: string) => { writeFileSync(path.join(cwd, archivo), texto); sh(cwd, 'add', '.'); sh(cwd, 'commit', '-q', '-m', texto); return sh(cwd, 'rev-parse', 'HEAD'); };

function repo(base: string, nombre: string) {
  const remoto = path.join(base, nombre + '.git'), ruta = path.join(base, nombre);
  sh(base, 'init', '-q', '--bare', '-b', 'main', remoto);
  sh(base, 'clone', '-q', remoto, ruta);
  commit(ruta, 'README', 'inicio');
  sh(ruta, 'push', '-q', 'origin', 'main');
  return { remoto, ruta };
}
const pr = (repo: string, numero: number, rama: string, cabeza: string, extra: Partial<PRBoard> = {}): PRBoard =>
  ({ numero, titulo: 'PR ' + numero, url: `https://github.com/${repo}/pull/${numero}`, repo, rama, estado: 'abierto', actualizado: 0, base: 'main', checks: 'SUCCESS', revision: 'REVIEW_REQUIRED', cabeza, ...extra });

describe('pre-flight con git de verdad', () => {
  it('una tarea en dos repos: sincronía local frente a la cabeza del PR (un bot empujó, cambios sin commitear) y el bloqueo entre ellos', async () => {
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'preflight-')));
    const api = repo(base, 'api'), web = repo(base, 'web');
    // api: el worktree de la tarea, empujado; luego un bot empuja un arreglo desde otro clon
    const wtApi = path.join(base, 'wt', 'api-abc-7');
    sh(api.ruta, 'worktree', 'add', '-q', '-b', 'feature/ABC-7-contrato', wtApi);
    commit(wtApi, 'contrato.txt', 'contrato');
    sh(wtApi, 'push', '-q', 'origin', 'feature/ABC-7-contrato');
    const bot = path.join(base, 'bot');
    sh(base, 'clone', '-q', '-b', 'feature/ABC-7-contrato', api.remoto, bot);
    const cabezaApi = commit(bot, 'contrato.txt', 'arreglo del bot');
    sh(bot, 'push', '-q', 'origin', 'feature/ABC-7-contrato');
    // web: el worktree de la tarea al día con su PR, pero con un archivo sin commitear
    const wtWeb = path.join(base, 'wt', 'web-abc-7');
    sh(web.ruta, 'worktree', 'add', '-q', '-b', 'ABC-7-pantalla', wtWeb);
    const cabezaWeb = commit(wtWeb, 'pantalla.txt', 'pantalla');
    writeFileSync(path.join(wtWeb, 'pantalla.txt'), 'a medias');
    // otra tarea en web: no sale
    sh(web.ruta, 'branch', 'ABC-8-otra');

    const prs = [
      pr('acme/api', 1, 'feature/ABC-7-contrato', cabezaApi, { checks: 'FAILURE' }),
      pr('acme/web', 2, 'ABC-7-pantalla', cabezaWeb, { dependencias: ['acme/api#1'] }),
      pr('acme/web', 3, 'ABC-8-otra', 'zzz'),
    ];
    const salas: RoomPR[] = [
      { id: 'api', nombre: 'API', ruta: api.ruta, rama: 'main', repo: 'acme/api', worktrees: [{ ruta: api.ruta, rama: 'main' }, { ruta: wtApi, rama: 'feature/ABC-7-contrato' }] },
      { id: 'web', nombre: 'Web', ruta: web.ruta, rama: 'main', repo: 'acme/web', worktrees: [{ ruta: web.ruta, rama: 'main' }, { ruta: wtWeb, rama: 'ABC-7-pantalla' }] },
    ];
    const locales = await localBranches('ABC-7', prs, salas, git);
    expect(locales.map(l => [l.salaId, l.rama, l.worktree, l.cambios, l.sinCabeza ?? false])).toEqual([
      ['api', 'feature/ABC-7-contrato', wtApi, 0, true],     // la cabeza del bot no está en local (sin fetch)
      ['web', 'ABC-7-pantalla', wtWeb, 1, false],
    ]);
    // tras un fetch, la cabeza está: un commit detrás, ninguno sin empujar
    sh(api.ruta, 'fetch', '-q', 'origin');
    const api2 = (await localBranches('ABC-7', prs, salas, git)).find(l => l.salaId === 'api')!;
    expect([api2.sinCabeza ?? false, api2.detras, api2.adelante]).toEqual([false, 1, 0]);

    const ctx: CtxPreflight = {
      prs: async () => ({ prs }), salas: async () => salas, manuales: () => [], orden: async () => [],
      plan: () => [{ salaId: 'api', sala: 'API', titulo: 'El contrato' }, { salaId: 'web', sala: 'Web', titulo: 'La pantalla', waitA: ['api'] }],
      color: () => '#4dabff', git, compares: () => revisadas.compares(),
      ciChecks: url => url.endsWith('/1') ? [{ nombre: 'build', estado: 'mal' as const }, { nombre: 'lint', estado: 'ok' as const }] : undefined,
      checklist: () => ({ items: ['Compare revisado', 'Pruebas con datos reales'], respuestas: k => revisadas.checklistOf(k) }),
      revisiones: url => url.endsWith('/2') ? { ledger: { unresolved: 1, outdated: 0, unansweredSummaries: 0 }, hilos: [{ archivo: 'pantalla.txt', linea: 1, autor: 'revisora', texto: '¿Seguro?', url: url + '#discussion_r1', outdated: false }] } : {},
    };
    // la comparación de web (en una carpeta de pruebas), validada en su commit
    const carpeta = mkdtempSync(path.join(base, 'comparaciones-')), datos = mkdtempSync(path.join(base, 'datos-'));
    const revisadas = new PageReviews(datos, carpeta);
    const cmp = await buildCompare(wtWeb, { base: 'main' }, carpeta);
    expect(JSON.parse(readFileSync(cmp.archivo.replace(/\.html$/, '.json'), 'utf8')).partes).toEqual([{ worktree: wtWeb, rama: 'ABC-7-pantalla', head: cabezaWeb, base: 'main' }]);
    expect(revisadas.responder(cmp.archivo, 'validada')).toBe(true);
    expect(revisadas.responder(path.join(base, 'otra.html'), 'validada')).toBe(false);   // fuera de la carpeta, no cuenta
    const r = await preflightOf('abc-7', ctx);
    expect(r.clave).toBe('ABC-7');
    expect(r.color).toBe('#4dabff');
    const pApi = r.partes.find(p => p.salaId === 'api')!, pWeb = r.partes.find(p => p.salaId === 'web')!;
    expect([pApi.sync.marca, pApi.ci.marca, pApi.plan]).toEqual(['aviso', 'mal', 'El contrato']);
    expect([pWeb.sync.marca, pWeb.ci.marca, pWeb.bloqueos.marca]).toEqual(['aviso', 'ok', 'aviso']);   // la CI roja es de api
    expect(pWeb.esperaA.map(l => l.ref)).toEqual(['acme/api#1']);
    expect(r.olas).toEqual([['acme/api#1'], ['acme/web#2']]);
    expect(r.partes.some(p => p.pr?.numero === 3)).toBe(false);
    expect(pApi.ciChecks.map(c => `${c.nombre}:${c.estado}`)).toEqual(['build:mal', 'lint:ok']);   // cada check de su PR
    expect([pWeb.compare.marca, pApi.compare.marca]).toEqual(['ok', 'mal']);
    expect(pWeb.revision.texto).toMatch(/1/);                // el hilo sin resolver, en la revisión
    expect(pWeb.hilos.map(h => `${h.archivo}:${h.linea} ${h.autor}`)).toEqual(['pantalla.txt:1 revisora']);
    // un commit nuevo deja vieja la validación
    sh(wtWeb, 'commit', '-qam', 'otro paso');
    expect((await preflightOf('ABC-7', ctx)).partes.find(p => p.salaId === 'web')!.compare.marca).toBe('aviso');
    // a new compare at the new commit, validated, counts again
    const cmp2 = await buildCompare(wtWeb, { base: 'main' }, carpeta);
    expect(revisadas.responder(cmp2.archivo, 'validada')).toBe(true);
    expect((await preflightOf('ABC-7', ctx)).partes.find(p => p.salaId === 'web')!.compare.marca).toBe('ok');

    // fase 3: la lista «antes de subir» y la puerta de git push, desde la carpeta del worktree
    const tools = preflightTools(ctx, (k, w, h, item, a) => revisadas.contestar(k, w, h, item, a));
    let g = await gatePush(path.join(wtWeb), ctx);
    expect(g?.clave).toBe('ABC-7');
    expect(g?.falta.join(' ')).toMatch(/0\/2/);                       // compare validated, list not answered
    expect(await tools.responder(wtWeb, '9', 'ok')).toMatch(/no está en la lista|not in the list/);
    expect(await tools.responder(wtWeb, '2', 'n/a')).toMatch(/nota|note/);
    await tools.responder(wtWeb, '1', 'ok', 'revisado en el juego');
    await tools.responder(wtWeb, 'pruebas con datos reales', 'n/a', 'solo cambia un texto');
    g = await gatePush(wtWeb, ctx);
    expect(g?.falta).toEqual([]);
    expect(await tools.estado(wtWeb)).toMatch(/2\/2[\s\S]*solo cambia un texto/);
    // un commit nuevo pide contestarla otra vez (y el compare queda viejo)
    writeFileSync(path.join(wtWeb, 'pantalla.txt'), 'más'); sh(wtWeb, 'commit', '-qam', 'más');
    expect((await gatePush(wtWeb, ctx))?.falta).toHaveLength(2);
    // la copia principal no es de ninguna tarea: sin puerta
    expect(await gatePush(web.ruta, ctx)).toBeNull();
    expect(await tools.estado(web.ruta)).toMatch(/no es el worktree|not a task worktree/);
  }, 30_000);

  it('una clave que no lo es, fuera', async () => {
    const ctx: CtxPreflight = { prs: async () => ({ prs: [] }), salas: async () => [], manuales: () => [], orden: async () => [], plan: () => undefined, color: () => undefined, git, compares: async () => [], revisiones: () => ({}), ciChecks: () => undefined, checklist: () => ({ items: [], respuestas: () => ({}) }) };
    await expect(preflightOf('rm -rf', ctx)).rejects.toThrow();
  });
});

describe('cachedPRs', () => {
  it('una lectura por minuto como mucho; forzar la repite y un error no se queda', async () => {
    let n = 0, fallar = false;
    const leer = cachedPRs(async () => { n++; if (fallar) throw new Error('sin red'); return { prs: [] }; }, 60_000);
    await leer(); await leer();
    expect(n).toBe(1);
    await leer(true);
    expect(n).toBe(2);
    fallar = true;
    await expect(leer(true)).rejects.toThrow('sin red');
    fallar = false;
    await leer();
    expect(n).toBe(4);
  });
});

describe('cachedTaskPRs', () => {
  it('one read a minute per task; another task reads its own', async () => {
    const leidas: string[] = [];
    const leer = cachedTaskPRs(async k => { leidas.push(k); return []; }, 60_000);
    await leer('ABC-1'); await leer('ABC-1'); await leer('ABC-2'); await leer('ABC-1', true);
    expect(leidas).toEqual(['ABC-1', 'ABC-2', 'ABC-1']);
  });
});

describe('preflightOf with a task merged weeks ago', () => {
  it('its PRs come from the task search when the board no longer has them', async () => {
    const viejo = pr('acme/api', 7, 'ABC-3-viejo', 'h7', { estado: 'fusionado' });
    const ctx: CtxPreflight = {
      prs: async () => ({ prs: [] }), prsTarea: async () => [viejo], salas: async () => [], manuales: () => [], orden: async () => [],
      plan: () => undefined, color: () => undefined, compares: async () => [], revisiones: () => ({}), ciChecks: () => undefined,
      checklist: () => ({ items: [], respuestas: () => ({}) }), git: async () => '',
    };
    const r = await preflightOf('ABC-3', ctx);
    expect(r.partes.map(p => p.pr?.numero)).toEqual([7]);
    expect(r.olas).toEqual([['acme/api#7']]);
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
