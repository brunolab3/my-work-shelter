// Habitante: un personaje KayKit con identidad, una rutina de trabajo y una máquina de estados que traduce lo que pasa
// en su sesión de Claude Code a animación (§5.3).
// - De un vistazo se ve si en su sala se trabaja: la mesa es solo para trabajar. Con trabajo (su sesión o la de una
//   copia holográfica de su sala, que se queda en su proyector) se sienta en su puesto (su mesa: punto 'puesto') y
//   teclea a toda prisa, y a ratos maneja los aparatos y la pieza característica de la sala (puntos 'consola' y
//   'pieza', con las acciones de la sala); pensando, lee y piensa en su mesa, y a ratos se levanta a mirar la pieza.
// - Sin trabajo, lejos de la mesa y con calma: su afición, un paseo con un café o el periódico, un vistazo a la pieza
//   (sin trabajarla) o, de madrugada, una siesta; nunca corriendo (que se le pueda hacer clic).
// - Encargos (`encargar`): deja lo que hace, va a un sitio, lo hace y vuelve a lo suyo (montar el proyector de su copia).
// - Te espera (pregunta, permiso o plan) = se levanta, te mira, salta y saluda hasta que contestas; termina = te espera
//   de pie, con paciencia, saludando de vez en cuando hasta que lo lees; error = golpe y al suelo; duerme en su catre.
// - Se sienta y se levanta de verdad (clips de KayKit) y sigue al Supervisor con la mirada cuando anda cerca.
import * as THREE from 'three';
import { Character, turnBoneWorld, callOut } from './character';
import { composeClip } from './animations';
import { lookOf, type Look } from '@shared/appearance';
import { Zzz } from './effects';
import type { Room, RoomPoint } from './room';
import { BACKGROUND } from './room';
import { R } from '../engine/assets';
import { world } from './rooms/common';
import { live } from '../net/client';
import { audioWorld } from '../audio/world';
import { musicPulse } from '../audio/music';
import { SFX } from '../audio/sound';
import type { DwellerState } from '../ui/gameState';

export interface Identity { id: string; name: string; nickname: string; type: string; bio: string; tint?: string; tone?: number; voice: number; look?: Look }

type Tool = 'leer' | 'editar' | 'terminal' | 'buscar' | 'web' | 'subagente' | 'otra';
type Stay = 'puesto' | 'pieza' | 'aficion' | 'paseo' | 'consola' | 'patrulla';
/** Lo que hace ahora (lo lee el audio del mundo: el tecleo, los murmullos) */
export type Chore = 'teclear' | 'leer' | 'cafe' | 'pensar' | 'pieza' | 'aficion' | 'pasear' | 'mirar' | 'charlar' | 'dormir' | 'avisar' | 'celebrar' | 'averia' | 'andar' | 'trastear';

// Accesorio por actividad (se engancha al hueso de la mano)
const UTENSILS: Record<string, { path: string; bone: 'handslotr' | 'handslotl'; scale: number; rot?: [number, number, number]; pos?: [number, number, number] }> = {
  diario: { path: R.tools('journal_open'), bone: 'handslotl', scale: 0.55, rot: [0.2, Math.PI, 0] },
  martillo: { path: R.tools('hammer'), bone: 'handslotr', scale: 0.7 },
  llave: { path: R.tools('wrench_A'), bone: 'handslotr', scale: 0.75 },
  lupa: { path: R.tools('magnifying_glass'), bone: 'handslotr', scale: 0.7 },
  taza: { path: R.furniture('mug_A'), bone: 'handslotr', scale: 0.55 },
  sierra: { path: R.tools('saw'), bone: 'handslotr', scale: 0.65 },
  ballesta: { path: 'kaykit/adventurers-2.0/Assets/gltf/crossbow_1handed.gltf', bone: 'handslotr', scale: 1 },
  regadera: { path: R.tools('bucket_metal'), bone: 'handslotr', scale: 0.45 },
  tijeras: { path: R.tools('scissors'), bone: 'handslotr', scale: 0.6 },
};

const KATANA = { path: 'kaykit/mystery-monthly-series-6/7 - January 2026 - 4GTN/assets/gltf/4GTN_Katana.gltf', bone: 'handl' as const, scale: 1, rot: [0, 0, -1.3] as [number, number, number] };   // su esqueleto (Rig_Large) no tiene handslot: va en la mano

// Sentado a la mesa: el tren inferior de «sentado en la silla» con los brazos de otro clip de KayKit (no trae teclear ni
// leer sentado); el tecleo de los dedos se añade encima (ver retocar)
const SEATED = { teclear: 'Sentado_Teclear', leer: 'Sentado_Leer', cafe: 'Sentado_Cafe', pensar: 'Sit_Chair_Idle' } as const;
const SEATED_CLIPS = new Set<string>(Object.values(SEATED));
let composed = false;
function composeSeated() {
  if (composed) return; composed = true;
  composeClip(SEATED.teclear, 'Sit_Chair_Idle', 'Holding_A', { fixedBelow: true });
  composeClip(SEATED.leer, 'Sit_Chair_Idle', 'Holding_B', { fixedBelow: true });
  composeClip(SEATED.cafe, 'Sit_Chair_Idle', 'Use_Item', { fixedBelow: true, upSpeed: 0.6 });
}
const random = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);
/** reparto al azar con pesos (los de peso 0 no salen) */
function shuffle<T extends string>(weights: Partial<Record<T, number>>): T | null {
  const l = Object.entries(weights).filter(([, p]) => (p as number) > 0) as [T, number][];
  let t = Math.random() * l.reduce((a, [, p]) => a + p, 0);
  for (const [k, p] of l) { t -= p; if (t <= 0) return k; }
  return l.at(-1)?.[0] ?? null;
}
// los clips de herramienta nunca al aire: con la herramienta en la mano
const TOOL_OF: Record<string, string> = { Hammering: 'martillo', Hammer: 'martillo', Sawing: 'sierra', Saw: 'sierra', Lockpicking: 'lupa', Lockpick: 'lupa' };
// el sonido de cada acción en la pieza (lo pone el audio del mundo en su sitio, con paneo y pared)
function SOUND_OF(clip: string, utensil?: string): Parameters<typeof audioWorld.action>[1] | null {
  if (utensil === 'regadera') return 'agua';
  if (utensil === 'tijeras') return 'tijeras';
  if (/^Hammer|^Chop|^Pickax|^Dig/.test(clip)) return 'metal';
  if (/^Saw|^Work_|^Working_B/.test(clip)) return 'herramienta';
  if (/^Lockpick/.test(clip)) return 'cerrojo';
  if (/^PickUp|^Throw/.test(clip)) return 'caja';
  if (/^Holding_B/.test(clip) || utensil === 'diario') return 'papel';
  if (/^(Interact|Use_Item|Working_A|Working_C|Ranged_Magic)/.test(clip)) return 'pitido';
  return null;
}
// la cadera, un poco por delante del centro del asiento (el respaldo necesita su sitio), y lo que hay de la articulación
// de la cadera al cojín en estas figuras (medido de cerca)
const HIP_FORWARD = 0.05, MATTRESS = 0.1;
const isSeat = (pt: RoomPoint) => pt.type === 'silla' || (pt.type === 'puesto' && !pt.ofFoot);

