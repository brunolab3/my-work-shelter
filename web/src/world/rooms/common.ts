// Construcción de salas del refugio a partir del material fijado (Quaternius + KayKit).
// Una sala es una caja excavada en la roca y vista en corte frontal. Coordenadas locales:
// x ∈ [-ancho/2, ancho/2], suelo en y=0, pared trasera en z=-FONDO/2, borde frontal en z=+FONDO/2.
import * as THREE from 'three';
import { live } from '../../net/client';
import { place, R, type Placement } from '../../engine/assets';
import { VARIANTS, type Variant } from '../../engine/palette';
import { sectorOf, roomTone } from '@shared/sectors';
import { t, tIs } from '@shared/language';
import { DESK, type BoardSpot } from '@shared/decor';
import { dangerStrip, roomCaption, sign, PhosphorScreen, canvas, textureOf, dirty, Clock, Gauge, corkboard, PanelRoom, strataTexture, SOURCES, sharpCaption } from '../../engine/textures';
import { overlayScreen, screenFrontal, mergeStatic, random } from '../util3d';
import { Dust, Steam, Sparks, Bubbles } from '../effects';
export { Bubbles };

export const MODULE = 4;          // ancho de un panel de pared Quaternius
export const HEIGHT = 4.43;         // alto libre de sala
export const BACKGROUND = 4.6;         // fondo de sala
export const SLAB = 0.85;         // forjado entre plantas (suelo + techo + estructura)
export const FLOOR = HEIGHT + SLAB;
export const SCALE_KAYKIT = 0.8; // mobiliario KayKit a la escala de los personajes (1.85 de alto)
export const CHARACTER_HEIGHT = 1.85;
export const FRAME = 0.45;        // pilares del corte

export type RoomType = 'repo' | 'coordination' | 'comms' | 'calendar' | 'logistics' | 'git' | 'bridge' | 'vault' | 'gate' | 'hydroponics' | 'gallery' | 'disco' | 'bodyshop' | 'review';
export type RoomState = 'no-session' | 'idle' | 'working' | 'waiting' | 'alert' | 'error' | 'finished';

export interface RoomPoint {
  id: string;
  // 'puesto': el sitio de trabajo propio del habitante (su mesa, con silla, teclado y pantalla): ahí pasa la mayor parte del
  //   día y ahí trabaja con las sesiones; `pos` es el asiento y `giro` mira a la mesa. `mesa`: altura del tablero (m).
  // 'pieza': junto a la pieza característica de la sala (la que está en el centro): el habitante va a ella a menudo y hace
  //   alguna de sus `acciones` (clip de KayKit y, si se quiere, lo que pasa en la sala al hacerlo: chispas, una pantalla…)
  // 'patrulla': parada de la ronda de un guardia (la Puerta Principal y la Cámara acorazada no tienen mesa: sus habitantes
  //   vigilan); en el suelo libre, con `giro` hacia lo que se vigila en esa parada. Van en el orden de la ronda.
  type: 'console' | 'chair' | 'cama' | 'bench' | 'estante' | 'look' | 'chat' | 'gate' | 'hobby' | 'workstation' | 'piece' | 'patrol';
  desk?: number;
  ofFoot?: boolean;                    // puesto de pie (banco de trabajo, mesa de mezclas): sin silla
  actions?: { clip: string; dur?: number; utensil?: string; onMake?: () => void }[];
  utensil?: string;                 // lo que coge al usar el punto (aficiones)
  gesture?: { clip: string; every: number; onMake?: () => void };   // gesto periódico mientras está en el punto
  pos: THREE.Vector3;   // local
  rotation: number;         // hacia dónde mira el habitante al usarlo
  clip?: string;
  busy?: string | null;
}

export interface Room {
  id: string;
  type: RoomType;
  group: THREE.Group;
  width: number;
  variant: Variant;
  points: RoomPoint[];
  obstacles: THREE.Box2[];
  screens: PhosphorScreen[];
  lights: { light: THREE.Light; base: number; flicker?: number }[];
  activity: number;                 // 0..1 (crece con llamadas a herramientas)
  state: RoomState;
  progreso: number;                  // 0..1 barra del panel de la sala
  update(dt: number, t: number): void;
  setState(e: RoomState, text?: string): void;
  writeScreen(who: 'desk' | 'panel', lines: string | string[]): void;
  setIcon(type: 'ready' | 'wait' | 'error' | null): void;
  effects?: { dust: Dust; vapor: Steam; sparks: Sparks };
  userData: Record<string, any>;
  walkZones?: [number, number][];  // tramos de x por los que se puede deambular
  anchors: LightAnchor[];                // lámparas y piezas que emiten luz (las enciende el reparto global)
  floor: number; side: 'left' | 'right'; orden: number;
  name: string; path?: string; area?: string;   // area: la de un repo (shared/sectors.ts)
  interactive?: Interactive[];      // aparatos que el Supervisor usa con E (abren un panel)
}

// Lo que una sala puede mirar del resto del mundo (lo conecta el refugio al arrancar): la maqueta del Puente de Mando
// pinta todas las salas y al Supervisor, y la torreta de la cámara acorazada le sigue con la mirada
// También lo leen el audio del mundo (quién habla o teclea y dónde) y quien necesite la cámara.
// habitantes: los Habitante (dweller.ts) sin importar el tipo (evita el ciclo): id.id, id.voz, pos, estado, sala,
// p.aspecto?.especie y `quehacer` (lo que hace ahora: 'teclear', 'leer', 'pieza', 'pasear', 'charlar'…)
export const world: { rooms: () => Room[]; supervisor: () => THREE.Object3D | null; currentRoom: () => Room | null; dwellers: () => any[]; camera: () => THREE.PerspectiveCamera | null } = { rooms: () => [], supervisor: () => null, currentRoom: () => null, dwellers: () => [], camera: () => null };

// x, z: donde se pone el Supervisor para usarlo; zonas: lo que se ve del aparato (cajas en coordenadas de la sala, las
// mide la escena con ctx.aparato): pasar el ratón por encima lo rotula y un clic lo usa
// giro: where the Overseer faces to use it (default: the back wall); gesto: the clip they play using it
// (`sala.userData.onUse[id]`, if the room sets it, reacts in the scene)
export interface Interactive { id: string; x: number; z: number; text: string; panel: string; view?: string; rotation?: number; gesture?: string; zones?: THREE.Box3[] }
// una pieza de la sala con `userData.interactivo = <id>` (p. ej. una pantalla en la pared) abre ese aparato con un clic
// (y `userData.vista`, la vista con la que se abre)

export interface LightAnchor {
  type: 'spot' | 'point';
  pos: THREE.Vector3; goal?: THREE.Vector3;
  intensity: number; color: THREE.Color; shadow?: boolean;
  angle?: number; penumbra?: number; distance?: number;
  puddle?: THREE.Object3D;
  priority?: number;
  level?: number;   // multiplica la intensidad (lámparas de techo según el estado de la sala; sin él, 1)
}

export const COLOR_STATE: Record<RoomState, string> = { 'no-session': '#3a3a3a', idle: '#6fe08f', working: '#5dff8a', waiting: '#ffb000', alert: '#ff7a1a', error: '#ff2a1a', finished: '#5dff8a' };
export const STATE_TEXT: Record<RoomState, string> = { 'no-session': t('world.screen.off'), idle: t('world.screen.idle'), working: t('world.screen.working'), waiting: t('world.screen.waiting'), alert: t('world.screen.attention'), error: t('world.screen.fault'), finished: t('world.screen.done') };

// ---------------------------------------------------------------- materiales de carcasa
const matCache: Record<string, THREE.Material> = {};
export function mat<T extends THREE.Material>(key: string, f: () => T): T { return (matCache[key] ??= f()) as T; }

export function materialRock(tone = 0) {
  return mat('rock' + tone, () => new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2520').offsetHSL(0, 0, tone * 0.02), roughness: 0.95, metalness: 0, flatShading: true }));
}
export function materialSoil() {
  return mat('earth', () => { const t = strataTexture(); t.wrapT = THREE.ClampToEdgeWrapping; return new THREE.MeshStandardMaterial({ map: t, color: '#ffffff', roughness: 1, metalness: 0 }); });
}
export function materialSteel(tone = '#3b3936') { return mat('steel' + tone, () => new THREE.MeshStandardMaterial({ color: tone, roughness: 0.55, metalness: 0.35 })); }
export function materialConcrete() { return mat('concrete', () => new THREE.MeshStandardMaterial({ color: '#4a4641', roughness: 0.92, metalness: 0.02 })); }

export function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = false) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; return b;
}

