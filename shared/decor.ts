// Decorado de una sala de repo: la escena que el habitante diseña para su sala a partir de lo que hay en el repo
// («Adaptar la sala al repo»). Son datos, nunca código: el servidor los valida con sanearDecorado al recibirlos (de las
// herramientas del habitante, server/roomDecor.ts) y al cargar el estado, y el cliente los monta con el atrezo del
// juego (web/src/world/rooms/decor.ts). Guía para quien diseña: docs/decor.md.
//
// Coordenadas de la sala (metros): x de -6 a 6 (izquierda a derecha, vista desde el pasillo), suelo en y = 0, techo
// en y = 4,43; z de -2,3 (pared del fondo) a 2,3 (borde del corte). La franja z > 0,8 es el pasillo por donde se anda.

import { t as tr } from './language.ts';
export const BASES_DECOR = ['vacia', 'estudio', 'laboratorio', 'fundicion', 'archivo', 'taller', 'tallerWeb', 'escaparate', 'marca', 'proyeccion'] as const;
export type BaseDecor = typeof BASES_DECOR[number];
/** Qué trae cada base (lo leen el habitante y el panel de la sala) */
export const DESCRIPTION_BASE: Record<BaseDecor, string> = {
  vacia: 'sala vacía: solo paredes, suelo, tuberías del techo, la zona de trabajo del centro y lo que pongas tú (la pieza, con un sitio por defecto si no lo das)',
  estudio: 'estudio (la plantilla de los repos web y Node): rack de servidores con pilotos y rincón con sofá',
  laboratorio: 'laboratorio (la de Python): terrario de cristal en el centro, mesa de pruebas con fregadero e invernadero de bandejas',
  fundicion: 'fundición (la de Rust y Go): forja de ladrillo con campana y chimenea, yunque sobre tocón, crisol y tina de temple',
  archivo: 'archivo (la de las carpetas sin código): estantería alta de cajas, fichero con terminal y mesa de consulta',
  taller: 'banco de pruebas genérico: banco de herramientas, armario de servidores y la gran pantalla del repo',
  tallerWeb: 'taller web hecho a mano: puestos de trabajo, tablón de corcho, tanque de líquido burbujeante y pilotos',
  escaparate: 'escaparate: tótem con la landing en una tarima con focos de exposición y sofá de pruebas de usuario',
  marca: 'archivo de marca: muro de muestras de color y logotipos, mesa de dibujo con planos, estanterías de catálogos y botes de pintura',
  proyeccion: 'sala de proyección: cine con pantalla grande, telón y butacas, y cabina de montaje con proyector, foco y rack de render',
};
export const DECOR_WALLS = ['Wall_1', 'Wall_2', 'Wall_3', 'Wall_4', 'Wall_5', 'Wall_Empty'] as const;
export const DECOR_PALETTES = ['taller', 'web', 'marca', 'video', 'landing', 'comms', 'plan', 'logistica', 'acorazada', 'puente', 'neutro'] as const;
export const SIGN_SYMBOLS = ['engranaje', 'ojo', 'rayo', 'mano'] as const;
/** Gestos que el habitante hace en la pieza protagonista o en su afición (clips de KayKit) */
export const GESTURES = ['Interact', 'Use_Item', 'Holding_A', 'Holding_B', 'Working_A', 'Working_B', 'Working_C', 'PickUp', 'Hammering', 'Cheering', 'Waving', 'Idle_A'] as const;
/** Packs del atrezo, con la carpeta de cada uno dentro de assets/ (los mismos prefijos que R en web/src/engine/assets.ts):
 *  un modelo es «<pack>/<nombre>», p. ej. «mueble/desk» o «sf/Props_ComputerSmall» */
