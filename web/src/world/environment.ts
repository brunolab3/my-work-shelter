// La roca alrededor del refugio no está muerta: vetas de mineral medio enterradas y la bajante de ventilación; y, a pie
// de calle, lo que rodea la entrada (farola, bidones, molino, placa solar, antena y el rótulo «WORK-SHELTER» sobre la puerta).
// Todo con piezas del material CC0.
import * as THREE from 'three';
import { place, R } from '../engine/assets';
import { mergeStatic } from './util3d';
import { exterior } from './sky';

// las piezas de la superficie vienen en blanco de catálogo: al óxido y al polvo del yermo. Su luz propia la ajusta
// sky.ts a la hora del día (`juntoLuz`: lo que alumbra la farola de noche)
const rusted = new Map<string, THREE.Material>();
function rust(o: THREE.Object3D, tone = '#7a5236', lightTogether = false) {
  o.traverse((m: any) => {
    if (!m.isMesh) return;
    let mat: any = rusted.get(m.material.uuid + tone + lightTogether);
    if (!mat) {
      mat = m.material.clone(); const l = mat.color.getHSL({ h: 0, s: 0, l: 0 }).l;
      mat.color = new THREE.Color(tone).multiplyScalar(0.4 + l * 0.3); mat.roughness = 0.9; mat.metalness = 0.2;
      mat.emissive = mat.color.clone().lerp(new THREE.Color('#ff9a50'), 0.25); mat.emissiveIntensity = 0.3; mat.map = null;
      rusted.set(m.material.uuid + tone + lightTogether, exterior(mat, lightTogether ? 'near-light' : 'piece'));
    }
    m.material = mat;
  });
  return o;
}

// los objetos de las cuevas no los alcanzan las lámparas del refugio: un poco de luz propia, cálida
// (materiales compartidos por original y tono: así la fusión los junta en pocas llamadas de dibujo)
const lit = new Map<string, THREE.Material>();
function light(o: THREE.Object3D, k = 0.35, tone = '#ffb070') {
  o.traverse((m: any) => {
    if (!m.isMesh) return;
    const key = m.material.uuid + k + tone;
    let mat: any = lit.get(key);
    if (!mat) { mat = m.material.clone(); mat.color.multiplyScalar(0.55).lerp(new THREE.Color('#5a3a24'), 0.3); mat.emissive = mat.color.clone().lerp(new THREE.Color(tone), 0.5); mat.emissiveIntensity = k * 0.6; lit.set(key, mat); }
    m.material = mat;
  });
  return o;
}

// materiales de las luces de fuera, compartidos (el entorno se rehace al cambiar la disposición)
const LANTERN = exterior(new THREE.MeshBasicMaterial({ color: '#ffc87a' }), 'lantern');
const PILOT = exterior(new THREE.MeshBasicMaterial({ color: '#ff3020' }), 'pilot');
let texPool: THREE.Texture | null = null;
const POOL = () => {
  if (!texPool) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); texPool = new THREE.CanvasTexture(c);
  }
  return texPool;
};
let matPool: THREE.MeshBasicMaterial | null = null;
function puddle(g: THREE.Object3D, x: number, y: number, z: number, radio: number) {
  matPool ??= exterior(new THREE.MeshBasicMaterial({ color: '#ffa850', map: POOL(), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 'pool');
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radio * 2, radio * 2), matPool); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.renderOrder = 2; g.add(m);
}

