// Tablero de Logística: tareas de Jira con sus pull requests. El servidor trae las tareas (conector de Jira) y los PR
// (gh); aquí se cruzan por la clave de Jira que lleve el PR en la rama o en el título (p. ej. «ABC-123-arreglar-x»).
// Puro: lo usan el cliente y las pruebas.
import { t as tr } from './idioma';

export type Category = 'new' | 'indeterminate' | 'done';
export interface TaskJira {
  clave: string; titulo: string; url: string;
  estado: string; categoria: Category;     // el nombre del estado en Jira y su categoría (Por hacer / En curso / Hecho)
  tipo?: string; prioridad?: string; proyecto?: string; actualizada: number;
  color?: string;                           // el de la tarea, que reparte Logística (shared/tareas.ts)
}
export type StatePR = 'abierto' | 'borrador' | 'fusionado' | 'cerrado';
export interface PRBoard {
  numero: number; titulo: string; url: string; repo: string; rama: string; estado: StatePR;
  revision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED';
  checks?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';
  actualizado: number;
  base?: string;               // la rama sobre la que va (si es la de otro PR, va apilado encima: shared/despliegue.ts)
  dependencias?: string[];     // los PR («org/repo#N», o «rama:<rama>» si los nombra por su rama) de los que dice depender su descripción
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

// Jira solo tiene tres categorías de estado; «En revisión» sale de «En curso»: el estado se llama así (Review, Code
// review, En revisión…) o la tarea ya tiene un PR abierto (no borrador) esperando a que lo revisen.
export type BoardColumn = 'porHacer' | 'enCurso' | 'revision' | 'hecho';
export const COLUMNS: { id: BoardColumn; nombre: string }[] = [
  { id: 'porHacer', nombre: 'Por hacer' }, { id: 'enCurso', nombre: 'En curso' }, { id: 'revision', nombre: 'En revisión' }, { id: 'hecho', nombre: 'Hecho' },
];
export function columnOf(t: TaskWithPR): BoardColumn {
  if (t.categoria === 'new') return 'porHacer';
  if (t.categoria === 'done') return 'hecho';
  return /review|revisi/i.test(t.estado) || t.prs.some(p => p.estado === 'abierto') ? 'revision' : 'enCurso';
}

export function cruzarTablero(tareas: TaskJira[], prs: PRBoard[]) {
  const proyectos = new Set(tareas.map(t => t.clave.split('-')[0]));
  const withKeys: PRWithTask[] = prs.map(p => {
    const claves = clavesJira(`${p.rama} ${p.titulo}`, proyectos);
    return { ...p, claves, tareas: tareas.filter(t => claves.includes(t.clave)) };
  });
  const withPR: TaskWithPR[] = tareas.map(t => ({ ...t, prs: withKeys.filter(p => p.claves.includes(t.clave)) }));
  return {
    columnas: COLUMNS.map(c => ({ ...c, tareas: withPR.filter(t => columnOf(t) === c.id) })),
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
// ver qué repos toca, acordar el plan con el Supervisor y repartirlo con repartir_trabajo, una parte por sala de repo
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