export const PACKS: Record<string, { carpeta: string; ext: string; que: string }> = {
  sf: { carpeta: 'quaternius/modular_sci_fi', ext: '.glb', que: 'base sci-fi: ordenadores, cápsulas, vasijas, estanterías, cajas, teletransportador, estatua, columnas, rejillas y placas de pared' },
  cy: { carpeta: 'quaternius/cyberpunk_pack', ext: '.glb', que: 'cyberpunk: ordenadores y armarios de servidores, televisores, antenas, aire acondicionado, depósitos, tuberías, farolas, carteles, plataformas, palancas' },
  casa: { carpeta: 'quaternius/house_interior_pack', ext: '.glb', que: 'interior de casa: sofás, sillas, mesas, estanterías, cajoneras, lámparas de techo y de pie, plantas, alfombras, chimenea, cocina, baño' },
  sv: { carpeta: 'quaternius/survival_pack', ext: '.glb', que: 'supervivencia: hogueras, tienda de campaña, radio, linternas y antorchas, botiquines, latas, bidones, pala, hacha, mochila, balsa' },
  cultivo: { carpeta: 'quaternius/crops_pack', ext: '.glb', que: 'cultivos: plantas, frutas y hortalizas' },
  roca: { carpeta: 'quaternius/nature_pack', ext: '.glb', que: 'rocas' },
  mueble: { carpeta: 'kaykit-extra/furniture-bits-1.0/Assets/gltf', ext: '.gltf', que: 'muebles: mesas y escritorios, sillas, sofás, estanterías, armarios, camas, lámparas, monitor, teclado, cuadros, alfombras, cactus, tazas, libros' },
  herr: { carpeta: 'kaykit-extra/rpg-tools-bits-1.0/Assets/gltf', ext: '.gltf', que: 'oficios: yunque, muela, martillos, sierras, destornilladores, planos, diarios, mapas, lupa, linterna, llaves y candados, pesca' },
  resource: { carpeta: 'kaykit-extra/resource-bits-1.0/Assets/gltf', ext: '.gltf', que: 'recursos: cajas y contenedores, lingotes y pepitas, barriles de combustible, comida en cestas y cajones, madera, piedra' },
  cocina: { carpeta: 'kaykit-extra/restaurant-bits-1.0/Assets/gltf', ext: '.gltf', que: 'restaurante: menaje, comida, cafetera, hornos, fogones, mesas y sillas, vitrinas' },
  base: { carpeta: 'kaykit-extra/space-base-bits-1.0/Assets/gltf', ext: '.gltf', que: 'base espacial: módulos, cúpula, carga y contenedores, taladro, naves de aterrizaje, camiones, paneles solares, granja espacial, rocas' },
  acc: { carpeta: 'kaykit/adventurers-2.0/Assets/gltf', ext: '.gltf', que: 'aventureros: armas, escudos, pociones, libros de hechizos, bastones, jarras, cajas de munición' },
};
export const PACKS_PROPS = Object.keys(PACKS);
/** Ruta (dentro de assets/) del modelo de un id del catálogo, o null */
export function propsPath(id: string): string | null {
  const i = id.indexOf('/'); const p = PACKS[id.slice(0, i)];
  return p && isModelProps(id) ? `${p.carpeta}/${id.slice(i + 1)}${p.ext}` : null;
}

export interface DecorPiece {
  modelo: string;            // id del catálogo de atrezo: «<pack>/<nombre>»
  x: number; z: number;
  y?: number;                // solo para colgar algo (en la pared o del techo); si no, en el suelo o sobre `sobre`
  giro?: number;             // en grados, alrededor del eje vertical (0: de frente al pasillo)
  alto?: number; ancho?: number;   // tamaño en metros (uno de los dos; sin ninguno, el sugerido del catálogo)
  sobre?: number;            // índice (en `piezas`) de la pieza sobre la que se apoya: la mesa de una lámpara
  pared?: boolean;           // pegada a la pared del fondo
  tumbada?: boolean;         // echada sobre lo que la sostiene (herramientas en un banco, libros)
  color?: string;            // tinte (#rrggbb) que multiplica sus colores
  luz?: string;              // brillo propio (#rrggbb): pantallas, pilotos, lámparas, fuego
}
export interface DecorSign { x: number; y: number; ancho: number; titulo: string; lineas: string[]; fondo?: string; tinta?: string; simbolo?: typeof SIGN_SYMBOLS[number]; giro?: number }
export interface DecorPoint { x: number; z: number; giro?: number; gestos?: typeof GESTURES[number][] }

