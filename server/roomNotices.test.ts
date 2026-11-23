import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendToRoom, requestCleanup, taskWorktree, forgetLimits, forgetThreads, type CtxRooms } from './roomNotices.ts';
import { infoRepo, worktreeList } from './repos.ts';
import { Scheduled } from './scheduled.ts';

const ROOMS = [
  { id: 'express', name: 'app-web', dweller: { id: 'remi', name: 'Remi' } },
  { id: 'pagos', name: 'pagos', dweller: { id: 'pilar', name: 'Pilar' } },
  { id: 'tareas', name: 'Logística', dweller: { id: 'ines', name: 'Inés' } },
  { id: 'vacia', name: 'vacía' },
];

// un contexto que apunta lo que se hace: avisos a conversaciones abiertas y conversaciones nuevas
function ctx(o: { openSessions?: Record<string, string>; closed?: Set<string>; worktrees?: Record<string, string>; fails?: string; timer?: { t: number }; noGit?: boolean; worktreeOfTask?: CtxRooms['worktreeOfTask']; busy?: Set<string>; previous?: Record<string, string> } = {}) {
  const notified: { sessionId: string; text: string }[] = [], fresh: { roomId: string; dwellerId: string; prompt: string; cwd?: string; worktree?: string }[] = [], messenger: string[][] = [], notices: string[] = [];
  const resumed: { roomId: string; cwd: string; prompt: string; id: string }[] = [], origins: unknown[] = [];
  const c: CtxRooms = {
    rooms: () => ROOMS,
    sessionOfTask: (roomId, key) => o.openSessions?.[`${roomId}/${key}`],
    worktreeOfTask: o.worktreeOfTask ?? (async (roomId, key) => o.worktrees?.[`${roomId}/${key}`]),
    notify: (sessionId, text, origin) => { if (o.closed?.has(sessionId)) return false; notified.push({ sessionId, text }); origins.push(origin); return true; },
    start: async (roomId, dwellerId, prompt, where) => { if (o.fails) throw new Error(o.fails); fresh.push({ roomId, dwellerId, prompt, cwd: where?.cwd, worktree: where?.worktree }); return { id: fresh.length > 1 ? `nueva-${fresh.length}` : 'nueva', inWorktree: !!(where?.cwd || (where?.worktree && !o.noGit)) }; },
    messenger: (since, a) => messenger.push([since, ...a]),
    notice: t => notices.push(t),
    now: o.timer && (() => o.timer!.t),
    busy: id => !!o.busy?.has(id),
    // previas: the last conversation in each folder (cwd → its resumed id)
    resume: async (roomId, cwd, prompt) => { const id = o.previous?.[cwd]; if (id) resumed.push({ roomId, cwd, prompt, id }); return id; },
  };
  return { c, notified, fresh, messenger, notices, resumed, origins };
}

