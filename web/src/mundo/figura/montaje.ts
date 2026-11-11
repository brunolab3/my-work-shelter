// Monta una figura a partir de su aspecto: el esqueleto de KayKit de siempre (todas las animaciones valen) con las
// piezas elegidas colgadas de sus huesos, juntadas por material para dibujar poco, y pintadas por regiones.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gltf, measure } from '../../motor/assets';
import { SOURCES, SOURCE_BASE, PIECE, REGIONS, isLarge, type Look, type Slot, type Region } from '@shared/aspecto';
import { fuente, trozos, craneo, type PieceChunk } from './fuentes';
import { strips, stripIn } from './despiece';

const N = REGIONS.length;

/** Pintura por regiones sobre el material de KayKit: cada vértice lleva su región y, si la región tiene color,
 *  el texel se cambia por ese color con la luz de su degradado (luminancia del texel / luminancia de referencia). */
export function materialPaintable(base: THREE.MeshStandardMaterial, colores: THREE.Vector4[], ref: number[]) {
  const m = base.clone();
  m.roughness = Math.max(m.roughness ?? 0.5, 0.82); m.metalness = Math.min(m.metalness ?? 0, 0.1);
  const uRef = { value: ref };
  m.onBeforeCompile = sh => {
    sh.uniforms.uColors = { value: colores }; sh.uniforms.uRef = uRef;
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
  m.customProgramCacheKey = () => 'figura-pintable';
  m.userData.uRef = uRef; m.userData.propio = true;
  return m;
}

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

// la escala de todas las figuras: la de la figura base a la altura de un personaje (todas del mismo tamaño)
// los robots grandes van sobre el esqueleto grande (el maniquí grande) y se escalan a la misma altura que los demás
const BASE_LARGE = 'Mannequin_Large';
const alturas = new Map<string, Promise<number>>();
function baseHeight(base: string) {
  let a = alturas.get(base);
  if (!a) { a = gltf(SOURCES[base].ruta).then(g => measure(SkeletonUtils.clone(g.scene)).tam.y); alturas.set(base, a); }
  return a;
}

export interface Figure {
  modelo: THREE.Object3D;
  /** colores de las regiones (rgb lineal + w=1 si se pinta): cambiarlos repinta sin volver a montar */
  colores: THREE.Vector4[];
  modelHeight: number;
  /** esqueleto grande (Rig_Large): sus clips se adaptan (solo rotaciones) */
  grande: boolean;
  /** regiones de color que tiene de verdad (el probador solo ofrece esas) */
  regions: Set<number>;
  /** color por defecto de cada región (el de sus piezas): el probador lo enseña como «original» */
  porDefecto: Partial<Record<Region, string>>;
}

/** Arma la figura de un aspecto. `altura`: a qué altura se escala (todas las figuras salen igual de altas). */
export async function mountFigure(a: Look, o: { maniqui?: boolean } = {}): Promise<Figure> {
  const grande = isLarge(a.piezas.torso);
  const nameBase = grande ? BASE_LARGE : SOURCE_BASE;
  const base = await gltf(SOURCES[nameBase].ruta);
  const modelo = SkeletonUtils.clone(base.scene);
  const quitar: THREE.Object3D[] = []; modelo.traverse((n: any) => { if (n.isMesh) quitar.push(n); });
  for (const n of quitar) n.parent?.remove(n);
  const huesos = new Map<string, THREE.Bone>(); modelo.traverse((n: any) => { if (n.isBone) huesos.set(n.name, n); });
  const armor = modelo.getObjectByName(grande ? 'Rig_Large' : 'Rig_Medium') ?? modelo.children[0] ?? modelo;

  // piezas puestas (el sombrero que tapa el pelo se lo quita)
  const piezas = Object.entries(a.piezas).filter(([, v]) => v && PIECE.has(v)).map(([r, v]) => [r as Slot, PIECE.get(v!)!] as const);
  const sombrero = piezas.find(([r]) => r === 'sombrero')?.[1];
  const visibles = piezas.filter(([r]) => !(sombrero?.hairLid && r === 'pelo') && !(sombrero?.faceLid && (r === 'barba' || r === 'cejas')));
  // lo de la cabeza se adapta a la forma de la cara elegida, y el pelo se mete bajo el sombrero
  const cara = a.especie === 'humano' && a.piezas.cara ? PIECE.get(a.piezas.cara)?.fuente : undefined;
  const lista: { r: Slot | 'craneo'; t: PieceChunk }[] = [];
  const pelo = visibles.find(([r]) => r === 'pelo')?.[1];
  const hechos = await Promise.all(visibles.map(async ([r, p]) => (await trozos(p, { cara, sombrero, pelo })).map(t => ({ r, t }))));
  for (const h of hechos) lista.push(...h);
  // el cráneo que tapa los huecos de la cara (con su forma: tampoco asoma bajo una capucha, y sin él se vería por dentro
  // de la cabeza por debajo de la peluca); un maniquí de escaparate lleva el liso, sin cara
  if (cara || o.maniqui) for (const c of await craneo(cara, sombrero, pelo)) lista.push({ r: 'craneo', t: c });

  // colores por defecto: la piel, la de la cara; el pelo, el del peinado (o la barba, o las cejas) para que todo case
  const porDefecto: Partial<Record<Region, string>> = {};
  const hex = (c: [number, number, number] | null | undefined) => (c ? '#' + new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace).getHexString() : undefined);
  if (a.especie === 'humano') {
    const cara = a.piezas.cara ? await fuente(PIECE.get(a.piezas.cara)!.fuente) : null;
    porDefecto.piel = hex(cara?.piel);
    for (const r of ['pelo', 'barba', 'cejas'] as Slot[]) {
      const id = a.piezas[r]; if (!id || (r === 'pelo' && sombrero?.hairLid)) continue;
      const f = await fuente(PIECE.get(id)!.fuente); const c = hex(f.cabeza?.d.pelo); if (c) { porDefecto.pelo = c; break; }
    }
  }
  // los robots: lo que en un humano es piel (manos, brazos al aire de la ropa), chapa
  if (a.especie === 'robot') porDefecto.piel = a.colores.cabeza1 ?? '#8d939b';
  // los colores de serie de cada pieza (los cráneos y endoesqueletos, cromados)
  for (const [, p] of visibles) for (const [r, c] of Object.entries(p.colores ?? {})) porDefecto[r as Region] ??= c;
  const colores = Array.from({ length: N }, () => new THREE.Vector4(0, 0, 0, 0));
  REGIONS.forEach((r, i) => {
    if (!r) return;
    const c = a.colores[r] ?? porDefecto[r];
    if (c) { const col = new THREE.Color(c); colores[i].set(col.r, col.g, col.b, 1); }
  });

  // juntar por material y esqueleto: una malla por cada (material de origen, esqueleto) en vez de una por pieza
  // (lo de la espalda va aparte y se llama «espalda:…»: al tumbarse en la cama se esconde)
  const grupos = new Map<string, { mat: THREE.MeshStandardMaterial; malla: THREE.SkinnedMesh; geos: THREE.BufferGeometry[]; nombre: string }>();
  const sueltas: { t: PieceChunk; nombre: string }[] = [];
  for (const { r, t } of lista) {
    const m = t.malla as THREE.SkinnedMesh;
    const nombre = (r === 'espalda' ? 'espalda:' : 'pieza:') + m.name;
    if (!m.isSkinnedMesh) { sueltas.push({ t, nombre }); continue; }
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const clave = mat.uuid + '|' + skeletonKey(m.skeleton) + (r === 'espalda' ? '|espalda' : '');
    const g = grupos.get(clave);
    if (g) g.geos.push(t.geo); else grupos.set(clave, { mat, malla: m, geos: [t.geo], nombre });
  }
  const skeletons = new Map<string, THREE.Skeleton>();
  const forSkeleton = (m: THREE.SkinnedMesh) => {
    const k = skeletonKey(m.skeleton); let s = skeletons.get(k);
    if (!s) { s = new THREE.Skeleton(m.skeleton.bones.map(b => huesos.get(b.name) ?? huesos.get('root')!), m.skeleton.boneInverses.map(x => x.clone())); skeletons.set(k, s); }
    return s;
  };
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const materialOf = (mat: THREE.MeshStandardMaterial, geos: THREE.BufferGeometry[]) => {
    let m = materials.get(mat.uuid);
    if (!m) { m = materialPaintable(mat, colores, new Array(N).fill(0.5)); materials.set(mat.uuid, m); }
    // luminancia de referencia de cada región en esta textura (media de sus vértices)
    const at = strips(mat.map); const ref = m.userData.uRef.value as number[];
    if (at) {
      const suma = new Array(N).fill(0), cuenta = new Array(N).fill(0);
      for (const g of geos) {
        const uv = g.attributes.uv, rg = g.attributes.region; if (!uv) continue;
        for (let i = 0; i < rg.count; i++) {
          const r = rg.getX(i); if (!r) continue;
          const f = stripIn(at, uv.getX(i), uv.getY(i)); if (f < 0) continue;
          const c = at.color[f]; suma[r] += 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); cuenta[r]++;
        }
      }
      for (let r = 1; r < N; r++) if (cuenta[r]) ref[r] = suma[r] / cuenta[r];
    }
    if (/glow/i.test(mat.name)) {   // las luces de los robots: del color elegido, y que brillen
      const c = colores[REGIONS.indexOf('luz')];
      if (c.w > 0.5) { m.color.setRGB(c.x, c.y, c.z); m.emissive = new THREE.Color(c.x, c.y, c.z); m.emissiveIntensity = 1.6; m.map = null; m.emissiveMap = null; }
    }
    return m;
  };
  for (const { mat, malla, geos, nombre } of grupos.values()) {
    const junta = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (junta && geos.length > 1) junta.userData.propia = true;   // la juntada es solo de esta figura (las piezas, de todas)
    for (const geo of junta ? [junta] : geos) {   // si no se pueden juntar (atributos de otro tipo), una a una
      const sm = new THREE.SkinnedMesh(geo, materialOf(mat, geos));
      sm.name = nombre; sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      armor.add(sm);
      sm.bind(forSkeleton(malla), malla.bindMatrix.clone());
    }
  }
  // piezas sin piel (gafas de sol, capas, alas): cuelgan del mismo hueso que en su personaje
  for (const { t, nombre } of sueltas) {
    const padre = huesos.get(t.malla.parent?.name ?? '') ?? huesos.get('head');
    if (!padre) continue;
    const mat = (Array.isArray(t.malla.material) ? t.malla.material[0] : t.malla.material) as THREE.MeshStandardMaterial;
    const o = new THREE.Mesh(t.geo, materialOf(mat, [t.geo]));
    o.name = nombre; o.castShadow = true; o.receiveShadow = true;
    o.position.copy(t.malla.position); o.quaternion.copy(t.malla.quaternion); o.scale.copy(t.malla.scale);
    padre.add(o);
  }
  // la textura de KayKit tiene blancos que queman bajo los focos: el material pintable ya es mate; la escala, común
  const modelHeight = await baseHeight(nameBase);
  const regions = new Set<number>();
  for (const { t } of lista) { const rg = t.geo.attributes.region; for (let i = 0; i < rg.count; i++) regions.add(rg.getX(i)); }
  return { modelo, colores, modelHeight, porDefecto, grande, regions };
}

const claves = new WeakMap<THREE.Skeleton, string>();
function skeletonKey(s: THREE.Skeleton) {
  const ya = claves.get(s); if (ya) return ya;
  const k = computeKey(s); claves.set(s, k); return k;
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
    const c = a.colores[r] ?? f.porDefecto[r];
    if (c) { const col = new THREE.Color(c); f.colores[i].set(col.r, col.g, col.b, 1); } else f.colores[i].set(0, 0, 0, 0);
  });
}
