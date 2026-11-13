// El color de cada tarea, el mismo en todas partes: tableros (Jira, despliegue, pull requests, organizar), pantallas de
// las salas y el holograma del worktree que la trabaja. Así se ve de un vistazo qué tarea tiene sesiones en qué sala.
// La tarea es la clave de Jira (de la rama, el título o el nombre del worktree); sin clave, el número del PR (PR-12).
// Puro: lo usan el cliente, el servidor y las pruebas.

/** La clave de Jira de una rama o un nombre (feature/ABC-123-algo, shelter-abc-123 → ABC-123; shelter-pr-12 → PR-12) */
export const textKey = (texto: string): string | undefined => /(?:^|[^a-z0-9])([a-z][a-z0-9]+-\d+)(?=$|[^0-9])/i.exec(texto ?? '')?.[1]?.toUpperCase();

/** La tarea de un PR: su clave de Jira (rama, luego título) o, sin ella, PR-<número> */
export const pRTask = (p: { rama: string; titulo: string; numero: number }) => textKey(p.rama) ?? textKey(p.titulo) ?? `PR-${p.numero}`;

/** La tarea de un worktree: por su nombre (estable aunque se cambie de rama dentro) y, si no, por su rama */
export function worktreeTask(w: { ruta: string; rama?: string }): string | undefined {
  const nombre = w.ruta.replace(/\/+$/, '').split('/').pop() ?? '';
  return textKey(nombre.replace(/^shelter-/, '')) ?? (w.rama ? textKey(w.rama) : undefined);
}

/** Los PR de la tarea de un worktree en el repo de su sala, el más reciente primero: los de su rama y los de su misma
 *  tarea (todas las ramas de la tarea). El repo sale de los PR de su rama y, si no hay o hay varios, del nombre de la
 *  carpeta de la sala; sin repo claro, solo los de su rama */
export function worktreePRs<P extends { rama: string; titulo: string; numero: number; repo: string; actualizado: number }>(
  prs: P[], w: { ruta: string; rama: string }, carpetaSala: string): P[] {
  const tarea = worktreeTask(w);
  const deSuRama = prs.filter(p => p.rama === w.rama);
  const repos = new Set(deSuRama.map(p => p.repo.toLowerCase()));
  const carpeta = carpetaSala.replace(/\/+$/, '').split('/').pop()?.toLowerCase();
  const porNombre = carpeta ? [...new Set(prs.map(p => p.repo.toLowerCase()))].find(r => r.split('/').pop() === carpeta) : undefined;
  const repo = repos.size === 1 ? [...repos][0] : porNombre;
  const lista = !repo ? deSuRama
    : prs.filter(p => p.repo.toLowerCase() === repo && (p.rama === w.rama || (!!tarea && pRTask(p) === tarea)));
  return [...lista].sort((a, b) => b.actualizado - a.actualizado);
}

/** El nombre de una conversación en Remote Control (la app de Claude y claude.ai/code): `repo:TAREA` (la del worktree o,
 *  si no, la clave del título) y, sin tarea, `repo:título`. `wt`: el worktree en el que trabaja, si es uno */
export function remoteName(repo: string, titulo: string, wt?: { ruta: string; rama?: string }): string {
  const tarea = (wt && worktreeTask(wt)) ?? textKey(titulo);
  return `${repo}:${tarea ?? (titulo.trim() || 'work-shelter')}`;
}

// La paleta de las tareas: 16 colores bien distintos (sin rojos, que son avería y bloqueos, ni el cian de serie de los
// hologramas), en un orden en el que cada uno se aleja de los anteriores. El servidor da a cada tarea nueva el que menos
// se usa entre las recientes y lo guarda (server/coloresTareas.ts): así dos tareas a la vez casi nunca comparten color.
export const TASKS_PALETTE = ['#ffd23f', '#c77dff', '#4dabff', '#7bff5d', '#ff8fd1', '#ff9f43', '#00c896', '#a0a8ff',
  '#f5f5a0', '#ff6fff', '#2f7dff', '#b8ff9f', '#d9a066', '#e0b0ff', '#3ee0b0', '#ffb3a0'];

/** Los colores ya asignados (los manda el servidor; web/src/ui/tareas.ts los pide para las tareas que se ven) */
export const assignedColors = new Map<string, string>();

/** El color de una tarea: el asignado o, hasta que llegue, uno de la paleta por la clave */
export function taskColor(clave: string): string {
  const k = clave.toUpperCase();
  const ya = assignedColors.get(k); if (ya) return ya;
  let h = 2166136261;
  for (const c of k) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return TASKS_PALETTE[(h >>> 0) % TASKS_PALETTE.length];
}

/** A qué color va cada clave nueva: el menos usado entre las asignadas (y, a igualdad, el primero de la paleta) */
export function assignColors(assigned: Record<string, number>, claves: string[]): Record<string, number> {
  const out = { ...assigned };
  const usos = TASKS_PALETTE.map(() => 0);
  for (const i of Object.values(out)) usos[i] = (usos[i] ?? 0) + 1;
  for (const c of claves.map(x => x.toUpperCase())) {
    if (c in out) continue;
    const i = usos.indexOf(Math.min(...usos));
    out[c] = i; usos[i]++;
  }
  return out;
}