describe('mensajes entre salas', () => {
  beforeEach(() => { forgetLimits(); forgetThreads(); });

  it('sin clave, una conversación nueva con el habitante en su copia principal, aunque tenga otra abierta', async () => {
    const x = ctx({ openSessions: { 'express/ABC-1': 'abierta' } });
    const r = await sendToRoom(x.c, 'tareas', { room: 'app-web', message: '  Investiga los saltos del bloqueo de LTD  ' });
    expect(r.ok).toBe(true);
    expect(x.notified).toEqual([]);
    expect(x.fresh).toHaveLength(1);
    expect(x.fresh[0]).toMatchObject({ roomId: 'express', dwellerId: 'remi', cwd: undefined });
    // de quién viene, el mensaje y cómo contestar
    expect(x.fresh[0].prompt).toContain('Logística');
    expect(x.fresh[0].prompt).toContain('Inés');
    expect(x.fresh[0].prompt).toContain('\nInvestiga los saltos del bloqueo de LTD\n');
    expect(x.fresh[0].prompt).toContain('tareas');
    expect(x.messenger).toEqual([['tareas', 'express']]);
    expect(x.notices[0]).toContain('Logística → app-web: Investiga los saltos');
  });

  it('con clave, a la conversación abierta de esa tarea en la sala', async () => {
    const x = ctx({ openSessions: { 'pagos/ABC-4375': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { room: 'pagos', key: 'abc-4375', message: 'El endpoint cambia de nombre' });
    expect(r.ok).toBe(true);
    expect(x.fresh).toEqual([]);
    expect(x.notified).toHaveLength(1);
    expect(x.notified[0].sessionId).toBe('ses-tarea');
    expect(x.notified[0].text).toContain('ABC-4375');
  });

  it('con clave y sin conversación abierta, una nueva en el worktree de la tarea; sin worktree, en uno nuevo con la clave', async () => {
    const x = ctx({ worktrees: { 'pagos/ABC-1': '/repos/pagos/.claude/worktrees/ABC-1' } });
    await sendToRoom(x.c, 'express', { room: 'pagos', key: 'ABC-1', message: 'a' });
    const r = await sendToRoom(x.c, 'tareas', { room: 'pagos', key: 'ABC-321', message: 'ABC-321 — Weekend bundle: open a PR\nmore' });
    expect(x.fresh[0]).toMatchObject({ cwd: '/repos/pagos/.claude/worktrees/ABC-1', worktree: undefined });
    expect(x.fresh[1].cwd).toBeUndefined();
    // la clave una sola vez y el asunto: así taskWorktree lo encuentra para los siguientes mensajes de la tarea
    expect(x.fresh[1].worktree).toMatch(/^shelter-abc-321-weekend-bundle-open[a-z0-9-]*-[0-9a-z]{4}$/);
    expect(taskWorktree([{ path: '/repos/pagos/.claude/worktrees/' + x.fresh[1].worktree, main: false } as any], 'ABC-321')).toBeDefined();
    expect(r.text).toContain('worktree nuevo');
  });

  it('con clave en una sala cuya carpeta no es un repo git: a su copia principal, y la respuesta lo dice', async () => {
    const x = ctx({ noGit: true });
    const r = await sendToRoom(x.c, 'express', { room: 'tareas', key: 'WS-1', message: 'Revisa el CI' });
    expect(r.ok).toBe(true);
    expect(x.fresh[0].worktree).toMatch(/^shelter-ws-1-/);
    expect(r.text).toContain('no es un repo git');
    expect(r.text).not.toContain('worktree nuevo');
  });

  it('sin clave, nunca un worktree', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'tareas', { room: 'pagos', message: 'Revisa el plan' });
    expect(x.fresh[0]).toMatchObject({ cwd: undefined, worktree: undefined });
  });

  it('dentro de la misma sala: con clave, al holograma de la tarea; sin robot mensajero, pero con aviso', async () => {
    const x = ctx({ worktrees: { 'express/ABC-9': '/repos/app-web/.claude/worktrees/abc-9' } });
    const r = await sendToRoom(x.c, 'express', { room: 'express', key: 'ABC-9', message: 'Añade los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.fresh).toEqual([expect.objectContaining({ roomId: 'express', dwellerId: 'remi', cwd: '/repos/app-web/.claude/worktrees/abc-9' })]);
    expect(x.messenger).toEqual([]);
    expect(x.notices[0]).toContain('app-web → app-web: Añade los avisos de CI');
    // sin clave, otra conversación en la copia principal de la sala
    const y = ctx();
    expect((await sendToRoom(y.c, 'express', { room: 'express', message: 'Revisa el README' }, 'ses-supervisor')).ok).toBe(true);
    expect(y.fresh[0]).toMatchObject({ roomId: 'express', cwd: undefined, worktree: undefined });
  });

  it('with a thread: one conversation per room and thread in the main copy, reused while open, never the sender; without one, always new', async () => {
    const closed = new Set<string>(), timer = { t: 1_000_000 };
    const x = ctx({ closed, timer, openSessions: { 'express/ABC-1': 'abierta' } });
    const r1 = await sendToRoom(x.c, 'express', { room: 'express', message: 'a', thread: 'Cleanup' }, 'holo-a');
    expect(r1.ok).toBe(true);
    expect(x.fresh).toEqual([expect.objectContaining({ roomId: 'express', cwd: undefined, worktree: undefined })]);
    expect(x.fresh[0].prompt).toContain('cleanup');
    const r2 = await sendToRoom(x.c, 'express', { room: 'express', message: 'b', thread: 'cleanup' }, 'holo-b');
    expect(r2.ok).toBe(true); expect(x.fresh).toHaveLength(1);
    expect(x.notified).toEqual([expect.objectContaining({ sessionId: 'nueva' })]);
    expect(r2.text).toContain('cleanup');
    // another room and another thread are other conversations
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'c', thread: 'cleanup' });
    await sendToRoom(x.c, 'express', { room: 'express', message: 'd', thread: 'deps' }, 'holo-a');
    expect(x.fresh).toHaveLength(3);
    // the thread's own conversation sending to it: a new one, which takes the thread over
    timer.t += 61_000;
    await sendToRoom(x.c, 'express', { room: 'express', message: 'e', thread: 'cleanup' }, 'nueva');
    expect(x.fresh).toHaveLength(4);
    await sendToRoom(x.c, 'express', { room: 'express', message: 'f', thread: 'cleanup' }, 'holo-f');
    expect(x.notified.at(-1)?.sessionId).toBe('nueva-4');
    // closed: the next one starts a new one, which becomes the thread's
    closed.add('nueva-4');
    await sendToRoom(x.c, 'express', { room: 'express', message: 'g', thread: 'cleanup' }, 'holo-g');
    expect(x.fresh).toHaveLength(5);
    timer.t += 61_000;
    await sendToRoom(x.c, 'express', { room: 'express', message: 'h', thread: 'cleanup' }, 'holo-h');
    expect(x.notified.at(-1)?.sessionId).toBe('nueva-5');
    // without key or thread, nothing changes: a new one each time
    await sendToRoom(x.c, 'express', { room: 'express', message: 'i' }, 'holo-i');
    expect(x.fresh).toHaveLength(6);
    // not with a key, and only slugs
    expect((await sendToRoom(x.c, 'pagos', { room: 'express', message: 'j', key: 'ABC-1', thread: 'cleanup' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'pagos', { room: 'express', message: 'j', thread: 'lo de ayer' })).ok).toBe(false);
  });

  it('without key or thread: the sender conversation\'s next messages to that room continue in the one that got the first, and replies come back to it', async () => {
    const closed = new Set<string>(), timer = { t: 1_000_000 };
    const x = ctx({ closed, timer });
    const r1 = await sendToRoom(x.c, 'express', { room: 'pagos', message: 'a' }, 'ses-a');
    expect(r1.text).toContain('conversación nueva');
    const r2 = await sendToRoom(x.c, 'express', { room: 'pagos', message: 'b' }, 'ses-a');
    expect(x.fresh).toHaveLength(1);
    expect(x.notified).toEqual([expect.objectContaining({ sessionId: 'nueva' })]);
    expect(r2.text).toContain('mensaje anterior');
    // the receiver replies to the sender's room: to the conversation that wrote, not a new one
    const r3 = await sendToRoom(x.c, 'pagos', { room: 'app-web', message: 'hecho' }, 'nueva');
    expect(x.notified.at(-1)?.sessionId).toBe('ses-a');
    expect(r3.text).toContain('te escribió');
    expect(x.fresh).toHaveLength(1);
    // another sender conversation, another room, or no sender conversation: new ones
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'c' }, 'ses-b');
    await sendToRoom(x.c, 'express', { room: 'tareas', message: 'd' }, 'ses-a');
    await sendToRoom(x.c, 'tareas', { room: 'pagos', message: 'e' });
    expect(x.fresh).toHaveLength(4);
    // a key or a thread keep their own routing
    timer.t += 61_000;
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'f', key: 'ABC-2' }, 'ses-a');
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'g', thread: 'deps' }, 'ses-a');
    expect(x.fresh).toHaveLength(6);
    // closed: a new one, which the next messages then follow
    closed.add('nueva');
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'h' }, 'ses-a');
    expect(x.fresh).toHaveLength(7);
    timer.t += 61_000;
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'i' }, 'ses-a');
    expect(x.notified.at(-1)?.sessionId).toBe('nueva-7');
  });

  it('same room without key: never the sender\'s own conversation', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'express', { room: 'express', message: 'a' }, 'holo-a');
    // the new conversation writing back to its room: to holo-a, and holo-a's next one to the new one
    await sendToRoom(x.c, 'express', { room: 'express', message: 'b' }, 'nueva');
    expect(x.notified).toEqual([expect.objectContaining({ sessionId: 'holo-a' })]);
    await sendToRoom(x.c, 'express', { room: 'express', message: 'c' }, 'holo-a');
    expect(x.notified.at(-1)?.sessionId).toBe('nueva');
    expect(x.fresh).toHaveLength(1);
  });

  it('without key, from a conversation in a task worktree to another room: that room\'s conversation or worktree for the task', async () => {
    const x = ctx({ openSessions: { 'pagos/ABC-7': 'pagos-abc7' }, worktrees: { 'tareas/ABC-7': '/repos/tareas/.claude/worktrees/shelter-abc-7-x-1a2b' } });
    x.c.worktreeOfSession = async (_room, sess) => sess === 'holo-abc7' ? { path: '/repos/app-web/.claude/worktrees/shelter-abc-7-bundle-9z9z', branch: 'worktree-shelter-abc-7-bundle-9z9z', local: false } : undefined;
    // its open conversation there, framed as the task's, and the answer says where the key came from
    const r1 = await sendToRoom(x.c, 'express', { room: 'pagos', message: 'a' }, 'holo-abc7');
    expect(x.notified).toEqual([expect.objectContaining({ sessionId: 'pagos-abc7' })]);
    expect(x.notified[0].text).toContain('tarea ABC-7');
    expect(r1.text).toContain('ABC-7');
    expect(r1.text).toContain('Sin key');
    // none open: its worktree there
    await sendToRoom(x.c, 'express', { room: 'tareas', message: 'b' }, 'holo-abc7');
    expect(x.fresh[0]).toMatchObject({ roomId: 'tareas', cwd: '/repos/tareas/.claude/worktrees/shelter-abc-7-x-1a2b' });
    // a room without the task: its main copy, never a new worktree
    const y = ctx();
    y.c.worktreeOfSession = x.c.worktreeOfSession;
    const r2 = await sendToRoom(y.c, 'express', { room: 'pagos', message: 'c' }, 'holo-abc7');
    expect(y.fresh[0]).toMatchObject({ cwd: undefined, worktree: undefined });
    expect(r2.text).not.toContain('Sin key');
  });

  it('without key, a reply still goes to the conversation that wrote; the same room and a main-copy sender are unchanged', async () => {
    const x = ctx({ openSessions: { 'pagos/ABC-7': 'pagos-abc7', 'express/ABC-7': 'holo-abc7' } });
    x.c.worktreeOfSession = async (_room, sess) => sess === 'holo-abc7' ? { path: '/repos/app-web/.claude/worktrees/shelter-abc-7-bundle-9z9z', branch: 'worktree-shelter-abc-7-bundle-9z9z', local: false } : undefined;
    // pagos' main copy asks the task worktree, which answers without key: back to the asker, not to pagos' ABC-7
    await sendToRoom(x.c, 'pagos', { room: 'app-web', message: 'question', key: 'ABC-7' }, 'pagos-main');
    const r = await sendToRoom(x.c, 'express', { room: 'pagos', message: 'answer' }, 'holo-abc7');
    expect(x.notified.at(-1)).toMatchObject({ sessionId: 'pagos-main' });
    expect(x.notified.at(-1)?.text).not.toContain('ABC-7');
    expect(r.text).toContain('te escribió');
    // to its own room, where the task's open conversation is itself: a new conversation in the main copy, as before
    const n = x.fresh.length;
    await sendToRoom(x.c, 'express', { room: 'express', message: 'b' }, 'holo-abc7');
    expect(x.fresh.slice(n)).toEqual([expect.objectContaining({ roomId: 'express', cwd: undefined, worktree: undefined })]);
    // from a main copy: a new conversation in the main copy
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'c' }, 'ses-principal');
    expect(x.fresh.at(-1)).toMatchObject({ roomId: 'pagos', cwd: undefined, worktree: undefined });
  });

  it('without key, from a task worktree to its own room: the task\'s open conversation when it is another one', async () => {
    const x = ctx({ openSessions: { 'express/ABC-7': 'holo-abc7' } });
    x.c.worktreeOfSession = async (_room, sess) => ['holo-abc7', 'holo-otra'].includes(sess) ? { path: '/repos/app-web/.claude/worktrees/shelter-abc-7-bundle-9z9z', branch: 'worktree-shelter-abc-7-bundle-9z9z', local: false } : undefined;
    const r = await sendToRoom(x.c, 'express', { room: 'express', message: 'a' }, 'holo-otra');
    expect(r.ok).toBe(true);
    expect(x.notified).toEqual([expect.objectContaining({ sessionId: 'holo-abc7' })]);
    expect(x.notified[0].text).toContain('tarea ABC-7');
    expect(r.text).toContain('Sin key');
    expect(x.fresh).toEqual([]);
  });

  it('request_worktree_cleanup: the game writes the request from the sender\'s worktree and sends it through its room\'s cleanup thread', async () => {
    const x = ctx();
    x.c.worktreeOfSession = async (_room, sess) => sess === 'holo-a' ? { path: '/repos/app-web/.claude/worktrees/a', branch: 'worktree-a', local: true }
      : sess === 'holo-b' ? { path: '/repos/app-web/.claude/worktrees/b', branch: 'worktree-b', local: false } : undefined;
    expect((await requestCleanup(x.c, 'express', 'ses-principal')).ok).toBe(false);
    const r = await requestCleanup(x.c, 'express', 'holo-a', 'PR #12 merged');
    expect(r.ok).toBe(true);
    expect(x.fresh[0]).toMatchObject({ roomId: 'express', cwd: undefined, worktree: undefined });
    expect(x.fresh[0].prompt).toContain('/repos/app-web/.claude/worktrees/a');
    expect(x.fresh[0].prompt).toContain('`local`');
    expect(x.fresh[0].prompt).toContain('PR #12 merged');
    await requestCleanup(x.c, 'express', 'holo-b');
    expect(x.fresh).toHaveLength(1);
    expect(x.notified[0]).toMatchObject({ sessionId: 'nueva' });
    expect(x.notified[0].text).toContain('worktree-b');
    expect(x.notified[0].text).not.toContain('`local`');
  });

  it('nunca a la propia conversación: la que envía ya es la de esa tarea', async () => {
    const x = ctx({ openSessions: { 'express/ABC-9': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { room: 'express', key: 'ABC-9', message: 'a' }, 'ses-tarea');
    expect(r.ok).toBe(false); expect(r.text).toContain('ABC-9');
    expect(x.notified).toEqual([]);
    // otra conversación de la misma sala sí se la pasa a la de la tarea
    expect((await sendToRoom(x.c, 'express', { room: 'express', key: 'ABC-9', message: 'a' }, 'ses-supervisor')).ok).toBe(true);
    expect(x.notified[0].sessionId).toBe('ses-tarea');
  });

  it('with a key and its conversation busy: queued in it, framed as an outside request, and the answer says so', async () => {
    const busy = new Set(['ses-tarea']);
    const x = ctx({ openSessions: { 'pagos/ABC-7': 'ses-tarea' }, busy });
    const r = await sendToRoom(x.c, 'express', { room: 'pagos', key: 'ABC-7', message: '¿Qué versión del contrato usas?' }, 'ses-express');
    expect(r.ok).toBe(true);
    expect(r.text).toContain('en cola');
    expect(x.fresh).toEqual([]);
    expect(x.notified).toEqual([{ sessionId: 'ses-tarea', text: expect.stringContaining('¿Qué versión del contrato usas?') }]);
    expect(x.notified[0].text).toContain('fuera de lo que estás haciendo');
    // the receiver's queue shows who sent it
    expect(x.origins).toEqual([{ kind: 'room', roomId: 'express', room: 'app-web', dweller: 'Remi' }]);
    // the next one too, to the same conversation; once idle, no longer «queued»
    await sendToRoom(x.c, 'express', { room: 'pagos', key: 'ABC-7', message: 'aprobado' }, 'ses-express');
    busy.clear();
    const r3 = await sendToRoom(x.c, 'tareas', { room: 'pagos', key: 'ABC-7', message: 'otra cosa' });
    expect(r3.text).not.toContain('en cola');
    expect(x.notified.map(a => a.sessionId)).toEqual(['ses-tarea', 'ses-tarea', 'ses-tarea']);
    // its reply without a key goes back to the sender conversation
    await sendToRoom(x.c, 'pagos', { room: 'express', message: 'Uso la v1' }, 'ses-tarea');
    expect(x.notified.at(-1)!.sessionId).toBe('ses-express');
  });

  it('with a key and none open: the last conversation in the task\'s worktree, resumed; with none there, a new one in it', async () => {
    const wt = '/repos/pagos/.claude/worktrees/ABC-5';
    const x = ctx({ worktrees: { 'pagos/ABC-5': wt, 'pagos/ABC-6': '/repos/pagos/.claude/worktrees/ABC-6' }, previous: { [wt]: 'retomada' } });
    const r = await sendToRoom(x.c, 'express', { room: 'pagos', key: 'ABC-5', message: 'Rebase sobre main' }, 'ses-express');
    expect(r.text).toContain('retomando su última conversación');
    expect(x.resumed).toEqual([{ roomId: 'pagos', cwd: wt, prompt: expect.stringContaining('Rebase sobre main'), id: 'retomada' }]);
    expect(x.resumed[0].prompt).toContain('fuera de lo que estás haciendo');
    expect(x.fresh).toEqual([]);
    // its replies come back to the sender
    await sendToRoom(x.c, 'pagos', { room: 'express', message: 'hecho' }, 'retomada');
    expect(x.notified.at(-1)!.sessionId).toBe('ses-express');
    await sendToRoom(x.c, 'express', { room: 'pagos', key: 'ABC-6', message: 'a' });
    expect(x.fresh[0]).toMatchObject({ cwd: '/repos/pagos/.claude/worktrees/ABC-6' });
  });

  it('only task messages are framed as outside requests', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'express', { room: 'pagos', message: 'a' });
    expect(x.fresh[0].prompt).not.toContain('fuera de lo que estás haciendo');
  });

  it('with a descriptive slug key: kept as written, a new worktree named after it alone, found again by exact key', async () => {
    const x = ctx({ openSessions: { 'pagos/preflight-popover': 'ses-slug' } });
    await sendToRoom(x.c, 'express', { room: 'pagos', key: 'preflight-popover', message: 'a' });
    expect(x.notified[0].sessionId).toBe('ses-slug');
    expect(x.notified[0].text).toContain('preflight-popover');
    const r = await sendToRoom(x.c, 'tareas', { room: 'pagos', key: 'Holo-Front-Edge', message: 'Fix the hologram front edge' });
    expect(r.ok).toBe(true);
    expect(x.fresh[0].worktree).toMatch(/^shelter-holo-front-edge--[0-9a-z]{4}$/);
    const wts = [{ path: '/repos/pagos/.claude/worktrees/' + x.fresh[0].worktree, branch: 'worktree-' + x.fresh[0].worktree, main: false } as any];
    expect(taskWorktree(wts, 'holo-front-edge')).toBeDefined();
    expect(taskWorktree(wts, 'front-edge')).toBeUndefined();
    expect(taskWorktree(wts, 'holo')).toBeUndefined();
  });

  it('rechaza una sala que no existe (con la lista), una sin habitante y una clave que no lo es', async () => {
    const x = ctx();
    const r = await sendToRoom(x.c, 'express', { room: 'nada', message: 'a' });
    expect(r.ok).toBe(false); expect(r.text).toContain('pagos (pagos)');
    expect((await sendToRoom(x.c, 'express', { room: 'vacia', message: 'a' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { room: 'pagos', key: 'lo de ayer', message: 'a' })).ok).toBe(false);
    expect(x.fresh).toEqual([]);
  });

  it('como mucho 3 por minuto de una sala a otra; los que fallan no cuentan', async () => {
    const timer = { t: 1_000_000 };
    const fail = ctx({ fails: 'Ya hay 4 sesiones vivas', timer });
    const e = await sendToRoom(fail.c, 'express', { room: 'pagos', message: 'x' });
    expect(e.ok).toBe(false); expect(e.text).toContain('Ya hay 4 sesiones vivas');
    const x = ctx({ timer });
    for (let i = 0; i < 3; i++) expect((await sendToRoom(x.c, 'express', { room: 'pagos', message: 'x' })).ok).toBe(true);
    expect((await sendToRoom(x.c, 'express', { room: 'pagos', message: 'x' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { room: 'tareas', message: 'x' })).ok).toBe(true);   // otra sala, otra cuenta
    timer.t += 61_000;
    expect((await sendToRoom(x.c, 'express', { room: 'pagos', message: 'x' })).ok).toBe(true);
    expect(x.fresh).toHaveLength(5);
  });

  it('con clave, al worktree que otra conversación acaba de crear (leído de git al momento), no a la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'main'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    // como main.ts: la lista de worktrees de la carpeta de la sala en cada mensaje
    const x = ctx({ worktreeOfTask: async (_room, key) => taskWorktree(await worktreeList(dir), key) });
    const wt = path.join(path.dirname(dir), path.basename(dir) + '-ws-ci-idioma');
    g('worktree', 'add', '-b', 'ws-1-ci-idioma', wt);
    const r = await sendToRoom(x.c, 'express', { room: 'express', key: 'WS-1', message: 'Traduce los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.fresh[0]).toMatchObject({ cwd: wt, worktree: undefined });
    expect(r.text).toContain('worktree de WS-1');
  }, 30_000);

  it('encuentra el worktree de la tarea en los de un repo de verdad (por su rama), nunca la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'feature/ABC-9-principal'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    const wt = path.join(dir, '.claude', 'worktrees', 'otra-carpeta');
    g('worktree', 'add', '-b', 'feature/ABC-4375-tax-coverage', wt);
    const info = await infoRepo(dir);
    expect(taskWorktree(info.worktrees, 'abc-4375')).toBe(wt);
    expect(taskWorktree(info.worktrees, 'ABC-9')).toBeUndefined();
    expect(taskWorktree(info.worktrees, 'ABC-1')).toBeUndefined();
  }, 30_000);
});

