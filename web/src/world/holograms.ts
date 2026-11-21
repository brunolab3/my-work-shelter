// Worktrees as holographic copies: each worktree of a repo is a hologram of the dweller who created it (their rehearsal
// clone), standing on its projector on the room's front edge, flush with the lip: in front of everything and taking no
// floor (in a free slot along the width, never in front of where dwellers stand, so as not to hide them), with its own
// holographic computer. It never uses the original's spots (console, chair, bed) or leaves its projector: thinking or
// working, standing, it handles screens in the air nonstop; waiting, it jumps and waves until you answer; finished, it
// waits for you waving now and then until you read it; fault, it glitches; with nothing to do, sitting on its projector
// and dim (it looks at you if you come close and stands up to talk to you). The projector's light disc, in its task's
// color, pulses while it works. When created, the projector comes down a tube from the ceiling, its author goes to
// mount it with the wrench and the copy materializes on top; when discarded it fades away.
// Each copy is a talker of its own, like a clone: with E (or a click) you talk to it on its intercom, which is not its
// author's (ui/copies.ts); whatever is worked on inside the worktree lives in it.
import * as THREE from 'three';
import type { Shelter } from './shelter';
import { BACKGROUND, type Room } from './rooms/common';
import { Dweller } from './dweller';
import { callOut, type Character } from './character';
import { gltf, measure, place, R } from '../engine/assets';
import { audioWorld } from '../audio/world';
import { live } from '../net/client';
import { scheduledMark, queuedMark, flaggedMark } from './labels';
import { SFX } from '../audio/sound';
import { SHOP } from '@shared/catalog';
import { t, tIs } from '@shared/language';
import type { InfoWorktree, SessionSummary } from '@shared/protocol';
import { taskColor, hasTaskColor, worktreeTask, NO_TASK_COLOR } from '@shared/tasks';
import { jiraBoard, knowTasks, taskEpic, verificationMark, versionColors } from '../ui/tasks';
import type { DwellerState, DwellerSummary } from '../ui/gameState';
import { idCopy, branchCaption, copyCaption, pathWorktree } from '../ui/copies';
import { holoSlot } from './copySpot';

const MAX_BY_ROOM = 30;   // alto a propósito: son intangibles, si no caben se solapan sin estorbar
const COLOR = new THREE.Color(NO_TASK_COLOR), COLOR_FAULT = new THREE.Color('#ff6a4a');
const BASE = 0.8;         // projector width: fits the grated walkway strip, between the floor plates and the striped edge
const BASE_HEIGHT = 0.08; // projector height: low, so walking past it doesn't look like going through it
const Z_SPOT = BACKGROUND / 2 - BASE / 2;   // on the room's front edge: the projector reaches the lip
export const HOLO_SCALE = 0.6;   // smaller than their author, so they don't cover the faces of whoever stands nearby
const CEILING = 3.5;        // de dónde baja el tubo que trae el proyector (sobre el suelo de la sala)
const timeout = { value: 0 };

