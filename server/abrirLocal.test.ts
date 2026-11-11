import { describe, expect, it } from 'vitest';
import { linkPath } from './abrir.ts';

describe('enlaces a archivos del Mac en las respuestas', () => {
  it('ruta absoluta, file://, ~ y sin la línea, la consulta ni el ancla', () => {
    expect(linkPath('/Users/ana/repo/informe.html', '/Users/ana')).toBe('/Users/ana/repo/informe.html');
    expect(linkPath('file:///Users/ana/mi%20informe.html', '/Users/ana')).toBe('/Users/ana/mi informe.html');
    expect(linkPath('~/repo/src/a.ts:12:3', '/Users/ana')).toBe('/Users/ana/repo/src/a.ts');
    expect(linkPath('/Users/ana/repo/a.ts#L40', '/Users/ana')).toBe('/Users/ana/repo/a.ts');
  });
  it('lo que no es una ruta de este Mac, no', () => {
    expect(linkPath('src/a.ts', '/Users/ana')).toBeNull();
    expect(linkPath('https://example.com/a.html', '/Users/ana')).toBeNull();
  });
});