export function frame(g: THREE.Group, width: number) {
  const zF = BACKGROUND / 2;
  const steel = materialSteel('#2b2a27');
  g.add(box(width + FRAME * 2, SLAB * 0.62, 0.7, steel, 0, HEIGHT + SLAB * 0.31, zF - 0.1));
  const strip = mat('stripe', () => { const t = dangerStrip(); t.repeat.set(10, 1); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.1 }); });
  const edge = box(width + FRAME * 2, 0.16, 0.42, strip, 0, -0.08, zF + 0.05);
  edge.material = [steel, steel, strip, steel, strip, steel] as any;
  g.add(edge);
  g.add(box(width + FRAME * 2, SLAB * 0.38, 0.7, steel, 0, -0.16 - SLAB * 0.19, zF - 0.1));
  for (const s of [-1, 1]) g.add(box(FRAME, HEIGHT + 0.2, 0.7, steel, s * (width / 2 + FRAME / 2), HEIGHT / 2, zF - 0.1));
  const h = materialConcrete();
  g.add(box(width + 0.4, HEIGHT + 0.4, 0.3, h, 0, HEIGHT / 2, -BACKGROUND / 2 - 0.35));
  g.add(box(width + 0.4, 0.3, BACKGROUND + 0.4, h, 0, HEIGHT + 0.15, 0));
  g.add(box(width + 0.4, 0.3, BACKGROUND + 0.4, h, 0, -0.15, 0));
}

// Roca alrededor de los huecos: masa casi negra con estratos y piedras en relieve (sin peñascos sueltos)
export async function rockFace(parent: THREE.Group, x0: number, x1: number, y0: number, y1: number, z: number, seed: number, density = 1, gaps: THREE.Box2[] = []) {
  const r = random(seed);
  const shape = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)]);
  for (const b of gaps) shape.holes.push(new THREE.Path([new THREE.Vector2(b.min.x, b.min.y), new THREE.Vector2(b.min.x, b.max.y), new THREE.Vector2(b.max.x, b.max.y), new THREE.Vector2(b.max.x, b.min.y)]));
  const geo = new THREE.ShapeGeometry(shape);
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 16, (uv.getY(i) - y0) / (y1 - y0) * 0.999);
  const background = new THREE.Mesh(geo, materialSoil());
  background.position.z = z; background.receiveShadow = true;
  parent.add(background);
  // sombra de contacto alrededor de cada hueco: la roca se oscurece hacia el refugio y la sala brilla por contraste
  for (const b of gaps) {
    const m = 1.6; const w = b.max.x - b.min.x, h = b.max.y - b.min.y;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(w + m * 2, h + m * 2), matHalo(w, h, m));
    halo.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, z + 0.01); halo.renderOrder = 1;
    parent.add(halo);
    const brightness = new THREE.Mesh(new THREE.PlaneGeometry(w + 7, h + 7), matGleam(w, h, 3.5));
    brightness.position.set(halo.position.x, halo.position.y, z + 0.02); brightness.renderOrder = 2;
    parent.add(brightness);
  }
  // piedras en relieve: medio hundidas y aplastadas contra la cara, con la misma luz
  const types = ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_5', 'Rock_6', 'Rock_7'];
  const n = 0 * Math.round((x1 - x0) * (y1 - y0) / 30 * density); // sin peñascos: la cara de corte es lisa, con estratos
  const p = new THREE.Vector2();
  const ps: Promise<unknown>[] = [];
  for (let i = 0; i < n; i++) {
    p.set(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0));
    const size = 0.8 + Math.pow(r(), 2) * 2.4;
    if (gaps.some(b => b.clone().expandByScalar(size * 0.7 + 0.3).containsPoint(p))) continue;
    ps.push(place(parent, R.rock(types[Math.floor(r() * types.length)]), { pos: [p.x, p.y, z - size * 0.12], height: size, anchor: 'center', rot: r() * 6.28, rotX: Math.PI / 2 * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 0.4, shadow: false }).then(o => {
      o.scale.z *= 0.55; o.position.z -= size * 0.15; // medio hundida en la cara
      const tone = Math.round(r() * 4) - 2;
      o.traverse((m: any) => { if (m.isMesh) m.material = materialRock(tone); });
    }));
  }
  await Promise.all(ps);
}

// Resplandor cálido que la sala derrama sobre la roca de alrededor (aditivo)
export function matGleam(w: number, h: number, m: number) {
  const { c, g } = canvas(256, 256);
  const fx = m / (w + m * 2) * 256, fy = m / (h + m * 2) * 256;
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = Math.max(0, fx - x, x - (256 - fx)) / fx, dy = Math.max(0, fy - y, y - (256 - fy)) / fy;
    const d = Math.hypot(dx, dy); const inside = dx === 0 && dy === 0;
    const a = inside ? 0 : Math.max(0, 1 - d) ** 2.4;
    const i = (y * 256 + x) * 4; img.data[i] = 255; img.data[i + 1] = 170; img.data[i + 2] = 90; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.MeshBasicMaterial({ map: textureOf(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.085 });
}

export function matHalo(w: number, h: number, m: number) {
  const { c, g } = canvas(256, 256);
  const fx = m / (w + m * 2) * 256, fy = m / (h + m * 2) * 256;
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = Math.max(0, fx - x, x - (256 - fx)) / fx, dy = Math.max(0, fy - y, y - (256 - fy)) / fy;
    const d = Math.min(1, Math.hypot(dx, dy));
    const a = d <= 0 ? 0 : Math.pow(1 - d, 1.6) * 0.5;
    const i = (y * 256 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.MeshBasicMaterial({ map: textureOf(c), transparent: true, depthWrite: false });
}

// ---------------------------------------------------------------- piezas comunes
export async function walls(g: THREE.Group, width: number, v: Variant, panels: string[], steps: { left: boolean; right: boolean } = { left: false, right: false }) {
  const n = Math.round(width / MODULE);
  const ps: Promise<unknown>[] = [];
  for (let i = 0; i < n; i++) ps.push(place(g, R.sf(panels[i % panels.length]), { pos: [-width / 2 + MODULE * (i + 0.5), 0, -BACKGROUND / 2], anchor: 'back', variant: v, shadow: false, height: HEIGHT }).then(o => { o.userData.wall = true; }));
  // laterales lisos; si hay paso hacia la sala vecina o el ascensor, el tramo delantero queda abierto (se cruza por delante)
  const vl: Variant = { ...v, id: v.id + '-lat' };
  for (const s of [-1, 1]) {
    const open = s < 0 ? steps.left : steps.right;
    const length = open ? BACKGROUND / 2 + 0.3 : BACKGROUND + 0.2;
    ps.push(place(g, R.sf('Wall_Empty'), { pos: [s * (width / 2 + 0.02), 0, -BACKGROUND / 2 + 0.25], rot: -s * Math.PI / 2, anchor: 'back', variant: vl, shadow: false, height: HEIGHT }).then(o => { o.scale.x = length / MODULE; o.position.z += (length - MODULE) / 2 * 0 + (length - MODULE) / 2; o.scale.z = 0.35; }));
    ps.push(place(g, R.sf('Column_Slim'), { pos: [s * (width / 2 - 0.3), 0, -BACKGROUND / 2 + 0.32], height: HEIGHT, variant: v, shadow: false }));
    if (open) ps.push(place(g, R.sf('Column_1'), { pos: [s * (width / 2 - 0.05), 0, -BACKGROUND / 2 + length + 0.05], height: HEIGHT, variant: v, shadow: false }));
  }
  return Promise.all(ps);
}

export async function floor(g: THREE.Group, width: number, v: Variant, seed: number) {
  const r = random(seed);
  // chapas de ~1,15 m con juntas oscuras bien marcadas; franja de paso delantera de rejilla; línea pintada mate entre ambas
  const vs: Variant = { ...v, id: v.id + '-floor', wall: '#3e4043', darkWall: '#121314', accent: '#7d6a3e', darkAccent: '#1a1814', grime: 0.16 };
  const vr: Variant = { ...v, id: v.id + '-rejilla', wall: '#3a3936', darkWall: '#0f0f0e', accent: '#5b5246', darkAccent: '#151412', grime: 0.15 };
  const L = 1.15, E = L / 2; // escala de la loseta de 2 m
  const nx = Math.ceil(width / L), bodyshopRows = 3;
  const ps: Promise<unknown>[] = [];
  const z0 = -BACKGROUND / 2;
  for (let i = 0; i < nx; i++) {
    const x = -width / 2 + L * (i + 0.5);
    for (let j = 0; j < bodyshopRows; j++) {
      const t = r() < 0.4 ? 'FloorTile_Basic2' : 'FloorTile_Basic';
      ps.push(place(g, R.sf(t), { pos: [x, -0.05, z0 + L * (j + 0.5)], scale: E, variant: vs, shadow: false, rot: Math.floor(r() * 4) * Math.PI / 2 }));
    }
    // franja de paso: rejilla (losetas de rejilla del kit puestas en el suelo)
    // (las losetas de techo tienen el detalle hacia abajo: se voltean para que la rejilla mire arriba)
    ps.push(place(g, R.sf('RoofTile_Vents'), { pos: [x, 0.0, z0 + L * bodyshopRows + (BACKGROUND - L * bodyshopRows) / 2], scale: E, variant: vr, shadow: false, own: true, rotX: Math.PI, anchor: 'ceiling' }).then(o => {
      o.scale.z *= (BACKGROUND - L * bodyshopRows) / L;
      o.traverse((m: any) => { if (m.isMesh) { m.material.color.multiplyScalar(0.42); m.material.roughness = 0.75; m.material.metalness = 0.35; } });
    }));
  }
  // juntas entre chapas: tiras oscuras finas (la loseta del kit no marca la junta a esta distancia)
  const join = mat('junta', () => new THREE.MeshStandardMaterial({ color: '#0b0b0b', roughness: 0.9, metalness: 0.2 }));
  for (let i = 1; i < nx; i++) g.add(box(0.035, 0.012, L * bodyshopRows, join, -width / 2 + L * i, 0.006, z0 + L * bodyshopRows / 2));
  for (let j = 1; j <= bodyshopRows; j++) g.add(box(width, 0.012, 0.035, join, 0, 0.006, z0 + L * j));
  // línea pintada (amarillo gastado, mate) entre la chapa y la rejilla
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.5, 0.13), mat('line', () => { const { c, g: gg } = canvas(1024, 32); gg.fillStyle = '#9c7b2c'; gg.fillRect(0, 0, 1024, 32); dirty(gg, 1024, 32, 0.7, 2); for (let k = 0; k < 40; k++) { gg.clearRect(Math.random() * 1024, Math.random() * 32, 4 + Math.random() * 30, 2 + Math.random() * 6); } return new THREE.MeshStandardMaterial({ map: textureOf(c), roughness: 1, metalness: 0, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }); }));
  line.rotation.x = -Math.PI / 2; line.position.set(0, 0.014, z0 + L * bodyshopRows + 0.1); line.receiveShadow = true; g.add(line);
  // desgaste: la zona de paso, más clara y pulida
  const wear = new THREE.Mesh(new THREE.PlaneGeometry(width - 1.2, 0.9), mat('desgaste', () => { const { c, g: gg } = canvas(512, 64); const gr = gg.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,240,220,0)'); gr.addColorStop(0.5, 'rgba(255,240,220,0.10)'); gr.addColorStop(1, 'rgba(255,240,220,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 512, 64); dirty(gg, 512, 64, 0.2, 5); return new THREE.MeshStandardMaterial({ map: textureOf(c), transparent: true, depthWrite: false, roughness: 0.4, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -1 }); }));
  wear.rotation.x = -Math.PI / 2; wear.position.set(0, 0.01, z0 + L * 2.3); g.add(wear);
  return Promise.all(ps);
}

