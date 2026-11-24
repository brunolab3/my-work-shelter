// Decorado de una sala de repo: la escena que el habitante diseña para su sala a partir de lo que hay en el repo
// («Adaptar la sala al repo»). Son datos, nunca código: el servidor los valida con sanearDecorado al recibirlos (de las
// herramientas del habitante, server/roomDecor.ts) y al cargar el estado, y el cliente los monta con el atrezo del
// juego (web/src/world/rooms/decor.ts). Guía para quien diseña: docs/decor.md.
//
// Coordenadas de la sala (metros): x de -6 a 6 (izquierda a derecha, vista desde el pasillo), suelo en y = 0, techo
// en y = 4,43; z de -2,3 (pared del fondo) a 2,3 (borde del corte). La franja z > 0,8 es el pasillo por donde se anda.

import { t as tr } from './language.ts';
export const BASES_DECOR = ['empty', 'studio', 'lab', 'foundry', 'archive', 'taller', 'tallerWeb', 'showcase', 'brand', 'projection'] as const;
export type BaseDecor = typeof BASES_DECOR[number];
/** Qué trae cada base (lo leen el habitante y el panel de la sala) */
export const DESCRIPTION_BASE: Record<BaseDecor, string> = {
  empty: 'sala vacía: solo paredes, suelo, tuberías del techo, la zona de trabajo del centro y lo que pongas tú (la pieza, con un sitio por defecto si no lo das)',
  studio: 'estudio (la plantilla de los repos web y Node): rack de servidores con pilotos y rincón con sofá',
  lab: 'laboratorio (la de Python): terrario de cristal en el centro, mesa de pruebas con fregadero e invernadero de bandejas',
  foundry: 'fundición (la de Rust y Go): forja de ladrillo con campana y chimenea, yunque sobre tocón, crisol y tina de temple',
  archive: 'archivo (la de las carpetas sin código): estantería alta de cajas, fichero con terminal y mesa de consulta',
  taller: 'banco de pruebas genérico: banco de herramientas, armario de servidores y la gran pantalla del repo',
  tallerWeb: 'taller web hecho a mano: puestos de trabajo, tablón de corcho, tanque de líquido burbujeante y pilotos',
  showcase: 'escaparate: tótem con la landing en una tarima con focos de exposición y sofá de pruebas de usuario',
  brand: 'archivo de marca: muro de muestras de color y logotipos, mesa de dibujo con planos, estanterías de catálogos y botes de pintura',
  projection: 'sala de proyección: cine con pantalla grande, telón y butacas, y cabina de montaje con proyector, foco y rack de render',
};
export const DECOR_WALLS = ['Wall_1', 'Wall_2', 'Wall_3', 'Wall_4', 'Wall_5', 'Wall_Empty'] as const;
export const DECOR_PALETTES = ['taller', 'web', 'brand', 'video', 'landing', 'comms', 'plan', 'logistics', 'vault', 'bridge', 'neutral'] as const;
export const SIGN_SYMBOLS = ['gear', 'eye', 'bolt', 'hand'] as const;
/** Gestos que el habitante hace en la pieza protagonista o en su afición (clips de KayKit) */
export const GESTURES = ['Interact', 'Use_Item', 'Holding_A', 'Holding_B', 'Working_A', 'Working_B', 'Working_C', 'PickUp', 'Hammering', 'Cheering', 'Waving', 'Idle_A'] as const;
/** Packs del atrezo, con la carpeta de cada uno dentro de assets/ (los mismos prefijos que R en web/src/engine/assets.ts):
 *  un modelo es «<pack>/<nombre>», p. ej. «mueble/desk» o «sf/Props_ComputerSmall» */
