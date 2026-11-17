import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Verifications, planText } from './verifications.ts';
import { isApproved } from '../shared/verification.ts';

const CPS = { checkpoints: [{ id: 'final', kind: 'final' as const, signals: [{ id: 'ran', kind: 'must-run', what: 'it runs', where: 'log «ok» in worker', baseline: '~1,000 a day' }] }] };

describe('Verifications', () => {
  it('saves plans by task, approves the current version, and turns them inconclusive when read past the deadline', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'verif-'));
    let ahora = 0;
    const v = new Verifications(dir, () => ahora);
    expect(v.proponer('ABC-1', CPS).ok).toBe(true);
    expect(isApproved(v.aprobar('ABC-1')!)).toBe(true);
    expect(v.informar('ABC-1', { checkpoint: 'final', event: 'live' })?.ok).toBe(true);
    expect(v.informar('ABC-2', { checkpoint: 'final', event: 'live' })).toBeUndefined();
    ahora = 25 * 3_600_000;
    const otra = new Verifications(dir, () => ahora);   // read back from disk
    const p = otra.get('ABC-1')!;
    expect([isApproved(p), p.puntos[0].estado]).toEqual([true, 'inconclusive']);
    expect(planText(p)).toContain('log «ok» in worker');
  });
});

describe('Verifications.repasar', () => {
  const H = 3_600_000;
  const PLAN = { checkpoints: [
    { id: 'pr-10', kind: 'pr' as const, pr: 'acme/api#10', signals: [{ id: 'gone', kind: 'must-disappear', what: 'the timeout', where: 'errors in api' }] },
    { id: 'final', kind: 'final' as const, signals: [{ id: 'ran', kind: 'must-run', what: 'it runs', where: 'log «ok»' }] },
  ] };
  const conv = { salaId: 'api', sesionId: 's1', claudeId: 'c1', cwd: '/r/api-abc-1' };
  function montar() {
    let ahora = new Date(2026, 10, 17, 10, 0).getTime();   // a Tuesday
    const v = new Verifications(mkdtempSync(path.join(os.tmpdir(), 'verif-')), () => ahora);
    const programados = new Map<string, { cuando: number; mensaje: string }>(), avisos: string[] = [];
    let fusionado = false, n = 0;
    const ctx = {
      prs: async () => [{ ref: 'acme/api#10', fusionado }], enPrueba: async () => false,
      programar: (_c: unknown, cuando: number, mensaje: string) => { const id = 'p' + ++n; programados.set(id, { cuando, mensaje }); return id; },
      pendiente: (id: string) => programados.has(id), cancelar: (id: string) => { programados.delete(id); }, avisar: (texto: string) => { avisos.push(texto); },
    };
    v.proponer('ABC-1', PLAN, conv);
    return { v, ctx, programados, avisos, merge: () => { fusionado = true; }, pasar: (ms: number) => { ahora += ms; }, ahora: () => ahora };
  }

  it('on merge it opens the PR checkpoint and keeps exactly one recheck scheduled, backing off', async () => {
    const m = montar();
    await m.v.repasar(m.ctx);
    expect(m.programados.size).toBe(0);
    m.merge(); await m.v.repasar(m.ctx);
    expect([...m.programados.values()].map(x => x.cuando)).toEqual([m.ahora() + 30 * 60_000]);
    expect([...m.programados.values()][0].mensaje).toContain('verification_report');
    await m.v.repasar(m.ctx);
    expect(m.programados.size).toBe(1);
    m.programados.clear(); await m.v.repasar(m.ctx);   // delivered: the next one, two hours later
    expect([...m.programados.values()].map(x => x.cuando)).toEqual([m.ahora() + 2 * H]);
    expect(m.v.get('ABC-1')!.puntos[0].rechequeos).toBe(2);
  });

  it('a closed checkpoint drops its pending recheck and is told once; one out of time asks its conversation', async () => {
    const m = montar();
    m.merge(); await m.v.repasar(m.ctx);
    m.v.informar('ABC-1', { checkpoint: 'pr-10', event: 'live' });
    m.v.informar('ABC-1', { checkpoint: 'pr-10', event: 'evidenced', signal: 'gone', evidence: '0 since the deploy' });
    await m.v.repasar(m.ctx);
    // the final one opened too (every PR merged): its own recheck is the one left
    expect(m.v.get('ABC-1')!.puntos.map(c => [c.estado, !!c.programado])).toEqual([['evidenced', false], ['waiting-deploy', true]]);
    expect(m.programados.size).toBe(1);
    expect(m.avisos).toHaveLength(1);
    m.pasar(25 * H); await m.v.repasar(m.ctx); await m.v.repasar(m.ctx);
    expect(m.v.get('ABC-1')!.puntos[1].estado).toBe('inconclusive');
    expect(m.avisos).toHaveLength(2);
    expect([...m.programados.values()].map(x => [x.cuando, x.mensaje.includes('AskUserQuestion')])).toEqual([[m.ahora(), true]]);
  });
});
