// Lo que el cliente de git hace con los diffs y el historial, sin interfaz (se prueba aparte):
//  - leer un diff unificado en bloques y líneas con su número en cada lado
//  - armar el parche de unos bloques o de unas líneas sueltas, para prepararlas, quitarlas o descartarlas
//  - emparejar líneas quitadas y añadidas para la vista en paralelo y marcar qué cambia dentro de cada línea
//  - repartir los commits del historial en carriles para dibujar el grafo

export type LineType = ' ' | '+' | '-' | '\\';
export interface Linea { tipo: LineType; texto: string; viejo?: number; nuevo?: number }
export interface Block { cabecera: string; startOld: number; oldN: number; newStart: number; newN: number; contexto: string; lineas: Linea[] }
export interface DiffFile { cabecera: string[]; blocks: Block[]; binario: boolean; nuevo: boolean; borrado: boolean; renombrado: boolean }

const RE_BLOCK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Lee el diff de un archivo (el primero si trae varios). */
export function readDiff(texto: string): DiffFile {
  const lineas = texto.split('\n');
  if (lineas.at(-1) === '') lineas.pop();
  const d: DiffFile = { cabecera: [], blocks: [], binario: false, nuevo: false, borrado: false, renombrado: false };
  let b: Block | null = null, viejo = 0, nuevo = 0, archivos = 0;
  for (const l of lineas) {
    if (l.startsWith('diff --git ')) { if (++archivos > 1) break; d.cabecera.push(l); continue; }
    const m = RE_BLOCK.exec(l);
    if (m) {
      b = { cabecera: l, startOld: +m[1], oldN: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newN: m[4] === undefined ? 1 : +m[4], contexto: m[5] ?? '', lineas: [] };
      d.blocks.push(b); viejo = b.startOld; nuevo = b.newStart; continue;
    }
    if (!b) {
      d.cabecera.push(l);
      if (/^Binary files .* differ$/.test(l) || l === 'GIT binary patch') d.binario = true;
      if (l.startsWith('new file mode')) d.nuevo = true;
      if (l.startsWith('deleted file mode')) d.borrado = true;
      if (l.startsWith('rename from') || l.startsWith('copy from')) d.renombrado = true;
      continue;
    }
    const t = l[0] as LineType, text2 = l.slice(1);
    if (t === '+') b.lineas.push({ tipo: '+', texto: text2, nuevo: nuevo++ });
    else if (t === '-') b.lineas.push({ tipo: '-', texto: text2, viejo: viejo++ });
    else if (t === '\\') b.lineas.push({ tipo: '\\', texto: l });
    else b.lineas.push({ tipo: ' ', texto: text2, viejo: viejo++, nuevo: nuevo++ });
  }
  return d;
}

/** Si se pueden preparar o quitar trozos sueltos (no en binarios, archivos nuevos o borrados enteros, ni renombrados). */
export const chunksAccepts = (d: DiffFile) => !d.binario && !d.nuevo && !d.borrado && !d.renombrado && d.blocks.length > 0;

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
export function assemblePatch(d: DiffFile, blocks: number[], sentido: 'adelante' | 'atras', elegidas?: Map<number, Set<number>>): string | null {
  const salida: string[] = [...d.cabecera];
  let desfase = 0, alguno = false;
  for (const bi of [...blocks].sort((a, b) => a - b)) {
    const b = d.blocks[bi]; if (!b) continue;
    const sel = elegidas?.get(bi);
    const out: Linea[] = []; let lastInside = true;
    for (let i = 0; i < b.lineas.length; i++) {
      const l = b.lineas[i];
      if (l.tipo === '\\') { if (lastInside) out.push(l); continue; }
      if (l.tipo === ' ' || !sel || sel.has(i)) { out.push(l); lastInside = true; continue; }
      // una línea cambiada que no se ha elegido
      const queda = sentido === 'adelante' ? l.tipo === '-' : l.tipo === '+';
      if (queda) out.push({ ...l, tipo: ' ' });
      lastInside = queda;
    }
    const menos = out.filter(l => l.tipo === '-').length, mas = out.filter(l => l.tipo === '+').length, ctx = out.filter(l => l.tipo === ' ').length;
    if (!menos && !mas) continue;
    alguno = true;
    const oldN = ctx + menos, newN = ctx + mas;
    const startOld = sentido === 'adelante' ? b.startOld : b.newStart - desfase;
    const newStart = sentido === 'adelante' ? b.startOld + desfase : b.newStart;
    // un bloque vacío de un lado empieza en la línea anterior (convenio de diff): se respeta el del original
    const vI = oldN === 0 ? Math.max(0, startOld - (b.oldN === 0 ? 0 : 1)) : Math.max(1, startOld);
    const nI = newN === 0 ? Math.max(0, newStart - (b.newN === 0 ? 0 : 1)) : Math.max(1, newStart);
    salida.push(`@@ -${vI},${oldN} +${nI},${newN} @@${b.contexto ? ' ' + b.contexto : ''}`);
    for (const l of out) salida.push(l.tipo === '\\' ? l.texto : l.tipo + l.texto);
    desfase += newN - oldN;
  }
  return alguno ? salida.join('\n') + '\n' : null;
}

