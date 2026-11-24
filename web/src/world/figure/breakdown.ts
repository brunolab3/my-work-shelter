// Despiece de los personajes de KayKit: cada malla (cabeza, cuerpo, brazos, piernas) se parte en trozos con sentido
// (piel, pelo, barba, cejas, ojos, ropa…) para combinarlos y pintarlos por separado.
// KayKit pinta con un atlas de franjas de color (degradados planos): un trozo es lo que cae en la misma franja, y las
// franjas se reconocen rellenando el atlas por zonas de color continuo. La forma (componentes conexas, pares simétricos)
// separa ojos, cejas, nariz y orejas, que son mallas sueltas dentro de la cabeza.
import * as THREE from 'three';

// ---------------------------------------------------------------- franjas del atlas
const SIDE = 256;   // el atlas se mira a 256 px: los degradados siguen siendo continuos y las franjas, nítidas
export interface Atlas { width: number; height: number; label: Int32Array; color: [number, number, number][]; area: number[] }
const atlas = new WeakMap<object, Atlas>();

/** Etiqueta cada píxel del atlas con su franja (zona de color continuo). Se calcula una vez por imagen. */
export function strips(tex: THREE.Texture | null | undefined): Atlas | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width) return null;
  const already = atlas.get(img); if (already) return already;
  const cv = document.createElement('canvas'); cv.width = cv.height = SIDE;
  const g = cv.getContext('2d', { willReadFrequently: true })!; g.imageSmoothingEnabled = true; g.drawImage(img, 0, 0, SIDE, SIDE);
  const px = g.getImageData(0, 0, SIDE, SIDE).data;
  const n = SIDE * SIDE, et = new Int32Array(n).fill(-1), color: [number, number, number][] = [], area: number[] = [];
  const queue = new Int32Array(n);
  const similar = (a: number, b: number) => Math.abs(px[a * 4] - px[b * 4]) <= 7 && Math.abs(px[a * 4 + 1] - px[b * 4 + 1]) <= 7 && Math.abs(px[a * 4 + 2] - px[b * 4 + 2]) <= 7;
  for (let s = 0; s < n; s++) {
    if (et[s] >= 0) continue;
    const id = color.length; let start = 0, end = 0; queue[end++] = s; et[s] = id;
    let r = 0, gg = 0, b = 0;
    while (start < end) {
      const p = queue[start++]; r += px[p * 4]; gg += px[p * 4 + 1]; b += px[p * 4 + 2];
      const x = p % SIDE, y = (p / SIDE) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < SIDE - 1 ? p + 1 : -1, y > 0 ? p - SIDE : -1, y < SIDE - 1 ? p + SIDE : -1]) if (q >= 0 && et[q] < 0 && similar(p, q)) { et[q] = id; queue[end++] = q; }
    }
    color.push([r / end, gg / end, b / end]); area.push(end);
  }
  const a: Atlas = { width: SIDE, height: SIDE, label: et, color, area };
  atlas.set(img, a); return a;
}

/** Franja en la que cae una coordenada de textura (glTF: v hacia abajo, sin voltear) */
export function stripIn(a: Atlas, u: number, v: number) {
  const x = Math.min(a.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * a.width)));
  const y = Math.min(a.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * a.height)));
  return a.label[y * a.width + x];
}

// ---------------------------------------------------------------- triángulos y componentes
export interface Mesh { geo: THREE.BufferGeometry; atlas: Atlas | null }
export const numTris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const vert = (g: THREE.BufferGeometry, t: number, k: number) => (g.index ? g.index.getX(t * 3 + k) : t * 3 + k);

/** Franja de cada triángulo (por el centro de sus coordenadas de textura) */
export function trisStrips(m: Mesh): Int32Array {
  const n = numTris(m.geo), out = new Int32Array(n).fill(-1), uv = m.geo.attributes.uv;
  if (!m.atlas || !uv) return out;
  for (let t = 0; t < n; t++) {
    let u = 0, v = 0; for (let k = 0; k < 3; k++) { const i = vert(m.geo, t, k); u += uv.getX(i); v += uv.getY(i); }
    out[t] = stripIn(m.atlas, u / 3, v / 3);
  }
  return out;
}

