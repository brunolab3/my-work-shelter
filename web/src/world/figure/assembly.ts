// Monta una figura a partir de su aspecto: el esqueleto de KayKit de siempre (todas las animaciones valen) con las
// piezas elegidas colgadas de sus huesos, juntadas por material para dibujar poco, y pintadas por regiones.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gltf, measure } from '../../engine/assets';
import { SOURCES, SOURCE_BASE, PIECE, REGIONS, isLarge, type Look, type Slot, type Region } from '@shared/appearance';
import { source, chunks, skull, type PieceChunk } from './sources';
import { strips, stripIn } from './breakdown';

const N = REGIONS.length;

/** Pintura por regiones sobre el material de KayKit: cada vértice lleva su región y, si la región tiene color,
 *  el texel se cambia por ese color con la luz de su degradado (luminancia del texel / luminancia de referencia). */
export function materialPaintable(base: THREE.MeshStandardMaterial, colors: THREE.Vector4[], ref: number[]) {
  const m = base.clone();
  m.roughness = Math.max(m.roughness ?? 0.5, 0.82); m.metalness = Math.min(m.metalness ?? 0, 0.1);
  const uRef = { value: ref };
  m.onBeforeCompile = sh => {
    sh.uniforms.uColors = { value: colors }; sh.uniforms.uRef = uRef;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float region;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uColors[${N}];\nuniform float uRef[${N}];\nvarying float vRegion;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        { int r = int(vRegion + 0.5);
          if (r > 0) { vec4 c = uColors[r];
            if (c.w > 0.5) { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = c.rgb * clamp(l / max(uRef[r], 0.004), 0.3, 1.8); } } }`);
  };
  m.customProgramCacheKey = () => 'paintable-figure';
  m.userData.uRef = uRef; m.userData.own = true;
  return m;
}

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

// la escala de todas las figuras: la de la figura base a la altura de un personaje (todas del mismo tamaño)
// los robots grandes van sobre el esqueleto grande (el maniquí grande) y se escalan a la misma altura que los demás
const BASE_LARGE = 'Mannequin_Large';
const heights = new Map<string, Promise<number>>();
function baseHeight(base: string) {
  let a = heights.get(base);
  if (!a) { a = gltf(SOURCES[base].path).then(g => measure(SkeletonUtils.clone(g.scene)).size.y); heights.set(base, a); }
  return a;
}

export interface Figure {
  model: THREE.Object3D;
  /** colores de las regiones (rgb lineal + w=1 si se pinta): cambiarlos repinta sin volver a montar */
  colors: THREE.Vector4[];
  modelHeight: number;
  /** esqueleto grande (Rig_Large): sus clips se adaptan (solo rotaciones) */
  large: boolean;
  /** regiones de color que tiene de verdad (el probador solo ofrece esas) */
  regions: Set<number>;
  /** color por defecto de cada región (el de sus piezas): el probador lo enseña como «original» */
  fallback: Partial<Record<Region, string>>;
}

/** Arma la figura de un aspecto. `altura`: a qué altura se escala (todas las figuras salen igual de altas). */
export async function mountFigure(a: Look, o: { mannequin?: boolean } = {}): Promise<Figure> {
  const large = isLarge(a.pieces.torso);
  const nameBase = large ? BASE_LARGE : SOURCE_BASE;
  const base = await gltf(SOURCES[nameBase].path);
  const model = SkeletonUtils.clone(base.scene);
  const remove: THREE.Object3D[] = []; model.traverse((n: any) => { if (n.isMesh) remove.push(n); });
  for (const n of remove) n.parent?.remove(n);
  const bones = new Map<string, THREE.Bone>(); model.traverse((n: any) => { if (n.isBone) bones.set(n.name, n); });
  const armor = model.getObjectByName(large ? 'Rig_Large' : 'Rig_Medium') ?? model.children[0] ?? model;

  // piezas puestas (el sombrero que tapa el pelo se lo quita)
  const pieces = Object.entries(a.pieces).filter(([, v]) => v && PIECE.has(v)).map(([r, v]) => [r as Slot, PIECE.get(v!)!] as const);
  const hat = pieces.find(([r]) => r === 'sombrero')?.[1];
  const visible = pieces.filter(([r]) => !(hat?.hairLid && r === 'pelo') && !(hat?.faceLid && (r === 'barba' || r === 'cejas')));
  // lo de la cabeza se adapta a la forma de la cara elegida, y el pelo se mete bajo el sombrero
  const face = a.especie === 'human' && a.pieces.cara ? PIECE.get(a.pieces.cara)?.source : undefined;
  const list: { r: Slot | 'skull'; t: PieceChunk }[] = [];
  const hair = visible.find(([r]) => r === 'pelo')?.[1];
  const done = await Promise.all(visible.map(async ([r, p]) => (await chunks(p, { face, hat, hair })).map(t => ({ r, t }))));
  for (const h of done) list.push(...h);
  // el cráneo que tapa los huecos de la cara (con su forma: tampoco asoma bajo una capucha, y sin él se vería por dentro
  // de la cabeza por debajo de la peluca); un maniquí de escaparate lleva el liso, sin cara
  if (face || o.mannequin) for (const c of await skull(face, hat, hair)) list.push({ r: 'skull', t: c });

  // colores por defecto: la piel, la de la cara; el pelo, el del peinado (o la barba, o las cejas) para que todo case
  const fallback: Partial<Record<Region, string>> = {};
  const hex = (c: [number, number, number] | null | undefined) => (c ? '#' + new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).getHexString() : undefined);
  if (a.especie === 'human') {
    const face = a.pieces.cara ? await source(PIECE.get(a.pieces.cara)!.source) : null;
    fallback.piel = hex(face?.skin);
    for (const r of ['pelo', 'barba', 'cejas'] as Slot[]) {
      const id = a.pieces[r]; if (!id || (r === 'pelo' && hat?.hairLid)) continue;
      const f = await source(PIECE.get(id)!.source); const c = hex(f.head?.d.hair); if (c) { fallback.pelo = c; break; }
    }
  }
  // los robots: lo que en un humano es piel (manos, brazos al aire de la ropa), chapa
  if (a.especie === 'robot') fallback.piel = a.colors.cabeza1 ?? '#8d939b';
  // los colores de serie de cada pieza (los cráneos y endoesqueletos, cromados)
  for (const [, p] of visible) for (const [r, c] of Object.entries(p.colors ?? {})) fallback[r as Region] ??= c;
  const colors = Array.from({ length: N }, () => new THREE.Vector4(0, 0, 0, 0));
  REGIONS.forEach((r, i) => {
    if (!r) return;
    const c = a.colors[r] ?? fallback[r];
    if (c) { const col = new THREE.Color(c); colors[i].set(col.r, col.g, col.b, 1); }
  });

  // juntar por material y esqueleto: una malla por cada (material de origen, esqueleto) en vez de una por pieza
  // (lo de la espalda va aparte y se llama «espalda:…»: al tumbarse en la cama se esconde)
  const groups = new Map<string, { mat: THREE.MeshStandardMaterial; mesh: THREE.SkinnedMesh; geos: THREE.BufferGeometry[]; name: string }>();
  const loose: { t: PieceChunk; name: string }[] = [];
  for (const { r, t } of list) {
    const m = t.mesh as THREE.SkinnedMesh;
    const name = (r === 'espalda' ? 'espalda:' : 'pieza:') + m.name;
    if (!m.isSkinnedMesh) { loose.push({ t, name }); continue; }
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const key = mat.uuid + '|' + skeletonKey(m.skeleton) + (r === 'espalda' ? '|espalda' : '');
    const g = groups.get(key);
    if (g) g.geos.push(t.geo); else groups.set(key, { mat, mesh: m, geos: [t.geo], name });
  }
  const skeletons = new Map<string, THREE.Skeleton>();
  const forSkeleton = (m: THREE.SkinnedMesh) => {
    const k = skeletonKey(m.skeleton); let s = skeletons.get(k);
    if (!s) { s = new THREE.Skeleton(m.skeleton.bones.map(b => bones.get(b.name) ?? bones.get('root')!), m.skeleton.boneInverses.map(x => x.clone())); skeletons.set(k, s); }
    return s;
  };
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialOf = (mat: THREE.MeshStandardMaterial, geos: THREE.BufferGeometry[]) => {
    let m = materials.get(mat.uuid);
    if (!m) { m = materialPaintable(mat, colors, new Array(N).fill(0.5)); materials.set(mat.uuid, m); }
    // luminancia de referencia de cada región en esta textura (media de sus vértices)
    const at = strips(mat.map); const ref = m.userData.uRef.value as number[];
    if (at) {
      const sum = new Array(N).fill(0), count = new Array(N).fill(0);
      for (const g of geos) {
        const uv = g.attributes.uv, rg = g.attributes.region; if (!uv) continue;
        for (let i = 0; i < rg.count; i++) {
          const r = rg.getX(i); if (!r) continue;
          const f = stripIn(at, uv.getX(i), uv.getY(i)); if (f < 0) continue;
          const c = at.color[f]; sum[r] += 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); count[r]++;
        }
      }
      for (let r = 1; r < N; r++) if (count[r]) ref[r] = sum[r] / count[r];
    }
    if (/glow/i.test(mat.name)) {   // las luces de los robots: del color elegido, y que brillen
      const c = colors[REGIONS.indexOf('luz')];
      if (c.w > 0.5) { m.color.setRGB(c.x, c.y, c.z); m.emissive = new THREE.Color(c.x, c.y, c.z); m.emissiveIntensity = 1.6; m.map = null; m.emissiveMap = null; }
    }
    return m;
  };
  for (const { mat, mesh, geos, name } of groups.values()) {
    const join = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (join && geos.length > 1) join.userData.own = true;   // la juntada es solo de esta figura (las piezas, de todas)
    for (const geo of join ? [join] : geos) {   // si no se pueden juntar (atributos de otro tipo), una a una
      const sm = new THREE.SkinnedMesh(geo, materialOf(mat, geos));
      sm.name = name; sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      armor.add(sm);
      sm.bind(forSkeleton(mesh), mesh.bindMatrix.clone());
    }
  }
  // piezas sin piel (gafas de sol, capas, alas): cuelgan del mismo hueso que en su personaje
  for (const { t, name } of loose) {
    const parent = bones.get(t.mesh.parent?.name ?? '') ?? bones.get('head');
    if (!parent) continue;
    const mat = (Array.isArray(t.mesh.material) ? t.mesh.material[0] : t.mesh.material) as THREE.MeshStandardMaterial;
    const o = new THREE.Mesh(t.geo, materialOf(mat, [t.geo]));
    o.name = name; o.castShadow = true; o.receiveShadow = true;
    o.position.copy(t.mesh.position); o.quaternion.copy(t.mesh.quaternion); o.scale.copy(t.mesh.scale);
    parent.add(o);
  }
  // la textura de KayKit tiene blancos que queman bajo los focos: el material pintable ya es mate; la escala, común
  const modelHeight = await baseHeight(nameBase);
  const regions = new Set<number>();
  for (const { t } of list) { const rg = t.geo.attributes.region; for (let i = 0; i < rg.count; i++) regions.add(rg.getX(i)); }
  return { model, colors, modelHeight, fallback, large, regions };
}

const keys = new WeakMap<THREE.Skeleton, string>();
function skeletonKey(s: THREE.Skeleton) {
  const already = keys.get(s); if (already) return already;
  const k = computeKey(s); keys.set(s, k); return k;
}
function computeKey(s: THREE.Skeleton) {
  // dos personajes comparten esqueleto si tienen los mismos huesos EN EL MISMO ORDEN (los índices de la malla apuntan a
  // esa lista: cada personaje de KayKit la trae en su orden) y las mismas matrices de enlace
  return s.bones.map((b, i) => b.name + ':' + Array.from(s.boneInverses[i].elements).map(v => v.toFixed(3)).join(',')).join('|');
}

/** Cambia los colores de una figura ya montada (el probador, mientras se elige) */
export function paint(f: Figure, a: Look) {
  REGIONS.forEach((r, i) => {
    if (!r) return;
    const c = a.colors[r] ?? f.fallback[r];
    if (c) { const col = new THREE.Color(c); f.colors[i].set(col.r, col.g, col.b, 1); } else f.colors[i].set(0, 0, 0, 0);
  });
}
