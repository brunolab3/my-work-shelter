// El robot mensajero: cuando la sala de planificación reparte una tarea o cambia su plan (server/dispatch.ts), un robot
// pequeño sale corriendo con los planos bajo el brazo, baja por el hueco del ascensor y entrega una copia en cada sala
// afectada; con una propuesta de cambio hace el viaje al revés, y con una revisión nueva de un PR sale de Control de
// Versiones a la sala que lo trabaja (server/prReviews.ts) y se la da en mano al holograma de su worktree (o al
// habitante, si es la copia principal). Dentro de una misma sala el habitante va hasta el holograma de la tarea y se lo
// da en mano (send_to_room a la propia sala, server/roomNotices.ts); if he can't (talking with the Overseer, waiting),
// the robot carries it across the room instead. Solo se ve: el mensaje ya ha llegado por el servidor.
import * as THREE from 'three';
import type { Shelter } from './shelter';
import type { Room } from './rooms/common';
import type { Copy } from './holograms';
import { Character } from './character';
import { R } from '../engine/assets';
import { client } from '../net/client';
import { SFX } from '../audio/sound';

interface Trip { p: Character }

export class Messengers {
  private trips = new Set<Trip>();
  constructor(private r: Shelter) {
    client.listen(m => {
      if (m.t === 'mensajero') this.exit(m.since, m.a, m.worktree).catch(() => {});
      else if (m.t === 'entrega') this.delivered(m.room, m.worktree, m.sessionId).catch(() => {});
    });
  }

  private room(id: string) { return this.r.rooms.find(s => s.id === id); }
  // la puerta del lado del ascensor y el rellano frente al hueco, en la planta de una sala
  private puerta(s: Room) { const side = s.side === 'izq' ? 1 : -1; return new THREE.Vector3(s.group.position.x + side * (s.width / 2 + 0.3), s.group.position.y, 1.5); }
  private gap(s: Room) { return new THREE.Vector3(0, s.group.position.y, 1.5); }
  private run(p: Character, points: THREE.Vector3[]) { return new Promise<void>(ok => p.goA(points, true, ok)); }
  private gesture(p: Character, clip: string) { return new Promise<void>(ok => p.gesture(clip, () => { p.play('Idle_A'); ok(); })); }

  async exit(since: string, a: string[], worktree?: string) {
    const origin = this.room(since);
    const targets = a.map(id => this.room(id)).filter((s): s is Room => !!s && s !== origin);
    if (!origin || !targets.length) return;
    // recoge los planos en el centro de la sala de planificación
    const { p, v } = await this.robot(new THREE.Vector3(origin.group.position.x, origin.group.position.y, 1.6));
    let here = origin;
    for (const s of targets) {
      await this.run(p, [this.puerta(here), this.gap(here)]);
      // por el hueco del ascensor, a la planta de la siguiente sala
      if (s.group.position.y !== here.group.position.y) { p.root.position.copy(this.gap(s)); }
      await this.run(p, [this.puerta(s)]);
      const receptor = worktree ? this.receptor(s, worktree) : undefined;
      if (receptor) await this.approach(p, s, receptor.root);
      else { await this.run(p, [new THREE.Vector3(s.group.position.x, s.group.position.y, 1.6)]); p.goalTurn = 0; }
      SFX.shortSuccess();
      if (receptor?.copy) this.r.holograms.receive(receptor.copy, p.root.position);
      await this.gesture(p, 'Interact');
      here = s;
    }
    await this.leave(p, v, here);
  }

  // the small robot with the plans under its arm, picking them up at `at`
  private async robot(at: THREE.Vector3) {
    const p = new Character('Robot_Two');
    const v: Trip = { p };
    this.trips.add(v);
    await p.load();
    p.root.scale.multiplyScalar(0.55);
    p.gait = { walk: 'Walking_C', run: 'Running_A', walkRhythm: 1.9, runRhythm: 1.2 };
    p.couple('mano', { path: R.tools('blueprint_stacked'), bone: 'handslotl', scale: 0.5, rot: [0.3, Math.PI, 0] });
    p.root.position.copy(at);
    this.r.motor.scene.add(p.root);
    SFX.clank();
    await this.gesture(p, 'PickUp');
    return { p, v };
  }
  private async leave(p: Character, v: Trip, here: Room) {
    p.drop('mano');
    await this.run(p, [this.puerta(here), this.gap(here)]);
    this.r.motor.scene.remove(p.root);
    this.trips.delete(v);
  }