export function stain(g: THREE.Group, x: number, z: number, size: number, seed: number) {
  const m = mat('mancha' + seed, () => {
    const { c, g: gg } = canvas(128, 128); const r = random(seed);
    for (let i = 0; i < 9; i++) { const gr = gg.createRadialGradient(64 + (r() - 0.5) * 50, 64 + (r() - 0.5) * 50, 0, 64, 64, 20 + r() * 40); gr.addColorStop(0, 'rgba(10,8,5,0.55)'); gr.addColorStop(1, 'rgba(10,8,5,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 128, 128); }
    return new THREE.MeshStandardMaterial({ map: textureOf(c), transparent: true, depthWrite: false, roughness: 0.25, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3 });
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.7), m); p.rotation.x = -Math.PI / 2; p.position.set(x, 0.008, z); p.renderOrder = 1; g.add(p);
}

// Lámpara de techo: foco cálido (~2800 K) con penumbra amplia que deja poza de luz real en el suelo
export function lamp(g: THREE.Group, room: Room, x: number, z: number, opts: { intensity?: number; shadow?: boolean; goal?: [number, number]; color?: string; corta?: boolean } = {}) {
  // la luz real la pone el reparto global (world/lights.ts) a las lámparas cercanas a la cámara; aquí queda el ancla,
  // la lámpara, la bombilla emisiva y una poza falsa en el suelo para cuando no tiene luz asignada
  const color = opts.color ?? '#ffbe73';
  // «corta»: cuelga pegada al techo para no cruzarse por delante de la pantalla o el cartel protagonista
  const low = opts.corta ? 0.42 : 0.95;
  room.anchors.push({ type: 'spot', pos: new THREE.Vector3(x, HEIGHT - low, z), goal: new THREE.Vector3(opts.goal?.[0] ?? x, 0, opts.goal?.[1] ?? z - 0.25), intensity: opts.intensity ?? 100, color: new THREE.Color(color), shadow: !!opts.shadow, angle: 0.72, penumbra: 0.65, distance: 10 });
  const pr = place(g, R.home('Light_Ceiling1'), { pos: [x, HEIGHT, z], height: opts.corta ? 0.45 : 1.0, anchor: 'ceiling', shadow: false });
  const bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5) });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(opts.corta ? 0.07 : 0.1, 12, 8), bulbMat);
  bulb.position.set(x, HEIGHT - low, z); bulb.userData.isStatic = false; g.add(bulb);
  (room.userData.lamps ??= []).push({ anchor: room.anchors[room.anchors.length - 1], bulb: bulbMat, color: new THREE.Color(color) });
  const puddle = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.8), matPoolFalse(color)); puddle.rotation.x = -Math.PI / 2; puddle.position.set(opts.goal?.[0] ?? x, 0.02, opts.goal?.[1] ?? z - 0.25); puddle.renderOrder = 2; puddle.userData.isStatic = false;
  g.add(puddle); room.anchors[room.anchors.length - 1].puddle = puddle;
  return pr;
}
function matPoolFalse(color: string) {
  return mat('fakePool' + color, () => {
    const { c, g } = canvas(128, 128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return new THREE.MeshBasicMaterial({ map: textureOf(c), color: new THREE.Color(color).multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  });
}

export function signInWall(g: THREE.Group, tex: THREE.Texture, x: number, y: number, width: number, height: number, z: number, rotation = 0, emissive = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, emissive: emissive ? new THREE.Color('#ffffff') : new THREE.Color('#000000'), emissiveMap: emissive ? tex : null, emissiveIntensity: emissive }));
  m.position.set(x, y, z); m.rotation.z = rotation; m.receiveShadow = true; g.add(m); return m;
}

// Icono de rama de git (dos nodos en el tronco y uno que se bifurca) de alto `h` centrado en `y`; devuelve su ancho
function branchIcon(x: CanvasRenderingContext2D, x0: number, y: number, h: number) {
  const r = h * 0.16, ax = x0 + r, cx = x0 + h * 0.8, above = y - h * 0.5 + r, below = y + h * 0.5 - r;
  x.lineWidth = h * 0.12; x.lineCap = 'round'; x.strokeStyle = x.fillStyle as string;
  x.beginPath(); x.moveTo(ax, above); x.lineTo(ax, below);
  x.moveTo(cx, above); x.bezierCurveTo(cx, y + h * 0.18, ax, y - h * 0.02, ax, y + h * 0.3); x.stroke();
  for (const [a, b] of [[ax, above], [ax, below], [cx, above]]) { x.beginPath(); x.arc(a, b, r, 0, 7); x.fill(); }
  return h * 0.8 + r;
}