describe('over the per-minute limit', () => {
  beforeEach(() => { forgetLimits(); forgetThreads(); });
  // the real scheduled messages, delivering through sendToRoom like main.ts
  function withScheduled(timer: { t: number }) {
    const x = ctx({ timer }), notices: string[] = [];
    const p = new Scheduled(mkdtempSync(path.join(tmpdir(), 'limite-')), {
      session: () => undefined, rooms: () => ROOMS,
      toConversation: async () => { throw new Error('no'); },
      toRoom: (m, text) => sendToRoom(x.c, m.origin.roomId, { room: m.target.room, key: m.target.key, thread: m.target.thread, message: text }, m.origin.sessionId, { scheduled: true }),
      changed: () => {}, notice: t => notices.push(t), now: () => timer.t,
    });
    x.c.scheduled = { schedule: (...a) => p.schedule(...a), ofConversation: id => p.ofConversation(id), cancel: (id, s) => p.cancel(id, s), defer: (...a) => p.defer(...a), overLimit: (...a) => p.overLimit(...a) };
    return { ...x, p, notices };
  }

  it('is scheduled for when the window frees up, in order and spaced, and goes out as if sent then', async () => {
    const t0 = 1_000_000, timer = { t: t0 }, x = withScheduled(timer);
    const rs = [];
    for (let i = 1; i <= 7; i++) rs.push(await sendToRoom(x.c, 'tareas', { room: 'pagos', key: `ABC-${i}`, message: `Task ${i}` }, 'yo'));
    expect(rs.every(r => r.ok)).toBe(true);
    expect(x.fresh.map(f => f.prompt.includes('Task 1') || f.prompt.includes('Task 2') || f.prompt.includes('Task 3'))).toEqual([true, true, true]);
    const l = x.p.list();
    expect(rs[3].text).toContain(l[0].id);
    expect(l.map(m => [m.message, m.when - t0, m.target])).toEqual([
      ['Task 4', 60_000, { type: 'sala', room: 'pagos', key: 'ABC-4' }], ['Task 5', 60_000, { type: 'sala', room: 'pagos', key: 'ABC-5' }],
      ['Task 6', 60_000, { type: 'sala', room: 'pagos', key: 'ABC-6' }], ['Task 7', 120_000, { type: 'sala', room: 'pagos', key: 'ABC-7' }],
    ]);
    // while some wait, a new one queues behind them even with room in the window
    timer.t = t0 + 60_000;
    await x.p.sweep();
    expect(x.fresh.slice(3).map(f => f.prompt.split('\n')[2])).toEqual(['Task 4', 'Task 5', 'Task 6']);
    expect(x.fresh[3].prompt).toContain('Logística');
    expect(x.fresh[3].prompt).not.toContain('⏰');
    const r = await sendToRoom(x.c, 'tareas', { room: 'pagos', message: 'Then this', thread: 'deps' }, 'yo');
    expect(r.ok).toBe(true);
    expect(x.p.list().map(m => [m.message, m.when - t0])).toEqual([['Task 7', 120_000], ['Then this', 120_000]]);
    expect(x.p.list()[1].target).toEqual({ type: 'sala', room: 'pagos', thread: 'deps' });
    // swept early (over the limit still): kept, without a warning
    timer.t = t0 + 119_000;
    x.p['items'].forEach(m => { m.when = timer.t; });
    await x.p.sweep();
    expect(x.p.list()).toHaveLength(2);
    expect(x.notices).toEqual([]);
    timer.t = t0 + 120_000;
    await x.p.sweep();
    expect(x.fresh.slice(6).map(f => f.prompt.split('\n')[2])).toEqual(['Task 7', 'Then this']);
    expect(x.p.list()).toEqual([]);
    // nothing waiting: straight away again
    timer.t = t0 + 200_000;
    expect(await sendToRoom(x.c, 'tareas', { room: 'pagos', message: 'Now' }, 'yo')).toMatchObject({ ok: true });
    expect(x.p.list()).toEqual([]);
    expect(x.fresh.at(-1)!.prompt).toContain('\nNow\n');
  });

  it("with the conversation's scheduled list full, today's error", async () => {
    const timer = { t: 1_000_000 }, x = withScheduled(timer);
    for (let i = 0; i < 10; i++) x.p.defer('tareas', 'yo', { room: 'express', message: 'x' }, timer.t + 3_600_000);
    for (let i = 0; i < 3; i++) expect((await sendToRoom(x.c, 'tareas', { room: 'pagos', message: `m${i}` }, 'yo')).ok).toBe(true);
    const r = await sendToRoom(x.c, 'tareas', { room: 'pagos', message: 'one too many' }, 'yo');
    expect(r).toMatchObject({ ok: false, limited: true });
    expect(x.p.list()).toHaveLength(10);
  });
});
