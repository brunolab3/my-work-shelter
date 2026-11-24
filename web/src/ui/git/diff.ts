// Lo que el cliente de git hace con los diffs y el historial, sin interfaz (se prueba aparte):
//  - leer un diff unificado en bloques y líneas con su número en cada lado
//  - armar el parche de unos bloques o de unas líneas sueltas, para prepararlas, quitarlas o descartarlas
//  - emparejar líneas quitadas y añadidas para la vista en paralelo y marcar qué cambia dentro de cada línea
//  - repartir los commits del historial en carriles para dibujar el grafo

export type LineType = ' ' | '+' | '-' | '\\';
export interface Line { type: LineType; text: string; old?: number; newer?: number }
export interface Block { header: string; startOld: number; oldN: number; newStart: number; newN: number; context: string; lines: Line[] }
export interface DiffFile { header: string[]; blocks: Block[]; binary: boolean; newer: boolean; deleted: boolean; renamed: boolean }

const RE_BLOCK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Lee el diff de un archivo (el primero si trae varios). */
export function readDiff(text: string): DiffFile {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const d: DiffFile = { header: [], blocks: [], binary: false, newer: false, deleted: false, renamed: false };
  let b: Block | null = null, old = 0, newer = 0, files = 0;
  for (const l of lines) {
    if (l.startsWith('diff --git ')) { if (++files > 1) break; d.header.push(l); continue; }
    const m = RE_BLOCK.exec(l);
    if (m) {
      b = { header: l, startOld: +m[1], oldN: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newN: m[4] === undefined ? 1 : +m[4], context: m[5] ?? '', lines: [] };
      d.blocks.push(b); old = b.startOld; newer = b.newStart; continue;
    }
    if (!b) {
      d.header.push(l);
      if (/^Binary files .* differ$/.test(l) || l === 'GIT binary patch') d.binary = true;
      if (l.startsWith('new file mode')) d.newer = true;
      if (l.startsWith('deleted file mode')) d.deleted = true;
      if (l.startsWith('rename from') || l.startsWith('copy from')) d.renamed = true;
      continue;
    }
    const t = l[0] as LineType, text2 = l.slice(1);
    if (t === '+') b.lines.push({ type: '+', text: text2, newer: newer++ });
    else if (t === '-') b.lines.push({ type: '-', text: text2, old: old++ });
    else if (t === '\\') b.lines.push({ type: '\\', text: l });
    else b.lines.push({ type: ' ', text: text2, old: old++, newer: newer++ });
  }
  return d;
}

/** Si se pueden preparar o quitar trozos sueltos (no en binarios, archivos nuevos o borrados enteros, ni renombrados). */
export const chunksAccepts = (d: DiffFile) => !d.binary && !d.newer && !d.deleted && !d.renamed && d.blocks.length > 0;

/**
 * Parche con parte de un diff: los bloques indicados enteros o, con `elegidas` (índice de bloque → índices de línea),
 * solo esas líneas. `sentido`:
 *  - 'adelante': se aplica al lado viejo (preparar desde la copia de trabajo: el índice es el lado viejo del diff).
 *    Una quitada que no se elige se queda (pasa a contexto); una añadida que no se elige, no entra.
 *  - 'atras': se aplica al revés sobre el lado nuevo (quitar del índice, descartar de la copia de trabajo).
 *    Al revés: una añadida que no se elige se queda (contexto) y una quitada que no se elige, no entra.
 * Devuelve null si no queda ningún cambio. Los recuentos de cada bloque los rehace `git apply --recount`; los inicios
 * del lado que no se aplica se corrigen con lo que han movido los bloques anteriores del parche.
 */
