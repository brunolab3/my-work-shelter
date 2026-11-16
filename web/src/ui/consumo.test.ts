import { describe, expect, it } from 'vitest';
import { compactNeed } from './consumo';

const ctx = (porcentaje: number) => ({ usados: porcentaje * 2000, maximo: 200_000, porcentaje });

describe('compactNeed', () => {
  it('offers compact from 60 % and urges it from 85 %', () => {
    expect(compactNeed({ estado: 'ociosa', contexto: ctx(59) })).toBe('no');
    expect(compactNeed({ estado: 'ociosa', contexto: ctx(60) })).toBe('sugerido');
    expect(compactNeed({ estado: 'terminada', contexto: ctx(84) })).toBe('sugerido');
    expect(compactNeed({ estado: 'error', contexto: ctx(85) })).toBe('urgente');
  });
  it('only while idle: not working, waiting for an answer, starting or closed', () => {
    for (const estado of ['trabajando', 'esperando', 'arrancando', 'cerrada'] as const) expect(compactNeed({ estado, contexto: ctx(95) })).toBe('no');
  });
  it('not before the context is measured', () => {
    expect(compactNeed({ estado: 'ociosa' })).toBe('no');
  });
});
