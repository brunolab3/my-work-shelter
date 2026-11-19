// Robots ayudantes: cada subagente de una sesión aparece como un robot pequeño en la sala del repo cuyos archivos toca
// (también dentro de worktrees, el servidor resuelve la ruta). Leyendo: hojea un diario; escribiendo: trabaja con la
// llave. Al terminar celebra y se va por el paso lateral; si falla, saltan chispas.
// A helper from a conversation in a task worktree belongs to that worktree's hologram: in light and its task's color,
// at its scale and around its projector (a small cluster, `helperSpots`).
import * as THREE from 'three';
import type { Shelter } from './shelter';
import type { Room } from './rooms/common';
import { Character } from './character';
import { R } from '../engine/assets';
import { live } from '../net/client';
import { SFX } from '../audio/sound';
import type { Helper } from '@shared/protocol';
import { worktreeTask } from '@shared/tasks';
import { pathWorktree, worktreesKnown } from '../ui/copies';
import { knowTasks, versionColors } from '../ui/tasks';
import { holograph, holoTone, holoUniforms, HOLO_SCALE, type Copy, type Uniforms } from './holograms';
import { helperSpots } from './copySpot';

const SCALE = 0.62;   // a helper beside its owner: a main-copy dweller or a hologram
interface Holo { path: string; task?: string; u: Uniforms; versionTone: number }
interface Robot { a: Helper; p: Character; room: Room; sessionId: string; leaving: number; ready: boolean; gap: number; holo?: Holo }

export class Helpers {
  robots = new Map<string, Robot>();
  constructor(private r: Shelter) { live.subscribe(() => this.sync()); }

  private sync() {
    if (!this.r.rooms.length) return;
    const seen = new Set<string>();
    for (const s of Object.values(live.get().sessions)) for (const a of s.helpers ?? []) {
      seen.add(a.id);
      const room = this.r.rooms.find(x => x.id === (a.roomId ?? s.roomId)) ?? this.r.rooms.find(x => x.id === s.roomId);
      if (!room) continue;
      const already = this.robots.get(a.id);
      if (already) { const before = already.a; already.a = { ...a }; if (already.ready) this.apply(already, before); if (already.room !== room && already.ready) this.relocate(already, room); continue; }
      this.create(a, room, s.id, pathWorktree(s.cwd, worktreesKnown()));
    }
    for (const [id, rb] of this.robots) if (!seen.has(id) && !rb.leaving) this.dismiss(rb);
  }

  private async create(a: Helper, room: Room, sessionId: string, path?: string) {
    const gap = this.freeSlot(room, path);
    const p = new Character(gap % 2 ? 'Robot_Two' : 'Robot_One');
    const rb: Robot = { a: { ...a }, p, room, sessionId, leaving: 0, ready: false, gap };
    if (path) { const task = worktreeTask({ path }); knowTasks([task]); rb.holo = { path, task, u: holoUniforms(holoTone(task)), versionTone: versionColors.get().v }; }
    this.robots.set(a.id, rb);
    await p.load();
    p.root.scale.multiplyScalar(SCALE * (rb.holo ? HOLO_SCALE : 1));
    if (rb.holo) { holograph(p.model, rb.holo.u); p.contactShadow.visible = false; }
    p.gait = { walk: 'Walking_C', run: 'Running_A', walkRhythm: 1.9, runRhythm: 1.15 };
    // entra por el paso del lado del ascensor
    const side = room.side === 'izq' ? 1 : -1;
    p.root.position.set(room.group.position.x + side * (room.width / 2 + 0.3), room.group.position.y, 1.4);
    this.r.motor.scene.add(p.root);
    SFX.clank();
    p.goA([this.workstation(rb)], false, () => { rb.ready = true; this.apply(rb); });
  }

  // a hologram's helpers number among themselves (their cluster), the rest among the room's main-copy ones
  private freeSlot(room: Room, path?: string) {
    const cluster = (r?: string) => { const f = r ? this.r.holograms.ofPath(r) : undefined; return f && f.room === room && !f.leaving ? r : undefined; };
    const isMine = cluster(path);
    const busy = [...this.robots.values()].filter(x => x.room === room && !x.leaving && cluster(x.holo?.path) === isMine).map(x => x.gap);
    let gap = 0; while (busy.includes(gap)) gap++;
    return gap;
  }

  // its hologram, when it stands in the helper's room
  private copy(rb: Robot): Copy | undefined {
    const f = rb.holo && this.r.holograms.ofPath(rb.holo.path);
    return f && f.room === rb.room && !f.leaving ? f : undefined;
  }