export const PACKS: Record<string, { folder: string; ext: string; what: string }> = {
  sf: { folder: 'quaternius/modular_sci_fi', ext: '.glb', what: 'base sci-fi: ordenadores, cápsulas, vasijas, estanterías, cajas, teletransportador, estatua, columnas, rejillas y placas de pared' },
  cy: { folder: 'quaternius/cyberpunk_pack', ext: '.glb', what: 'cyberpunk: ordenadores y armarios de servidores, televisores, antenas, aire acondicionado, depósitos, tuberías, farolas, carteles, plataformas, palancas' },
  casa: { folder: 'quaternius/house_interior_pack', ext: '.glb', what: 'interior de casa: sofás, sillas, mesas, estanterías, cajoneras, lámparas de techo y de pie, plantas, alfombras, chimenea, cocina, baño' },
  sv: { folder: 'quaternius/survival_pack', ext: '.glb', what: 'supervivencia: hogueras, tienda de campaña, radio, linternas y antorchas, botiquines, latas, bidones, pala, hacha, mochila, balsa' },
  cultivo: { folder: 'quaternius/crops_pack', ext: '.glb', what: 'cultivos: plantas, frutas y hortalizas' },
  roca: { folder: 'quaternius/nature_pack', ext: '.glb', what: 'rocas' },
  mueble: { folder: 'kaykit-extra/furniture-bits-1.0/Assets/gltf', ext: '.gltf', what: 'muebles: mesas y escritorios, sillas, sofás, estanterías, armarios, camas, lámparas, monitor, teclado, cuadros, alfombras, cactus, tazas, libros' },
  herr: { folder: 'kaykit-extra/rpg-tools-bits-1.0/Assets/gltf', ext: '.gltf', what: 'oficios: yunque, muela, martillos, sierras, destornilladores, planos, diarios, mapas, lupa, linterna, llaves y candados, pesca' },
  resource: { folder: 'kaykit-extra/resource-bits-1.0/Assets/gltf', ext: '.gltf', what: 'recursos: cajas y contenedores, lingotes y pepitas, barriles de combustible, comida en cestas y cajones, madera, piedra' },
  cocina: { folder: 'kaykit-extra/restaurant-bits-1.0/Assets/gltf', ext: '.gltf', what: 'restaurante: menaje, comida, cafetera, hornos, fogones, mesas y sillas, vitrinas' },
  base: { folder: 'kaykit-extra/space-base-bits-1.0/Assets/gltf', ext: '.gltf', what: 'base espacial: módulos, cúpula, carga y contenedores, taladro, naves de aterrizaje, camiones, paneles solares, granja espacial, rocas' },
  acc: { folder: 'kaykit/adventurers-2.0/Assets/gltf', ext: '.gltf', what: 'aventureros: armas, escudos, pociones, libros de hechizos, bastones, jarras, cajas de munición' },
};
export const PACKS_PROPS = Object.keys(PACKS);
/** Ruta (dentro de assets/) del modelo de un id del catálogo, o null */
export function propsPath(id: string): string | null {
  const i = id.indexOf('/'); const p = PACKS[id.slice(0, i)];
  return p && isModelProps(id) ? `${p.folder}/${id.slice(i + 1)}${p.ext}` : null;
}

export interface DecorPiece {
  model: string;            // id del catálogo de atrezo: «<pack>/<nombre>»
  x: number; z: number;
  y?: number;                // solo para colgar algo (en la pared o del techo); si no, en el suelo o sobre `sobre`
  rotation?: number;             // en grados, alrededor del eje vertical (0: de frente al pasillo)
  height?: number; width?: number;   // tamaño en metros (uno de los dos; sin ninguno, el sugerido del catálogo)
  restsOn?: number;            // índice (en `piezas`) de la pieza sobre la que se apoya: la mesa de una lámpara
  wall?: boolean;           // pegada a la pared del fondo
  lying?: boolean;         // echada sobre lo que la sostiene (herramientas en un banco, libros)
  color?: string;            // tinte (#rrggbb) que multiplica sus colores
  light?: string;              // brillo propio (#rrggbb): pantallas, pilotos, lámparas, fuego
}
export interface DecorSign { x: number; y: number; width: number; title: string; lines: string[]; background?: string; ink?: string; symbol?: typeof SIGN_SYMBOLS[number]; rotation?: number }
export interface DecorPoint { x: number; z: number; rotation?: number; gestures?: typeof GESTURES[number][] }