export class Dweller {
  static occupants: () => THREE.Object3D[] = () => [];
  static still = false; // durante una charla nadie se pasea por delante (quien charla lo marca `charlando`)
  p: Character;
  id: Identity;
  room: Room;
  state: DwellerState = 'ocioso';
  detail = '';
  tool: Tool = 'otra';
  lookCamera = false;
  sessionId?: string;
  waitingAfterChat = 0;   // al alejarte, se queda unos segundos por si se te ocurre algo más
  chatting = false;         // habla con el Supervisor (lo pone el refugio): si no trabaja, no se va de su lado
  private copyWorks = false;   // una copia holográfica de su sala trabaja: él también, aunque su sesión no
  chore: Chore = 'mirar';
  zzz = new Zzz(new THREE.Vector3());
  private point: RoomPoint | null = null;
  private arrived = false;   // ya está en su punto (no andando hacia él)
  private seat = false;   // sentado en la silla de su punto
  private stay: { where: Stay; until: number } | null = null;
  private last: Stay | '' = '';
  private sub = { until: 0, what: '' };
  private timer = 0;
  private untilBusy = 0;  // sentándose o levantándose: no se le interrumpe
  private slide: { since: THREE.Vector3; until: THREE.Vector3; t: number; dur: number } | null = null;
  private gestureClock = 4;
  private waitingSince = 0;   // desde cuándo te espera (al rato, además de saludar, salta)
  private utensil = '';
  private step = 0;          // acción de la pieza en curso
  private typing = 0;        // intensidad del tecleo de las manos (0..1, suavizada)
  private typingRhythm = 1;
  private gaze = 0;        // peso del giro de cabeza hacia el Supervisor
  private faceLocal: THREE.Vector3 | null = null;
  private glance = { until: 0, next: 0 };
  private wakeIn = 0;   // la siesta de madrugada acaba sola
  private partialLong = 0; private untilSpeaks = 0; private speaks = 0;
  /** su respuesta está llegando (el texto en streaming de su sesión): habla, con la cabeza y con la voz (audio) */
  get talking() { return this.timer < this.untilSpeaks; }

  constructor(id: Identity, room: Room) { this.id = id; this.room = room; this.p = new Character(id.type, id.type === 'Octocat' ? null : lookOf(id)); }

  async load() {
    await this.p.load();
    composeSeated();
    // a pie, con brío (más rápido que el paso de paseo de KayKit, que se hacía eterno en una sala de 12 m)
    this.p.gait = { walk: 'Walking_A', run: 'Running_A', walkRhythm: 1.5, runRhythm: 0.88 };
    if (this.id.tint) this.p.tint(this.id.tint, 0.18);
    // el androide samurái no suelta su katana (la que trae su modelo), en la izquierda: la derecha es para los utensilios
    if ((this.id.id === 'hanzo' || this.id.type === '4GTN') && this.p.figure?.large) await this.p.couple('katana', KATANA);
    this.p.root.userData.dweller = this;
    this.measureFace(); this.measureHip();
    this.p.animateAfter = () => this.retouch();
    this.p.onChangeLook = () => { this.measureFace(); this.measureHip(); if (this.state === 'durmiendo') this.p.part(/^espalda:/, false); };
    return this;
  }

