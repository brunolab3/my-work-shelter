// La calle: el yermo a la altura de la planta baja, con franja de tierra, colinas y árboles secos (pack de naturaleza
// KayKit, recoloreados a polvo y ceniza). El cielo y la luz de fuera, según la hora real, son de sky.ts. La entrada
// del refugio está a pie de calle; lo demás queda bajo tierra.
import * as THREE from 'three';
import { place } from '../engine/assets';
import { random, mergeStatic } from './util3d';
import { exterior, type Paper } from './sky';

const NAT = (n: string) => `kaykit-extra/forest-nature-pack-1.0/Assets/gltf/Color1/${n}_Color1.gltf`;

// `y`: altura de la calle; `z`: la cara de corte. `edificios`: tramos de x ocupados a pie de calle (la puerta y la torre
// del ascensor): ahí no crece nada delante y el suelo no se mete en el hueco del ascensor (`hueco`)
export async function buildSurface(x0: number, x1: number, y: number, z: number, zBackground: number, buildings: [number, number][], gap: [number, number]) {
  const g = new THREE.Group(); g.name = 'surface';
  const r = random(77);
  // suelo de la superficie: una losa de tierra que remata la cara de corte
  const dirt = exterior(new THREE.MeshStandardMaterial({ color: '#6b4a33', roughness: 1, emissive: '#7a4a2c', emissiveIntensity: 0.38 }), 'piece');
  const slab = (xa: number, xb: number, za: number, zb: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, 0.6, zb - za), dirt); m.position.set((xa + xb) / 2, y - 0.3, (za + zb) / 2); m.receiveShadow = true; g.add(m); };
  slab(x0, x1, z - 60, zBackground);
  // la franja delantera queda 3 cm por detrás de la cara de corte: las vigas de las salas (cara delantera en z) la tapan
  // limpias (coplanarias, la banda marrón parpadearía sobre la -1 al cambiar el zoom)
  slab(x0, gap[0], zBackground, z - 0.03); slab(gap[1], x1, zBackground, z - 0.03);
  // el bordillo, solo donde hay calle: delante de la puerta y de la torre del ascensor taparía su franja de peligro
  const street: [number, number][] = []; let xc = x0;
  for (const [a, b] of [...buildings].sort((p, q) => p[0] - q[0])) { if (a > xc) street.push([xc, a]); xc = Math.max(xc, b); }
  if (xc < x1) street.push([xc, x1]);
  const edgeSoil = exterior(new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 1, emissive: '#4a3424', emissiveIntensity: 0.2 }), 'piece');
  for (const [xa, xb] of street) { const edge = new THREE.Mesh(new THREE.BoxGeometry(xb - xa, 0.25, 0.4), edgeSoil); edge.position.set((xa + xb) / 2, y - 0.05, z); g.add(edge); }
  const ahead = (x: number, zz: number, m: number) => zz > zBackground - 1.5 && buildings.some(([a, b]) => x > a - m && x < b + m);
  const ps: Promise<unknown>[] = [];
  // el patio de la derecha (molino, placa solar y antena de environment.ts, junto a la última sala; x1 es la sala más a la
  // derecha + 40, ver shelter.ts): tampoco crece ahí una colina cercana, que se los tragaba
  const patio: [number, number] = [x1 - 46, x1 - 29];
  // la superficie no la alumbran las lámparas del refugio: lleva su propia luz, que sky.ts ajusta a la hora del día
  // (materiales compartidos por original, tono y papel: la fusión los junta en pocas llamadas de dibujo)
  const mats = new Map<string, THREE.Material>();
  const dust = (o: THREE.Object3D, tone: string, paper: Paper = 'piece') => o.traverse((m: any) => {
    if (!m.isMesh) return;
    const key = m.material.uuid + tone + paper;
    let mat: any = mats.get(key);
    if (!mat) { mat = m.material.clone(); mat.color = new THREE.Color(tone); mat.roughness = 1; mat.emissive = new THREE.Color(); mat.emissiveIntensity = 0.42; mats.set(key, exterior(mat, paper)); }
    m.material = mat;
  });
  // colinas lejanas (siluetas) y cercanas
  for (let i = 0; i < 14; i++) {
    const x = x0 + r() * (x1 - x0), farSide = r() < 0.6, which = Math.floor(r() * 4);
    let zz = farSide ? -18 - r() * 14 : -6 - r() * 6; const esc = farSide ? 1.6 + r() : 0.8 + r() * 0.5;
    // una colina cercana (hasta 8 m de radio) no se mete en la puerta ni en la torre del ascensor: detrás de ellas, más lejos
    if (!farSide && [...buildings, patio].some(([a, b]) => x > a - 8 && x < b + 8)) zz = Math.min(zz, zBackground - 8.5);
    ps.push(place(g, NAT(['Hill_12x12x4', 'Hill_12x12x8', 'Hill_8x8x4', 'Hill_12x6x8'][which]), { pos: [x, y - 0.4, zz], scale: esc, rot: r() * 6.28, shadow: false }).then(o => {
      dust(o, farSide ? '#5a3a2e' : '#7a5236', farSide ? 'far' : 'piece');
      if (farSide) o.scale.y = 0.5;   // las del fondo, mesetas bajas: dejan ver el cielo (y el sol que lo cruza) desde la vista general
    }));
  }
  // árboles secos, rocas y alguna antena oxidada
  for (let i = 0; i < 26; i++) {
    const x = x0 + r() * (x1 - x0), zz = -1 - r() * 10, tree = r() < 0.6, which = Math.floor(r() * 4), esc = 0.7 + r() * 0.8, rotation = r() * 6.28;
    if (ahead(x, zz, 2)) continue;
    ps.push(place(g, NAT(tree ? ['Tree_Bare_1_A', 'Tree_Bare_1_B', 'Tree_Bare_2_A', 'Tree_Bare_2_C'][which] : ['Rock_1_A', 'Rock_2_B', 'Rock_3_C', 'Rock_1_J'][which]), { pos: [x, y - 0.05, zz], scale: esc, rot: rotation }).then(o => dust(o, '#4b3628')));
  }
  await Promise.all(ps);
  mergeStatic(g);
  return g;
}
