import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewLedger, answersReview, ledgerPending } from './reviewCount';

const fixture = JSON.parse(readFileSync(resolve(__dirname, '../test/fixtures/pr_review_ledger.json'), 'utf8'));
const pr = fixture.data.prs.nodes[0];

describe('cuenta de revisiones de un PR', () => {
  it('cuenta los hilos sin resolver que abrió otro, y cuáles están desfasados', () => {
    // c1 y c2 sin resolver (c2 desfasado); c3 resuelto; c4 lo abrió la autora
    const l = reviewLedger(pr, 'ana-autora');
    expect(l.unresolved).toBe(2);
    expect(l.outdated).toBe(1);
  });

  it('cuenta los resúmenes sin respuesta de la autora después de la revisión', () => {
    // r1 contestado nombrando a quien revisa, r6 citándolo; r2 (bot) sin contestar; r7 nombrado ANTES de la revisión: sin
    // contestar; fuera r3 (cortesía), r4 (sin texto) y r5 (aprobación)
    expect(reviewLedger(pr, 'ana-autora').unansweredSummaries).toBe(2);
  });

  it('una respuesta de la autora que enlaza la revisión también vale', () => {
    const withLink = { ...pr, comments: { nodes: [...pr.comments.nodes, { body: 'Arreglado lo de https://github.example/refugio/cola/pull/31#pullrequestreview-102', createdAt: '2026-11-10T12:00:00Z', author: { login: 'ana-autora' } }] } };
    expect(reviewLedger(withLink, 'ana-autora').unansweredSummaries).toBe(1);
  });

  it('sin nada pendiente, no hay nada que pintar', () => {
    const clean = { reviewThreads: { nodes: [] }, reviews: { nodes: [] }, comments: { nodes: [] } };
    expect(reviewLedger(clean, 'ana-autora')).toEqual({ unresolved: 0, outdated: 0, unansweredSummaries: 0 });
    expect(ledgerPending(reviewLedger(clean, 'ana-autora'))).toBe(false);
    expect(ledgerPending(reviewLedger(pr, 'ana-autora'))).toBe(true);
  });

  it('nombrar a otro con un login que empieza igual no contesta', () => {
    expect(answersReview('@bea-revisora-2 mira esto', { login: 'bea-revisora', body: 'x' })).toBe(false);
    expect(answersReview('Gracias @Bea-Revisora!', { login: 'bea-revisora', body: 'x' })).toBe(true);
  });
});
