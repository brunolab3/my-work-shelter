import { describe, expect, it } from 'vitest';
import { pagesInText, sessionPages, pendingPages, samePage, pageLink, livePages } from './paginasSesion.ts';

const CMP = '/Users/ana/Library/Application Support/work-shelter-public/comparaciones/repo-rama.html';

describe('pagesInText', () => {
  it('enlaces Markdown, con <…> (espacios), file:// y rutas sueltas; solo HTML y Markdown, sin repetir', () => {
    const texto = `Plan: [plan](/Users/ana/repo/tmp/plan.html). Compare: [c](<${CMP}>) y [otra vez](/Users/ana/repo/tmp/plan.html)
      Informe en /Users/ana/repo/informe.md, código en /Users/ana/repo/a.ts y [x](file:///Users/ana/r/b%20c.htm)`;
    expect(pagesInText(texto)).toEqual(['/Users/ana/repo/tmp/plan.html', CMP, '/Users/ana/repo/informe.md', '/Users/ana/r/b c.htm']);
  });
});

describe('pagesInText con espacios', () => {
  it('[x](ruta con espacios) sin <…> y la ruta suelta, sin tragarse la frase', () => {
    expect(pagesInText(`[c](${CMP}) — 5 archivos`)).toEqual([CMP]);
    expect(pagesInText(`Lista en ${CMP}. Revísala`)).toEqual([CMP]);
    expect(pagesInText('Mira /Users/ana/a.html y luego b.html')).toEqual(['/Users/ana/a.html']);
  });
});

describe('samePage', () => {
  it('~ frente a /Users/<nombre> y /tmp frente a /private/tmp', () => {
    expect(samePage('~/r/p.html', '/Users/ana/r/p.html')).toBe(true);
    expect(samePage('/private/tmp/p.html', '/tmp/p.html')).toBe(true);
    expect(samePage('/Users/ana/r/p.html', '/Users/ana/r/q.html')).toBe(false);
  });
});

describe('sessionPages', () => {
  const entradas = [
    { tipo: 'asistente', texto: 'Mira [plan](/Users/ana/r/plan.html)', ts: 10 },
    { tipo: 'usuario', texto: 'y /Users/ana/r/mio.html', ts: 15 },
    { tipo: 'asistente', texto: `La comparación: [c](<${CMP}>)`, ts: 20 },
    { tipo: 'asistente', texto: 'Plan cambiado: /Users/ana/r/plan.html', ts: 30 },
  ];
  it('las que enlaza el habitante, la última primero; contestadas solo si es después de la última vez que se enlazó', () => {
    const l = sessionPages(entradas, { '/Users/ana/r/plan.html': { estado: 'notas', ts: 25 }, [CMP]: { estado: 'validada', ts: 21 } });
    expect(l.map(p => [p.nombre, p.ts, p.respuesta?.estado])).toEqual([['plan.html', 30, undefined], ['repo-rama.html', 20, 'validada']]);
    expect(pendingPages(l).map(p => p.nombre)).toEqual(['plan.html']);
  });
  it('las quitadas de la lista no salen, salvo que se vuelvan a enlazar después', () => {
    expect(sessionPages(entradas, { '/Users/ana/r/plan.html': { estado: 'quitada', ts: 31 } }).map(p => p.nombre)).toEqual(['repo-rama.html']);
    expect(sessionPages(entradas, { '/Users/ana/r/plan.html': { estado: 'quitada', ts: 25 } }).map(p => p.nombre)).toEqual(['plan.html', 'repo-rama.html']);
  });
});

describe('pageLink', () => {
  it('con espacios va entre <…>, para que el enlace no se corte', () => {
    expect(pageLink(CMP)).toBe(`[repo-rama.html](<${CMP}>)`);
    expect(pageLink('/Users/ana/r/p.html', 'Plan')).toBe('[Plan](/Users/ana/r/p.html)');
    expect(pagesInText(pageLink(CMP))).toEqual([CMP]);
  });
});

describe('livePages', () => {
  it('solo las enlazadas en las dos últimas semanas y que siguen en el Mac', () => {
    const ahora = 100 * 86_400_000, dia = 86_400_000;
    const l = sessionPages([
      { tipo: 'asistente', texto: '/Users/ana/r/vieja.html', ts: ahora - 20 * dia },
      { tipo: 'asistente', texto: '/Users/ana/r/.claude/worktrees/x/plan.html', ts: ahora - dia },
      { tipo: 'asistente', texto: '/Users/ana/r/nueva.html', ts: ahora - dia },
    ], {});
    expect(livePages(l, null, ahora).map(p => p.nombre).sort()).toEqual(['nueva.html', 'plan.html']);
    expect(livePages(l, new Set(['/Users/ana/r/nueva.html']), ahora).map(p => p.nombre)).toEqual(['nueva.html']);
  });
});