  // cada robot tiene su sitio en la franja delantera de la sala, sin pisar a los habitantes de los puestos; a
  // hologram's, around its projector
  private workstation(rb: Robot) {
    const s = rb.room, f = this.copy(rb);
    if (f) {
      const cx = s.group.position.x, others = [...this.r.holograms.figures.values()].filter(o => o !== f && o.room === s).map(o => o.spot.x - cx);
      const foreign = [...this.robots.values()].filter(o => o.room === s && !o.leaving && o.holo?.path !== rb.holo!.path && o.p.root.parent).map(o => o.p.root.position.x - cx);
      const spots = helperSpots(f.spot.x - cx, others, s.width, foreign), [dx, dz] = spots[rb.gap % spots.length];
      return new THREE.Vector3(f.spot.x + dx, s.group.position.y, f.spot.z + dz);
    }
    const xs = [-3.2, 3.0, -1.4, 1.6, -4.6, 4.4];
    return new THREE.Vector3(s.group.position.x + xs[rb.gap % xs.length], s.group.position.y, 1.75 - (rb.gap % 2) * 0.2);
  }

  // a prop in its hand; a hologram's, in light too
  private async hold(rb: Robot, spec: Parameters<Character['couple']>[1]) {
    await rb.p.couple('mano', spec);
    const o = rb.p.accessories.get('mano');
    if (rb.holo && o) holograph(o, rb.holo.u);
  }

  private apply(rb: Robot, before?: Helper) {
    const p = rb.p; const a = rb.a;
    const f = this.copy(rb);
    p.goalTurn = f ? (p.root.position.x > f.spot.x ? -0.5 : 0.5) : rb.gap % 2 ? -0.5 : 0.5;   // a hologram's face it
    if (a.state === 'hecho') { if (before?.state !== 'hecho') { p.drop('mano'); p.gesture('Cheering', () => this.dismiss(rb)); SFX.shortSuccess(); } return; }
    if (a.state === 'fallo') { if (before?.state !== 'fallo') { p.drop('mano'); p.gesture('Hit_B', () => this.dismiss(rb)); SFX.error(); if (rb.holo) rb.holo.u.uGlitch.value = 0.6; rb.room.effects?.sparks.burst(p.root.position.clone().sub(rb.room.group.position).add(new THREE.Vector3(0, 0.9, 0)), 16); } return; }
    if (a.mode === 'escribir') {
      if (before?.mode !== 'escribir' || !before) { this.hold(rb, { path: R.tools('wrench_A'), bone: 'handslotr', scale: 0.75 }); }
      p.inRest = 'Working_C'; p.play('Working_C', 0.3);
    } else {
      if (before?.mode !== 'leer' || !before) this.hold(rb, { path: R.tools('journal_open'), bone: 'handslotl', scale: 0.55, rot: [0.2, Math.PI, 0] });
      p.inRest = 'Holding_A'; p.play('Holding_A', 0.3);
    }
  }

  private relocate(rb: Robot, room: Room) {
    // cambia de repo: sale por un lado y aparece en la otra sala
    rb.room = room; rb.ready = false; rb.gap = this.freeSlot(room, rb.holo?.path);
    const side = room.side === 'izq' ? 1 : -1;
    rb.p.root.position.set(room.group.position.x + side * (room.width / 2 + 0.3), room.group.position.y, 1.4);
    rb.p.goA([this.workstation(rb)], false, () => { rb.ready = true; this.apply(rb); });
  }

  private dismiss(rb: Robot) {
    if (rb.leaving) return;
    rb.leaving = 1; rb.p.drop('mano'); rb.p.inRest = 'Idle_A';
    const s = rb.room; const side = s.side === 'izq' ? 1 : -1;
    rb.p.goA([new THREE.Vector3(rb.p.root.position.x, s.group.position.y, 1.5), new THREE.Vector3(s.group.position.x + side * (s.width / 2 + 0.6), s.group.position.y, 1.5)], false, () => {
      this.r.motor.scene.remove(rb.p.root); this.robots.delete(rb.a.id);
    });
  }

  update(dt: number) {
    const v = versionColors.get().v;
    for (const rb of this.robots.values()) {
      // its task's color arrives (or changes) after it entered
      if (rb.holo && rb.holo.versionTone !== v) { rb.holo.versionTone = v; rb.holo.u.uColor.value.copy(holoTone(rb.holo.task)); }
      if (rb.p.mixer) rb.p.update(dt);
    }
  }

  // para las etiquetas: robots a la vista
  labels(farSide: boolean, beside: THREE.Vector3) {
    return [...this.robots.values()].filter(rb => rb.p.mixer && !rb.leaving).map(rb => ({
      k: rb, pos: rb.p.headPoint(), height: 0.05, name: 'ayudante', state: rb.a.state === 'fallo' ? 'error' : rb.a.state === 'hecho' ? 'terminado' : rb.a.mode === 'escribir' ? 'trabajando' : 'pensando',
      detail: rb.p.root.position.distanceTo(beside) < 2.2 ? rb.a.description.slice(0, 48) : '', near: false, farSide,
    }));
  }
}
