// Herramienta de desarrollo: despiece de cabezas y figuras montadas por piezas (QA del probador).
import * as THREE from 'three';
import { gltf } from '../engine/assets';
import { dismantleHead, strips, HEAD_KINDS, numTris } from '../world/figure/breakdown';
import { SETTINGS } from '../world/figure/overrides';

const q = new URLSearchParams(location.search);
const mode = q.get('modo') || 'clases';
const S = +(q.get('s') || 180);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S); renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#3a3d44');
scene.add(new THREE.HemisphereLight('#ffffff', '#555566', 2.2));
const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(2, 4, 5); scene.add(d);
const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
const info: Record<string, unknown> = {};
const COLORS = ['#ffffff', '#202020', '#ff00ff', '#ffcc00', '#00ccff', '#33ff33'];
let INDEX: string[] = [];
const PATH = (n: string) => INDEX.find(r => r.endsWith('/' + n + '.glb')) ?? n;

async function figures() {
  const { mountFigure } = await import('../world/figure/assembly');
  const { STOCK, lookOnRandom, sanitizeLook } = await import('@shared/appearance');
  const g = document.getElementById('g')!;
  let seed = +(q.get('semilla') || 7); const r = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 100000) / 100000; };
  const requests = (q.get('aspectos') ?? '').split(',').filter(Boolean).flatMap(x => x.startsWith('azar') ? Array.from({ length: +(x.split(':')[1] || 8) }, (_, i) => ['azar' + i, lookOnRandom(r, x.startsWith('azarr') ? 'robot' : 'humano')] as const)
    : x.startsWith('{') ? [[x, sanitizeLook(JSON.parse(decodeURIComponent(x)))!] as const] : [[x, STOCK[x]] as const]);
  if (q.get('json')) requests.splice(0, requests.length, ...JSON.parse(q.get('json')!).map((a: any, i: number) => ['j' + i, sanitizeLook(a)!] as const));
  const H = +(q.get('h') || 300);
  renderer.setSize(S, H); cam.aspect = S / H; cam.updateProjectionMatrix();
  for (const [name, a] of requests) {
    if (!a) continue;
    let o: THREE.Object3D;
    if (q.get('pose')) {   // posado con un clip (Idle_A por defecto) para ver la piel deformada
      const { Character } = await import('../world/character');
      const p = new Character('qa', a); await p.load(); p.play(q.get('pose') === '1' ? 'Idle_A' : q.get('pose')!, 0); p.mixer.update(0.5); o = p.root; p.contactShadow.visible = false;
    } else { const f = await mountFigure(a); o = f.model; o.scale.setScalar(1.85 / f.modelHeight); }
    scene.add(o); o.rotation.y = +(q.get('rot') || 0.35);
    o.updateMatrixWorld(true);
    const near = q.get('cerca');
    if (near) { cam.position.set(0, 1.55, 2.2); cam.lookAt(0, 1.45, 0); } else { cam.position.set(0, 1.1, 6.2); cam.lookAt(0, 0.95, 0); }
    renderer.render(scene, cam); scene.remove(o);
    const div = document.createElement('div'); div.className = 'c';
    const cv = document.createElement('canvas'); cv.width = S; cv.height = H; cv.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    div.innerHTML = `<b>${name}</b>`; div.prepend(cv); g.append(div);
    info[name] = a;
  }
  (window as any).__info = info;
}

(window as any).__ready = async () => {
  if (q.get('aspectos') || q.get('json')) return figures();
  INDEX = (await (await fetch('/assets/indice.json')).json()).characters;
  const list = (q.get('f') || '').split(',').filter(Boolean);
  const g = document.getElementById('g')!;
  for (const path of list) {
    const gl = await gltf(PATH(path));
    const o = gl.scene.clone(true);
    let head: THREE.Mesh | null = null;
    o.traverse((n: any) => { if (n.isMesh) { if (/_Head$/.test(n.name) && !head) head = n; else n.visible = false; } });
    if (!head) continue;
    const m = head as THREE.Mesh, mat = m.material as THREE.MeshStandardMaterial;
    const des = dismantleHead({ geo: m.geometry, atlas: strips(mat.map) }, SETTINGS[path.split('/').pop()!.replace('.glb', '')]);
    { const { components, trisStrips } = await import('../world/figure/breakdown'); const cs = components(m.geometry), fr = trisStrips({ geo: m.geometry, atlas: strips(mat.map) }), at = strips(mat.map)!;
      info[path] = { eyesY: +des.eyesY.toFixed(2), piel: des.skin?.map(Math.round), comps: cs.map((c, i) => { const cu = new Map<number, number>(); for (const t of c.tris) cu.set(fr[t], (cu.get(fr[t]) ?? 0) + 1); const tints = [...cu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, k]) => at.color[f].map(Math.round).join(',') + 'x' + k).join(' ');
        const cl = new Map<string, number>(); for (const t of c.tris) { const k = HEAD_KINDS[des.kind[t]]; cl.set(k, (cl.get(k) ?? 0) + 1); }
        return `${i} n${c.tris.length} c(${c.center.toArray().map(v => v.toFixed(2)).join(',')}) [${tints}] => ${[...cl.entries()].map(e => e.join(':')).join(' ')}`; }) }; }
    const geo = m.geometry.clone();
    const n = numTris(geo), idx: number[] = [];
    const want = mode === 'clases' ? null : mode.split('+');
    for (let t = 0; t < n; t++) if (!want || want.includes(HEAD_KINDS[des.kind[t]])) idx.push(geo.index!.getX(t * 3), geo.index!.getX(t * 3 + 1), geo.index!.getX(t * 3 + 2));
    if (mode === 'clases') {
      const nv = geo.attributes.position.count, col = new Float32Array(nv * 3);
      for (let t = 0; t < n; t++) { const c = new THREE.Color(COLORS[des.kind[t]]); for (let k = 0; k < 3; k++) { const i = geo.index!.getX(t * 3 + k); col.set([c.r, c.g, c.b], i * 3); } }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      m.material = mat.clone(); (m.material as any).vertexColors = true;
    }
    geo.setIndex(idx); m.geometry = geo;
    scene.add(o); o.updateMatrixWorld(true);
    const header = o.getObjectByName('head'); const p = header ? header.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.7, 0);
    const view = q.get('vista') || 'frente';
    const ang = view === 'lado' ? Math.PI / 2 : view === 'atras' ? Math.PI : view === 'tres' ? 0.6 : 0;
    cam.position.set(p.x + Math.sin(ang) * 4.2, p.y + 0.55, p.z + Math.cos(ang) * 4.2); cam.lookAt(p.x, p.y + 0.5, p.z);
    renderer.render(scene, cam); scene.remove(o);
    const div = document.createElement('div'); div.className = 'c';
    const cv = document.createElement('canvas'); cv.width = cv.height = S; cv.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    (window as any).__info = info;
    div.innerHTML = `<b>${path.split('/').pop()!.replace('.glb', '')}</b>`; div.prepend(cv); g.append(div);
  }
};
(window as any).__step = () => {};
