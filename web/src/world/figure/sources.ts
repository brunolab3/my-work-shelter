// Personajes de KayKit como almacén de piezas: se cargan una vez, se despiezan (cabeza humana) y se reparten sus
// franjas en regiones de color (ropa por superficie, piel por la de su cara). Las geometrías de cada pieza se sacan
// aparte, con la región de cada vértice, y se guardan para todas las figuras que la lleven.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { gltf } from '../../engine/assets';
import { SOURCES, REGIONS, type Piece, type Slot, type Region } from '@shared/appearance';
import { dismantleHead, components, centerTri, strips, trisStrips, clothesRegions, tintSame, numTris, HEAD_KINDS, type Atlas, type HeadBreakdown, type HeadKind } from './breakdown';
import { SETTINGS } from './overrides';
import { HEAD_CENTER, measureField, fill, quotient, stretch, type Field } from './headShape';

export interface Source {
  name: string;
  g: GLTF;
  /** mallas por nombre de nodo (un nodo con varias primitivas son varias mallas) */
  nodes: Map<string, THREE.Mesh[]>;
  head: { mesh: THREE.Mesh; d: HeadBreakdown; atlas: Atlas | null } | null;
  skins: Set<number>;
  skin: [number, number, number] | null;
  upClothes: Map<THREE.Mesh, Int8Array>;
  belowClothes: Map<THREE.Mesh, Int8Array>;
}

const loaded = new Map<string, Promise<Source>>();
export function source(name: string): Promise<Source> {
  let p = loaded.get(name);
  if (!p) { p = load(name); loaded.set(name, p); }
  return p;
}

