import { describe, expect, it } from 'vitest';
import { boardOf, expire, isApproved, needsRecheck, openCheckpoints, planState, prRef, proposePlan, recheckAt, report, validPlan, deadlineOf, type PlanInput, type ReportInput, type VerificationPlan } from './verification';

const H = 3_600_000;
// a task with one PR (two services) and its final checkpoint; services and queries made up
const INPUT: PlanInput = { checkpoints: [
  { id: 'pr-10', kind: 'pr', pr: 'acme/api#10', services: ['api', 'worker'], signals: [
    { id: 'gone', kind: 'must-disappear', what: 'the timeout exception', where: 'errors in api: TimeoutError', baseline: '20 a week' },
    { id: 'errors', kind: 'no-new-errors', what: 'nothing new breaks', where: 'new error types in api since the deploy' },
  ] },
  { id: 'final', kind: 'final', title: 'Checkout no longer times out', signals: [
    { id: 'ran', kind: 'must-run', what: 'the readiness check runs on the new version', where: 'log «readiness ok» in worker', baseline: '~1,000 a day' },
  ] },
] };
const plan = (): VerificationPlan => { const r = proposePlan('ABC-1', INPUT, undefined, 0); if (!r.ok) throw new Error(r.error); return r.valor; };
const step = (p: VerificationPlan, r: ReportInput, ahora = 1): VerificationPlan => { const x = report(p, r, ahora); if (!x.ok) throw new Error(x.error); return x.valor; };
const cp = (p: VerificationPlan, id: string) => p.puntos.find(c => c.id === id)!;

describe('proposePlan', () => {
  it('a new plan: every checkpoint waits for its deploy, with the default 24 h deadline, version 1, not approved', () => {
    const p = plan();
    expect(p.puntos.map(c => [c.id, c.estado, c.plazoHoras])).toEqual([['pr-10', 'waiting-deploy', 24], ['final', 'waiting-deploy', 24]]);
    expect(p.version).toBe(1);
    expect(isApproved(p)).toBe(false);
    expect(planState(p)).toBe('waiting-deploy');
    expect(validPlan(JSON.parse(JSON.stringify(p)))).toBe(true);
  });

  it('needs exactly one final checkpoint, a ref for a PR checkpoint, known kinds and a what and where for each signal', () => {
    const sin = (f: (i: PlanInput) => void) => { const i = structuredClone(INPUT); f(i); const r = proposePlan('ABC-1', i, undefined, 0); return r.ok ? 'ok' : r.error; };
    expect(sin(i => i.checkpoints.pop())).toBe('oneFinal');
    expect(sin(i => { i.checkpoints[0].kind = 'final'; })).toBe('oneFinal');
    expect(sin(i => { delete i.checkpoints[0].pr; })).toBe('prNeedsRef');
    expect(sin(i => { i.checkpoints[0].signals[0].kind = 'looks-fine'; })).toBe('badSignalKind');
    expect(sin(i => { i.checkpoints[0].signals[0].where = ' '; })).toBe('signalNeedsWhatWhere');
    expect(sin(i => { i.checkpoints[1].signals = []; })).toBe('noSignals');
    expect(sin(i => { i.checkpoints[1].id = 'pr-10'; })).toBe('badId');
    expect(sin(i => { i.checkpoints[1].deadline_hours = 0; })).toBe('badDeadline');
    expect(sin(() => {})).toBe('ok');
  });

  it('an update keeps the recorded states; changing what is checked is a new version that needs approving again', () => {
    let p: VerificationPlan = { ...plan(), aprobado: { version: 1, ts: 5 } };
    p = step(p, { checkpoint: 'pr-10', event: 'live', service: 'api' });
    p = step(p, { checkpoint: 'pr-10', event: 'live', service: 'worker' });
    p = step(p, { checkpoint: 'pr-10', event: 'evidenced', signal: 'gone', evidence: '0 since the deploy' });
    // the same plan again: same version, still approved, states kept
    const igual = proposePlan('ABC-1', INPUT, p, 9);
    expect(igual.ok && [igual.valor.version, isApproved(igual.valor), cp(igual.valor, 'pr-10').estado, cp(igual.valor, 'pr-10').señales[0].estado]).toEqual([1, true, 'waiting-traffic', 'evidenced']);
    // a signal now looks somewhere else: it starts again, and the plan needs approving again
    const i = structuredClone(INPUT); i.checkpoints[0].signals[0].where = 'errors in api: GatewayTimeout';
    const otro = proposePlan('ABC-1', i, p, 9);
    expect(otro.ok && [otro.valor.version, isApproved(otro.valor), cp(otro.valor, 'pr-10').señales[0].estado]).toEqual([2, false, 'pending']);
  });
});

