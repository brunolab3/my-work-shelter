// Disposición del refugio: dónde va cada sala. De serie no se elige a mano: se calcula siempre a partir de las salas que
// hay, así un refugio guardado se recoloca solo y cada recluta nuevo entra en su sitio sin desordenar nada.
// Si el Supervisor mueve una sala o una planta desde el plano, la disposición pasa a ser a mano (`manual` en cada sala;
// ver «a mano» más abajo) hasta que la devuelva a la de serie.
//   PB (0)  a pie de calle: la puerta, a la izquierda del ascensor
//   -1      cámara acorazada | Puente de Mando
//   -2      comunicaciones, agenda | logística, control de versiones, planificación (tipos 'planificacion', 'logistica' y
//           'git'; la planificación de tareas es la sala de serie SALA_PLANIFICACION, de tipo 'coordinacion')
//   -3…     los repos, en orden alfabético de izquierda a derecha y repartidos a los dos lados del ascensor
//           (como mucho REPOS_POR_PLANTA por planta: si hay más, siguen en la planta de debajo)
//   última  ocio: hidroponía, discoteca | galería de tiro, Chapa y Pintura (de izquierda a derecha: cultivos, discoteca,
//           ascensor, tiro, barbería y ropería)
export interface Gap { planta: number; lado: 'izq' | 'der'; orden: number }

export const FLOOR_REPOS = 3;
export const REPOS_BY_FLOOR = 8;

const FIXED: Record<string, Gap> = {
  puerta: { planta: 0, lado: 'izq', orden: 0 },
  camara: { planta: 1, lado: 'izq', orden: 0 },
  puente: { planta: 1, lado: 'der', orden: 0 },
  planificacion: { planta: 2, lado: 'izq', orden: 0 },
  comunicaciones: { planta: 2, lado: 'izq', orden: 1 },
  logistica: { planta: 2, lado: 'der', orden: 0 },
  git: { planta: 2, lado: 'der', orden: 1 },
};
const OCIO: Record<string, Pick<Gap, 'lado' | 'orden'>> = {
  discoteca: { lado: 'izq', orden: 0 },
  hidroponia: { lado: 'izq', orden: 1 },
  galeria: { lado: 'der', orden: 0 },
  chapa: { lado: 'der', orden: 1 },
};

export const isRoomOfRepo = (tipo: string) => tipo === 'repo' || tipo === 'coordinacion';
/** La sala de serie de planificación de tareas (tipo 'coordinacion'): su carpeta es siempre la raíz de repos del
 *  refugio; no se retira ni se vincula a otra carpeta. Las de coordinación reclutadas en la Puerta son salas de repo */
export const PLANNING_ROOM = 'tareas';
const PLANNING_GAP: Gap = { planta: 2, lado: 'der', orden: 2 };
const reposIs = (s: { id: string; tipo: string }) => isRoomOfRepo(s.tipo) && s.id !== PLANNING_ROOM;
/** Orden alfabético de los repos: el de su sitio en la planta y el de su número en la placa */
export const alphabeticalOrder = (a: { id: string; nombre: string }, b: { id: string; nombre: string }) =>
  a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
/** Rótulo de una planta en el ascensor y en el plano: PB, -1, -2… */
export const floorCaption = (p: number) => (p === 0 ? 'PB' : '-' + p);