// ---------------------------------------------------------------- vista en paralelo y cambios dentro de la línea
export interface ParallelRow { izq?: Linea & { i: number }; der?: Linea & { i: number } }
/** Empareja cada tanda de líneas quitadas con la de añadidas que la sigue (fila a fila); el contexto va a los dos lados. */
export function inParallel(b: Block): ParallelRow[] {
  const filas: ParallelRow[] = [];
  let i = 0; const L = b.lineas;
  while (i < L.length) {
    const l = L[i];
    if (l.tipo === ' ') { filas.push({ izq: { ...l, i }, der: { ...l, i } }); i++; continue; }
    if (l.tipo === '\\') { i++; continue; }
    const menos: (Linea & { i: number })[] = [], mas: (Linea & { i: number })[] = [];
    while (i < L.length && (L[i].tipo === '-' || L[i].tipo === '\\')) { if (L[i].tipo === '-') menos.push({ ...L[i], i }); i++; }
    while (i < L.length && (L[i].tipo === '+' || L[i].tipo === '\\')) { if (L[i].tipo === '+') mas.push({ ...L[i], i }); i++; }
    for (let k = 0; k < Math.max(menos.length, mas.length); k++) filas.push({ izq: menos[k], der: mas[k] });
  }
  return filas;
}

/** Qué cambia entre dos versiones de una línea: lo común al principio y al final se queda; lo de en medio se marca. */
export function changeInLine(a: string, b: string): { a: [number, number]; b: [number, number] } | null {
  if (a === b) return null;
  let ini = 0; const max = Math.min(a.length, b.length);
  while (ini < max && a[ini] === b[ini]) ini++;
  let fin = 0;
  while (fin < max - ini && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++;
  // si casi toda la línea cambia, marcarla entera no ayuda: sin marca
  if ((ini + fin) < Math.min(a.length, b.length) * 0.2 && Math.min(a.length, b.length) > 6) return null;
  return { a: [ini, a.length - fin], b: [ini, b.length - fin] };
}
/** Parejas quitada→añadida de un bloque (por índice de línea), para marcar el cambio dentro de cada una. */
export function parejas(b: Block): Map<number, number> {
  const m = new Map<number, number>();
  for (const f of inParallel(b)) if (f.izq && f.der && f.izq.tipo === '-' && f.der.tipo === '+') { m.set(f.izq.i, f.der.i); m.set(f.der.i, f.izq.i); }
  return m;
}

// ---------------------------------------------------------------- grafo del historial
export interface GraphRow { columna: number; antes: (string | null)[]; after: (string | null)[]; arrive: number[]; salen: number[] }
/**
 * Carriles del grafo (orden topológico, el más reciente arriba). Cada carril espera a un commit; un commit ocupa el
 * carril que lo esperaba (o el primero libre). `llegan`: carriles que terminan en él (sus hijos); `salen`: carriles
 * que empiezan en él hacia sus padres (el primero sigue en su columna).
 */
export function lanes(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const live: (string | null)[] = [];
  const filas: GraphRow[] = [];
  for (const c of commits) {
    const antes = [...live];
    let col = live.indexOf(c.hash);
    const arrive: number[] = [];
    live.forEach((h, j) => { if (h === c.hash) arrive.push(j); });
    if (col < 0) { col = live.indexOf(null); if (col < 0) col = live.length; live[col] = c.hash; }
    for (const j of arrive) if (j !== col) live[j] = null;
    const salen: number[] = [];
    live[col] = c.parents[0] ?? null;
    if (c.parents[0]) salen.push(col);
    for (const p of c.parents.slice(1)) {
      const ya = live.indexOf(p);
      if (ya >= 0) { salen.push(ya); continue; }
      let k = live.indexOf(null); if (k < 0) k = live.length; live[k] = p; salen.push(k);
    }
    while (live.length && live[live.length - 1] === null) live.pop();
    filas.push({ columna: col, antes, after: [...live], arrive, salen });
  }
  return filas;
}
