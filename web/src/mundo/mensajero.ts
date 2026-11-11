// El robot mensajero: cuando la sala de planificación reparte una tarea o cambia su plan (server/reparto.ts), un robot
// pequeño sale corriendo con los planos bajo el brazo, baja por el hueco del ascensor y entrega una copia en cada sala
// afectada; con una propuesta de cambio hace el viaje al revés, y con una revisión nueva de un PR sale de Control de
// Versiones a la sala que lo trabaja (server/revisionesPR.ts) y se la da en mano al holograma de su worktree (o al
// habitante, si es la copia principal). Solo se ve: el mensaje ya ha llegado por el servidor.
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import type { Copia } from './hologramas';
import { Character } from './personaje';
import { R } from '../motor/assets';
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';

interface Trip { p: Character }

export class Messengers {
  private trips = new Set<Trip>();
  constructor(private r: Refugio) {
    cliente.escuchar(m => { if (m.t === 'mensajero') this.salir(m.desde, m.a, m.worktree).catch(() => {}); });
  }

  private sala(id: string) { return this.r.salas.find(s => s.id === id); }
  // la puerta del lado del ascensor y el rellano frente al hueco, en la planta de una sala
  private puerta(s: Sala) { const lado = s.lado === 'izq' ? 1 : -1; return new THREE.Vector3(s.grupo.position.x + lado * (s.ancho / 2 + 0.3), s.grupo.position.y, 1.5); }
  private hueco(s: Sala) { return new THREE.Vector3(0, s.grupo.position.y, 1.5); }
  private correr(p: Character, puntos: THREE.Vector3[]) { return new Promise<void>(ok => p.goA(puntos, true, ok)); }
  private gesture(p: Character, clip: string) { return new Promise<void>(ok => p.gesture(clip, () => { p.reproducir('Idle_A'); ok(); })); }

  async salir(desde: string, a: string[], worktree?: string) {
    const origen = this.sala(desde);
    const targets = a.map(id => this.sala(id)).filter((s): s is Sala => !!s && s !== origen);
    if (!origen || !targets.length) return;
    const p = new Character('Robot_Two');
    const v: Trip = { p };
    this.trips.add(v);
    await p.cargar();
    p.raiz.scale.multiplyScalar(0.55);
    p.marcha = { andar: 'Walking_C', correr: 'Running_A', walkRhythm: 1.9, runRhythm: 1.2 };
    p.couple('mano', { ruta: R.herr('blueprint_stacked'), bone: 'handslotl', escala: 0.5, rot: [0.3, Math.PI, 0] });
    // recoge los planos en el centro de la sala de planificación
    p.raiz.position.set(origen.grupo.position.x, origen.grupo.position.y, 1.6);
    this.r.motor.scene.add(p.raiz);
    SFX.clank();
    await this.gesture(p, 'PickUp');
    let here = origen;
    for (const s of targets) {
      await this.correr(p, [this.puerta(here), this.hueco(here)]);
      // por el hueco del ascensor, a la planta de la siguiente sala
      if (s.grupo.position.y !== here.grupo.position.y) { p.raiz.position.copy(this.hueco(s)); }
      await this.correr(p, [this.puerta(s)]);
      const receptor = worktree ? this.receptor(s, worktree) : undefined;
      if (receptor) await this.approach(p, s, receptor.raiz);
      else { await this.correr(p, [new THREE.Vector3(s.grupo.position.x, s.grupo.position.y, 1.6)]); p.goalTurn = 0; }
      SFX.shortSuccess();
      if (receptor?.copia) this.r.hologramas.receive(receptor.copia, p.raiz.position);
      await this.gesture(p, 'Interact');
      here = s;
    }
    p.soltar('mano');
    await this.correr(p, [this.puerta(here), this.hueco(here)]);
    this.r.motor.scene.remove(p.raiz);
    this.trips.delete(v);
  }

  // quién recibe una revisión en la sala: el holograma de su worktree o, en la copia principal, el habitante
  private receptor(s: Sala, worktree: string): { raiz: THREE.Object3D; copia?: Copia } | undefined {
    const copia = this.r.hologramas.ofPath(worktree);
    if (copia && copia.sala === s && copia.listo && !copia.leaving) return { raiz: copia.p.raiz, copia };
    const h = this.r.habitantes.find(x => x.sala === s && Math.abs(x.pos.y - s.grupo.position.y) < 1 && Math.abs(x.pos.x - s.grupo.position.x) < s.ancho / 2);
    return h ? { raiz: h.p.raiz } : undefined;
  }
  // hasta ponerse a su lado, mirándole; si se ha movido mientras tanto (de paseo), lo vuelve a buscar
  private async approach(p: Character, s: Sala, raiz: THREE.Object3D) {
    const sx = s.grupo.position.x, med = s.ancho / 2 - 0.5;
    for (let k = 0; k < 3; k++) {
      const o = raiz.position, lado = Math.sign(p.raiz.position.x - o.x) || 1;
      await this.correr(p, [new THREE.Vector3(THREE.MathUtils.clamp(o.x + lado * 0.7, sx - med, sx + med), s.grupo.position.y, THREE.MathUtils.clamp(o.z + 0.1, 0.9, 1.8))]);
      if (Math.hypot(raiz.position.x - p.raiz.position.x, raiz.position.z - p.raiz.position.z) < 1.1) break;
    }
    p.goalTurn = Math.atan2(raiz.position.x - p.raiz.position.x, raiz.position.z - p.raiz.position.z);
  }

  actualizar(dt: number) { for (const v of this.trips) if (v.p.mixer) v.p.actualizar(dt); }
}