export async function buildEnvironment(o: {
  z: number; xLeft: number; xRight: number; rightOf: (floor: number) => number; yFloor: (p: number) => number; floors: number;
  floor: number; gaps: THREE.Box2[];
  gate?: { x0: number; x1: number; ceiling: number };   // la sala de la puerta, en la calle: su rótulo va en el tejado
}) {
  const g = new THREE.Group(); g.name = 'environment';
  const ps: Promise<unknown>[] = [];
  const z = o.z;
  // vetas de mineral medio enterradas en la cara de corte
  let s = 9173; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const free = (x: number, y: number, m: number) => !o.gaps.some(b => x > b.min.x - m && x < b.max.x + m && y > b.min.y - m && y < b.max.y + m);
  const yBackground = o.yFloor(o.floors - 1) - 2;  // vetas: nódulos medio hundidos en la roca, apiñados
  const veins = ['Gold_Nugget_Large', 'Copper_Nugget_Large', 'Copper_Nugget_Large', 'Iron_Nugget_Large'];
  for (let k = 0, placed = 0; k < 200 && placed < 16; k++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side < 0 ? o.xLeft - 1.5 - r() * 20 : o.xRight + 1.5 + r() * 20, y = yBackground + r() * (o.floor - 1.5 - yBackground);
    if (!free(x, y, 1.2)) continue;
    placed++;
    const type = veins[Math.floor(r() * veins.length)];
    for (let j = 0; j < 3 + Math.floor(r() * 3); j++) ps.push(place(g, R.resource(type), { pos: [x + (r() - 0.5) * 0.8, y + (r() - 0.5) * 0.45, z - 0.06], height: 0.16 + r() * 0.16, rot: r() * 6.28, shadow: false }).then(x2 => {
      x2.rotation.x = 1.2; light(x2, 0.08, '#ffb070');
    }));
  }
  // bajante de ventilación: sale de la calle y entra en el refugio por el costado de la -1
  const tube = new THREE.MeshStandardMaterial({ color: '#6a5a48', roughness: 0.6, metalness: 0.5, emissive: '#2a1a10', emissiveIntensity: 0.4 });
  const clamp = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.7, metalness: 0.4 });
  const segment = (x0: number, x1: number, y: number, radio: number) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, Math.abs(x1 - x0), 12), tube); t.rotation.z = Math.PI / 2; t.position.set((x0 + x1) / 2, y, z + radio * 0.6); g.add(t);
    for (let x = Math.min(x0, x1) + 0.6; x < Math.max(x0, x1); x += 1.6) { const a = new THREE.Mesh(new THREE.CylinderGeometry(radio * 1.35, radio * 1.35, 0.1, 12), clamp); a.rotation.z = Math.PI / 2; a.position.set(x, y, z + radio * 0.6); g.add(a); }
  };
  const vert = (x: number, y0: number, y1: number, radio: number) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(radio, radio, Math.abs(y1 - y0), 12), tube); t.position.set(x, (y0 + y1) / 2, z + radio * 0.6); g.add(t);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(radio * 1.15, 12, 8), clamp); elbow.position.set(x, y1, z + radio * 0.6); g.add(elbow);
  };
  const pv = Math.min(1, o.floors - 1), xv = o.rightOf(pv) + 1.6, yv = o.yFloor(pv) + 3.2;
  vert(xv, yv, o.floor - 0.1, 0.17); segment(o.rightOf(pv), xv, yv, 0.17);
  // a pie de calle: la entrada se lee desde la vista general por el rótulo «WORK-SHELTER» en el tejado de la puerta, con un farol a
  // cada lado; fuera, una farola y unos bidones junto a la fachada y, al otro lado del ascensor, molino, placa y antena
  const sup = o.floor;
  // faroles: apagados de día, encendidos de noche (sky.ts); el bloom les da el halo
  const lantern = () => new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), LANTERN);
  if (o.gate) {
    const { x0, x1, ceiling } = o.gate; const xc = (x0 + x1) / 2;
    const c42 = document.createElement('canvas'); c42.width = 512; c42.height = 160; const x42 = c42.getContext('2d')!;
    x42.fillStyle = '#d9a52b'; x42.fillRect(0, 0, 512, 160); x42.fillStyle = '#1c1a17'; x42.fillRect(0, 0, 512, 10); x42.fillRect(0, 150, 512, 10);
    let tl = 112; x42.font = `900 ${tl}px "Big Shoulders Display", Impact, sans-serif`; while (x42.measureText('WORK-SHELTER').width > 480 && tl > 60) { tl -= 4; x42.font = `900 ${tl}px "Big Shoulders Display", Impact, sans-serif`; }
    x42.textAlign = 'center'; x42.textBaseline = 'middle'; x42.fillText('WORK-SHELTER', 256, 86);
    const t42 = new THREE.CanvasTexture(c42); t42.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3), exterior(new THREE.MeshStandardMaterial({ map: t42, emissive: '#ffffff', emissiveMap: t42, emissiveIntensity: 0.35, roughness: 0.8 }), 'label'));
    label.position.set(xc, ceiling + 1.15, z - 1.2); g.add(label);
    const iron = new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.7, metalness: 0.5 });
    for (const dx of [-1.6, 1.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), iron); leg.position.set(xc + dx, ceiling + 0.27, z - 1.25); g.add(leg); }
    for (const dx of [-2.35, 2.35]) { const f = lantern(); f.position.set(xc + dx, ceiling + 1.4, z - 1.1); g.add(f); }
    ps.push(place(g, R.cy('Light_Street_1'), { pos: [x0 - 1.4, sup, z - 1.0], height: 2.6, shadow: false }).then(x => rust(x)));
    { const f = lantern(); f.position.set(x0 - 1.4, sup + 2.5, z - 1.0); g.add(f); }
    // de noche, la farola deja su poza de luz en la calle y en la fachada de la puerta
    puddle(g, x0 - 1.4, sup + 0.02, z - 0.9, 3.4);
    ps.push(place(g, R.resource('Fuel_A_Barrels'), { pos: [x0 - 3.4, sup, z - 1.4], height: 1.1, rot: -0.4, shadow: false }).then(x => rust(x, '#5a3a2a', true)));
    ps.push(place(g, R.resource('Containers_Crate_Large'), { pos: [x0 - 5.2, sup, z - 1.1], height: 1.0, rot: 0.3, shadow: false }).then(x => rust(x, '#6a4a30', true)));
  }
  // el molino, con sus aspas (malla aparte) girando despacio: fuera de la fusión, gira al pintarse (sin bucle propio)
  ps.push(place(g, R.base('windturbine_tall'), { pos: [o.xRight - 4, sup, z - 4.6], height: 6.5, shadow: false }).then(x => {
    rust(x, '#5c5048');   // hierro gris: que no se funda con las mesetas de detrás
    const blades = x.getObjectByName('windturbine_tall_fan');
    if (blades) {
      // cuelgan del cuerpo, que la fusión quita de la escena: se pasan al envoltorio, en el mismo sitio
      x.updateMatrixWorld(true); x.attach(blades);
      blades.userData.isStatic = false; const turn0 = blades.rotation.z;
      blades.onBeforeRender = () => { blades.rotation.z = turn0 - performance.now() * 0.0007; blades.updateMatrixWorld(); };
    }
  }));
  ps.push(place(g, R.base('solarpanel'), { pos: [o.xRight - 9, sup, z - 3], height: 1.4, rot: 0.3, shadow: false }).then(x => rust(x)));
  ps.push(place(g, R.cy('Antenna_1'), { pos: [o.xRight + 2, sup, z - 2.2], height: 3.4, shadow: false }).then(x => rust(x)));
  { const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), PILOT); p.position.set(o.xRight + 2, sup + 3.45, z - 2.2); p.userData.isStatic = false; g.add(p); }
  await Promise.all(ps);
  mergeStatic(g);
  return g;
}
