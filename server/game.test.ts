import { describe, it, expect } from 'vitest';
import { gameAction, ensurePlayer, taskReward } from './game.ts';
import { initialState } from './state.ts';

const store = () => { const a: any = { state: initialState(), change(f: (e: any) => void) { f(a.state); } }; ensurePlayer(a); return a; };

describe('economía validada por el servidor', () => {
  it('no se compra sin chatarra suficiente', () => {
    const a = store(); a.state.jugador.scrap = 10;
    expect(() => gameAction('comprar', { article: 'propulsor' }, a)).toThrow(/faltan/i);
    expect(a.state.jugador.scrap).toBe(10);
  });
  it('los puntos de tiro tienen techo y hay que esperar entre rondas', () => {
    const a = store(); const before = a.state.jugador.scrap;
    const r: any = gameAction('tiro', { puntos: 99999 }, a);
    expect(r.mejor).toBeLessThanOrEqual(600);
    expect(a.state.jugador.scrap - before).toBeLessThanOrEqual(50);
    expect(() => gameAction('tiro', { puntos: 10 }, a)).toThrow(/espera/i);
  });
  it('no se cosecha lo que no está maduro', () => {
    const a = store(); a.state.jugador.cultivos[0].phase = 2;
    expect(() => gameAction('cosechar', { bancal: 0 }, a)).toThrow(/madura/i);
  });
  it('cada tarea terminada da chatarra', () => {
    const a = store(); const before = a.state.jugador.scrap;
    const r = taskReward(a, 6);
    expect(r.scrap).toBeGreaterThan(0);
    expect(a.state.jugador.scrap).toBe(before + r.scrap);
  });
});