// nombres de malla que KayKit no puso como los demás
const ALIAS: Record<string, Record<string, string>> = {
  '4GTN': { ArmRight: 'Right' },
  '4GTN_Forgotten': { LegLeft: 'Left' },
};
export function meshesOf(f: Source, suffix: string): THREE.Mesh[] {
  const s = ALIAS[f.name]?.[suffix] ?? suffix;
  const exact = f.nodes.get(`${f.name}_${s}`) ?? f.nodes.get(`${f.name.replace('_', '')}_${s}`);
  if (exact) return exact;
  const end = [...f.nodes.entries()].filter(([k]) => k.endsWith('_' + s) && !k.slice(0, -s.length - 1).includes('_' + s));
  return end.length === 1 ? end[0][1] : [];
}
const mapOf = (m: THREE.Mesh) => ((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial).map;

async function load(name: string): Promise<Source> {
  const def = SOURCES[name]; if (!def) throw new Error('No hay personaje ' + name);
  const g = await gltf(def.path);
  g.scene.updateMatrixWorld(true);   // (para llevar las piezas sin piel, que cuelgan de un hueso, al espacio de las demás)
  const nodes = new Map<string, THREE.Mesh[]>();
  g.scene.traverse((n: any) => {
    if (n.isMesh) {
      // una malla con varias primitivas es un grupo con el nombre del nodo y sus mallas dentro
      const key = n.parent && !n.parent.isBone && !/^Rig_/.test(n.parent.name) && n.parent !== g.scene && !n.parent.isMesh && n.parent.type === 'Group' ? n.parent.name : n.name;
      nodes.set(key, [...(nodes.get(key) ?? []), n]);
    }
  });
  const f: Source = { name, g, nodes, head: null, skins: new Set(), skin: null, upClothes: new Map(), belowClothes: new Map() };
  const [header] = meshesOf(f, 'Head');
  if (header) {
    const atlas = strips(mapOf(header));
    const d = dismantleHead({ geo: header.geometry, atlas }, SETTINGS[name]);
    f.head = { mesh: header, d, atlas }; f.skins = d.skins; f.skin = d.skin;
  }
  const assignment = (suffixes: string[], target: Map<THREE.Mesh, Int8Array>) => {
    const ms = suffixes.flatMap(s => meshesOf(f, s)).filter(m => (m as any).isSkinnedMesh);
    if (!ms.length) return;
    const r = clothesRegions(ms.map(m => ({ geo: m.geometry, atlas: strips(mapOf(m)) })), f.skins, f.skin);
    ms.forEach((m, i) => target.set(m, r.meshBy[i]));
  };
  assignment(['Body', 'Chest', 'ArmLeft', 'ArmRight'], f.upClothes);
  assignment(['LegLeft', 'LegRight'], f.belowClothes);
  return f;
}

// ---------------------------------------------------------------- geometría de una pieza
export interface PieceChunk {
  mesh: THREE.Mesh;          // la malla de la que sale (su esqueleto, su material, su hueso si no tiene piel)
  geo: THREE.BufferGeometry;  // con el atributo `region`
}
const R = (r: Region) => REGIONS.indexOf(r);

/** Copia los triángulos elegidos de una malla en una geometría nueva (solo los vértices que usa) con la región de
 *  cada vértice. `inflar` separa la pieza de la cabeza (pelo y barba sobre la piel, el cráneo por debajo). */
export function extract(m: THREE.Mesh, tris: number[] | null, region: (t: number) => number, inflate?: { center: THREE.Vector3; k: number }) {
  const g = m.geometry, n = numTris(g), list = tris ?? Array.from({ length: n }, (_, i) => i);
  const idx = g.index;
  const map = new Map<number, number>(); const orden: number[] = []; const reg: number[] = []; const newer: number[] = [];
  for (const t of list) for (let k = 0; k < 3; k++) {
    const v = idx ? idx.getX(t * 3 + k) : t * 3 + k;
    const r = region(t);
    const key = v * 32 + r;   // el mismo vértice en dos regiones se duplica
    let i = map.get(key); if (i === undefined) { i = orden.length; map.set(key, i); orden.push(v); reg.push(r); }
    newer.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) continue;
    const at = a as THREE.BufferAttribute, sz = at.itemSize;
    const arr = new (at.array.constructor as any)(orden.length * sz);
    orden.forEach((v, i) => { for (let c = 0; c < sz; c++) arr[i * sz + c] = at.getComponent(v, c); });
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz, at.normalized));
  }
  out.setAttribute('region', new THREE.BufferAttribute(new Float32Array(reg), 1));
  out.setIndex(newer);
  if (inflate) { const p = out.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(inflate.center).multiplyScalar(inflate.k).add(inflate.center); p.setXYZ(i, v.x, v.y, v.z); } }
  out.computeBoundingSphere();
  return out;
}

/** Con qué se lleva una pieza: la cara a la que se adapta, el sombrero bajo el que va el pelo y el pelo sobre el que
 *  se asienta el sombrero */
export interface Context { face?: string; hat?: Piece; hair?: Piece }
// lo que va en la cabeza y se adapta a la forma de la cara (cada cabeza de KayKit es un poco distinta)
const ADAPTABLE: Slot[] = ['pelo', 'barba', 'cejas', 'sombrero', 'gafas'];

const donePieces = new Map<string, Promise<PieceChunk[]>>();
/** Los trozos (malla de origen + geometría con regiones) de una pieza del catálogo, adaptados a la cara que la lleva
 *  y, el pelo, metido bajo el sombrero */