export interface Decorado {
  version: 1;
  base: BaseDecor;
  resumen?: string;          // en una frase, de qué va la escena (sale en el panel de la sala)
  subtitulo?: string;        // bajo el nombre del cartel de la sala (en mayúsculas)
  acento?: string;           // color de acento de la sala (#rrggbb)
  paleta?: typeof DECOR_PALETTES[number];   // paredes y pantallas
  paredes?: [string, string, string];          // los tres paneles de la pared del fondo, de izquierda a derecha
  luz?: number;              // 0,2 (penumbra) a 1,4 (muy iluminada)
  espejo?: boolean;          // la base, reflejada de izquierda a derecha
  // en la sala vacía: dónde va cada cosa imprescindible (en las demás bases ya la trae la base); board and desk are fixed
  puesto?: { pantalla?: 'monitor' | 'doble' | 'ordenador'; mesa?: string };   // the dweller's desk (always at DESK, in the work zone)
  pieza?: DecorPoint;     // dónde se pone el habitante a usar la pieza protagonista
  aficion?: DecorPoint;   // un rincón suyo (opcional)
  lamparas?: { x: number; z: number; color?: string; intensidad?: number }[];
  piezas?: DecorPiece[];
  carteles?: DecorSign[];
}

// (paredVista: hasta dónde se ve la pared del fondo desde el pasillo; más arriba la tapa la viga del corte)
export const LIMITS = { x: 5.8, zBackground: -2.25, zFront: 2.1, techo: 4.3, viewWall: 3.6, pasillo: 0.8, piezas: 80, carteles: 4, lamparas: 4 } as const;
const WALL_Z = -2.3;

/** The room's task board (web/src/world/rooms/taskBoard.ts): on the back wall, centred above the dweller's desk, the
 *  same in every repo room; nothing of a dressing may cover it */
export interface BoardSpot { x: number; y: number; ancho: number; alto: number }
export const BOARD_RATIO = 0.45;
const BOARD: BoardSpot = { x: 0, y: 2.65, ancho: 3.2, alto: 3.2 * BOARD_RATIO };
/** Every repo room has its work zone in the middle third: the dweller's desk (`DESK`) with the task board above it.
 *  Scenes and dressings keep their pieces out of it (|x| < `x`, back of the aisle); the side thirds are theirs */
export const WORK_ZONE = { x: 2.0 } as const;
/** The dweller's desk: in the middle, under the board, the seat facing the wall (so its monitor faces the player) */
export const DESK = { x: 0, z: -1.05, giro: 0 } as const;
/** A room's seed (its scene's variations; odd ones are the scene as written, even ones mirrored), with the dressing's mirror */
export function roomSeed(id: string, espejo?: boolean) {
  let h = 2166136261; for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000 + 1 + (espejo ? 1 : 0);
}
/** Where a room's task board goes: the middle of the back wall, in every scene */
export function boardSpot(_base?: BaseDecor, _salaId?: string, _d?: Decorado | null): BoardSpot { return { ...BOARD }; }
/** Whether a box on the back wall (centre, width, height) covers part of the board */
/** How far from the back wall a piece still counts as covering the board (further forward, the board shows above it) */
export const BOARD_CLEAR = 1.2;
export const coversBoard = (b: BoardSpot, x: number, y: number, w: number, h: number) =>
  Math.abs(x - b.x) < (w + b.ancho) / 2 + 0.04 && Math.abs(y - b.y) < (h + b.alto) / 2 + 0.04;

/** The room panel (web/src/world/rooms/roomPanel.ts): a floor terminal the Overseer walks up to and uses, in the front
 *  corner of the entrance side (the lift's: right in the left-hand rooms, left in the right-hand ones), the same in
 *  every room. `panelSpot` is its footprint on the floor (centre and size): scenes and dressings keep clear of it */
export interface FloorSpot { x: number; z: number; ancho: number; fondo: number }
export function panelSpot(lado: 'izq' | 'der'): FloorSpot { return { x: (lado === 'izq' ? 1 : -1) * 5.3, z: 0.5, ancho: 0.9, fondo: 0.8 }; }
const onFloor = (f: FloorSpot, x0: number, x1: number, z0: number, z1: number) => x1 > f.x - f.ancho / 2 && x0 < f.x + f.ancho / 2 && z1 > f.z - f.fondo / 2 && z0 < f.z + f.fondo / 2;
/** Whether a piece on the floor (its box) gets in the way of the work zone or of the room panel: the game leaves it out */
export function inTheWay(x0: number, x1: number, z0: number, z1: number, y0: number, lado?: 'izq' | 'der') {
  if (y0 < 3.4 && x1 > -WORK_ZONE.x + 0.05 && x0 < WORK_ZONE.x - 0.05 && z0 < LIMITS.pasillo) return 'work';
  if (lado && y0 < 1.6 && onFloor(panelSpot(lado), x0, x1, z0, z1)) return 'panel';
  return null;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const color = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);