describe('report: the checkpoint state machine', () => {
  it('waiting-deploy → live while some services are → waiting-traffic when all are, and its deadline starts then', () => {
    let p = step(plan(), { checkpoint: 'pr-10', event: 'live', service: 'api' }, 10);
    expect(cp(p, 'pr-10').estado).toBe('live');
    expect(deadlineOf(cp(p, 'pr-10'))).toBeUndefined();
    p = step(p, { checkpoint: 'pr-10', event: 'live', service: 'worker' }, 20);
    expect(cp(p, 'pr-10').estado).toBe('waiting-traffic');
    expect(deadlineOf(cp(p, 'pr-10'))).toBe(20 + 24 * H);
    expect(report(p, { checkpoint: 'pr-10', event: 'live', service: 'web' }, 30)).toMatchObject({ ok: false, error: 'noService' });
  });

  it('without services, one live report is enough', () => {
    const p = step(plan(), { checkpoint: 'final', event: 'live' });
    expect(cp(p, 'final').estado).toBe('waiting-traffic');
  });

  it('no evidence before the deploy, and none without a text', () => {
    expect(report(plan(), { checkpoint: 'final', event: 'evidenced', signal: 'ran', evidence: 'ran 3 times' }, 1)).toMatchObject({ ok: false, error: 'notLive' });
    const p = step(plan(), { checkpoint: 'final', event: 'live' });
    expect(report(p, { checkpoint: 'final', event: 'evidenced', signal: 'ran', evidence: ' ' }, 1)).toMatchObject({ ok: false, error: 'needsEvidence' });
  });

  it('evidenced once every signal is; failed as soon as one fails; closed afterwards', () => {
    let p = step(plan(), { checkpoint: 'pr-10', event: 'live', service: 'api' });
    p = step(p, { checkpoint: 'pr-10', event: 'live', service: 'worker' });
    p = step(p, { checkpoint: 'pr-10', event: 'evidenced', signal: 'gone', evidence: '0 in 2 h, 3 a day before' });
    expect(cp(p, 'pr-10').estado).toBe('waiting-traffic');
    const bien = step(p, { checkpoint: 'pr-10', event: 'evidenced', signal: 'errors', evidence: 'no new error types' });
    expect(cp(bien, 'pr-10').estado).toBe('evidenced');
    const malo = step(p, { checkpoint: 'pr-10', event: 'failed', signal: 'errors', evidence: 'KeyError since the deploy' });
    expect(cp(malo, 'pr-10').estado).toBe('failed');
    expect(cp(malo, 'pr-10').señales[1].evidencia?.texto).toBe('KeyError since the deploy');
    expect(report(malo, { checkpoint: 'pr-10', event: 'evidenced', signal: 'errors', evidence: 'fine now' }, 2)).toMatchObject({ ok: false, error: 'closed' });
  });

  it('a failure without a signal fails the whole checkpoint, even before the deploy', () => {
    const p = step(plan(), { checkpoint: 'pr-10', event: 'failed', evidence: 'the deploy was rolled back' });
    expect(cp(p, 'pr-10').estado).toBe('failed');
    expect(cp(p, 'pr-10').nota?.texto).toBe('the deploy was rolled back');
  });

  it('past the deadline with no traffic: inconclusive; then the Overseer waits more or accepts it with a reason', () => {
    let p = step(plan(), { checkpoint: 'final', event: 'live' }, 0);
    expect(expire(p, 23 * H)).toBe(p);
    p = expire(p, 24 * H);
    expect(cp(p, 'final').estado).toBe('inconclusive');
    expect(planState(p)).toBe('inconclusive');
    // traffic finally came: the evidence is recorded, but the Overseer still chooses
    const tarde = step(p, { checkpoint: 'final', event: 'evidenced', signal: 'ran', evidence: 'ran once' }, 25 * H);
    expect(cp(tarde, 'final').estado).toBe('evidenced');
    expect(report(p, { checkpoint: 'final', event: 'accept' }, 25 * H)).toMatchObject({ ok: false, error: 'needsEvidence' });
    const aceptado = step(p, { checkpoint: 'final', event: 'accept', evidence: 'exercised it by hand in staging' }, 25 * H);
    expect([cp(aceptado, 'final').estado, cp(aceptado, 'final').nota?.texto]).toEqual(['evidenced', 'exercised it by hand in staging']);
    const espera = step(p, { checkpoint: 'final', event: 'wait', hours: 48 }, 25 * H);
    expect([cp(espera, 'final').estado, deadlineOf(cp(espera, 'final'))]).toEqual(['waiting-traffic', 25 * H + 48 * H]);
    expect(report(plan(), { checkpoint: 'final', event: 'accept', evidence: 'x' }, 1)).toMatchObject({ ok: false, error: 'cannotAccept' });
  });

  it('an unknown checkpoint or signal names the ones there are', () => {
    expect(report(plan(), { checkpoint: 'pr-99', event: 'live' }, 1)).toMatchObject({ ok: false, error: 'noCheckpoint', vars: { ids: 'pr-10, final' } });
    const p = step(plan(), { checkpoint: 'final', event: 'live' });
    expect(report(p, { checkpoint: 'final', event: 'evidenced', signal: 'nope', evidence: 'x' }, 1)).toMatchObject({ ok: false, error: 'noSignal', vars: { ids: 'ran' } });
  });
});

