import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { finishedTasks, orphanedConversations, leftovers, untracked, scheduledIn, planOf, verificationHold, conversationIn, TasksCleanup, type RoomCleanup, type CtxCleanup, type Leftover, type FinishedTask } from './taskCleanup.ts';
import type { CheckpointState, VerificationPlan } from '../shared/verification.ts';
import type { PRBoard } from '../shared/board.ts';
import type { InfoWorktree, SessionSummary } from '../shared/protocol.ts';
import type { ScheduledMessage, ScheduledTarget } from '../shared/scheduled.ts';

const pr = (number: number, branch: string, state: PRBoard['state'], repo = 'refugio/express', title = 'Algo'): PRBoard =>
  ({ number, title, url: `https://github.com/${repo}/pull/${number}`, repo, branch, state, updated: 0 });
const wt = (path: string, branch: string, extra: Partial<InfoWorktree> = {}): InfoWorktree => ({ path, branch, main: false, changes: 0, advanced: 0, ...extra });
const room = (worktrees: InfoWorktree[]): RoomCleanup => ({
  id: 'express', name: 'Express', path: '/r/express', repo: 'refugio/express',
  worktrees: [{ path: '/r/express', branch: 'main', main: true, changes: 0, advanced: 0 }, ...worktrees],
});

// a plan with its final checkpoint in `state` (approved unless said otherwise)
const vplan = (key: string, state: CheckpointState, extra: Partial<VerificationPlan> = {}): VerificationPlan => ({
  key, version: 1, updated: 0, approved: { version: 1, ts: 0 },
  points: [{ id: 'final', type: 'final', title: 'final', services: [], live: {}, deadlineHours: 24, state, signals: [] }], ...extra });

const msg = (target: ScheduledTarget): ScheduledMessage =>
  ({ id: 'm1', created: 0, when: 1, requested: '', message: 'prod check', origin: { roomId: 'express' }, target });

describe('finishedTasks', () => {
  it('una tarea con todos sus PR fusionados y su worktree en la sala', () => {
    const s = room([wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra'), wt('/r/express/.claude/worktrees/otra', 'other')]);
    const out = finishedTasks(s, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'REF-212-pruebas', 'merged')]);
    expect(out.map(x => [x.task, x.prs.map(p => p.number), x.worktrees.map(w => w.path)]))
      .toEqual([['REF-212', [42, 43], ['/r/express/.claude/worktrees/shelter-ref-212']]]);
  });
  it('no, si queda un PR de la tarea abierto o en borrador', () => {
    const s = room([wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra')]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'ref-212-pruebas', 'open')])).toEqual([]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'ref-212-pruebas', 'draft')])).toEqual([]);
  });
  it('sí, con sus PR cerrados sin fusionar (se reabren si hace falta)', () => {
    const s = room([wt('/r/x/shelter-ref-212', 'ref-212-barra')]);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'closed')]).map(x => x.task)).toEqual(['REF-212']);
    expect(finishedTasks(s, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'ref-212-otra', 'closed')]).map(x => x.prs.map(p => p.number))).toEqual([[42, 43]]);
  });
  it('no, sin worktree de la tarea, en la copia principal o con PR de otro repo', () => {
    expect(finishedTasks(room([]), [pr(42, 'ref-212-barra', 'merged')])).toEqual([]);
    expect(finishedTasks(room([]), [pr(42, 'main', 'merged')])).toEqual([]);
    expect(finishedTasks(room([wt('/r/x/shelter-ref-212', 'ref-212-barra')]), [pr(42, 'ref-212-barra', 'merged', 'refugio/otro')])).toEqual([]);
  });
  it('sin clave: por su rama o por su número en el nombre del worktree', () => {
    const s = room([wt('/r/x/rapido', 'arreglo-rapido'), wt('/r/x/shelter-pr-7', 'detached')]);
    const out = finishedTasks(s, [pr(5, 'arreglo-rapido', 'merged'), pr(7, 'otra-cosa', 'merged')]);
    expect(out.map(x => [x.task, x.worktrees.map(w => w.path)])).toEqual([['PR #5', ['/r/x/rapido']], ['PR #7', ['/r/x/shelter-pr-7']]]);
  });
});