export function distribute<T extends { id: string; tipo: string; nombre: string; manual?: boolean }>(salas: T[]): (T & Gap)[] {
  if (salas.some(s => s.manual)) return aMano(salas as (T & Partial<Gap>)[]);
  const sitio = new Map<T, Gap>();
  const ocupado = new Set<string>();
  const poner = (s: T, h: Gap) => { sitio.set(s, h); ocupado.add(`${h.planta}|${h.lado}|${h.orden}`); };
  const libre = (h: Gap) => !ocupado.has(`${h.planta}|${h.lado}|${h.orden}`);
  // repos: de izquierda a derecha en orden alfabético; a la izquierda la mitad (redondeando hacia arriba)
  const repos = salas.filter(reposIs).sort(alphabeticalOrder);
  const floorsRepos = Math.ceil(repos.length / REPOS_BY_FLOOR);
  for (let k = 0; k < floorsRepos; k++) {
    const batch = repos.slice(k * REPOS_BY_FLOOR, (k + 1) * REPOS_BY_FLOOR);
    const izq = Math.ceil(batch.length / 2), planta = FLOOR_REPOS + k;
    batch.forEach((s, i) => poner(s, i < izq ? { planta, lado: 'izq', orden: izq - 1 - i } : { planta, lado: 'der', orden: i - izq }));
  }
  const leisureFloor = FLOOR_REPOS + floorsRepos;
  const sueltas: T[] = [];
  for (const s of salas) {
    if (reposIs(s)) continue;
    const h = s.id === PLANNING_ROOM ? PLANNING_GAP : FIXED[s.tipo] ?? (OCIO[s.tipo] && { planta: leisureFloor, ...OCIO[s.tipo] });
    if (h && libre(h)) poner(s, h); else sueltas.push(s);
  }
  // lo que no tiene sitio fijo (o lo repite) va a la planta de ocio, en el primer hueco libre
  for (const s of sueltas) {
    for (let orden = 0; ; orden++) {
      const h = (['izq', 'der'] as const).map(lado => ({ planta: leisureFloor, lado, orden })).find(libre);
      if (h) { poner(s, h); break; }
    }
  }
  return salas.map(s => ({ ...s, ...sitio.get(s)! }));
}

// ---------------------------------------------------------------- a mano
// Cada planta es una fila: [izq …, ascensor, … der]. Las salas con `manual` conservan su sitio; las que no lo tienen (un
// recluta nuevo) van al final de la última planta con repos (si está llena, a una nueva debajo de ella). Después se
// compacta: en cada lado, sin huecos entre salas; sin plantas vacías por medio. La PB es solo de la puerta.
type WithSpot = { id: string; tipo: string; nombre: string; manual?: boolean } & Partial<Gap>;
const fila = <T extends Gap>(salas: T[], p: number) => [
  ...salas.filter(s => s.planta === p && s.lado === 'izq').sort((a, b) => b.orden - a.orden),
  null,
  ...salas.filter(s => s.planta === p && s.lado === 'der').sort((a, b) => a.orden - b.orden),
];
// recoloca una fila (con el ascensor como `null`) en la planta p
function ponerFila<T extends Gap>(f: (T | null)[], p: number) {
  const asc = f.indexOf(null);
  f.forEach((s, i) => { if (s) Object.assign(s, i < asc ? { planta: p, lado: 'izq', orden: asc - 1 - i } : { planta: p, lado: 'der', orden: i - asc - 1 }); });
}
function compact<T extends Gap>(salas: T[]): T[] {
  const plantas = [...new Set(salas.map(s => s.planta))].sort((a, b) => a - b);
  const filas = plantas.map(p => fila(salas, p));
  // la PB es la 0 aunque se quede sola; el resto, seguidas
  filas.forEach((f, k) => ponerFila(f, plantas[0] === 0 ? k : k + 1));
  return salas;
}
function aMano<T extends WithSpot>(salas: T[]): (T & Gap)[] {
  const out = salas.map(s => ({ ...s })) as (T & Gap)[];
  const ocupado = new Set<string>();
  const puestas: (T & Gap)[] = [], sueltas: (T & Gap)[] = [];
  for (const s of out) {
    const k = `${s.planta}|${s.lado}|${s.orden}`;
    const valid = s.manual && Number.isInteger(s.planta) && s.planta >= 0 && (s.lado === 'izq' || s.lado === 'der') && Number.isInteger(s.orden) && s.orden >= 0 && (s.planta > 0) === (s.tipo !== 'puerta');
    if (valid && !ocupado.has(k)) { ocupado.add(k); puestas.push(s); } else sueltas.push(s);
  }
  for (const s of sueltas) {
    if (s.tipo === 'puerta') { const f = fila(puestas, 0); f.splice(f.indexOf(null), 0, s); ponerFila(f, 0); puestas.push(s); continue; }
    const withRepos = puestas.filter(reposIs).map(x => x.planta);
    const ultima = Math.max(0, ...puestas.map(x => x.planta));
    let p = withRepos.length ? Math.max(...withRepos) : ultima || 1;
    if (puestas.filter(x => x.planta === p).length >= REPOS_BY_FLOOR) {
      p += 1;   // planta nueva debajo: lo que había más abajo baja una
      for (const x of puestas) if (x.planta >= p) x.planta += 1;
    }
    const izq = puestas.filter(x => x.planta === p && x.lado === 'izq').length, der = puestas.filter(x => x.planta === p && x.lado === 'der').length;
    Object.assign(s, der <= izq ? { planta: p, lado: 'der', orden: der } : { planta: p, lado: 'izq', orden: izq });
    puestas.push(s);
  }
  return compact(out).map(s => ({ ...s, manual: true }));
}