export function chunks(p: Piece, ctx: Context = {}): Promise<PieceChunk[]> {
  // (lo sacado de una cabeza, aunque sea para la suya: bajo su pelo la horma es una suposición y el cuero cabelludo
  // de relleno podría asomar por encima)
  const adapt = !!ctx.face && ADAPTABLE.includes(p.slot) && (ctx.face !== p.source || !!p.breakdown);
  const under = p.slot === 'pelo' && !!ctx.hat && !ctx.hat.hairLid ? ctx.hat : undefined;
  const restsOn = p.slot === 'sombrero' && !p.hairLid && !!ctx.face ? ctx.hair : undefined;
  const key = p.id + (adapt ? '@' + ctx.face : '') + (under ? '^' + under.id : '') + (restsOn ? '/' + restsOn.id : '');
  let t = donePieces.get(key);
  if (!t) {
    t = (async () => {
      let ts = await act(p);
      // (lo que va encima, por fuera de la piel: el pelo entero; de sombreros y máscaras, lo que roza la piel, no lo que
      // va escondido dentro de la cabeza, como las tapas de una cinta)
      const layer = p.slot === 'cejas' ? 1.004 : p.slot === 'pelo' || p.slot === 'barba' ? 1.01 : 1.02;
      if (adapt) ts = await adaptA(p.source, ts, ctx.face!, layer, p.slot === 'sombrero' || p.slot === 'gafas' ? 0.85 : 0);
      if (p.slot === 'sombrero' && !p.hairLid && ctx.face) ts = await settle(p.source, ts, ctx.face, restsOn && await chunks(restsOn, { face: ctx.face }));
      if (under) ts = await meterUnder(ts, await chunks(under, { face: ctx.face ?? under.source, hair: p }), under.source, ctx.face ?? p.source);
      return ts;
    })();
    donePieces.set(key, t);
  }
  return t;
}

async function act(p: Piece): Promise<PieceChunk[]> {
  const f = await source(p.source);
  if (p.breakdown) {
    if (!f.head) return [];
    const { mesh, d, atlas } = f.head;
    const kinds: HeadKind[] = p.slot === 'cara' ? ['cara', 'eyes'] : p.slot === 'sombrero' ? ['cap'] : [p.slot as HeadKind];
    const ks = kinds.map(c => HEAD_KINDS.indexOf(c));
    const tris: number[] = []; for (let t = 0; t < d.kind.length; t++) if (ks.includes(d.kind[t])) tris.push(t);
    if (!tris.length) return [];
    const isSkin = (t: number) => d.skins.has(d.strip[t]);
    const isHair = (t: number) => !!d.hair && !!atlas && d.strip[t] >= 0 && d.hairTints.some(c => tintSame(atlas.color[d.strip[t]], c));
    let region: (t: number) => number;
    if (p.slot === 'cara') region = t => (d.kind[t] === 0 && d.faceSkins.has(d.strip[t]) ? R('piel') : 0);
    else if (p.slot === 'sombrero') {
      const r = clothesRegions([{ geo: subGeo(mesh.geometry, tris), atlas }], f.skins, f.skin).meshBy[0];
      const pos = new Map(tris.map((t, i) => [t, i]));
      region = t => { const x = r[pos.get(t)!]; return x === -1 ? R('piel') : x === 1 ? R('sombrero1') : x === 2 ? R('sombrero2') : 0; };
    } else region = t => (isHair(t) ? R('pelo') : isSkin(t) ? R('piel') : 0);
    // pelo, barba y gorro, un pelo por fuera de cualquier cara (vienen pintados sobre su propio cráneo)
    const inflate = p.slot === 'cara' ? undefined : { center: HEAD_CENTER, k: p.slot === 'cejas' ? 1.0 : 1.014 };
    return [{ mesh, geo: extract(mesh, tris, region, inflate) }];
  }
  const out: PieceChunk[] = [];
  const own = (p.meshes ?? []).flatMap(s => meshesOf(f, s));
  // regiones de color de la propia pieza (sombreros, mochilas, capas)
  const ownReg = p.slot === 'sombrero' || p.slot === 'espalda' || p.slot === 'complemento' || p.slot === 'cabeza'
    ? clothesRegions(own.map(m => ({ geo: m.geometry, atlas: strips(mapOf(m)) })), p.especie === 'robot' ? new Set() : f.skins, p.especie === 'robot' ? null : f.skin).meshBy : null;
  const [r1, r2] = p.slot === 'sombrero' ? [R('sombrero1'), R('sombrero2')] : p.slot === 'cabeza' ? [R('cabeza1'), R('cabeza2')] : [R('espalda1'), R('espalda2')];
  own.forEach((m, i) => {
    let region: (t: number) => number = () => 0;
    const above = f.upClothes.get(m), below = f.belowClothes.get(m);
    if (p.slot === 'gafas') region = () => 0;
    else if (above) region = t => (above[t] === -1 ? R('piel') : above[t] > 0 ? R('torso1') + above[t] - 1 : 0);
    else if (below) region = t => (below[t] === -1 ? R('piel') : below[t] > 0 ? R('piernas1') + below[t] - 1 : 0);
    else if (ownReg) { const r = ownReg[i]; region = t => (r[t] === -1 ? R('piel') : r[t] === 1 ? r1 : r[t] === 2 ? r2 : 0); }
    // el brillo de los robots (ojos, pantallas) va en su propio material: se pinta con el color de las luces
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (/glow/i.test(mat.name)) region = () => R('luz');
    out.push({ mesh: m, geo: extract(m, null, region) });
  });
  return out;
}

