// Robots ayudantes: cada subagente de una sesión aparece como un robot pequeño en la sala del repo cuyos archivos toca
// (también dentro de worktrees, el servidor resuelve la ruta). Leyendo: hojea un diario; escribiendo: trabaja con la
// llave. Al terminar celebra y se va por el paso lateral; si falla, saltan chispas.
// A helper from a conversation in a task worktree belongs to that worktree's hologram: in light and its task's color,
// at its scale and around its projector (a small cluster, `helperSpots`).
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import { Character } from './personaje';
import { R } from '../motor/assets';
import { vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';
import type { Helper } from '@shared/protocolo';
import { worktreeTask } from '@shared/tareas';
import { pathWorktree, worktreesKnown } from '../ui/copias';
import { knowTasks, versionColors } from '../ui/tareas';
import { holograph, holoTone, holoUniforms, HOLO_SCALE, type Copia, type Uniforms } from './hologramas';
import { helperSpots } from './sitioCopia';

const SCALE = 0.62;   // a helper beside its owner: a main-copy dweller or a hologram
interface Holo { ruta: string; tarea?: string; u: Uniforms; versionTone: number }
interface Robot { a: Helper; p: Character; sala: Sala; sesionId: string; leaving: number; listo: boolean; hueco: number; holo?: Holo }

export class Helpers {
  robots = new Map<string, Robot>();
  constructor(private r: Refugio) { vivo.subscribe(() => this.sincronizar()); }

  private sincronizar() {
    if (!this.r.salas.length) return;
    const seen = new Set<string>();
    for (const s of Object.values(vivo.get().sesiones)) for (const a of s.ayudantes ?? []) {
      seen.add(a.id);
      const sala = this.r.salas.find(x => x.id === (a.salaId ?? s.salaId)) ?? this.r.salas.find(x => x.id === s.salaId);
      if (!sala) continue;
      const ya = this.robots.get(a.id);
      if (ya) { const antes = ya.a; ya.a = { ...a }; if (ya.listo) this.aplicar(ya, antes); if (ya.sala !== sala && ya.listo) this.mudar(ya, sala); continue; }
      this.crear(a, sala, s.id, pathWorktree(s.cwd, worktreesKnown()));
    }
    for (const [id, rb] of this.robots) if (!seen.has(id) && !rb.leaving) this.dismiss(rb);
  }

  private async crear(a: Helper, sala: Sala, sesionId: string, ruta?: string) {
    const hueco = this.freeSlot(sala, ruta);
    const p = new Character(hueco % 2 ? 'Robot_Two' : 'Robot_One');
    const rb: Robot = { a: { ...a }, p, sala, sesionId, leaving: 0, listo: false, hueco };
    if (ruta) { const tarea = worktreeTask({ ruta }); knowTasks([tarea]); rb.holo = { ruta, tarea, u: holoUniforms(holoTone(tarea)), versionTone: versionColors.get().v }; }
    this.robots.set(a.id, rb);
    await p.cargar();
    p.raiz.scale.multiplyScalar(SCALE * (rb.holo ? HOLO_SCALE : 1));
    if (rb.holo) { holograph(p.modelo, rb.holo.u); p.contactShadow.visible = false; }
    p.marcha = { andar: 'Walking_C', correr: 'Running_A', walkRhythm: 1.9, runRhythm: 1.15 };
    // entra por el paso del lado del ascensor
    const lado = sala.lado === 'izq' ? 1 : -1;
    p.raiz.position.set(sala.grupo.position.x + lado * (sala.ancho / 2 + 0.3), sala.grupo.position.y, 1.4);
    this.r.motor.scene.add(p.raiz);
    SFX.clank();
    p.goA([this.puesto(rb)], false, () => { rb.listo = true; this.aplicar(rb); });
  }

  // a hologram's helpers number among themselves (their cluster), the rest among the room's main-copy ones
  private freeSlot(sala: Sala, ruta?: string) {
    const cluster = (r?: string) => { const f = r ? this.r.hologramas.ofPath(r) : undefined; return f && f.sala === sala && !f.leaving ? r : undefined; };
    const mio = cluster(ruta);
    const ocupados = [...this.robots.values()].filter(x => x.sala === sala && !x.leaving && cluster(x.holo?.ruta) === mio).map(x => x.hueco);
    let hueco = 0; while (ocupados.includes(hueco)) hueco++;
    return hueco;
  }

  // its hologram, when it stands in the helper's room
  private copy(rb: Robot): Copia | undefined {
    const f = rb.holo && this.r.hologramas.ofPath(rb.holo.ruta);
    return f && f.sala === rb.sala && !f.leaving ? f : undefined;
  }

  // cada robot tiene su sitio en la franja delantera de la sala, sin pisar a los habitantes de los puestos; a
  // hologram's, around its projector
  private puesto(rb: Robot) {
    const s = rb.sala, f = this.copy(rb);
    if (f) {
      const cx = s.grupo.position.x, otros = [...this.r.hologramas.figuras.values()].filter(o => o !== f && o.sala === s).map(o => o.sitio.x - cx);
      const ajenos = [...this.robots.values()].filter(o => o.sala === s && !o.leaving && o.holo?.ruta !== rb.holo!.ruta && o.p.raiz.parent).map(o => o.p.raiz.position.x - cx);
      const spots = helperSpots(f.sitio.x - cx, otros, s.ancho, ajenos), [dx, dz] = spots[rb.hueco % spots.length];
      return new THREE.Vector3(f.sitio.x + dx, s.grupo.position.y, f.sitio.z + dz);
    }
    const xs = [-3.2, 3.0, -1.4, 1.6, -4.6, 4.4];
    return new THREE.Vector3(s.grupo.position.x + xs[rb.hueco % xs.length], s.grupo.position.y, 1.75 - (rb.hueco % 2) * 0.2);
  }

  // a prop in its hand; a hologram's, in light too
  private async hold(rb: Robot, spec: Parameters<Character['couple']>[1]) {
    await rb.p.couple('mano', spec);
    const o = rb.p.accesorios.get('mano');
    if (rb.holo && o) holograph(o, rb.holo.u);
  }

  private aplicar(rb: Robot, antes?: Helper) {
    const p = rb.p; const a = rb.a;
    const f = this.copy(rb);
    p.goalTurn = f ? (p.raiz.position.x > f.sitio.x ? -0.5 : 0.5) : rb.hueco % 2 ? -0.5 : 0.5;   // a hologram's face it
    if (a.estado === 'hecho') { if (antes?.estado !== 'hecho') { p.soltar('mano'); p.gesture('Cheering', () => this.dismiss(rb)); SFX.shortSuccess(); } return; }
    if (a.estado === 'fallo') { if (antes?.estado !== 'fallo') { p.soltar('mano'); p.gesture('Hit_B', () => this.dismiss(rb)); SFX.error(); if (rb.holo) rb.holo.u.uGlitch.value = 0.6; rb.sala.efectos?.sparks.burst(p.raiz.position.clone().sub(rb.sala.grupo.position).add(new THREE.Vector3(0, 0.9, 0)), 16); } return; }
    if (a.modo === 'escribir') {
      if (antes?.modo !== 'escribir' || !antes) { this.hold(rb, { ruta: R.herr('wrench_A'), bone: 'handslotr', escala: 0.75 }); }
      p.inRest = 'Working_C'; p.reproducir('Working_C', 0.3);
    } else {
      if (antes?.modo !== 'leer' || !antes) this.hold(rb, { ruta: R.herr('journal_open'), bone: 'handslotl', escala: 0.55, rot: [0.2, Math.PI, 0] });
      p.inRest = 'Holding_A'; p.reproducir('Holding_A', 0.3);
    }
  }

  private mudar(rb: Robot, sala: Sala) {
    // cambia de repo: sale por un lado y aparece en la otra sala
    rb.sala = sala; rb.listo = false; rb.hueco = this.freeSlot(sala, rb.holo?.ruta);
    const lado = sala.lado === 'izq' ? 1 : -1;
    rb.p.raiz.position.set(sala.grupo.position.x + lado * (sala.ancho / 2 + 0.3), sala.grupo.position.y, 1.4);
    rb.p.goA([this.puesto(rb)], false, () => { rb.listo = true; this.aplicar(rb); });
  }

  private dismiss(rb: Robot) {
    if (rb.leaving) return;
    rb.leaving = 1; rb.p.soltar('mano'); rb.p.inRest = 'Idle_A';
    const s = rb.sala; const lado = s.lado === 'izq' ? 1 : -1;
    rb.p.goA([new THREE.Vector3(rb.p.raiz.position.x, s.grupo.position.y, 1.5), new THREE.Vector3(s.grupo.position.x + lado * (s.ancho / 2 + 0.6), s.grupo.position.y, 1.5)], false, () => {
      this.r.motor.scene.remove(rb.p.raiz); this.robots.delete(rb.a.id);
    });
  }

  actualizar(dt: number) {
    const v = versionColors.get().v;
    for (const rb of this.robots.values()) {
      // its task's color arrives (or changes) after it entered
      if (rb.holo && rb.holo.versionTone !== v) { rb.holo.versionTone = v; rb.holo.u.uColor.value.copy(holoTone(rb.holo.tarea)); }
      if (rb.p.mixer) rb.p.actualizar(dt);
    }
  }

  // para las etiquetas: robots a la vista
  etiquetas(lejos: boolean, junto: THREE.Vector3) {
    return [...this.robots.values()].filter(rb => rb.p.mixer && !rb.leaving).map(rb => ({
      k: rb, pos: rb.p.headPoint(), alto: 0.05, nombre: 'ayudante', estado: rb.a.estado === 'fallo' ? 'error' : rb.a.estado === 'hecho' ? 'terminado' : rb.a.modo === 'escribir' ? 'trabajando' : 'pensando',
      detalle: rb.p.raiz.position.distanceTo(junto) < 2.2 ? rb.a.descripcion.slice(0, 48) : '', cerca: false, lejos,
    }));
  }
}
