import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { cachedPRs, localBranches, preflightOf, type CtxPreflight } from './preflight.ts';
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
      color: () => '#4dabff', git,
    };
    const r = await preflightOf('abc-7', ctx);
    expect(r.clave).toBe('ABC-7');
    expect(r.color).toBe('#4dabff');
    const pApi = r.partes.find(p => p.salaId === 'api')!, pWeb = r.partes.find(p => p.salaId === 'web')!;
    expect([pApi.sync.marca, pApi.ci.marca, pApi.plan]).toEqual(['aviso', 'mal', 'El contrato']);
    expect([pWeb.sync.marca, pWeb.ci.marca, pWeb.bloqueos.marca]).toEqual(['aviso', 'ok', 'aviso']);   // la CI roja es de api
    expect(pWeb.esperaA.map(l => l.ref)).toEqual(['acme/api#1']);
    expect(r.olas).toEqual([['acme/api#1'], ['acme/web#2']]);
    expect(r.partes.some(p => p.pr?.numero === 3)).toBe(false);
  }, 30_000);

  it('una clave que no lo es, fuera', async () => {
    const ctx = { prs: async () => ({ prs: [] }), salas: async () => [], manuales: () => [], orden: async () => [], plan: () => undefined, color: () => undefined, git } as CtxPreflight;
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
