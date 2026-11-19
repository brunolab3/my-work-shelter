import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Busca las submallas con un material dado y pone encima un plano con la textura (pantallas, carteles). El plano va
// pegado al cristal y con su misma orientación: se mide en el espacio local de `obj` (el giro del mueble no cuenta), solo
// con los triángulos de ese material (una malla puede llevar varios) y solo con la cara grande y plana que mira al frente
// (la del cristal), no con los cantos ni el marco: así una pantalla inclinada hacia atrás lleva el plano inclinado igual.
export function overlayScreen(obj: THREE.Object3D, nameMat: RegExp, tex: THREE.Texture, opts: { brightness?: number; margin?: number; idx?: number } = {}) {
  obj.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  obj.traverse((n: any) => { if (n.isMesh && [].concat(n.material).some((m: any) => nameMat.test(m.name))) meshes.push(n); });
  const m = meshes[opts.idx ?? 0];
  if (!m) return null;
  const geo = m.geometry; const pos = geo.attributes.position; const index = geo.index;
  const toLocal = new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(obj.matrixWorld).invert(), m.matrixWorld);
  // los tramos de índices de esta malla con el material buscado
  const mats = ([] as THREE.Material[]).concat(m.material);
  const total = index ? index.count : pos.count;
  const segments = Array.isArray(m.material) && geo.groups.length ? geo.groups.filter(gr => nameMat.test(mats[gr.materialIndex ?? 0]?.name ?? '')).map(gr => [gr.start, Math.min(total, gr.start + gr.count)]) : [[0, total]];
  // triángulos en el espacio de obj, con su normal y su área
  const tris: { p: THREE.Vector3[]; n: THREE.Vector3; area: number }[] = [];
  const v = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(toLocal);
  for (const [a, b] of segments) for (let k = a; k + 2 < b; k += 3) {
    const p = [v(k), v(k + 1), v(k + 2)];
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const area = n.length() / 2; if (area < 1e-7) continue;
    tris.push({ p, n: n.normalize(), area });
  }
  if (!tris.length) return null;
  // la cara del cristal: de las direcciones que miran al frente (+z, hacia la sala), la de más área
  let best: THREE.Vector3 | null = null, bestArea = 0;
  for (const t of tris) {
    if (t.n.z < 0.2) continue;
    let sum = 0; for (const u of tris) if (u.n.dot(t.n) > 0.97) sum += u.area;
    if (sum > bestArea + 1e-9) { bestArea = sum; best = t.n; }
  }
  const face = best ? tris.filter(t => t.n.dot(best!) > 0.97) : tris;
  const n = new THREE.Vector3(); for (const t of face) n.addScaledVector(t.n, t.area); n.normalize();
  // base del plano: u horizontal (a la derecha del cristal), w hacia arriba por el cristal
  const above = Math.abs(n.y) > 0.95 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(above, n).normalize(), w = new THREE.Vector3().crossVectors(n, u).normalize();
  let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity, d = -Infinity;
  for (const t of face) for (const p of t.p) { const a = p.dot(u), b = p.dot(w); u0 = Math.min(u0, a); u1 = Math.max(u1, a); w0 = Math.min(w0, b); w1 = Math.max(w1, b); d = Math.max(d, p.dot(n)); }
  const mg = opts.margin ?? 0.92;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry((u1 - u0) * mg, (w1 - w0) * mg),
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: opts.brightness ?? 1.5, color: '#000000', roughness: 0.25, metalness: 0 }));
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, w, n));
  plane.position.copy(u).multiplyScalar((u0 + u1) / 2).addScaledVector(w, (w0 + w1) / 2).addScaledVector(n, d + 0.004);
  plane.castShadow = false; plane.receiveShadow = false;
  obj.add(plane);
  return plane;
}

// Fusiona las mallas estáticas de un grupo por material (menos llamadas de dibujo: 60 fps con cientos de módulos).
export function mergeStatic(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; shadow: boolean; receives: boolean }>();
  const remove: THREE.Mesh[] = [];
  group.traverse((n: any) => {
    if (!n.isMesh || n.isSkinnedMesh || Array.isArray(n.material)) return;
    let p = n, isStatic = true;
    while (p && p !== group) { if (p.userData.isStatic === false) { isStatic = false; break; } p = p.parent; }
    // una pieza que se usa con un clic (`userData.interactivo`) se queda suelta: fusionada, perdería su id y su vista
    if (!isStatic || n.material.transparent || n.userData.interactive) return;
    const g = n.geometry.index ? n.geometry.toNonIndexed() : n.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, n.matrixWorld));
    const e = byMat.get(n.material) ?? { geos: [], shadow: false, receives: false };
    e.geos.push(g); e.shadow ||= n.castShadow; e.receives ||= n.receiveShadow;
    byMat.set(n.material, e); remove.push(n);
  });
  for (const m of remove) m.parent!.remove(m);
  const fusion = new THREE.Group(); fusion.name = 'fusion';
  for (const [mat, e] of byMat) {
    const geo = mergeGeometries(e.geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = e.shadow; mesh.receiveShadow = e.receives;
    fusion.add(mesh);
  }
  group.add(fusion);
  // limpia grupos vacíos (nunca los huesos ni nada de lo que se mueve: los dedos y la cabeza de un personaje no tienen hijos)
  const empty: THREE.Object3D[] = [];
  const movable = (o: THREE.Object3D | null) => { for (let p = o; p && p !== group; p = p.parent) if (p.userData.isStatic === false) return true; return false; };
  group.traverse(o => { const x = o as any; if (o !== group && o !== fusion && !x.isMesh && !x.isSprite && !x.isPoints && !x.isLight && !x.isBone && o.children.length === 0 && !movable(o)) empty.push(o); });
  for (const o of empty) o.parent?.remove(o);
  return fusion;
}

export function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

// Pantalla sobre un modelo cuyo frente es +z y está centrado en x/z con base en y=0 (lo que deja `colocar`).
export function screenFrontal(wrapper: THREE.Object3D, tex: THREE.Texture, r: { width: number; height: number; cy: number; dz?: number }, brightness = 1.6) {
  const size: THREE.Vector3 = wrapper.userData.size;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * r.width, size.y * r.height),
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: brightness, color: '#000000', roughness: 0.3 }));
  plane.position.set(0, size.y * r.cy, size.z / 2 + (r.dz ?? 0.004));
  // pegada al cristal de verdad: el frente de la caja del modelo no es el cristal (el pie o el marco sobresalen), y una
  // pantalla flotando unos centímetros por delante se veía descolocada en cuanto se mira el monitor de lado. Se mide con
  // un rayo en el espacio del propio monitor (su giro no cuenta) y se copia la inclinación de la cara que toca
  wrapper.updateMatrixWorld(true);
  const since = wrapper.localToWorld(new THREE.Vector3(0, size.y * r.cy, size.z / 2 + 0.5));
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(wrapper.matrixWorld);
  const beat = new THREE.Raycaster(since, dir, 0, size.z + 1).intersectObject(wrapper, true).find(h => (h.object as THREE.Mesh).isMesh && h.face);
  if (beat) {
    const n = beat.face!.normal.clone().transformDirection(beat.object.matrixWorld).transformDirection(new THREE.Matrix4().copy(wrapper.matrixWorld).invert());
    if (n.z > 0.7) {
      plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const z = wrapper.worldToLocal(beat.point.clone()).z;
      plane.position.z = z + 0.004;
    }
  }
  wrapper.add(plane);
  wrapper.userData.isStatic = false;
  return plane;
}
