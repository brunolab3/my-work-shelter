// El color de cada tarea, el mismo en todas partes: tableros (Jira, despliegue, pull requests, organizar), pantallas de
// las salas y el holograma del worktree que la trabaja. Así se ve de un vistazo qué tarea tiene sesiones en qué sala.
// The task is a Jira key (from the branch, the title or the worktree name) or, for work not tied to Jira, a descriptive
// kebab slug (`preflight-popover`); without either, the PR number (PR-12).
// Puro: lo usan el cliente, el servidor y las pruebas.

const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/i;
const SLUG_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A task key as typed, normalized: a Jira key uppercased (abc-12 → ABC-12), a descriptive slug lowercased
 *  (2–40 chars of kebab case), anything else undefined */
export function taskKey(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (JIRA_KEY.test(s)) return s.toUpperCase();
  const l = s.toLowerCase();
  return l.length >= 2 && l.length <= 40 && SLUG_KEY.test(l) ? l : undefined;
}
/** Whether a key is Jira-shaped (or PR-12): only those get Jira lookups and links */
export const isJiraKey = (k: string) => JIRA_KEY.test(k);

/** The Jira key in a branch or a name (feature/ABC-123-algo, shelter-abc-123 → ABC-123; shelter-pr-12 → PR-12). Never a
 *  slug: those can't be told apart from prose, so they're only read from worktree names (slugKeyOf) */
export const textKey = (texto: string): string | undefined => /(?:^|[^a-z0-9])([a-z][a-z0-9]+-\d+)(?=$|[^0-9])/i.exec(texto ?? '')?.[1]?.toUpperCase();

/** The slug key of a worktree name or its branch, as the game names them: `shelter-<slug>--<suffix>` (branch
 *  `worktree-shelter-<slug>--<suffix>`). The double hyphen can't come out of a Jira worktree's name */
export const slugKeyOf = (nombre: string): string | undefined => /^(?:worktree-)?shelter-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-z0-9]+$/.exec(nombre ?? '')?.[1];

/** A task's worktree name for a slug key (a Jira one goes through nombreWorktree with its subject) */
export const slugWorktreeName = (clave: string, suffix: string) => `shelter-${clave}--${suffix}`;

/** The task of a branch: its slug key if the game named it, else its Jira key */
export const branchTask = (rama: string) => slugKeyOf(rama) ?? textKey(rama);

/** La tarea de un PR: su clave (rama, luego la de Jira del título) o, sin ella, PR-<número> */
export const pRTask = (p: { rama: string; titulo: string; numero: number }) => branchTask(p.rama) ?? textKey(p.titulo) ?? `PR-${p.numero}`;

/** La tarea de un worktree: por su nombre (estable aunque se cambie de rama dentro) y, si no, por su rama */
export function worktreeTask(w: { ruta: string; rama?: string }): string | undefined {
  const nombre = w.ruta.replace(/\/+$/, '').split('/').pop() ?? '';
  return slugKeyOf(nombre) ?? textKey(nombre.replace(/^shelter-/, '')) ?? (w.rama ? branchTask(w.rama) : undefined);
}

/** Whether a worktree works a task: by its name or by its branch (exact keys, never a substring: ABC-1 isn't ABC-12) */
export function worktreeHasTask(w: { ruta: string; rama?: string }, clave: string): boolean {
  const k = taskKey(clave);
  return !!k && (worktreeTask(w) === k || (!!w.rama && branchTask(w.rama) === k));
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

/** True when a session outside any worktree (a room's main copy) runs `git worktree add`: worktrees come from
 *  send_to_room with a task key, which opens a session in them */
export function handMadeWorktree(cmd: string, worktree?: string): boolean {
  return !worktree && !!newWorktreeOf(cmd);
}

/** The original repo, whose author reads no pull requests or issues (README) */
export const ORIGINAL_REPO = 'DavidTorrijos/work-shelter-public';
export const isOriginalRepo = (r: string) => r.trim().toLowerCase() === ORIGINAL_REPO.toLowerCase();

/** `owner/repo` of a GitHub remote URL (https or ssh), or undefined */
export function githubRepoOf(url: string): string | undefined {
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];
}

/** If a Bash command runs `gh pr create` or `gh issue create`: its `-R/--repo` target (undefined without one), or null */
export function ghCreateOf(cmd: string): { repo?: string } | null {
  for (const trozo of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = trozo.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;
    if (!/(^|\/)gh$/.test(w[i] ?? '') || !/^(pr|issue)$/.test(w[i + 1] ?? '') || w[i + 2] !== 'create') continue;
    let repo: string | undefined;
    for (let k = i + 3; k < w.length; k++) {
      if (w[k] === '-R' || w[k] === '--repo') repo = w[++k];
      else if (w[k].startsWith('--repo=')) repo = w[k].slice(7);
    }
    return { repo: repo?.replace(/^(https:\/\/)?github\.com\//, '') };
  }
  return null;
}

/** Si una orden de Bash crea un worktree (`git worktree add`, también con -C): su ruta y su rama nueva (-b/-B), o null */
export function newWorktreeOf(cmd: string): { ruta?: string; rama?: string; cwd?: string } | null {
  for (const trozo of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = trozo.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;
    if (!/(^|\/)git$/.test(w[i] ?? '')) continue;
    i++;
    let cwd: string | undefined;
    while (i < w.length && w[i].startsWith('-')) { if (w[i] === '-C') { cwd = w[i + 1]; i += 2; } else if (w[i] === '-c') i += 2; else i++; }
    if (w[i] !== 'worktree' || w[i + 1] !== 'add') continue;
    const resto = w.slice(i + 2);
    let rama: string | undefined; const libres: string[] = [];
    for (let k = 0; k < resto.length; k++) {
      if (resto[k] === '-b' || resto[k] === '-B') rama = resto[++k];
      else if (resto[k] === '--reason') k++;
      else if (!resto[k].startsWith('-')) libres.push(resto[k]);
    }
    return { ruta: libres[0], rama: rama ?? (libres[1] && !/^(HEAD|main|master|origin\/)/.test(libres[1]) ? libres[1] : undefined), cwd };
  }
  return null;
}

/** El worktree (no la copia principal) que ya tiene una tarea, leyendo `git worktree list --porcelain` */
export function taskWorktreeIn(porcelain: string, tarea: string): { ruta: string; rama?: string } | undefined {
  const bloques = porcelain.split('\n\n').map(b => ({ ruta: /^worktree (.+)$/m.exec(b)?.[1] ?? '', rama: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] })).filter(w => w.ruta);
  return bloques.slice(1).find(w => worktreeTask(w) === taskKey(tarea));
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
