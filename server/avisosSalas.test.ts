import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendToRoom, requestCleanup, taskWorktree, forgetLimits, forgetThreads, type CtxRooms } from './avisosSalas.ts';
import { infoRepo, worktreeList } from './repos.ts';

const SALAS = [
  { id: 'express', nombre: 'app-web', habitante: { id: 'remi', nombre: 'Remi' } },
  { id: 'pagos', nombre: 'pagos', habitante: { id: 'pilar', nombre: 'Pilar' } },
  { id: 'tareas', nombre: 'Logística', habitante: { id: 'ines', nombre: 'Inés' } },
  { id: 'vacia', nombre: 'vacía' },
];

// un contexto que apunta lo que se hace: avisos a conversaciones abiertas y conversaciones nuevas
function ctx(o: { abiertas?: Record<string, string>; cerradas?: Set<string>; worktrees?: Record<string, string>; falla?: string; reloj?: { t: number }; sinGit?: boolean; worktreeDeTarea?: CtxRooms['worktreeDeTarea']; ocupadas?: Set<string>; forkFalla?: string; previas?: Record<string, string> } = {}) {
  const avisados: { sesionId: string; texto: string }[] = [], nuevas: { salaId: string; dwellerId: string; prompt: string; cwd?: string; worktree?: string }[] = [], mensajero: string[][] = [], avisos: string[] = [];
  const forks: { salaId: string; de: string; prompt: string }[] = [], retomadas: { salaId: string; cwd: string; prompt: string; id: string }[] = [];
  const c: CtxRooms = {
    salas: () => SALAS,
    sesionDeTarea: (salaId, clave) => o.abiertas?.[`${salaId}/${clave}`],
    worktreeDeTarea: o.worktreeDeTarea ?? (async (salaId, clave) => o.worktrees?.[`${salaId}/${clave}`]),
    avisar: (sesionId, texto) => { if (o.cerradas?.has(sesionId)) return false; avisados.push({ sesionId, texto }); return true; },
    empezar: async (salaId, dwellerId, prompt, donde) => { if (o.falla) throw new Error(o.falla); nuevas.push({ salaId, dwellerId, prompt, cwd: donde?.cwd, worktree: donde?.worktree }); return { id: nuevas.length > 1 ? `nueva-${nuevas.length}` : 'nueva', enWorktree: !!(donde?.cwd || (donde?.worktree && !o.sinGit)) }; },
    mensajero: (desde, a) => mensajero.push([desde, ...a]),
    aviso: t => avisos.push(t),
    ahora: o.reloj && (() => o.reloj!.t),
    ocupada: id => !!o.ocupadas?.has(id),
    bifurcar: async (salaId, de, prompt) => { if (o.forkFalla) throw new Error(o.forkFalla); forks.push({ salaId, de, prompt }); return `fork-${forks.length}`; },
    // previas: the last conversation in each folder (cwd → its resumed id)
    retomar: async (salaId, cwd, prompt) => { const id = o.previas?.[cwd]; if (id) retomadas.push({ salaId, cwd, prompt, id }); return id; },
  };
  return { c, avisados, nuevas, mensajero, avisos, forks, retomadas };
}

