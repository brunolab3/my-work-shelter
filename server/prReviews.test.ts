import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewsOfGitHub, withoutNothingThatMake, remoteRepo, branchKey, sessionOfPR, worktreeOfPR, reviewMessage, ReviewsPR, type RoomPR, type CtxReviews } from './prReviews.ts';
import type { SessionSummary } from '../shared/protocol.ts';
import { readFileSync } from 'node:fs';

const T0 = Date.parse('2026-11-10T10:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
// la respuesta de CONSULTA_REVISIONES, con gente y repos inventados
function answer(min = 5) {
  return {
    data: {
      viewer: { login: 'yo-mismo' },
      prs: { nodes: [{
        number: 42, title: 'Rutas con parámetros opcionales', url: 'https://github.com/refugio/express/pull/42', headRefName: 'feature/REF-212-barra-final', repository: { nameWithOwner: 'refugio/express' },
        reviews: { nodes: [
          { id: 'R1', state: 'CHANGES_REQUESTED', body: 'Falta una prueba.', url: 'u/r1', submittedAt: iso(min), author: { login: 'ana-revisa' } },
          { id: 'R2', state: 'COMMENTED', body: '', url: 'u/r2', submittedAt: iso(min), author: { login: 'ana-revisa' } },
          { id: 'R3', state: 'APPROVED', body: '', url: 'u/r3', submittedAt: iso(min), author: { login: 'beto' } },
          { id: 'R4', state: 'COMMENTED', body: 'Mío', url: 'u/r4', submittedAt: iso(min), author: { login: 'yo-mismo' } },
          { id: 'R5', state: 'APPROVED', body: 'LGTM 🚀', url: 'u/r5', submittedAt: iso(min), author: { login: 'carla' } },
          { id: 'R6', state: 'APPROVED', body: 'Ok, pero renombra `x` antes de fusionar', url: 'u/r6', submittedAt: iso(min), author: { login: 'carla' } },
        ] },
        reviewThreads: { nodes: [
          { isResolved: false, path: 'lib/router.js', line: 12, comments: { nodes: [
            { id: 'C1', body: '¿Y si viene vacío?', url: 'u/c1', createdAt: iso(min), author: { login: 'ana-revisa' } },
            { id: 'C2', body: 'Lo miro', url: 'u/c2', createdAt: iso(min + 1), author: { login: 'yo-mismo' } },
            { id: 'C4', body: 'Thanks! 👍', url: 'u/c4', createdAt: iso(min + 2), author: { login: 'ana-revisa' } },
          ] } },
          { isResolved: true, path: 'lib/x.js', line: 3, comments: { nodes: [{ id: 'C3', body: 'ya está', url: 'u/c3', createdAt: iso(min), author: { login: 'beto' } }] } },
        ] },
        comments: { nodes: [
          { id: 'I1', body: '<!-- ci-status: failed -->\nCI failed: el checkout no carga',  url: 'u/i1', createdAt: iso(min), author: { __typename: 'Bot', login: 'informe-ci' } },
          { id: 'I2', body: '¿Esto entra en la versión 5?', url: 'u/i2', createdAt: iso(min + 2), author: { __typename: 'User', login: 'beto' } },
          { id: 'I3', body: '@yo-mismo gracias, perfecto', url: 'u/i3', createdAt: iso(min + 3), author: { __typename: 'User', login: 'beto' } },
        ] },
      }] },
    },
  };
}

const session = (o: Partial<SessionSummary>): SessionSummary => ({ id: 's', dwellerId: 'h', roomId: 'express', cwd: '/repos/express', state: 'idle', unread: false, title: '', pendingCount: 0, helpers: [], tools: 0, turns: 0, created: 0, updated: 0, ...o });
const ROOMS: RoomPR[] = [
  { id: 'express', name: 'Express', path: '/repos/express', branch: 'main', repo: 'refugio/express', worktrees: [
    { path: '/repos/express/.claude/worktrees/rutas', branch: 'feature/REF-212-barra-final' },
    { path: '/repos/express/.claude/worktrees/shelter-ref-212-pruebas-0abc', branch: 'worktree-shelter-ref-212-pruebas-0abc' },
  ] },
  { id: 'otro', name: 'Otro', path: '/repos/otro', branch: 'main', repo: 'refugio/otro', worktrees: [] },
];

describe('revisiones de PR', () => {
  it('se queda con lo de otros que pide algo, también de bots y aprobaciones con una nota: sin vistos buenos, hilos resueltos ni lo mío', () => {
    const { me, prs } = reviewsOfGitHub(answer());
    expect(me).toBe('yo-mismo');
    expect(prs[0]).toMatchObject({ number: 42, repo: 'refugio/express', branch: 'feature/REF-212-barra-final' });
    expect(prs[0].events.map(e => e.id)).toEqual(['R1', 'R6', 'C1', 'I1', 'I2']);
    expect(reviewMessage(prs[0], [prs[0].events[1]])).toContain('aprueba, con una nota');
    // el del bot, marcado y sin sus marcas HTML
    expect(prs[0].events.find(e => e.id === 'I1')).toMatchObject({ bot: true, body: 'CI failed: el checkout no carga' });
    expect(reviewMessage(prs[0], prs[0].events)).toContain('**informe-ci** (bot) ');
    expect(prs[0].events.find(e => e.id === 'C1')).toMatchObject({ type: 'thread', author: 'ana-revisa', file: 'lib/router.js', line: 12 });
  });

  it('un visto bueno o un agradecimiento no pide nada; una pregunta o un cambio, sí', () => {
    for (const t of ['', 'LGTM', 'lgtm!', 'LGTM :white_check_mark: :rocket:', 'Approved ✅🚀', 'Looks good to me 👍', ':shipit:', 'Thanks a lot!', 'Gracias, perfecto.', '🎉🎉', 'Nice work @ana-revisa', '+1']) expect(withoutNothingThatMake(t), t).toBe(true);
    for (const t of ['LGTM, ¿pero esto no rompe la v4?', 'Thanks, but please add a test', 'nit: rename this', 'Ok?']) expect(withoutNothingThatMake(t), t).toBe(false);
  });

  it('saca el repo del remoto y la clave de la rama', () => {
    expect(remoteRepo('git@github.com:Refugio/Express.git\n')).toBe('refugio/express');
    expect(remoteRepo('https://github.com/refugio/express')).toBe('refugio/express');
    expect(remoteRepo('https://gitlab.example/refugio/express.git')).toBeUndefined();
    expect(branchKey('feature/ref-212-barra-final')).toBe('REF-212');
    expect(branchKey('sin-clave')).toBeUndefined();
  });

  it('va a la conversación del worktree en la rama del PR, si no a la de la tarea, y nunca a otro repo', () => {
    const pr = { repo: 'refugio/express', branch: 'feature/REF-212-barra-final' };
    const inBranch = session({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas', updated: 1 });
    const ofTask = session({ id: 'tarea', worktree: '/repos/express/.claude/worktrees/shelter-ref-212-pruebas-0abc', updated: 9 });
    const otherRepo = session({ id: 'otro', roomId: 'otro', cwd: '/repos/otro', updated: 10 });
    expect(sessionOfPR(pr, ROOMS, [ofTask, inBranch, otherRepo])?.session.id).toBe('rama');
    expect(sessionOfPR(pr, ROOMS, [ofTask, otherRepo])?.session.id).toBe('tarea');
    expect(sessionOfPR(pr, ROOMS, [{ ...inBranch, state: 'closed' }, otherRepo])).toBeUndefined();
    // la carpeta principal de la sala, si está en la rama del PR
    expect(sessionOfPR({ ...pr, branch: 'main' }, ROOMS, [session({ id: 'principal' })])?.session.id).toBe('principal');
  });

  it("each PR's notices go only to its own task's conversation, never another task's, wherever its branch is", () => {
    // feverzoneclient: B2BI-16867's worktree made B2BI-16924-3b; B2BI-16925's worktree has B2BI-16867-6 checked out
    const room: RoomPR = { id: 'fz', name: 'fz', path: '/repos/fz', branch: 'master', repo: 'feverup/fz', worktrees: [
      { path: '/repos/fz', branch: 'master' },
      { path: '/repos/fz/.claude/worktrees/shelter-b2bi-16867-multi', branch: 'feature/B2BI-16867-6a', visited: { 'feature/B2BI-16924-3b': 300 } },
      { path: '/repos/fz/.claude/worktrees/shelter-b2bi-16924-link', branch: 'feature/B2BI-16924-3' },
      { path: '/repos/fz/.claude/worktrees/shelter-b2bi-16925-schedule', branch: 'feature/B2BI-16867-6' },
    ] };
    const at = (id: string, wt: string, updated: number) => session({ id, roomId: 'fz', worktree: `/repos/fz/.claude/worktrees/${wt}`, updated });
    const s16867 = at('16867', 'shelter-b2bi-16867-multi', 1), s16924 = at('16924', 'shelter-b2bi-16924-link', 2), s16925 = at('16925', 'shelter-b2bi-16925-schedule', 3);
    const all = [s16867, s16924, s16925];
    const pr = (branch: string, number: number, title = '') => ({ repo: 'feverup/fz', branch, number, title });
    // two PRs of two tasks in one room: each to its own
    expect(sessionOfPR(pr('feature/B2BI-16924-3b', 19051), [room], all)?.session.id).toBe('16924');
    expect(sessionOfPR(pr('feature/B2BI-16867-6a', 19048), [room], all)?.session.id).toBe('16867');
    // checked out in B2BI-16925's worktree, it is still B2BI-16867's
    expect(sessionOfPR(pr('feature/B2BI-16867-6', 19029), [room], all)?.session.id).toBe('16867');
    // its task without an open conversation: none (the callers resume one in its task's worktree), never another task's
    expect(sessionOfPR(pr('feature/B2BI-16867-6', 19029), [room], [s16924, s16925])).toBeUndefined();
    expect(worktreeOfPR(pr('feature/B2BI-16867-6', 19029), room)).toBe('/repos/fz/.claude/worktrees/shelter-b2bi-16867-multi');
    // no worktree of its task: nowhere, not the worktree its branch is in
    expect(worktreeOfPR(pr('feature/B2BI-16999-x', 19100), { ...room, worktrees: [...room.worktrees, { path: '/repos/fz/.claude/worktrees/shelter-b2bi-16000-y', branch: 'feature/B2BI-16999-x' }] })).toBeUndefined();
    // exact key: B2BI-1692 isn't B2BI-16924; without a key in the branch, the title's
    expect(sessionOfPR(pr('feature/B2BI-1692-x', 19101), [room], all)).toBeUndefined();
    expect(sessionOfPR(pr('fix-tooltip', 19102, 'B2BI-16924 - Fix the tooltip'), [room], all)?.session.id).toBe('16924');
    // no key at all: the worktree that had its branch
    const keyless = { ...room, worktrees: room.worktrees.map(w => (w.path.endsWith('16925-schedule') ? { ...w, visited: { 'fix-tooltip': 5 } } : w)) };
    expect(sessionOfPR(pr('fix-tooltip', 19102), [keyless], all)?.session.id).toBe('16925');
  });

  it('el mensaje cita cada comentario y pide un plan antes de tocar nada', () => {
    const { prs } = reviewsOfGitHub(answer());
    const m = reviewMessage(prs[0], prs[0].events);
    expect(m).toContain('[REF-212] Revisión nueva en tu PR #42 de refugio/express');
    expect(m).toContain('**ana-revisa** pide cambios (u/r1)\n   > Falta una prueba.');
    expect(m).toContain('comenta en `lib/router.js:12`');
    expect(m).toContain('hasta que el Supervisor apruebe el plan');
  });

  it('con la cuenta del PR: hilos sin resolver y resúmenes sin respuesta, y el recordatorio antes de descartar o volver a pedir', () => {
    // el fixture de verdad por el camino de verdad: reviewsOfGitHub con su autor (viewer) y el mensaje que recibe el habitante
    const { prs } = reviewsOfGitHub(JSON.parse(readFileSync(path.join(__dirname, '../test/fixtures/pr_review_ledger.json'), 'utf8')));
    expect(prs[0].ledger).toEqual({ unresolved: 2, outdated: 1, unansweredSummaries: 2 });
    const m = reviewMessage(prs[0], prs[0].events);
    expect(m).toContain('📒 Cuenta del PR: 2 hilos sin resolver (de ellos, 1 desfasados');
    expect(m).toContain('y 2 resúmenes de revisión sin respuesta tuya.');
    expect(m).toContain('antes de descartar una revisión o volver a pedirla');
    // sin nada pendiente, lo dice (y recuerda la regla igual)
    expect(reviewMessage({ ...prs[0], ledger: { unresolved: 0, outdated: 0, unansweredSummaries: 0 } }, prs[0].events)).toContain('ningún hilo sin resolver ni resumen sin respuesta');
  });

  it('el tablero recibe la cuenta de cada PR de la última vuelta', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    const fixture = JSON.parse(readFileSync(path.join(__dirname, '../test/fixtures/pr_review_ledger.json'), 'utf8'));
    const r = new ReviewsPR(dir, { connection: async () => ({ real: true }), query: async () => fixture, rooms: async () => [], sessions: () => [], notify: () => false, open: async () => false, delivered: () => {}, withoutConversation: () => {} });
    const url = 'https://github.example/refugio/cola/pull/31';
    expect(r.ledgerOf(url)).toBeUndefined();
    await r.poll();
    expect(r.ledgerOf(url)).toEqual({ unresolved: 2, outdated: 1, unansweredSummaries: 2 });
  });

  it('la primera vez solo marca desde cuándo; luego entrega lo nuevo una vez, y sin conversación abre la del worktree de la tarea', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    let json: any = answer(-60), openSessions: SessionSummary[] = [], canOpen = false;
    const deliveries: [string, string][] = [], notices: string[] = [], openIn: [string, string][] = [], robots: [string, string][] = [];
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), query: async () => json, rooms: async () => ROOMS, sessions: () => openSessions,
      notify: (id, t) => { deliveries.push([id, t]); return true; }, delivered: (s: string, w: string) => { robots.push([s, w]); }, withoutConversation: t => notices.push(t),
      open: async (roomId, cwd) => { if (!canOpen) return false; openIn.push([roomId, cwd]); return true; },
    };
    const r = new ReviewsPR(dir, ctx);
    const now = Date.now;
    try {
      Date.now = () => T0;
      await r.poll();                       // lo de antes de conectar no se manda
      json = answer(5);
      await r.poll();                       // no se puede abrir la conversación (límite): un aviso, una sola vez
      await r.poll();
      expect(deliveries).toEqual([]);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('no he podido abrir la conversación de su worktree');
      openSessions = [session({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas' })];
      await r.poll();                       // con la conversación abierta, le llega
      expect(deliveries.map(e => e[0])).toEqual(['rama']);
      expect(deliveries[0][1]).toContain('¿Esto entra en la versión 5?');
      expect(robots).toEqual([['express', '/repos/express/.claude/worktrees/rutas']]);   // el robot va al holograma de ese worktree
      await new ReviewsPR(dir, ctx).poll();   // y no se repite (tampoco tras reiniciar)
      expect(deliveries).toHaveLength(1);
    } finally { Date.now = now; }
  });

  it('al empezar a entregar lo de bots, los que ya había no se mandan de golpe; los nuevos, sí', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    // un refugio de antes: ya miraba desde T0 - 60 min, sin bots
    writeFileSync(path.join(dir, 'pr-reviews.json'), JSON.stringify({ since: T0 - 120 * 60_000, seen: ['R1', 'R6', 'C1', 'I2'] }));
    let json: any = answer(-60);
    const deliveries: string[] = [];
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), query: async () => json, rooms: async () => ROOMS,
      sessions: () => [session({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas' })],
      notify: (_id, t) => { deliveries.push(t); return true; }, delivered: () => {}, withoutConversation: () => {}, open: async () => false,
    };
    const now = Date.now;
    try {
      Date.now = () => T0;
      await new ReviewsPR(dir, ctx).poll();
      expect(deliveries).toEqual([]);          // el informe del bot de antes, no
      json = answer(5); json.data.prs.nodes[0].comments.nodes[0].id = 'I9';   // otro informe, nuevo
      await new ReviewsPR(dir, ctx).poll();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toContain('**informe-ci** (bot)');
    } finally { Date.now = now; }
  });

  it('sin conversación abierta, la retoma en el worktree de su tarea; sin worktree, avisa de que es raro', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    let json: any = answer(-60);
    const notices: string[] = [], openIn: [string, string, string][] = [], robots: [string, string][] = [];
    const withoutWorktree: RoomPR[] = ROOMS.map(s => ({ ...s, worktrees: [] }));
    let rooms = withoutWorktree;
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), query: async () => json, rooms: async () => rooms, sessions: () => [],
      notify: () => true, delivered: (s: string, w: string) => { robots.push([s, w]); }, withoutConversation: t => notices.push(t),
      open: async (roomId, cwd, t) => { openIn.push([roomId, cwd, t.split('\n')[0]]); return true; },
    };
    const r = new ReviewsPR(dir, ctx);
    const now = Date.now;
    try {
      Date.now = () => T0;
      await r.poll(); json = answer(5);
      await r.poll();
      expect(openIn).toEqual([]);
      expect(notices[0]).toContain('no hay ningún worktree de su tarea: es raro');
      rooms = ROOMS;
      await r.poll();
      expect(openIn).toEqual([['express', '/repos/express/.claude/worktrees/rutas', expect.stringContaining('[REF-212] Revisión nueva en tu PR #42')]]);
      expect(robots).toEqual([['express', '/repos/express/.claude/worktrees/rutas']]);
    } finally { Date.now = now; }
  });
});