function subGeo(g: THREE.BufferGeometry, tris: number[]) {
  const s = new THREE.BufferGeometry(); for (const [k, a] of Object.entries(g.attributes)) s.setAttribute(k, a);
  const idx: number[] = []; for (const t of tris) for (let k = 0; k < 3; k++) idx.push(g.index ? g.index.getX(t * 3 + k) : t * 3 + k);
  s.setIndex(idx); return s;
}

// ---------------------------------------------------------------- hormas: la forma de cada cabeza
/** De la malla al espacio de las cabezas (el de las mallas con piel del personaje): las piezas sin piel cuelgan de un
 *  hueso y sus vértices van en el espacio de ese hueso */
function aHead(f: Source, m: THREE.Mesh) {
  if ((m as any).isSkinnedMesh) return null;
  const ref = [...f.nodes.values()].flat().find(x => (x as any).isSkinnedMesh);
  return ref ? new THREE.Matrix4().copy(ref.matrixWorld).invert().multiply(m.matrixWorld) : m.matrixWorld.clone();
}
/** Los vértices y triángulos de unos trozos en el espacio de las cabezas, juntos (para medir campos) */
function soup(list: { geo: THREE.BufferGeometry; tris?: number[]; M?: THREE.Matrix4 | null }[]) {
  const pos: number[] = [], idx: number[] = []; const v = new THREE.Vector3();
  for (const { geo, tris, M } of list) {
    const P = geo.attributes.position, base = pos.length / 3;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); if (M) v.applyMatrix4(M); pos.push(v.x, v.y, v.z); }
    const n = numTris(geo), ts = tris ?? Array.from({ length: n }, (_, i) => i);
    for (const t of ts) for (let k = 0; k < 3; k++) idx.push(base + (geo.index ? geo.index.getX(t * 3 + k) : t * 3 + k));
  }
  return { pos, idx };
}

/** El cráneo genérico: el del bárbaro sin su barba y, por delante, la cara lisa del pícaro. Es la referencia de las
 *  hormas (lo que se supone bajo el pelo de cada cabeza sigue su forma) y la cabeza lisa del maniquí. */
let generic: Promise<{ pieces: { mesh: THREE.Mesh; tris: number[]; k: number }[]; field: Field }> | null = null;
function genericSkull() {
  return generic ??= (async () => {
    const pieces: { mesh: THREE.Mesh; tris: number[]; k: number }[] = [];
    const b = await source('Barbarian'), r = await source('Rogue');
    if (b.head) { const { mesh, d } = b.head; pieces.push({ mesh, k: 0.99, tris: components(mesh.geometry)[0].tris.filter(t => d.kind[t] === 0 && d.skins.has(d.strip[t])) }); }
    if (r.head) { const { mesh, d } = r.head; const c = components(mesh.geometry).find(x => Math.abs(x.center.x) < 0.02 && x.tris.length > 150 && x.tris.every(t => d.skins.has(d.strip[t]))); if (c) pieces.push({ mesh, k: 0.985, tris: c.tris }); }
    const { pos, idx } = soup(pieces.map(p => ({ geo: p.mesh.geometry, tris: p.tris })));
    return { pieces, field: fill(measureField(pos, idx, 'max')) };
  })();
}