// con git de verdad: un remoto (bare), su clon (la copia principal de la sala) y worktrees de tareas
// sin la configuración global del Supervisor (sus hooks harían cada commit y cada push lentos)
const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Prueba', GIT_AUTHOR_EMAIL: 'p@refugio.example', GIT_COMMITTER_NAME: 'Prueba', GIT_COMMITTER_EMAIL: 'p@refugio.example' } });
const git = (cwd: string, args: string[]) => Promise.resolve().then(() => sh(cwd, ...args));
function repo() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'limpieza-git-')));
  const remote = path.join(base, 'remoto.git'), room = path.join(base, 'express');
  sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
  sh(base, 'clone', '-q', remote, room);
  writeFileSync(path.join(room, 'a.txt'), 'a\n'); sh(room, 'add', '.'); sh(room, 'commit', '-qm', 'base'); sh(room, 'push', '-q', 'origin', 'HEAD:main');
  // la tarea: su rama con un commit subido, en un worktree
  const wt = path.join(room, '.claude', 'worktrees', 'shelter-ref-212');
  sh(room, 'worktree', 'add', '-q', '-b', 'ref-212-barra', wt);
  writeFileSync(path.join(wt, 'b.txt'), 'b\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'REF-212 barra'); sh(wt, 'push', '-q', '-u', 'origin', 'ref-212-barra');
  return { base, remote, room, wt };
}
const infoWt = (path: string, branch = 'ref-212-barra') => wt(path, branch);

describe('orphanedConversations', () => {
  const sess = (id: string, cwd: string, extra: Partial<SessionSummary> = {}) => ({ id, cwd, state: 'finished', unread: false, ...extra }) as SessionSummary;
  const gone = '/r/express/.claude/worktrees/gone', alive = '/r/express/.claude/worktrees/alive';
  const exists = (path: string) => path !== gone;
  it('a retired review\'s folder (the Review room) counts as a removed worktree', () => {
    const root = '/d/salas/review', here = (p: string) => p !== `${root}/ABC-1`;
    expect(orphanedConversations([sess('a', `${root}/ABC-1`), sess('b', `${root}/ABC-1/web-12`), sess('c', `${root}/ABC-2`), sess('d', '/elsewhere/ABC-1')], new Set(), here, root)).toEqual(['a', 'b']);
    expect(orphanedConversations([sess('a', `${root}/ABC-1`)], new Set(), here)).toEqual([]);
  });
  it('closes the idle, read ones of a removed worktree, also from a subfolder', () => {
    const out = orphanedConversations([sess('a', gone), sess('b', gone + '/web', { state: 'idle' }), sess('c', alive), sess('d', '/r/express')], new Set(), exists);
    expect(out).toEqual(['a', 'b']);
  });
  it('keeps the ones working, waiting, unread or in use in the intercom', () => {
    const out = orphanedConversations([sess('a', gone, { state: 'working' }), sess('b', gone, { state: 'waiting' }), sess('c', gone, { unread: true }), sess('d', gone), sess('e', gone, { state: 'closed' })], new Set(['d']), exists);
    expect(out).toEqual([]);
  });
});

describe('scheduledIn', () => {
  const w = wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra'), s = room([w, wt('/r/express/.claude/worktrees/otra', 'other')]);
  it('the pending ones for its conversations (cwd inside it) or for its room with its key', () => {
    expect(scheduledIn([msg({ type: 'conversation', roomId: 'express', cwd: w.path + '/web' })], s, w)).toHaveLength(1);
    expect(scheduledIn([msg({ type: 'room', room: 'express', key: 'REF-212' })], s, w)).toHaveLength(1);
  });
  it('not those for the main copy, another worktree or another room', () => {
    expect(scheduledIn([
      msg({ type: 'conversation', roomId: 'express', cwd: '/r/express' }),
      msg({ type: 'conversation', roomId: 'express', cwd: '/r/express/.claude/worktrees/otra' }),
      msg({ type: 'room', room: 'express' }),
      msg({ type: 'room', room: 'otra-sala', key: 'REF-212' }),
    ], s, w)).toEqual([]);
  });
});

