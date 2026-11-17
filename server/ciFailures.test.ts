import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ciOfGitHub, newFailures, failureId, blockedBy, ciMessage, logTail, runOfUrl, CIFailures, type CtxCI } from './fallosCI.ts';
import { bloqueosEntre } from '../shared/despliegue.ts';
import type { RoomPR } from './revisionesPR.ts';
import type { SessionSummary } from '../shared/protocolo.ts';

// una tarea, REF-300, en dos repos inventados: el front (refugio/web#12) espera a la API (refugio/api#7), según su
// descripción; y un PR suelto de otro repo que pasa la CI
function pr(o: { number: number; repo: string; rama: string; oid: string; state?: string; body?: string; contexts?: any[] }) {
  return {
    number: o.number, title: `PR ${o.number}`, body: o.body ?? '', url: `https://github.com/${o.repo}/pull/${o.number}`, isDraft: false, state: 'OPEN',
    updatedAt: '2026-11-10T10:00:00Z', headRefName: o.rama, headRefOid: o.oid, baseRefName: 'main', repository: { nameWithOwner: o.repo },
    commits: { nodes: [{ commit: { oid: o.oid, statusCheckRollup: o.state ? { state: o.state, contexts: { nodes: o.contexts ?? [] } } : null } }] },
  };
}
const API_FAILING = [
  { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', detailsUrl: 'https://github.com/refugio/api/actions/runs/555/job/1', checkSuite: { workflowRun: { databaseId: 555 } } },
  { __typename: 'CheckRun', name: 'lint', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/refugio/api/actions/runs/555/job/2' },
  { __typename: 'StatusContext', context: 'ci/despliegue-previo', state: 'ERROR', targetUrl: 'https://ci.example/b/9' },
];
function respuesta(apiOid = 'aaa111', apiState = 'FAILURE') {
  return { data: { prs: { nodes: [
    pr({ number: 7, repo: 'refugio/api', rama: 'feature/REF-300-endpoint', oid: apiOid, state: apiState, contexts: apiState === 'FAILURE' ? API_FAILING : [] }),
    pr({ number: 12, repo: 'refugio/web', rama: 'REF-300-pantalla', oid: 'bbb222', state: 'PENDING', body: 'Depends on refugio/api#7' }),
    pr({ number: 3, repo: 'refugio/docs', rama: 'arreglos', oid: 'ccc333', state: 'SUCCESS' }),
  ] } } };
}

const SALAS: RoomPR[] = [
  { id: 'api', nombre: 'API', ruta: '/repos/api', rama: 'main', repo: 'refugio/api', worktrees: [{ ruta: '/repos/api/.claude/worktrees/ref-300', rama: 'feature/REF-300-endpoint' }] },
  { id: 'web', nombre: 'Web', ruta: '/repos/web', rama: 'main', repo: 'refugio/web', worktrees: [{ ruta: '/repos/web/.claude/worktrees/ref-300', rama: 'REF-300-pantalla' }] },
];
const sesion = (o: Partial<SessionSummary>): SessionSummary => ({ id: 's', dwellerId: 'h', salaId: 'api', cwd: '/repos/api', estado: 'esperando', sinLeer: false, titulo: '', creada: 0, actualizada: 0, ...o } as SessionSummary);

describe('fallos de CI', () => {
  it('lee los checks que fallan, con su ejecución de Actions', () => {
    const [api, web, docs] = ciOfGitHub(respuesta());
    expect(api.cabeza).toBe('aaa111');
    expect(api.fallos).toEqual([
      { nombre: 'test', url: 'https://github.com/refugio/api/actions/runs/555/job/1', run: 555 },
      { nombre: 'ci/despliegue-previo', url: 'https://ci.example/b/9' },
    ]);
    expect(web.fallos).toEqual([]);
    expect(web.dependencias).toEqual(['refugio/api#7']);
    expect(docs.checks).toBe('SUCCESS');
    expect(runOfUrl('https://github.com/o/r/actions/runs/42/job/7')).toBe(42);
  });

  it('the pre-flight shows each check once, its worst run: a cancelled one is not green', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'test', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'deploy', conclusion: 'CANCELLED' }, { __typename: 'CheckRun', name: 'docs', conclusion: 'SKIPPED' },
      { __typename: 'CheckRun', name: 'e2e', conclusion: 'STALE' },
    ];
    const [x] = ciOfGitHub({ data: { prs: { nodes: [pr({ number: 1, repo: 'refugio/api', rama: 'r', oid: 'o', state: 'FAILURE', contexts })] } } });
    expect(x.todos).toEqual([{ nombre: 'test', estado: 'mal' }, { nombre: 'deploy', estado: 'mal' }, { nombre: 'docs', estado: 'ok' }, { nombre: 'e2e', estado: 'pendiente' }]);
  });

  it('una vez por PR y commit: un commit nuevo que vuelve a fallar se entrega otra vez', () => {
    const prs = ciOfGitHub(respuesta());
    expect(newFailures(prs, new Set()).map(failureId)).toEqual(['refugio/api#7@aaa111']);
    expect(newFailures(prs, new Set(['refugio/api#7@aaa111']))).toEqual([]);
    expect(newFailures(ciOfGitHub(respuesta('ddd444')), new Set(['refugio/api#7@aaa111'])).map(failureId)).toEqual(['refugio/api#7@ddd444']);
    expect(newFailures(ciOfGitHub(respuesta('ddd444', 'PENDING')), new Set())).toEqual([]);
  });

  it('una tarea en dos repos: el PR que falla dice a quién bloquea; el bloqueado no falla por ello', () => {
    const prs = ciOfGitHub(respuesta());
    const bloqueos = bloqueosEntre(prs);
    const [api, web] = prs;
    expect(blockedBy(api, prs, bloqueos)).toEqual(['refugio/web#12']);
    expect(blockedBy(web, prs, bloqueos)).toEqual([]);
    // también por el plan de la tarea o a mano, y en cadena
    const docs = prs[2];
    const otros = bloqueosEntre(prs, [{ de: docs.url, por: web.url }]);
    expect(blockedBy(api, prs, otros)).toEqual(['refugio/web#12', 'refugio/docs#3']);
    const porPlan = bloqueosEntre(prs.map(p => ({ ...p, dependencias: [] })), [], [{ clave: 'REF-300', repo: 'refugio/web', waitA: ['refugio/api'] }]);
    expect(blockedBy(api, prs, porPlan)).toEqual(['refugio/web#12']);

    const m = ciMessage(api, ['refugio/web#12'], 'Error: falta el campo');
    expect(m).toContain('[REF-300]');
    expect(m).toContain('#7');
    expect(m).toContain('`aaa111`');
    expect(m).toContain('https://github.com/refugio/api/actions/runs/555/job/1');
    expect(m).toContain('refugio/web#12');
    expect(m).toContain('Error: falta el campo');
  });

  it('la cola del log, sin colores ni marcas de tiempo y con tope', () => {
    const log = Array.from({ length: 200 }, (_, i) => `test\tRun\t2026-11-10T10:00:00.1234567Z \x1b[31mlínea ${i}\x1b[0m`).join('\n');
    const cola = logTail(log);
    expect(cola.split('\n')).toHaveLength(80);
    expect(cola).toContain('test\tRun\tlínea 199');
    expect(cola).not.toContain('\x1b');
    expect(cola).not.toContain('2026-11-10T');
    expect(logTail('x'.repeat(9000)).length).toBeLessThanOrEqual(4001);
  });

  it('la primera vez no manda lo que ya fallaba; después, una sola entrega a la conversación del worktree del PR', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = respuesta();
    const deliveries: [string, string][] = [], robots: [string, string, string[]][] = [], logs: number[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), consultar: async () => json,
      log: async (_repo, run) => { logs.push(run); return 'FAIL src/x.test.ts\nexpected 1, got 2'; },
      bloqueos: async prs => bloqueosEntre(prs), salas: async () => SALAS,
      sesiones: () => [sesion({ id: 'api-tarea', salaId: 'api', worktree: '/repos/api/.claude/worktrees/ref-300' }), sesion({ id: 'web-tarea', salaId: 'web', worktree: '/repos/web/.claude/worktrees/ref-300' })],
      avisar: (id, t) => { deliveries.push([id, t]); return true; }, abrir: async () => false,
      delivered: (sala, wt, _pr, bloquea) => { robots.push([sala, wt, bloquea]); }, withoutConversation: () => {},
    };
    await new CIFailures(dir, ctx).sondear();
    expect(deliveries).toEqual([]);                      // ya fallaba antes de mirar
    json = respuesta('eee555');                          // un commit nuevo, que también falla
    await new CIFailures(dir, ctx).sondear();
    expect(deliveries.map(d => d[0])).toEqual(['api-tarea']);   // solo el que falla; el front bloqueado, no
    expect(deliveries[0][1]).toContain('expected 1, got 2');
    expect(deliveries[0][1]).toContain('refugio/web#12');
    expect(logs).toEqual([555]);
    expect(robots).toEqual([['api', '/repos/api/.claude/worktrees/ref-300', ['refugio/web#12']]]);
    await new CIFailures(dir, ctx).sondear();             // y no se repite (tampoco tras reiniciar)
    expect(deliveries).toHaveLength(1);
  });

  it('sin conversación abierta, se retoma la del worktree del PR; sin worktree, se avisa una vez y se reintenta', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } };
    const abiertos: [string, string][] = [], avisos: string[] = [];
    let salas = SALAS;
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), consultar: async () => json, log: async () => { throw new Error('sin log'); },
      bloqueos: async () => [], salas: async () => salas, sesiones: () => [],
      avisar: () => false, abrir: async (sala, cwd) => { abiertos.push([sala, cwd]); return true; },
      delivered: () => {}, withoutConversation: t => avisos.push(t),
    };
    const r = new CIFailures(dir, ctx);
    await r.sondear();                                   // primera vuelta: nada fallaba
    json = respuesta();
    salas = [{ ...SALAS[0], worktrees: [] }];
    await r.sondear(); await r.sondear();
    expect(abiertos).toEqual([]);
    expect(avisos).toHaveLength(1);                      // un aviso, no uno por vuelta
    salas = SALAS;
    await r.sondear();
    expect(abiertos).toEqual([['api', '/repos/api/.claude/worktrees/ref-300']]);
  });

  it('two overlapping rounds deliver a failure once', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } };
    const deliveries: string[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), consultar: async () => json,
      log: () => new Promise(ok => setTimeout(() => ok('slow log'), 30)), bloqueos: async () => [], salas: async () => SALAS,
      sesiones: () => [sesion({ id: 'api-tarea', salaId: 'api', worktree: '/repos/api/.claude/worktrees/ref-300' })],
      avisar: id => { deliveries.push(id); return true; }, abrir: async () => false, delivered: () => {}, withoutConversation: () => {},
    };
    const r = new CIFailures(dir, ctx);
    await r.sondear();
    json = respuesta();
    await Promise.all([r.sondear(), r.sondear()]);
    expect(deliveries).toEqual(['api-tarea']);
  });

  it('a failure with nowhere to go does not fetch its log every round; once deliverable, the log is fetched once', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } }, salas: RoomPR[] = [], puedeAbrir = false;
    const logs: number[] = [], abiertos: string[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), consultar: async () => json, log: async (_r, run) => { logs.push(run); return 'FAIL'; },
      bloqueos: async () => [], salas: async () => salas, sesiones: () => [], avisar: () => false,
      abrir: async (_s, _c, texto) => { if (puedeAbrir) abiertos.push(texto); return puedeAbrir; }, delivered: () => {}, withoutConversation: () => {},
    };
    const r = new CIFailures(dir, ctx);
    await r.sondear();
    json = respuesta();
    await r.sondear(); await r.sondear();
    expect(logs).toEqual([]);                            // no room for the repo
    salas = SALAS;
    await r.sondear(); await r.sondear();               // room and worktree, but the conversation can't open (limit)
    expect(logs).toEqual([555]);
    puedeAbrir = true;
    await r.sondear();
    expect(logs).toEqual([555]);
    expect(abiertos).toHaveLength(1);
    expect(abiertos[0]).toContain('FAIL');
  });
});
