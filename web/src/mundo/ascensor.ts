// Ascensor del refugio: hueco con raíles, cables y contrapeso; una cabina que sube y baja de verdad entre plantas,
// con indicador de planta en cada rellano, campanilla y motor. Los personajes viajan dentro.
import * as THREE from 'three';
import { place, R } from '../motor/assets';
import { VARIANTS } from '../motor/paleta';
import { HEIGHT, SLAB, FLOOR, BACKGROUND, FRAME, materialSteel, materialConcrete, caja, lamp, type Sala } from './salas/comun';
import { lienzo, textureOf, SOURCES, sharpCaption } from '../motor/texturas';
import { mergeStatic } from './util3d';
import { SFX, sonido } from '../audio/sonido';
import { floorCaption } from '@shared/disposicion';
import { floorSector } from '@shared/sectores';

export const ELEVATOR_WIDTH = 3.4;

export class Ascensor {
  grupo = new THREE.Group();
  cabina = new THREE.Group();
  currentFloor = 0; destino = 0; private y = 0; private v = 0;
  private queue: number[] = [];
  private waits: { planta: number; f: () => void }[] = [];
  moving = false;
  private indicators: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; planta: number }[] = [];
  anclas: Sala['anclas'] = [];
  constructor(public plantas: number) {}
  private salas: { planta: number; tipo: string; orden: number }[] = [];
  /** el color de sector de cada rellano sale de las salas que tiene (se pueden mover a mano) */
  rotular(salas: { planta: number; tipo: string; orden: number }[]) { this.salas = salas; if (this.indicators?.length) this.paintIndicators(); }

  yOf(planta: number) { return -planta * FLOOR; }

  async construir() {
    const g = this.grupo; g.name = 'ascensor';
    const v = VARIANTS.neutro;
    const alto = this.plantas * FLOOR + 1.5;
    const acero = materialSteel('#2b2a27'), hormigon = materialConcrete();
    // hueco: pared trasera de hormigón, pilares del corte, raíles y cables
    const yTop = HEIGHT + SLAB; const yBot = this.yOf(this.plantas - 1) - SLAB;
    const h = yTop - yBot;
    g.add(caja(ELEVATOR_WIDTH, h, 0.3, hormigon, 0, yBot + h / 2, -BACKGROUND / 2 - 0.2));
    for (const s of [-1, 1]) g.add(caja(FRAME, h, 0.7, acero, s * (ELEVATOR_WIDTH / 2 + FRAME / 2), yBot + h / 2, BACKGROUND / 2 - 0.1));
    const ps: Promise<unknown>[] = [];
    for (let p = 0; p < this.plantas; p++) {
      const y = this.yOf(p);
      for (const s of [-1, 1]) ps.push(place(g, R.cy('Support_Long'), { pos: [s * 1.25, y, -BACKGROUND / 2 + 0.25], alto: FLOOR, sombra: false, variant: v }));
      // rellano: losa con franja y número de planta
      g.add(caja(ELEVATOR_WIDTH + FRAME * 2, SLAB * 0.38, 0.7, acero, 0, y - 0.16 - SLAB * 0.19, BACKGROUND / 2 - 0.1));
      g.add(caja(ELEVATOR_WIDTH + FRAME * 2, SLAB * 0.62, 0.7, acero, 0, y + HEIGHT + SLAB * 0.31, BACKGROUND / 2 - 0.1));
      const ind = this.indicator(p); const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.42), sharpCaption(new THREE.MeshStandardMaterial({ map: ind.tex, emissiveMap: ind.tex, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.6 })));
      m.position.set(0, y + HEIGHT + SLAB * 0.31, BACKGROUND / 2 + 0.26); g.add(m);
      this.indicators.push(ind);
      // suelo del rellano (a cada lado de la cabina se pisa la losa de la planta)
      ps.push(place(g, R.sf('FloorTile_Basic'), { pos: [0, y - 0.05, 0.6], escala: 0.85, sombra: false, variant: v }).then(o => { o.scale.z *= 2.1; }));
    }
    // cables de tracción y contrapeso
    for (const x of [-0.25, 0.25]) g.add(caja(0.03, h, 0.03, acero, x, yBot + h / 2, -0.4));
    // maquinaria arriba (en lo alto de la torre, a pie de calle)
    ps.push(place(g, R.cy('AC_Stacked'), { pos: [-0.9, yTop + 0.05, -1.2], alto: 1.3, variant: v }));
    ps.push(place(g, R.sf('Details_Cylinder_Long'), { pos: [0.4, yTop + 0.3, -1.0], ancho: 1.4, variant: v }));
    await Promise.all(ps);
    mergeStatic(g);
    // cabina
    const c = this.cabina; c.name = 'cabina';
    const vc = VARIANTS.landing;
    const cps: Promise<unknown>[] = [];
    cps.push(place(c, R.sf('Props_Base'), { pos: [0, 0, 0.3], ancho: 2.5, variant: vc }));
    for (const [x, z] of [[-1.15, -1.1], [1.15, -1.1], [-1.15, 1.6], [1.15, 1.6]] as const) cps.push(place(c, R.sf('Column_Slim'), { pos: [x, 0, z], alto: 3.1, variant: vc }));
    c.add(caja(2.6, 0.18, 3.0, materialSteel('#3b3732'), 0, 3.15, 0.25));
    cps.push(place(c, R.cy('Rail_Long'), { pos: [0, 1.0, 1.65], ancho: 2.3, variant: vc }));
    cps.push(place(c, R.casa('Light_Ceiling1'), { pos: [0, 3.06, 0.3], alto: 0.5, anchor: 'techo', sombra: false }));
    await Promise.all(cps);
    // luz interior visible desde lejos: plafón emisivo y resplandor cálido en el fondo de la cabina
    const fixture = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd7a0').multiplyScalar(1.6) }));
    fixture.rotation.x = Math.PI / 2; fixture.position.set(0, 3.04, 0.3); c.add(fixture);
    const fondo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.9), new THREE.MeshBasicMaterial({ color: '#6a4a2a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    fondo.position.set(0, 1.5, -1.25); c.add(fondo);
    c.userData.estatico = false;
    g.add(c);
    this.y = this.yOf(0); c.position.y = this.y;
    this.anclas.push({ tipo: 'foco', pos: new THREE.Vector3(0, 2.9, 0.3), goal: new THREE.Vector3(0, -3, 0.5), intensidad: 70, color: new THREE.Color('#ffd7a0'), angulo: 0.9, penumbra: 0.6, distancia: 7 });
    this.paintIndicators();
  }

  private indicator(p: number) {
    const { c, g } = lienzo(256, 96); const tex = textureOf(c);
    return { g, tex, planta: p };
  }
  // cada rellano rotula SU planta (PB, -1, -2…): verde con la cabina parada ahí; si viaja, una flecha pequeña al lado
  // dice hacia dónde va
  private paintIndicators() {
    for (const ind of this.indicators) {
      const g = ind.g; g.fillStyle = '#16140f'; g.fillRect(0, 0, 256, 96);
      g.strokeStyle = '#4a443b'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 90);
      // a la izquierda, la letra del sector de la planta sobre su color (shared/sectores.ts)
      const sec = floorSector(ind.planta, this.plantas, this.salas);
      g.fillStyle = sec.color; g.fillRect(9, 9, 64, 78);
      g.fillStyle = sec.tinta; g.font = `900 58px ${SOURCES.titulo}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sec.codigo, 41, 52);
      const here = this.currentFloor === ind.planta && !this.moving;
      g.fillStyle = here ? '#5dff8a' : '#ffb000'; g.shadowColor = g.fillStyle; g.shadowBlur = 4;
      g.font = `800 66px ${SOURCES.titulo}`;
      g.fillText(floorCaption(ind.planta), 152, 52);
      if (this.moving) { g.font = `800 30px ${SOURCES.titulo}`; g.fillText(this.destino > this.currentFloor ? '▼' : '▲', 230, 50); }
      g.shadowBlur = 0; ind.tex.needsUpdate = true;
    }
  }

  // Pide la cabina a una planta; `alLlegar` se llama cuando está parada ahí con las puertas abiertas
  llamar(planta: number, onArrive?: () => void) {
    planta = THREE.MathUtils.clamp(planta, 0, this.plantas - 1);
    if (onArrive) this.waits.push({ planta, f: onArrive });
    if (!this.moving && this.currentFloor === planta) { this.attend(); return; }
    if (!this.queue.includes(planta)) this.queue.push(planta);
    if (!this.moving) this.siguiente();
  }

  private siguiente(): void {
    const p = this.queue.shift(); if (p === undefined) return;
    if (p === this.currentFloor) { this.attend(); return this.siguiente(); }
    this.destino = p; this.moving = true; SFX.clank();
    sonido.bucle('ascensor', 'amb_generador', { bus: 'sfx', vol: 0.12, rate: 1.25 });
    this.paintIndicators();
  }

  private attend() {
    const listos = this.waits.filter(e => e.planta === this.currentFloor);
    this.waits = this.waits.filter(e => e.planta !== this.currentFloor);
    for (const e of listos) e.f();
  }

  get yBooth() { return this.cabina.position.y; }

  actualizar(dt: number) {
    if (!this.moving) return;
    const yObj = this.yOf(this.destino);
    const d = yObj - this.y; const dir = Math.sign(d);
    const vMax = 3.2, accel = 3.5;
    const brake = Math.sqrt(2 * accel * Math.abs(d));
    this.v = Math.min(vMax, brake, Math.abs(this.v) + accel * dt) * dir;
    this.y += this.v * dt;
    const pl = Math.round(-this.y / FLOOR); if (pl !== this.currentFloor) { this.currentFloor = THREE.MathUtils.clamp(pl, 0, this.plantas - 1); this.paintIndicators(); }
    if (Math.abs(yObj - this.y) < 0.01 || Math.sign(yObj - this.y) !== dir) {
      this.y = yObj; this.v = 0; this.moving = false; this.currentFloor = this.destino;
      sonido.stopLoop('ascensor'); SFX.elevatorDing(); setTimeout(() => SFX.gateElevator(), 250);
      this.paintIndicators(); this.attend(); setTimeout(() => this.siguiente(), 600);
    }
    this.cabina.position.y = this.y;
  }
}
