import { describe, expect, it } from 'vitest';
import { pagesInText, sessionPages, pendingPages, samePage, pageLink, livePages, relativeLinks, questionInput } from './paginasSesion.ts';

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
  it('las contestadas, solo las enlazadas en las dos últimas semanas; las pendientes, durante un mes; y que sigan en el Mac', () => {
    const ahora = 100 * 86_400_000, dia = 86_400_000;
    const l = sessionPages([
      { tipo: 'asistente', texto: '/Users/ana/r/vieja.html', ts: ahora - 20 * dia },
      { tipo: 'asistente', texto: '/Users/ana/r/revisada.html', ts: ahora - 20 * dia },
      { tipo: 'asistente', texto: '/Users/ana/r/antigua.html', ts: ahora - 40 * dia },
      { tipo: 'asistente', texto: '/Users/ana/r/.claude/worktrees/x/plan.html', ts: ahora - dia },
      { tipo: 'asistente', texto: '/Users/ana/r/nueva.html', ts: ahora - dia },
    ], { '/Users/ana/r/revisada.html': { estado: 'validada', ts: ahora - 19 * dia } });
    expect(livePages(l, null, ahora).map(p => p.nombre).sort()).toEqual(['nueva.html', 'plan.html', 'vieja.html']);
    expect(livePages(l, new Set(['/Users/ana/r/nueva.html']), ahora).map(p => p.nombre)).toEqual(['nueva.html']);
  });
});

describe('páginas con ruta relativa', () => {
  const B = '/Users/ana/Code/app-web/.claude/worktrees/ltd';
  it('las enlaza a la carpeta de la conversación: sueltas, en código en línea y como destino de un enlace', () => {
    expect(relativeLinks('The investigation is done (report in tmp/ltd-lock-skips-report.md). What next?', B))
      .toBe(`The investigation is done (report in [tmp/ltd-lock-skips-report.md](<${B}/tmp/ltd-lock-skips-report.md>)). What next?`);
    expect(relativeLinks('Informe: `tmp/informe.md`, plan en ./docs/plan.html.', B))
      .toBe(`Informe: [\`tmp/informe.md\`](<${B}/tmp/informe.md>), plan en [./docs/plan.html](<${B}/docs/plan.html>).`);
    expect(relativeLinks('[el informe](tmp/a.md) y [README](<README.md>)', B)).toBe(`[el informe](<${B}/tmp/a.md>) y [README](<${B}/README.md>)`);
  });
  it('deja como estaban las rutas absolutas, las web, los bloques de código, «..», otros archivos y el texto de un enlace', () => {
    const igual = [
      'Mira /Users/ana/r/plan.html y ~/x/b.md',
      'En https://example.com/docs/a.md y file:///tmp/a.html',
      '```\ncat tmp/a.md\n```',
      'Sube a ../fuera.md',
      'Cambia src/app/main.py y tmp/a.md.bak',
      '[ver tmp/a.md](https://example.com)',
      'The source is [ABC-1_multi-day-pass.md](/Users/ana/r/.claude/worktrees/ABC-1/plans/ABC-1_multi-day-pass.md), committed',
      'Compare: /Users/ana/r/tmp/compare_ABC-1.html and [x](<~/a b/plan_v2.md>)',
    ];
    for (const x of igual) expect(relativeLinks(x, B)).toBe(x);
    expect(relativeLinks('tmp/a.md', undefined)).toBe('tmp/a.md');
  });
  it('salen en las páginas de la conversación con su ruta completa', () => {
    const l = sessionPages([{ tipo: 'asistente', texto: 'Done: tmp/ltd-lock-skips-report.md and /Users/ana/r/plan.html', ts: 5 }], {}, B);
    expect(l.map(p => p.ruta).sort()).toEqual([`${B}/tmp/ltd-lock-skips-report.md`, '/Users/ana/r/plan.html']);
    expect(pagesInText('Done: tmp/ltd-lock-skips-report.md')).toEqual([]);   // sin carpeta, como antes
  });
});

describe('páginas enlazadas en una pregunta', () => {
  it('cuentan la pregunta pendiente (también sus opciones) y la respuesta que la lleva; lo demás que escribe el Supervisor, no', () => {
    const q = questionInput([{ question: 'Push? The compare is at /Users/ana/r/tmp/compare.html.', options: [{ label: 'Sí', description: 'Plan in /Users/ana/r/plan.md' }] }], 3);
    expect(sessionPages([q], {}).map(p => p.ruta).sort()).toEqual(['/Users/ana/r/plan.md', '/Users/ana/r/tmp/compare.html']);
    const respondida = { tipo: 'usuario', texto: '**Push? The compare is at /Users/ana/r/tmp/compare.html.** → Sí', ts: 4, pregunta: true };
    expect(sessionPages([respondida], {}).map(p => p.ruta)).toEqual(['/Users/ana/r/tmp/compare.html']);
    expect(sessionPages([{ ...respondida, pregunta: undefined }], {})).toEqual([]);
  });
});

describe('páginas que llegan con un encargo de otra sala', () => {
  it('cuentan las del mensaje 📨 (y no lo que escribe el Supervisor)', () => {
    const l = sessionPages([
      { tipo: 'usuario', texto: '📨 Message from the “Logística” room (Inés), task ABC-1:\n\nPlan: /Users/ana/r/plans/03-target.md', ts: 1 },
      { tipo: 'usuario', texto: 'mira /Users/ana/r/otra.md', ts: 2 },
    ], {});
    expect(l.map(p => p.ruta)).toEqual(['/Users/ana/r/plans/03-target.md']);
  });
});
