// Construye assets/terceros/octocat/Octocat.glb (la Octocat) a partir de «Github_kitten» de m.adityamondal2003
// (CC-BY 4.0, https://sketchfab.com/3d-models/github-kitten-83d5a6d1a12b4427bbfd662fbc478f8d; copia sin cuenta en
// https://raw.githubusercontent.com/Ryhox/Stargazer-Islands/049ceee55d58ceeb2e11cde7e3f2ddc2c444f9d6/public/models/github_kitten.glb).
// Repinta el atlas en colores planos de la Octocat (negro carbón, cara #f4cab1, nariz #ac5c51 y ojos con los tonos del
// original, negros), arregla los triángulos de la cara y los ojos que muestreaban negro, suaviza normales, nombra «head»
// el hueso de la cabeza, quita la malla de la cola (la que sale levantada) y sus clips, pone acabado mate y simplifica
// y cuantiza. Determinista: con los valores por defecto sale el
// mismo archivo que hay en el repo.
// No forma parte del juego ni de sus dependencias: se usa en una carpeta temporal con
//   npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node build-octocat.mjs github_kitten.glb Octocat.glb [atlas.png]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const [input, output, debugPng] = process.argv.slice(2);
const RATIO = +(process.env.RATIO ?? 0.75);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

// la cola: la malla esquelética que sale levantada (con su clip «tailanimation») se quita. Quedan los ocho tentáculos
// bajados del cuerpo; el saludo levanta uno de ellos solo mientras saluda (octocat.ts)
for (const n of root.listNodes()) if (n.getSkin()) { n.setMesh(null); n.setSkin(null); }