const molds = new Map<string, Promise<Field | null>>();
/** La horma de una cabeza: lo que su piel está más lejos o más cerca del centro que el cráneo genérico, en cada
 *  dirección (medido donde la cara es piel; bajo el pelo y la barba, lo más liso que casa con lo medido) */
export function mold(name: string): Promise<Field | null> {
  let h = molds.get(name);
  if (!h) {
    h = (async () => {
      const f = await source(name); if (!f.head) return null;
      const { mesh, d } = f.head, g = await genericSkull();
      // la superficie de la cabeza: lo que queda en la cara de sus piezas grandes y centradas (las orejas, la nariz y
      // los cuernos sobresalen)
      const tris = components(mesh.geometry).filter(c => c.tris.length >= 120 && Math.abs(c.center.x) < 0.1).flatMap(c => c.tris.filter(t => d.kind[t] === 0));
      const { pos, idx } = soup([{ geo: mesh.geometry, tris }]);
      return fill(quotient(measureField(pos, idx, 'min'), g.field, 0.6, 1.6));
    })();
    molds.set(name, h);
  }
  return h;
}

/** Lleva unos trozos hechos para la cabeza de `de` a la de `a`: cada punto, por su dirección desde el centro de la
 *  cabeza, lo que la piel de una está más lejos que la de la otra. Con `piso`, nada queda por debajo de la piel nueva
 *  (por encima de ella, por ese factor) salvo lo que ya iba más hondo que `desde` (por esa fracción de la piel). */
async function adaptA(from: string, ts: PieceChunk[], a: string, layer = 0, since = 0): Promise<PieceChunk[]> {
  const [hd, ha, f, g] = await Promise.all([mold(from), mold(a), source(from), genericSkull()]);
  if (!hd || !ha) return ts;
  return ts.map(t => {
    const geo = t.geo.clone(), M = aHead(f, t.mesh);
    if (M) geo.applyMatrix4(M);
    stretch(geo, (x, y, z) => {
      const k = ha.sample(x, y, z) / hd.sample(x, y, z);
      if (!layer || y < -0.12 * Math.hypot(x, y, z)) return k;   // (por debajo de la barbilla la horma no es piel: el cuello)
      const r = Math.hypot(x, y, z) || 1, skin = ha.sample(x, y, z) * g.field.sample(x, y, z);
      return r * k < since * skin ? k : Math.max(k, (layer * skin) / r);
    });
    if (M) geo.applyMatrix4(M.clone().invert());
    return { mesh: t.mesh, geo };
  });
}

/** Mete el pelo por debajo de un sombrero: lo que asoma por fuera de él (en las direcciones que tapa) se baja hasta
 *  quedar dentro. Así un moño alto no atraviesa la copa ni una melena la cinta. */
async function meterUnder(hair: PieceChunk[], hat: PieceChunk[], hatSource: string, face: string): Promise<PieceChunk[]> {
  const [f, h, g] = await Promise.all([source(hatSource), mold(face), genericSkull()]);
  const { pos, idx } = soup(hat.map(t => ({ geo: t.geo, M: aHead(f, t.mesh) })));
  // (lo que el sombrero tiene dentro de la cabeza no cuenta: no se ve y aplastaría el pelo contra el cráneo)
  const inside = measureField(pos, idx, 'min', h ? (x, y, z) => h.sample(x, y, z) * g.field.sample(x, y, z) * 0.97 : undefined);
  return hair.map(t => {
    const geo = t.geo.clone();
    stretch(geo, (x, y, z) => { const h = inside.cell(x, y, z), r = Math.hypot(x, y, z); return h !== null && r > h * 0.96 ? (h * 0.96) / r : 1; });
    return { mesh: t.mesh, geo };
  });
}

/** Un sombrero que queda en el aire (el sombrerito del payaso, hecho para ir sobre su peluca) baja hasta apoyarse en
 *  la cabeza o en el pelo. Los que ya tocan (casi todos) se quedan donde están. */
