import { describe, expect, it } from 'vitest';
import { compactNeed } from './usage';

const ctx = (percentage: number) => ({ used: percentage * 2000, max: 200_000, percentage });

describe('compactNeed', () => {
  it('offers compact from 40 % and urges it from 60 %', () => {
    expect(compactNeed({ state: 'ociosa', context: ctx(39) })).toBe('no');
    expect(compactNeed({ state: 'ociosa', context: ctx(40) })).toBe('sugerido');
    expect(compactNeed({ state: 'terminada', context: ctx(59) })).toBe('sugerido');
    expect(compactNeed({ state: 'error', context: ctx(60) })).toBe('urgente');
  });
  it('only while idle: not working, waiting for an answer, starting or closed', () => {
    for (const state of ['trabajando', 'esperando', 'arrancando', 'cerrada'] as const) expect(compactNeed({ state, context: ctx(95) })).toBe('no');
  });
  it('not before the context is measured', () => {
    expect(compactNeed({ state: 'ociosa' })).toBe('no');
  });
});