export interface Decor {
  version: 1;
  base: BaseDecor;
  summary?: string;          // en una frase, de qué va la escena (sale en el panel de la sala)
  subtitle?: string;        // bajo el nombre del cartel de la sala (en mayúsculas)
  accent?: string;           // color de acento de la sala (#rrggbb)
  palette?: typeof DECOR_PALETTES[number];   // paredes y pantallas
  walls?: [string, string, string];          // los tres paneles de la pared del fondo, de izquierda a derecha
  light?: number;              // 0,2 (penumbra) a 1,4 (muy iluminada)
  mirror?: boolean;          // la base, reflejada de izquierda a derecha
  // en la sala vacía: dónde va cada cosa imprescindible (en las demás bases ya la trae la base); board and desk are fixed
  workstation?: { screen?: 'monitor' | 'dual' | 'computer'; desk?: string };   // the dweller's desk (always at DESK, in the work zone)
  piece?: DecorPoint;     // dónde se pone el habitante a usar la pieza protagonista
  hobby?: DecorPoint;   // un rincón suyo (opcional)
  lamps?: { x: number; z: number; color?: string; intensity?: number }[];
  pieces?: DecorPiece[];
  signs?: DecorSign[];
}

// (paredVista: hasta dónde se ve la pared del fondo desde el pasillo; más arriba la tapa la viga del corte)
export const LIMITS = { x: 5.8, zBackground: -2.25, zFront: 2.1, ceiling: 4.3, viewWall: 3.6, corridor: 0.8, pieces: 80, signs: 4, lamps: 4 } as const;
const WALL_Z = -2.3;

/** The room's task board (web/src/world/rooms/taskBoard.ts): on the back wall, centred above the dweller's desk, the
 *  same in every repo room; nothing of a dressing may cover it */
export interface BoardSpot { x: number; y: number; width: number; height: number }
export const BOARD_RATIO = 0.45;
const BOARD: BoardSpot = { x: 0, y: 2.65, width: 3.2, height: 3.2 * BOARD_RATIO };
/** Every repo room has its work zone in the middle third: the dweller's desk (`DESK`) with the task board above it.
 *  Scenes and dressings keep their pieces out of it (|x| < `x`, back of the aisle); the side thirds are theirs */
export const WORK_ZONE = { x: 2.0 } as const;
/** The dweller's desk: in the middle, under the board, the seat facing the wall (so its monitor faces the player) */
export const DESK = { x: 0, z: -1.05, rotation: 0 } as const;
/** A room's seed (its scene's variations; odd ones are the scene as written, even ones mirrored), with the dressing's mirror */
export function roomSeed(id: string, mirror?: boolean) {
  let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000 + 1 + (mirror ? 1 : 0);
}
/** Where a room's task board goes: the middle of the back wall, in every scene */
export function boardSpot(_base?: BaseDecor, _roomId?: string, _d?: Decor | null): BoardSpot { return { ...BOARD }; }
/** Whether a box on the back wall (centre, width, height) covers part of the board */
/** How far from the back wall a piece still counts as covering the board (further forward, the board shows above it) */
export const BOARD_CLEAR = 1.2;
export const coversBoard = (b: BoardSpot, x: number, y: number, w: number, h: number) =>
  Math.abs(x - b.x) < (w + b.width) / 2 + 0.04 && Math.abs(y - b.y) < (h + b.height) / 2 + 0.04;

/** The room panel (web/src/world/rooms/roomPanel.ts): a floor terminal the Overseer walks up to and uses, in the front
 *  corner of the entrance side (the lift's: right in the left-hand rooms, left in the right-hand ones), the same in
 *  every room. `panelSpot` is its footprint on the floor (centre and size): scenes and dressings keep clear of it */