// Placa de la sala en la viga: chapa con desgaste y letras retroiluminadas, más baliza de estado. Si es un repo, la rama
// va detrás del subtítulo con su icono (sin la palabra «rama»)
export function plateYBeacon(g: THREE.Group, room: Room, name: string, sub: string, number: string, v: Variant, branch?: string) {
  const W = 1024, H = 240; const { c, g: x } = canvas(W, H);
  const paint = (brightness: number) => {
    x.clearRect(0, 0, W, H);
    x.fillStyle = '#1b1916'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#4a443b'; x.lineWidth = 8; x.strokeRect(6, 6, W - 12, H - 12);
    // bloque del sector (shared/sectors.ts): arriba su nombre en plantilla sobre chapa oscura, debajo el número de la
    // sala sobre el tono de la sala (el de su sector aunque un decorado cambie el acento de la pintura); el acceso
    // lleva además franjas de peligro
    const sec = sectorOf(room.type, room.id, room.area), nameSec = tIs(sec.name);
    x.fillStyle = roomTone(room)[0]; x.fillRect(16, 16, 150, H - 32);
    x.fillStyle = '#16140f'; x.fillRect(16, 16, 150, 56);
    let tl = 44; x.font = `800 ${tl}px ${SOURCES.title}`; while (x.measureText(nameSec).width > 140 && tl > 18) { tl -= 2; x.font = `800 ${tl}px ${SOURCES.title}`; }
    x.fillStyle = sec.letter; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(nameSec, 91, 46);
    if (sec.id === 'access') {
      x.save(); x.beginPath(); x.rect(16, H - 46, 150, 30); x.clip(); x.fillStyle = '#16140f';
      for (let i = -2; i < 9; i++) { x.beginPath(); x.moveTo(16 + i * 26, H - 16); x.lineTo(29 + i * 26, H - 16); x.lineTo(59 + i * 26, H - 46); x.lineTo(46 + i * 26, H - 46); x.fill(); }
      x.restore();
    }
    // el desgaste va debajo de las letras: encima las salpicaba de motas y, reducida a la placa en pantalla, se leía mal
    dirty(x, W, H, 0.22, name.length + 3);
    x.fillStyle = sec.ink; let tn = 96; x.font = `900 ${tn}px ${SOURCES.title}`; while (x.measureText(number).width > 118 && tn > 50) { tn -= 6; x.font = `900 ${tn}px ${SOURCES.title}`; } x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(number, 91, sec.id === 'access' ? 136 : 150);
    x.textAlign = 'left';
    let size = 124; x.font = `800 ${size}px ${SOURCES.title}`;
    while (x.measureText(name).width > W - 225 && size > 40) { size -= 4; x.font = `800 ${size}px ${SOURCES.title}`; }
    // retroiluminación corta: un halo ancho emborronaba los trazos al reducir la textura
    x.shadowColor = '#ffd9a0'; x.shadowBlur = 4 * brightness; x.fillStyle = `rgba(255,240,212,${0.85 + 0.15 * brightness})`;
    x.fillText(name, 192, H * 0.4);
    x.shadowBlur = 0; let ts = 50; x.font = `700 ${ts}px ${SOURCES.label}`;
    const sep = sub && branch ? ' · ' : '';
    let r = branch ?? '';
    const length = () => x.measureText(sub + sep).width + (branch ? ts * 1.2 + x.measureText(r).width : 0);
    while (length() > W - 225 && ts > 30) { ts -= 2; x.font = `700 ${ts}px ${SOURCES.label}`; }
    while (branch && length() > W - 225 && r.length > 4) r = r.slice(0, -2) + '…';
    x.fillStyle = '#d2c3a0'; x.fillText(sub + sep, 194, H * 0.8);
    if (branch) {
      const xi = 194 + x.measureText(sub + sep).width;
      const ai = branchIcon(x, xi, H * 0.8 - ts * 0.04, ts * 0.92);
      x.fillText(r, xi + ai + ts * 0.25, H * 0.8);
    }
    x.fillStyle = '#5d574d'; for (const [a, b] of [[184, 22], [W - 22, 22], [184, H - 22], [W - 22, H - 22]]) { x.beginPath(); x.arc(a, b, 7, 0, 7); x.fill(); }
  };
  paint(1);
  const tex = textureOf(c); tex.anisotropy = 16;
  const width = 2.3, height = width * H / W;
  const plaque = signInWall(g, tex, -0.4, HEIGHT + SLAB * 0.31, width, height, BACKGROUND / 2 + 0.26, 0, 0.55);
  sharpCaption(plaque.material as THREE.MeshStandardMaterial);
  // baliza: carcasa Light_Square sobre la viga, a la derecha de la placa
  const beacon = new THREE.Group(); beacon.position.set(width / 2 + 0.05, HEIGHT + SLAB * 0.31 - 0.24, BACKGROUND / 2 + 0.3); g.add(beacon);
  place(beacon, R.cy('Light_Square'), { height: 0.46, shadow: false, own: true, isStatic: false }).then(o => {
    o.traverse((n: any) => { if (n.isMesh && n.material.name === 'Light') { room.userData.matBeacon = n.material; n.material.color = new THREE.Color('#000000'); n.material.emissive = new THREE.Color(COLOR_STATE[room.state]); n.material.emissiveIntensity = 2.6; n.material.toneMapped = true; } });
  });
  beacon.userData.isStatic = false;
  // destello de la baliza (sprite aditivo) y haz giratorio (cono emisivo, sin coste de luz dinámica)
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#8dffb0', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  flare.scale.setScalar(0.75); flare.position.set(0, 0.25, 0.15); beacon.add(flare);
  room.userData.beaconLight = { color: flare.material.color, set intensity(v: number) { flare.material.opacity = Math.min(0.6, v / 4); } };
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb000', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.translate(0, -3, 0); beam.geometry.rotateZ(Math.PI / 2); beam.position.set(0, 0.25, 0); beacon.add(beam);
  room.userData.beam = { color: (beam.material as THREE.MeshBasicMaterial).color, set intensity(v: number) { (beam.material as THREE.MeshBasicMaterial).opacity = v > 0 ? 0.07 : 0; beam.visible = v > 0; }, target: { position: { set: (x: number, y: number, z: number) => { beam.rotation.set(0, Math.atan2(-z, x), y * 0.05); } } } };
  // icono flotante sobre la sala (como el recurso listo de los juegos del género): listo / te espera / avería
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('✓', '#5dff8a'), transparent: true, depthTest: false }));
  icon.scale.setScalar(0.62); icon.position.set(room.width / 2 - 1.1, HEIGHT + SLAB * 0.31, BACKGROUND / 2 + 0.7); icon.visible = false; icon.renderOrder = 10; icon.userData.isStatic = false;
  g.add(icon); room.userData.icon = icon;
  return { plaque, tex, paint };
}

let _halo: THREE.Texture | null = null;
export function textureHalo() {
  if (_halo) return _halo;
  const { c, g } = canvas(64, 64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (_halo = textureOf(c));
}

const _icons = new Map<string, THREE.Texture>();
export function iconTexture(sign: string, color: string) {
  const k = sign + color; if (_icons.has(k)) return _icons.get(k)!;
  const { c, g } = canvas(128, 128);
  g.fillStyle = '#1c1a17'; g.beginPath(); g.arc(64, 60, 50, 0, 7); g.fill();
  g.lineWidth = 7; g.strokeStyle = color; g.beginPath(); g.arc(64, 60, 46, 0, 7); g.stroke();
  g.fillStyle = '#1c1a17'; g.beginPath(); g.moveTo(52, 104); g.lineTo(76, 104); g.lineTo(64, 124); g.fill();
  g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 12; g.font = `900 64px ${SOURCES.title}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sign, 64, 64);
  const t = textureOf(c); _icons.set(k, t); return t;
}

// Líquido luminoso dentro del cristal de la cápsula (gradiente vertical, ondas y franjas de nivel)
// (con «de pie», el líquido se monta derecho en ese grupo a partir de la caja real del cristal: para piezas cuyo
// cristal viene girado en el modelo, como la cápsula alta del núcleo del Puente de Mando)
export function mountLiquid(capsula: THREE.Object3D, color: string, ofFoot?: THREE.Object3D) {
  let glass: THREE.Mesh | null = null;
  capsula.traverse((n: any) => { if (n.isMesh && n.material.name === 'Glass') glass = n; });
  const uniforms = { uColor: { value: new THREE.Color(color) }, uTiempo: { value: 0 }, uForce: { value: 0.6 } };
  const liquidMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uColor; uniform float uTiempo; uniform float uForce; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float y = vUv.y;
        float onda = 0.5 + 0.5 * sin(y * 40.0 - uTiempo * 3.0 + sin(vUv.x * 18.0) * 1.5);
        float franjas = smoothstep(0.92, 1.0, fract(y * 6.0));
        float fres = pow(1.0 - abs(dot(vN, vV)), 2.0);
        vec3 base = uColor * (0.35 + 0.65 * (1.0 - y)) * (0.75 + 0.25 * onda);
        vec3 c = base * uForce * 1.2 + uColor * fres * 0.5 + uColor * franjas * 0.3;
        gl_FragColor = vec4(min(c, uColor * 0.62 + 0.03), 1.0);
      }`,
  });
  if (glass && ofFoot) {
    const cr = glass as THREE.Mesh;
    ofFoot.updateMatrixWorld(true);
    const box3 = new THREE.Box3().setFromObject(cr); const a = ofFoot.worldToLocal(box3.min.clone()), b = ofFoot.worldToLocal(box3.max.clone());
    const size = b.clone().sub(a), center = a.clone().add(b).multiplyScalar(0.5);
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(Math.abs(size.x), Math.abs(size.z)) / 2 * 0.86, Math.min(Math.abs(size.x), Math.abs(size.z)) / 2 * 0.86, Math.abs(size.y) * 0.96, 32, 1, true), liquidMat);
    liq.position.copy(center); liq.userData.isStatic = false; ofFoot.add(liq);
    const mc = cr.material as THREE.MeshStandardMaterial;
    mc.transparent = true; mc.opacity = 0.2; mc.color = new THREE.Color('#9fbfb4'); mc.roughness = 0.38; mc.metalness = 0.1; mc.depthWrite = false; mc.emissiveIntensity = 0;
    cr.renderOrder = 3;
  } else if (glass) {
    const cr = glass as THREE.Mesh;
    // liquido: cilindro interior con la caja del cristal
    cr.geometry.computeBoundingBox();
    const bb = cr.geometry.boundingBox!.clone();
    const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
    const radio = Math.min(size.x, size.z) / 2 * 0.86, height = size.y * 0.92;
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, height, 32, 1, true), liquidMat);
    liq.position.copy(center); cr.parent!.add(liq);
    const mc = cr.material as THREE.MeshStandardMaterial;
    mc.transparent = true; mc.opacity = 0.2; mc.color = new THREE.Color('#9fbfb4'); mc.roughness = 0.38; mc.metalness = 0.1; mc.depthWrite = false; mc.emissiveIntensity = 0;
    cr.renderOrder = 3;
  }
  return liquidMat;
}