export interface Component { tris: number[]; min: THREE.Vector3; max: THREE.Vector3; center: THREE.Vector3 }
/** Piezas sueltas de la malla (vértices soldados por posición) */
export function components(g: THREE.BufferGeometry): Component[] {
  const P = g.attributes.position, nv = P.count, pair = new Int32Array(nv);
  for (let i = 0; i < nv; i++) pair[i] = i;
  const root = (x: number): number => { while (pair[x] !== x) { pair[x] = pair[pair[x]]; x = pair[x]; } return x; };
  const union = (a: number, b: number) => { a = root(a); b = root(b); if (a !== b) pair[b] = a; };
  const canon = new Map<string, number>();
  for (let i = 0; i < nv; i++) { const k = P.getX(i).toFixed(4) + ',' + P.getY(i).toFixed(4) + ',' + P.getZ(i).toFixed(4); const c = canon.get(k); if (c === undefined) canon.set(k, i); else union(c, i); }
  const n = numTris(g);
  for (let t = 0; t < n; t++) { union(vert(g, t, 0), vert(g, t, 1)); union(vert(g, t, 0), vert(g, t, 2)); }
  const groups = new Map<number, Component>(); const v = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const r = root(vert(g, t, 0));
    let c = groups.get(r); if (!c) { c = { tris: [], min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), center: new THREE.Vector3() }; groups.set(r, c); }
    c.tris.push(t);
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, vert(g, t, k)); c.min.min(v); c.max.max(v); }
  }
  const list = [...groups.values()].sort((a, b) => b.tris.length - a.tris.length);
  for (const c of list) c.center.addVectors(c.min, c.max).multiplyScalar(0.5);
  return list;
}

/** Centro de un triángulo */
export function centerTri(g: THREE.BufferGeometry, t: number, out = new THREE.Vector3()) {
  const P = g.attributes.position; out.set(0, 0, 0);
  for (let k = 0; k < 3; k++) { const i = vert(g, t, k); out.x += P.getX(i); out.y += P.getY(i); out.z += P.getZ(i); }
  return out.multiplyScalar(1 / 3);
}

// ---------------------------------------------------------------- color
const near = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 16;
const lum = (c: [number, number, number]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
function hsl(c: [number, number, number]) { const o = { h: 0, s: 0, l: 0 }; new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255).getHSL(o); return o; }
/** ¿Dos colores de franja son del mismo tinte (la misma pintura con otra luz)? */
export function tintSame(a: [number, number, number], b: [number, number, number]) {
  const x = hsl(a), y = hsl(b); let dh = Math.abs(x.h - y.h); dh = Math.min(dh, 1 - dh);
  if (x.s < 0.12 || y.s < 0.12) return Math.abs(x.s - y.s) < 0.1 && Math.abs(x.l - y.l) < 0.22;
  return dh < 0.045 && Math.abs(x.s - y.s) < 0.3 && Math.abs(x.l - y.l) < 0.3;
}

// ---------------------------------------------------------------- cabezas humanas
export type HeadKind = 'cara' | 'eyes' | 'cejas' | 'pelo' | 'barba' | 'cap';
export const HEAD_KINDS: HeadKind[] = ['cara', 'eyes', 'cejas', 'pelo', 'barba', 'cap'];
export interface Settings {
  /** componentes (por su orden de tamaño) que van a una clase a la fuerza */
  comp?: Partial<Record<number, HeadKind>>;
  /** franjas cuyo tinte se toma por pelo (además de las de las cejas), en rgb */
  hair?: [number, number, number][];
  /** altura (en el espacio de la malla) por debajo de la cual el pelo de delante es barba */
  underBeard?: number;
  /** la cabeza no tiene barba aunque le caiga pelo por delante (melenas) */
  withoutBeard?: boolean;
  /** tintes (rgb) que son gorro, capucha, casco o máscara y no pelo */
  tintsCap?: [number, number, number][];
  /** tintes (rgb) que son de la cara aunque no sean piel (maquillaje) */
  tintsFace?: [number, number, number][];
  /** el pelo de esta cabeza es una peluca: va como gorro */
  hairIsCap?: boolean;
  /** todo lo que no es piel, ojos ni cejas es gorro (capuchas, cascos) */
  allCap?: boolean;
}
export interface HeadBreakdown {
  kind: Uint8Array; skin: [number, number, number] | null; hair: [number, number, number] | null; hairTints: [number, number, number][];
  /** franjas de piel de orejas y nariz (las que sirven para reconocer la piel en la ropa) */
  skins: Set<number>;
  /** franjas de la cara que se pintan con la piel elegida (además de esas, las que se les parecen mucho) */
  faceSkins: Set<number>;
  strip: Int32Array; eyesY: number;
}

