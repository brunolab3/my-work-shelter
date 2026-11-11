import { describe, it, expect } from 'vitest';
import { targetFps, cameraMoved } from './ritmo';

describe('ritmo de pintado', () => {
  it('en automático: 60 moviéndose, 30 quieto y 10 con una ventana maximizada encima', () => {
    expect(targetFps('auto', { moving: true, covered: false })).toBe(60);
    expect(targetFps('auto', { moving: false, covered: false })).toBe(30);
    expect(targetFps('auto', { moving: true, covered: true })).toBe(10);
  });
  it('fijo: el elegido, haya lo que haya', () => {
    expect(targetFps('60', { moving: false, covered: true })).toBe(60);
    expect(targetFps('30', { moving: true, covered: false })).toBe(30);
  });
  it('la cámara solo cuenta como movida por encima del margen (su suavizado no llega nunca del todo)', () => {
    const a = Array.from({ length: 16 }, (_, i) => i);
    expect(cameraMoved(a, a.map(x => x + 1e-6))).toBe(false);
    expect(cameraMoved(a, a.map((x, i) => (i === 12 ? x + 0.01 : x)))).toBe(true);
  });
});
