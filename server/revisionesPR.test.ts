import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewsOfGitHub, withoutNothingThatMake, remoteRepo, branchKey, sessionOfPR, reviewMessage, ReviewsPR, type RoomPR, type CtxReviews } from './revisionesPR.ts';
import type { SessionSummary } from '../shared/protocolo.ts';

const T0 = Date.parse('2026-11-10T10:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
// la respuesta de CONSULTA_REVISIONES, con gente y repos inventados
function respuesta(min = 5) {
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

const sesion = (o: Partial<SessionSummary>): SessionSummary => ({ id: 's', dwellerId: 'h', salaId: 'express', cwd: '/repos/express', estado: 'ociosa', sinLeer: false, titulo: '', pendientes: 0, ayudantes: [], herramientas: 0, turns: 0, created: 0, actualizada: 0, ...o });
const SALAS: RoomPR[] = [
  { id: 'express', nombre: 'Express', ruta: '/repos/express', rama: 'main', repo: 'refugio/express', worktrees: [
    { ruta: '/repos/express/.claude/worktrees/rutas', rama: 'feature/REF-212-barra-final' },
    { ruta: '/repos/express/.claude/worktrees/shelter-ref-212-pruebas-0abc', rama: 'worktree-shelter-ref-212-pruebas-0abc' },
  ] },
  { id: 'otro', nombre: 'Otro', ruta: '/repos/otro', rama: 'main', repo: 'refugio/otro', worktrees: [] },
];

describe('revisiones de PR', () => {
  it('se queda con lo de otros que pide algo, también de bots: sin aprobaciones vacías, hilos resueltos ni lo mío', () => {
    const { yo, prs } = reviewsOfGitHub(respuesta());
    expect(yo).toBe('yo-mismo');
    expect(prs[0]).toMatchObject({ numero: 42, repo: 'refugio/express', rama: 'feature/REF-212-barra-final' });
    expect(prs[0].eventos.map(e => e.id)).toEqual(['R1', 'R6', 'C1', 'I1', 'I2']);
    // el del bot, marcado y sin sus marcas HTML
    expect(prs[0].eventos.find(e => e.id === 'I1')).toMatchObject({ bot: true, cuerpo: 'CI failed: el checkout no carga' });
    expect(reviewMessage(prs[0], prs[0].eventos)).toContain('**informe-ci** (bot) ');
    expect(prs[0].eventos[2]).toMatchObject({ tipo: 'hilo', autor: 'ana-revisa', archivo: 'lib/router.js', linea: 12 });
  });

  it('un visto bueno o un agradecimiento no pide nada; una pregunta o un cambio, sí', () => {
    for (const t of ['', 'LGTM', 'lgtm!', 'Looks good to me 👍', ':shipit:', 'Thanks a lot!', 'Gracias, perfecto.', '🎉🎉', 'Nice work @ana-revisa', '+1']) expect(withoutNothingThatMake(t), t).toBe(true);
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
    const pr = { repo: 'refugio/express', rama: 'feature/REF-212-barra-final' };
    const inBranch = sesion({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas', actualizada: 1 });
    const ofTask = sesion({ id: 'tarea', worktree: '/repos/express/.claude/worktrees/shelter-ref-212-pruebas-0abc', actualizada: 9 });
    const otherRepo = sesion({ id: 'otro', salaId: 'otro', cwd: '/repos/otro', actualizada: 10 });
    expect(sessionOfPR(pr, SALAS, [ofTask, inBranch, otherRepo])?.sesion.id).toBe('rama');
    expect(sessionOfPR(pr, SALAS, [ofTask, otherRepo])?.sesion.id).toBe('tarea');
    expect(sessionOfPR(pr, SALAS, [{ ...inBranch, estado: 'cerrada' }, otherRepo])).toBeUndefined();
    // la carpeta principal de la sala, si está en la rama del PR
    expect(sessionOfPR({ ...pr, rama: 'main' }, SALAS, [sesion({ id: 'principal' })])?.sesion.id).toBe('principal');
  });

  it('el mensaje cita cada comentario y pide un plan antes de tocar nada', () => {
    const { prs } = reviewsOfGitHub(respuesta());
    const m = reviewMessage(prs[0], prs[0].eventos);
    expect(m).toContain('[REF-212] Revisión nueva en tu PR #42 de refugio/express');
    expect(m).toContain('**ana-revisa** pide cambios (u/r1)\n   > Falta una prueba.');
    expect(m).toContain('comenta en `lib/router.js:12`');
    expect(m).toContain('hasta que el Supervisor apruebe el plan');
  });

  it('la primera vez solo marca desde cuándo; luego entrega lo nuevo una vez, y sin conversación abre la del worktree de la tarea', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    let json: any = respuesta(-60), abiertas: SessionSummary[] = [], canOpen = false;
    const deliveries: [string, string][] = [], avisos: string[] = [], openIn: [string, string][] = [], robots: [string, string][] = [];
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), consultar: async () => json, salas: async () => SALAS, sesiones: () => abiertas,
      avisar: (id, t) => { deliveries.push([id, t]); return true; }, delivered: (s: string, w: string) => { robots.push([s, w]); }, withoutConversation: t => avisos.push(t),
      abrir: async (salaId, cwd) => { if (!canOpen) return false; openIn.push([salaId, cwd]); return true; },
    };
    const r = new ReviewsPR(dir, ctx);
    const ahora = Date.now;
    try {
      Date.now = () => T0;
      await r.sondear();                       // lo de antes de conectar no se manda
      json = respuesta(5);
      await r.sondear();                       // no se puede abrir la conversación (límite): un aviso, una sola vez
      await r.sondear();
      expect(deliveries).toEqual([]);
      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toContain('no he podido abrir la conversación de su worktree');
      abiertas = [sesion({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas' })];
      await r.sondear();                       // con la conversación abierta, le llega
      expect(deliveries.map(e => e[0])).toEqual(['rama']);
      expect(deliveries[0][1]).toContain('¿Esto entra en la versión 5?');
      expect(robots).toEqual([['express', '/repos/express/.claude/worktrees/rutas']]);   // el robot va al holograma de ese worktree
      await new ReviewsPR(dir, ctx).sondear();   // y no se repite (tampoco tras reiniciar)
      expect(deliveries).toHaveLength(1);
    } finally { Date.now = ahora; }
  });

  it('al empezar a entregar lo de bots, los que ya había no se mandan de golpe; los nuevos, sí', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    // un refugio de antes: ya miraba desde T0 - 60 min, sin bots
    writeFileSync(path.join(dir, 'revisiones-pr.json'), JSON.stringify({ desde: T0 - 120 * 60_000, seen: ['R1', 'R6', 'C1', 'I2'] }));
    let json: any = respuesta(-60);
    const deliveries: string[] = [];
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), consultar: async () => json, salas: async () => SALAS,
      sesiones: () => [sesion({ id: 'rama', worktree: '/repos/express/.claude/worktrees/rutas' })],
      avisar: (_id, t) => { deliveries.push(t); return true; }, delivered: () => {}, withoutConversation: () => {}, abrir: async () => false,
    };
    const ahora = Date.now;
    try {
      Date.now = () => T0;
      await new ReviewsPR(dir, ctx).sondear();
      expect(deliveries).toEqual([]);          // el informe del bot de antes, no
      json = respuesta(5); json.data.prs.nodes[0].comments.nodes[0].id = 'I9';   // otro informe, nuevo
      await new ReviewsPR(dir, ctx).sondear();
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toContain('**informe-ci** (bot)');
    } finally { Date.now = ahora; }
  });

  it('sin conversación abierta, la retoma en el worktree de su tarea; sin worktree, avisa de que es raro', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'revisiones-'));
    let json: any = respuesta(-60);
    const avisos: string[] = [], openIn: [string, string, string][] = [], robots: [string, string][] = [];
    const withoutWorktree: RoomPR[] = SALAS.map(s => ({ ...s, worktrees: [] }));
    let salas = withoutWorktree;
    const ctx: CtxReviews = {
      connection: async () => ({ real: true }), consultar: async () => json, salas: async () => salas, sesiones: () => [],
      avisar: () => true, delivered: (s: string, w: string) => { robots.push([s, w]); }, withoutConversation: t => avisos.push(t),
      abrir: async (salaId, cwd, t) => { openIn.push([salaId, cwd, t.split('\n')[0]]); return true; },
    };
    const r = new ReviewsPR(dir, ctx);
    const ahora = Date.now;
    try {
      Date.now = () => T0;
      await r.sondear(); json = respuesta(5);
      await r.sondear();
      expect(openIn).toEqual([]);
      expect(avisos[0]).toContain('no hay ningún worktree de su tarea: es raro');
      salas = SALAS;
      await r.sondear();
      expect(openIn).toEqual([['express', '/repos/express/.claude/worktrees/rutas', expect.stringContaining('[REF-212] Revisión nueva en tu PR #42')]]);
      expect(robots).toEqual([['express', '/repos/express/.claude/worktrees/rutas']]);
    } finally { Date.now = ahora; }
  });
});
