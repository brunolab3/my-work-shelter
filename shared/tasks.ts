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
export const textKey = (text: string): string | undefined => /(?:^|[^a-z0-9])([a-z][a-z0-9]+-\d+)(?=$|[^0-9])/i.exec(text ?? '')?.[1]?.toUpperCase();

/** The slug key of a worktree name or its branch, as the game names them: `shelter-<slug>--<suffix>` (branch
 *  `worktree-shelter-<slug>--<suffix>`). The double hyphen can't come out of a Jira worktree's name */
export const slugKeyOf = (name: string): string | undefined => /^(?:worktree-)?shelter-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)--[a-z0-9]+$/.exec(name ?? '')?.[1];

/** A task's worktree name for a slug key (a Jira one goes through worktreeName with its subject) */
export const slugWorktreeName = (key: string, suffix: string) => `shelter-${key}--${suffix}`;

/** The task of a branch: its slug key if the game named it, else its Jira key */
export const branchTask = (branch: string) => slugKeyOf(branch) ?? textKey(branch);

/** La tarea de un PR: su clave (rama, luego la de Jira del título) o, sin ella, PR-<número> */
export const pRTask = (p: { branch: string; title: string; number: number }) => branchTask(p.branch) ?? textKey(p.title) ?? `PR-${p.number}`;

/** A task's caption: its key and, when known, its title shortened to `max` characters (the key stays whole) */
export function taskCaption(key: string, title?: string, max = 28): string {
  const t = title?.replace(/\s+/g, ' ').trim();
  return t ? `${key} · ${t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t}` : key;
}

/** La tarea de un worktree: por su nombre (estable aunque se cambie de rama dentro) y, si no, por su rama */
export function worktreeTask(w: { path: string; branch?: string }): string | undefined {
  const name = w.path.replace(/\/+$/, '').split('/').pop() ?? '';
  return slugKeyOf(name) ?? textKey(name.replace(/^shelter-/, '')) ?? (w.branch ? branchTask(w.branch) : undefined);
}

/** Whether a worktree works a task: by its name or by its branch (exact keys, never a substring: ABC-1 isn't ABC-12) */
export function worktreeHasTask(w: { path: string; branch?: string }, key: string): boolean {
  const k = taskKey(key);
  return !!k && (worktreeTask(w) === k || (!!w.branch && branchTask(w.branch) === k));
}

/** Los PR de la tarea de un worktree en el repo de su sala, el más reciente primero: los de su rama y los de su misma
 *  tarea (todas las ramas de la tarea). El repo sale de los PR de su rama y, si no hay o hay varios, del nombre de la
 *  carpeta de la sala; sin repo claro, solo los de su rama */