describe('verificationHold and planOf', () => {
  const w = wt('/r/express/.claude/worktrees/shelter-ref-212', 'ref-212-barra');
  const task = (...prs: PRBoard[]): FinishedTask => ({ task: 'REF-212', prs, worktrees: [w] });
  const merged = task(pr(42, 'ref-212-barra', 'merged'));
  it('merged without a plan, or with one not approved: waits for it', () => {
    expect(verificationHold(merged, undefined)).toBe('no-plan');
    expect(verificationHold(merged, vplan('REF-212', 'evidenced', { approved: undefined }))).toBe('no-plan');
    expect(verificationHold(merged, vplan('REF-212', 'evidenced', { version: 2 }))).toBe('no-plan');
  });
  it('while its final checkpoint is open, it waits; failed, it keeps everything; evidenced or accepted, it goes', () => {
    for (const s of ['waiting-deploy', 'live', 'waiting-traffic', 'inconclusive'] as const) expect(verificationHold(merged, vplan('REF-212', s))).toBe('open');
    expect(verificationHold(merged, vplan('REF-212', 'failed'))).toBe('failed');
    expect(verificationHold(merged, vplan('REF-212', 'evidenced'))).toBeUndefined();
  });
  it('PRs all closed without merging: nothing reached production, it goes', () => {
    expect(verificationHold(task(pr(42, 'ref-212-barra', 'closed')), undefined)).toBeUndefined();
  });
  it('finds the plan by the worktree\'s task, the task\'s key, a checkpoint for its PR or the conversation that proposed it', () => {
    const slug = wt('/r/express/.claude/worktrees/shelter-arreglo-barra--ab12', 'worktree-shelter-arreglo-barra--ab12');
    const t = (w: typeof slug, ...prs: PRBoard[]): FinishedTask => ({ task: 'PR #5', prs, worktrees: [w] });
    expect(planOf(t(slug, pr(5, slug.branch!, 'merged')), slug, { 'arreglo-barra': vplan('arreglo-barra', 'evidenced') })?.key).toBe('arreglo-barra');
    expect(planOf(merged, w, { 'REF-212': vplan('REF-212', 'live') })?.key).toBe('REF-212');
    const withPR = vplan('other', 'live', { points: [{ ...vplan('x', 'live').points[0], id: 'pr', type: 'pr', pr: 'refugio/express#5' }] });
    expect(planOf(t(wt('/r/x/rapido', 'rapido'), pr(5, 'rapido', 'merged')), wt('/r/x/rapido', 'rapido'), { other: withPR })?.key).toBe('other');
    const fromHere = vplan('other', 'live', { conversation: { roomId: 'express', cwd: '/r/x/rapido/sub' } });
    expect(planOf(t(wt('/r/x/rapido', 'rapido'), pr(6, 'rapido', 'merged')), wt('/r/x/rapido', 'rapido'), { other: fromHere })?.key).toBe('other');
    expect(planOf(merged, w, { other: vplan('other', 'live') })).toBeUndefined();
  });
  it('the task\'s conversation: the latest in the worktree, closed ones too', () => {
    const s = [{ id: 'a', cwd: w.path, updated: 1, state: 'closed' }, { id: 'b', cwd: w.path + '/sub', updated: 2, state: 'closed' }, { id: 'c', cwd: '/r/express', updated: 3, state: 'idle' }] as SessionSummary[];
    expect(conversationIn(s, w)?.id).toBe('b');
  });
});

describe('leftovers (git de verdad)', () => {
  it('nada, con todo subido; cambios sin commit, stash de su rama y commits sin subir, sí', async () => {
    const r = repo();
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([]);
    writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ type: 'changes', n: 1 }]);
    sh(r.wt, 'stash', '-q');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ type: 'stash', n: 1 }]);
    sh(r.wt, 'stash', 'drop', '-q');
    writeFileSync(path.join(r.wt, 'd.txt'), 'd\n'); sh(r.wt, 'add', '.'); sh(r.wt, 'commit', '-qm', 'sin subir');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ type: 'commits', n: 1 }]);
  });
  it('los archivos que git no sigue no cuentan (notas de un plan); los ignorados, tampoco', async () => {
    const r = repo();
    mkdirSync(path.join(r.wt, 'plans')); writeFileSync(path.join(r.wt, 'plans', 'notas.md'), 'n\n'); writeFileSync(path.join(r.wt, 'suelto.txt'), 's\n');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([]);
    expect((await untracked(git, r.wt)).sort()).toEqual([path.join(r.wt, 'plans') + '/', path.join(r.wt, 'suelto.txt')]);
  });
  it('commits que ya no están en el remoto (rama borrada tras un squash) pero sí en la rama del PR: valen', async () => {
    const r = repo();
    const head = sh(r.wt, 'rev-parse', 'HEAD').trim();
    sh(r.room, 'push', '-q', 'origin', '--delete', 'ref-212-barra'); sh(r.room, 'fetch', '-q', '--prune');
    expect(await leftovers(git, infoWt(r.wt), [], [])).toEqual([{ type: 'commits', n: 1 }]);
    expect(await leftovers(git, infoWt(r.wt), [{ ...pr(42, 'ref-212-barra', 'merged'), head }], [])).toEqual([]);
  });
  it('una conversación abierta en el worktree', async () => {
    const r = repo();
    const s = [{ id: 's1', state: 'idle', cwd: r.wt, roomId: 'express', updated: 0 }] as unknown as SessionSummary[];
    expect(await leftovers(git, infoWt(r.wt), [], s)).toEqual([{ type: 'conversation' }]);
  });
});

