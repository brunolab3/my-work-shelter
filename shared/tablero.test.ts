import { describe, expect, it } from 'vitest';
import { clavesJira, cruzarTablero, textoPR, textoDeADF, promptPlanificar, type PRBoard, type TaskJira } from './tablero';

const tarea = (clave: string, categoria: TaskJira['categoria'], estado = 'En curso'): TaskJira => ({ clave, titulo: 't ' + clave, url: 'https://jira.example/browse/' + clave, estado, categoria, actualizada: 0 });
const pr = (numero: number, rama: string, titulo = 'PR', estado: PRBoard['estado'] = 'abierto', extra: Partial<PRBoard> = {}): PRBoard =>
  ({ numero, titulo, url: 'https://github.com/x/y/pull/' + numero, repo: 'x/y', rama, estado, actualizado: 0, ...extra });

describe('clavesJira', () => {
  it('lee claves en mayúsculas de la rama y del título, sin repetir', () => {
    expect(clavesJira('feature/ABC-12-arreglo ABC-12 y XY2-7')).toEqual(['ABC-12', 'XY2-7']);
  });
  it('en minúsculas solo valen las de proyectos conocidos (no «utf-8»)', () => {
    expect(clavesJira('abc-12-arreglo utf-8', new Set(['ABC']))).toEqual(['ABC-12']);
    expect(clavesJira('abc-12-arreglo')).toEqual([]);
  });
  it('no corta números ni toma trozos de palabras', () => {
    expect(clavesJira('ABC-1234 xABC-5 ABC-12345678')).toEqual(['ABC-1234']);
  });
});

describe('cruzarTablero', () => {
  it('cada tarea lleva sus PR por la clave de la rama o del título, y los demás quedan sin tarea', () => {
    const r = cruzarTablero(
      [tarea('ABC-1', 'indeterminate'), tarea('ABC-2', 'new', 'Por hacer'), tarea('ABC-3', 'done', 'Hecho')],
      [pr(10, 'abc-1-rama'), pr(11, 'otra', 'ABC-1 segundo PR', 'borrador'), pr(12, 'ABC-3-x', 'x', 'fusionado'), pr(13, 'sin-clave'), pr(14, 'ZZZ-9-ajena')],
    );
    expect(r.columnas.map(c => [c.nombre, c.tareas.map(t => [t.clave, t.prs.map(p => p.numero)])])).toEqual([
      ['Por hacer', [['ABC-2', []]]],
      ['En curso', []],
      ['En revisión', [['ABC-1', [10, 11]]]],
      ['Hecho', [['ABC-3', [12]]]],
    ]);
    expect(r.prs.find(p => p.numero === 12)!.tareas.map(t => t.estado)).toEqual(['Hecho']);
    expect(r.withoutTask.map(p => [p.numero, p.claves])).toEqual([[13, []], [14, ['ZZZ-9']]]);
  });
});

describe('columna En revisión', () => {
  it('va a revisión lo que se llama así en Jira o tiene un PR abierto; un borrador sigue en curso', () => {
    const r = cruzarTablero(
      [tarea('ABC-1', 'indeterminate'), tarea('ABC-2', 'indeterminate', 'Code Review'), tarea('ABC-3', 'indeterminate'), tarea('ABC-4', 'indeterminate')],
      [pr(1, 'ABC-3-x', 'x', 'borrador'), pr(2, 'ABC-4-x', 'x', 'abierto'), pr(3, 'ABC-1-x', 'x', 'fusionado')],
    );
    const col = (id: string) => r.columnas.find(c => c.id === id)!.tareas.map(t => t.clave);
    expect(col('enCurso')).toEqual(['ABC-1', 'ABC-3']);
    expect(col('revision')).toEqual(['ABC-2', 'ABC-4']);
  });
});

describe('textoPR', () => {
  it('estado, revisión y CI', () => {
    expect(textoPR(pr(1, 'r', 'x', 'abierto', { revision: 'CHANGES_REQUESTED', checks: 'FAILURE' }))).toBe('abierto · piden cambios · CI ✗');
    expect(textoPR(pr(1, 'r', 'x', 'borrador', { checks: 'PENDING' }))).toBe('borrador · CI …');
    expect(textoPR(pr(1, 'r', 'x', 'fusionado', { revision: 'APPROVED', checks: 'SUCCESS' }))).toBe('fusionado');
  });
});

describe('textoDeADF', () => {
  it('pasa la descripción de Jira (ADF) a texto: títulos, párrafos, listas, código y enlaces', () => {
    const adf = { type: 'doc', version: 1, content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Contexto' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Hola ' }, { type: 'mention', attrs: { text: '@Ana' } }, { type: 'hardBreak' }, { type: 'inlineCard', attrs: { url: 'https://x.example' } }] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'dos' }] }] },
      ] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'paso' }] }] }] },
      { type: 'codeBlock', attrs: { language: 'sql' }, content: [{ type: 'text', text: 'select 1' }] },
    ] };
    expect(textoDeADF(adf)).toBe('## Contexto\n\nHola @Ana\nhttps://x.example\n\n- uno\n- dos\n\n1. paso\n\n```sql\nselect 1\n```');
  });
  it('sin descripción, vacío; con texto plano (API v2), tal cual', () => {
    expect(textoDeADF(null)).toBe('');
    expect(textoDeADF('ya es texto')).toBe('ya es texto');
  });
});

describe('promptPlanificar', () => {
  it('empieza por la clave y el título, lleva la descripción y pide plan antes de repartir', () => {
    const p = promptPlanificar({ ...tarea('ABC-7', 'new', 'Por hacer'), titulo: 'Reservas en grupo', tipo: 'Historia', descripcion: 'Que se pueda reservar para 10.' });
    expect(p.split('\n')[0]).toBe('ABC-7 Reservas en grupo');
    expect(p).toContain('(https://jira.example/browse/ABC-7) · Historia');
    expect(p).toContain('Descripción:\n\nQue se pueda reservar para 10.');
    expect(p).toContain('repartir_trabajo');
  });
  it('sin descripción, la pide', () => {
    expect(promptPlanificar(tarea('ABC-7', 'new'))).toContain('No tengo su descripción');
  });
});