export function worktreePRs<P extends { branch: string; title: string; number: number; repo: string; updated: number }>(
  prs: P[], w: { path: string; branch: string }, roomFolder: string): P[] {
  const task = worktreeTask(w);
  const ofBranch = prs.filter(p => p.branch === w.branch);
  const repos = new Set(ofBranch.map(p => p.repo.toLowerCase()));
  const folder = roomFolder.replace(/\/+$/, '').split('/').pop()?.toLowerCase();
  const byName = folder ? [...new Set(prs.map(p => p.repo.toLowerCase()))].find(r => r.split('/').pop() === folder) : undefined;
  const repo = repos.size === 1 ? [...repos][0] : byName;
  const list = !repo ? ofBranch
    : prs.filter(p => p.repo.toLowerCase() === repo && (p.branch === w.branch || (!!task && pRTask(p) === task)));
  return [...list].sort((a, b) => b.updated - a.updated);
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
  for (const chunk of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = chunk.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
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
export function newWorktreeOf(cmd: string): { path?: string; branch?: string; cwd?: string } | null {
  for (const chunk of String(cmd ?? '').split(/&&|\|\||[;|\n]/)) {
    const w = chunk.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(x => x.replace(/^["']|["']$/g, '')) ?? [];
    let i = 0;
    while (i < w.length && /^[A-Z_][A-Z0-9_]*=/.test(w[i])) i++;
    if (!/(^|\/)git$/.test(w[i] ?? '')) continue;
    i++;
    let cwd: string | undefined;
    while (i < w.length && w[i].startsWith('-')) { if (w[i] === '-C') { cwd = w[i + 1]; i += 2; } else if (w[i] === '-c') i += 2; else i++; }
    if (w[i] !== 'worktree' || w[i + 1] !== 'add') continue;
    const rest = w.slice(i + 2);
    let branch: string | undefined; const free: string[] = [];
    for (let k = 0; k < rest.length; k++) {
      if (rest[k] === '-b' || rest[k] === '-B') branch = rest[++k];
      else if (rest[k] === '--reason') k++;
      else if (!rest[k].startsWith('-')) free.push(rest[k]);
    }
    return { path: free[0], branch: branch ?? (free[1] && !/^(HEAD|main|master|origin\/)/.test(free[1]) ? free[1] : undefined), cwd };
  }
  return null;
}

/** El worktree (no la copia principal) que ya tiene una tarea, leyendo `git worktree list --porcelain` */
export function taskWorktreeIn(porcelain: string, task: string): { path: string; branch?: string } | undefined {
  const blocks = porcelain.split('\n\n').map(b => ({ path: /^worktree (.+)$/m.exec(b)?.[1] ?? '', branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] })).filter(w => w.path);
  return blocks.slice(1).find(w => worktreeTask(w) === taskKey(task));
}

/** El nombre de una conversación en Remote Control (la app de Claude y claude.ai/code): `repo:TAREA` (la del worktree o,
 *  si no, la clave del título) y, sin tarea, `repo:título`. `wt`: el worktree en el que trabaja, si es uno */
export function remoteName(repo: string, title: string, wt?: { path: string; branch?: string }): string {
  const task = (wt && worktreeTask(wt)) ?? textKey(title);
  return `${repo}:${task ?? (title.trim() || 'work-shelter')}`;
}

// The tasks' palette: 16 well-distinct colors (no reds, which mean faults and blocks, nor NO_TASK_COLOR), ordered so each
// one moves away from the previous ones. The server gives each new task the least used among recent ones and saves it
// (server/taskColors.ts): so two tasks at a time almost never share a color.
export const TASKS_PALETTE = ['#ffd23f', '#c77dff', '#4dabff', '#7bff5d', '#ff8fd1', '#ff9f43', '#00c896', '#a0a8ff',
  '#f5f5a0', '#ff6fff', '#2f7dff', '#b8ff9f', '#d9a066', '#e0b0ff', '#3ee0b0', '#ffb3a0'];

/** Los colores ya asignados (los manda el servidor; web/src/ui/tasks.ts los pide para las tareas que se ven) */
export const assignedColors = new Map<string, string>();

/** The color of everything that isn't a board task (slug tasks, worktrees without a task): the holograms' cyan, outside
 *  the palette so it's never taken for a real task's */
export const NO_TASK_COLOR = '#58e6ff';

/** Whether a key gets a task color: Jira keys (and PR-12) do, from the palette; descriptive slugs don't, so they never
 *  share a color with a board task */
export const hasTaskColor = (key: string | undefined): key is string => !!key && isJiraKey(key);

/** The epic key of each task, as the Jira board last read it (web/src/ui/tasks.ts fills it with the colors) */
export const assignedEpics = new Map<string, string>();

const hashKey = (k: string) => { let h = 2166136261; for (const c of k) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

function toHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
function toHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l, 100 - l) / 100, f = (n: number) => {
    const k = (n + h / 30) % 12, c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// CIE Lab, to measure how far apart two colors look (ΔE, Euclidean in Lab: under ~10 they read as one at a glance)
function toLab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), lin = (c: number) => (c /= 255) > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92;
  const r = lin(n >> 16), g = lin((n >> 8) & 255), b = lin(n & 255), f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** How different two colors look (CIE76 ΔE) */
export const colorDistance = (a: string, b: string) => { const p = toLab(a), q = toLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

const FAMILY_HUE = 45, RED_HUES = 25, FAULT_COLOR = '#ff6a4a';
const families = new Map<string, string[]>();
/** An epic's family: one shade per palette slot, all within ±45° of the epic's hue (never red), picked one by one as far
 *  as possible from the epic's own color, the holograms' cyan, the fault red and the shades before it. So any two tasks of
 *  an epic (their slots differ: the server spreads them) look clearly apart, the first few the most */
function family(base: string): string[] {
  const known = families.get(base); if (known) return known;
  const [hue] = toHsl(base), pool: string[] = [];
  for (let dh = -FAMILY_HUE; dh <= FAMILY_HUE; dh += 5) {
    const h = (hue + dh + 360) % 360;
    if (h >= RED_HUES && h <= 360 - RED_HUES) for (const l of [40, 50, 60, 70, 80]) for (const s of [65, 100]) pool.push(toHex(h, s, l));
  }
  const taken = [base, NO_TASK_COLOR, FAULT_COLOR].map(toLab), labs = pool.map(toLab), out: string[] = [];
  const gap = (p: number[]) => Math.min(...taken.map(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
  while (out.length < TASKS_PALETTE.length) {
    let best = 0; for (let i = 1; i < pool.length; i++) if (gap(labs[i]) > gap(labs[best])) best = i;
    out.push(pool[best]); taken.push(labs[best]);
  }
  families.set(base, out);
  return out;
}

/** A task's shade within its epic's family, by its slot (the index of its own palette color) */
export const familyShade = (base: string, slot: number): string => family(base)[slot % TASKS_PALETTE.length];

/** A task's own color: the assigned one or, until it arrives, one from the palette by its key */
const baseColor = (k: string) => assignedColors.get(k) || TASKS_PALETTE[hashKey(k) % TASKS_PALETTE.length];

/** A task's color: in an epic, a shade of the epic's family (the epic's own color, which its mark wears, is the base);
 *  otherwise the assigned palette color. NO_TASK_COLOR for keys without a task color */
export function taskColor(key: string | undefined): string {
  if (!hasTaskColor(key)) return NO_TASK_COLOR;
  const k = key.toUpperCase(), epic = assignedEpics.get(k);
  return epic && epic !== k && hasTaskColor(epic) ? familyShade(baseColor(epic.toUpperCase()), Math.max(0, TASKS_PALETTE.indexOf(baseColor(k)))) : baseColor(k);
}

/** A qué color va cada clave nueva: el menos usado entre las asignadas (y, a igualdad, el primero de la paleta) */
export function assignColors(assigned: Record<string, number>, keys: string[]): Record<string, number> {
  const out = { ...assigned };
  const uses = TASKS_PALETTE.map(() => 0);
  for (const i of Object.values(out)) uses[i] = (uses[i] ?? 0) + 1;
  for (const c of keys.map(x => x.toUpperCase())) {
    if (c in out) continue;
    const i = uses.indexOf(Math.min(...uses));
    out[c] = i; uses[i]++;
  }
  return out;
}