/** Parte una cabeza humana de KayKit en cara (piel, nariz, orejas, boca), ojos, cejas, pelo, barba y gorro. */
export function dismantleHead(m: Mesh, settings: Settings = {}): HeadBreakdown {
  const g = m.geo, n = numTris(g), comps = components(g), fr = trisStrips(m);
  const kind = new Uint8Array(n).fill(255);
  const colorOf = (tris: number[]) => { const count = new Map<number, number>(); for (const t of tris) count.set(fr[t], (count.get(fr[t]) ?? 0) + 1); const f = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1; return f >= 0 && m.atlas ? m.atlas.color[f] : [128, 128, 128] as [number, number, number]; };
  // pares simétricos (orejas, ojos, cejas)
  const pairs: [Component, Component][] = [];
  const used = new Set<Component>();
  for (const a of comps) {
    if (used.has(a) || a.center.x < 0.03 || a.tris.length > 400) continue;
    const b = comps.find(c => c !== a && !used.has(c) && c.tris.length === a.tris.length && Math.abs(c.center.x + a.center.x) < 0.02 && Math.abs(c.center.y - a.center.y) < 0.045 && Math.abs(c.center.z - a.center.z) < 0.03);
    if (b) { pairs.push([a, b]); used.add(a); used.add(b); }
  }
  const eyes = pairs.filter(([a]) => a.center.z > 0.2 && a.center.x < 0.32 && lum(colorOf(a.tris)) < 0.3).sort((p, q) => q[0].center.z - p[0].center.z)[0];
  const eyesY = eyes ? eyes[0].center.y : 1.6;
  // orejas: un par de los lados a la altura de los ojos (las patillas también son pares); nariz: la pieza central que
  // más sobresale a la altura de los ojos (el bigote también es central, pero más abajo). Las dos son de piel, así que
  // tienen que ser del mismo tinte: la nariz roja del payaso o el bigote del soldadito no son piel.
  const candNose = comps.filter(c => Math.abs(c.center.x) < 0.03 && c.center.z > 0.3 && c.center.y < eyesY + 0.08 && c.center.y > eyesY - 0.3 && c.tris.length < 160 && c.max.y - c.min.y < 0.35)
    .sort((a, b) => Math.abs(a.center.y - (eyesY - 0.05)) - Math.abs(b.center.y - (eyesY - 0.05)));
  const candEars = pairs.filter(([a]) => a.center.x > 0.33 && a.center.z < 0.25 && Math.abs(a.center.y - eyesY) < 0.25 && a !== eyes?.[0]);
  // la nariz más cercana a su sitio que tenga un par de orejas de su tinte; si ninguna lo tiene, las orejas más claras
  // y ninguna nariz
  let nose: Component | undefined, ears: [Component, Component] | undefined;
  for (const n of candNose) {
    const o = candEars.filter(([a]) => tintSame(colorOf(a.tris), colorOf(n.tris))).sort((p, q) => p[0].tris.length - q[0].tris.length)[0];
    if (o) { nose = n; ears = o; break; }
  }
  ears ??= candEars.sort((p, q) => lum(colorOf(q[0].tris)) - lum(colorOf(p[0].tris)) || p[0].tris.length - q[0].tris.length)[0];
  if (!ears) nose = candNose[0];   // (sin orejas a la vista, capuchas y orejas puntiagudas, la nariz sola)
  const eyebrows = pairs.filter(([a]) => a !== eyes?.[0] && a !== ears?.[0] && a.center.y > eyesY + 0.04 && a.center.y < eyesY + 0.35 && a.center.z > 0.15 && a.center.x < 0.38 && a.tris.length < 260)
    .sort((p, q) => q[0].center.z - p[0].center.z)[0];
  const mark = (c: Component | undefined, k: number) => { if (c) for (const t of c.tris) kind[t] = k; };
  const I = (c: HeadKind) => HEAD_KINDS.indexOf(c);
  if (eyes) { mark(eyes[0], I('eyes')); mark(eyes[1], I('eyes')); }
  if (eyebrows) { mark(eyebrows[0], I('cejas')); mark(eyebrows[1], I('cejas')); }
  // piel: las franjas de orejas y nariz (las de la cara de esa cabeza)
  const skins = new Set<number>();
  for (const c of [ears?.[0], ears?.[1], nose]) if (c) for (const t of c.tris) if (fr[t] >= 0) skins.add(fr[t]);
  const skin = skins.size && m.atlas ? m.atlas.color[[...skins].sort((a, b) => m.atlas!.area[b] - m.atlas!.area[a])[0]] : null;
  const forcedHair = (f: number) => f >= 0 && !!m.atlas && (settings.hair ?? []).some(c => tintSame(m.atlas!.color[f], c));
  // pelo: el tinte de las cejas, y los que se indiquen a mano
  const hairTints: [number, number, number][] = [...(settings.hair ?? [])];
  if (eyebrows) hairTints.push(colorOf(eyebrows[0].tris));
  const isHair = (f: number) => f >= 0 && !!m.atlas && hairTints.some(c => tintSame(m.atlas!.color[f], c));
  // piel: la de orejas y nariz siempre (el rubio del caballero se parece a su piel, pero su piel es piel) y lo que se le
  // parece mucho
  const isSkin = (f: number) => skins.has(f) || (f >= 0 && !!m.atlas && !!skin && !forcedHair(f) && near(m.atlas.color[f], skin));
  const underBeard = settings.underBeard ?? eyesY - 0.07;
  const center = new THREE.Vector3();
  comps.forEach((c, i) => {
    const forced = settings.comp?.[i];
    if (forced) { mark(c, I(forced)); return; }
    for (const t of c.tris) {
      if (kind[t] !== 255) continue;
      const f = fr[t];
      if (isSkin(f) || c === nose || c === ears?.[0] || c === ears?.[1]) { kind[t] = I('cara'); continue; }
      centerTri(g, t, center);
      const hair = isHair(f);
      if (settings.allCap && !hair) { kind[t] = I('cap'); continue; }
      // boca y mejillas pintadas: lo que no es pelo en la zona de la boca se queda en la cara
      const mouthZone = Math.abs(center.x) < 0.2 && center.z > 0.3 && center.y < eyesY - 0.02 && center.y > eyesY - 0.32;
      if (!hair && mouthZone) { kind[t] = I('cara'); continue; }
      if (!hair && c.tris.length < 120 && center.z > 0.25 && Math.abs(center.y - eyesY) < 0.3) { kind[t] = I('cara'); continue; }   // detalles de la cara (pecas, colorete, cicatriz)
      const beard = !settings.withoutBeard && center.y < underBeard && center.z > 0.12 && Math.abs(center.x) < 0.36;
      if (settings.tintsFace?.some(c => f >= 0 && tintSame(m.atlas!.color[f], c))) { kind[t] = I('cara'); continue; }
      const cap = (settings.hairIsCap && hair) || (!!settings.tintsCap?.length && settings.tintsCap.some(c => f >= 0 && tintSame(m.atlas!.color[f], c)) && !hair);
      kind[t] = cap ? I('cap') : beard ? I('barba') : I('pelo');
    }
  });
  for (let t = 0; t < n; t++) if (kind[t] === 255) kind[t] = I('cara');
  const faceSkins = new Set<number>();
  for (let t = 0; t < n; t++) if (kind[t] === I('cara') && isSkin(fr[t])) faceSkins.add(fr[t]);
  return { kind, skin, hair: hairTints[hairTints.length - 1] ?? null, hairTints, skins, faceSkins, strip: fr, eyesY };
}