  /** Un mensaje dentro de la misma sala: el habitante deja lo que hace, va hasta el holograma de la conversación que lo
   *  recibe (si es nueva, espera a que su copia aparezca) y se lo da; el holograma lo recoge. With the dweller busy
   *  (talking with the Overseer, as when he sends it mid-conversation, or waiting), the robot takes it from beside him
   *  to the hologram. Sin holograma (copia principal) no se ve nada más que el aviso */
  async delivered(roomId: string, worktree?: string, sessionId?: string) {
    const s = this.room(roomId); if (!s) return;
    let copy: Copy | undefined;
    for (let k = 0; k < 40 && !copy; k++) {
      const f = (sessionId && this.r.holograms.ofSession(sessionId)) || (worktree && this.r.holograms.ofPath(worktree)) || undefined;
      if (f && f.room === s && f.ready && !f.leaving) copy = f;
      else await new Promise(ok => setTimeout(ok, 500));
    }
    if (!copy) return;
    const h = this.r.dwellers.find(x => x.room === s), c = copy;
    if (h) {
      const o = copy.p.root.position, sx = s.group.position.x, measured = s.width / 2 - 0.5, side = Math.sign(h.pos.x - o.x) || 1;
      const beside = new THREE.Vector3(THREE.MathUtils.clamp(o.x + side * 0.75, sx - measured, sx + measured), s.group.position.y, THREE.MathUtils.clamp(o.z + 0.1, 0.9, 1.8));
      if (h.sendOnErrand(beside, Math.atan2(o.x - beside.x, o.z - beside.z), 'Interact', '', 1.2, () => this.r.holograms.receive(c, h.pos))) return;
    }
    const sx = s.group.position.x, measured = s.width / 2 - 0.5, since = h && Math.abs(h.pos.y - s.group.position.y) < 1 ? h.pos : s.group.position;
    const { p, v } = await this.robot(new THREE.Vector3(THREE.MathUtils.clamp(since.x + 0.6, sx - measured, sx + measured), s.group.position.y, 1.6));
    await this.approach(p, s, c.p.root);
    SFX.shortSuccess();
    if (c.ready && !c.leaving) this.r.holograms.receive(c, p.root.position);
    await this.gesture(p, 'Interact');
    await this.leave(p, v, s);
  }

  // quién recibe una revisión en la sala: el holograma de su worktree o, en la copia principal, el habitante
  private receptor(s: Room, worktree: string): { root: THREE.Object3D; copy?: Copy } | undefined {
    const copy = this.r.holograms.ofPath(worktree);
    if (copy && copy.room === s && copy.ready && !copy.leaving) return { root: copy.p.root, copy };
    const h = this.r.dwellers.find(x => x.room === s && Math.abs(x.pos.y - s.group.position.y) < 1 && Math.abs(x.pos.x - s.group.position.x) < s.width / 2);
    return h ? { root: h.p.root } : undefined;
  }
  // hasta ponerse a su lado, mirándole; si se ha movido mientras tanto (de paseo), lo vuelve a buscar
  private async approach(p: Character, s: Room, root: THREE.Object3D) {
    const sx = s.group.position.x, measured = s.width / 2 - 0.5;
    for (let k = 0; k < 3; k++) {
      const o = root.position, side = Math.sign(p.root.position.x - o.x) || 1;
      await this.run(p, [new THREE.Vector3(THREE.MathUtils.clamp(o.x + side * 0.7, sx - measured, sx + measured), s.group.position.y, THREE.MathUtils.clamp(o.z + 0.1, 0.9, 1.8))]);
      if (Math.hypot(root.position.x - p.root.position.x, root.position.z - p.root.position.z) < 1.1) break;
    }
    p.goalTurn = Math.atan2(root.position.x - p.root.position.x, root.position.z - p.root.position.z);
  }

  update(dt: number) { for (const v of this.trips) if (v.p.mixer) v.p.update(dt); }
}
