// Tablero de Logística: tareas de Jira con sus pull requests. El servidor trae las tareas (conector de Jira) y los PR
// (gh); aquí se cruzan por la clave de Jira que lleve el PR en la rama o en el título (p. ej. «ABC-123-arreglar-x»).
// Puro: lo usan el cliente y las pruebas.
import { t as tr } from './language';
import type { ReviewLedger } from './reviewCount';

export type Category = 'new' | 'indeterminate' | 'done';
export interface TaskJira {
  clave: string; titulo: string; url: string;
  estado: string; categoria: Category;     // el nombre del estado en Jira y su categoría (Por hacer / En curso / Hecho)
  tipo?: string; prioridad?: string; proyecto?: string; actualizada: number;
  color?: string;                           // el de la tarea, que reparte Logística (shared/tasks.ts)
  epica?: Epic;                             // its Jira epic (the parent, when it is one)
}
/** A task's epic: its key and summary, and its own color from the tasks' palette (assigned with them) */
export interface Epic { clave: string; titulo: string; color?: string }
export type StatePR = 'abierto' | 'borrador' | 'fusionado' | 'cerrado';
export interface PRBoard {
  numero: number; titulo: string; url: string; repo: string; rama: string; estado: StatePR;
  revision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED';
  checks?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';
  actualizado: number;
  cabeza?: string;             // el último commit de su rama en GitHub (server/taskCleanup.ts: lo del worktree ya está ahí)
  base?: string;               // la rama sobre la que va (si es la de otro PR, va apilado encima: shared/deploy.ts)
  dependencias?: string[];
  conflictos?: boolean;        // GitHub's mergeable: true = conflicts with its base, false = mergeable, undefined = still computing
  ledger?: ReviewLedger;       // lo que queda por contestar en sus revisiones (shared/reviewCount.ts; solo los abiertos)     // los PR («org/repo#N», o «rama:<rama>» si los nombra por su rama) de los que dice depender su descripción
}
export interface TaskWithPR extends TaskJira { prs: PRBoard[] }
export interface PRWithTask extends PRBoard { claves: string[]; tareas: TaskJira[] }

// Claves de Jira en un texto (rama o título), normalizadas y sin repetir: en mayúsculas siempre valen («ABC-123»); en
// minúsculas («feature/abc-123-x»), solo las de proyectos conocidos, para no tomar «utf-8» por una clave.
export function clavesJira(texto: string, proyectos: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/(?<![A-Za-z0-9])([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})(?![0-9])/g)) {
    const proyecto = m[1].toUpperCase(), clave = `${proyecto}-${Number(m[2])}`;
    if (m[1] !== proyecto && !proyectos.has(proyecto)) continue;
    if (!out.includes(clave)) out.push(clave);
  }
  return out;
}

// Jira solo tiene tres categorías de estado; «Bloqueado» y «En revisión» salen del nombre del estado. Bloqueado: el
// estado se llama así (Blocked, Bloqueado, On hold, Impediment…), sea cual sea su categoría, salvo si ya está hecha.
// En revisión, de «En curso»: el estado se llama así (Review, Code review, En revisión…). Solo manda el estado de Jira:
// los PR de la tarea son informativos (salen en su ficha; su estado, en el plan de despliegue de Logística) y nunca
// la cambian de columna.
export type BoardColumn = 'porHacer' | 'enCurso' | 'bloqueado' | 'revision' | 'hecho';
export const COLUMNS: { id: BoardColumn; nombre: string }[] = [
  { id: 'porHacer', nombre: 'Por hacer' }, { id: 'bloqueado', nombre: 'Bloqueado' }, { id: 'enCurso', nombre: 'En curso' },
  { id: 'revision', nombre: 'En revisión' }, { id: 'hecho', nombre: 'Hecho' },
];
// El color de las columnas que tienen que distinguirse de un vistazo (las fichas llevan el de su tarea): verde en curso,
// azul en revisión, rojo bloqueado
export const COLUMN_COLORS: Partial<Record<BoardColumn, string>> = { enCurso: '#5fd98a', revision: '#5aa8ff', bloqueado: '#ff5a4a' };
export const isBlockedState = (estado: string) => /block|bloque|impediment|on[ -]?hold|en espera/i.test(estado);
export function columnOfState(estado: string, categoria: Category): BoardColumn {
  if (categoria === 'done') return 'hecho';
  if (isBlockedState(estado)) return 'bloqueado';
  if (categoria === 'new') return 'porHacer';
  return /review|revisi/i.test(estado) ? 'revision' : 'enCurso';
}
export const columnOf = (t: TaskJira) => columnOfState(t.estado, t.categoria);

// Moving a card to another column: only the transitions Jira's workflow offers for that issue
// (GET /rest/api/3/issue/{key}/transitions), each with the status it leads to. A column takes those whose target status
// falls in it (columnOfState) and isn't the current one: none means it can't go there, more than one is the
// Overseer's pick. Never a forced status (server/integrations/jira.ts posts only one of these).
export interface JiraTransition { id: string; nombre: string; a: string; categoria: Category }
export function jiraTransitions(j: any): JiraTransition[] {
  return ((j?.transitions ?? []) as any[]).filter(x => x?.id && x.to?.name && x.isAvailable !== false).map(x => {
    const cat = x.to.statusCategory?.key;
    return { id: String(x.id), nombre: String(x.name ?? x.to.name), a: String(x.to.name), categoria: (['new', 'indeterminate', 'done'].includes(cat) ? cat : 'indeterminate') as Category };
  });
}
export const isColumn = (c: unknown): c is BoardColumn => COLUMNS.some(x => x.id === c);
export function transitionsTo(trs: JiraTransition[], columna: BoardColumn, actual?: string): JiraTransition[] {
  return trs.filter(x => columnOfState(x.a, x.categoria) === columna && x.a !== actual);
}

