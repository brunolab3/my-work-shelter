// Tablero de Logística: tareas de Jira con sus pull requests. El servidor trae las tareas (conector de Jira) y los PR
// (gh); aquí se cruzan por la clave de Jira que lleve el PR en la rama o en el título (p. ej. «ABC-123-arreglar-x»).
// Puro: lo usan el cliente y las pruebas.
import { t as tr } from './language';
import type { ReviewLedger } from './reviewCount';
import { sameStatus, type BoardStatuses } from './verification';

export type Category = 'new' | 'indeterminate' | 'done';
export interface TaskJira {
  key: string; title: string; url: string;
  state: string; category: Category;     // el nombre del estado en Jira y su categoría (Por hacer / En curso / Hecho)
  type?: string; priority?: string; project?: string; updated: number;
  color?: string;                           // el de la tarea, que reparte Logística (shared/tasks.ts)
  epic?: Epic;                             // its Jira epic (the parent, when it is one)
}
/** A task's epic: its key and summary, and its own color from the tasks' palette (assigned with them) */
export interface Epic { key: string; title: string; color?: string }
export type StatePR = 'abierto' | 'borrador' | 'fusionado' | 'cerrado';
export interface PRBoard {
  number: number; title: string; url: string; repo: string; branch: string; state: StatePR;
  review?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED';
  checks?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';
  updated: number;
  head?: string;             // el último commit de su rama en GitHub (server/taskCleanup.ts: lo del worktree ya está ahí)
  base?: string;               // la rama sobre la que va (si es la de otro PR, va apilado encima: shared/deploy.ts)
  dependencies?: string[];
  conflicts?: boolean;        // GitHub's mergeable: true = conflicts with its base, false = mergeable, undefined = still computing
  ledger?: ReviewLedger;       // lo que queda por contestar en sus revisiones (shared/reviewCount.ts; solo los abiertos)     // los PR («org/repo#N», o «rama:<rama>» si los nombra por su rama) de los que dice depender su descripción
}
export interface TaskWithPR extends TaskJira { prs: PRBoard[] }
export interface PRWithTask extends PRBoard { keys: string[]; tareas: TaskJira[] }