// ---- textura
const tex = root.listTextures()[0];
const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const lum = new Float32Array(N), face = new Uint8Array(N), nose = new Uint8Array(N);
const TF = +(process.env.TF ?? 0.5);
for (let i = 0; i < N; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  lum[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (r > 150 && r - b > 70 && r > g + 25) nose[i] = 1;
  else if (lum[i] > TF) face[i] = 1;
}
// componentes conexas (4-vecindad) de una máscara
function components(mask) {
  const et = new Int32Array(N).fill(-1), comps = []; const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!mask[s] || et[s] >= 0) continue;
    const id = comps.length; let n = 0, edge = false, x0 = W, x1 = 0, y0 = H, y1 = 0; let sp = 0; stack[sp++] = s; et[s] = id;
    while (sp) {
      const p = stack[--sp]; n++; const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && mask[q] && et[q] < 0) { et[q] = id; stack[sp++] = q; }
    }
    comps.push({ id, n, edge, x0, x1, y0, y1 });
  }
  return { et, comps };
}
// motas anaranjadas sueltas (no son la nariz) y motas claras sueltas en el cuerpo (no son cara)
{ const { et, comps } = components(nose); for (let i = 0; i < N; i++) if (nose[i] && comps[et[i]].n < 40) nose[i] = 0; }
{ const { et, comps } = components(face); for (let i = 0; i < N; i++) if (face[i] && comps[et[i]].n < +(process.env.SPECK ?? 1500)) face[i] = 0; }
// bordes de la cara sin escalones: mayoría en un disco de radio 2, dos pasadas
for (let pass = 0; pass < +(process.env.SMOOTHS ?? 2); pass++) {
  const prev = face.slice();
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    let n = 0, t = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (dx * dx + dy * dy > 5) continue; t++; n += prev[(y + dy) * W + x + dx]; }
    const i = y * W + x; if (!nose[i]) face[i] = n * 2 > t ? 1 : 0;
  }
}
// agujeros oscuros dentro de la cara: ojos (grandes) y boca (finos)
const claro = new Uint8Array(N); for (let i = 0; i < N; i++) claro[i] = face[i] | nose[i];
const outside = new Uint8Array(N); for (let i = 0; i < N; i++) outside[i] = claro[i] ? 0 : 1;
const { et, comps } = components(outside);
const eye = new Uint8Array(N), mouth = new Uint8Array(N);
const gaps = comps.filter(c => !c.edge && c.n < 6000);
for (const c of gaps) {
  const width = c.x1 - c.x0 + 1, height = c.y1 - c.y0 + 1;
  c.type = c.n > 300 && Math.min(width, height) > 14 ? 'ojo' : 'boca';
}
console.log('huecos', gaps.map(c => `${c.type}:${c.n}@${c.x0},${c.y0} ${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1}`).join(' | '));
for (let i = 0; i < N; i++) { const c = comps[et[i]]; if (outside[i] && c && !c.edge && c.n < 6000) (c.type === 'ojo' ? eye : mouth)[i] = 1; }
// la cara crece un poco sobre el negro: en el borde de su isla, los triángulos no muestrean la mota negra de al lado
for (let pass = 0; pass < +(process.env.GROWS ?? 2); pass++) {
  const prev = face.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!prev[i] && !eye[i] && !mouth[i] && !nose[i] && (prev[i - 1] || prev[i + 1] || prev[i - W] || prev[i + W])) face[i] = 1; }
}
// el blanco del ojo: un anillo alrededor de la pupila, dentro de la cara
// (sin anillo por defecto: el ojo original no lo lleva, va sobre la cara; RING=1 lo pone)
const R = +(process.env.ANILLO ?? 7), white = new Uint8Array(N);
if (process.env.RING === '1') for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x; if (eye[i]) continue;
  let near = false;
  for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) { if (dx * dx + dy * dy > R * R) continue; const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && eye[yy * W + xx]) { near = true; break; } }
  if (near) white[i] = 1;
}
const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const NEGRO = hex(process.env.NEGRO ?? '#1a1d21'), MEAT = hex('#f4cab1'), PUPIL = hex('#ac5c51'), WHITE = hex('#f6f3ee');
const out = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  // los ojos, con los tonos del original (negro carbón con matices): así siguen teniendo la expresión de la Octocat
  const c = process.env.DEBUG && !face[i] && !nose[i] && !eye[i] && !mouth[i] && lum[i] > +process.env.DEBUG ? [0, 255, 0] : white[i] ? WHITE : eye[i] ? [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]] : (mouth[i] || nose[i]) ? PUPIL : face[i] ? MEAT : NEGRO;
  out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
}
const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().png({ palette: true, colours: 8, compressionLevel: 9 }).toBuffer();
if (debugPng) writeFileSync(debugPng, png);
tex.setImage(new Uint8Array(png)).setMimeType('image/png').setURI('octocat.png');
for (const e of root.listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp') e.dispose();

// ---- nombres, materiales y clips
for (const n of root.listNodes()) if (n.getName() === 'Bone_19') n.setName('head');
// acabado mate, como el resto de personajes (el vinilo brillante no encajaba con ellos)
for (const m of root.listMaterials()) {
  m.setMetallicFactor(0).setDoubleSided(false);
  if (m.getBaseColorTexture()) m.setName('Octocat').setRoughnessFactor(0.85);
  else m.setName('Bigotes').setBaseColorFactor([0.03, 0.035, 0.04, 1]).setRoughnessFactor(0.85);
}
for (const a of root.listAnimations()) a.dispose();   // sin cola, sin clips: la animación es por código (octocat.ts)
root.getAsset().extras = { ...root.getAsset().extras, modified: 'work-shelter: repintado en colores planos de la Octocat (ojos con los tonos del original), hueso de la cabeza «head», sin la cola ni sus clips, acabado mate, simplificado' };

// Triángulos huérfanos: el atlas de la IA parte los ojos y la nariz en islas sueltas, y algún triángulo del ojo
// muestrea negro (una cuña negra en la pupila). Se etiqueta cada triángulo por su color y, si sus vecinos en 3D
// (por aristas) son casi todos de otra clase, se le lleva a un punto macizo de esa clase en el atlas.
const kind = new Uint8Array(N);   // 0 negro, 1 carne, 2 pupila/nariz/boca, 3 blanco
for (let i = 0; i < N; i++) kind[i] = white[i] ? 3 : (eye[i] || mouth[i] || nose[i]) ? 2 : face[i] ? 1 : 0;
const solid = [[100, 100], [530, 880], [475, 895], null];
const kindUV = (u, v) => kind[Math.min(H - 1, Math.max(0, Math.floor(v * H))) * W + Math.min(W - 1, Math.max(0, Math.floor(u * W)))];
for (const me of root.listMeshes()) for (const p of me.listPrimitives()) {
  const uv = p.getAttribute('TEXCOORD_0'); if (!uv || !p.getMaterial()?.getBaseColorTexture()) continue;
  const pos = p.getAttribute('POSITION'), idx = p.getIndices().getArray(), P = pos.getArray(), U = uv.getArray();
  const nt = idx.length / 3, et = new Int8Array(nt), mixed01 = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const cs = [0, 1, 2].map(k => kindUV(U[idx[t*3+k]*2], U[idx[t*3+k]*2+1]));
    const cu = (U[idx[t*3]*2] + U[idx[t*3+1]*2] + U[idx[t*3+2]*2]) / 3, cv = (U[idx[t*3]*2+1] + U[idx[t*3+1]*2+1] + U[idx[t*3+2]*2+1]) / 3;
    const cc = kindUV(cu, cv);
    mixed01[t] = cs.concat(cc).every(c => c <= 1) ? 1 : 0;
    et[t] = cs.every(c => c === cc) ? cc : cs.concat(cc).every(c => c === 0 || c === 2) ? 0 : -1;   // negro con algo de pupila: candidato
  }
  const q = i => [0, 1, 2].map(k => Math.round(P[i*3+k] * 1e4)).join(',');
  const edges = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const a = q(idx[t*3+k]), b = q(idx[t*3+(k+1)%3]); const key = a < b ? a + '|' + b : b + '|' + a; (edges.get(key) ?? edges.set(key, []).get(key)).push(t); }
  const neighbors = Array.from({ length: nt }, () => []);
  for (const ts of edges.values()) for (const a of ts) for (const b of ts) if (a !== b) neighbors[a].push(b);
  let changes = 0;
  for (let pass = 0; pass < 30; pass++) {
    let n = 0;
    for (let t = 0; t < nt; t++) {
      const L = et[t]; if (L !== 0) continue;   // solo se corrigen los negros sueltos dentro de la cara
      const count = [0, 0, 0, 0]; let tot = 0; for (const v of neighbors[t]) { if (et[v] >= 0) { count[et[v]]++; tot++; } }
      // junto a una pupila no hay negro legítimo (el ojo lleva su anillo blanco): basta un vecino; la carne, por mayoría
      let M = count[2] >= 1 ? 2 : count[1] >= 2 && count[1] > count[0] ? 1 : -1;
      if (M < 0 || !solid[M]) continue;
      const [x, y] = solid[M]; for (let k = 0; k < 3; k++) { const vi = idx[t*3+k]; U[vi*2] = (x + 0.5) / W; U[vi*2+1] = (y + 0.5) / H; }
      et[t] = M; n++;
    }
    changes += n; if (!n) break;
  }
  // la cara es una máscara sin entrantes: lo negro que cae dentro de su contorno (visto de frente) también es cara
  {
    const center = t => [0, 1, 2].map(k => (P[idx[t*3]*3+k] + P[idx[t*3+1]*3+k] + P[idx[t*3+2]*3+k]) / 3);
    const nor = t => { const a = idx[t*3]*3, b = idx[t*3+1]*3, c = idx[t*3+2]*3; const u = [P[b]-P[a], P[b+1]-P[a+1], P[b+2]-P[a+2]], v = [P[c]-P[a], P[c+1]-P[a+1], P[c+2]-P[a+2]]; const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; const l = Math.hypot(...n) || 1; return n.map(x => x / l); };
    const eyes = [], all = [0, 0, 0]; for (let t = 0; t < nt; t++) { const c = center(t); all.forEach((_, k) => all[k] += c[k] / nt); if (et[t] === 2) eyes.push(c); }
    if (eyes.length > 10) {
      const mo = [0, 1, 2].map(k => eyes.reduce((s, c) => s + c[k], 0) / eyes.length);
      const fr = mo.map((x, k) => x - all[k]); const lf = Math.hypot(...fr); fr.forEach((_, k) => fr[k] /= lf);
      const ax = Math.abs(fr[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const e1 = [ax[1]*fr[2]-ax[2]*fr[1], ax[2]*fr[0]-ax[0]*fr[2], ax[0]*fr[1]-ax[1]*fr[0]]; const l1 = Math.hypot(...e1); e1.forEach((_, k) => e1[k] /= l1);
      const e2 = [fr[1]*e1[2]-fr[2]*e1[1], fr[2]*e1[0]-fr[0]*e1[2], fr[0]*e1[1]-fr[1]*e1[0]];
      const pr = c => [c[0]*e1[0]+c[1]*e1[1]+c[2]*e1[2], c[0]*e2[0]+c[1]*e2[1]+c[2]*e2[2]];
      const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      const pts = []; let profMin = Infinity;
      for (let t = 0; t < nt; t++) if (et[t] >= 1 && dot(nor(t), fr) > 0.2) { const c = center(t); pts.push(pr(c), pr([-c[0], c[1], c[2]])); profMin = Math.min(profMin, dot(c, fr)); }   // simétrica: con su reflejo en x
      // envolvente convexa (cadena monótona)
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
      const lower = [], sup = []; for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop(); lower.push(p); }
      for (const p of [...pts].reverse()) { while (sup.length >= 2 && cross(sup[sup.length-2], sup[sup.length-1], p) <= 0) sup.pop(); sup.push(p); }
      const hull = lower.slice(0, -1).concat(sup.slice(0, -1));
      const cc = hull.reduce((s, p) => [s[0] + p[0] / hull.length, s[1] + p[1] / hull.length], [0, 0]);
      const inside = q => { const r = [cc[0] + (q[0] - cc[0]) / 0.99, cc[1] + (q[1] - cc[1]) / 0.99]; for (let i = 0; i < hull.length; i++) if (cross(hull[i], hull[(i + 1) % hull.length], r) < 0) return false; return true; };
      let n = 0;
      for (let t = 0; t < nt; t++) {
        if (et[t] !== 0 && !(et[t] === -1 && mixed01[t])) continue; const c = center(t);
        if (dot(nor(t), fr) < 0.05 || dot(c, fr) < profMin - 0.04 || !inside(pr(c))) continue;
        const [x, y] = solid[1]; for (let k = 0; k < 3; k++) { const vi = idx[t*3+k]; U[vi*2] = (x + 0.5) / W; U[vi*2+1] = (y + 0.5) / H; }
        et[t] = 1; n++;
      }
      console.log('cara rellenada', me.getName(), n, 'triángulos; contorno de', hull.length, 'puntos');
    }
  }
  uv.setArray(U); console.log('huérfanos corregidos', me.getName(), changes, 'de', nt);
}
// la boca (malla pequeña sin textura en el centro de la cara) va del color de la nariz
for (const me of root.listMeshes()) for (const p of me.listPrimitives()) {
  const pos = p.getAttribute('POSITION'); if (p.getMaterial()?.getBaseColorTexture()) continue;
  const mn = pos.getMin([]), mx = pos.getMax([]);
  if (mx[0] - mn[0] < 0.1 && pos.getCount() < 500) { const m = p.getMaterial().clone().setName('Boca').setBaseColorFactor([0.41, 0.11, 0.08, 1]).setRoughnessFactor(0.85); p.setMaterial(m); console.log('boca', me.getName(), pos.getCount()); }
}
// normales suaves: se promedian las de los vértices que comparten posición (las costuras del atlas no se ven)
if (process.env.SUAVE !== '0') for (const me of root.listMeshes()) for (const p of me.listPrimitives()) {
  const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL'), idx = p.getIndices(); if (!nor || !idx) continue;
  const n = pos.getCount(), P = pos.getArray(), I = idx.getArray(), acc = new Float32Array(n * 3);
  const key = i => [0, 1, 2].map(k => Math.round(P[i * 3 + k] * 2e4)).join(',');
  const group = new Map(), g = new Int32Array(n);
  for (let i = 0; i < n; i++) { const c = key(i); if (!group.has(c)) group.set(c, group.size); g[i] = group.get(c); }
  const sum = new Float32Array(group.size * 3);
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const ux = P[b*3]-P[a*3], uy = P[b*3+1]-P[a*3+1], uz = P[b*3+2]-P[a*3+2], vx = P[c*3]-P[a*3], vy = P[c*3+1]-P[a*3+1], vz = P[c*3+2]-P[a*3+2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    for (const v of [a, b, c]) { sum[g[v]*3] += nx; sum[g[v]*3+1] += ny; sum[g[v]*3+2] += nz; }
  }
  const N2 = nor.getArray(); let inv = 0;
  for (let i = 0; i < n; i++) { let x = sum[g[i]*3], y = sum[g[i]*3+1], z = sum[g[i]*3+2]; const l = Math.hypot(x, y, z) || 1; x/=l; y/=l; z/=l;
    if (x * N2[i*3] + y * N2[i*3+1] + z * N2[i*3+2] < 0) inv++;
    N2[i*3] = x; N2[i*3+1] = y; N2[i*3+2] = z; }
  nor.setArray(N2); if (inv) console.log('normales invertidas respecto a las originales', me.getName(), inv, '/', n);
}
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: +(process.env.ERR ?? 0.002) }), prune(), dedup(), ...(process.env.QUANT === '0' ? [] : [quantize({ quantizeNormal: 8, quantizeTexcoord: 12, quantizePosition: 14 })]));
const glb = await io.writeBinary(doc);
writeFileSync(output, glb);
let v = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) v += p.getAttribute('POSITION').getCount();
console.log('vertices', v, 'bytes', glb.length, 'png', png.length);