async function settle(hatSource: string, hat: PieceChunk[], face: string, hair?: PieceChunk[]): Promise<PieceChunk[]> {
  const [f, h, g] = await Promise.all([source(hatSource), mold(face), genericSkull()]);
  if (!h) return hat;
  const skin = (x: number, y: number, z: number) => h.sample(x, y, z) * g.field.sample(x, y, z);
  const { pos, idx } = soup(hat.map(t => ({ geo: t.geo, M: aHead(f, t.mesh) })));
  const inside = measureField(pos, idx, 'min', (x, y, z) => skin(x, y, z) * 0.97);
  const outside = hair?.length ? (() => { const s = soup(hair.map(t => ({ geo: t.geo }))); return measureField(s.pos, s.idx, 'max'); })() : null;
  // la holgura: lo que separa el sombrero de lo que tiene debajo, en la dirección en la que menos
  let clearance = Infinity;
  inside.measures((v, x, y, z) => { clearance = Math.min(clearance, v - Math.max(skin(x, y, z), outside?.cell(x, y, z) ?? 0)); });
  if (!(clearance > 0.02) || clearance === Infinity) return hat;
  const download = new THREE.Matrix4().makeTranslation(0, -(clearance - 0.01), 0);
  return hat.map(t => {
    const geo = t.geo.clone(), M = aHead(f, t.mesh);
    geo.applyMatrix4(M ? M.clone().premultiply(download).premultiply(M.clone().invert()) : download);
    geo.computeBoundingSphere();
    return { mesh: t.mesh, geo };
  });
}

/** El cráneo de relleno de una cara: tapa los huecos que deja en ella lo que no es cara (pelo, barba, gorros). Es lo
 *  que quitaron, aplastado sobre la horma de la cabeza y pintado de piel: casa con los bordes de la cara sin
 *  costuras y lleva su material (la misma luz). Sin cara (el maniquí), el cráneo genérico. */
const skulls = new Map<string, Promise<PieceChunk[]>>();
export function skull(face?: string, hat?: Piece, hair?: Piece): Promise<PieceChunk[]> {
  const key = (face ?? '') + (face && hat ? '^' + hat.id + (hair ? '/' + hair.id : '') : '');
  let c = skulls.get(key);
  if (!c) {
    c = !face ? genericSkull().then(g => g.pieces.map(({ mesh, tris, k }) => { const geo = extract(mesh, tris, () => R('piel')); stretch(geo, () => k); return { mesh, geo }; }))
      : hat ? (async () => meterUnder(await skull(face), await chunks(hat, { face, hair }), hat.source, face))()   // (las capuchas van justas)
      : scalpLeather(face);
    skulls.set(key, c);
  }
  return c;
}

