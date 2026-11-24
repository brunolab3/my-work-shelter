// Disposición del refugio: dónde va cada sala. De serie no se elige a mano: se calcula siempre a partir de las salas que
// hay, así un refugio guardado se recoloca solo y cada recluta nuevo entra en su sitio sin desordenar nada.
// Si el Supervisor mueve una sala o una planta desde el plano, la disposición pasa a ser a mano (`manual` en cada sala;
// ver «a mano» más abajo) hasta que la devuelva a la de serie.
//   PB (0)  a pie de calle: la puerta, a la izquierda del ascensor
//   -1      cámara acorazada | Puente de Mando
//   -2      revisión (others' PRs to review), comunicaciones, agenda | logística, control de versiones, planificación (tipos 'planificacion', 'logistica' y
//           'git'; la planificación de tareas es la sala de serie SALA_PLANIFICACION, de tipo 'coordinacion')
//   -3…     los repos, en orden alfabético de izquierda a derecha y repartidos a los dos lados del ascensor
//           (como mucho REPOS_POR_PLANTA por planta: si hay más, siguen en la planta de debajo)
//   última  ocio: hidroponía, discoteca | galería de tiro, Chapa y Pintura (de izquierda a derecha: cultivos, discoteca,
//           ascensor, tiro, barbería y ropería)
export interface Gap { floor: number; side: 'left' | 'right'; orden: number }

export const FLOOR_REPOS = 3;
export const REPOS_BY_FLOOR = 8;

const FIXED: Record<string, Gap> = {
  gate: { floor: 0, side: 'left', orden: 0 },
  vault: { floor: 1, side: 'left', orden: 0 },
  bridge: { floor: 1, side: 'right', orden: 0 },
  calendar: { floor: 2, side: 'left', orden: 0 },
  comms: { floor: 2, side: 'left', orden: 1 },
  review: { floor: 2, side: 'left', orden: 2 },
  logistics: { floor: 2, side: 'right', orden: 0 },
  git: { floor: 2, side: 'right', orden: 1 },
};
const LEISURE: Record<string, Pick<Gap, 'side' | 'orden'>> = {
  disco: { side: 'left', orden: 0 },
  hydroponics: { side: 'left', orden: 1 },
  gallery: { side: 'right', orden: 0 },
  bodyshop: { side: 'right', orden: 1 },
};

export const isRoomOfRepo = (type: string) => type === 'repo' || type === 'coordination';
/** La sala de serie de planificación de tareas (tipo 'coordinacion'): su carpeta es siempre la raíz de repos del
 *  refugio; no se retira ni se vincula a otra carpeta. Las de coordinación reclutadas en la Puerta son salas de repo */
export const PLANNING_ROOM = 'tareas';
const PLANNING_GAP: Gap = { floor: 2, side: 'right', orden: 2 };
const reposIs = (s: { id: string; type: string }) => isRoomOfRepo(s.type) && s.id !== PLANNING_ROOM;
/** Orden alfabético de los repos: el de su sitio en la planta y el de su número en la placa */
export const alphabeticalOrder = (a: { id: string; name: string }, b: { id: string; name: string }) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
/** Rótulo de una planta en el ascensor y en el plano: PB, -1, -2… */
export const floorCaption = (p: number) => (p === 0 ? 'PB' : '-' + p);

