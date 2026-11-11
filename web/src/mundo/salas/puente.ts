// Puente de Mando (planta -1, derecha): la sala que gobierna el refugio. Su habitante trabaja en el repo del propio
// juego, así que aquí se reescribe el mundo. Pieza protagonista: la maqueta holográfica del refugio en vivo (cada
// sala en su sitio y del color de su estado, el ascensor, la calle y un punto donde está el Supervisor) sobre un
// proyector en un estrado. A los lados, columnas de código que caen; a la izquierda, el núcleo de energía del refugio
// (el generador de siempre), y a la derecha, la mesa de planos del Arquitecto con el registro del repo.
import * as THREE from 'three';
import { R } from '../../motor/assets';
import { cartel, PhosphorScreen, PanelRoom, lienzo, textureOf, SOURCES } from '../../motor/texturas';
import { signInWall, mancha, highBand, monitorWall, mountLiquid, materialSteel, caja, mundo, textureHalo, workStation, screenReal, COLOR_STATE, HEIGHT, type Contexto, type Sala } from './comun';

const CYAN = '#6ae4ff';

export async function furnishBridge(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { gauge: -2.9, valves: [-3.45, 5.45], segments: [[-4.6, 3.0], [4.6, 2.8]] });
  // ---- estrado, proyector y maqueta
  const ZH = zB + 1.75;
  P(R.sf('Props_Base'), { pos: [0, 0, ZH], ancho: 2.7 });
  P(R.sf('Props_Teleporter_1'), { pos: [0, 0.34, ZH], ancho: 1.25 });
  const YH = 1.5;   // base de la maqueta (el proyector acaba a ~1,3 m)
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 0.32, 1.75, 32, 1, true), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.set(0, 1.32 + 0.875, ZH); g.add(cone);
  const foco = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: CYAN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
  foco.scale.set(1.2, 0.35, 1); foco.position.set(0, 1.34, ZH); g.add(foco);
  const maqueta = new Mockup(); maqueta.grupo.position.set(0, YH, ZH); g.add(maqueta.grupo);
  ctx.sala.anclas.push({ tipo: 'punto', pos: new THREE.Vector3(0, 2.2, ZH + 0.6), intensidad: 2.5, color: new THREE.Color(CYAN), distancia: 5, prioridad: 2 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.45, zB), new THREE.Vector2(1.45, ZH + 1.3)));
  // quien trabaja aquí lo hace de pie junto al estrado, gesticulando hacia la maqueta
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(1.55, 0, ZH + 1.05), giro: -2.25, clip: 'Interact' });
  // la pieza: la maqueta holográfica. Se mueve con las manos (la maqueta da un pulso y el cono se aviva), se alza para
  // verla entera o se toca el proyector
  let pulse = 0; const revive = () => { pulse = 1; };
  for (const [id, x] of [['maqueta', -1.62], ['maqueta-2', 1.62]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(x, 0, ZH + 0.95), giro: Math.atan2(-x, -0.95),
    acciones: [{ clip: 'Ranged_Magic_Spellcasting', onMake: revive }, { clip: 'Interact', onMake: revive }, { clip: 'Ranged_Magic_Raise', onMake: revive }] });
  // ---- columnas de código a los lados del estrado (el refugio, visto como lo que es)
  const rains: Rain[] = [];
  for (const x of [-2.3, 2.3]) {
    const ll = new Rain(v.pantalla, semilla + x * 10); rains.push(ll);
    g.add(caja(1.08, 2.86, 0.12, materialSteel('#141516'), x, 2.0, zB + 0.4));
    for (const y of [0.53, 3.47]) g.add(caja(1.2, 0.08, 0.16, materialSteel('#8a6a2c'), x, y, zB + 0.42));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 2.74), new THREE.MeshStandardMaterial({ map: ll.tex, emissiveMap: ll.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
    p.position.set(x, 2.0, zB + 0.47); g.add(p);
  }
  // ---- núcleo de energía a la izquierda (el generador del refugio: se repara con E)
  const core = await P(R.sf('Props_Pod'), { pos: [-4.45, 0, zB + 1.05], alto: 3.3, estatico: false, own: true }); ctx.aparato('generador', core);
  const liquid = mountLiquid(core, '#5affc8', g);
  P(R.sf('Details_Pipes_Long'), { pos: [-4.45, 3.3, zB + 0.55], alto: 1.1, variant: ctx.vCopper, sombra: false });
  for (const x of [-3.35, -5.55]) P(R.cy('Cable_Thick'), { pos: [x, HEIGHT, zB + 0.65], alto: 1.2, anchor: 'techo', sombra: false });
  const anchor = { tipo: 'punto' as const, pos: new THREE.Vector3(-4.45, 1.6, zB + 2.1), intensidad: 4, color: new THREE.Color('#5affc8'), distancia: 5, prioridad: 2 };
  ctx.sala.anclas.push(anchor);
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-3.4, zB + 2.0)));
  // ---- mesa de planos del Arquitecto (su puesto, de tres cuartos): el plano del refugio, compás, flexo y su monitor con
  // lo que hace; el registro del repo, en la pared
  const pRepo = new PhosphorScreen(512, 320, v.pantalla, ' work-shelter');
  pRepo.speed = 30; pRepo.escribir(['$ git log --oneline -4', 'la planta -1 cambia de manos', 'cámara acorazada', 'puente de mando', '$ _']);
  ctx.aparato('panel', await monitorWall(ctx, 4.35, 2.4, 1.2, pRepo.tex, 1.2));
  ctx.sala.pantallas.push(pRepo);
  const pMap = new PhosphorScreen(384, 256, v.pantalla); pMap.speed = 30; screenReal(ctx, pMap, 'actividad'); ctx.sala.pantallas.push(pMap);
  await workStation(ctx, { id: 'silla', x: 4.25, z: -0.7, giro: -0.8, mesa: R.mueble('table_medium'), deskScale: 0.8, tex: pMap.tex,
    encima: [{ ruta: R.herr('blueprint'), x: -0.3, z: 0.38, c: { ancho: 0.5, rot: 0.12 } }, { ruta: R.herr('drafting_compass'), x: 0.42, z: 0.38, c: { alto: 0.12, rot: 0.8 } }, { ruta: R.mueble('lamp_desk'), x: 0.45, z: -0.32, c: { alto: 0.38, rot: -0.6 } }] });
  // archivo de planos al fondo (cada rollo, en su balda)
  const archivo = P(R.sf('Props_Shelf'), { pos: [5.6, 0, zB + 0.5], alto: 2.0, rot: -Math.PI / 2 });
  ctx.sobre(archivo, R.herr('blueprint_stacked'), { pos: [5.6, 0, zB + 0.5], ancho: 0.42, rot: 0.2 }, { desde: 1.0 });
  ctx.sobre(archivo, R.herr('map_rolled'), { pos: [5.6, 0, zB + 0.42], alto: 0.12, rot: Math.PI / 2 }, { desde: 1.5 });
  ctx.sobre(archivo, R.herr('map_rolled'), { pos: [5.55, 0, zB + 0.62], alto: 0.12, rot: Math.PI / 2 + 0.2 }, { desde: 1.5 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(5.1, zB), new THREE.Vector2(6, zB + 1.0)));
  signInWall(g, cartel(['TODO', 'SALE', 'DE AQUÍ'], 'PUENTE DE MANDO · WORK-SHELTER', '#e6dcc0', '#5e4a1c', 'ojo', semilla), 3.3, 2.85, 0.56, 0.78, zB + 0.33, -0.03);

  const panel = new PanelRoom(); panel.titulo = 'PUENTE'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, 2.2, 1.3, 1.0, semilla); mancha(g, -3.0, 1.1, 0.9, semilla + 4);
  ctx.sala.walkZones = [[-2.9, -2.2], [2.2, 2.9]];
  ctx.vapor = { pos: new THREE.Vector3(-4.45, 3.6, zB + 0.9), dir: new THREE.Vector3(0.25, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(-3.6, 1.2, zB + 1.4);
  ctx.lamparas = [{ x: -4.4, z: 0.6, o: { intensidad: 70, color: '#ffd29a' } }, { x: 0, z: 1.0, o: { intensidad: 70, corta: true, sombra: true, goal: [0, -0.8], color: '#d6f2ff' } }, { x: 4.35, z: 0.55, o: { intensidad: 85, color: '#ffd29a' } }];

  ctx.alActualizar((dt, t, a) => {
    maqueta.actualizar(dt, t);
    for (const ll of rains) ll.actualizar(dt, 0.6 + a * 1.4);
    liquid.uniforms.uTiempo.value = t; liquid.uniforms.uForce.value = 0.55 + 0.25 * Math.sin(t * (1.5 + a * 4));
    anchor.intensidad = 3 + 1.6 * Math.sin(t * (1.5 + a * 4));
    pulse = Math.max(0, pulse - dt * 1.2);
    (cone.material as THREE.MeshBasicMaterial).opacity = 0.045 + Math.sin(t * 9) * 0.008 + pulse * 0.06;
    (foco.material as THREE.SpriteMaterial).opacity = 0.7 + pulse * 0.3;
    maqueta.grupo.scale.setScalar(1 + Math.sin(pulse * Math.PI) * 0.06);
  });
}

// La maqueta holográfica: el refugio entero a escala, con las salas del color de su estado
class Mockup {
  grupo = new THREE.Group();
  private giro = new THREE.Group();
  private cajas: { relleno: THREE.Mesh; borde: THREE.LineSegments; mat: THREE.MeshBasicMaterial; sala?: Sala }[] = [];
  private ascensor: THREE.Mesh; private calle: THREE.Mesh; private punto: THREE.Sprite; private sweep: THREE.Mesh;
  private firma = ''; private escala = 0.03; private cx = 0; private y0 = 0; private alto = 1;
  private geoBox = new THREE.BoxGeometry(1, 1, 1);
  private geoEdge = new THREE.EdgesGeometry(this.geoBox);
  private matEdge = new THREE.LineBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  constructor() {
    this.grupo.add(this.giro); this.grupo.userData.estatico = false;
    const brillo = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ascensor = new THREE.Mesh(this.geoBox, brillo(CYAN, 0.35)); this.giro.add(this.ascensor);
    this.calle = new THREE.Mesh(this.geoBox, brillo('#ffd29a', 0.5)); this.giro.add(this.calle);
    this.punto = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.punto.scale.setScalar(0.16); this.giro.add(this.punto);
    this.sweep = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), brillo(CYAN, 0.12)); this.sweep.rotation.x = -Math.PI / 2; this.giro.add(this.sweep);
  }
  private redo(salas: Sala[]) {
    // el refugio cabe en 2,9 × 1,65 m (lo que manda es lo más largo)
    const xs = salas.flatMap(s => [s.grupo.position.x - s.ancho / 2, s.grupo.position.x + s.ancho / 2]);
    const ys = salas.map(s => s.grupo.position.y);
    const x0 = Math.min(...xs, -6), x1 = Math.max(...xs, 6), y0 = Math.min(...ys), y1 = Math.max(...ys) + HEIGHT;
    this.escala = Math.min(2.9 / (x1 - x0), 1.65 / (y1 - y0 + 1.5)); this.cx = (x0 + x1) / 2; this.y0 = y0; this.alto = (y1 - y0) * this.escala;
    const s = this.escala;
    while (this.cajas.length < salas.length) {
      const mat = new THREE.MeshBasicMaterial({ color: '#5dff8a', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
      const relleno = new THREE.Mesh(this.geoBox, mat); const borde = new THREE.LineSegments(this.geoEdge, this.matEdge);
      this.giro.add(relleno, borde); this.cajas.push({ relleno, borde, mat });
    }
    this.cajas.forEach((c, i) => {
      const sala = salas[i]; c.sala = sala; c.relleno.visible = c.borde.visible = !!sala; if (!sala) return;
      const p = new THREE.Vector3((sala.grupo.position.x - this.cx) * s, (sala.grupo.position.y - y0) * s + HEIGHT * s / 2, 0);
      for (const o of [c.relleno, c.borde]) { o.position.copy(p); o.scale.set(sala.ancho * s * 0.94, HEIGHT * s * 0.86, 0.32); }
    });
    this.ascensor.position.set(-this.cx * s, this.alto / 2, 0); this.ascensor.scale.set(0.035, this.alto, 0.06);
    // la calle, a pie de la planta baja, sale del ascensor hacia la derecha
    this.calle.position.set((x1 / 2 - this.cx) * s, -y0 * s, 0); this.calle.scale.set(x1 * s, 0.012, 0.4);
    this.sweep.scale.set(3.0, 0.45, 1);
  }
  actualizar(dt: number, t: number) {
    const salas = mundo.salas();
    const firma = salas.map(s => s.id + s.grupo.position.x.toFixed(1) + s.grupo.position.y.toFixed(1)).join('|');
    if (firma !== this.firma) { this.firma = firma; this.redo(salas); }
    const actual = mundo.currentRoom();
    for (const c of this.cajas) {
      if (!c.sala) continue;
      const e = c.sala.estado; c.mat.color.set(e === 'sin-sesion' || e === 'ociosa' ? CYAN : COLOR_STATE[e]);
      const late = e === 'esperando' || e === 'error' ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
      c.mat.opacity = (e === 'sin-sesion' ? 0.07 : e === 'ociosa' ? 0.12 : 0.3) + late * 0.3 + (c.sala === actual ? 0.12 : 0);
    }
    const sup = mundo.supervisor();
    if (sup) { this.punto.visible = true; this.punto.position.set((sup.position.x - this.cx) * this.escala, (sup.position.y - this.y0) * this.escala + 0.04, 0.2); this.punto.scale.setScalar(0.13 + Math.sin(t * 5) * 0.03); }
    else this.punto.visible = false;
    this.giro.rotation.y = Math.sin(t * 0.22) * 0.5;
    this.sweep.position.y = ((t * 0.35) % 1) * (this.alto + 0.1);
    this.giro.position.y = Math.sin(t * 1.1) * 0.015;
    this.matEdge.opacity = 0.75 + Math.sin(t * 13) * 0.08;
  }
}

// Columna de lluvia de código: palabras del propio refugio que caen en fósforo
const GLYPHS = 'const sala = await crearSala(); refugio habitante supervisor puente {}[]()<>=;:/*+-|&!? 0123456789 async return';
class Rain {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  private drops: { y: number; v: number }[] = []; private acum = 0; private r: () => number;
  constructor(private color: string, semilla: number) {
    ({ c: this.c, g: this.g } = lienzo(160, 448)); this.tex = textureOf(this.c);
    let x = Math.abs(Math.round(semilla)) || 7; this.r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
    for (let k = 0; k < 30; k++) this.drops.push({ y: this.r() * 448, v: 40 + this.r() * 90 });
    this.g.fillStyle = '#020604'; this.g.fillRect(0, 0, 160, 448);
  }
  actualizar(dt: number, rhythm: number) {
    this.acum += dt; if (this.acum < 1 / 20) return; const paso = this.acum; this.acum = 0;
    const { g } = this;
    g.fillStyle = 'rgba(2,6,4,0.07)'; g.fillRect(0, 0, 160, 448);
    g.font = `600 15px ${SOURCES.mono}`; g.textAlign = 'center';
    this.drops.forEach((d, k) => {
      const y0 = d.y; d.y += d.v * paso * rhythm; if (d.y > 470) { d.y = -10; d.v = 40 + this.r() * 90; }
      for (let y = Math.floor(y0 / 16) * 16; y <= d.y; y += 16) {
        const ch = GLYPHS[Math.floor(this.r() * GLYPHS.length)];
        g.fillStyle = y + 16 > d.y ? '#e8fff0' : this.color; g.globalAlpha = y + 16 > d.y ? 1 : 0.75;
        g.fillText(ch, 8 + (k % 10) * 16, y);
      }
    });
    g.globalAlpha = 1;
    this.tex.needsUpdate = true;
  }
}