// Pilotos parpadeantes del armario de servidores
export function mountPilots(g: THREE.Group, origin: THREE.Vector3, color: string) {
  const n = 12; const geo = new THREE.SphereGeometry(0.025, 6, 4);
  const mats = [new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3) }), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(3) }), new THREE.MeshBasicMaterial({ color: '#1a1a1a' })];
  const leds: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geo, mats[2]); m.position.set(origin.x - 0.18 + (i % 4) * 0.12, origin.y + Math.floor(i / 4) * 0.14, origin.z); g.add(m); leds.push(m); }
  const phases = leds.map(() => Math.random() * 10);
  return (t: number, a: number) => { leds.forEach((l, i) => { const on = Math.sin(t * (2 + a * 9) + phases[i] * 3) > 0.2; l.material = on ? (i % 5 === 0 ? mats[1] : mats[0]) : mats[2]; }); };
}

// ================================================================ apoyos: lo que va encima de algo, apoyado de verdad
// Nada de alturas a ojo (`pos: [x, 0.78, z]`): la superficie se mide con un rayo contra las mallas del soporte y la pieza
// se baja o se sube con su caja final (ya girada: una herramienta tumbada con rotZ no queda medio hundida en la mesa).
const _ray = new THREE.Raycaster(), _below = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3(), _n = new THREE.Vector3();

/** Giro para dejar tumbada sobre una mesa una herramienta de KayKit (vienen de pie, con el mango abajo): plana y girada `giro` en planta. */
export const lying = (rotation = 0) => ({ rotX: -Math.PI / 2, rotZ: rotation });

/** Recoloca `pieza` para que el centro de su caja (ya girada) quede en (x, z) del marco de su padre: un giro en X o Z
 *  la desplaza (colocar la centra antes de girarla) */
export function center(piece: THREE.Object3D, x: number, z: number) {
  piece.updateMatrixWorld(true);
  const c = new THREE.Box3().setFromObject(piece).getCenter(new THREE.Vector3());
  const p = piece.parent ? piece.parent.worldToLocal(c) : c;
  piece.position.x += x - p.x; piece.position.z += z - p.z;
  return piece;
}

/** Altura (del mundo) de la primera cara que mira arriba de `soporte` bajo el punto (x, z) del mundo, buscando desde `desde`. */
export function underHeight(support: THREE.Object3D, x: number, z: number, since: number): number | null {
  support.updateMatrixWorld(true);
  _ray.set(_o.set(x, since, z), _below); _ray.far = 50;
  for (const h of _ray.intersectObject(support, true)) {
    const m = h.object as THREE.Mesh;
    if (!m.isMesh || !m.visible || !h.face) continue;
    if (_n.copy(h.face.normal).transformDirection(m.matrixWorld).y < 0.5) continue;   // un canto, no un tablero
    return h.point.y;
  }
  return null;
}

/** Altura de la superficie de `soporte` en (x, z) del marco `marco` (la sala o el grupo del mueble), buscando desde `desde` (en ese marco). */
export function surface(support: THREE.Object3D, frame: THREE.Object3D, x: number, z: number, since = 20) {
  frame.updateMatrixWorld(true);
  const p = frame.localToWorld(new THREE.Vector3(x, since, z));
  const y = underHeight(support, p.x, p.z, p.y);
  return y === null ? null : frame.worldToLocal(new THREE.Vector3(p.x, y, p.z)).y;
}

/**
 * Baja o sube `pieza` (ya colocada, con sus giros) hasta que su cara de abajo toque `soporte`, o el suelo de su padre si no
 * hay soporte. Mira cinco puntos de su huella y se queda con el más alto: nunca se hunde en el tablero. `desde` (en el
 * marco del padre): de dónde baja el rayo, para estantes con varias baldas (por defecto, lo más alto del soporte).
 */
export function lean(piece: THREE.Object3D, support: THREE.Object3D | null, o: { since?: number; clearance?: number } = {}) {
  piece.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(piece);
  const parent = piece.parent;
  let y: number | null = null;
  if (!support) y = parent ? parent.localToWorld(new THREE.Vector3()).y : 0;
  else {
    // por defecto, desde lo más alto del soporte: la cara de arriba de una mesa, aunque la pieza se haya creado en el suelo
    const since = o.since !== undefined && parent ? parent.localToWorld(new THREE.Vector3(0, o.since, 0)).y : new THREE.Box3().setFromObject(support).max.y + 0.05;
    const c = box.getCenter(new THREE.Vector3()), dx = (box.max.x - box.min.x) * 0.3, dz = (box.max.z - box.min.z) * 0.3;
    for (const [a, b] of [[0, 0], [-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]]) {
      const h = underHeight(support, c.x + a, c.z + b, since);
      if (h !== null && (y === null || h > y)) y = h;
    }
  }
  if (y === null) { console.warn('apoyar: nada debajo de ' + piece.name); return piece; }
  piece.position.y += y + (o.clearance ?? 0.003) - box.min.y;
  return piece;
}

// Revisión de QA (con ?revisar en la URL, antes de fusionar): cada pieza colocada que ni está en el suelo ni cuelga del techo
// debe tocar algo debajo. Lista lo que flota (hueco bajo la pieza) y lo que se hunde (la superficie de debajo la atraviesa).
function reviewSupports(g: THREE.Group) {
  g.updateMatrixWorld(true);
  const pieces: THREE.Object3D[] = [];
  g.traverse(o => { if (o === g || !o.userData.size) return; for (let q = o.parent; q && q !== g; q = q.parent) if (q.userData.size) return; pieces.push(o); });
  const meshes: THREE.Mesh[] = [];
  g.traverse((n: any) => { if (n.isMesh && n.visible && !(n.material?.blending === THREE.AdditiveBlending)) meshes.push(n); });
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const ray = new THREE.Raycaster(); const report: string[] = [];
  for (const p of pieces) {
    const box = new THREE.Box3().setFromObject(p).applyMatrix4(inv);
    const name = `${p.name} (${box.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(2)).join(', ')})`;
    if (box.min.y < 0.03) { if (box.min.y < -0.04) report.push(`HUNDIDA EN EL SUELO ${(-box.min.y).toFixed(2)}: ${name}`); continue; }
    if (box.max.y > HEIGHT - 0.15) continue;   // cuelga del techo
    const own = new Set<THREE.Object3D>(); p.traverse(n => own.add(n));
    const others = meshes.filter(m => !own.has(m));
    const c = box.getCenter(new THREE.Vector3()), dx = (box.max.x - box.min.x) * 0.3, dz = (box.max.z - box.min.z) * 0.3;
    const since = box.min.y + Math.min(0.3, (box.max.y - box.min.y) * 0.5);
    const gaps: number[] = [];
    for (const [a, b] of [[0, 0], [-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]]) {
      const o = new THREE.Vector3(c.x + a, since, c.z + b).applyMatrix4(g.matrixWorld);
      ray.set(o, new THREE.Vector3(0, -1, 0));
      const h = ray.intersectObjects(others, false).find(h => h.face && new THREE.Vector3().copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.5);
      gaps.push(box.min.y - (h ? h.point.clone().applyMatrix4(inv).y : 0));
    }
    const gap = Math.min(...gaps), sunken = Math.max(...gaps.map(x => -x));
    const wall = box.min.z < -BACKGROUND / 2 + 0.55;
    if (gap > 0.03) report.push(`${wall ? 'EN LA PARED' : 'FLOTA'} ${gap.toFixed(2)}: ${name}`);
    else if (sunken > 0.03) report.push(`SE HUNDE ${sunken.toFixed(2)}: ${name}`);
  }
  return report;
}

