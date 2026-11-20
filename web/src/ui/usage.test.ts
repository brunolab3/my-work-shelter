import { describe, expect, it } from 'vitest';
import { compactNeed } from './usage';

const ctx = (used: number, max = 1_000_000) => ({ used, max, percentage: Math.round(used / max * 100) });

describe('compactNeed', () => {
  it('by tokens on a large window: offers compact from 150k and urges it from 300k', () => {
    expect(compactNeed({ state: 'ociosa', context: ctx(149_000) })).toBe('no');
    expect(compactNeed({ state: 'ociosa', context: ctx(150_000) })).toBe('sugerido');
    expect(compactNeed({ state: 'terminada', context: ctx(299_000) })).toBe('sugerido');
    expect(compactNeed({ state: 'error', context: ctx(300_000) })).toBe('urgente');
  });
  it('by percentage on a small window: 40 % and 60 % come first', () => {
    expect(compactNeed({ state: 'ociosa', context: ctx(78_000, 200_000) })).toBe('no');
    expect(compactNeed({ state: 'ociosa', context: ctx(80_000, 200_000) })).toBe('sugerido');
    expect(compactNeed({ state: 'ociosa', context: ctx(120_000, 200_000) })).toBe('urgente');
  });
  it('only while idle: not working, waiting for an answer, starting or closed', () => {
    for (const state of ['trabajando', 'esperando', 'arrancando', 'cerrada'] as const) expect(compactNeed({ state, context: ctx(950_000) })).toBe('no');
  });
  it('not before the context is measured', () => {
    expect(compactNeed({ state: 'ociosa' })).toBe('no');
  });
});
