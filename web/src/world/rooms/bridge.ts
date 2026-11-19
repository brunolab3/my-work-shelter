// Puente de Mando (planta -1, derecha): la sala que gobierna el refugio. Su habitante trabaja en el repo del propio
// juego, así que aquí se reescribe el mundo. Pieza protagonista: la maqueta holográfica del refugio en vivo (cada
// sala en su sitio y del color de su estado, el ascensor, la calle y un punto donde está el Supervisor) sobre un
// proyector en un estrado. A los lados, columnas de código que caen; a la izquierda, el núcleo de energía del refugio
// (el generador de siempre), y a la derecha, la mesa de planos del Arquitecto con el registro del repo.
import { t } from '@shared/language';
import * as THREE from 'three';
import { R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, canvas, textureOf, SOURCES } from '../../engine/textures';
import { signInWall, stain, highBand, monitorWall, mountLiquid, materialSteel, box, world, textureHalo, workStation, screenReal, COLOR_STATE, HEIGHT, type Context, type Room } from './common';

const CYAN = '#6ae4ff';

export async function furnishBridge(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { gauge: -2.9, valves: [-3.45, 5.45], segments: [[-4.6, 3.0], [4.6, 2.8]] });
  // ---- estrado, proyector y maqueta
  const ZH = zB + 1.75;
  P(R.sf('Props_Base'), { pos: [0, 0, ZH], width: 2.7 });
  P(R.sf('Props_Teleporter_1'), { pos: [0, 0.34, ZH], width: 1.25 });
  const YH = 1.5;   // base de la maqueta (el proyector acaba a ~1,3 m)
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 0.32, 1.75, 32, 1, true), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.set(0, 1.32 + 0.875, ZH); g.add(cone);
  const focus = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: CYAN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
  focus.scale.set(1.2, 0.35, 1); focus.position.set(0, 1.34, ZH); g.add(focus);
  const mockup = new Mockup(); mockup.group.position.set(0, YH, ZH); g.add(mockup.group);
  ctx.room.anchors.push({ type: 'punto', pos: new THREE.Vector3(0, 2.2, ZH + 0.6), intensity: 2.5, color: new THREE.Color(CYAN), distance: 5, priority: 2 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.45, zB), new THREE.Vector2(1.45, ZH + 1.3)));
  // quien trabaja aquí lo hace de pie junto al estrado, gesticulando hacia la maqueta
  ctx.room.points.push({ id: 'consola', type: 'consola', pos: new THREE.Vector3(1.55, 0, ZH + 1.05), rotation: -2.25, clip: 'Interact' });
  // la pieza: la maqueta holográfica. Se mueve con las manos (la maqueta da un pulso y el cono se aviva), se alza para
  // verla entera o se toca el proyector
  let pulse = 0; const revive = () => { pulse = 1; };
  for (const [id, x] of [['maqueta', -1.62], ['maqueta-2', 1.62]] as const) ctx.room.points.push({ id, type: 'pieza', pos: new THREE.Vector3(x, 0, ZH + 0.95), rotation: Math.atan2(-x, -0.95),
    actions: [{ clip: 'Ranged_Magic_Spellcasting', onMake: revive }, { clip: 'Interact', onMake: revive }, { clip: 'Ranged_Magic_Raise', onMake: revive }] });
  // ---- columnas de código a los lados del estrado (el refugio, visto como lo que es)
  const rains: Rain[] = [];
  for (const x of [-2.3, 2.3]) {
    const ll = new Rain(v.screen, seed + x * 10); rains.push(ll);
    g.add(box(1.08, 2.86, 0.12, materialSteel('#141516'), x, 2.0, zB + 0.4));
    for (const y of [0.53, 3.47]) g.add(box(1.2, 0.08, 0.16, materialSteel('#8a6a2c'), x, y, zB + 0.42));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 2.74), new THREE.MeshStandardMaterial({ map: ll.tex, emissiveMap: ll.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
    p.position.set(x, 2.0, zB + 0.47); g.add(p);
  }
  // ---- núcleo de energía a la izquierda (el generador del refugio: se repara con E)
  const core = await P(R.sf('Props_Pod'), { pos: [-4.45, 0, zB + 1.05], height: 3.3, isStatic: false, own: true }); ctx.device('generador', core);
  const liquid = mountLiquid(core, '#5affc8', g);
  P(R.sf('Details_Pipes_Long'), { pos: [-4.45, 3.3, zB + 0.55], height: 1.1, variant: ctx.vCopper, shadow: false });
  for (const x of [-3.35, -5.55]) P(R.cy('Cable_Thick'), { pos: [x, HEIGHT, zB + 0.65], height: 1.2, anchor: 'techo', shadow: false });
  const anchor = { type: 'punto' as const, pos: new THREE.Vector3(-4.45, 1.6, zB + 2.1), intensity: 4, color: new THREE.Color('#5affc8'), distance: 5, priority: 2 };
  ctx.room.anchors.push(anchor);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-3.4, zB + 2.0)));
  // ---- mesa de planos del Arquitecto (su puesto, de tres cuartos): el plano del refugio, compás, flexo y su monitor con
  // lo que hace; el registro del repo, en la pared
  const pRepo = new PhosphorScreen(512, 320, v.screen, ' work-shelter');
  pRepo.speed = 30; pRepo.write(t('world.bridge.gitLog').split('|'));
  await monitorWall(ctx, 4.35, 2.4, 1.2, pRepo.tex, 1.2);
  ctx.room.screens.push(pRepo);
  const pMap = new PhosphorScreen(384, 256, v.screen); pMap.speed = 30; screenReal(ctx, pMap, 'actividad'); ctx.room.screens.push(pMap);
  await workStation(ctx, { id: 'silla', x: 4.25, z: -0.7, rotation: -0.8, desk: R.furniture('table_medium'), deskScale: 0.8, tex: pMap.tex,
    onTop: [{ path: R.tools('blueprint'), x: -0.3, z: 0.38, c: { width: 0.5, rot: 0.12 } }, { path: R.tools('drafting_compass'), x: 0.42, z: 0.38, c: { height: 0.12, rot: 0.8 } }, { path: R.furniture('lamp_desk'), x: 0.45, z: -0.32, c: { height: 0.38, rot: -0.6 } }] });
  // archivo de planos al fondo (cada rollo, en su balda)
  const file = P(R.sf('Props_Shelf'), { pos: [5.6, 0, zB + 0.5], height: 2.0, rot: -Math.PI / 2 });
  ctx.restsOn(file, R.tools('blueprint_stacked'), { pos: [5.6, 0, zB + 0.5], width: 0.42, rot: 0.2 }, { since: 1.0 });
  ctx.restsOn(file, R.tools('map_rolled'), { pos: [5.6, 0, zB + 0.42], height: 0.12, rot: Math.PI / 2 }, { since: 1.5 });
  ctx.restsOn(file, R.tools('map_rolled'), { pos: [5.55, 0, zB + 0.62], height: 0.12, rot: Math.PI / 2 + 0.2 }, { since: 1.5 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(5.1, zB), new THREE.Vector2(6, zB + 1.0)));
  signInWall(g, sign(t('world.poster.bridge'), t('world.poster.bridgeFoot'), '#e6dcc0', '#5e4a1c', 'ojo', seed), 3.3, 2.85, 0.56, 0.78, zB + 0.33, -0.03);

  const panel = new PanelRoom(); panel.title = 'PUENTE'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 2.2, 1.3, 1.0, seed); stain(g, -3.0, 1.1, 0.9, seed + 4);
  ctx.room.walkZones = [[-2.9, -2.2], [2.2, 2.9]];
  ctx.vapor = { pos: new THREE.Vector3(-4.45, 3.6, zB + 0.9), dir: new THREE.Vector3(0.25, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(-3.6, 1.2, zB + 1.4);
  ctx.lamps = [{ x: -4.4, z: 0.6, o: { intensity: 70, color: '#ffd29a' } }, { x: 0, z: 1.0, o: { intensity: 70, corta: true, shadow: true, goal: [0, -0.8], color: '#d6f2ff' } }, { x: 4.35, z: 0.55, o: { intensity: 85, color: '#ffd29a' } }];

  ctx.onUpdate((dt, t, a) => {
    mockup.update(dt, t);
    for (const ll of rains) ll.update(dt, 0.6 + a * 1.4);
    liquid.uniforms.uTiempo.value = t; liquid.uniforms.uForce.value = 0.55 + 0.25 * Math.sin(t * (1.5 + a * 4));
    anchor.intensity = 3 + 1.6 * Math.sin(t * (1.5 + a * 4));
    pulse = Math.max(0, pulse - dt * 1.2);
    (cone.material as THREE.MeshBasicMaterial).opacity = 0.045 + Math.sin(t * 9) * 0.008 + pulse * 0.06;
    (focus.material as THREE.SpriteMaterial).opacity = 0.7 + pulse * 0.3;
    mockup.group.scale.setScalar(1 + Math.sin(pulse * Math.PI) * 0.06);
  });
}

// La maqueta holográfica: el refugio entero a escala, con las salas del color de su estado
class Mockup {
  group = new THREE.Group();
  private rotation = new THREE.Group();
  private boxes: { filler: THREE.Mesh; edge: THREE.LineSegments; mat: THREE.MeshBasicMaterial; room?: Room }[] = [];
  private elevator: THREE.Mesh; private street: THREE.Mesh; private point: THREE.Sprite; private sweep: THREE.Mesh;
  private signature = ''; private scale = 0.03; private cx = 0; private y0 = 0; private height = 1;
  private geoBox = new THREE.BoxGeometry(1, 1, 1);
  private geoEdge = new THREE.EdgesGeometry(this.geoBox);
  private matEdge = new THREE.LineBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  constructor() {
    this.group.add(this.rotation); this.group.userData.isStatic = false;
    const brightness = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
    this.elevator = new THREE.Mesh(this.geoBox, brightness(CYAN, 0.35)); this.rotation.add(this.elevator);
    this.street = new THREE.Mesh(this.geoBox, brightness('#ffd29a', 0.5)); this.rotation.add(this.street);
    this.point = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.point.scale.setScalar(0.16); this.rotation.add(this.point);
    this.sweep = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), brightness(CYAN, 0.12)); this.sweep.rotation.x = -Math.PI / 2; this.rotation.add(this.sweep);
  }
  private redo(rooms: Room[]) {
    // el refugio cabe en 2,9 × 1,65 m (lo que manda es lo más largo)
    const xs = rooms.flatMap(s => [s.group.position.x - s.width / 2, s.group.position.x + s.width / 2]);
    const ys = rooms.map(s => s.group.position.y);
    const x0 = Math.min(...xs, -6), x1 = Math.max(...xs, 6), y0 = Math.min(...ys), y1 = Math.max(...ys) + HEIGHT;
    this.scale = Math.min(2.9 / (x1 - x0), 1.65 / (y1 - y0 + 1.5)); this.cx = (x0 + x1) / 2; this.y0 = y0; this.height = (y1 - y0) * this.scale;
    const s = this.scale;
    while (this.boxes.length < rooms.length) {
      const mat = new THREE.MeshBasicMaterial({ color: '#5dff8a', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
      const filler = new THREE.Mesh(this.geoBox, mat); const edge = new THREE.LineSegments(this.geoEdge, this.matEdge);
      this.rotation.add(filler, edge); this.boxes.push({ filler, edge, mat });
    }
    this.boxes.forEach((c, i) => {
      const room = rooms[i]; c.room = room; c.filler.visible = c.edge.visible = !!room; if (!room) return;
      const p = new THREE.Vector3((room.group.position.x - this.cx) * s, (room.group.position.y - y0) * s + HEIGHT * s / 2, 0);
      for (const o of [c.filler, c.edge]) { o.position.copy(p); o.scale.set(room.width * s * 0.94, HEIGHT * s * 0.86, 0.32); }
    });
    this.elevator.position.set(-this.cx * s, this.height / 2, 0); this.elevator.scale.set(0.035, this.height, 0.06);
    // la calle, a pie de la planta baja, sale del ascensor hacia la derecha
    this.street.position.set((x1 / 2 - this.cx) * s, -y0 * s, 0); this.street.scale.set(x1 * s, 0.012, 0.4);
    this.sweep.scale.set(3.0, 0.45, 1);
  }
  update(dt: number, t: number) {
    const rooms = world.rooms();
    const signature = rooms.map(s => s.id + s.group.position.x.toFixed(1) + s.group.position.y.toFixed(1)).join('|');
    if (signature !== this.signature) { this.signature = signature; this.redo(rooms); }
    const current = world.currentRoom();
    for (const c of this.boxes) {
      if (!c.room) continue;
      const e = c.room.state; c.mat.color.set(e === 'sin-sesion' || e === 'ociosa' ? CYAN : COLOR_STATE[e]);
      const late = e === 'esperando' || e === 'error' ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
      c.mat.opacity = (e === 'sin-sesion' ? 0.07 : e === 'ociosa' ? 0.12 : 0.3) + late * 0.3 + (c.room === current ? 0.12 : 0);
    }
    const sup = world.supervisor();
    if (sup) { this.point.visible = true; this.point.position.set((sup.position.x - this.cx) * this.scale, (sup.position.y - this.y0) * this.scale + 0.04, 0.2); this.point.scale.setScalar(0.13 + Math.sin(t * 5) * 0.03); }
    else this.point.visible = false;
    this.rotation.rotation.y = Math.sin(t * 0.22) * 0.5;
    this.sweep.position.y = ((t * 0.35) % 1) * (this.height + 0.1);
    this.rotation.position.y = Math.sin(t * 1.1) * 0.015;
    this.matEdge.opacity = 0.75 + Math.sin(t * 13) * 0.08;
  }
}

// Columna de lluvia de código: palabras del propio refugio que caen en fósforo
const GLYPHS = 'const sala = await crearSala(); refugio habitante supervisor puente {}[]()<>=;:/*+-|&!? 0123456789 async return';
class Rain {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  private drops: { y: number; v: number }[] = []; private accum = 0; private r: () => number;
  constructor(private color: string, seed: number) {
    ({ c: this.c, g: this.g } = canvas(160, 448)); this.tex = textureOf(this.c);
    let x = Math.abs(Math.round(seed)) || 7; this.r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; };
    for (let k = 0; k < 30; k++) this.drops.push({ y: this.r() * 448, v: 40 + this.r() * 90 });
    this.g.fillStyle = '#020604'; this.g.fillRect(0, 0, 160, 448);
  }
  update(dt: number, rhythm: number) {
    this.accum += dt; if (this.accum < 1 / 20) return; const step = this.accum; this.accum = 0;
    const { g } = this;
    g.fillStyle = 'rgba(2,6,4,0.07)'; g.fillRect(0, 0, 160, 448);
    g.font = `600 15px ${SOURCES.mono}`; g.textAlign = 'center';
    this.drops.forEach((d, k) => {
      const y0 = d.y; d.y += d.v * step * rhythm; if (d.y > 470) { d.y = -10; d.v = 40 + this.r() * 90; }
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
