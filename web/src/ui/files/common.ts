// Piezas sin interfaz del explorador de archivos: el árbol tal como se ve, la búsqueda por nombre de ⌘P y el idioma de
// cada archivo para el editor.

export interface Entry { name: string; dir: boolean; link?: boolean; ignored?: boolean }
export interface Row { rel: string; name: string; dir: boolean; level: number; open: boolean; e: Entry }

export const union = (folder: string, name: string) => (folder ? folder + '/' + name : name);
export const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
export const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
/** ¿`rel` es `base` o está dentro? */
export const under = (rel: string, base: string) => rel === base || rel.startsWith(base + '/');

/** Las filas del árbol que se ven: lo de cada carpeta desplegada, recursivamente desde la raíz. */
export function flatten(listed: Record<string, Entry[] | undefined>, expanded: Set<string>): Row[] {
  const out: Row[] = [];
  const download = (folder: string, level: number) => {
    for (const e of listed[folder] ?? []) {
      const rel = union(folder, e.name), open = e.dir && expanded.has(rel);
      out.push({ rel, name: e.name, dir: e.dir, level, open, e });
      if (open) download(rel, level + 1);
    }
  };
  download('', 0);
  return out;
}

/** Las carpetas con algo cambiado dentro (para marcarlas en el árbol), con la letra más llamativa. */
export function changedFolders(git: Record<string, string>): Map<string, string> {
  const weight: Record<string, number> = { U: 4, D: 3, M: 2, A: 1, '?': 1 };
  const out = new Map<string, string>();
  for (const [path, letter] of Object.entries(git)) {
    for (let p = parentOf(path); p; p = parentOf(p)) {
      const already = out.get(p);
      if (!already || (weight[letter] ?? 0) > (weight[already] ?? 0)) out.set(p, letter);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ⌘P: abrir por nombre
export interface Result { rel: string; points: number; marks: number[] }

function match(q: string, r: string, since: number): { points: number; marks: number[] } | null {
  // el trozo seguido, si lo hay, gana
  const j = r.indexOf(q, since);
  if (j >= 0) {
    const start = j === since || '/._- '.includes(r[j - 1]);
    return { points: 100 + q.length * 10 + (start ? 40 : 0) - (j - since) * 0.5, marks: Array.from(q, (_, k) => j + k) };
  }
  let i = since, points = 0, before = -2; const marks: number[] = [];
  for (const c of q) {
    const k = r.indexOf(c, i); if (k < 0) return null;
    if (k === before + 1) points += 6;
    if (k === since || '/._- '.includes(r[k - 1])) points += 8;
    points -= Math.min(k - i, 12) * 0.3;
    marks.push(k); before = k; i = k + 1;
  }
  return { points, marks };
}

/** Como el ⌘P de los editores: las letras en orden, mejor si están seguidas, en el nombre y al principio de palabra. */
export function score(query: string, rel: string): Result | null {
  const q = query.toLowerCase().replace(/\s+/g, ''); if (!q) return { rel, points: 0, marks: [] };
  const r = rel.toLowerCase(), base = r.lastIndexOf('/') + 1;
  // si la consulta lleva «/», se busca en toda la ruta; si no, primero en el nombre
  const inName = q.includes('/') ? null : match(q, r, base);
  const m = inName ? { points: inName.points + 1000, marks: inName.marks } : match(q, r, 0);
  if (!m) return null;
  return { rel, points: m.points - r.length * 0.08, marks: m.marks };
}

export function searchFiles(query: string, rels: string[], max = 60): Result[] {
  const out: Result[] = [];
  for (const rel of rels) { const r = score(query, rel); if (r) out.push(r); }
  return out.sort((a, b) => b.points - a.points || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel)).slice(0, max);
}

/** «src/app.ts:42» o «app.ts:42:7» → la consulta y la línea */
export function queryYLine(text: string): { query: string; line?: number; column?: number } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(text.trim());
  return m ? { query: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : undefined } : { query: text.trim() };
}

// ---------------------------------------------------------------- idioma del archivo para el editor
export interface Language { id: string; extensions?: string[]; filenames?: string[]; filenamePatterns?: string[] }
const wildcard = (patron: string) => new RegExp('^' + patron.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');

/** El idioma de Monaco para un nombre de archivo: por nombre exacto, por patrón y por extensión (la más larga). */
export function languageOf(name: string, languages: Language[]): string {
  const n = name.toLowerCase();
  for (const l of languages) if (l.filenames?.some(f => f.toLowerCase() === n)) return l.id;
  for (const l of languages) if (l.filenamePatterns?.some(p => wildcard(p).test(name))) return l.id;
  let best = '', id = 'plaintext';
  for (const l of languages) for (const e of l.extensions ?? []) { const x = e.toLowerCase(); if (n.endsWith(x) && x.length > best.length) { best = x; id = l.id; } }
  return id;
}