describe('opening checkpoints and rechecks', () => {
  it('a PR checkpoint opens when its PR merges; the final one when every PR of the task has, or in the tracker\'s prod-check status', () => {
    const p = plan();
    expect(openCheckpoints(p, [{ ref: 'acme/api#10', fusionado: false }], false, 5)).toBe(p);
    const q = openCheckpoints(p, [{ ref: 'acme/api#10', fusionado: true }, { ref: 'acme/web#20', fusionado: false }], false, 5);
    expect(q.puntos.map(c => [c.id, c.abierto, deadlineOf(c)])).toEqual([['pr-10', 5, 5 + 24 * H], ['final', undefined, undefined]]);
    expect(needsRecheck(cp(q, 'pr-10'))).toBe(true);
    expect(needsRecheck(cp(q, 'final'))).toBe(false);
    const todos = [{ ref: 'acme/api#10', fusionado: true }, { ref: 'acme/web#20', fusionado: true }];
    // every PR merged, but the PR's own checkpoint is still being rechecked: the final one waits for it
    expect(cp(openCheckpoints(q, todos, false, 7), 'final').abierto).toBeUndefined();
    const hecho = step(step(q, { checkpoint: 'pr-10', event: 'failed', evidence: 'rolled back' }), { checkpoint: 'final', event: 'live' });
    expect(cp(openCheckpoints(hecho, todos, false, 7), 'final').abierto).toBe(7);
    expect(cp(openCheckpoints(q, [{ ref: 'acme/web#20', fusionado: false }], true, 8), 'final').abierto).toBe(8);
  });

  it('an open checkpoint with no deploy by its deadline turns inconclusive too, remembering where it was stuck', () => {
    const p = expire(openCheckpoints(plan(), [{ ref: 'acme/api#10', fusionado: true }], false, 0), 24 * H);
    expect([cp(p, 'pr-10').estado, cp(p, 'pr-10').atascado]).toEqual(['inconclusive', 'waiting-deploy']);
    expect(needsRecheck(cp(p, 'pr-10'))).toBe(false);
    // waiting more goes back to waiting for its deploy, with a new deadline
    const w = step(p, { checkpoint: 'pr-10', event: 'wait', hours: 4 }, 25 * H);
    expect([cp(w, 'pr-10').estado, cp(w, 'pr-10').atascado, deadlineOf(cp(w, 'pr-10'))]).toEqual(['waiting-deploy', undefined, 29 * H]);
  });

  it('rechecks back off: 30 min, 2 h, then the next morning at 9', () => {
    const ahora = new Date(2026, 10, 17, 15, 0).getTime();
    expect(recheckAt(0, ahora)).toBe(ahora + 30 * 60_000);
    expect(recheckAt(1, ahora)).toBe(ahora + 2 * H);
    expect(recheckAt(2, ahora)).toBe(new Date(2026, 10, 18, 9, 0).getTime());
  });

  it('PR refs from a URL or org/repo#N; boards from the key prefix', () => {
    expect(prRef('https://github.com/Acme/API/pull/10')).toBe('acme/api#10');
    expect(prRef('acme/api#010')).toBe('acme/api#10');
    expect(prRef('#10')).toBeUndefined();
    expect([boardOf('abc-12'), boardOf('ENG-7'), boardOf('preflight-popover')]).toEqual(['ABC', 'ENG', undefined]);
  });
});