export interface FloorSpot { x: number; z: number; width: number; background: number }
export function panelSpot(side: 'left' | 'right'): FloorSpot { return { x: (side === 'left' ? 1 : -1) * 5.3, z: 0.5, width: 0.9, background: 0.8 }; }
const onFloor = (f: FloorSpot, x0: number, x1: number, z0: number, z1: number) => x1 > f.x - f.width / 2 && x0 < f.x + f.width / 2 && z1 > f.z - f.background / 2 && z0 < f.z + f.background / 2;
/** Whether a piece on the floor (its box) gets in the way of the work zone or of the room panel: the game leaves it out */
export function inTheWay(x0: number, x1: number, z0: number, z1: number, y0: number, side?: 'left' | 'right') {
  if (y0 < 3.4 && x1 > -WORK_ZONE.x + 0.05 && x0 < WORK_ZONE.x - 0.05 && z0 < LIMITS.corridor) return 'work';
  if (side && y0 < 1.6 && onFloor(panelSpot(side), x0, x1, z0, z1)) return 'panel';
  return null;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
// texto de un cartel o una pantalla: una línea, sin caracteres de control, recortado
// (los invisibles y los de control se montan por código: escritos tal cual, el separador de línea U+2028 corta la expresión)
const INVISIBLE = new RegExp('[' + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const from = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly unknown[]).includes(v) ? v as T : undefined;
export const isModelProps = (m: unknown): m is string => typeof m === 'string' && /^[a-z]+\/[A-Za-z0-9_. -]{1,80}$/.test(m) && !m.includes('..') && PACKS_PROPS.includes(m.split('/')[0]);

/** Valida y recorta un decorado. Lo que no cuadra se corrige (y se avisa) o se descarta; sin base válida, null. */
export function sanitizeDecor(d: unknown): { decor: Decor | null; notices: string[] } {
  const notices: string[] = [];
  if (!d || typeof d !== 'object') return { decor: null, notices: [tr('tool.decor.check.notAnObject')] };
  const x = d as Record<string, any>;
  const base = from(BASES_DECOR, x.base);
  if (!base) return { decor: null, notices: [tr('tool.decor.check.baseOneOf', { list: BASES_DECOR.join(', ') })] };
  const lim = (v: unknown, a: number, b: number, what: string, def?: number) => {
    const n = num(v); if (n === undefined) return def;
    if (n < a || n > b) notices.push(tr('tool.decor.check.outOfRange', { what: what, n, a, b }));
    return Math.round(Math.min(b, Math.max(a, n)) * 1000) / 1000;
  };
  const out: Decor = { version: 1, base };
  const summary = text(x.summary, 200); if (summary) out.summary = summary;
  const sub = text(x.subtitle, 24).toUpperCase(); if (sub) out.subtitle = sub;
  if (text(x.subtitle, 400).length > 24) notices.push(tr('tool.decor.check.subtitleFits', { sub }));
  const accent = color(x.accent); if (accent) out.accent = accent; else if (x.accent !== undefined) notices.push(tr('tool.decor.check.accentColor'));
  const palette = from(DECOR_PALETTES, x.palette); if (palette) out.palette = palette; else if (x.palette !== undefined) notices.push(tr('tool.decor.check.paletteOneOf', { list: DECOR_PALETTES.join(', ') }));
  if (Array.isArray(x.walls)) {
    const p = x.walls.slice(0, 3).map((w: unknown) => from(DECOR_WALLS, w));
    if (p.length === 3 && p.every(Boolean)) out.walls = p as [string, string, string]; else notices.push(tr('tool.decor.check.wallsThree', { list: DECOR_WALLS.join(', ') }));
  }
  const light = lim(x.light, 0.2, 1.4, 'luz'); if (light !== undefined) out.light = light;
  if (x.mirror === true) out.mirror = true;
  const rotation = (v: unknown) => { const n = num(v); return n === undefined ? undefined : Math.round(((n % 360) + 360) % 360); };
  const point = (p: any, what: string): DecorPoint | undefined => {
    if (!p || typeof p !== 'object') return undefined;
    const r: DecorPoint = { x: lim(p.x, -LIMITS.x, LIMITS.x, `${what}.x`, 0)!, z: lim(p.z, LIMITS.zBackground, LIMITS.zFront, `${what}.z`, 0)! };
    const g = rotation(p.rotation); if (g !== undefined) r.rotation = g;
    const gs = Array.isArray(p.gestures) ? p.gestures.map((c: unknown) => from(GESTURES, c)).filter(Boolean).slice(0, 4) : [];
    if (gs.length) r.gestures = gs as DecorPoint['gestures'];
    return r;
  };
  // the board and the desk have their fixed spot in the work zone (older dressings placed them: that is dropped)
  if (x.repoScreen !== undefined || (x.workstation && (x.workstation.x !== undefined || x.workstation.z !== undefined))) notices.push(tr('tool.decor.check.workZoneFixed'));
  if (x.workstation && typeof x.workstation === 'object') {
    const workstation: NonNullable<Decor['workstation']> = {};
    const screen = from(['monitor', 'dual', 'computer'] as const, x.workstation.screen); if (screen) workstation.screen = screen;
    if (x.workstation.desk !== undefined) { if (isModelProps(x.workstation.desk)) workstation.desk = x.workstation.desk; else notices.push(tr('tool.decor.check.deskModel')); }
    if (Object.keys(workstation).length) out.workstation = workstation;
  }
  const pz = point(x.piece, 'piece'); if (pz) out.piece = pz;
  const hobby = point(x.hobby, 'hobby'); if (hobby) out.hobby = hobby;
  if (Array.isArray(x.lamps)) {
    if (x.lamps.length > LIMITS.lamps) notices.push(tr('tool.decor.check.maxLamps', { n: LIMITS.lamps }));
    out.lamps = x.lamps.slice(0, LIMITS.lamps).filter((l: any) => l && typeof l === 'object').map((l: any, i: number) => ({
      x: lim(l.x, -LIMITS.x, LIMITS.x, `lamps[${i}].x`, 0)!, z: lim(l.z, LIMITS.zBackground, 1.2, `lamps[${i}].z`, 0.4)!,
      ...(color(l.color) ? { color: color(l.color) } : {}), ...(num(l.intensity) !== undefined ? { intensity: lim(l.intensity, 20, 160, `lamps[${i}].intensity`) } : {}),
    }));
  }
  if (Array.isArray(x.pieces)) {
    if (x.pieces.length > LIMITS.pieces) notices.push(tr('tool.decor.check.maxPieces', { n: LIMITS.pieces, extra: x.pieces.length - LIMITS.pieces }));
    const pieces: DecorPiece[] = [];
    const index = new Map<number, number>();   // índice pedido → índice guardado (las descartadas no cuentan)
    x.pieces.slice(0, LIMITS.pieces).forEach((p: any, i: number) => {
      if (!p || typeof p !== 'object' || !isModelProps(p.model)) { notices.push(tr('tool.decor.check.pieceModel', { i })); return; }
      const r: DecorPiece = { model: p.model, x: lim(p.x, -LIMITS.x, LIMITS.x, `pieces[${i}].x`, 0)!, z: lim(p.z, LIMITS.zBackground, LIMITS.zFront, `pieces[${i}].z`, 0)! };
      const y = lim(p.y, 0, LIMITS.ceiling, `pieces[${i}].y`); if (y !== undefined && y > 0) r.y = y;
      const g = rotation(p.rotation); if (g) r.rotation = g;
      const height = lim(p.height, 0.03, 4.2, `pieces[${i}].height`); const width = lim(p.width, 0.03, 6, `pieces[${i}].width`);
      if (height !== undefined) r.height = height; else if (width !== undefined) r.width = width;
      if (p.restsOn !== undefined) {
        const s = num(p.restsOn);
        if (s !== undefined && index.has(s)) r.restsOn = index.get(s); else notices.push(tr('tool.decor.check.pieceOn', { i }));
      }
      if (p.wall === true) r.wall = true;
      if (p.lying === true) r.lying = true;
      if (color(p.color)) r.color = color(p.color);
      if (color(p.light)) r.light = color(p.light);
      index.set(i, pieces.length); pieces.push(r);
    });
    if (pieces.length) out.pieces = pieces;
  }
  // un texto que no cabe se corta (y se avisa: cortado a media palabra se lee mal)
  const short = (v: unknown, n: number, what: string) => {
    const t = text(v, 400);
    if (t.length > n) notices.push(tr('tool.decor.check.tooLong', { what: what, t, n: t.length, max: n, short: t.slice(0, n) }));
    return t.slice(0, n).trim();
  };
  // signs, on the back wall and wholly inside it
  const inWall = (o: any, what: string, widthMax: number, ratio: number) => {
    const width = lim(o.width, 0.3, widthMax, `${what}.ancho`, Math.min(0.7, widthMax))!;
    const height = width * ratio;
    return { width, x: lim(o.x, -LIMITS.x + width / 2, LIMITS.x - width / 2, `${what}.x`, 0)!, y: lim(o.y, height / 2 + 0.3, LIMITS.viewWall - height / 2, `${what}.y`, 2)! };
  };
  if (Array.isArray(x.signs)) {
    if (x.signs.length > LIMITS.signs) notices.push(tr('tool.decor.check.maxSigns', { n: LIMITS.signs }));
    const cs = x.signs.slice(0, LIMITS.signs).filter((c: any) => c && typeof c === 'object').map((c: any, i: number) => {
      const r: DecorSign = { ...inWall(c, `signs[${i}]`, 1.6, 720 / 512), title: short(c.title, 32, `signs[${i}].title`), lines: (Array.isArray(c.lines) ? c.lines : []).slice(0, 5).map((l: unknown, j: number) => short(l, 12, `signs[${i}].lineas[${j}]`)).filter(Boolean) };
      if (color(c.background)) r.background = color(c.background); if (color(c.ink)) r.ink = color(c.ink);
      const s = from(SIGN_SYMBOLS, c.symbol); if (s) r.symbol = s;
      const g = num(c.rotation); if (g) r.rotation = Math.max(-8, Math.min(8, g));
      return r;
    }).filter((c: DecorSign) => c.lines.length || c.title);
    if (cs.length) out.signs = cs;
  }
  // the decorative typing screens are gone: the room's one screen is its task board (old dressings lose them on load)
  if (Array.isArray(x.screens) && x.screens.length) notices.push(tr('tool.decor.check.noScreens'));
  return { decor: out, notices };
}

/** Lo que se ve mal aunque sea válido: piezas en el pasillo o fuera de la sala, colgadas en el aire, carteles que se
 *  pisan o que tapan el tablero de tareas (`tablero`: boardSpot de la sala), y piezas en la zona de trabajo o encima del
 *  panel de la sala (`lado`: el de la sala, panelSpot). `tam` da el tamaño (ancho, alto, fondo) de cada modelo en metros a
 *  la escala pedida. */
export function reviewDecor(d: Decor, size: (p: DecorPiece) => [number, number, number] | null, board?: BoardSpot, side?: 'left' | 'right'): string[] {
  const notices: string[] = [];
  const boxes: { i: number; x0: number; x1: number; z0: number; z1: number; height: number }[] = [];
  (d.pieces ?? []).forEach((p, i) => {
    const t = size(p);
    if (!t) { notices.push(tr('tool.decor.check.notInCatalogue', { i, model: p.model })); return; }
    const [w, h, f] = t; const a = ((p.rotation ?? 0) * Math.PI) / 180;
    const ax = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * f, az = Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * f;
    const x0 = p.x - ax / 2, x1 = p.x + ax / 2, z0 = p.wall ? WALL_Z : p.z - az / 2, z1 = p.wall ? WALL_Z + az : p.z + az / 2;
    if (x0 < -6 || x1 > 6) notices.push(tr(x0 < -6 ? 'tool.decor.check.outLeft' : 'tool.decor.check.outRight', { i, model: p.model, x0: x0.toFixed(2), x1: x1.toFixed(2) }));
    if (z0 < WALL_Z - 0.05 && !p.wall) notices.push(tr('tool.decor.check.intoBackWall', { i, model: p.model, z: z0.toFixed(2) }));
    if ((p.y ?? 0) + h > 4.43) notices.push(tr('tool.decor.check.throughCeiling', { i, model: p.model, y: ((p.y ?? 0) + h).toFixed(2) }));
    if (p.restsOn === undefined && !p.y && z1 > LIMITS.corridor + 0.15 && h > 0.35) notices.push(tr('tool.decor.check.intoAisle', { i, model: p.model, z: z1.toFixed(2), corridor: LIMITS.corridor }));
    if (p.y && p.y > 0.05 && !p.wall && p.restsOn === undefined) notices.push(tr('tool.decor.check.floats', { i, model: p.model, y: p.y }));
    if (p.restsOn === undefined && !p.y && h > 0.25) boxes.push({ i, x0, x1, z0, z1, height: h });
    // near the back wall and in front of the board: the game leaves it out (web/src/world/rooms/decor.ts)
    if (board && z0 < WALL_Z + BOARD_CLEAR && coversBoard(board, p.x, (p.y ?? 0) + h / 2, ax, h)) notices.push(tr('tool.decor.check.coversBoard', { what: `pieces[${i}] ${p.model}` }));
    const obstructs = p.restsOn === undefined ? inTheWay(x0, x1, z0, z1, p.y ?? 0, side) : null;
    if (obstructs) notices.push(tr(obstructs === 'work' ? 'tool.decor.check.inWorkZone' : 'tool.decor.check.onPanel', { what: `pieces[${i}] ${p.model}` }));
  });
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const A = boxes[a], B = boxes[b];
    const dx = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), dz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
    if (dx > 0.12 && dz > 0.12) notices.push(tr('tool.decor.check.overlapFloor', { a: A.i, ma: d.pieces![A.i].model, b: B.i, mb: d.pieces![B.i].model, dx: dx.toFixed(2), dz: dz.toFixed(2) }));
  }
  const inWall = (d.signs ?? []).map((c, i) => ({ what: `signs[${i}]`, x: c.x, y: c.y, w: c.width, h: c.width * 720 / 512 }));
  if (board) for (const c of inWall) if (coversBoard(board, c.x, c.y, c.w, c.h)) notices.push(tr('tool.decor.check.coversBoard', { what: c.what }));
  for (let a = 0; a < inWall.length; a++) for (let b = a + 1; b < inWall.length; b++) {
    const A = inWall[a], B = inWall[b];
    if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 - 0.05 && Math.abs(A.y - B.y) < (A.h + B.h) / 2 - 0.05) notices.push(tr('tool.decor.check.overlapWall', { a: A.what, b: B.what }));
  }
  if (d.base === 'empty' && !(d.pieces ?? []).length) notices.push(tr('tool.decor.check.emptyRoom'));
  return notices;
}