// Claves de Jira en un texto (rama o título), normalizadas y sin repetir: en mayúsculas siempre valen («ABC-123»); en
// minúsculas («feature/abc-123-x»), solo las de proyectos conocidos, para no tomar «utf-8» por una clave.
export function jiraKeys(text: string, projects: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![0-9])/g)) {
    const project = m[1].toUpperCase(), key = `${project}-${Number(m[2])}`;
    if (m[1] !== project && !projects.has(project)) continue;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

// Jira solo tiene tres categorías de estado; «Bloqueado» y «En revisión» salen del nombre del estado. Bloqueado: el
// estado se llama así (Blocked, Bloqueado, On hold, Impediment…), sea cual sea su categoría, salvo si ya está hecha.
// En revisión, de «En curso»: el estado se llama así (Review, Code review, En revisión…). Solo manda el estado de Jira:
// los PR de la tarea son informativos (salen en su ficha; su estado, en el plan de despliegue de Logística) y nunca
// la cambian de columna. Prod check: Jira's prod-check status, linked by the game or picked in the vault (production
// verification, server/verificationBoards.ts; one for all its projects), by that setting only; without one, nothing is there.
export type BoardColumn = 'porHacer' | 'enCurso' | 'bloqueado' | 'revision' | 'prodCheck' | 'hecho';
export const COLUMNS: { id: BoardColumn; name: string }[] = [
  { id: 'porHacer', name: 'Por hacer' }, { id: 'bloqueado', name: 'Bloqueado' }, { id: 'enCurso', name: 'En curso' },
  { id: 'revision', name: 'En revisión' }, { id: 'prodCheck', name: 'Prueba en producción' }, { id: 'hecho', name: 'Hecho' },
];
// El color de las columnas que tienen que distinguirse de un vistazo (las fichas llevan el de su tarea): verde en curso,
// azul en revisión, violeta prod check, rojo bloqueado
export const COLUMN_COLORS: Partial<Record<BoardColumn, string>> = { enCurso: '#5fd98a', revision: '#5aa8ff', prodCheck: '#c18cff', bloqueado: '#ff5a4a' };
export const isBlockedState = (state: string) => /block|bloque|impediment|on[ -]?hold|en espera/i.test(state);
/** Jira's prod-check status (settings.verificationJira: one for all its projects), if one is set */
export const prodCheckOf = (jira?: BoardStatuses) => jira?.test;
export function columnOfState(state: string, category: Category, prodCheck?: string): BoardColumn {
  if (sameStatus(state, prodCheck)) return 'prodCheck';
  if (category === 'done') return 'hecho';
  if (isBlockedState(state)) return 'bloqueado';
  if (category === 'new') return 'porHacer';
  return /review|revisi/i.test(state) ? 'revision' : 'enCurso';
}
export const columnOf = (t: TaskJira, jira?: BoardStatuses) => columnOfState(t.state, t.category, prodCheckOf(jira));

// Moving a card to another column: only the transitions Jira's workflow offers for that issue
// (GET /rest/api/3/issue/{key}/transitions), each with the status it leads to. A column takes those whose target status
// falls in it (columnOfState) and isn't the current one: none means it can't go there, more than one is the
// Overseer's pick. Never a forced status (server/integrations/jira.ts posts only one of these).
export interface JiraTransition { id: string; name: string; a: string; category: Category }
export function jiraTransitions(j: any): JiraTransition[] {
  return ((j?.transitions ?? []) as any[]).filter(x => x?.id && x.to?.name && x.isAvailable !== false).map(x => {
    const cat = x.to.statusCategory?.key;
    return { id: String(x.id), name: String(x.name ?? x.to.name), a: String(x.to.name), category: (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'indeterminate') as Category };
  });
}
export const isColumn = (c: unknown): c is BoardColumn => COLUMNS.some(x => x.id === c);
export function transitionsTo(trs: JiraTransition[], column: BoardColumn, current?: string, prodCheck?: string): JiraTransition[] {
  return trs.filter(x => columnOfState(x.a, x.category, prodCheck) === column && x.a !== current);
}

// «Hecho» solo enseña lo que se movió en la última semana (Jira trae dos, server/integrations/jira.ts)
export const DONE_DAYS = 7;
// Within a column, tasks of the same epic go together (the epic first): epics in the order their first task comes, tasks without one last
export function byEpic<T extends { key: string; epic?: Epic }>(tareas: T[]): T[] {
  const orden = new Map<string, number>();
  for (const t of tareas) if (t.epic && !orden.has(t.epic.key)) orden.set(t.epic.key, orden.size);
  const pos = (t: T) => t.epic ? orden.get(t.epic.key)! : orden.size;
  const isEpic = (t: T) => t.epic && t.key.toUpperCase() === t.epic.key ? 0 : 1;   // the epic itself heads its group
  return tareas.map((t, i) => ({ t, i })).sort((a, b) => pos(a.t) - pos(b.t) || isEpic(a.t) - isEpic(b.t) || a.i - b.i).map(x => x.t);
}

export function crossBoard(tareas: TaskJira[], prs: PRBoard[], jira?: BoardStatuses, now = Date.now()) {
  const projects = new Set(tareas.map(t => t.key.split('-')[0]));
  const withKeys: PRWithTask[] = prs.map(p => {
    const keys = jiraKeys(`${p.branch} ${p.title}`, projects);
    return { ...p, keys, tareas: tareas.filter(t => keys.includes(t.key)) };
  });
  const withPR: TaskWithPR[] = tareas.map(t => ({ ...t, prs: withKeys.filter(p => p.keys.includes(t.key)) }));
  return {
    columns: COLUMNS.map(c => ({ ...c, tareas: byEpic(withPR.filter(t => columnOf(t, jira) === c.id && (c.id !== 'hecho' || now - t.updated <= DONE_DAYS * 864e5))) })),
    prs: withKeys,
    withoutTask: withKeys.filter(p => !p.tareas.length),
  };
}

// Texto corto del estado de un PR, para la ficha: «abierto · aprobado · CI ✓»
export function prText(p: PRBoard): string {
  const state = { abierto: 'abierto', borrador: 'borrador', fusionado: 'fusionado', cerrado: 'cerrado' }[p.state];
  const rev = p.state === 'abierto' && p.review ? { APPROVED: 'aprobado', CHANGES_REQUESTED: 'piden cambios', REVIEW_REQUIRED: 'esperando revisión' }[p.review] : '';
  const ci = p.state === 'abierto' || p.state === 'borrador' ? (p.checks === 'SUCCESS' ? 'CI ✓' : p.checks === 'FAILURE' || p.checks === 'ERROR' ? 'CI ✗' : p.checks ? 'CI …' : '') : '';
  return [state, rev, ci].filter(Boolean).join(' · ');
}

// Texto plano de un documento de Atlassian (ADF, el formato de las descripciones de Jira en la API v3): párrafos y
// títulos en su línea, listas con guion o número, código entre ``` y enlaces y menciones como texto.
export function textOfADF(node: any): string {
  const line = (n: any): string => {
    if (!n) return '';
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'mention') return n.attrs?.text ?? '';
    if (n.type === 'emoji') return n.attrs?.text ?? n.attrs?.shortName ?? '';
    if (n.type === 'inlineCard' || n.type === 'blockCard') return n.attrs?.url ?? '';
    return ((n.content ?? []) as any[]).map(line).join('');
  };
  const block = (n: any): string => {
    const children = (n?.content ?? []) as any[];
    switch (n?.type) {
      case 'doc': return children.map(block).filter(Boolean).join('\n\n');
      case 'paragraph': return line(n);
      case 'heading': return '#'.repeat(Math.min(6, n.attrs?.level ?? 1)) + ' ' + line(n);
      case 'bulletList': case 'orderedList':
        return children.map((h, k) => (n.type === 'orderedList' ? `${k + 1}. ` : '- ') + block(h).replace(/\n/g, '\n  ')).join('\n');
      case 'listItem': return children.map(block).join('\n');
      case 'codeBlock': return '```' + (n.attrs?.language ?? '') + '\n' + line(n) + '\n```';
      case 'blockquote': return children.map(h => '> ' + block(h)).join('\n');
      case 'rule': return '---';
      case 'table': return children.map(f => '| ' + ((f.content ?? []) as any[]).map(c => ((c.content ?? []) as any[]).map(block).join(' ')).join(' | ') + ' |').join('\n');
      default: return children.length ? children.map(block).join('\n') : line(n);
    }
  };
  return typeof node === 'string' ? node : node ? block(node).trim() : '';
}

// Lo que recibe el habitante de la sala de coordinación (la carpeta con todos los repos) al planificar una tarea: leerla,
// ver qué repos toca, acordar el plan con el Supervisor y repartirlo con assign_work, una parte por sala de repo
export function planPrompt(t: TaskJira & { description?: string }): string {
  const data = [t.type, t.priority && tr('prompt.plan.priority', { p: t.priority }), t.project].filter(Boolean).join(' · ');
  return [
    `${t.key} ${t.title}`,
    '',
    tr('prompt.plan.intro', { url: t.url, datos: data ? ' · ' + data : '' }),
    '',
    t.description?.trim() ? tr('prompt.plan.description', { texto: t.description.trim() }) : tr('prompt.plan.noDescription'),
    '',
    '---',
    tr('prompt.plan.steps'),
  ].join('\n');
}
