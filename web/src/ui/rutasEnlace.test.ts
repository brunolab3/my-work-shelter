// Rutas del Mac sueltas en el texto: se enlazan solas (rutasEnlace.ts), pero no dentro de código ni de otro enlace
import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import { localPathLinks } from './rutasEnlace';

const md = (texto: string) => new Marked({ gfm: true }, localPathLinks).parse(texto, { async: false }) as string;

describe('rutas del Mac sueltas en el texto', () => {
  it('una ruta suelta en una pregunta se vuelve enlace, sin el punto o el signo con que acaba la frase', () => {
    expect(md('Compare is ready: /Users/ana/repo/tmp/compare.html. Do you approve?'))
      .toBe('<p>Compare is ready: <a href="/Users/ana/repo/tmp/compare.html">/Users/ana/repo/tmp/compare.html</a>. Do you approve?</p>\n');
    expect(md('Mira ~/plan.md, y dime')).toContain('<a href="~/plan.md">~/plan.md</a>, y dime');
    expect(md('(file:///Users/ana/a.html)')).toContain('(<a href="file:///Users/ana/a.html">file:///Users/ana/a.html</a>)');
  });
  it('nunca dentro de código, de un enlace escrito ni a media palabra', () => {
    expect(md('`/Users/ana/a.html`')).not.toContain('<a ');
    expect(md('```\n/Users/ana/a.html\n```')).not.toContain('<a ');
    expect(md('[/Users/ana/a.html](/Users/ana/a.html)')).toBe('<p><a href="/Users/ana/a.html">/Users/ana/a.html</a></p>\n');
    expect(md('src/Users/ana/a.ts')).not.toContain('<a ');
  });
  it('una página en una carpeta con espacios («Application Support»), suelta o en un enlace sin <…>', () => {
    const r = '/Users/ana/Library/Application Support/work-shelter-public/comparaciones/repo-rama.html';
    const href = '/Users/ana/Library/Application%20Support/work-shelter-public/comparaciones/repo-rama.html';
    expect(md(`Lista: ${r}. ¿Vale?`)).toContain(`<a href="${href}">${r}</a>. ¿Vale?`);
    expect(md(`[repo-rama.html](${r}) — 5 archivos`)).toBe(`<p><a href="${href}">repo-rama.html</a> — 5 archivos</p>\n`);
    expect(md(`[c](<${r}>)`)).toContain(`<a href="${href}">c</a>`);
    // los espacios solo dentro de una carpeta: no se traga el resto de la frase
    expect(md('Mira /Users/ana/a.html y luego b.html')).toContain('<a href="/Users/ana/a.html">/Users/ana/a.html</a> y luego b.html');
  });
});
