import { describe, expect, it } from 'vitest';
import { byEpic, jiraKeys, crossBoard, jiraTransitions, transitionsTo, isColumn, prText, textOfADF, planPrompt, type PRBoard, type TaskJira } from './board';

const task = (key: string, category: TaskJira['category'], state = 'En curso'): TaskJira => ({ key, title: 't ' + key, url: 'https://jira.example/browse/' + key, state, category, updated: Date.now() });
const pr = (number: number, branch: string, title = 'PR', state: PRBoard['state'] = 'abierto', extra: Partial<PRBoard> = {}): PRBoard =>
  ({ number, title, url: 'https://github.com/x/y/pull/' + number, repo: 'x/y', branch, state, updated: 0, ...extra });

describe('clavesJira', () => {
  it('lee claves en mayúsculas de la rama y del título, sin repetir', () => {
    expect(jiraKeys('feature/ABC-12-arreglo ABC-12 y XY2-7')).toEqual(['ABC-12', 'XY2-7']);
  });
  it('en minúsculas solo valen las de proyectos conocidos (no «utf-8»)', () => {
    expect(jiraKeys('abc-12-arreglo utf-8', new Set(['ABC']))).toEqual(['ABC-12']);
    expect(jiraKeys('abc-12-arreglo')).toEqual([]);
  });
  it('no corta números ni toma trozos de palabras', () => {
    expect(jiraKeys('ABC-1234 xABC-5 ABC-12345678')).toEqual(['ABC-1234']);
  });
});

describe('crossBoard', () => {
  it('cada tarea lleva sus PR por la clave de la rama o del título, y los demás quedan sin tarea', () => {
    const r = crossBoard(
      [task('ABC-1', 'indeterminate'), task('ABC-2', 'new', 'Por hacer'), task('ABC-3', 'done', 'Hecho')],
      [pr(10, 'abc-1-rama'), pr(11, 'otra', 'ABC-1 segundo PR', 'borrador'), pr(12, 'ABC-3-x', 'x', 'fusionado'), pr(13, 'sin-clave'), pr(14, 'ZZZ-9-ajena')],
    );
    expect(r.columns.map(c => [c.name, c.tareas.map(t => [t.key, t.prs.map(p => p.number)])])).toEqual([
      ['Por hacer', [['ABC-2', []]]],
      ['Bloqueado', []],
      ['En curso', [['ABC-1', [10, 11]]]],
      ['En revisión', []],
      ['Hecho', [['ABC-3', [12]]]],
    ]);
    expect(r.prs.find(p => p.number === 12)!.tareas.map(t => t.state)).toEqual(['Hecho']);
    expect(r.withoutTask.map(p => [p.number, p.keys])).toEqual([[13, []], [14, ['ZZZ-9']]]);
  });
});

describe('tasks grouped by epic', () => {
  const from = (key: string, epic?: string) => ({ ...task(key, 'indeterminate'), ...(epic ? { epic: { key: epic, title: 'e ' + epic } } : {}) });
  it('epics in the order of their first task, tasks without one last, the rest keeps its order', () => {
    expect(byEpic([from('A-1'), from('A-2', 'E-2'), from('A-3', 'E-1'), from('A-4', 'E-2'), from('A-5')]).map(t => t.key)).toEqual(['A-2', 'A-4', 'A-3', 'A-1', 'A-5']);
  });
  it('an epic on the board heads its own group', () => {
    expect(byEpic([from('A-1', 'E-1'), from('A-2'), from('E-1', 'E-1'), from('A-3', 'E-1')]).map(t => t.key)).toEqual(['E-1', 'A-1', 'A-3', 'A-2']);
  });
  it('each column of the board comes grouped', () => {
    const r = crossBoard([from('A-1'), from('A-2', 'E-1'), from('A-3'), from('A-4', 'E-1')], []);
    expect(r.columns.find(c => c.id === 'enCurso')!.tareas.map(t => t.key)).toEqual(['A-2', 'A-4', 'A-1', 'A-3']);
  });
});

describe('columna En revisión', () => {
  it('va a revisión solo lo que se llama así en Jira: un PR abierto, borrador o fusionado no la mueve', () => {
    const r = crossBoard(
      [task('ABC-1', 'indeterminate'), task('ABC-2', 'indeterminate', 'Code Review'), task('ABC-3', 'indeterminate'), task('ABC-4', 'indeterminate')],
      [pr(1, 'ABC-3-x', 'x', 'borrador'), pr(2, 'ABC-4-x', 'x', 'abierto'), pr(3, 'ABC-1-x', 'x', 'fusionado')],
    );
    const col = (id: string) => r.columns.find(c => c.id === id)!.tareas.map(t => t.key);
    expect(col('enCurso')).toEqual(['ABC-1', 'ABC-3', 'ABC-4']);
    expect(col('revision')).toEqual(['ABC-2']);
  });
});

