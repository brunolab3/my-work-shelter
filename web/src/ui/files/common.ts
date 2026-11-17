// Piezas sin interfaz del explorador de archivos: el árbol tal como se ve, la búsqueda por nombre de ⌘P y el idioma de
// cada archivo para el editor.

export interface Entrada { nombre: string; dir: boolean; enlace?: boolean; ignorado?: boolean }
export interface Row { rel: string; nombre: string; dir: boolean; nivel: number; abierta: boolean; e: Entrada }

export const unir = (carpeta: string, nombre: string) => (carpeta ? carpeta + '/' + nombre : nombre);
export const parentOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
export const nameOf = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);
/** ¿`rel` es `base` o está dentro? */
export const bajo = (rel: string, base: string) => rel === base || rel.startsWith(base + '/');

/** Las filas del árbol que se ven: lo de cada carpeta desplegada, recursivamente desde la raíz. */
export function flatten(listed: Record<string, Entrada[] | undefined>, expandidos: Set<string>): Row[] {
  const out: Row[] = [];
  const bajar = (carpeta: string, nivel: number) => {
    for (const e of listed[carpeta] ?? []) {
      const rel = unir(carpeta, e.nombre), abierta = e.dir && expandidos.has(rel);
      out.push({ rel, nombre: e.nombre, dir: e.dir, nivel, abierta, e });
      if (abierta) bajar(rel, nivel + 1);
    }
  };
  bajar('', 0);
  return out;
}

/** Las carpetas con algo cambiado dentro (para marcarlas en el árbol), con la letra más llamativa. */
export function changedFolders(git: Record<string, string>): Map<string, string> {
  const weight: Record<string, number> = { U: 4, D: 3, M: 2, A: 1, '?': 1 };
  const out = new Map<string, string>();
  for (const [ruta, letra] of Object.entries(git)) {
    for (let p = parentOf(ruta); p; p = parentOf(p)) {
      const ya = out.get(p);
      if (!ya || (weight[letra] ?? 0) > (weight[ya] ?? 0)) out.set(p, letra);
    }
  }
  return out;
}

// ---------------------------------------------------------------- ⌘P: abrir por nombre
export interface Result { rel: string; puntos: number; marks: number[] }

function encajar(q: string, r: string, desde: number): { puntos: number; marks: number[] } | null {
  // el trozo seguido, si lo hay, gana
  const j = r.indexOf(q, desde);
  if (j >= 0) {
    const inicio = j === desde || '/._- '.includes(r[j - 1]);
    return { puntos: 100 + q.length * 10 + (inicio ? 40 : 0) - (j - desde) * 0.5, marks: Array.from(q, (_, k) => j + k) };
  }
  let i = desde, puntos = 0, antes = -2; const marks: number[] = [];
  for (const c of q) {
    const k = r.indexOf(c, i); if (k < 0) return null;
    if (k === antes + 1) puntos += 6;
    if (k === desde || '/._- '.includes(r[k - 1])) puntos += 8;
    puntos -= Math.min(k - i, 12) * 0.3;
    marks.push(k); antes = k; i = k + 1;
  }
  return { puntos, marks };
}

/** Como el ⌘P de los editores: las letras en orden, mejor si están seguidas, en el nombre y al principio de palabra. */
export function score(consulta: string, rel: string): Result | null {
  const q = consulta.toLowerCase().replace(/\s+/g, ''); if (!q) return { rel, puntos: 0, marks: [] };
  const r = rel.toLowerCase(), base = r.lastIndexOf('/') + 1;
  // si la consulta lleva «/», se busca en toda la ruta; si no, primero en el nombre
  const inName = q.includes('/') ? null : encajar(q, r, base);
  const m = inName ? { puntos: inName.puntos + 1000, marks: inName.marks } : encajar(q, r, 0);
  if (!m) return null;
  return { rel, puntos: m.puntos - r.length * 0.08, marks: m.marks };
}

export function searchFiles(consulta: string, rels: string[], max = 60): Result[] {
  const out: Result[] = [];
  for (const rel of rels) { const r = score(consulta, rel); if (r) out.push(r); }
  return out.sort((a, b) => b.puntos - a.puntos || a.rel.length - b.rel.length || a.rel.localeCompare(b.rel)).slice(0, max);
}

/** «src/app.ts:42» o «app.ts:42:7» → la consulta y la línea */
export function queryYLine(texto: string): { consulta: string; linea?: number; columna?: number } {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(texto.trim());
  return m ? { consulta: m[1], linea: Number(m[2]), columna: m[3] ? Number(m[3]) : undefined } : { consulta: texto.trim() };
}

// ---------------------------------------------------------------- idioma del archivo para el editor
export interface Idioma { id: string; extensions?: string[]; filenames?: string[]; filenamePatterns?: string[] }
const wildcard = (patron: string) => new RegExp('^' + patron.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');

/** El idioma de Monaco para un nombre de archivo: por nombre exacto, por patrón y por extensión (la más larga). */
export function languageOf(nombre: string, idiomas: Idioma[]): string {
  const n = nombre.toLowerCase();
  for (const l of idiomas) if (l.filenames?.some(f => f.toLowerCase() === n)) return l.id;
  for (const l of idiomas) if (l.filenamePatterns?.some(p => wildcard(p).test(nombre))) return l.id;
  let mejor = '', id = 'plaintext';
  for (const l of idiomas) for (const e of l.extensions ?? []) { const x = e.toLowerCase(); if (n.endsWith(x) && x.length > mejor.length) { mejor = x; id = l.id; } }
  return id;
}