// texto de un cartel o una pantalla: una línea, sin caracteres de control, recortado
// (los invisibles y los de control se montan por código: escritos tal cual, el separador de línea U+2028 corta la expresión)
const INVISIBLE = new RegExp('[' + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
const texto = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const de = <T extends string>(lista: readonly T[], v: unknown): T | undefined => (lista as readonly unknown[]).includes(v) ? v as T : undefined;
export const isModelProps = (m: unknown): m is string => typeof m === 'string' && /^[a-z]+\/[A-Za-z0-9_. -]{1,80}$/.test(m) && !m.includes('..') && PACKS_PROPS.includes(m.split('/')[0]);

/** Valida y recorta un decorado. Lo que no cuadra se corrige (y se avisa) o se descarta; sin base válida, null. */
export function sanitizeDecor(d: unknown): { decorado: Decorado | null; avisos: string[] } {
  const avisos: string[] = [];
  if (!d || typeof d !== 'object') return { decorado: null, avisos: [tr('tool.decor.check.notAnObject')] };
  const x = d as Record<string, any>;
  const base = de(BASES_DECOR, x.base);
  if (!base) return { decorado: null, avisos: [tr('tool.decor.check.baseOneOf', { lista: BASES_DECOR.join(', ') })] };
  const lim = (v: unknown, a: number, b: number, que: string, def?: number) => {
    const n = num(v); if (n === undefined) return def;
    if (n < a || n > b) avisos.push(tr('tool.decor.check.outOfRange', { que, n, a, b }));
    return Math.round(Math.min(b, Math.max(a, n)) * 1000) / 1000;
  };
  const out: Decorado = { version: 1, base };
  const resumen = texto(x.resumen, 200); if (resumen) out.resumen = resumen;
  const sub = texto(x.subtitulo, 24).toUpperCase(); if (sub) out.subtitulo = sub;
  if (texto(x.subtitulo, 400).length > 24) avisos.push(tr('tool.decor.check.subtitleFits', { sub }));
  const acento = color(x.acento); if (acento) out.acento = acento; else if (x.acento !== undefined) avisos.push(tr('tool.decor.check.accentColor'));
  const paleta = de(DECOR_PALETTES, x.paleta); if (paleta) out.paleta = paleta; else if (x.paleta !== undefined) avisos.push(tr('tool.decor.check.paletteOneOf', { lista: DECOR_PALETTES.join(', ') }));
  if (Array.isArray(x.paredes)) {
    const p = x.paredes.slice(0, 3).map((w: unknown) => de(DECOR_WALLS, w));
    if (p.length === 3 && p.every(Boolean)) out.paredes = p as [string, string, string]; else avisos.push(tr('tool.decor.check.wallsThree', { lista: DECOR_WALLS.join(', ') }));
  }
  const luz = lim(x.luz, 0.2, 1.4, 'luz'); if (luz !== undefined) out.luz = luz;
  if (x.espejo === true) out.espejo = true;
  const giro = (v: unknown) => { const n = num(v); return n === undefined ? undefined : Math.round(((n % 360) + 360) % 360); };
  const punto = (p: any, que: string): DecorPoint | undefined => {
    if (!p || typeof p !== 'object') return undefined;
    const r: DecorPoint = { x: lim(p.x, -LIMITS.x, LIMITS.x, `${que}.x`, 0)!, z: lim(p.z, LIMITS.zBackground, LIMITS.zFront, `${que}.z`, 0)! };
    const g = giro(p.giro); if (g !== undefined) r.giro = g;
    const gs = Array.isArray(p.gestos) ? p.gestos.map((c: unknown) => de(GESTURES, c)).filter(Boolean).slice(0, 4) : [];
    if (gs.length) r.gestos = gs as DecorPoint['gestos'];
    return r;
  };
  // the board and the desk have their fixed spot in the work zone (older dressings placed them: that is dropped)
  if (x.pantallaRepo !== undefined || (x.puesto && (x.puesto.x !== undefined || x.puesto.z !== undefined))) avisos.push(tr('tool.decor.check.workZoneFixed'));
  if (x.puesto && typeof x.puesto === 'object') {
    const puesto: NonNullable<Decorado['puesto']> = {};
    const screen = de(['monitor', 'doble', 'ordenador'] as const, x.puesto.pantalla); if (screen) puesto.pantalla = screen;
    if (x.puesto.mesa !== undefined) { if (isModelProps(x.puesto.mesa)) puesto.mesa = x.puesto.mesa; else avisos.push(tr('tool.decor.check.deskModel')); }
    if (Object.keys(puesto).length) out.puesto = puesto;
  }
  const pz = punto(x.pieza, 'pieza'); if (pz) out.pieza = pz;
  const af = punto(x.aficion, 'aficion'); if (af) out.aficion = af;
  if (Array.isArray(x.lamparas)) {
    if (x.lamparas.length > LIMITS.lamparas) avisos.push(tr('tool.decor.check.maxLamps', { n: LIMITS.lamparas }));
    out.lamparas = x.lamparas.slice(0, LIMITS.lamparas).filter((l: any) => l && typeof l === 'object').map((l: any, i: number) => ({
      x: lim(l.x, -LIMITS.x, LIMITS.x, `lamparas[${i}].x`, 0)!, z: lim(l.z, LIMITS.zBackground, 1.2, `lamparas[${i}].z`, 0.4)!,
      ...(color(l.color) ? { color: color(l.color) } : {}), ...(num(l.intensidad) !== undefined ? { intensidad: lim(l.intensidad, 20, 160, `lamparas[${i}].intensidad`) } : {}),
    }));
  }
  if (Array.isArray(x.piezas)) {
    if (x.piezas.length > LIMITS.piezas) avisos.push(tr('tool.decor.check.maxPieces', { n: LIMITS.piezas, sobran: x.piezas.length - LIMITS.piezas }));
    const piezas: DecorPiece[] = [];
    const indice = new Map<number, number>();   // índice pedido → índice guardado (las descartadas no cuentan)
    x.piezas.slice(0, LIMITS.piezas).forEach((p: any, i: number) => {
      if (!p || typeof p !== 'object' || !isModelProps(p.modelo)) { avisos.push(tr('tool.decor.check.pieceModel', { i })); return; }
      const r: DecorPiece = { modelo: p.modelo, x: lim(p.x, -LIMITS.x, LIMITS.x, `piezas[${i}].x`, 0)!, z: lim(p.z, LIMITS.zBackground, LIMITS.zFront, `piezas[${i}].z`, 0)! };
      const y = lim(p.y, 0, LIMITS.techo, `piezas[${i}].y`); if (y !== undefined && y > 0) r.y = y;
      const g = giro(p.giro); if (g) r.giro = g;
      const alto = lim(p.alto, 0.03, 4.2, `piezas[${i}].alto`); const ancho = lim(p.ancho, 0.03, 6, `piezas[${i}].ancho`);
      if (alto !== undefined) r.alto = alto; else if (ancho !== undefined) r.ancho = ancho;
      if (p.sobre !== undefined) {
        const s = num(p.sobre);
        if (s !== undefined && indice.has(s)) r.sobre = indice.get(s); else avisos.push(tr('tool.decor.check.pieceOn', { i }));
      }
      if (p.pared === true) r.pared = true;
      if (p.tumbada === true) r.tumbada = true;
      if (color(p.color)) r.color = color(p.color);
      if (color(p.luz)) r.luz = color(p.luz);
      indice.set(i, piezas.length); piezas.push(r);
    });
    if (piezas.length) out.piezas = piezas;
  }
  // un texto que no cabe se corta (y se avisa: cortado a media palabra se lee mal)
  const corto = (v: unknown, n: number, que: string) => {
    const t = texto(v, 400);
    if (t.length > n) avisos.push(tr('tool.decor.check.tooLong', { que, t, n: t.length, max: n, corto: t.slice(0, n) }));
    return t.slice(0, n).trim();
  };
  // signs, on the back wall and wholly inside it
  const inWall = (o: any, que: string, widthMax: number, proporcion: number) => {
    const ancho = lim(o.ancho, 0.3, widthMax, `${que}.ancho`, Math.min(0.7, widthMax))!;
    const alto = ancho * proporcion;
    return { ancho, x: lim(o.x, -LIMITS.x + ancho / 2, LIMITS.x - ancho / 2, `${que}.x`, 0)!, y: lim(o.y, alto / 2 + 0.3, LIMITS.viewWall - alto / 2, `${que}.y`, 2)! };
  };
  if (Array.isArray(x.carteles)) {
    if (x.carteles.length > LIMITS.carteles) avisos.push(tr('tool.decor.check.maxSigns', { n: LIMITS.carteles }));
    const cs = x.carteles.slice(0, LIMITS.carteles).filter((c: any) => c && typeof c === 'object').map((c: any, i: number) => {
      const r: DecorSign = { ...inWall(c, `carteles[${i}]`, 1.6, 720 / 512), titulo: corto(c.titulo, 32, `carteles[${i}].titulo`), lineas: (Array.isArray(c.lineas) ? c.lineas : []).slice(0, 5).map((l: unknown, j: number) => corto(l, 12, `carteles[${i}].lineas[${j}]`)).filter(Boolean) };
      if (color(c.fondo)) r.fondo = color(c.fondo); if (color(c.tinta)) r.tinta = color(c.tinta);
      const s = de(SIGN_SYMBOLS, c.simbolo); if (s) r.simbolo = s;
      const g = num(c.giro); if (g) r.giro = Math.max(-8, Math.min(8, g));
      return r;
    }).filter((c: DecorSign) => c.lineas.length || c.titulo);
    if (cs.length) out.carteles = cs;
  }
  // the decorative typing screens are gone: the room's one screen is its task board (old dressings lose them on load)
  if (Array.isArray(x.pantallas) && x.pantallas.length) avisos.push(tr('tool.decor.check.noScreens'));
  return { decorado: out, avisos };
}

/** Lo que se ve mal aunque sea válido: piezas en el pasillo o fuera de la sala, colgadas en el aire, carteles que se
 *  pisan o que tapan el tablero de tareas (`tablero`: boardSpot de la sala), y piezas en la zona de trabajo o encima del
 *  panel de la sala (`lado`: el de la sala, panelSpot). `tam` da el tamaño (ancho, alto, fondo) de cada modelo en metros a
 *  la escala pedida. */
export function reviewDecor(d: Decorado, tam: (p: DecorPiece) => [number, number, number] | null, tablero?: BoardSpot, lado?: 'izq' | 'der'): string[] {
  const avisos: string[] = [];
  const cajas: { i: number; x0: number; x1: number; z0: number; z1: number; alto: number }[] = [];
  (d.piezas ?? []).forEach((p, i) => {
    const t = tam(p);
    if (!t) { avisos.push(tr('tool.decor.check.notInCatalogue', { i, modelo: p.modelo })); return; }
    const [w, h, f] = t; const a = ((p.giro ?? 0) * Math.PI) / 180;
    const ax = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * f, az = Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * f;
    const x0 = p.x - ax / 2, x1 = p.x + ax / 2, z0 = p.pared ? WALL_Z : p.z - az / 2, z1 = p.pared ? WALL_Z + az : p.z + az / 2;
    if (x0 < -6 || x1 > 6) avisos.push(tr(x0 < -6 ? 'tool.decor.check.outLeft' : 'tool.decor.check.outRight', { i, modelo: p.modelo, x0: x0.toFixed(2), x1: x1.toFixed(2) }));
    if (z0 < WALL_Z - 0.05 && !p.pared) avisos.push(tr('tool.decor.check.intoBackWall', { i, modelo: p.modelo, z: z0.toFixed(2) }));
    if ((p.y ?? 0) + h > 4.43) avisos.push(tr('tool.decor.check.throughCeiling', { i, modelo: p.modelo, y: ((p.y ?? 0) + h).toFixed(2) }));
    if (p.sobre === undefined && !p.y && z1 > LIMITS.pasillo + 0.15 && h > 0.35) avisos.push(tr('tool.decor.check.intoAisle', { i, modelo: p.modelo, z: z1.toFixed(2), pasillo: LIMITS.pasillo }));
    if (p.y && p.y > 0.05 && !p.pared && p.sobre === undefined) avisos.push(tr('tool.decor.check.floats', { i, modelo: p.modelo, y: p.y }));
    if (p.sobre === undefined && !p.y && h > 0.25) cajas.push({ i, x0, x1, z0, z1, alto: h });
    // near the back wall and in front of the board: the game leaves it out (web/src/world/rooms/decor.ts)
    if (tablero && z0 < WALL_Z + BOARD_CLEAR && coversBoard(tablero, p.x, (p.y ?? 0) + h / 2, ax, h)) avisos.push(tr('tool.decor.check.coversBoard', { que: `piezas[${i}] ${p.modelo}` }));
    const estorba = p.sobre === undefined ? inTheWay(x0, x1, z0, z1, p.y ?? 0, lado) : null;
    if (estorba) avisos.push(tr(estorba === 'work' ? 'tool.decor.check.inWorkZone' : 'tool.decor.check.onPanel', { que: `piezas[${i}] ${p.modelo}` }));
  });
  for (let a = 0; a < cajas.length; a++) for (let b = a + 1; b < cajas.length; b++) {
    const A = cajas[a], B = cajas[b];
    const dx = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), dz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
    if (dx > 0.12 && dz > 0.12) avisos.push(tr('tool.decor.check.overlapFloor', { a: A.i, ma: d.piezas![A.i].modelo, b: B.i, mb: d.piezas![B.i].modelo, dx: dx.toFixed(2), dz: dz.toFixed(2) }));
  }
  const inWall = (d.carteles ?? []).map((c, i) => ({ que: `carteles[${i}]`, x: c.x, y: c.y, w: c.ancho, h: c.ancho * 720 / 512 }));
  if (tablero) for (const c of inWall) if (coversBoard(tablero, c.x, c.y, c.w, c.h)) avisos.push(tr('tool.decor.check.coversBoard', { que: c.que }));
  for (let a = 0; a < inWall.length; a++) for (let b = a + 1; b < inWall.length; b++) {
    const A = inWall[a], B = inWall[b];
    if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 - 0.05 && Math.abs(A.y - B.y) < (A.h + B.h) / 2 - 0.05) avisos.push(tr('tool.decor.check.overlapWall', { a: A.que, b: B.que }));
  }
  if (d.base === 'vacia' && !(d.piezas ?? []).length) avisos.push(tr('tool.decor.check.emptyRoom'));
  return avisos;
}