/**
 * Pega `pieza` (un cartel, un monitor, un panel) a la pared del fondo: mide con rayos hacia atrás la cara de los paneles
 * de la pared en su huella y la arrima hasta tocarla (`separacion` deja aire para un soporte). Sin pared detrás, la deja.
 */
export function aWall(g: THREE.Object3D, piece: THREE.Object3D, separation = 0.005) {
  g.updateMatrixWorld(true);
  const panels: THREE.Object3D[] = []; g.traverse(o => { if (o.userData.wall) panels.push(o); });
  const box = new THREE.Box3().setFromObject(piece);
  let zMax = -Infinity;
  const c = box.getCenter(new THREE.Vector3()), dx = (box.max.x - box.min.x) * 0.35, dy = (box.max.y - box.min.y) * 0.35;
  for (const [a, b] of [[0, 0], [-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy]]) {
    _ray.set(_o.set(c.x + a, c.y + b, box.max.z + 2), new THREE.Vector3(0, 0, -1)); _ray.far = 10;
    const h = _ray.intersectObjects(panels, true)[0];
    if (h) zMax = Math.max(zMax, h.point.z);
  }
  if (!Number.isFinite(zMax)) return piece;
  piece.position.z += zMax + separation - box.min.z;
  return piece;
}

// ================================================================ el puesto de trabajo de un habitante
// Mesa, silla de escritorio, teclado y pantalla (monitor u ordenador), todo apoyado en el tablero medido. El grupo tiene su
// frente en +z: quien se sienta está en (0, 0, +fondo) mirando a -z; `giro` gira el conjunto (0: de espaldas a la cámara;
// ±0,8: de tres cuartos, que se le ven las manos). Deja el punto 'puesto' con la altura del tablero y su obstáculo.
export interface StationOptions {
  x: number; z: number; rotation: number; id?: string;
  desk?: string; deskScale?: number; colorDesk?: string;
  chair?: string | null; chairScale?: number;
  screen?: 'monitor' | 'computer' | 'dual' | null;   // el monitor del pack de muebles o el ordenador del pack sci-fi
  tex?: THREE.Texture; brightness?: number;                    // lo que se ve en el monitor
  keyboard?: boolean;
  onTop?: { path: string; x: number; z: number; c?: Placement }[];   // lo demás del tablero (taza, lámpara, libros…), en el marco del puesto
  ofFoot?: boolean;
}
export interface Station { group: THREE.Group; desk: THREE.Object3D; height: number; background: number; monitor: THREE.Object3D | null; point: RoomPoint; monitors: THREE.Object3D[] }

/** The dweller's desk in a repo room: always in the middle of the work zone, under the task board (DESK in shared/decor.ts) */
export const centralDesk = (ctx: Context, o: Omit<StationOptions, 'x' | 'z' | 'rotation'>) => workStation(ctx, { ...o, x: DESK.x, z: DESK.z, rotation: DESK.rotation });

export async function workStation(ctx: Context, o: StationOptions): Promise<Station> {
  const { g, K } = ctx;
  const group = new THREE.Group(); group.position.set(o.x, 0, o.z); group.rotation.y = o.rotation; group.name = 'workstation'; g.add(group);
  const desk = await place(group, o.desk ?? R.furniture('desk'), { scale: K * (o.deskScale ?? 0.85), variant: ctx.v, own: !!o.colorDesk });
  if (o.colorDesk) desk.traverse((n: any) => { if (n.isMesh) { n.material.color.set(o.colorDesk); n.material.needsUpdate = true; } });
  const t = desk.userData.size as THREE.Vector3;
  const height = surface(desk, group, 0, 0) ?? t.y;
  const background = t.z / 2;
  const deskOver = async (path: string, x: number, z: number, c: Placement = {}, isStatic = true) => {
    const p = await place(group, path, { variant: ctx.v, ...c, pos: [x, height, z], isStatic: c.isStatic ?? isStatic });
    return lean(c.rotX || c.rotZ ? center(p, x, z) : p, desk);
  };
  const monitors: THREE.Object3D[] = [];
  const zScreen = -background * 0.45;
  if (o.screen === 'computer') monitors.push(await deskOver(R.sf('Props_ComputerSmall'), 0, zScreen, { height: 0.72 }, false));
  else if (o.screen === 'dual') for (const s of [-1, 1]) monitors.push(await deskOver(R.furniture('monitor'), s * t.x * 0.2, zScreen, { scale: K * 0.62, rot: -s * 0.18 }, false));
  else if (o.screen !== null) monitors.push(await deskOver(R.furniture('monitor'), 0, zScreen, { scale: K * 0.68 }, false));
  const monitor = monitors[0] ?? null;
  if (monitor && o.tex && o.screen !== 'computer') screenFrontal(monitor, o.tex, { width: 0.84, height: 0.66, cy: 0.6, dz: -0.02 }, o.brightness ?? 1.1);
  else if (monitor && o.tex) overlayScreen(monitor, /^Black$/, o.tex, { brightness: o.brightness ?? 1.2, margin: 0.9 });
  if (o.keyboard !== false) { await deskOver(R.furniture('keyboard'), 0, background * 0.35, { scale: K * 0.8 }); await deskOver(R.furniture('mouse'), t.x * 0.22, background * 0.4, { scale: K * 0.8 }); }
  for (const e of o.onTop ?? []) await deskOver(e.path, e.x, e.z, e.c ?? {});
  // la silla, separada del canto de la mesa lo justo para que las rodillas no atraviesen el tablero
  const zChair = background + 0.36;
  if (!o.ofFoot && o.chair !== null) await place(group, o.chair ?? R.furniture('chair_desk_A'), { pos: [0, 0, zChair], scale: K * (o.chairScale ?? 1), rot: Math.PI, variant: ctx.v });
  // obstáculo: la mesa (la silla queda libre: el habitante llega a ella por delante). Los obstáculos son cajas alineadas
  // con los ejes: con la mesa girada, la de un puesto de pie se recorta para que quien trabaja quepa delante
  group.updateMatrixWorld(true);
  const k = o.ofFoot ? 0.62 : 1;
  const corner = [[-t.x / 2 * k, -background * k], [t.x / 2 * k, -background * k], [-t.x / 2 * k, background * k], [t.x / 2 * k, background * k]].map(([a, b]) => group.localToWorld(new THREE.Vector3(a, 0, b)).sub(g.getWorldPosition(new THREE.Vector3())));
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(...corner.map(p => p.x)), Math.min(...corner.map(p => p.z))), new THREE.Vector2(Math.max(...corner.map(p => p.x)), Math.max(...corner.map(p => p.z)))));
  const seat = group.localToWorld(new THREE.Vector3(0, 0, o.ofFoot ? background + 0.32 : zChair)).sub(g.getWorldPosition(new THREE.Vector3()));
  const point: RoomPoint = { id: o.id ?? 'workstation', type: 'workstation', pos: seat, rotation: o.rotation + Math.PI, desk: +height.toFixed(3), clip: o.ofFoot ? 'Working_A' : 'Sit_Chair_Idle', ...(o.ofFoot ? { ofFoot: true } : {}) };
  ctx.room.points.push(point);
  return { group, desk, height, background, monitor, monitors, point };
}

// ================================================================ montaje común de una sala
export interface RoomOptions {
  id: string; type: RoomType; name: string; subtitle: string; number: string; branch?: string;
  variant: Variant; seed: number; panels?: string[];
  steps?: { left: boolean; right: boolean };
  floor: number; side: 'left' | 'right'; orden: number; path?: string; area?: string;
}

export interface Context {
  g: THREE.Group; room: Room; v: Variant; zB: number; K: number; width: number; seed: number;
  P: (path: string, c?: Parameters<typeof place>[2], parent?: THREE.Object3D) => Promise<THREE.Object3D>;
  // coloca `ruta` en (x, z) de `c.pos` y la apoya sobre `soporte` (o en el suelo, con null): la y de `c.pos` no cuenta
  restsOn: (support: THREE.Object3D | Promise<THREE.Object3D> | null, path: string, c?: Placement, o?: { since?: number; parent?: THREE.Object3D }) => Promise<THREE.Object3D>;
  wait: () => Promise<void>;
  vCopper: Variant; vDark: Variant;
  onUpdate: (f: (dt: number, t: number, a: number) => void) => void;
  onState: (f: (e: RoomState) => void) => void;
  // marca la pieza que se ve de un aparato de la sala (por su id en INTERACTIVOS), para apuntarla con el ratón
  device: (id: string, piece: THREE.Object3D | Promise<THREE.Object3D>) => void;
  panel?: PanelRoom;
  board?: BoardSpot;   // where the room's task board hangs (repo rooms): the scene keeps clear of it
  vapor?: { pos: THREE.Vector3; dir: THREE.Vector3 };
  sparks?: THREE.Vector3;
  lamps?: { x: number; z: number; o?: Parameters<typeof lamp>[4] }[];
}