  // En qué eje local de la cabeza mira la cara (en reposo de pie mira al frente del personaje): para girarla luego hacia
  // la cámara (dormido) o hacia el Supervisor
  private measureFace() {
    const head = this.p.model.getObjectByName('head');
    if (!head || this.p.anim) { this.faceLocal = null; return; }
    const name = this.p.currentName; this.p.play('Idle_A', 0);
    this.p.mixer.update(0); this.p.root.updateMatrixWorld(true);
    const qc = head.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.p.root.getWorldQuaternion(new THREE.Quaternion()));
    this.faceLocal = forward.applyQuaternion(qc.clone().invert()).normalize();
    if (name && name !== 'Idle_A') this.p.play(name, 0);
  }

  // Dónde deja la cadera el clip de sentarse respecto a los pies (cada figura la suya): el clip la echa ~0,3 m atrás y a
  // ~0,4 m del suelo. Se sienta poniendo esa cadera sobre el asiento de verdad (medido), no los pies en el centro de la
  // silla: así el respaldo no le atraviesa ni se hunde en el cojín.
  private hip: { behind: number; height: number } | null = null;
  private measureHip() {
    const bone = this.p.model.getObjectByName('hips');
    if (!bone || this.p.anim) { this.hip = null; return; }
    const name = this.p.currentName, rotation = this.p.root.rotation.y;
    this.p.root.rotation.y = 0; this.p.play('Sit_Chair_Idle', 0);
    this.p.mixer.update(0); this.p.root.updateMatrixWorld(true);
    const l = this.p.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    this.hip = { behind: -l.z, height: l.y };
    this.p.root.rotation.y = rotation;
    if (name && name !== 'Sit_Chair_Idle') this.p.play(name, 0);
  }
  /** altura (del mundo) del cojín de la silla en ese punto, con un rayo hacia abajo sobre los muebles de la sala */
  private static ray = new THREE.Raycaster();
  private seatHeight(center: THREE.Vector3) {
    const y0 = this.room.group.position.y;
    Dweller.ray.set(new THREE.Vector3(center.x, y0 + 0.85, center.z), new THREE.Vector3(0, -1, 0)); Dweller.ray.far = 0.8; Dweller.ray.camera = world.camara() ?? new THREE.PerspectiveCamera();   // los sprites lo piden
    const hit = Dweller.ray.intersectObject(this.room.group, true).find(i => i.point.y > y0 + 0.2 && i.point.y < y0 + 0.8 && (i.object as any).isMesh && (i.object as any).visible);
    return hit ? hit.point.y : null;
  }
  /** dónde van los pies para que la cadera caiga sobre el asiento, y por dónde se llega (al lado de la silla) */
  private placeInChair(pt: RoomPoint, center: THREE.Vector3) {
    const f = new THREE.Vector3(Math.sin(pt.rotation), 0, Math.cos(pt.rotation));
    const c = this.hip ?? { behind: 0.3, height: 0.4 };
    const root = center.clone().addScaledVector(f, c.behind + HIP_FORWARD);
    const cushion = this.seatHeight(center);
    root.y = this.room.group.position.y + (cushion != null ? Math.max(0, cushion - this.room.group.position.y - (c.height - MATTRESS)) : 0);
    // se llega por el lado de la silla que da a la cámara
    const side = new THREE.Vector3(f.z, 0, -f.x); if (side.z < 0) side.negate();
    const arrival = root.clone().addScaledVector(side, 0.6); arrival.y = this.room.group.position.y;
    arrival.z = THREE.MathUtils.clamp(arrival.z, this.room.group.position.z - BACKGROUND / 2 + 0.5, this.room.group.position.z + BACKGROUND / 2 - 0.45);
    return { root, arrival };
  }
  private chairOutput: THREE.Vector3 | null = null;

  /** el DJ de la discoteca: siempre en la mesa de mezclas */
  private get clickDJ() { return this.room.type === 'discoteca' && this.room.points.some(x => x.type === 'puesto' && x.ofFoot); }

  get pos() { return this.p.root.position; }
  get seated() { return this.seat; }

  /** Con trabajo en la sala: su sesión, o la de una copia de su sala (lo pone el refugio en cada fotograma) */
  private get atWork() { return this.state === 'trabajando' || (this.state === 'ocioso' && this.copyWorks); }
  roomWork(exists: boolean) {
    if (exists === this.copyWorks) return;
    this.copyWorks = exists;
    // sin sesión propia, se pone a trabajar (o lo deja) en cuanto la copia empieza (o acaba)
    if (this.state === 'ocioso' && !this.errand) { this.stay = null; this.sub = { until: 0, what: '' }; }
  }

  /** Al arrancar el refugio: ya en su sitio (en su puesto o en su afición), sin el paseo hasta él */
  initialHobby() {
    if (this.state !== 'ocioso') return;
    // al arrancar, cada uno en lo suyo: su afición, su ronda o de paseo (la mesa, para cuando haya trabajo)
    const exists = (t: RoomPoint['type']) => this.free(t).length > 0;
    this.newStay(this.clickDJ ? 'puesto' : exists('patrulla') ? 'patrulla' : exists('aficion') && Math.random() < 0.6 ? 'aficion' : undefined);
    const p = this.p;
    if (p.path.length) { const end = p.path[p.path.length - 1]; p.root.position.copy(end); const cb = p.onArrive; p.path = []; p.onArrive = null; cb?.(); }
    if (this.slide) { this.pos.copy(this.slide.until); this.slide = null; }
  }

  // sentado, tumbado o manejando algo en su sitio: no se le empuja
  get fixed() { return this.state === 'durmiendo' || this.seat || (this.arrived && !!this.point && ['cama', 'silla', 'aficion', 'puesto', 'pieza', 'consola'].includes(this.point.type)); }

  // la sala se ha reconstruido o trasladado: se muda con ella y retoma lo que hacía
  relocateTo(room: Room) {
    const local = this.pos.clone().sub(this.room.group.position);
    this.releasePoint(); this.point = null; this.room = room; this.seat = false; this.slide = null; this.standUpRest(); this.p.stop();
    this.pos.set(room.group.position.x + THREE.MathUtils.clamp(local.x, -4, 4), room.group.position.y, 1.2);
    this.stay = null;
    this.change(this.state, this.detail, this.tool);
  }

  private releasePoint() { if (this.point && this.point.busy === this.id.id) this.point.busy = null; this.point = null; this.arrived = false; }
  private free(type: RoomPoint['type']) { return this.room.points.filter(pt => pt.type === type && (!pt.busy || pt.busy === this.id.id)); }
  private world(local: THREE.Vector3) { return local.clone().add(this.room.group.position); }
  private access(target: THREE.Vector3) { const a = target.clone(); a.y = this.room.group.position.y; a.z = Math.max(a.z + 0.9, this.room.group.position.z - BACKGROUND / 2 + 1.4); return a; }

  /** De pie, el reposo no puede ser un clip sentado: al parar de andar (al llegar o si le paran a medio camino) se
   *  sentaría en el aire */
  private standUpRest() { if (SEATED_CLIPS.has(this.p.inRest)) this.p.inRest = 'Idle_A'; }
  /** Se levanta si está sentado (con su clip) y luego sigue */
  private standUp(then: () => void) {
    if (!this.seat) { this.standUpRest(); then(); return; }
    this.seat = false; this.standUpRest();
    const target = this.chairOutput ?? this.access(this.pos); this.chairOutput = null;
    this.untilBusy = this.timer + 0.9;
    this.p.gesture('Sit_Chair_StandUp', () => { this.slide = { since: this.pos.clone(), until: target, t: 0, dur: 0.3 }; then(); }, 0.15);
  }
  /** Sin clip (un aviso que no espera): de pie y fuera de la silla al momento */
  private leaveSeat() {
    if (this.seat || this.pos.y > this.room.group.position.y + 0.05) { const a = this.chairOutput ?? this.access(this.pos); if (this.seat) this.pos.copy(a); this.pos.y = this.room.group.position.y; }
    this.seat = false; this.slide = null; this.chairOutput = null; this.standUpRest();
  }

  /** Va a un punto (andando o al trote si está lejos), se coloca y luego hace lo suyo */
  private goAPoint(pt: RoomPoint, then: () => void) {
    if (this.point === pt && this.arrived && !this.p.path.length) { then(); return; }
    this.standUp(() => {
      this.releasePoint(); pt.busy = this.id.id; this.point = pt;
      const target = this.world(pt.pos);
      const run = Math.hypot(target.x - this.pos.x, target.z - this.pos.z) > 4.5 && this.state !== 'durmiendo' && this.state !== 'ocioso';
      if (isSeat(pt)) {
        // llega por el lado de la silla, se pone delante del asiento y se sienta hacia atrás (la cadera, sobre el cojín)
        const { root, arrival } = this.placeInChair(pt, target);
        this.p.goA([arrival], run, () => {
          this.p.goalTurn = pt.rotation;
          this.slide = { since: this.pos.clone(), until: root, t: 0, dur: 0.5 };
          this.arrived = true; this.seat = true; this.chairOutput = arrival; this.untilBusy = this.timer + 0.75;
          this.p.gesture('Sit_Chair_Down', () => then(), 0.25);
        });
      } else if (pt.type === 'cama') {
        // se acerca por delante y se tumba
        this.p.goA([this.access(target)], run, () => {
          this.p.goalTurn = pt.rotation; this.p.root.rotation.y = pt.rotation;
          this.slide = { since: this.pos.clone(), until: target, t: 0, dur: 0.01 };
          this.arrived = true;
          then();
        });
      } else this.p.goA(target, run, () => { this.p.goalTurn = pt.rotation; this.arrived = true; then(); });
    });
  }

  private withUtensil(name: string) {
    if (this.utensil === name) return;
    this.p.drop('mano'); this.utensil = name;
    const u = UTENSILS[name];
    if (u) this.p.couple('mano', { path: u.path, bone: u.bone, scale: u.scale, rot: u.rot, pos: u.pos });
  }

  // ---------------------------------------------------------------- encargos
  private errand: { until: number; then?: () => void } | null = null;
  get busyErrand() { return !!this.errand; }
  /** Un encargo de fuera (montar el proyector de su copia, holograms.ts): deja lo que hace, va a `destino`, se gira a
   *  `giro` y hace `clip` con `utensil` durante `dur` segundos; luego avisa y vuelve a su rutina. Si no puede (te espera,
   *  duerme, habla contigo, ya tiene otro), dice que no y no hace nada. */
  sendOnErrand(target: THREE.Vector3, rotation: number, clip: string, utensil: string, dur: number, then?: () => void) {
    const routine = this.state === 'ocioso' || this.state === 'pensando' || this.state === 'trabajando';
    if (!routine || this.chatting || this.errand || this.scan) return false;
    const e = this.errand = { until: Infinity, then };
    this.stay = null; this.sub = { until: Infinity, what: '' }; this.withUtensil('');
    this.standUp(() => {
      if (this.errand !== e) return;
      this.releasePoint(); this.chore = 'andar';
      this.p.goA(target, Math.hypot(target.x - this.pos.x, target.z - this.pos.z) > 4.5, () => {
        if (this.errand !== e) return;
        this.p.goalTurn = rotation; this.chore = 'trastear'; this.withUtensil(utensil);
        this.p.inRest = clip; this.p.play(clip, 0.3);
        audioWorld.action(this.pos.clone().setY(this.pos.y + 0.5), 'metal', 0.7, this.room);
        e.until = this.timer + dur;
      });
    });
    return true;
  }
  /** Acaba el encargo (hecho o interrumpido): avisa a quien lo pidió y vuelve a lo suyo */
  private endErrand() {
    const e = this.errand; if (!e) return;
    this.errand = null; this.withUtensil(''); this.stay = null; this.sub = { until: 0, what: '' };
    this.p.inRest = 'Idle_A'; if (!this.p.path.length) this.p.play('Idle_A', 0.3);
    e.then?.();
  }

  // Cambio de estado (lo dispara la sesión real o el modo demo)
  change(state: DwellerState, detail = '', tool: Tool = this.tool) {
    const previous = this.state, previousTool = this.tool;
    this.state = state; this.detail = detail; this.tool = tool;
    const p = this.p;
    // con un encargo a medias: entre ocioso, pensando y trabajando lo termina; lo demás (te espera, avería) lo corta
    if (this.errand) { if (state === 'ocioso' || state === 'pensando' || state === 'trabajando') return; p.stop(); this.endErrand(); }
    p.contactShadow.visible = true;
    if (state !== 'esperando' && state !== 'terminado') this.lookCamera = false;
    if (state === 'durmiendo') {
      this.withUtensil(''); this.stay = null; this.chore = 'dormir';
      const bed = this.free('cama')[0];
      if (bed) this.goAPoint(bed, () => { p.inRest = 'Lie_Idle'; p.part(/^espalda:/, false); p.contactShadow.visible = false; p.play('Lie_Idle', 0.5); });
      else { this.leaveSeat(); p.inRest = 'Sit_Floor_Idle'; p.play('Sit_Floor_Idle'); }
      return;
    }
    p.part(/^espalda:/, true);
    if (previous === 'durmiendo' && this.point?.type === 'cama') { p.root.position.y = this.room.group.position.y; p.root.position.z += 1.0; this.releasePoint(); }
    if (state === 'esperando') {
      this.withUtensil(''); this.stay = null; this.chore = 'avisar';
      this.releasePoint(); p.stop(); this.leaveSeat();
      this.lookCamera = true;
      p.inRest = 'Idle_A'; p.gesture('Waving', 'Idle_A');
      this.gestureClock = 3; this.waitingSince = performance.now();
    } else if (state === 'terminado') {
      this.withUtensil(''); this.stay = null; this.chore = 'celebrar';
      this.releasePoint(); p.stop(); this.leaveSeat();
      this.lookCamera = true;
      p.inRest = 'Idle_A'; p.gesture('Waving', 'Idle_A');
      this.gestureClock = 8;
    } else if (state === 'error') {
      this.withUtensil(''); this.stay = null; this.chore = 'averia';
      p.stop(); this.releasePoint(); this.leaveSeat();
      p.gesture('Hit_A', () => { p.inRest = 'Sit_Floor_Idle'; p.play('Sit_Floor_Down', 0.2, { loop: false }); setTimeout(() => this.state === 'error' && p.play('Sit_Floor_Idle', 0.3), 900); });
    } else {
      // ocioso, pensando o trabajando: la rutina. Si ya está sentado en su puesto y lo nuevo también va ahí, sigue
      // sentado y solo cambia lo que hace con las manos; si no, se replanea
      const inStation = this.point?.type === 'puesto' && this.arrived && (this.seat || !!this.point.ofFoot);
      const returnsOfNotice = ['esperando', 'terminado', 'error'].includes(previous);
      // entre pensar y trabajar (la sesión sigue en marcha) no se replanea a cada herramienta: termina lo que hacía en
      // la sala (la pieza, un aparato, la ronda) y luego vuelve a su puesto
      const running = (e: DwellerState) => e === 'pensando' || e === 'trabajando';
      const keepsAt = running(state) && running(previous) && !!this.stay && ['pieza', 'consola', 'patrulla'].includes(this.stay.where);
      if (state !== 'ocioso' && inStation && !returnsOfNotice) { this.stay = { where: 'puesto', until: this.timer + this.duration('puesto') }; this.sub.until = 0; }
      else if (keepsAt && !returnsOfNotice) { /* sigue con lo suyo */ }
      else if (state !== previous || tool !== previousTool || returnsOfNotice || !this.stay) {
        if (returnsOfNotice) { this.releasePoint(); p.inRest = 'Idle_A'; p.play('Idle_A', 0.3); }
        this.stay = null;
        if (state === 'ocioso' && !this.atWork && !returnsOfNotice && previous === 'ocioso') this.stay = { where: 'paseo', until: this.timer + between(1, 4) };
      }
    }
  }

  // ---------------------------------------------------------------- la rutina
  private duration(where: Stay) {
    const working = this.atWork, thinks = this.state === 'pensando';
    switch (where) {
      case 'puesto': return working ? between(60, 120) : thinks ? between(25, 45) : between(30, 60);
      case 'pieza': return between(9, 16);
      case 'patrulla': return between(30, 55);
      case 'aficion': return between(25, 45);
      case 'consola': return between(8, 14);
      default: return thinks ? between(7, 12) : between(12, 25);
    }
  }

  /** Elige dónde pasar el rato (o va a `forzar`) según su estado y lo que tiene la sala */
  private newStay(force?: Stay) {
    const exists = (t: RoomPoint['type']) => this.free(t).length > 0;
    const repeat = (e: Stay) => (this.last !== e || e === 'puesto' ? 1 : e === 'patrulla' ? 0.6 : e === 'paseo' ? 0.7 : 0.25);
    // de madrugada (hora de verdad), quien no tiene nada que hacer y tiene catre se echa a dormir un rato
    const h = new Date().getHours();
    if (!force && this.state === 'ocioso' && !this.atWork && (h >= 1 && h < 7) && exists('cama') && !this.chatting && !Dweller.still && Math.random() < 0.45) {
      this.wakeIn = this.timer + between(90, 300); this.change('durmiendo'); return;
    }
    // la mesa es solo para trabajar: con trabajo en la sala, casi siempre (en el ordenador, sin levantarse); pensando, a
    // menudo; sin nada que hacer, nunca: su afición, un paseo (café, periódico) o un vistazo a la pieza.
    // Los guardianes (salas con ruta de patrulla) no tienen mesa: patrullan
    // el DJ no deja los platos: en la discoteca, su sitio es la mesa de mezclas, con o sin sesión
    if (!force && this.clickDJ) force = 'puesto';
    let where: Stay = force ?? 'paseo';
    const onGuard = exists('patrulla');
    if (!force) {
      if (this.atWork) where = exists('puesto') ? shuffle<Stay>({ puesto: 0.94, pieza: exists('pieza') ? (this.tool === 'buscar' ? 0.15 : 0.06) * repeat('pieza') : 0 }) ?? 'puesto'
        : shuffle<Stay>({ pieza: exists('pieza') ? 0.5 * repeat('pieza') : 0, consola: exists('consola') ? 0.4 * repeat('consola') : 0, patrulla: onGuard ? 0.3 : 0 }) ?? 'paseo';
      else if (this.state === 'pensando') where = shuffle<Stay>({ puesto: exists('puesto') ? 0.85 : 0, pieza: exists('pieza') ? 0.1 * repeat('pieza') : 0, consola: exists('consola') ? 0.05 * repeat('consola') : 0, patrulla: onGuard ? 0.5 : 0 }) ?? 'paseo';
      else where = shuffle<Stay>({
        pieza: exists('pieza') ? 0.12 * repeat('pieza') : 0,
        aficion: exists('aficion') ? 0.5 * repeat('aficion') : 0,
        patrulla: onGuard ? 0.9 * repeat('patrulla') : 0,
        paseo: Dweller.still ? 0 : 0.4 * repeat('paseo'),
      }) ?? 'paseo';
    }
    if (Dweller.still && where === 'paseo') where = this.point && this.arrived ? (this.point.type as Stay) : 'paseo';
    this.last = where;
    this.stay = { where, until: this.timer + this.duration(where) };
    this.sub = { until: Infinity, what: '' }; this.step = 0;
    const p = this.p;
    const start = () => { this.sub.until = 0; };   // al llegar, la primera tarea de la estancia
    if (where === 'paseo') {
      this.standUp(() => {
        this.releasePoint(); this.withUtensil(Math.random() < 0.25 && this.state === 'ocioso' && !this.atWork ? 'taza' : '');
        const s = this.room; const zones = s.walkZones ?? [[-s.width / 2 + 1, s.width / 2 - 1]];
        let target: THREE.Vector3 | null = null;
        for (let k = 0; k < 10 && !target; k++) {
          const [a, b] = random(zones);
          const c = new THREE.Vector3(a + Math.random() * (b - a), 0, 1.0 + Math.random() * 0.8).add(s.group.position);
          if (Math.abs(c.x - this.pos.x) < 1.2 && k < 6) continue;   // que se note que va a algún sitio
          if (!Dweller.occupants().some(o => o !== p.root && Math.hypot(o.position.x - c.x, o.position.z - c.z) < 1.3)) target = c;
        }
        if (target) p.goA(target, Math.abs(target.x - this.pos.x) > 4.5 && this.state !== 'ocioso', start); else start();
      });
      return;
    }
    const type = where as RoomPoint['type'];
    const options = this.free(type);
    if (!options.length) { this.stay = { where: 'paseo', until: this.timer + 2 }; return; }
    // a su puesto, el suyo de siempre (el primero libre); a la pieza o los aparatos, a uno al azar
    const pt = type === 'puesto' ? options[0] : random(options);
    this.goAPoint(pt, start);
  }

  /** Dentro de la estancia: lo siguiente que hace (con las manos, la pieza o su afición) */
  private newSub() {
    const p = this.p, e = this.stay; if (!e) return;
    const pt = this.point;
    const working = this.atWork, thinks = this.state === 'pensando', free = !working && !thinks;
    // sentado para otra cosa (se replaneó mientras iba a la silla): se levanta y va a lo nuevo
    if (this.seat && e.where !== 'puesto') { this.newStay(e.where); return; }
    if (e.where === 'puesto' && pt?.type === 'puesto') {
      // en su puesto pero sin sentarse (se estaba levantando cuando volvió el trabajo): primero, a la silla
      if (!pt.ofFoot && !this.seat) { this.arrived = false; this.sub = { until: Infinity, what: '' }; this.goAPoint(pt, () => { this.sub.until = 0; }); return; }
      const what = working
        ? shuffle({ teclear: this.tool === 'leer' || this.tool === 'buscar' ? 0.7 : 0.94, leer: this.tool === 'leer' || this.tool === 'buscar' ? 0.3 : 0.06 })
        : thinks ? shuffle({ leer: 0.45, pensar: 0.3, teclear: 0.25 })
        // sin nada que hacer, con calma: nada de teclear (eso es trabajar)
        : shuffle({ leer: 0.4, cafe: 0.35, pensar: 0.25 });
      const q = (what ?? 'pensar') as keyof typeof SEATED;
      this.chore = q;
      this.withUtensil(q === 'leer' ? (this.tool === 'buscar' && working ? 'lupa' : 'diario') : q === 'cafe' ? 'taza' : '');
      this.typingRhythm = working ? between(1.5, 1.9) : between(0.6, 0.9);   // trabajando, a toda prisa
      if (pt.ofFoot && this.clickDJ) {
        // pinchando: manos en los platos y el mezclador; con el tema arriba, los brazos al aire
        const pulse = musicPulse(this.room.id);
        const clip = shuffle({ Working_B: 0.35, Working_A: 0.25, Interact: 0.2, Cheering: pulse.playing && pulse.energy > 0.7 ? 0.35 : 0.05 }) ?? 'Working_B';
        this.chore = 'trastear'; this.withUtensil('');
        p.inRest = clip === 'Cheering' ? 'Working_B' : clip;
        if (clip === 'Cheering') p.gesture('Cheering', 'Working_B', 0.2); else p.play(clip, 0.3);
        this.sub = { what: 'pinchar', until: this.timer + (clip === 'Cheering' ? 2 : between(4, 8)) };
        return;
      }
      if (pt.ofFoot) {
        // puesto de pie (banco, mesa de mezclas): trabaja de pie con las manos en la mesa
        const clip = q === 'teclear' ? random(['Working_A', 'Working_C']) : q === 'leer' ? 'Holding_B' : q === 'cafe' ? 'Use_Item' : 'Idle_B';
        p.inRest = clip; p.play(clip, 0.35);
      } else { p.inRest = SEATED[q]; p.play(SEATED[q], 0.4); }
      this.sub = { what: q, until: this.timer + (q === 'teclear' ? between(working ? 14 : 6, working ? 28 : 12) : q === 'cafe' ? between(6, 10) : between(working ? 4 : 8, working ? 7 : 16)) };
      return;
    }
    if (e.where === 'pieza' && pt?.type === 'pieza') {
      // sin trabajo solo le echa un vistazo (nada de manejarla: eso es trabajar)
      const actions = free ? [{ clip: 'Interact' } as NonNullable<RoomPoint['actions']>[number]] : pt.actions?.length ? pt.actions : [{ clip: pt.clip ?? 'Interact' }];
      const a = actions[this.step++ % actions.length];
      this.chore = 'pieza';
      this.withUtensil(a.utensil ?? TOOL_OF[a.clip] ?? '');
      p.inRest = a.clip; p.play(a.clip, 0.3);
      a.onMake?.();
      // y suena donde está (la pieza responde: metal, papel, pitidos…)
      const kind = SOUND_OF(a.clip, a.utensil);
      if (kind) setTimeout(() => audioWorld.action(this.pos.clone().setY(this.pos.y + 1), kind, 0.8, this.room), 350);
      const d = a.dur ?? Math.max(2.6, p.action(a.clip).getClip().duration * (1 + Math.floor(Math.random() * 2)));
      this.sub = { what: a.clip, until: this.timer + d };
      return;
    }
    if (e.where === 'aficion' && pt?.type === 'aficion') {
      this.chore = 'aficion';
      if (pt.utensil) this.withUtensil(pt.utensil); else this.withUtensil('');
      if (pt.clip) { p.inRest = pt.clip; p.play(pt.clip, 0.3); }
      this.gestureClock = 1.5;
      this.sub = { what: 'aficion', until: Infinity };
      return;
    }
    if (e.where === 'consola' && pt?.type === 'consola') {
      // los aparatos de la sala (armarios, hornos, terminales de pie): con la herramienta que toca si trabaja
      this.chore = 'trastear';
      const h = this.tool;
      const clip = working ? (h === 'terminal' ? 'Working_A' : h === 'buscar' ? 'Lockpicking' : h === 'web' ? 'Working_C' : pt.clip ?? 'Working_B') : pt.clip ?? 'Interact';
      this.withUtensil(working && h === 'buscar' ? 'lupa' : TOOL_OF[clip] ?? '');
      p.inRest = clip; p.play(clip, 0.35);
      this.sub = { what: clip, until: this.timer + between(5, 9) };
      return;
    }
    if (e.where === 'patrulla') {
      const patrol = this.room.points.filter(x => x.type === 'patrulla');
      if (this.sub.what === 'vigilar' || !pt || pt.type !== 'patrulla') {
        // a la siguiente parada de la ronda (o a la más cercana si acaba de empezar)
        const i = pt?.type === 'patrulla' ? patrol.indexOf(pt) : -1;
        const sig = i >= 0 ? patrol[(i + 1) % patrol.length] : patrol.slice().sort((a, b) => this.world(a.pos).distanceTo(this.pos) - this.world(b.pos).distanceTo(this.pos))[0];
        this.sub = { until: Infinity, what: 'ronda' };
        if (sig) this.goAPoint(sig, () => { this.sub.until = 0; this.sub.what = 'parada'; }); else this.sub.until = 0;
        return;
      }
      // en la parada: vigila hacia donde manda el punto, mira a un lado y a otro, a veces comprueba algo
      this.chore = 'mirar'; this.withUtensil('');
      p.goalTurn = pt.rotation;
      const clip = shuffle({ Idle_B: 0.55, Idle_A: 0.25, Interact: 0.2 }) ?? 'Idle_B';
      p.inRest = clip === 'Interact' ? 'Idle_A' : clip;
      if (clip === 'Interact') p.gesture('Interact', 'Idle_A'); else p.play(clip, 0.35);
      this.sub = { what: 'vigilar', until: this.timer + between(3, 6.5) };
      return;
    }
    // de paseo sin nada que hacer: a ratos, de pie con un café o el periódico
    if (free && !this.chatting && Math.random() < 0.55) {
      const q = Math.random() < 0.5 ? 'cafe' : 'leer';
      this.chore = q; this.withUtensil(q === 'cafe' ? 'taza' : 'diario');
      p.inRest = q === 'cafe' ? 'Use_Item' : 'Holding_B'; p.play(p.inRest, 0.35);
      this.sub = { what: q, until: this.timer + (q === 'cafe' ? between(5, 9) : between(7, 14)) };
      return;
    }
    // de paseo: mira alrededor, a la sala o a quien pase; a veces se estira o echa un vistazo a algo
    this.chore = this.chatting ? 'charlar' : 'pasear';
    if (this.utensil === 'diario') this.withUtensil('');
    const r = Math.random();
    if (!this.chatting && r < 0.3) p.goalTurn = (Math.random() - 0.5) * 2.2;
    else if (!this.chatting) p.goalTurn = Math.random() < 0.5 ? Math.PI + (Math.random() - 0.5) * 0.8 : (Math.random() - 0.5) * 0.6;
    p.inRest = r < 0.5 ? 'Idle_A' : 'Idle_B'; p.play(p.inRest, 0.35);
    this.sub = { what: 'mirar', until: this.timer + between(2.5, 5) };
  }

  update(dt: number) {
    const p = this.p;
    this.timer += dt;
    this.zzz.active = this.state === 'durmiendo' && p.currentName === 'Lie_Idle';
    if (this.zzz.active) { const c = p.model.getObjectByName('head'); if (c) { c.getWorldPosition(this.zzz.origin); this.zzz.origin.y += 0.75; this.zzz.origin.x += 0.25; this.zzz.origin.z += 0.2; } }
    this.zzz.update(dt);
    if (this.slide) {
      const d = this.slide; d.t += dt;
      const k = Math.min(1, d.t / d.dur), s = k * k * (3 - 2 * k);
      p.root.position.lerpVectors(d.since, d.until, s);
      if (k >= 1) this.slide = null;
    }
    if (this.state === 'durmiendo' && this.wakeIn && this.timer > this.wakeIn) { this.wakeIn = 0; this.change('ocioso'); }
    if (this.lookCamera && !p.path.length) p.goalTurn = 0;
    if (p.path.length) this.chore = 'andar';
    if (this.waitingAfterChat > 0) { this.waitingAfterChat -= dt; p.update(dt); return; }
    if (this.errand) { if (this.timer > this.errand.until) this.endErrand(); else { p.update(dt); return; } }
    this.watch(dt);
    const routine = this.state === 'ocioso' || this.state === 'pensando' || this.state === 'trabajando';
    // quien charla contigo sin trabajar se queda a tu lado (mirándote); trabajando, sigue con lo suyo
    const still = this.chatting && this.state === 'ocioso' && !this.atWork;
    if (still && !p.path.length && this.chore !== 'charlar' && !this.seat) { this.chore = 'charlar'; this.stay = null; if (!['Idle_A', 'Idle_B'].includes(p.currentName)) { p.inRest = 'Idle_A'; p.play('Idle_A', 0.3); } this.withUtensil(''); }
    if (still && this.seat && this.chore !== 'charlar' && this.timer > this.untilBusy) { this.chore = 'charlar'; this.withUtensil(''); p.inRest = SEATED.pensar; p.play(SEATED.pensar, 0.4); }
    if (routine && !still && !p.path.length && this.timer > this.untilBusy && !this.slide) {
      // le han parado a medio camino (una charla, un empujón): vuelve a ir a donde iba
      if (this.stay && this.sub.until === Infinity && this.sub.what !== 'aficion' && !this.arrived) this.newStay(this.stay.where);
      else if (!this.stay || (this.timer > this.stay.until && !(Dweller.still && !this.chatting && this.arrived))) this.newStay();
      else if (this.timer > this.sub.until) this.newSub();
    }
    // en su afición: gesto periódico (disparo, riego)
    if (this.state === 'ocioso' && this.point?.type === 'aficion' && this.arrived && this.point.gesture && !p.path.length) {
      this.gestureClock -= dt;
      if (this.gestureClock < 0) { const gs = this.point.gesture; this.gestureClock = gs.every * (0.7 + Math.random() * 0.6); p.gesture(gs.clip, p.inRest, 0.08); gs.onMake?.(); }
    }
    if (this.state === 'esperando') {
      this.gestureClock -= dt;
      if (this.gestureClock < 0) { this.gestureClock = 4 + Math.random() * 2; if (!p.path.length) callOut(p, this.waitingSince); }
    }
    if (this.state === 'terminado') {
      this.gestureClock -= dt;
      // terminado: te espera con paciencia, saludando de vez en cuando (sin saltar: eso es para cuando te necesita)
      if (this.gestureClock < 0) { this.gestureClock = 8 + Math.random() * 5; if (!p.path.length) p.gesture('Waving', 'Idle_A'); }
    }
    // el tecleo de las manos sube y baja con suavidad (al sentarse, al cambiar de tarea)
    const typing = this.chore === 'teclear' && this.seat && p.currentName === SEATED.teclear;
    this.typing = THREE.MathUtils.damp(this.typing, typing ? 1 : 0, 6, dt);
    // mirada: solo de pie y sin nada entre manos (en reposo, paseando o charlando contigo), y a vistazos: unos segundos y
    // vuelve a lo suyo. Sentado, trabajando o andando no se gira: la cabeza tiene su sitio
    const sup = world.supervisor();
    let wants = 0;
    const free = !this.seat && !p.path.length && !this.slide && this.timer > this.untilBusy && (this.state === 'ocioso' || this.state === 'terminado') && (this.chore === 'pasear' || this.chore === 'mirar' || this.chore === 'charlar' || this.chore === 'celebrar');
    if (sup && free && Math.abs(sup.position.y - this.pos.y) < 1) {
      const d = Math.hypot(sup.position.x - this.pos.x, sup.position.z - this.pos.z);
      if (this.chatting) wants = 1;
      else if (d < 2.6) {
        if (this.timer > this.glance.until && this.timer > this.glance.next) { this.glance.until = this.timer + between(1.5, 3); this.glance.next = this.glance.until + between(5, 11); }
        wants = this.timer < this.glance.until ? 0.8 : 0;
      }
    }
    this.gaze = THREE.MathUtils.damp(this.gaze, wants, 2.5, dt);
    const length = this.sessionId ? (live.get().partial[this.sessionId] ?? '').length : 0;
    if (length !== this.partialLong) { if (length > this.partialLong) this.untilSpeaks = this.timer + 0.8; this.partialLong = length; }
    this.speaks = THREE.MathUtils.damp(this.speaks, this.talking && this.state !== 'durmiendo' ? 1 : 0, 5, dt);
    p.update(dt);
  }

  // ---------------------------------------------------------------- guardianes: escanean a quien entra
  private scan: { t: number; ring: THREE.Mesh; beam: THREE.Mesh } | null = null;
  private supInside = false; private lastScan = -999;
  private watch(dt: number) {
    const sup = world.supervisor(), p = this.p;
    if (this.scan) { this.animateScan(dt); return; }
    if (!sup || !this.room.points.some(x => x.type === 'patrulla')) return;
    const s = this.room.group.position;
    const inside = Math.abs(sup.position.y - s.y) < 1 && Math.abs(sup.position.x - s.x) < this.room.width / 2;
    const enters = inside && !this.supInside; this.supInside = inside;
    if (!enters || this.timer - this.lastScan < 25) return;
    if (this.state !== 'ocioso' || this.chatting || this.seat || this.timer < this.untilBusy || Math.hypot(sup.position.x - this.pos.x, sup.position.z - this.pos.z) > 7) return;
    // alto: se planta, se gira hacia quien llega y le pasa el escáner de arriba abajo
    this.lastScan = this.timer;
    p.stop(); this.stay = { where: this.stay?.where ?? 'patrulla', until: this.timer + 4 }; this.sub = { until: this.timer + 3.4, what: 'escanear' };
    this.releasePoint();
    p.goalTurn = Math.atan2(sup.position.x - this.pos.x, sup.position.z - this.pos.z);
    p.inRest = 'Idle_A'; p.gesture('Interact', 'Idle_A', 0.25);   // señala; escanea con el ojo (con la katana en alto parecía una amenaza)
    this.untilBusy = this.timer + 3.2; this.chore = 'avisar';
    const light = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff8a').multiplyScalar(1.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 48), light); ring.rotation.x = Math.PI / 2;
    // el plano del barrido: un disco tenue dentro del anillo (de frente, el anillo solo es una línea)
    const veil = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff8a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const disco = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), veil); ring.add(disco);   // hijo del anillo: ya está tumbado con él
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), light);
    p.root.parent?.add(ring, beam);
    this.scan = { t: 0, ring, beam };
    setTimeout(() => SFX.holoAppears(), 450);
  }
  private animateScan(dt: number) {
    const e = this.scan!, sup = world.supervisor(); e.t += dt;
    const m = e.ring.material as THREE.MeshBasicMaterial;
    // 0,5 s levantando la mano; luego el anillo baja y sube por el cuerpo (2 s) y se apaga
    const k = THREE.MathUtils.clamp((e.t - 0.5) / 2, 0, 1);
    const veil = (e.ring.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial | undefined;
    m.opacity = e.t < 0.5 ? 0 : k < 0.1 ? k * 10 * 0.9 : k > 0.9 ? (1 - k) * 10 * 0.9 : 0.9 * (0.75 + 0.25 * Math.sin(e.t * 40));
    if (veil) veil.opacity = m.opacity * 0.22;
    if (sup) {
      const y = sup.position.y + 0.08 + 1.95 * (0.5 + 0.5 * Math.cos(k * Math.PI * 2));
      e.ring.position.set(sup.position.x, y, sup.position.z);
      // el haz, del ojo (la cabeza) del guardián al anillo
      const onInput = this.p.headPoint(new THREE.Vector3()).add(new THREE.Vector3(0, -0.35, 0));
      const end = e.ring.position.clone(), media = onInput.clone().add(end).multiplyScalar(0.5);
      e.beam.position.copy(media); e.beam.scale.set(1, onInput.distanceTo(end), 1);
      e.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(onInput).normalize());
    }
    if (e.t > 2.6) {
      e.ring.parent?.remove(e.ring, e.beam); e.ring.geometry.dispose(); e.beam.geometry.dispose(); m.dispose(); if (veil) { veil.dispose(); (e.ring.children[0] as THREE.Mesh).geometry.dispose(); }
      this.scan = null;
      SFX.shortSuccess(); audioWorld.say(this, 'saludo');
      this.p.gesture('Interact', 'Idle_A', 0.2);   // «adelante»
    }
  }

  /** Retoques sobre la pose ya animada: la cabeza del que duerme hacia la cámara, la mirada al Supervisor y el
   *  tecleo de las manos (KayKit no trae dedos: muñecas y antebrazos que suben y bajan, a destiempo) */
  private retouch() {
    const p = this.p;
    const head = p.model.getObjectByName('head');
    if (!head || !this.faceLocal) return;
    if (this.state === 'durmiendo' && p.currentName === 'Lie_Idle') { this.turnFace(head, new THREE.Vector3(0.15, 0.35, 1).normalize(), 0.85, Math.PI); return; }
    if (this.gaze > 0.01) {
      // solo giro alrededor de la vertical y medido respecto al cuerpo: como mucho ±35°, repartido entre pecho y cabeza
      const sup = world.supervisor();
      if (sup) {
        let delta = Math.atan2(sup.position.x - this.pos.x, sup.position.z - this.pos.z) - p.root.rotation.y;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const rotation = THREE.MathUtils.clamp(delta, -0.62, 0.62) * this.gaze;
        const above = new THREE.Vector3(0, 1, 0), chest = p.model.getObjectByName('chest');
        if (chest) turnBoneWorld(chest, above, rotation * 0.3);
        turnBoneWorld(head, above, rotation * (chest ? 0.7 : 1));
      }
    }
    if (this.speaks > 0.01) {
      // al hablar asiente y acompaña con la cabeza (sin boca que mover: KayKit no la trae)
      const q = head.getWorldQuaternion(new THREE.Quaternion());
      const side = this.faceLocal.clone().applyQuaternion(q).cross(new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() > 1e-6) {
        const t = this.timer;
        turnBoneWorld(head, side.normalize(), (Math.sin(t * 8.5) * 0.035 + Math.sin(t * 5.1 + 1) * 0.025) * this.speaks);
        turnBoneWorld(head, new THREE.Vector3(0, 1, 0), Math.sin(t * 2.3) * 0.04 * this.speaks);
      }
    }
    if (this.typing > 0.01) {
      const t = this.timer * 7.5 * this.typingRhythm, above = new THREE.Vector3(0, 1, 0);
      for (const [side, phase] of [['l', 0], ['r', 1.9]] as const) {
        const arm = p.model.getObjectByName('lowerarm' + side), onInput = p.model.getObjectByName('hand' + side);
        if (!arm || !onInput) continue;
        const a = arm.getWorldPosition(new THREE.Vector3()), b = onInput.getWorldPosition(new THREE.Vector3());
        const axis = b.sub(a).cross(above); if (axis.lengthSq() < 1e-6) continue; axis.normalize();
        // golpes cortos y desiguales: la suma de dos senos con el ritmo de quien escribe a rachas
        const beat = Math.max(0, Math.sin(t + phase)) ** 3 * 0.75 + Math.max(0, Math.sin(t * 1.63 + phase * 2.1)) ** 4 * 0.5;
        const gust = 0.55 + 0.45 * Math.sin(this.timer * 0.9 + phase);
        turnBoneWorld(arm, axis, -0.16 * beat * gust * this.typing);
        turnBoneWorld(onInput, axis, -0.22 * beat * gust * this.typing);
      }
    }
  }

  private turnFace(head: THREE.Object3D, goal: THREE.Vector3, weight: number, max: number) {
    const q = head.getWorldQuaternion(new THREE.Quaternion());
    const face = this.faceLocal!.clone().applyQuaternion(q);
    let rotation = new THREE.Quaternion().setFromUnitVectors(face, goal);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(rotation.w)));
    if (ang > max) rotation = new THREE.Quaternion().slerp(rotation, max / ang);   // no se tuerce el cuello
    const partial = new THREE.Quaternion().slerp(rotation, weight);
    const a = 2 * Math.acos(Math.min(1, partial.w)); if (a < 1e-3) return;
    turnBoneWorld(head, new THREE.Vector3(partial.x, partial.y, partial.z).normalize(), a);
  }
}