/** Firma corta (para volver a montar la sala cuando cambia) */
export function decorSignature(d: Decorado | null | undefined) {
  if (!d) return '';
  let h = 2166136261; for (const c of JSON.stringify(d)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Plantilla de serie de una sala de recluta según el tipo de su repo (InfoRepo.tipo, server/repos.ts → tipoProyecto) */
export function templateOf(tipo: string | undefined, isGit?: boolean): 'fundicion' | 'laboratorio' | 'estudio' | 'archivo' | 'taller' {
  const t = (tipo ?? '').toLowerCase();
  if (t === 'rust' || t === 'go') return 'fundicion';
  if (t === 'python') return 'laboratorio';
  if (t.startsWith('web') || t === 'node' || t === 'escritorio') return 'estudio';
  if (t === 'carpeta' || isGit === false) return 'archivo';
  return 'taller';
}
/** La escena que lleva una sala de repo sin decorado: la de su estilo o, si no tiene uno propio, la de su tipo de repo */
export function baseStock(s: { tipo: string; estilo?: string }, repo?: { tipo?: string; isGit?: boolean }): BaseDecor {
  if (s.tipo === 'coordinacion') return 'archivo';
  const styleBy: Record<string, BaseDecor> = { landing: 'escaparate', marca: 'marca', video: 'proyeccion', tallerWeb: 'tallerWeb', estudio: 'estudio', laboratorio: 'laboratorio', fundicion: 'fundicion', archivo: 'archivo', taller: 'taller' };
  return styleBy[s.estilo ?? ''] ?? templateOf(repo?.tipo, repo?.isGit);
}