// ---------------------------------------------------------------- material: el personaje, en luz
const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
varying vec3 vPosW; varying vec3 vNorW; varying vec2 vUvH;
void main() {
  vUvH = uv;
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 w = modelMatrix * vec4(transformed, 1.0);
  vPosW = w.xyz;
  vNorW = normalize(mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
uniform vec3 uColor; uniform sampler2D uMapa; uniform float uConMapa, uTiempo, uOpacity, uCut, uGlitch, uSemilla, uLines;
varying vec3 vPosW; varying vec3 vNorW; varying vec2 vUvH;
float azar(float x) { return fract(sin(x) * 43758.5453); }
void main() {
  if (vPosW.y > uCut) discard;
  // la textura del habitante, en luminancia: se le reconoce la cara y la ropa
  float lum = uConMapa > 0.5 ? dot(texture2D(uMapa, vUvH).rgb, vec3(0.299, 0.587, 0.114)) : 0.5;
  vec3 v = normalize(cameraPosition - vPosW);
  float fres = pow(1.0 - abs(dot(normalize(vNorW), v)), 2.0);
  float lineas = 0.7 + 0.3 * sin(vPosW.y * uLines - uTiempo * 5.0);
  float barrido = smoothstep(0.93, 1.0, fract(vPosW.y * 0.5 - uTiempo * 0.32 + uSemilla));
  float borde = smoothstep(0.07, 0.0, uCut - vPosW.y);
  // parpadeo: casi nunca en reposo, a tirones con avería
  float t = floor(uTiempo * 18.0 + uSemilla * 50.0);
  float corte = step(1.0 - 0.015 - uGlitch * 0.45, azar(t + floor(vPosW.y * 9.0)));
  float a = ((0.42 + 0.3 * lum + 0.45 * fres) * lineas + barrido * 0.2) * uOpacity * (1.0 - corte * 0.85) + borde;
  float l = pow(lum, 1.6);   // con contraste: el parche, las cejas y la ropa oscura se siguen leyendo
  vec3 c = uColor * (0.04 + 1.5 * l) * (0.8 + 0.2 * lineas) + uColor * fres * 0.8 + uColor * barrido * 0.3 + vec3(0.7, 1.0, 1.0) * borde * 2.0;
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

export interface Uniforms { uColor: { value: THREE.Color }; uTiempo: typeof timeout; uOpacity: { value: number }; uCut: { value: number }; uGlitch: { value: number }; uSemilla: { value: number } }

/** A hologram's uniforms: its time is the shared clock `Holograms.actualizar` ticks. */
export const holoUniforms = (color: THREE.Color): Uniforms => ({ uColor: { value: color.clone() }, uTiempo: timeout, uOpacity: { value: 1 }, uCut: { value: 1e4 }, uGlitch: { value: 0 }, uSemilla: { value: Math.random() } });
/** A task's hologram color: its task color or, without one, the stock cyan. */
// the epic mark on a copy's tag: its color and its tooltip
const epicTag = (task: string | undefined) => { const e = taskEpic(task); return e ? { color: taskColor(e.key), title: t('windows.epicOf', { clave: e.key, titulo: e.title }) } : undefined; };
export const holoTone = (task: string | undefined) => hasTaskColor(task) ? new THREE.Color(taskColor(task)) : COLOR;

/** Turns `o` (a character, a prop) into light with these uniforms; props coupled later need their own call. */
export function holograph(o: THREE.Object3D, u: Uniforms) {
  const cache = new Map<THREE.Texture | null, THREE.ShaderMaterial>();
  const material = (map: THREE.Texture | null) => {
    let m = cache.get(map);
    if (!m) {
      m = new THREE.ShaderMaterial({ uniforms: { ...u, uMapa: { value: map }, uConMapa: { value: map ? 1 : 0 }, uLines: { value: 150 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true });
      cache.set(map, m);
    }
    return m;
  };
  o.traverse((n: any) => {
    if (!n.isMesh) return;
    const ms = ([] as any[]).concat(n.material).map(m => material(m?.map ?? null));
    n.material = ms.length === 1 ? ms[0] : ms;
    n.castShadow = false; n.receiveShadow = false; n.renderOrder = 3;
  });
}

// ---------------------------------------------------------------- qué worktrees hay y quién trabaja dentro
// siempre en su proyector: sentado con el portátil (pensando o en reposo con avería), con las pantallas en el aire
// (trabajando), de pie y quieto (sin nada que hacer) o de pie mirando al frente (te espera, terminó, habla contigo)
type Pose = 'reposo' | 'portatil' | 'manos' | 'pie' | 'base';
const IN_PROJECTOR = new Set<Pose>(['reposo', 'portatil', 'manos', 'base']);
const SEATED_POSES = new Set<Pose | ''>(['reposo', 'portatil', 'base']);   // sentada en el proyector (sin nada que hacer, en 'base')
const WALKING = /^(Walking|Running)/;
// trabajando no para: de un gesto a otro con las pantallas
const BUSY = ['Ranged_Magic_Spellcasting_Long', 'Working_A', 'Ranged_Magic_Spellcasting', 'Working_C', 'Working_B', 'Interact'];
export interface Copy {
  path: string; w: InfoWorktree; room: Room; authorId: string;
  p: Character; u: Uniforms; base: THREE.Object3D | null; laptop: THREE.Group; screens: THREE.Group;
  spot: THREE.Vector3; rotation: number;
  state: DwellerState; detail: string; sessionId?: string; signature: string;
  pose: Pose | ''; fromPose: number; poseWanted: Pose; gestureClock: number; waitingSince: number;
  opacity: number; goalCut: number; leaving: boolean; ready: boolean;
  lookClock: number; busyClock: number;
  assembly: Assembly | null;   // el proyector bajando por su tubo y su autor montándolo (recién creada)
  talking: boolean; chatTurn: number;   // en una charla con el Supervisor: de pie y mirándole
  task?: string; tone: THREE.Color; versionTone?: number;         // la tarea del worktree y su color (shared/tasks.ts); sin tarea, el cian de serie
}

interface Assembly { tube: THREE.Object3D; t: number; phase: 'baja' | 'cae' | 'sube' | 'listo'; mounted: boolean; end: number }

export class Holograms {
  figures = new Map<string, Copy>();
  private since = performance.now();
  constructor(private r: Shelter) {
    // a copy's name carries its task's title once the Jira board has read it
    let tareas = jiraBoard.get().tareas;
    jiraBoard.subscribe(() => { if (jiraBoard.get().tareas !== tareas) { tareas = jiraBoard.get().tareas; if (this.figures.size) this.r.publish(); } });
  }

  /** Todos los worktrees (no principales) con su sala: los de git y los que una sesión acaba de crear. */
  private worktrees() {
    const repos = live.get().repos ?? {};
    const out: { w: InfoWorktree; room: Room }[] = [];
    for (const s of this.r.rooms) for (const w of repos[s.id]?.worktrees ?? []) if (!w.main) out.push({ w, room: s });
    const all = out.map(x => x.w);
    for (const s of Object.values(live.get().sessions) as SessionSummary[]) {
      if (s.state === 'cerrada') continue;
      const path = pathWorktree(s.cwd, all); if (!path || out.some(x => x.w.path === path)) continue;
      const room = this.r.rooms.find(x => x.id === s.roomId); if (!room) continue;
      const w: InfoWorktree = { path, branch: path.split('/').pop() ?? '', main: false, changes: 0, advanced: 0, author: s.dwellerId };
      out.push({ w, room }); all.push(w);
    }
    return out;
  }

  /** Sesiones que trabajan dentro de algún worktree: las anima su holograma, no el habitante original. */
  inWorktree(s: SessionSummary) { return !!pathWorktree(s.cwd, this.worktrees().map(x => x.w)); }

  private insideSession(path: string): SessionSummary | undefined {
    const urg = (s: SessionSummary) => s.state === 'esperando' ? 0 : s.state === 'error' ? 1 : s.state === 'terminada' && s.unread ? 2 : s.state === 'trabajando' || s.state === 'arrancando' ? 3 : 4;
    return (Object.values(live.get().sessions) as SessionSummary[]).filter(s => s.state !== 'cerrada' && (s.cwd === path || s.cwd?.startsWith(path + '/'))).sort((a, b) => urg(a) - urg(b) || b.updated - a.updated)[0];
  }

  private authorOf(w: InfoWorktree, room: Room) {
    const hs = this.r.dwellers;
    const own = hs.find(h => h.id.id === w.author);
    if (own) return own;
    // sin autor conocido (creado fuera del refugio): uno de la sala, siempre el mismo para ese worktree
    const ofRoom = hs.filter(h => h.room === room); const list = ofRoom.length ? ofRoom : hs;
    const k = [...w.path].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return list[k % list.length];
  }

  sync() {
    if (!this.r.rooms.length || !this.r.dwellers.length) return;
    const list = this.worktrees();
    const roomBy = new Map<Room, number>();
    const seen = new Set<string>();
    let changed = false;
    for (const { w, room } of list) {
      const n = roomBy.get(room) ?? 0; if (n >= MAX_BY_ROOM) continue; roomBy.set(room, n + 1);
      seen.add(w.path);
      const author = this.authorOf(w, room); if (!author) continue;
      const already = this.figures.get(w.path);
      // otro autor: la copia nueva nace a su lado; la sala reconstruida (disposición nueva): reaparece en su sitio sin más
      let effect = true;
      if (already && (already.authorId !== author.id.id || already.room !== room)) { effect = already.authorId !== author.id.id; this.remove(already, true); }
      else if (already) { already.w = w; if (already.ready) changed = this.apply(already) || changed; continue; }
      this.create(w, room, author, effect); changed = true;
    }
    for (const f of [...this.figures.values()]) if (!seen.has(f.path) && !f.leaving) { this.remove(f); changed = true; }
    if (changed) this.r.publish();
  }

  // ---- a slot along the front edge (`holoSlot`)
  private spot(room: Room, path: string) {
    const others = [...this.figures.values()].filter(f => f.room === room && f.path !== path && !f.leaving).map(f => f.spot.x - room.group.position.x);
    const workstations = room.points.filter(pt => pt.type !== 'charla').map(pt => ({ x: pt.pos.x, weight: pt.type === 'puesto' || pt.type === 'pieza' ? 300 : pt.type === 'mirar' ? 60 : 200 }));
    const devices = (room.interactive ?? []).filter(i => !i.id.startsWith('vis:')).map(i => i.x);
    const x = holoSlot({ width: room.width, side: room.side, workstations, devices, walkZones: room.walkZones ?? [], obstacles: room.obstacles }, others, Z_SPOT, BASE);
    return new THREE.Vector3(room.group.position.x + x, room.group.position.y, Z_SPOT);
  }

  private async create(w: InfoWorktree, room: Room, author: Dweller, effect = true) {
    const u = holoUniforms(COLOR); u.uOpacity.value = 0; u.uCut.value = -1e4;
    // el mismo aspecto que su autor (modelo, tono, silueta y accesorios), y luego en luz
    const clone = new Dweller(author.id, room);
    const spot = this.spot(room, w.path);
    const side = Math.sign(room.group.position.x - spot.x) || 1;
    const f: Copy = {
      path: w.path, w, room, authorId: author.id.id, p: clone.p, u, base: null, laptop: new THREE.Group(), screens: new THREE.Group(),
      spot, rotation: side * 1.05, state: 'ocioso', detail: '', signature: '', pose: '', fromPose: 0, poseWanted: 'reposo', gestureClock: 3, waitingSince: 0,
      opacity: 0, goalCut: 1e4, leaving: false, ready: false,
      lookClock: 3, busyClock: 0, assembly: null, talking: false, chatTurn: 0, tone: COLOR,
    };
    this.taskTone(f); u.uColor.value.copy(f.tone);
    this.figures.set(w.path, f);
    await clone.load();
    if (this.figures.get(w.path) !== f) return;
    const p = f.p;
    await this.accessories(p, author.id.id);
    await Promise.all([this.mountLaptop(f), this.mountBase(f)]);
    if (this.figures.get(w.path) !== f) return;
    for (const o of [p.model, f.laptop, f.screens]) holograph(o, u);
    p.contactShadow.visible = false;
    p.root.scale.setScalar(HOLO_SCALE);   // the root's pivot is at the feet: it shrinks standing on its projector
    p.root.name = 'holograma:' + w.path;
    // recién creada con el refugio ya en marcha: el proyector baja por su tubo, su autor lo monta y ella aparece encima
    const inHot = effect && performance.now() - this.since > 8000;
    if (inHot && f.base) { this.deliver(f, author); return; }
    {
      p.root.position.copy(spot); p.root.rotation.y = f.rotation; p.goalTurn = f.rotation;
      u.uCut.value = 1e4; f.goalCut = 1e4;
      this.r.motor.scene.add(p.root);
      this.apply(f, true); this.changePose(f, f.poseWanted, true); f.ready = true; u.uOpacity.value = f.opacity; this.r.publish();
    }
    if (f.base) this.r.motor.scene.add(f.base);
    this.makeWay(f);
  }

  // quien estaba de paseo justo ahí le deja el sitio
  private makeWay(f: Copy) {
    for (const h of this.r.dwellers) if (h.room === f.room && h.state === 'ocioso' && !h.fixed && !h.busyErrand && Math.abs(h.pos.x - f.spot.x) < 1.1) h.p.goA(this.r.freeGap(f.room));
  }

  // ---- la entrega: un tubo baja del techo, suelta el proyector, sube; su autor (si está en la sala y libre) va a
  // montarlo con la llave y, montado, la copia se materializa encima. Si el autor no puede, se monta solo al poco
  private async deliver(f: Copy, author: Dweller) {
    const base = f.base!, y = f.room.group.position.y;
    let tube: THREE.Object3D;
    try {
      tube = await place(new THREE.Group(), R.cy('Pipe_2'), { width: 1, rotZ: Math.PI / 2, anchor: 'centro', isStatic: false, shadow: false });
      tube.removeFromParent();
      // metal claro con un brillo del color de su tarea: que se lea contra la pared oscura
      tube.traverse((n: any) => { if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: '#b9c2cc', metalness: 0.6, roughness: 0.35, emissive: f.tone, emissiveIntensity: 0.35 }); });
    } catch { tube = new THREE.Group(); }
    if (this.figures.get(f.path) !== f) return;
    const pivot = new THREE.Group(); pivot.add(tube); tube.position.y = -0.5;   // cuelga del techo: crece hacia abajo
    pivot.position.set(f.spot.x, y + CEILING, f.spot.z); pivot.scale.set(3 * BASE, 0.001, 3 * BASE);   // thick: the projector fits
    base.position.y = y + CEILING; base.visible = false;
    this.r.motor.scene.add(pivot, base);
    f.assembly = { tube: pivot, t: 0, phase: 'baja', mounted: false, end: 0 };
    this.makeWay(f);
    SFX.powerOff();
  }

  private stepDelivery(f: Copy, dt: number) {
    const m = f.assembly!, base = f.base!, y = f.room.group.position.y;
    m.t += dt;
    const length = CEILING - 0.9;   // hasta dónde baja el tubo
    if (m.phase === 'baja') {
      const k = Math.min(1, m.t / 0.7); m.tube.scale.y = Math.max(0.001, length * k * (2 - k));
      if (k >= 1) { m.phase = 'cae'; m.t = 0; base.visible = true; base.position.y = y + 0.9; }
    } else if (m.phase === 'cae') {
      const k = Math.min(1, m.t / 0.35); base.position.y = y + 0.9 * (1 - k * k);
      if (k >= 1) {
        m.phase = 'sube'; m.t = 0; base.position.y = y;
        audioWorld.action(new THREE.Vector3(f.spot.x, y + 0.2, f.spot.z), 'caja', 0.9, f.room);
        this.callAuthor(f);
      }
    } else if (m.phase === 'sube') {
      const k = Math.min(1, m.t / 0.6); m.tube.scale.y = Math.max(0.001, length * (1 - k));
      if (k >= 1) { m.phase = 'listo'; m.t = 0; this.r.motor.scene.remove(m.tube); }
    } else if (m.mounted || m.t > m.end) this.materialize(f);
  }

  private callAuthor(f: Copy) {
    const m = f.assembly!, author = this.r.dwellers.find(h => h.id.id === f.authorId);
    m.end = 2.5;   // sin autor que lo monte: se monta solo
    if (!author || author.room !== f.room || !author.p.root.visible) return;
    // a un lado del proyector (el que da a su sitio), agachado hacia él
    const side = Math.sign(author.pos.x - f.spot.x) || 1;
    const beside = new THREE.Vector3(f.spot.x + side * (BASE / 2 + 0.3), f.room.group.position.y, f.spot.z);
    const rotation = Math.atan2(f.spot.x - beside.x, f.spot.z - beside.z);
    if (author.sendOnErrand(beside, rotation, 'Lockpicking', 'llave', 3.2, () => { if (f.assembly) f.assembly.mounted = true; })) m.end = 25;   // por si no llega nunca
  }

  private materialize(f: Copy) {
    if (f.assembly?.tube.parent) this.r.motor.scene.remove(f.assembly.tube);
    f.assembly = null;
    const p = f.p, u = f.u, y = f.room.group.position.y;
    p.root.position.copy(f.spot); p.root.rotation.y = f.rotation; p.goalTurn = f.rotation;
    u.uCut.value = y; f.goalCut = y + 2.6; f.opacity = 1; u.uOpacity.value = 1;
    SFX.holoAppears();
    this.r.motor.scene.add(p.root);
    p.play('Spawn_Ground', 0, { loop: false });
    setTimeout(() => { if (f.leaving) return; f.pose = 'pie'; f.fromPose = 0; this.apply(f, true); this.changePose(f, f.poseWanted); f.ready = true; this.r.publish(); }, 1300);
  }

  private async accessories(p: Character, authorId: string) {
    const ids: string[] = (live.get().state?.dwellers as any[] | undefined)?.find(x => x.id === authorId)?.accessories ?? [];
    await Promise.all(ids.map(id => { const a = SHOP.find(x => x.id === id); return a?.ruta && a.bone ? p.couple('acc:' + id, { path: a.ruta, bone: a.bone, scale: a.escala ?? 1, pos: a.pos, rot: a.rot, rig: a.rig }).catch(() => {}) : null; }));
  }

  // su ordenador: un teclado y una pantalla de los muebles KayKit, en luz como él (en el suelo o flotando en el aire)
  private async mountLaptop(f: Copy) {
    const [kbd, mon] = await Promise.all([gltf(R.furniture('keyboard')), gltf(R.furniture('monitor'))]);
    const adjust = (o: THREE.Object3D, width: number) => { const { size } = measure(o); o.scale.setScalar(width / Math.max(size.x, size.z, 1e-3)); return o; };
    const keyboard = adjust(kbd.scene.clone(true), 0.36); keyboard.position.set(0, 0.01, 0.5);
    const screen = adjust(mon.scene.clone(true), 0.38); screen.position.set(0, 0.01, 0.74); screen.rotation.y = Math.PI; screen.rotation.x = -0.12;
    f.laptop.add(keyboard, screen);
    // en arco delante de él, a la altura de las manos (la cámara no las ve tapándole la cabeza)
    const p1 = adjust(mon.scene.clone(true), 0.5); p1.position.set(-0.22, 0.88, 0.72); p1.rotation.y = Math.PI - 0.35;
    const p2 = adjust(mon.scene.clone(true), 0.42); p2.position.set(0.36, 0.8, 0.6); p2.rotation.y = Math.PI + 0.5;
    f.screens.add(p1, p2);
    for (const g of [f.laptop, f.screens]) { g.visible = false; f.p.root.add(g); }
  }

  // el proyector: una plataforma baja de KayKit en el suelo, con su material (no es holograma)
  private async mountBase(f: Copy) {
    try {
      const g = await gltf(R.base('landingpad_small'));
      const o = g.scene.clone(true);
      const { size } = measure(o); const k = BASE / Math.max(size.x, size.z, 1e-3); o.scale.set(k, BASE_HEIGHT / Math.max(size.y, 1e-3), k);
      o.traverse((n: any) => { if (n.isMesh) { n.receiveShadow = true; n.castShadow = false; } });
      const base = new THREE.Group(); base.add(o); base.position.copy(f.spot); base.userData.isStatic = false;
      // encendido, un disco de luz del color de su tarea que cubre la plataforma (se ve aunque esté sentada encima)
      const light = new THREE.Mesh(new THREE.CircleGeometry(BASE * 0.48, 40), new THREE.MeshBasicMaterial({ color: f.u.uColor.value, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      light.rotation.x = -Math.PI / 2; light.position.y = measure(o).size.y + 0.01; light.visible = false; light.name = 'luz'; base.add(light);
      f.base = base;
      f.spot.y += measure(o).size.y;   // de pie (o sentado) encima de la plataforma
    } catch { f.base = null; }
  }

  // ---- la sesión de dentro → pose y animación
  private apply(f: Copy, force = false): boolean {
    const s = this.insideSession(f.path);
    const m = s?.activity?.mode;
    let state: DwellerState = 'ocioso', detail = '', wants: Pose = 'base';
    if (s) {
      // pensando también está de faena: de pie con sus pantallas, como trabajando (sentada es no tener nada que hacer)
      if (s.state === 'arrancando') { state = 'pensando'; detail = t('windows.gettingReady'); wants = 'manos'; }
      else if (s.state === 'trabajando') {
        if (!m || m === 'pensar') { state = 'pensando'; detail = s.activity?.text ?? t('windows.thinking'); wants = 'manos'; }
        else { state = 'trabajando'; detail = s.activity?.text ?? ''; wants = 'manos'; }
      } else if (s.state === 'esperando') { state = 'esperando'; detail = s.pending?.title ?? t('windows.waitingForYou'); wants = 'pie'; }
      else if (s.state === 'terminada' && s.unread) { state = 'terminado'; detail = t('windows.readyTitulo', { titulo: s.title ?? '' }); wants = 'pie'; }
      else if (s.state === 'error') { state = 'error'; detail = s.error ?? t('windows.fault'); wants = 'reposo'; }
      else { detail = s.title ?? ''; wants = 'base'; }
    }
    const signature = [s?.id, state, detail, f.w.changes, f.w.advanced].join('|');
    if (signature === f.signature && !force) return false;
    const before = f.state;
    f.signature = signature; f.state = state; f.detail = detail; f.sessionId = s?.id; f.poseWanted = wants;
    if (state !== before) {
      if (state === 'terminado') { SFX.success(); f.p.gesture('Waving', 'Idle_A'); f.pose = 'pie'; f.fromPose = timeout.value; f.gestureClock = 8; }
      else if (state === 'error') { SFX.holoGlitch(); f.u.uGlitch.value = 1; }
      else if (state === 'esperando') { SFX.highNotice(); f.waitingSince = performance.now(); }
    }
    if (state !== 'error') f.u.uGlitch.value = 0;
    f.opacity = state === 'ocioso' ? 0.6 : 1;
    return state !== before;
  }

  private changePose(f: Copy, pose: Pose, immediate = false) {
    const p = f.p; const seated = SEATED_POSES.has(f.pose);
    const sit = SEATED_POSES.has(pose);
    f.pose = pose; f.fromPose = timeout.value;
    f.laptop.visible = pose === 'portatil' || pose === 'reposo';
    f.screens.visible = pose === 'manos';
    if (IN_PROJECTOR.has(pose)) p.goalTurn = f.rotation; else if (pose === 'pie') p.goalTurn = 0;
    if (sit) {
      p.inRest = 'Sit_Floor_Idle';
      if (seated || immediate) p.play('Sit_Floor_Idle', immediate ? 0 : 0.35);
      else p.gesture('Sit_Floor_Down', 'Sit_Floor_Idle', 0.25);
    } else {
      const clip = pose === 'manos' ? BUSY[0] : 'Idle_A';
      if (pose === 'manos') f.busyClock = 3 + Math.random() * 2;
      p.inRest = clip;
      if (seated && !immediate) p.gesture('Sit_Floor_StandUp', clip, 0.2);
      else if (pose === 'pie' && f.state === 'esperando' && !f.talking) { p.gesture('Waving', 'Idle_A'); f.gestureClock = 3; }
      else p.play(clip, immediate ? 0 : 0.3);
    }
  }

  private remove(f: Copy, already = false) {
    f.leaving = true; this.figures.delete(f.path); f.p.stop();
    if (f.assembly) { this.r.motor.scene.remove(f.assembly.tube); f.assembly = null; already = true; }
    const outside = () => { this.r.motor.scene.remove(f.p.root); if (f.base) this.r.motor.scene.remove(f.base); };
    if (already || !f.p.root.parent) { outside(); return; }
    SFX.powerOff();
    // se desvanece de la cabeza a los pies
    f.u.uCut.value = Math.min(f.u.uCut.value, f.p.root.position.y + 2.6); f.goalCut = f.p.root.position.y - 0.05;
    setTimeout(outside, 1400);
    this.outgoing.add(f);
  }
  private outgoing = new Set<Copy>();

  update(dt: number) {
    timeout.value += dt;
    for (const f of [...this.figures.values(), ...this.outgoing]) {
      if (f.assembly && !f.leaving) this.stepDelivery(f, dt);
      const light = f.base?.getObjectByName('luz') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | undefined;
      if (light) {
        light.visible = !!f.p.root.parent && !f.leaving;
        // sin nada que hacer, tenue y fija; con una sesión en marcha, más viva y latiendo
        const alive = f.state === 'trabajando' || f.state === 'pensando';
        light.material.opacity = alive ? 0.6 + 0.25 * Math.sin(timeout.value * 3 + f.u.uSemilla.value * 9) : 0.4;
      }
      if (!f.p.mixer || !f.p.root.parent) { if (f.leaving && !f.p.root.parent) this.outgoing.delete(f); continue; }
      const u = f.u;
      // materializar o desvanecer: el corte sube (o baja) a ritmo constante
      if (u.uCut.value !== f.goalCut && u.uCut.value > -1e3 && u.uCut.value < 1e3) {
        const step = dt * 2.2; const d = f.goalCut - u.uCut.value;
        u.uCut.value = Math.abs(d) <= step ? f.goalCut : u.uCut.value + Math.sign(d) * step;
        if (u.uCut.value >= f.p.root.position.y + 2.55 && !f.leaving) { u.uCut.value = 1e4; f.goalCut = 1e4; }
      }
      u.uOpacity.value = THREE.MathUtils.damp(u.uOpacity.value, f.opacity, 3, dt);
      if (f.state === 'error') u.uGlitch.value = 0.35 + 0.65 * Math.max(0, Math.sin(timeout.value * 3.1 + u.uSemilla.value * 9));
      this.taskTone(f);
      u.uColor.value.lerp(f.state === 'error' ? COLOR_FAULT : f.tone, 1 - Math.exp(-dt * 4));   // del color de su tarea; con avería, en rojo
      if (f.ready && !f.leaving) this.drive(f, dt);
      f.p.update(dt);
    }
  }

  // ---- qué hace cada copia, siempre en su proyector: hablar contigo, trabajar sin parar o quedarse quieta
  private drive(f: Copy, dt: number) {
    const p = f.p, pos = p.root.position;
    if (f.talking) {
      if (p.inMovement || WALKING.test(p.currentName)) { p.stop(); p.play(p.inRest, 0.25); }
      if (f.pose !== 'pie') this.changePose(f, 'pie');
      p.goalTurn = f.chatTurn;
      return;
    }
    // la sala se movió o le empujaron: de vuelta a su proyector
    if (!p.inMovement && Math.hypot(pos.x - f.spot.x, pos.z - f.spot.z) > 0.08) { p.goA(f.spot, false, () => this.changePose(f, f.poseWanted, true)); return; }
    if (p.inMovement) return;
    const wants = f.poseWanted;
    // entre pensar y trabajar no se levanta y se sienta a cada herramienta: cada postura dura al menos unos segundos
    const sway = (f.pose === 'portatil' && wants === 'manos') || (f.pose === 'manos' && wants === 'portatil');
    if (wants !== f.pose && (!sway || timeout.value - f.fromPose > 6)) this.changePose(f, wants);
    if (f.state === 'esperando' && f.pose === 'pie') { f.gestureClock -= dt; if (f.gestureClock < 0) { f.gestureClock = 4 + Math.random() * 2; callOut(f.p, f.waitingSince); } }
    // terminada: te espera con paciencia, saludando de vez en cuando hasta que la lees
    if (f.state === 'terminado' && f.pose === 'pie') { f.gestureClock -= dt; if (f.gestureClock < 0) { f.gestureClock = 8 + Math.random() * 5; f.p.gesture('Waving', 'Idle_A'); } }
    // trabajando, muy ocupada: cambia de gesto con las pantallas cada pocos segundos
    if (f.pose === 'manos') {
      f.busyClock -= dt;
      if (f.busyClock < 0) { f.busyClock = 3 + Math.random() * 3; const sig = BUSY.filter(c => c !== p.inRest)[Math.floor(Math.random() * (BUSY.length - 1))]; p.inRest = sig; p.play(sig, 0.3); }
    }
    if (f.pose === 'base') this.still(f, dt);
  }

  // sin nada que hacer, sentada y quieta en su proyector; mira a un lado y a otro y, si el Supervisor se le acerca, le mira
  private still(f: Copy, dt: number) {
    const p = f.p, pos = p.root.position, sp = this.r.supervisor?.root.position;
    if (sp && Math.abs(sp.y - pos.y) < 1 && Math.hypot(sp.x - pos.x, sp.z - pos.z) < 1.7) { p.goalTurn = Math.atan2(sp.x - pos.x, sp.z - pos.z); f.lookClock = Math.max(f.lookClock, 2); return; }
    f.lookClock -= dt; if (f.lookClock > 0) return;
    f.lookClock = 5 + Math.random() * 6;
    p.goalTurn = f.rotation * (0.3 + Math.random() * 0.7);
  }

  // ---- charla con el Supervisor
  startChat(f: Copy, lookA: THREE.Vector3) {
    f.talking = true; f.p.stop();
    if (WALKING.test(f.p.currentName)) f.p.play(f.p.inRest, 0.2);
    f.chatTurn = Math.sign(lookA.x - f.p.root.position.x || 1) * 0.55;
  }
  finishChat(f: Copy) { f.talking = false; f.lookClock = 4; this.apply(f, true); }

  /** La copia más cercana a `junto` (en su planta), a menos de `max`. */
  nearby(beside: THREE.Vector3, max: number): { f: Copy; d: number } | null {
    let best: { f: Copy; d: number } | null = null;
    for (const f of this.figures.values()) {
      if (!f.ready || f.leaving || Math.abs(f.p.root.position.y - beside.y) > 1) continue;
      const d = Math.hypot(f.p.root.position.x - beside.x, f.p.root.position.z - beside.z);
      if (d < max && (!best || d < best.d)) best = { f, d };
    }
    return best;
  }
  ofId(id: string) { for (const f of this.figures.values()) if (idCopy(f.path) === id) return f; }
  ofSession(id: string) { for (const f of this.figures.values()) if (f.sessionId === id) return f; }
  ofPath(path: string) { const r = path.replace(/\/+$/, ''); for (const f of this.figures.values()) if (f.path.replace(/\/+$/, '') === r) return f; }

  /** El robot mensajero le trae una revisión de su PR (messenger.ts): de pie, se gira hacia él y la recoge; sentada,
   *  trabajando o hablando con el Supervisor, sigue a lo suyo */
  receive(f: Copy, since: THREE.Vector3) {
    if (f.talking || f.leaving || !f.ready || f.pose !== 'pie') return;
    const p = f.p, pos = p.root.position;
    f.lookClock = Math.max(f.lookClock, 4); f.gestureClock = Math.max(f.gestureClock, 3);
    p.goalTurn = Math.atan2(since.x - pos.x, since.z - pos.z);
    p.gesture('PickUp', p.inRest);
  }

  /** Las salas con alguna copia pensando o trabajando (sus habitantes se ponen a trabajar también) */
  busyRooms() {
    const rooms = new Set<string>();
    for (const f of this.figures.values()) if (!f.leaving && (f.state === 'trabajando' || f.state === 'pensando')) rooms.add(f.room.id);
    return rooms;
  }

  // sus proyectores y por dónde andan (para que los habitantes no se les metan dentro)
  positions() { return [...this.figures.values()].flatMap(f => [f.spot, f.p.root.position]); }

  /** Cada copia, como interlocutor de la interfaz (regleta, barra, intercomunicador). */
  // cada copia, del color de la tarea que trabaja (el mismo que en los tableros): de un vistazo se ve qué tarea tiene
  // sesiones en qué sala
  private taskTone(f: Copy) {
    const t = worktreeTask(f.w), v = versionColors.get().v;
    if (t === f.task && f.versionTone === v) return;
    if (t !== f.task) knowTasks([t]);
    f.task = t; f.versionTone = v; f.tone = holoTone(t);
  }
  summaries(): DwellerSummary[] {
    return [...this.figures.values()].map(f => {
      const author = this.r.dwellers.find(h => h.id.id === f.authorId), a = author?.id;
      const name = a?.name ?? t('world.copy');
      return {
        id: idCopy(f.path), name: `${name} ◇ ${copyCaption(f.w)}`, nickname: t('windows.holographicCopy'), type: a?.type ?? '',
        bio: t('world.holoCopyBio', { nombre: name, mote: tIs(a?.nickname ?? ''), rama: f.w.branch || f.path }),
        room: f.room.id, nameRoom: f.room.name, path: f.path, folder: f.path, state: f.ready ? f.state : 'ocioso', detail: f.detail, sessionId: f.sessionId,
        robot: author?.p.look?.especie === 'robot',
        copy: { path: f.path, branch: f.w.branch, authorId: f.authorId, nameAuthor: name, nicknameAuthor: a?.nickname ?? '', changes: f.w.changes, advanced: f.w.advanced },
      };
    });
  }

  // a copy's full tag (name, task, detail) only while it is talked to (E), pointed at or its tag is under the pointer
  // (`over`); otherwise, if it has something to show (working, waiting, done, failed, a ⏰), just its state's glyph:
  // many holograms in a room no longer bury it in text
  labels(farSide: boolean, selected: Copy | null, aimed: Copy | null = null, over?: object) {
    return [...this.figures.values()].filter(f => f.ready && f.p.mixer).map(f => {
      const picked = f === selected || f === aimed, shown = picked || f === over;
      const git = f.w.changes ? t('windows.nChanges', { n: f.w.changes }) : f.w.advanced ? t('windows.nCommitsToMerge', { n: f.w.advanced }) : t('panels.clean2');
      const detail = !shown ? '' : f.state === 'ocioso' ? git : f.detail.slice(0, 48);
      const author = this.r.dwellers.find(h => h.id.id === f.authorId);
      const scheduled = scheduledMark(f.room.id, f.path), pointed = (f === aimed || f === over) && f !== selected;
      const mine = (Object.values(live.get().sessions) as SessionSummary[]).filter(s => s.cwd === f.path || s.cwd?.startsWith(f.path + '/'));
      const queued = queuedMark(mine), flagged = flaggedMark(mine);
      return { k: f, scheduled, queued, flagged, pos: f.p.headPoint(), height: 0.2, name: `${author?.id.name ?? t('world.copy')} ◇ ${copyCaption(f.w, f.task ?? branchCaption(f.w.branch))}${verificationMark(f.task) ? ' · ' + verificationMark(f.task) : ''}`, color: hasTaskColor(f.task) ? taskColor(f.task) : undefined, epic: epicTag(f.task), state: f.state, detail, near: picked, farSide: farSide || !shown, prompt: picked ? t('world.talk') : '', key: f === selected ? 'E' : t('world.click'), aimed: pointed, relevant: shown || f.state !== 'ocioso' || !!scheduled || !!queued || !!flagged };
    }).filter(x => x.relevant);
  }
}