// ---------------------------------------------------------------- ropa: regiones de color por franja
/** Reparte las franjas de unas mallas (de un mismo personaje) en piel y en colores de ropa por superficie:
 *  la más grande es el color principal, luego el secundario y el terciario. Las muy oscuras (cinturones, suelas)
 *  y las diminutas no se pintan. */
export function clothesRegions(meshes: Mesh[], skins: Set<number>, skin: [number, number, number] | null) {
  const area = new Map<number, number>(); const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const meshBy = meshes.map(m => {
    const fr = trisStrips(m), P = m.geo.attributes.position;
    for (let t = 0; t < fr.length; t++) {
      if (fr[t] < 0) continue;
      a.fromBufferAttribute(P, vert(m.geo, t, 0)); b.fromBufferAttribute(P, vert(m.geo, t, 1)); c.fromBufferAttribute(P, vert(m.geo, t, 2));
      const s = b.sub(a).cross(c.sub(a)).length() / 2;
      area.set(fr[t], (area.get(fr[t]) ?? 0) + s);
    }
    return fr;
  });
  const at = meshes.find(m => m.atlas)?.atlas;
  const isSkin = (f: number) => skins.has(f) || (!!skin && !!at && near(at.color[f], skin));
  // franjas del mismo tinte cuentan como una (la misma tela con dos tonos de degradado)
  const groups: { strips: number[]; area: number; color: [number, number, number] }[] = [];
  for (const [f, s] of [...area.entries()].sort((x, y) => y[1] - x[1])) {
    if (!at || isSkin(f)) continue;
    const gr = groups.find(g0 => tintSame(g0.color, at.color[f]));
    if (gr) { gr.strips.push(f); gr.area += s; } else groups.push({ strips: [f], area: s, color: at.color[f] });
  }
  const total = [...area.values()].reduce((x, y) => x + y, 0) || 1;
  const useful = groups.filter(g0 => g0.area / total > 0.04 && lum(g0.color) > 0.07).sort((x, y) => y.area - x.area).slice(0, 3);
  const region = (f: number) => (f < 0 ? 0 : isSkin(f) ? -1 : useful.findIndex(g0 => g0.strips.includes(f)) + 1);
  return { meshBy: meshBy.map(fr => Int8Array.from(fr, region)), colors: useful.map(g0 => g0.color) };
}