export function distribute<T extends { id: string; type: string; name: string; manual?: boolean }>(rooms: T[]): (T & Gap)[] {
  if (rooms.some(s => s.manual)) return byHand(rooms as (T & Partial<Gap>)[]);
  const spot = new Map<T, Gap>();
  const busy = new Set<string>();
  const set = (s: T, h: Gap) => { spot.set(s, h); busy.add(`${h.floor}|${h.side}|${h.orden}`); };
  const free = (h: Gap) => !busy.has(`${h.floor}|${h.side}|${h.orden}`);
  // repos: de izquierda a derecha en orden alfabético; a la izquierda la mitad (redondeando hacia arriba)
  const repos = rooms.filter(reposIs).sort(alphabeticalOrder);
  const floorsRepos = Math.ceil(repos.length / REPOS_BY_FLOOR);
  for (let k = 0; k < floorsRepos; k++) {
    const batch = repos.slice(k * REPOS_BY_FLOOR, (k + 1) * REPOS_BY_FLOOR);
    const left = Math.ceil(batch.length / 2), floor = FLOOR_REPOS + k;
    batch.forEach((s, i) => set(s, i < left ? { floor, side: 'left', orden: left - 1 - i } : { floor, side: 'right', orden: i - left }));
  }
  const leisureFloor = FLOOR_REPOS + floorsRepos;
  const loose: T[] = [];
  for (const s of rooms) {
    if (reposIs(s)) continue;
    const h = s.id === PLANNING_ROOM ? PLANNING_GAP : FIXED[s.type] ?? (LEISURE[s.type] && { floor: leisureFloor, ...LEISURE[s.type] });
    if (h && free(h)) set(s, h); else loose.push(s);
  }
  // lo que no tiene sitio fijo (o lo repite) va a la planta de ocio, en el primer hueco libre
  for (const s of loose) {
    for (let orden = 0; ; orden++) {
      const h = (['left', 'right'] as const).map(side => ({ floor: leisureFloor, side, orden })).find(free);
      if (h) { set(s, h); break; }
    }
  }
  return rooms.map(s => ({ ...s, ...spot.get(s)! }));
}

// ---------------------------------------------------------------- a mano
// Cada planta es una fila: [izq …, ascensor, … der]. Las salas con `manual` conservan su sitio; las que no lo tienen (un
// recluta nuevo) van al final de la última planta con repos (si está llena, a una nueva debajo de ella). Después se
// compacta: en cada lado, sin huecos entre salas; sin plantas vacías por medio. La PB es solo de la puerta.
type WithSpot = { id: string; type: string; name: string; manual?: boolean } & Partial<Gap>;
const row = <T extends Gap>(rooms: T[], p: number) => [
  ...rooms.filter(s => s.floor === p && s.side === 'left').sort((a, b) => b.orden - a.orden),
  null,
  ...rooms.filter(s => s.floor === p && s.side === 'right').sort((a, b) => a.orden - b.orden),
];
// recoloca una fila (con el ascensor como `null`) en la planta p
function setRow<T extends Gap>(f: (T | null)[], p: number) {
  const elev = f.indexOf(null);
  f.forEach((s, i) => { if (s) Object.assign(s, i < elev ? { floor: p, side: 'left', orden: elev - 1 - i } : { floor: p, side: 'right', orden: i - elev - 1 }); });
}
function compact<T extends Gap>(rooms: T[]): T[] {
  const floors = [...new Set(rooms.map(s => s.floor))].sort((a, b) => a - b);
  const rows = floors.map(p => row(rooms, p));
  // la PB es la 0 aunque se quede sola; el resto, seguidas
  rows.forEach((f, k) => setRow(f, floors[0] === 0 ? k : k + 1));
  return rooms;
}
function byHand<T extends WithSpot>(rooms: T[]): (T & Gap)[] {
  const out = rooms.map(s => ({ ...s })) as (T & Gap)[];
  const busy = new Set<string>();
  const placed: (T & Gap)[] = [], loose: (T & Gap)[] = [];
  for (const s of out) {
    const k = `${s.floor}|${s.side}|${s.orden}`;
    const valid = s.manual && Number.isInteger(s.floor) && s.floor >= 0 && (s.side === 'left' || s.side === 'right') && Number.isInteger(s.orden) && s.orden >= 0 && (s.floor > 0) === (s.type !== 'gate');
    if (valid && !busy.has(k)) { busy.add(k); placed.push(s); } else loose.push(s);
  }
  for (const s of loose) {
    if (s.type === 'gate') { const f = row(placed, 0); f.splice(f.indexOf(null), 0, s); setRow(f, 0); placed.push(s); continue; }
    const withRepos = placed.filter(reposIs).map(x => x.floor);
    const last = Math.max(0, ...placed.map(x => x.floor));
    let p = withRepos.length ? Math.max(...withRepos) : last || 1;
    if (placed.filter(x => x.floor === p).length >= REPOS_BY_FLOOR) {
      p += 1;   // planta nueva debajo: lo que había más abajo baja una
      for (const x of placed) if (x.floor >= p) x.floor += 1;
    }
    const left = placed.filter(x => x.floor === p && x.side === 'left').length, right = placed.filter(x => x.floor === p && x.side === 'right').length;
    Object.assign(s, right <= left ? { floor: p, side: 'right', orden: right } : { floor: p, side: 'left', orden: left });
    placed.push(s);
  }
  return compact(out).map(s => ({ ...s, manual: true }));
}