export type Furnish = (ctx: Context) => Promise<void>;

export async function createRoom(o: RoomOptions, furnish: Furnish): Promise<Room> {
  const v = o.variant; const width = 3 * MODULE;
  const g = new THREE.Group(); g.name = 'sala:' + o.id;
  const room = { id: o.id, type: o.type, group: g, width, variant: v, points: [], obstacles: [], screens: [], lights: [], activity: 0, state: 'idle', progreso: 0, userData: {}, anchors: [], floor: o.floor, side: o.side, orden: o.orden, name: o.name, path: o.path, area: o.area,
    update: () => {}, setState: () => {}, writeScreen: () => {}, setIcon: () => {} } as unknown as Room;
  const zB = -BACKGROUND / 2; const K = SCALE_KAYKIT;
  frame(g, width);
  await Promise.all([walls(g, width, v, o.panels ?? ['Wall_2', 'Wall_1', 'Wall_5'], o.steps), floor(g, width, v, o.seed)]);
  const ps: Promise<unknown>[] = [];
  const updaters: ((dt: number, t: number, a: number) => void)[] = [];
  const onStates: ((e: RoomState) => void)[] = [];
  const devicePieces: [string, THREE.Object3D | Promise<THREE.Object3D>][] = [];
  const ctx: Context = {
    g, room, v, zB, K, width, seed: o.seed,
    P: (path, c = {}, parent = g) => { const p = place(parent, path, { variant: v, ...c }); ps.push(p); return p; },
    restsOn: (support, path, c = {}, o = {}) => {
      // tumbada o inclinada (rotX/rotZ), colocar la desplaza: se vuelve a centrar en el (x, z) pedido antes de apoyarla
      const p = Promise.all([support, place(o.parent ?? g, path, { variant: v, ...c })]).then(([s, pz]) => lean(c.pos && (c.rotX || c.rotZ) ? center(pz, c.pos[0], c.pos[2]) : pz, s, o));
      ps.push(p); return p;
    },
    wait: async () => { await Promise.all(ps); },
    vCopper: { ...v, id: v.id + '-copper', accent: '#b06a35', darkAccent: '#6a3b1c' },
    vDark: { ...v, id: v.id + '-dark', accent: '#3b302a', darkAccent: '#241d18' },
    onUpdate: f => updaters.push(f), onState: f => onStates.push(f),
    device: (id, piece) => { devicePieces.push([id, piece]); },
  };
  // techo común: bandeja de tuberías y cables que caen
  for (let x = -width / 2 + 1.8; x < width / 2 - 1; x += 3.5) ctx.P(R.sf('Pipes'), { pos: [x, HEIGHT - 0.3, zB + 0.62], width: 3.5, shadow: false });
  const rr = random(o.seed + 5);
  for (const x of [-5.2, -2.6, 1.2, 3.4, 5.4]) ctx.P(R.cy(rr() > 0.5 ? 'Cable_Long' : 'Cable_Small'), { pos: [x + (rr() - 0.5) * 0.4, HEIGHT, zB + 0.7 + rr() * 0.3], height: 0.4 + rr() * 0.35, anchor: 'ceiling', shadow: false });   // cortos: nunca cuelgan por delante de una pantalla o un cartel
  await furnish(ctx);
  await Promise.all(ps);
  const plaque = plateYBeacon(g, room, o.name, o.subtitle, o.number, v, o.branch);
  const lps = (ctx.lamps ?? [{ x: -3.6, z: 0.4 }, { x: 0, z: 0.5, o: { shadow: true } }, { x: 3.6, z: 0.4 }]).map(l => lamp(g, room, l.x, l.z, l.o));
  await Promise.all(lps);
  if (typeof location !== 'undefined' && /[?&]revisar\b/.test(location.search)) room.userData.review = reviewSupports(g);
  // las cajas de los aparatos, antes de fusionar lo estático (luego la pieza ya no está suelta)
  g.updateMatrixWorld(true);
  const zones: Record<string, THREE.Box3[]> = {};
  for (const [id, pz] of devicePieces) { const o = await pz; const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) (zones[id] ??= []).push(b.translate(g.position.clone().negate())); }
  room.userData.deviceZones = zones;
  mergeStatic(g);
  // vida común
  const dust = new Dust(new THREE.Box3(new THREE.Vector3(-width / 2 + 0.5, 0.3, -BACKGROUND / 2 + 0.6), new THREE.Vector3(width / 2 - 0.5, HEIGHT - 0.8, BACKGROUND / 2 - 0.3)), 200);
  const vapor = new Steam(ctx.vapor?.pos ?? new THREE.Vector3(-2.4, 3.15, zB + 0.85), 9, ctx.vapor?.dir ?? new THREE.Vector3(0.35, 0.9, 0.25));
  const sparks = new Sparks();
  g.add(dust.points, vapor.group, sparks.group);
  room.effects = { dust, vapor, sparks };
  let sparkNext = 2.4 + rr() * 4, steamNext = 1.2 + rr() * 5;
  const panel = ctx.panel;
  room.setState = (e, text) => {
    room.state = e;
    if (panel) { panel.state = STATE_TEXT[e]; panel.color = e === 'working' || e === 'idle' ? v.screen : COLOR_STATE[e]; if (text) panel.lines.push('> ' + text); }
    const col = new THREE.Color(e === 'no-session' ? '#222' : COLOR_STATE[e]);
    const mb = room.userData.matBeacon as THREE.MeshStandardMaterial | undefined; if (mb) mb.emissive.copy(col);
    room.userData.beaconLight?.color.copy(col); room.userData.beam?.color.copy(col);
    // lámparas de techo: apagadas en reposo, a tope trabajando (sin sesiones, encendidas como siempre)
    room.userData.lightLevel = e === 'idle' ? 0 : e === 'working' ? 1.35 : 1;
    for (const f of onStates) f(e);
    room.setIcon(e === 'finished' ? 'ready' : e === 'waiting' ? 'wait' : e === 'error' ? 'error' : null);
  };
  room.setIcon = (type) => {
    const ic = room.userData.icon as THREE.Sprite;
    const mark = type === 'ready' ? ['✓', '#5dff8a'] : type === 'wait' ? ['?', '#ffb000'] : type === 'error' ? ['!', '#ff2a1a'] : null;
    ic.visible = !!mark;
    if (mark) { (ic.material as THREE.SpriteMaterial).map = iconTexture(mark[0], mark[1]); (ic.material as THREE.SpriteMaterial).needsUpdate = true; }
  };
  room.writeScreen = (who, lines) => { if (who === 'desk' && room.screens[0]) room.screens[0].write(lines); else panel?.lines.push(...([] as string[]).concat(lines)); };
  room.setState('idle');
  room.update = (dt, t) => {
    const a = room.activity;
    for (const p of room.screens) p.update(dt, t);
    if (panel) { panel.progreso = room.state === 'working' ? (room.progreso || (t * 0.04) % 1) : room.state === 'finished' ? 1 : room.progreso; panel.update(t); }
    for (const f of updaters) f(dt, t, a);
    const lamps = room.userData.lamps as { anchor: LightAnchor; bulb: THREE.MeshBasicMaterial; color: THREE.Color }[] | undefined;
    if (lamps) for (const l of lamps) {
      l.anchor.level = THREE.MathUtils.damp(l.anchor.level ?? 1, room.userData.lightLevel ?? 1, 3, dt);
      l.bulb.color.copy(l.color).multiplyScalar(0.15 + 4.85 * l.anchor.level);
    }
    dust.update(dt, t); vapor.update(dt); sparks.update(dt);
    const lb = room.userData.beaconLight; const mb = room.userData.matBeacon as THREE.MeshStandardMaterial | undefined;
    const pulse = room.state === 'waiting' ? (Math.sin(t * Math.PI * 2) > 0 ? 1 : 0.15) : room.state === 'error' ? 0.5 + 0.5 * Math.sin(t * Math.PI) : room.state === 'no-session' ? 0 : 0.6;
    if (lb) lb.intensity = pulse * 2.5; if (mb) mb.emissiveIntensity = 0.3 + pulse * 3;
    const hz = room.userData.beam; const spinning = room.state === 'waiting' || room.state === 'error';
    if (hz) { hz.intensity = spinning ? 60 : 0; if (spinning) { const an = t * Math.PI * 2 * 0.8; hz.target.position.set(Math.cos(an) * 6, -1.5, -BACKGROUND + Math.sin(an) * 2); } }
    const ic = room.userData.icon as THREE.Sprite; if (ic?.visible) ic.position.y = HEIGHT + SLAB * 0.31 + Math.sin(t * 2.4) * 0.06;
    steamNext -= dt; vapor.active = steamNext < 0; if (steamNext < -1.6) steamNext = 8 + Math.random() * 7;
    sparkNext -= dt * (0.4 + a * 2);
    if (sparkNext < 0) { sparkNext = 6 + Math.random() * 9; if (ctx.sparks) { sparks.burst(ctx.sparks, 16); room.userData.onSpark?.(); } }
    if (plaque.plaque.material) (plaque.plaque.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + 0.05 * Math.sin(t * 2.3);
  };
  return room;
}

