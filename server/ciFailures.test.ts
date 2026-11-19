import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ciOfGitHub, newFailures, failureId, blockedBy, ciMessage, logTail, runOfUrl, CIFailures, type CtxCI } from './ciFailures.ts';
import { blockersBetween } from '../shared/deploy.ts';
import type { RoomPR } from './prReviews.ts';
import type { SessionSummary } from '../shared/protocol.ts';

// una tarea, REF-300, en dos repos inventados: el front (refugio/web#12) espera a la API (refugio/api#7), según su
// descripción; y un PR suelto de otro repo que pasa la CI
function pr(o: { number: number; repo: string; branch: string; oid: string; state?: string; body?: string; contexts?: any[] }) {
  return {
    number: o.number, title: `PR ${o.number}`, body: o.body ?? '', url: `https://github.com/${o.repo}/pull/${o.number}`, isDraft: false, state: 'OPEN',
    updatedAt: '2026-11-10T10:00:00Z', headRefName: o.branch, headRefOid: o.oid, baseRefName: 'main', repository: { nameWithOwner: o.repo },
    commits: { nodes: [{ commit: { oid: o.oid, statusCheckRollup: o.state ? { state: o.state, contexts: { nodes: o.contexts ?? [] } } : null } }] },
  };
}
const API_FAILING = [
  { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE', detailsUrl: 'https://github.com/refugio/api/actions/runs/555/job/1', checkSuite: { workflowRun: { databaseId: 555 } } },
  { __typename: 'CheckRun', name: 'lint', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/refugio/api/actions/runs/555/job/2' },
  { __typename: 'StatusContext', context: 'ci/despliegue-previo', state: 'ERROR', targetUrl: 'https://ci.example/b/9' },
];
function answer(apiOid = 'aaa111', apiState = 'FAILURE') {
  return { data: { prs: { nodes: [
    pr({ number: 7, repo: 'refugio/api', branch: 'feature/REF-300-endpoint', oid: apiOid, state: apiState, contexts: apiState === 'FAILURE' ? API_FAILING : [] }),
    pr({ number: 12, repo: 'refugio/web', branch: 'REF-300-pantalla', oid: 'bbb222', state: 'PENDING', body: 'Depends on refugio/api#7' }),
    pr({ number: 3, repo: 'refugio/docs', branch: 'arreglos', oid: 'ccc333', state: 'SUCCESS' }),
  ] } } };
}

const ROOMS: RoomPR[] = [
  { id: 'api', name: 'API', path: '/repos/api', branch: 'main', repo: 'refugio/api', worktrees: [{ path: '/repos/api/.claude/worktrees/ref-300', branch: 'feature/REF-300-endpoint' }] },
  { id: 'web', name: 'Web', path: '/repos/web', branch: 'main', repo: 'refugio/web', worktrees: [{ path: '/repos/web/.claude/worktrees/ref-300', branch: 'REF-300-pantalla' }] },
];
const session = (o: Partial<SessionSummary>): SessionSummary => ({ id: 's', dwellerId: 'h', roomId: 'api', cwd: '/repos/api', state: 'esperando', unread: false, title: '', created: 0, updated: 0, ...o } as SessionSummary);

describe('fallos de CI', () => {
  it('lee los checks que fallan, con su ejecución de Actions', () => {
    const [api, web, docs] = ciOfGitHub(answer());
    expect(api.head).toBe('aaa111');
    expect(api.failures).toEqual([
      { name: 'test', url: 'https://github.com/refugio/api/actions/runs/555/job/1', run: 555 },
      { name: 'ci/despliegue-previo', url: 'https://ci.example/b/9' },
    ]);
    expect(web.failures).toEqual([]);
    expect(web.dependencies).toEqual(['refugio/api#7']);
    expect(docs.checks).toBe('SUCCESS');
    expect(runOfUrl('https://github.com/o/r/actions/runs/42/job/7')).toBe(42);
  });

  it('the pre-flight shows each check once, its worst run: a cancelled one is not green', () => {
    const contexts = [
      { __typename: 'CheckRun', name: 'test', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'test', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'deploy', conclusion: 'CANCELLED' }, { __typename: 'CheckRun', name: 'docs', conclusion: 'SKIPPED' },
      { __typename: 'CheckRun', name: 'e2e', conclusion: 'STALE' },
    ];
    const [x] = ciOfGitHub({ data: { prs: { nodes: [pr({ number: 1, repo: 'refugio/api', branch: 'r', oid: 'o', state: 'FAILURE', contexts })] } } });
    expect(x.all).toEqual([{ name: 'test', state: 'mal' }, { name: 'deploy', state: 'mal' }, { name: 'docs', state: 'ok' }, { name: 'e2e', state: 'pendiente' }]);
  });

  it('una vez por PR y commit: un commit nuevo que vuelve a fallar se entrega otra vez', () => {
    const prs = ciOfGitHub(answer());
    expect(newFailures(prs, new Set()).map(failureId)).toEqual(['refugio/api#7@aaa111']);
    expect(newFailures(prs, new Set(['refugio/api#7@aaa111']))).toEqual([]);
    expect(newFailures(ciOfGitHub(answer('ddd444')), new Set(['refugio/api#7@aaa111'])).map(failureId)).toEqual(['refugio/api#7@ddd444']);
    expect(newFailures(ciOfGitHub(answer('ddd444', 'PENDING')), new Set())).toEqual([]);
  });

  it('una tarea en dos repos: el PR que falla dice a quién bloquea; el bloqueado no falla por ello', () => {
    const prs = ciOfGitHub(answer());
    const blockers = blockersBetween(prs);
    const [api, web] = prs;
    expect(blockedBy(api, prs, blockers)).toEqual(['refugio/web#12']);
    expect(blockedBy(web, prs, blockers)).toEqual([]);
    // también por el plan de la tarea o a mano, y en cadena
    const docs = prs[2];
    const others = blockersBetween(prs, [{ from: docs.url, by: web.url }]);
    expect(blockedBy(api, prs, others)).toEqual(['refugio/web#12', 'refugio/docs#3']);
    const byPlan = blockersBetween(prs.map(p => ({ ...p, dependencies: [] })), [], [{ key: 'REF-300', repo: 'refugio/web', waitA: ['refugio/api'] }]);
    expect(blockedBy(api, prs, byPlan)).toEqual(['refugio/web#12']);

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
    const tail = logTail(log);
    expect(tail.split('\n')).toHaveLength(80);
    expect(tail).toContain('test\tRun\tlínea 199');
    expect(tail).not.toContain('\x1b');
    expect(tail).not.toContain('2026-11-10T');
    expect(logTail('x'.repeat(9000)).length).toBeLessThanOrEqual(4001);
  });

  it('la primera vez no manda lo que ya fallaba; después, una sola entrega a la conversación del worktree del PR', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = answer();
    const deliveries: [string, string][] = [], robots: [string, string, string[]][] = [], logs: number[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), query: async () => json,
      log: async (_repo, run) => { logs.push(run); return 'FAIL src/x.test.ts\nexpected 1, got 2'; },
      blockers: async prs => blockersBetween(prs), rooms: async () => ROOMS,
      sessions: () => [session({ id: 'api-tarea', roomId: 'api', worktree: '/repos/api/.claude/worktrees/ref-300' }), session({ id: 'web-tarea', roomId: 'web', worktree: '/repos/web/.claude/worktrees/ref-300' })],
      notify: (id, t) => { deliveries.push([id, t]); return true; }, open: async () => false,
      delivered: (room, wt, _pr, blocks) => { robots.push([room, wt, blocks]); }, withoutConversation: () => {},
    };
    await new CIFailures(dir, ctx).poll();
    expect(deliveries).toEqual([]);                      // ya fallaba antes de mirar
    json = answer('eee555');                          // un commit nuevo, que también falla
    await new CIFailures(dir, ctx).poll();
    expect(deliveries.map(d => d[0])).toEqual(['api-tarea']);   // solo el que falla; el front bloqueado, no
    expect(deliveries[0][1]).toContain('expected 1, got 2');
    expect(deliveries[0][1]).toContain('refugio/web#12');
    expect(logs).toEqual([555]);
    expect(robots).toEqual([['api', '/repos/api/.claude/worktrees/ref-300', ['refugio/web#12']]]);
    await new CIFailures(dir, ctx).poll();             // y no se repite (tampoco tras reiniciar)
    expect(deliveries).toHaveLength(1);
  });

  it('sin conversación abierta, se retoma la del worktree del PR; sin worktree, se avisa una vez y se reintenta', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } };
    const open: [string, string][] = [], notices: string[] = [];
    let rooms = ROOMS;
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), query: async () => json, log: async () => { throw new Error('sin log'); },
      blockers: async () => [], rooms: async () => rooms, sessions: () => [],
      notify: () => false, open: async (room, cwd) => { open.push([room, cwd]); return true; },
      delivered: () => {}, withoutConversation: t => notices.push(t),
    };
    const r = new CIFailures(dir, ctx);
    await r.poll();                                   // primera vuelta: nada fallaba
    json = answer();
    rooms = [{ ...ROOMS[0], worktrees: [] }];
    await r.poll(); await r.poll();
    expect(open).toEqual([]);
    expect(notices).toHaveLength(1);                      // un aviso, no uno por vuelta
    rooms = ROOMS;
    await r.poll();
    expect(open).toEqual([['api', '/repos/api/.claude/worktrees/ref-300']]);
  });

  it('two overlapping rounds deliver a failure once', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } };
    const deliveries: string[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), query: async () => json,
      log: () => new Promise(ok => setTimeout(() => ok('slow log'), 30)), blockers: async () => [], rooms: async () => ROOMS,
      sessions: () => [session({ id: 'api-tarea', roomId: 'api', worktree: '/repos/api/.claude/worktrees/ref-300' })],
      notify: id => { deliveries.push(id); return true; }, open: async () => false, delivered: () => {}, withoutConversation: () => {},
    };
    const r = new CIFailures(dir, ctx);
    await r.poll();
    json = answer();
    await Promise.all([r.poll(), r.poll()]);
    expect(deliveries).toEqual(['api-tarea']);
  });

  it('a failure with nowhere to go does not fetch its log every round; once deliverable, the log is fetched once', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fallos-ci-'));
    let json: any = { data: { prs: { nodes: [] } } }, rooms: RoomPR[] = [], canOpen = false;
    const logs: number[] = [], open: string[] = [];
    const ctx: CtxCI = {
      connection: async () => ({ real: true }), query: async () => json, log: async (_r, run) => { logs.push(run); return 'FAIL'; },
      blockers: async () => [], rooms: async () => rooms, sessions: () => [], notify: () => false,
      open: async (_s, _c, text) => { if (canOpen) open.push(text); return canOpen; }, delivered: () => {}, withoutConversation: () => {},
    };
    const r = new CIFailures(dir, ctx);
    await r.poll();
    json = answer();
    await r.poll(); await r.poll();
    expect(logs).toEqual([]);                            // no room for the repo
    rooms = ROOMS;
    await r.poll(); await r.poll();               // room and worktree, but the conversation can't open (limit)
    expect(logs).toEqual([555]);
    canOpen = true;
    await r.poll();
    expect(logs).toEqual([555]);
    expect(open).toHaveLength(1);
    expect(open[0]).toContain('FAIL');
  });
});
