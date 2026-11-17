// The ways to open a link of a reply (opcionesEnlace.ts): inside the game first whenever it can be seen there
import { describe, expect, it } from 'vitest';
import { webLinkOptions, fileLinkOptions, copyText, pageLinkTarget } from './opcionesEnlace.ts';

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
  it("a page's link: files of the Mac (relative ones next to the page), webs and mail; nothing else", () => {
    const P = '/Users/ana/plans/mi plan.html';
    expect(pageLinkTarget('/Users/ana/x.html', P)).toEqual({ ruta: '/Users/ana/x.html' });
    expect(pageLinkTarget('~/x.md', P)).toEqual({ ruta: '~/x.md' });
    expect(pageLinkTarget('otro%20plan.html#a', P)).toEqual({ ruta: '/Users/ana/plans/otro plan.html' });
    expect(pageLinkTarget('../informe.html', P)).toEqual({ ruta: '/Users/ana/informe.html' });
    expect(pageLinkTarget('file:///tmp/a.png', P)).toEqual({ ruta: '/tmp/a.png' });
    expect(pageLinkTarget('https://example.com/a', P)).toEqual({ href: 'https://example.com/a' });
    expect(pageLinkTarget('mailto:ana@example.com', P)).toEqual({ href: 'mailto:ana@example.com' });
    for (const x of ['#a', '', 'javascript:alert(1)', 'data:text/html,x', '/etc/passwd', 'file:///etc/hosts', 42]) expect(pageLinkTarget(x, P)).toBeNull();
  });
});