describe('columna Bloqueado', () => {
  it('va a bloqueado lo que se llama así en Jira, aunque tenga un PR abierto o Jira lo cuente como por hacer', () => {
    const r = crossBoard(
      [task('ABC-1', 'indeterminate', 'Blocked'), task('ABC-2', 'new', 'On Hold'), task('ABC-3', 'indeterminate', 'Bloqueado'), task('ABC-4', 'done', 'Blocked'), task('ABC-5', 'indeterminate')],
      [pr(1, 'ABC-3-x', 'x', 'abierto')],
    );
    const col = (id: string) => r.columns.find(c => c.id === id)!.tareas.map(t => t.key);
    expect(r.columns.map(c => c.id)).toEqual(['porHacer', 'bloqueado', 'enCurso', 'revision', 'hecho']);
    expect(col('bloqueado')).toEqual(['ABC-1', 'ABC-2', 'ABC-3']);
    expect(col('hecho')).toEqual(['ABC-4']);
    expect(col('enCurso')).toEqual(['ABC-5']);
  });
});

describe('columna Hecho', () => {
  it('solo enseña lo terminado en la última semana', () => {
    const day = 864e5, now = 30 * day;
    const r = crossBoard([{ ...task('ABC-1', 'done'), updated: now - 2 * day }, { ...task('ABC-2', 'done'), updated: now - 8 * day }], [], now);
    expect(r.columns.find(c => c.id === 'hecho')!.tareas.map(t => t.key)).toEqual(['ABC-1']);
  });
});

describe('textoPR', () => {
  it('estado, revisión y CI', () => {
    expect(prText(pr(1, 'r', 'x', 'abierto', { review: 'CHANGES_REQUESTED', checks: 'FAILURE' }))).toBe('abierto · piden cambios · CI ✗');
    expect(prText(pr(1, 'r', 'x', 'borrador', { checks: 'PENDING' }))).toBe('borrador · CI …');
    expect(prText(pr(1, 'r', 'x', 'fusionado', { review: 'APPROVED', checks: 'SUCCESS' }))).toBe('fusionado');
  });
});

describe('textOfADF', () => {
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
    expect(textOfADF(adf)).toBe('## Contexto\n\nHola @Ana\nhttps://x.example\n\n- uno\n- dos\n\n1. paso\n\n```sql\nselect 1\n```');
  });
  it('sin descripción, vacío; con texto plano (API v2), tal cual', () => {
    expect(textOfADF(null)).toBe('');
    expect(textOfADF('ya es texto')).toBe('ya es texto');
  });
});

describe('planPrompt', () => {
  it('empieza por la clave y el título, lleva la descripción y pide plan antes de repartir', () => {
    const p = planPrompt({ ...task('ABC-7', 'new', 'Por hacer'), title: 'Reservas en grupo', type: 'Historia', description: 'Que se pueda reservar para 10.' });
    expect(p.split('\n')[0]).toBe('ABC-7 Reservas en grupo');
    expect(p).toContain('(https://jira.example/browse/ABC-7) · Historia');
    expect(p).toContain('Descripción:\n\nQue se pueda reservar para 10.');
    expect(p).toContain('assign_work');
  });
  it('sin descripción, la pide', () => {
    expect(planPrompt(task('ABC-7', 'new'))).toContain('No tengo su descripción');
  });
});

describe('transitionsTo', () => {
  const tr = (id: string, name: string, to: string, key: string, extra: object = {}) => ({ id, name, to: { name: to, statusCategory: { key } }, ...extra });
  const trs = jiraTransitions({ transitions: [
    tr('11', 'Start', 'In Progress', 'indeterminate'), tr('21', 'Send to review', 'Code Review', 'indeterminate'),
    tr('31', 'Done', 'Done', 'done'), tr('32', "Won't do", 'Closed', 'done'), tr('41', 'Block', 'Blocked', 'indeterminate'),
    tr('51', 'Hidden', 'QA', 'indeterminate', { isAvailable: false }), { id: '61', name: 'broken' },
  ] });
  it('reads only the transitions Jira offers, with their target status and category', () => {
    expect(trs.map(x => [x.id, x.a, x.category])).toEqual([['11', 'In Progress', 'indeterminate'], ['21', 'Code Review', 'indeterminate'], ['31', 'Done', 'done'], ['32', 'Closed', 'done'], ['41', 'Blocked', 'indeterminate']]);
  });
  it('a column takes the transitions whose target falls in it: one, several (the Overseer picks) or none', () => {
    expect(transitionsTo(trs, 'enCurso').map(x => x.id)).toEqual(['11']);
    expect(transitionsTo(trs, 'revision').map(x => x.id)).toEqual(['21']);
    expect(transitionsTo(trs, 'bloqueado').map(x => x.id)).toEqual(['41']);
    expect(transitionsTo(trs, 'hecho').map(x => x.id)).toEqual(['31', '32']);
    expect(transitionsTo(trs, 'porHacer')).toEqual([]);
  });
  it('never the status it is already in', () => {
    expect(transitionsTo(trs, 'enCurso', 'In Progress')).toEqual([]);
  });
  it('only board columns are valid targets', () => {
    expect(isColumn('hecho')).toBe(true);
    expect(isColumn('Done')).toBe(false);
  });
});