/** Destino de una sala arrastrada en el plano: un hueco de una planta (si está ocupado, la sala entra ahí y las demás se
 *  apartan hacia fuera) o, con `nueva`, una planta nueva que se abre en `planta` (las de debajo bajan una). */
export interface Target { planta: number; lado: 'izq' | 'der'; orden: number; nueva?: boolean }

/** Coloca una sala en su destino. Pasa la disposición a mano; la planta que se queda vacía desaparece. Devuelve null si
 *  no se puede (la puerta no se mueve; nadie más entra en la PB). */
export function placeRoom<T extends { id: string; tipo: string; nombre: string; manual?: boolean } & Gap>(salas: T[], id: string, d: Target): (T & Gap)[] | null {
  const out = salas.map(s => ({ ...s, manual: true })) as (T & Gap)[];
  const s = out.find(x => x.id === id);
  const ultima = Math.max(...out.map(x => x.planta));
  if (!s || s.tipo === 'puerta' || !Number.isInteger(d.planta) || d.planta < 1 || d.planta > ultima + 1 || (d.lado !== 'izq' && d.lado !== 'der') || !Number.isInteger(d.orden) || d.orden < 0) return null;
  if (!d.nueva && d.planta === s.planta && d.lado === s.lado && d.orden === s.orden) return null;
  const origen = fila(out, s.planta); origen.splice(origen.indexOf(s), 1); ponerFila(origen, s.planta);
  if (d.nueva) for (const x of out) if (x !== s && x.planta >= d.planta) x.planta += 1;
  const f = fila(out.filter(x => x !== s), d.planta), asc = f.indexOf(null);
  f.splice(d.lado === 'izq' ? Math.max(0, asc - d.orden) : Math.min(f.length, asc + 1 + d.orden), 0, s);
  ponerFila(f, d.planta);
  return compact(out);
}

/** Lleva una planta entera (salvo la PB) a otra altura: las de en medio se corren una. Pasa la disposición a mano. */
export function moveFloor<T extends { id: string; tipo: string; nombre: string; manual?: boolean } & Gap>(salas: T[], de: number, a: number): (T & Gap)[] | null {
  const ultima = Math.max(...salas.map(x => x.planta));
  if (de === a || de < 1 || a < 1 || de > ultima || a > ultima) return null;
  const orden = Array.from({ length: ultima }, (_, k) => k + 1);
  orden.splice(a - 1, 0, ...orden.splice(de - 1, 1));
  const nueva = new Map(orden.map((p, k) => [p, k + 1]));
  return salas.map(s => ({ ...s, manual: true, planta: s.planta === 0 ? 0 : nueva.get(s.planta)! }));
}

/** Vuelve a la disposición de serie (la que se calcula sola) */
export const disposicionDeSerie = <T extends { id: string; tipo: string; nombre: string; manual?: boolean }>(salas: T[]) =>
  distribute(salas.map(({ manual: _, ...s }) => s as T));