describe('TasksCleanup (git de verdad)', () => {
  let removeIt: (() => Promise<void>) | undefined;
  let skipIt: (() => void) | undefined;
  // verified in production by default: the tests about what's left in the worktree
  const verified = () => ({ 'REF-212': vplan('REF-212', 'evidenced') });
  const ctx = (r: ReturnType<typeof repo>, prs: PRBoard[], ev: string[], sessions: SessionSummary[] = [], scheduled: ScheduledMessage[] = [], plans: Record<string, VerificationPlan> = verified()): CtxCleanup => ({
    connection: async () => ({ real: true }),
    prs: async () => prs,
    rooms: async () => [{ id: 'express', name: 'Express', path: r.room, repo: 'refugio/express', worktrees: [{ path: r.room, branch: 'main', main: true, changes: 0, advanced: 0 }, infoWt(r.wt)] }],
    sessions: () => sessions,
    scheduled: () => scheduled,
    plans: () => plans,
    noPlan: (_s, x, _w, key, plan, session, skip) => { ev.push(`sin plan ${x.task} ${key} ${plan ? 'sin aprobar' : 'ninguno'} ${session?.id ?? 'nueva'}`); skipIt = skip; },
    git,
    // la papelera de verdad, no: se mueven a una carpeta temporal
    trash: async paths => { const d = mkdtempSync(path.join(os.tmpdir(), 'papelera-')); for (const x of paths) renameSync(x, path.join(d, path.basename(x))); ev.push(`papelera ${paths.map(x => path.relative(r.wt, x)).join(',')}`); },
    removed: (_s, x, w, loose) => ev.push(`quitado ${x.task} ${path.basename(w.path)}${loose ? ` +${loose}` : ''}`),
    ask: (_s, x, _w, what: Leftover[], remove) => { ev.push(`pregunta ${x.task} ${what.map(q => q.type).join(',')}`); removeIt = async () => { ev.push(`respuesta ${await remove()}`); }; },
    changed: () => ev.push('changed'),
  });
  it('con todos sus PR fusionados o cerrados y nada pendiente, quita el worktree y su rama local; la del remoto se queda', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'ref-212-otra', 'closed')], ev)).poll();
    expect(ev).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
    expect(existsSync(r.wt)).toBe(false);
    expect(sh(r.room, 'branch', '--list', 'ref-212-barra').trim()).toBe('');
    expect(sh(r.remote, 'branch', '--list', 'ref-212-barra').trim()).toBe('ref-212-barra');
  });
  it('con un PR aún abierto no toca nada', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged'), pr(43, 'ref-212-otra', 'open')], ev)).poll();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
  it('si queda algo lo deja, pregunta una vez y lo quita cuando ya no queda nada', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    const prs = [pr(42, 'ref-212-barra', 'merged')];
    await new TasksCleanup(dir, ctx(r, prs, ev)).poll();
    await new TasksCleanup(dir, ctx(r, prs, ev)).poll();
    expect(ev).toEqual(['pregunta REF-212 changes']);
    sh(r.wt, 'checkout', '-q', 'b.txt');
    await new TasksCleanup(dir, ctx(r, prs, ev)).poll();
    expect(ev.slice(1)).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
  });
  it('si el Supervisor dice que sí, lo quita aunque tenga cambios sin commit', async () => {
    const r = repo(), ev: string[] = [];
    writeFileSync(path.join(r.wt, 'c.txt'), 'c\n'); writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged')], ev)).poll();
    expect(existsSync(r.wt)).toBe(true);
    await removeIt!();
    expect(ev).toEqual(['pregunta REF-212 changes', 'papelera c.txt', 'quitado REF-212 shelter-ref-212 +1', 'changed', 'respuesta removed']);
    expect(existsSync(r.wt)).toBe(false);
  });
  it('con solo archivos que git no sigue lo quita sin preguntar, y ellos van a la papelera', async () => {
    const r = repo(), ev: string[] = [];
    mkdirSync(path.join(r.wt, 'plans')); writeFileSync(path.join(r.wt, 'plans', 'notas.md'), 'n\n');
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged')], ev)).poll();
    expect(ev).toEqual(['papelera plans', 'quitado REF-212 shelter-ref-212 +1', 'changed']);
    expect(existsSync(r.wt)).toBe(false);
  });
  it('si dice que sí con una conversación abierta en él, lo quita en cuanto se cierra (también tras reiniciar)', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    const prs = [pr(42, 'ref-212-barra', 'merged')];
    const open = [{ id: 's1', state: 'idle', cwd: r.wt, roomId: 'express', updated: 0 }] as unknown as SessionSummary[];
    const sessions: SessionSummary[] = [];
    await new TasksCleanup(dir, ctx(r, prs, ev, sessions)).poll();
    sessions.push(...open);   // se abre una conversación en él para preguntarle qué queda, y luego se dice que sí
    await removeIt!();
    expect(ev).toEqual(['pregunta REF-212 changes', 'respuesta waiting']);
    await new TasksCleanup(dir, ctx(r, prs, ev, open)).poll();
    expect(existsSync(r.wt)).toBe(true);
    await new TasksCleanup(dir, ctx(r, prs, ev)).poll();
    expect(ev.slice(2)).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
    expect(existsSync(r.wt)).toBe(false);
  });
  it('con una conversación abierta no pregunta ni lo quita: espera', async () => {
    const r = repo(), ev: string[] = [];
    writeFileSync(path.join(r.wt, 'b.txt'), 'cambiado\n');
    const s = [{ id: 's1', state: 'working', cwd: r.wt, roomId: 'express', updated: 0 }] as unknown as SessionSummary[];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged')], ev, s)).poll();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
  it('with scheduled messages pending for it, asks instead of removing it; once they are gone, removes it', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    const prs = [pr(42, 'ref-212-barra', 'merged')], pending = [msg({ type: 'room', room: 'express', key: 'REF-212' })];
    await new TasksCleanup(dir, ctx(r, prs, ev, [], pending)).poll();
    await new TasksCleanup(dir, ctx(r, prs, ev, [], pending)).poll();
    expect(ev).toEqual(['pregunta REF-212 scheduled']);
    expect(existsSync(r.wt)).toBe(true);
    await new TasksCleanup(dir, ctx(r, prs, ev)).poll();
    expect(ev.slice(1)).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
  });
  it('merged with its final checkpoint open or failed: keeps the worktree, even with its conversation closed; verified, removes it', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    const prs = [pr(42, 'ref-212-barra', 'merged')], closed = [{ id: 's1', state: 'closed', cwd: r.wt, roomId: 'express', updated: 0 }] as unknown as SessionSummary[];
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], { 'REF-212': vplan('REF-212', 'waiting-traffic') })).poll();
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], { 'REF-212': vplan('REF-212', 'inconclusive') })).poll();
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], { 'REF-212': vplan('REF-212', 'failed') })).poll();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
    const accepted = vplan('REF-212', 'evidenced'); accepted.points[0].note = { text: 'no traffic on weekends, accepted', ts: 1 };
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], { 'REF-212': accepted })).poll();
    expect(ev).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
  });
  it('merged without an approved plan: asks its conversation and the Overseer once and keeps it; told to skip it, removes it', async () => {
    const r = repo(), ev: string[] = [], dir = mkdtempSync(path.join(os.tmpdir(), 'limpieza-'));
    const prs = [pr(42, 'ref-212-barra', 'merged')], closed = [{ id: 's1', state: 'closed', cwd: r.wt, roomId: 'express', updated: 0 }] as unknown as SessionSummary[];
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], {})).poll();
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], {})).poll();
    expect(ev).toEqual(['sin plan REF-212 REF-212 ninguno s1']);
    expect(existsSync(r.wt)).toBe(true);
    // proposed but not approved yet: already asked about this task, so no second time
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], { 'REF-212': vplan('REF-212', 'waiting-deploy', { approved: undefined }) })).poll();
    expect(ev.length).toBe(1);
    skipIt!();
    await new TasksCleanup(dir, ctx(r, prs, ev, closed, [], {})).poll();
    expect(ev.slice(1)).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
  });
  it('without an approved plan and no conversation in it, asks a new one there', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'merged')], ev, [], [], { 'REF-212': vplan('REF-212', 'live', { approved: undefined }) })).poll();
    expect(ev).toEqual(['sin plan REF-212 REF-212 sin aprobar nueva']);
  });
  it('PRs all closed without merging: removes it without a plan', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), ctx(r, [pr(42, 'ref-212-barra', 'closed')], ev, [], [], {})).poll();
    expect(ev).toEqual(['quitado REF-212 shelter-ref-212', 'changed']);
  });
  it('sin GitHub conectado de verdad no hace nada', async () => {
    const r = repo(), ev: string[] = [];
    await new TasksCleanup(mkdtempSync(path.join(os.tmpdir(), 'limpieza-')), { ...ctx(r, [pr(42, 'ref-212-barra', 'merged')], ev), connection: async () => ({ real: false }) }).poll();
    expect(ev).toEqual([]);
    expect(existsSync(r.wt)).toBe(true);
  });
});