// Banda alta de la pared: tendido de cobre con válvulas, manómetro y reloj (común a varias salas)
export async function highBand(ctx: Context, o: { timer?: number; gauge?: number; valves?: number[]; segments?: [number, number][] } = {}) {
  const { g, zB } = ctx;
  const segments = o.segments ?? [[-3.9, 4.0], [0.3, 4.4], [4.2, 3.2]];
  for (const [x, l] of segments) ctx.P(R.cy('Pipe_2'), { pos: [x, 3.25, zB + 0.62], width: l, variant: ctx.vCopper, shadow: false });
  // cada válvula va montada en un tramo de tubería (si cae fuera, se lleva al tramo más cercano): nunca un volante suelto
  // en el aire. Brida debajo, abrazando el tubo, para que se lea montada
  const valves: THREE.Object3D[] = [];
  for (const x0 of o.valves ?? [-2.4, 2.9]) {
    const [cx, l] = segments.reduce((a, b) => Math.abs(b[0] - x0) < Math.abs(a[0] - x0) ? b : a);
    const x = THREE.MathUtils.clamp(x0, cx - l / 2 + 0.35, cx + l / 2 - 0.35);
    ctx.P(R.sf('Details_Cylinder'), { pos: [x, 3.31, zB + 0.7], height: 0.16, rotX: Math.PI / 2, anchor: 'center', variant: ctx.vCopper, shadow: false });
    valves.push(await place(g, R.sf('Details_Output'), { pos: [x, 3.08, zB + 0.8], width: 0.42, variant: ctx.vCopper, shadow: false, isStatic: false }));
  }
  let onInput: Gauge | null = null, timer: Clock | null = null;
  if (o.gauge !== undefined) { onInput = new Gauge(); const d = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshStandardMaterial({ map: onInput.tex, roughness: 0.4, metalness: 0.2 })); d.position.set(o.gauge, 3.42, zB + 0.8); g.add(d); }
  if (o.timer !== undefined) { timer = new Clock(); const d = new THREE.Mesh(new THREE.CircleGeometry(0.36, 40), new THREE.MeshStandardMaterial({ map: timer.tex, roughness: 0.5 })); d.position.set(o.timer, 2.55, zB + 0.58); g.add(d); }
  ctx.onUpdate((dt, t, a) => { timer?.update(); onInput?.update(0.25 + a * 0.6 + Math.sin(t * 1.3) * 0.03); for (const vv of valves) vv.rotation.z = Math.sin(t * 0.2) * 0.05; });
}

// Monitor colgado en la pared (frente a cámara) con una textura en pantalla
export async function monitorWall(ctx: Context, x: number, y: number, scale: number, tex: THREE.Texture, brightness = 1.3, rot = 0) {
  const m = await place(ctx.g, R.furniture('monitor'), { pos: [x, y, ctx.zB + 0.62], scale: ctx.K * scale, rot, isStatic: false, variant: ctx.v });
  screenFrontal(m, tex, { width: 0.84, height: 0.66, cy: 0.6, dz: -0.02 }, brightness);
  ctx.P(R.cy('Support_Short'), { pos: [x, y - 0.45 * scale, ctx.zB + 0.45], height: 0.55 * scale, shadow: false });
  return m;
}

// Pantallas de las salas de repo con datos de verdad (nada inventado): el estado del repo, lo que hace ahora
// quien trabaja en la sala o el último commit. Se reescriben solo cuando cambia lo que muestran.
export type ScreenContent = 'repo' | 'activity' | 'commit' | 'changes';
/** Recorta en la última palabra que quepa y añade «…» (nunca corta a media palabra). */
export function truncate(text: string, n: number) {
  const t = (text ?? '').trim(); if (t.length <= n) return t;
  const truncation = t.slice(0, n - 1); const waits = truncation.lastIndexOf(' ');
  return (waits > n * 0.45 ? truncation.slice(0, waits) : truncation).replace(/[\s,.;:·-]+$/, '') + '…';
}
/** Parte en dos líneas por palabras; la segunda termina en «…» si sobra. */
export function linesTwo(text: string, n: number): [string, string] {
  const t = (text ?? '').trim(); if (t.length <= n) return [t, ''];
  let waits = t.slice(0, n + 1).lastIndexOf(' '); if (waits < n * 0.45) waits = n;
  return [t.slice(0, waits).trim(), truncate(t.slice(waits).trim(), n)];
}

export function screenReal(ctx: Context, screen: PhosphorScreen, what: ScreenContent) {
  let signature = ''; let wait = 0;
  ctx.onUpdate(dt => {
    wait -= dt; if (wait > 0) return; wait = 1.5;
    const v = live.get() as any;
    const r = v.repos[ctx.room.id];
    const sess = Object.values(v.sessions).filter((s: any) => s.roomId === ctx.room.id && s.state !== 'closed').sort((a: any, b: any) => b.updated - a.updated)[0] as any;
    const who = sess ? (v.state?.dwellers ?? []).find((h: any) => h.id === sess.dwellerId)?.name ?? t('world.screen.someone') : '';
    const ago = (ms: number) => { const h = Math.round((Date.now() - ms) / 3600_000); return h < 1 ? t('world.screen.aWhileAgo') : h < 48 ? t('windows.nHAgo', { n: h }) : t('windows.nDaysAgo', { n: Math.round(h / 24) }); };
    let lines: string[];
    if (!r) lines = [t('world.screen.readingRepo')];
    else if (!r.exists) lines = [t('panels.folderNotFound')];
    else if (what === 'activity') lines = sess && ['working', 'starting', 'waiting'].includes(sess.state)
      ? [`${who}:`, sess.state === 'waiting' ? t('windows.waitingForYou') : truncate(sess.activity?.text ?? t('windows.thinking'), 30), t('world.screen.nTools', { n: sess.tools ?? 0 }), sess.helpers?.length ? t('windows.nHelpers', { n: sess.helpers.length }) : '']
      : [t('world.screen.idleLower'), sess ? t('world.screen.lastWork', { titulo: truncate(sess.title ?? '', 22) }) : t('world.screen.noWorkInProgress')];
    else if (what === 'commit') lines = r.lastCommit ? [r.lastCommit.hash.slice(0, 7) + ' ' + r.lastCommit.author.slice(0, 14), ...linesTwo(r.lastCommit.message, 30), ago(r.lastCommit.date)] : [t('windows.noCommits')];
    else if (what === 'changes') lines = r.isGit ? [`git status · ${r.branch ?? ''}`, r.changes ? t('world.screen.nFilesChanged', { n: r.changes }) : t('world.screen.cleanTree'), `worktrees: ${Math.max(0, (r.worktrees?.length ?? 1) - 1)}`] : [t('world.screen.noGit')];
    else lines = [r.isGit ? t('world.screen.branchRama', { rama: r.branch }) : t('world.screen.folder'), r.changes ? t('windows.nChanges', { n: r.changes }) : t('panels.clean'), r.type ? tIs(r.type) : ''];
    lines = lines.filter(Boolean);
    const f = lines.join('|'); if (f === signature) return; signature = f;
    screen.lines = []; screen.queue = []; screen.write(lines);
  });
}

// paredes y rejillas de la sala más apagadas (materiales propios de la sala)
export function switchOffWalls(g: THREE.Object3D, kWall: number, kRest: number) {
  const copies = new Map<THREE.Material, THREE.Material>();
  g.traverse((n: any) => {
    if (!n.isMesh || Array.isArray(n.material) || !/^(Accent|Orange|Main|Main2|Red|Grey|Dark)$/.test(n.material.name)) return;
    if (!copies.has(n.material)) { const m = n.material.clone(); m.color.multiplyScalar(/^(Main|Main2)$/.test(n.material.name) ? kWall : kRest); copies.set(n.material, m); }
    n.material = copies.get(n.material)!;
  });
}