/** Destino de una sala arrastrada en el plano: un hueco de una planta (si está ocupado, la sala entra ahí y las demás se
 *  apartan hacia fuera) o, con `nueva`, una planta nueva que se abre en `planta` (las de debajo bajan una). */
export interface Target { floor: number; side: 'left' | 'right'; orden: number; newFloor?: boolean }

/** Coloca una sala en su destino. Pasa la disposición a mano; la planta que se queda vacía desaparece. Devuelve null si
 *  no se puede (la puerta no se mueve; nadie más entra en la PB). */
export function placeRoom<T extends { id: string; type: string; name: string; manual?: boolean } & Gap>(rooms: T[], id: string, d: Target): (T & Gap)[] | null {
  const out = rooms.map(s => ({ ...s, manual: true })) as (T & Gap)[];
  const s = out.find(x => x.id === id);
  const last = Math.max(...out.map(x => x.floor));
  if (!s || s.type === 'gate' || !Number.isInteger(d.floor) || d.floor < 1 || d.floor > last + 1 || (d.side !== 'left' && d.side !== 'right') || !Number.isInteger(d.orden) || d.orden < 0) return null;
  if (!d.newFloor && d.floor === s.floor && d.side === s.side && d.orden === s.orden) return null;
  const origin = row(out, s.floor); origin.splice(origin.indexOf(s), 1); setRow(origin, s.floor);
  if (d.newFloor) for (const x of out) if (x !== s && x.floor >= d.floor) x.floor += 1;
  const f = row(out.filter(x => x !== s), d.floor), elev = f.indexOf(null);
  f.splice(d.side === 'left' ? Math.max(0, elev - d.orden) : Math.min(f.length, elev + 1 + d.orden), 0, s);
  setRow(f, d.floor);
  return compact(out);
}

/** Lleva una planta entera (salvo la PB) a otra altura: las de en medio se corren una. Pasa la disposición a mano. */
export function moveFloor<T extends { id: string; type: string; name: string; manual?: boolean } & Gap>(rooms: T[], from: number, a: number): (T & Gap)[] | null {
  const last = Math.max(...rooms.map(x => x.floor));
  if (from === a || from < 1 || a < 1 || from > last || a > last) return null;
  const orden = Array.from({ length: last }, (_, k) => k + 1);
  orden.splice(a - 1, 0, ...orden.splice(from - 1, 1));
  const renumbered = new Map(orden.map((p, k) => [p, k + 1]));
  return rooms.map(s => ({ ...s, manual: true, floor: s.floor === 0 ? 0 : renumbered.get(s.floor)! }));
}

/** Vuelve a la disposición de serie (la que se calcula sola) */
export const defaultLayout = <T extends { id: string; type: string; name: string; manual?: boolean }>(rooms: T[]) =>
  distribute(rooms.map(({ manual: _, ...s }) => s as T));