async function scalpLeather(face: string): Promise<PieceChunk[]> {
  const f = await source(face), h = await mold(face), g = await genericSkull();
  if (!f.head || !h) return skull();
  const { mesh, d } = f.head, geo0 = mesh.geometry, P = geo0.attributes.position, uv = geo0.attributes.uv;
  const K = { cara: HEAD_KINDS.indexOf('cara'), eyes: HEAD_KINDS.indexOf('eyes'), cejas: HEAD_KINDS.indexOf('cejas') };
  const large = components(geo0).filter(c => c.tris.length >= 120 && Math.abs(c.center.x) < 0.1);
  const vert = (t: number, k: number) => (geo0.index ? geo0.index.getX(t * 3 + k) : t * 3 + k);
  const key = (i: number) => P.getX(i).toFixed(4) + ',' + P.getY(i).toFixed(4) + ',' + P.getZ(i).toFixed(4);
  // los bordes de la cara se quedan donde están; un color de piel de la cara, el de en medio de su degradado
  const edge = new Set<string>(); const skins: { i: number; l: number }[] = [];
  for (const c of large) for (const t of c.tris) if (d.kind[t] === K.cara) for (let k = 0; k < 3; k++) {
    const i = vert(t, k); edge.add(key(i));
    if (d.faceSkins.has(d.strip[t]) && f.head.atlas) { const col = f.head.atlas.color[d.strip[t]]; skins.push({ i, l: col[0] + col[1] + col[2] }); }
  }
  if (!skins.length || !uv) return skull();
  skins.sort((a, b) => a.l - b.l);
  const ref = skins[skins.length >> 1].i, u0 = uv.getX(ref), v0 = uv.getY(ref);
  // lo que hay que tapar, de las piezas grandes y centradas (los adornos sueltos, las orejas, la nariz y los cuernos
  // no dejan hueco)
  // (lo que cuelga por debajo de la cara, melenas y barbas largas, no tapa ningún hueco: aplastado haría un cuello)
  let floor = Infinity; for (const k of edge) floor = Math.min(floor, +k.split(',')[1]);
  const center = new THREE.Vector3();
  const tris = large.flatMap(c => c.tris.filter(t => d.kind[t] !== K.cara && d.kind[t] !== K.eyes && d.kind[t] !== K.cejas && centerTri(geo0, t, center).y > floor - 0.08));
  if (!tris.length) return [];
  const geo = extract(mesh, tris, () => R('piel'));
  const Q = geo.attributes.position as THREE.BufferAttribute, U = geo.attributes.uv as THREE.BufferAttribute;
  const C = HEAD_CENTER;
  for (let i = 0; i < Q.count; i++) {
    U.setXY(i, u0, v0);
    if (edge.has(Q.getX(i).toFixed(4) + ',' + Q.getY(i).toFixed(4) + ',' + Q.getZ(i).toFixed(4))) continue;
    const x = Q.getX(i) - C.x, y = Q.getY(i) - C.y, z = Q.getZ(i) - C.z, r = Math.hypot(x, y, z) || 1;
    const k = (h.sample(x, y, z) * g.field.sample(x, y, z) * 0.993) / r;
    Q.setXYZ(i, C.x + x * k, C.y + y * k, C.z + z * k);
  }
  // lo que al aplastarlo queda del revés (la cara de abajo de un flequillo, el forro de una melena) sobra: por fuera ya
  // tapa la capa de encima, y del revés se vería oscuro
  const I = geo.index!, remain: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < I.count; t += 3) {
    a.fromBufferAttribute(Q, I.getX(t)); b.fromBufferAttribute(Q, I.getX(t + 1)); c.fromBufferAttribute(Q, I.getX(t + 2));
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.dot(a.add(b).add(c).multiplyScalar(1 / 3).sub(C)) > 0) remain.push(I.getX(t), I.getX(t + 1), I.getX(t + 2));
  }
  geo.setIndex(remain);
  // la luz, la de la horma (lisa) y no la de los triángulos aplastados: si no, las capas del pelo se verían en vetas
  const radio = (x: number, y: number, z: number) => h.sample(x, y, z) * g.field.sample(x, y, z);
  const N = geo.attributes.normal as THREE.BufferAttribute, dir = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const point = (v: THREE.Vector3, out: THREE.Vector3) => out.copy(v).normalize().multiplyScalar(radio(v.x, v.y, v.z));
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < Q.count; i++) {
    dir.set(Q.getX(i) - C.x, Q.getY(i) - C.y, Q.getZ(i) - C.z).normalize();
    t1.set(0, 1, 0).cross(dir); if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0).cross(dir); t1.normalize(); t2.crossVectors(dir, t1);
    point(dir, p0); point(q.copy(dir).addScaledVector(t1, 0.03), p1); point(q.copy(dir).addScaledVector(t2, 0.03), p2);
    n.crossVectors(p1.sub(p0), p2.sub(p0)).normalize(); if (n.dot(dir) < 0) n.negate();
    N.setXYZ(i, n.x, n.y, n.z);
  }
  N.needsUpdate = true; geo.computeBoundingSphere();
  return [{ mesh, geo }];
}
export { trisStrips };
