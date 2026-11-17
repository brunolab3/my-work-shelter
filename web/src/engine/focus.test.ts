import { describe, it, expect } from 'vitest';
import { isInFirstMap } from './foco';

describe('primer plano del juego', () => {
  it('fuera de la vista (minimizado, tapado, otro escritorio) no cuenta, tenga o no el foco', () => {
    expect(isInFirstMap(false, true, true)).toBe(false);
    expect(isInFirstMap(false, null, true)).toBe(false);
  });

  it('en Electron manda el foco de la ventana, no el del documento (un navegador del refugio con el foco no la saca)', () => {
    expect(isInFirstMap(true, true, false)).toBe(true);
    expect(isInFirstMap(true, false, true)).toBe(false);
  });

  it('sin aviso de Electron (navegador de desarrollo) se pregunta al documento', () => {
    expect(isInFirstMap(true, null, true)).toBe(true);
    expect(isInFirstMap(true, null, false)).toBe(false);
  });
});