/** Firma corta (para volver a montar la sala cuando cambia) */
export function decorSignature(d: Decor | null | undefined) {
  if (!d) return '';
  let h = 2166136261; for (const c of JSON.stringify(d)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Plantilla de serie de una sala de recluta según el tipo de su repo (InfoRepo.tipo, server/repos.ts → tipoProyecto) */
export function templateOf(type: string | undefined, isGit?: boolean): 'foundry' | 'lab' | 'studio' | 'archive' | 'taller' {
  const t = (type ?? '').toLowerCase();
  if (t === 'rust' || t === 'go') return 'foundry';
  if (t === 'python') return 'lab';
  if (t.startsWith('web') || t === 'node' || t === 'desktop') return 'studio';
  if (t === 'folder' || isGit === false) return 'archive';
  return 'taller';
}
/** La escena que lleva una sala de repo sin decorado: la de su estilo o, si no tiene uno propio, la de su tipo de repo */
export function baseStock(s: { type: string; style?: string }, repo?: { type?: string; isGit?: boolean }): BaseDecor {
  if (s.type === 'coordination') return 'archive';
  const styleBy: Record<string, BaseDecor> = { landing: 'showcase', brand: 'brand', video: 'projection', tallerWeb: 'tallerWeb', studio: 'studio', lab: 'lab', foundry: 'foundry', archive: 'archive', taller: 'taller' };
  return styleBy[s.style ?? ''] ?? templateOf(repo?.type, repo?.isGit);
}