// «Hecho» solo enseña lo que se movió en la última semana (Jira trae dos, server/integrations/jira.ts)
export const DONE_DAYS = 7;
// Within a column, tasks of the same epic go together: epics in the order their first task comes, tasks without one last
export function byEpic<T extends { epica?: Epic }>(tareas: T[]): T[] {
  const orden = new Map<string, number>();
  for (const t of tareas) if (t.epica && !orden.has(t.epica.clave)) orden.set(t.epica.clave, orden.size);
  const pos = (t: T) => t.epica ? orden.get(t.epica.clave)! : orden.size;
  return tareas.map((t, i) => ({ t, i })).sort((a, b) => pos(a.t) - pos(b.t) || a.i - b.i).map(x => x.t);
}

export function cruzarTablero(tareas: TaskJira[], prs: PRBoard[], ahora = Date.now()) {
  const proyectos = new Set(tareas.map(t => t.clave.split('-')[0]));
  const withKeys: PRWithTask[] = prs.map(p => {
    const claves = clavesJira(`${p.rama} ${p.titulo}`, proyectos);
    return { ...p, claves, tareas: tareas.filter(t => claves.includes(t.clave)) };
  });
  const withPR: TaskWithPR[] = tareas.map(t => ({ ...t, prs: withKeys.filter(p => p.claves.includes(t.clave)) }));
  return {
    columnas: COLUMNS.map(c => ({ ...c, tareas: byEpic(withPR.filter(t => columnOf(t) === c.id && (c.id !== 'hecho' || ahora - t.actualizada <= DONE_DAYS * 864e5))) })),
    prs: withKeys,
    withoutTask: withKeys.filter(p => !p.tareas.length),
  };
}

// Texto corto del estado de un PR, para la ficha: «abierto · aprobado · CI ✓»
export function textoPR(p: PRBoard): string {
  const estado = { abierto: 'abierto', borrador: 'borrador', fusionado: 'fusionado', cerrado: 'cerrado' }[p.estado];
  const rev = p.estado === 'abierto' && p.revision ? { APPROVED: 'aprobado', CHANGES_REQUESTED: 'piden cambios', REVIEW_REQUIRED: 'esperando revisión' }[p.revision] : '';
  const ci = p.estado === 'abierto' || p.estado === 'borrador' ? (p.checks === 'SUCCESS' ? 'CI ✓' : p.checks === 'FAILURE' || p.checks === 'ERROR' ? 'CI ✗' : p.checks ? 'CI …' : '') : '';
  return [estado, rev, ci].filter(Boolean).join(' · ');
}

// Texto plano de un documento de Atlassian (ADF, el formato de las descripciones de Jira en la API v3): párrafos y
// títulos en su línea, listas con guion o número, código entre ``` y enlaces y menciones como texto.
export function textoDeADF(nodo: any): string {
  const linea = (n: any): string => {
    if (!n) return '';
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'mention') return n.attrs?.text ?? '';
    if (n.type === 'emoji') return n.attrs?.text ?? n.attrs?.shortName ?? '';
    if (n.type === 'inlineCard' || n.type === 'blockCard') return n.attrs?.url ?? '';
    return ((n.content ?? []) as any[]).map(linea).join('');
  };
  const bloque = (n: any): string => {
    const hijos = (n?.content ?? []) as any[];
    switch (n?.type) {
      case 'doc': return hijos.map(bloque).filter(Boolean).join('\n\n');
      case 'paragraph': return linea(n);
      case 'heading': return '#'.repeat(Math.min(6, n.attrs?.level ?? 1)) + ' ' + linea(n);
      case 'bulletList': case 'orderedList':
        return hijos.map((h, k) => (n.type === 'orderedList' ? `${k + 1}. ` : '- ') + bloque(h).replace(/\n/g, '\n  ')).join('\n');
      case 'listItem': return hijos.map(bloque).join('\n');
      case 'codeBlock': return '```' + (n.attrs?.language ?? '') + '\n' + linea(n) + '\n```';
      case 'blockquote': return hijos.map(h => '> ' + bloque(h)).join('\n');
      case 'rule': return '---';
      case 'table': return hijos.map(f => '| ' + ((f.content ?? []) as any[]).map(c => ((c.content ?? []) as any[]).map(bloque).join(' ')).join(' | ') + ' |').join('\n');
      default: return hijos.length ? hijos.map(bloque).join('\n') : linea(n);
    }
  };
  return typeof nodo === 'string' ? nodo : nodo ? bloque(nodo).trim() : '';
}

// Lo que recibe el habitante de la sala de coordinación (la carpeta con todos los repos) al planificar una tarea: leerla,
// ver qué repos toca, acordar el plan con el Supervisor y repartirlo con assign_work, una parte por sala de repo
export function promptPlanificar(t: TaskJira & { descripcion?: string }): string {
  const datos = [t.tipo, t.prioridad && tr('prompt.plan.priority', { p: t.prioridad }), t.proyecto].filter(Boolean).join(' · ');
  return [
    `${t.clave} ${t.titulo}`,
    '',
    tr('prompt.plan.intro', { url: t.url, datos: datos ? ' · ' + datos : '' }),
    '',
    t.descripcion?.trim() ? tr('prompt.plan.description', { texto: t.descripcion.trim() }) : tr('prompt.plan.noDescription'),
    '',
    '---',
    tr('prompt.plan.steps'),
  ].join('\n');
}