export function assemblePatch(d: DiffFile, blocks: number[], direction: 'forward' | 'back', picked?: Map<number, Set<number>>): string | null {
  const output: string[] = [...d.header];
  let offset = 0, found = false;
  for (const bi of [...blocks].sort((a, b) => a - b)) {
    const b = d.blocks[bi]; if (!b) continue;
    const sel = picked?.get(bi);
    const out: Line[] = []; let lastInside = true;
    for (let i = 0; i < b.lines.length; i++) {
      const l = b.lines[i];
      if (l.type === '\\') { if (lastInside) out.push(l); continue; }
      if (l.type === ' ' || !sel || sel.has(i)) { out.push(l); lastInside = true; continue; }
      // una línea cambiada que no se ha elegido
      const left = direction === 'forward' ? l.type === '-' : l.type === '+';
      if (left) out.push({ ...l, type: ' ' });
      lastInside = left;
    }
    const deletions = out.filter(l => l.type === '-').length, more = out.filter(l => l.type === '+').length, ctx = out.filter(l => l.type === ' ').length;
    if (!deletions && !more) continue;
    found = true;
    const oldN = ctx + deletions, newN = ctx + more;
    const startOld = direction === 'forward' ? b.startOld : b.newStart - offset;
    const newStart = direction === 'forward' ? b.startOld + offset : b.newStart;
    // un bloque vacío de un lado empieza en la línea anterior (convenio de diff): se respeta el del original
    const vI = oldN === 0 ? Math.max(0, startOld - (b.oldN === 0 ? 0 : 1)) : Math.max(1, startOld);
    const nI = newN === 0 ? Math.max(0, newStart - (b.newN === 0 ? 0 : 1)) : Math.max(1, newStart);
    output.push(`@@ -${vI},${oldN} +${nI},${newN} @@${b.context ? ' ' + b.context : ''}`);
    for (const l of out) output.push(l.type === '\\' ? l.text : l.type + l.text);
    offset += newN - oldN;
  }
  return found ? output.join('\n') + '\n' : null;
}

// ---------------------------------------------------------------- vista en paralelo y cambios dentro de la línea
export interface ParallelRow { left?: Line & { i: number }; right?: Line & { i: number } }
/** Empareja cada tanda de líneas quitadas con la de añadidas que la sigue (fila a fila); el contexto va a los dos lados. */
export function inParallel(b: Block): ParallelRow[] {
  const rows: ParallelRow[] = [];
  let i = 0; const L = b.lines;
  while (i < L.length) {
    const l = L[i];
    if (l.type === ' ') { rows.push({ left: { ...l, i }, right: { ...l, i } }); i++; continue; }
    if (l.type === '\\') { i++; continue; }
    const deletions: (Line & { i: number })[] = [], more: (Line & { i: number })[] = [];
    while (i < L.length && (L[i].type === '-' || L[i].type === '\\')) { if (L[i].type === '-') deletions.push({ ...L[i], i }); i++; }
    while (i < L.length && (L[i].type === '+' || L[i].type === '\\')) { if (L[i].type === '+') more.push({ ...L[i], i }); i++; }
    for (let k = 0; k < Math.max(deletions.length, more.length); k++) rows.push({ left: deletions[k], right: more[k] });
  }
  return rows;
}

/** Qué cambia entre dos versiones de una línea: lo común al principio y al final se queda; lo de en medio se marca. */
export function changeInLine(a: string, b: string): { a: [number, number]; b: [number, number] } | null {
  if (a === b) return null;
  let start = 0; const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  // si casi toda la línea cambia, marcarla entera no ayuda: sin marca
  if ((start + end) < Math.min(a.length, b.length) * 0.2 && Math.min(a.length, b.length) > 6) return null;
  return { a: [start, a.length - end], b: [start, b.length - end] };
}
/** Parejas quitada→añadida de un bloque (por índice de línea), para marcar el cambio dentro de cada una. */
export function linePairs(b: Block): Map<number, number> {
  const m = new Map<number, number>();
  for (const f of inParallel(b)) if (f.left && f.right && f.left.type === '-' && f.right.type === '+') { m.set(f.left.i, f.right.i); m.set(f.right.i, f.left.i); }
  return m;
}

// ---------------------------------------------------------------- grafo del historial
export interface GraphRow { column: number; before: (string | null)[]; after: (string | null)[]; arrive: number[]; leave: number[] }
/**
 * Carriles del grafo (orden topológico, el más reciente arriba). Cada carril espera a un commit; un commit ocupa el
 * carril que lo esperaba (o el primero libre). `llegan`: carriles que terminan en él (sus hijos); `salen`: carriles
 * que empiezan en él hacia sus padres (el primero sigue en su columna).
 */
export function lanes(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const live: (string | null)[] = [];
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const before = [...live];
    let col = live.indexOf(c.hash);
    const arrive: number[] = [];
    live.forEach((h, j) => { if (h === c.hash) arrive.push(j); });
    if (col < 0) { col = live.indexOf(null); if (col < 0) col = live.length; live[col] = c.hash; }
    for (const j of arrive) if (j !== col) live[j] = null;
    const leave: number[] = [];
    live[col] = c.parents[0] ?? null;
    if (c.parents[0]) leave.push(col);
    for (const p of c.parents.slice(1)) {
      const already = live.indexOf(p);
      if (already >= 0) { leave.push(already); continue; }
      let k = live.indexOf(null); if (k < 0) k = live.length; live[k] = p; leave.push(k);
    }
    while (live.length && live[live.length - 1] === null) live.pop();
    rows.push({ column: col, before, after: [...live], arrive, leave });
  }
  return rows;
}
