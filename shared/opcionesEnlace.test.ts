// The ways to open a link of a reply (opcionesEnlace.ts): inside the game first whenever it can be seen there
import { describe, expect, it } from 'vitest';
import { webLinkOptions, fileLinkOptions, copyText } from './opcionesEnlace.ts';

const acciones = (l: { accion: string }[]) => l.map(o => o.accion);

describe("a link's options", () => {
  it('a web: inside first when the game can show it, then the browser and copying', () => {
    expect(acciones(webLinkOptions('https://example.com/a', { dentro: true }))).toEqual(['juego', 'navegador', 'copiar']);
    expect(acciones(webLinkOptions('http://example.com/a', { dentro: false }))).toEqual(['navegador', 'copiar']);
    expect(acciones(webLinkOptions('mailto:ana@example.com', { dentro: true }))).toEqual(['navegador', 'copiar']);
  });
  it('a file of the Mac: the game for pages and images, then where the Mac opens it, Finder and its path', () => {
    expect(acciones(fileLinkOptions({ juego: true, mac: 'web' }))).toEqual(['juego', 'mac', 'finder', 'copiar']);
    expect(acciones(fileLinkOptions({ juego: false, mac: 'editor' }))).toEqual(['mac', 'finder', 'copiar']);
    // a folder opens in Finder (no «reveal» besides); something that could run, only revealed
    expect(acciones(fileLinkOptions({ juego: false, mac: 'carpeta' }))).toEqual(['mac', 'copiar']);
    expect(acciones(fileLinkOptions({ juego: false, mac: 'finder' }))).toEqual(['finder', 'copiar']);
    expect(acciones(fileLinkOptions(null))).toEqual(['copiar']);
  });
  it('copies the address of a mail link and the path of a file:// one', () => {
    expect(copyText('mailto:ana@example.com?subject=x')).toBe('ana@example.com');
    expect(copyText('file:///Users/ana/mi%20plan.html')).toBe('/Users/ana/mi plan.html');
    expect(copyText('~/plan.md')).toBe('~/plan.md');
  });
});