describe('mensajes entre salas', () => {
  beforeEach(() => { forgetLimits(); forgetThreads(); });

  it('sin clave, una conversación nueva con el habitante en su copia principal, aunque tenga otra abierta', async () => {
    const x = ctx({ abiertas: { 'express/ABC-1': 'abierta' } });
    const r = await sendToRoom(x.c, 'tareas', { sala: 'app-web', mensaje: '  Investiga los saltos del bloqueo de LTD  ' });
    expect(r.ok).toBe(true);
    expect(x.avisados).toEqual([]);
    expect(x.nuevas).toHaveLength(1);
    expect(x.nuevas[0]).toMatchObject({ salaId: 'express', dwellerId: 'remi', cwd: undefined });
    // de quién viene, el mensaje y cómo contestar
    expect(x.nuevas[0].prompt).toContain('Logística');
    expect(x.nuevas[0].prompt).toContain('Inés');
    expect(x.nuevas[0].prompt).toContain('\nInvestiga los saltos del bloqueo de LTD\n');
    expect(x.nuevas[0].prompt).toContain('tareas');
    expect(x.mensajero).toEqual([['tareas', 'express']]);
    expect(x.avisos[0]).toContain('Logística → app-web: Investiga los saltos');
  });

  it('con clave, a la conversación abierta de esa tarea en la sala', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-4375': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'abc-4375', mensaje: 'El endpoint cambia de nombre' });
    expect(r.ok).toBe(true);
    expect(x.nuevas).toEqual([]);
    expect(x.avisados).toHaveLength(1);
    expect(x.avisados[0].sesionId).toBe('ses-tarea');
    expect(x.avisados[0].texto).toContain('ABC-4375');
  });

  it('con clave y sin conversación abierta, una nueva en el worktree de la tarea; sin worktree, en uno nuevo con la clave', async () => {
    const x = ctx({ worktrees: { 'pagos/ABC-1': '/repos/pagos/.claude/worktrees/ABC-1' } });
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-1', mensaje: 'a' });
    const r = await sendToRoom(x.c, 'tareas', { sala: 'pagos', clave: 'ABC-321', mensaje: 'ABC-321 — Weekend bundle: open a PR\nmore' });
    expect(x.nuevas[0]).toMatchObject({ cwd: '/repos/pagos/.claude/worktrees/ABC-1', worktree: undefined });
    expect(x.nuevas[1].cwd).toBeUndefined();
    // la clave una sola vez y el asunto: así taskWorktree lo encuentra para los siguientes mensajes de la tarea
    expect(x.nuevas[1].worktree).toMatch(/^shelter-abc-321-weekend-bundle-open[a-z0-9-]*-[0-9a-z]{4}$/);
    expect(taskWorktree([{ ruta: '/repos/pagos/.claude/worktrees/' + x.nuevas[1].worktree, principal: false } as any], 'ABC-321')).toBeDefined();
    expect(r.texto).toContain('worktree nuevo');
  });

  it('con clave en una sala cuya carpeta no es un repo git: a su copia principal, y la respuesta lo dice', async () => {
    const x = ctx({ sinGit: true });
    const r = await sendToRoom(x.c, 'express', { sala: 'tareas', clave: 'WS-1', mensaje: 'Revisa el CI' });
    expect(r.ok).toBe(true);
    expect(x.nuevas[0].worktree).toMatch(/^shelter-ws-1-/);
    expect(r.texto).toContain('no es un repo git');
    expect(r.texto).not.toContain('worktree nuevo');
  });

  it('sin clave, nunca un worktree', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'tareas', { sala: 'pagos', mensaje: 'Revisa el plan' });
    expect(x.nuevas[0]).toMatchObject({ cwd: undefined, worktree: undefined });
  });

  it('dentro de la misma sala: con clave, al holograma de la tarea; sin robot mensajero, pero con aviso', async () => {
    const x = ctx({ worktrees: { 'express/ABC-9': '/repos/app-web/.claude/worktrees/abc-9' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'Añade los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.nuevas).toEqual([expect.objectContaining({ salaId: 'express', dwellerId: 'remi', cwd: '/repos/app-web/.claude/worktrees/abc-9' })]);
    expect(x.mensajero).toEqual([]);
    expect(x.avisos[0]).toContain('app-web → app-web: Añade los avisos de CI');
    // sin clave, otra conversación en la copia principal de la sala
    const y = ctx();
    expect((await sendToRoom(y.c, 'express', { sala: 'express', mensaje: 'Revisa el README' }, 'ses-supervisor')).ok).toBe(true);
    expect(y.nuevas[0]).toMatchObject({ salaId: 'express', cwd: undefined, worktree: undefined });
  });

  it('with a thread: one conversation per room and thread in the main copy, reused while open, never the sender; without one, always new', async () => {
    const cerradas = new Set<string>(), reloj = { t: 1_000_000 };
    const x = ctx({ cerradas, reloj, abiertas: { 'express/ABC-1': 'abierta' } });
    const r1 = await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'a', hilo: 'Cleanup' }, 'holo-a');
    expect(r1.ok).toBe(true);
    expect(x.nuevas).toEqual([expect.objectContaining({ salaId: 'express', cwd: undefined, worktree: undefined })]);
    expect(x.nuevas[0].prompt).toContain('cleanup');
    const r2 = await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'b', hilo: 'cleanup' }, 'holo-b');
    expect(r2.ok).toBe(true); expect(x.nuevas).toHaveLength(1);
    expect(x.avisados).toEqual([expect.objectContaining({ sesionId: 'nueva' })]);
    expect(r2.texto).toContain('cleanup');
    // another room and another thread are other conversations
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'c', hilo: 'cleanup' });
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'd', hilo: 'deps' }, 'holo-a');
    expect(x.nuevas).toHaveLength(3);
    // the thread's own conversation sending to it: a new one, which takes the thread over
    reloj.t += 61_000;
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'e', hilo: 'cleanup' }, 'nueva');
    expect(x.nuevas).toHaveLength(4);
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'f', hilo: 'cleanup' }, 'holo-f');
    expect(x.avisados.at(-1)?.sesionId).toBe('nueva-4');
    // closed: the next one starts a new one, which becomes the thread's
    cerradas.add('nueva-4');
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'g', hilo: 'cleanup' }, 'holo-g');
    expect(x.nuevas).toHaveLength(5);
    reloj.t += 61_000;
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'h', hilo: 'cleanup' }, 'holo-h');
    expect(x.avisados.at(-1)?.sesionId).toBe('nueva-5');
    // without key or thread, nothing changes: a new one each time
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'i' }, 'holo-i');
    expect(x.nuevas).toHaveLength(6);
    // not with a key, and only slugs
    expect((await sendToRoom(x.c, 'pagos', { sala: 'express', mensaje: 'j', clave: 'ABC-1', hilo: 'cleanup' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'pagos', { sala: 'express', mensaje: 'j', hilo: 'lo de ayer' })).ok).toBe(false);
  });

  it('without key or thread: the sender conversation\'s next messages to that room continue in the one that got the first, and replies come back to it', async () => {
    const cerradas = new Set<string>(), reloj = { t: 1_000_000 };
    const x = ctx({ cerradas, reloj });
    const r1 = await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'a' }, 'ses-a');
    expect(r1.texto).toContain('conversación nueva');
    const r2 = await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'b' }, 'ses-a');
    expect(x.nuevas).toHaveLength(1);
    expect(x.avisados).toEqual([expect.objectContaining({ sesionId: 'nueva' })]);
    expect(r2.texto).toContain('mensaje anterior');
    // the receiver replies to the sender's room: to the conversation that wrote, not a new one
    const r3 = await sendToRoom(x.c, 'pagos', { sala: 'app-web', mensaje: 'hecho' }, 'nueva');
    expect(x.avisados.at(-1)?.sesionId).toBe('ses-a');
    expect(r3.texto).toContain('te escribió');
    expect(x.nuevas).toHaveLength(1);
    // another sender conversation, another room, or no sender conversation: new ones
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'c' }, 'ses-b');
    await sendToRoom(x.c, 'express', { sala: 'tareas', mensaje: 'd' }, 'ses-a');
    await sendToRoom(x.c, 'tareas', { sala: 'pagos', mensaje: 'e' });
    expect(x.nuevas).toHaveLength(4);
    // a key or a thread keep their own routing
    reloj.t += 61_000;
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'f', clave: 'ABC-2' }, 'ses-a');
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'g', hilo: 'deps' }, 'ses-a');
    expect(x.nuevas).toHaveLength(6);
    // closed: a new one, which the next messages then follow
    cerradas.add('nueva');
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'h' }, 'ses-a');
    expect(x.nuevas).toHaveLength(7);
    reloj.t += 61_000;
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'i' }, 'ses-a');
    expect(x.avisados.at(-1)?.sesionId).toBe('nueva-7');
  });

  it('same room without key: never the sender\'s own conversation', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'a' }, 'holo-a');
    // the new conversation writing back to its room: to holo-a, and holo-a's next one to the new one
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'b' }, 'nueva');
    expect(x.avisados).toEqual([expect.objectContaining({ sesionId: 'holo-a' })]);
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'c' }, 'holo-a');
    expect(x.avisados.at(-1)?.sesionId).toBe('nueva');
    expect(x.nuevas).toHaveLength(1);
  });

  it('without key, from a conversation in a task worktree to another room: that room\'s conversation or worktree for the task', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-7': 'pagos-abc7' }, worktrees: { 'tareas/ABC-7': '/repos/tareas/.claude/worktrees/shelter-abc-7-x-1a2b' } });
    x.c.worktreeDeSesion = async (_sala, ses) => ses === 'holo-abc7' ? { ruta: '/repos/app-web/.claude/worktrees/shelter-abc-7-bundle-9z9z', rama: 'worktree-shelter-abc-7-bundle-9z9z', local: false } : undefined;
    // its open conversation there, framed as the task's, and the answer says where the key came from
    const r1 = await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'a' }, 'holo-abc7');
    expect(x.avisados).toEqual([expect.objectContaining({ sesionId: 'pagos-abc7' })]);
    expect(x.avisados[0].texto).toContain('tarea ABC-7');
    expect(r1.texto).toContain('ABC-7');
    expect(r1.texto).toContain('Sin key');
    // none open: its worktree there
    await sendToRoom(x.c, 'express', { sala: 'tareas', mensaje: 'b' }, 'holo-abc7');
    expect(x.nuevas[0]).toMatchObject({ salaId: 'tareas', cwd: '/repos/tareas/.claude/worktrees/shelter-abc-7-x-1a2b' });
    // a room without the task: its main copy, never a new worktree
    const y = ctx();
    y.c.worktreeDeSesion = x.c.worktreeDeSesion;
    const r2 = await sendToRoom(y.c, 'express', { sala: 'pagos', mensaje: 'c' }, 'holo-abc7');
    expect(y.nuevas[0]).toMatchObject({ cwd: undefined, worktree: undefined });
    expect(r2.texto).not.toContain('Sin key');
  });

  it('without key, a reply still goes to the conversation that wrote; the same room and a main-copy sender are unchanged', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-7': 'pagos-abc7', 'express/ABC-7': 'holo-abc7' } });
    x.c.worktreeDeSesion = async (_sala, ses) => ses === 'holo-abc7' ? { ruta: '/repos/app-web/.claude/worktrees/shelter-abc-7-bundle-9z9z', rama: 'worktree-shelter-abc-7-bundle-9z9z', local: false } : undefined;
    // pagos' main copy asks the task worktree, which answers without key: back to the asker, not to pagos' ABC-7
    await sendToRoom(x.c, 'pagos', { sala: 'app-web', mensaje: 'question', clave: 'ABC-7' }, 'pagos-main');
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'answer' }, 'holo-abc7');
    expect(x.avisados.at(-1)).toMatchObject({ sesionId: 'pagos-main' });
    expect(x.avisados.at(-1)?.texto).not.toContain('ABC-7');
    expect(r.texto).toContain('te escribió');
    // to its own room: a new conversation in the main copy, as before
    const n = x.nuevas.length;
    await sendToRoom(x.c, 'express', { sala: 'express', mensaje: 'b' }, 'holo-abc7');
    expect(x.nuevas.slice(n)).toEqual([expect.objectContaining({ salaId: 'express', cwd: undefined, worktree: undefined })]);
    // from a main copy: a new conversation in the main copy
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'c' }, 'ses-principal');
    expect(x.nuevas.at(-1)).toMatchObject({ salaId: 'pagos', cwd: undefined, worktree: undefined });
  });

  it('request_worktree_cleanup: the game writes the request from the sender\'s worktree and sends it through its room\'s cleanup thread', async () => {
    const x = ctx();
    x.c.worktreeDeSesion = async (_sala, ses) => ses === 'holo-a' ? { ruta: '/repos/app-web/.claude/worktrees/a', rama: 'worktree-a', local: true }
      : ses === 'holo-b' ? { ruta: '/repos/app-web/.claude/worktrees/b', rama: 'worktree-b', local: false } : undefined;
    expect((await requestCleanup(x.c, 'express', 'ses-principal')).ok).toBe(false);
    const r = await requestCleanup(x.c, 'express', 'holo-a', 'PR #12 merged');
    expect(r.ok).toBe(true);
    expect(x.nuevas[0]).toMatchObject({ salaId: 'express', cwd: undefined, worktree: undefined });
    expect(x.nuevas[0].prompt).toContain('/repos/app-web/.claude/worktrees/a');
    expect(x.nuevas[0].prompt).toContain('`local`');
    expect(x.nuevas[0].prompt).toContain('PR #12 merged');
    await requestCleanup(x.c, 'express', 'holo-b');
    expect(x.nuevas).toHaveLength(1);
    expect(x.avisados[0]).toMatchObject({ sesionId: 'nueva' });
    expect(x.avisados[0].texto).toContain('worktree-b');
    expect(x.avisados[0].texto).not.toContain('`local`');
  });

  it('nunca a la propia conversación: la que envía ya es la de esa tarea', async () => {
    const x = ctx({ abiertas: { 'express/ABC-9': 'ses-tarea' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'a' }, 'ses-tarea');
    expect(r.ok).toBe(false); expect(r.texto).toContain('ABC-9');
    expect(x.avisados).toEqual([]);
    // otra conversación de la misma sala sí se la pasa a la de la tarea
    expect((await sendToRoom(x.c, 'express', { sala: 'express', clave: 'ABC-9', mensaje: 'a' }, 'ses-supervisor')).ok).toBe(true);
    expect(x.avisados[0].sesionId).toBe('ses-tarea');
  });

  it('with a key and its conversation busy: a read-only fork answers, and what the fork sends back with the key queues in the original', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-7': 'ses-tarea' }, ocupadas: new Set(['ses-tarea']) });
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-7', mensaje: '¿Qué versión del contrato usas?' }, 'ses-express');
    expect(r.ok).toBe(true);
    expect(r.texto).toContain('solo lectura');
    expect(x.avisados).toEqual([]);
    expect(x.forks).toEqual([{ salaId: 'pagos', de: 'ses-tarea', prompt: expect.stringContaining('¿Qué versión del contrato usas?') }]);
    // framed as an outside request, and told how to pass changes to the original
    expect(x.forks[0].prompt).toContain('fuera de lo que estás haciendo');
    expect(x.forks[0].prompt).toMatch(/room «pagos» y key ABC-7/);
    // the fork's changes, with the key to its own room: to the original, queued, even though it's busy (never forked again)
    const back = await sendToRoom(x.c, 'pagos', { sala: 'pagos', clave: 'ABC-7', mensaje: 'Cambia el contrato a v2' }, 'fork-1');
    expect(back.ok).toBe(true);
    expect(back.texto).toContain('de la que eres copia');
    expect(x.avisados.map(a => a.sesionId)).toEqual(['ses-tarea']);
    expect(x.forks).toHaveLength(1);
    // its reply without a key goes back to the sender conversation
    await sendToRoom(x.c, 'pagos', { sala: 'express', mensaje: 'Uso la v1' }, 'fork-1');
    expect(x.avisados.at(-1)!.sesionId).toBe('ses-express');
  });

  it('a fork is never the task\'s conversation: the next messages go to the original (forked again while busy, delivered once idle)', async () => {
    const abiertas: Record<string, string> = { 'pagos/ABC-8': 'ses-tarea' }, ocupadas = new Set(['ses-tarea']);
    const x = ctx({ abiertas, ocupadas });
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-8', mensaje: 'a' });
    abiertas['pagos/ABC-8'] = 'fork-1';   // the fork is now the most recent conversation in the worktree
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-8', mensaje: 'b' });
    expect(x.forks.map(f => f.de)).toEqual(['ses-tarea', 'ses-tarea']);
    ocupadas.clear();
    const r = await sendToRoom(x.c, 'tareas', { sala: 'pagos', clave: 'ABC-8', mensaje: 'c' });
    expect(r.texto).toContain('conversación abierta de ABC-8');
    expect(x.avisados.map(a => a.sesionId)).toEqual(['ses-tarea']);
    // the original itself writing with its key is still its own conversation
    expect((await sendToRoom(x.c, 'pagos', { sala: 'pagos', clave: 'ABC-8', mensaje: 'd' }, 'ses-tarea')).ok).toBe(false);
  });

  it('with a key and its conversation busy, if no fork can start: queued in it, and the answer says why', async () => {
    const x = ctx({ abiertas: { 'pagos/ABC-7': 'ses-tarea' }, ocupadas: new Set(['ses-tarea']), forkFalla: 'Ya hay 6 conversaciones vivas' });
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-7', mensaje: 'a' });
    expect(r.ok).toBe(true);
    expect(x.avisados.map(a => a.sesionId)).toEqual(['ses-tarea']);
    expect(r.texto).toContain('en cola');
    expect(r.texto).toContain('Ya hay 6 conversaciones vivas');
  });

  it('with a key and none open: the last conversation in the task\'s worktree, resumed; with none there, a new one in it', async () => {
    const wt = '/repos/pagos/.claude/worktrees/ABC-5';
    const x = ctx({ worktrees: { 'pagos/ABC-5': wt, 'pagos/ABC-6': '/repos/pagos/.claude/worktrees/ABC-6' }, previas: { [wt]: 'retomada' } });
    const r = await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-5', mensaje: 'Rebase sobre main' }, 'ses-express');
    expect(r.texto).toContain('retomando su última conversación');
    expect(x.retomadas).toEqual([{ salaId: 'pagos', cwd: wt, prompt: expect.stringContaining('Rebase sobre main'), id: 'retomada' }]);
    expect(x.retomadas[0].prompt).toContain('fuera de lo que estás haciendo');
    expect(x.nuevas).toEqual([]);
    // its replies come back to the sender
    await sendToRoom(x.c, 'pagos', { sala: 'express', mensaje: 'hecho' }, 'retomada');
    expect(x.avisados.at(-1)!.sesionId).toBe('ses-express');
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'ABC-6', mensaje: 'a' });
    expect(x.nuevas[0]).toMatchObject({ cwd: '/repos/pagos/.claude/worktrees/ABC-6' });
  });

  it('only task messages are framed as outside requests', async () => {
    const x = ctx();
    await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'a' });
    expect(x.nuevas[0].prompt).not.toContain('fuera de lo que estás haciendo');
  });

  it('with a descriptive slug key: kept as written, a new worktree named after it alone, found again by exact key', async () => {
    const x = ctx({ abiertas: { 'pagos/preflight-popover': 'ses-slug' } });
    await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'preflight-popover', mensaje: 'a' });
    expect(x.avisados[0].sesionId).toBe('ses-slug');
    expect(x.avisados[0].texto).toContain('preflight-popover');
    const r = await sendToRoom(x.c, 'tareas', { sala: 'pagos', clave: 'Holo-Front-Edge', mensaje: 'Fix the hologram front edge' });
    expect(r.ok).toBe(true);
    expect(x.nuevas[0].worktree).toMatch(/^shelter-holo-front-edge--[0-9a-z]{4}$/);
    const wts = [{ ruta: '/repos/pagos/.claude/worktrees/' + x.nuevas[0].worktree, rama: 'worktree-' + x.nuevas[0].worktree, principal: false } as any];
    expect(taskWorktree(wts, 'holo-front-edge')).toBeDefined();
    expect(taskWorktree(wts, 'front-edge')).toBeUndefined();
    expect(taskWorktree(wts, 'holo')).toBeUndefined();
  });

  it('rechaza una sala que no existe (con la lista), una sin habitante y una clave que no lo es', async () => {
    const x = ctx();
    const r = await sendToRoom(x.c, 'express', { sala: 'nada', mensaje: 'a' });
    expect(r.ok).toBe(false); expect(r.texto).toContain('pagos (pagos)');
    expect((await sendToRoom(x.c, 'express', { sala: 'vacia', mensaje: 'a' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', clave: 'lo de ayer', mensaje: 'a' })).ok).toBe(false);
    expect(x.nuevas).toEqual([]);
  });

  it('como mucho 3 por minuto de una sala a otra; los que fallan no cuentan', async () => {
    const reloj = { t: 1_000_000 };
    const mal = ctx({ falla: 'Ya hay 4 sesiones vivas', reloj });
    const e = await sendToRoom(mal.c, 'express', { sala: 'pagos', mensaje: 'x' });
    expect(e.ok).toBe(false); expect(e.texto).toContain('Ya hay 4 sesiones vivas');
    const x = ctx({ reloj });
    for (let i = 0; i < 3; i++) expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(true);
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(false);
    expect((await sendToRoom(x.c, 'express', { sala: 'tareas', mensaje: 'x' })).ok).toBe(true);   // otra sala, otra cuenta
    reloj.t += 61_000;
    expect((await sendToRoom(x.c, 'express', { sala: 'pagos', mensaje: 'x' })).ok).toBe(true);
    expect(x.nuevas).toHaveLength(5);
  });

  it('con clave, al worktree que otra conversación acaba de crear (leído de git al momento), no a la copia principal', async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'avisos-')));
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.example', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.example' };
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', env });
    g('init', '-b', 'main'); writeFileSync(path.join(dir, 'a.txt'), 'a'); g('add', '.'); g('commit', '-m', 'a');
    // como main.ts: la lista de worktrees de la carpeta de la sala en cada mensaje
    const x = ctx({ worktreeDeTarea: async (_sala, clave) => taskWorktree(await worktreeList(dir), clave) });
    const wt = path.join(path.dirname(dir), path.basename(dir) + '-ws-ci-idioma');
    g('worktree', 'add', '-b', 'ws-1-ci-idioma', wt);
    const r = await sendToRoom(x.c, 'express', { sala: 'express', clave: 'WS-1', mensaje: 'Traduce los avisos de CI' }, 'ses-supervisor');
    expect(r.ok).toBe(true);
    expect(x.nuevas[0]).toMatchObject({ cwd: wt, worktree: undefined });
    expect(r.texto).toContain('worktree de WS-1');
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
