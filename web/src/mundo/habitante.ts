// Habitante: un personaje KayKit con identidad, una rutina de trabajo y una máquina de estados que traduce lo que pasa
// en su sesión de Claude Code a animación (§5.3).
// - Cada uno tiene su puesto (su mesa: punto 'puesto' de la sala) y ahí pasa la mayor parte del día, sentado: teclea,
//   lee, se toma un café, piensa. Con una sesión trabaja ahí sin levantarse (teclea a toda prisa); pensando, lee y
//   piensa, y a ratos se levanta a mirar la pieza de la sala.
// - La pieza característica de la sala (puntos 'pieza'): va de vez en cuando y la maneja con las acciones de la sala.
// - Sin sesión, con calma: sentado en su mesa leyendo, con un café o pensando, o en su afición; poca pieza, algún paseo
//   y nunca corriendo (que se le pueda hacer clic).
// - Encargos (`encargar`): deja lo que hace, va a un sitio, lo hace y vuelve a lo suyo (montar el proyector de su copia).
// - Termina = celebra; error = golpe y al suelo; espera permiso = se levanta, te mira y saluda; duerme en su catre.
// - Se sienta y se levanta de verdad (clips de KayKit) y sigue al Supervisor con la mirada cuando anda cerca.
import * as THREE from 'three';
import { Character, turnBoneWorld, callOut } from './personaje';
import { composeClip } from './animaciones';
import { lookOf, type Look } from '@shared/aspecto';
import { Zetas } from './efectos';
import type { Sala, RoomPoint } from './sala';
import { BACKGROUND } from './sala';
import { R } from '../motor/assets';
import { mundo } from './salas/comun';
import { vivo } from '../red/cliente';
import { audioWorld } from '../audio/mundo';
import { musicPulse } from '../audio/musica';
import { SFX } from '../audio/sonido';
import type { DwellerState } from '../ui/estadoJuego';

export interface Identity { id: string; nombre: string; mote: string; tipo: string; bio: string; tinte?: string; tone?: number; voz: number; aspecto?: Look }

type Herramienta = 'leer' | 'editar' | 'terminal' | 'buscar' | 'web' | 'subagente' | 'otra';
type Stay = 'puesto' | 'pieza' | 'aficion' | 'paseo' | 'consola' | 'patrulla';
/** Lo que hace ahora (lo lee el audio del mundo: el tecleo, los murmullos) */
export type Chore = 'teclear' | 'leer' | 'cafe' | 'pensar' | 'pieza' | 'aficion' | 'pasear' | 'mirar' | 'charlar' | 'dormir' | 'avisar' | 'celebrar' | 'averia' | 'andar' | 'trastear';

// Accesorio por actividad (se engancha al hueso de la mano)
const UTENSILS: Record<string, { ruta: string; bone: 'handslotr' | 'handslotl'; escala: number; rot?: [number, number, number]; pos?: [number, number, number] }> = {
  diario: { ruta: R.herr('journal_open'), bone: 'handslotl', escala: 0.55, rot: [0.2, Math.PI, 0] },
  martillo: { ruta: R.herr('hammer'), bone: 'handslotr', escala: 0.7 },
  llave: { ruta: R.herr('wrench_A'), bone: 'handslotr', escala: 0.75 },
  lupa: { ruta: R.herr('magnifying_glass'), bone: 'handslotr', escala: 0.7 },
  taza: { ruta: R.mueble('mug_A'), bone: 'handslotr', escala: 0.55 },
  sierra: { ruta: R.herr('saw'), bone: 'handslotr', escala: 0.65 },
  ballesta: { ruta: 'kaykit/adventurers-2.0/Assets/gltf/crossbow_1handed.gltf', bone: 'handslotr', escala: 1 },
  regadera: { ruta: R.herr('bucket_metal'), bone: 'handslotr', escala: 0.45 },
  tijeras: { ruta: R.herr('scissors'), bone: 'handslotr', escala: 0.6 },
};

const KATANA = { ruta: 'kaykit/mystery-monthly-series-6/7 - January 2026 - 4GTN/assets/gltf/4GTN_Katana.gltf', bone: 'handl' as const, escala: 1, rot: [0, 0, -1.3] as [number, number, number] };   // su esqueleto (Rig_Large) no tiene handslot: va en la mano

// Sentado a la mesa: el tren inferior de «sentado en la silla» con los brazos de otro clip de KayKit (no trae teclear ni
// leer sentado); el tecleo de los dedos se añade encima (ver retocar)
const SEATED = { teclear: 'Sentado_Teclear', leer: 'Sentado_Leer', cafe: 'Sentado_Cafe', pensar: 'Sit_Chair_Idle' } as const;
let composed = false;
function composeSeated() {
  if (composed) return; composed = true;
  composeClip(SEATED.teclear, 'Sit_Chair_Idle', 'Holding_A', { fixedBelow: true });
  composeClip(SEATED.leer, 'Sit_Chair_Idle', 'Holding_B', { fixedBelow: true });
  composeClip(SEATED.cafe, 'Sit_Chair_Idle', 'Use_Item', { fixedBelow: true, upSpeed: 0.6 });
}
const azar = <T,>(l: readonly T[]) => l[Math.floor(Math.random() * l.length)];
const entre = (a: number, b: number) => a + Math.random() * (b - a);
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
function SOUND_OF(clip: string, utensil?: string): Parameters<typeof audioWorld.accion>[1] | null {
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
const isSeat = (pt: RoomPoint) => pt.tipo === 'silla' || (pt.tipo === 'puesto' && !pt.ofFoot);

export class Habitante {
  static occupants: () => THREE.Object3D[] = () => [];
  static quieto = false; // durante una charla nadie se pasea por delante (quien charla lo marca `charlando`)
  p: Character;
  id: Identity;
  sala: Sala;
  estado: DwellerState = 'ocioso';
  detalle = '';
  herramienta: Herramienta = 'otra';
  lookCamera = false;
  sesionId?: string;
  waitingAfterChat = 0;   // al alejarte, se queda unos segundos por si se te ocurre algo más
  chatting = false;         // habla con el Supervisor (lo pone el refugio): si no trabaja, no se va de su lado
  chore: Chore = 'mirar';
  zetas = new Zetas(new THREE.Vector3());
  private punto: RoomPoint | null = null;
  private arrived = false;   // ya está en su punto (no andando hacia él)
  private seat = false;   // sentado en la silla de su punto
  private stay: { donde: Stay; hasta: number } | null = null;
  private ultima: Stay | '' = '';
  private sub = { hasta: 0, que: '' };
  private reloj = 0;
  private untilBusy = 0;  // sentándose o levantándose: no se le interrumpe
  private slide: { desde: THREE.Vector3; hasta: THREE.Vector3; t: number; dur: number } | null = null;
  private gestureClock = 4;
  private waitingSince = 0;   // desde cuándo te espera (al rato, además de saludar, salta)
  private utensil = '';
  private paso = 0;          // acción de la pieza en curso
  private typing = 0;        // intensidad del tecleo de las manos (0..1, suavizada)
  private typingRhythm = 1;
  private gaze = 0;        // peso del giro de cabeza hacia el Supervisor
  private faceLocal: THREE.Vector3 | null = null;
  private vistazo = { hasta: 0, siguiente: 0 };
  private wakeIn = 0;   // la siesta de madrugada acaba sola
  private partialLong = 0; private untilSpeaks = 0; private speaks = 0;
  /** su respuesta está llegando (el texto en streaming de su sesión): habla, con la cabeza y con la voz (audio) */
  get talking() { return this.reloj < this.untilSpeaks; }

  constructor(id: Identity, sala: Sala) { this.id = id; this.sala = sala; this.p = new Character(id.tipo, id.tipo === 'Octocat' ? null : lookOf(id)); }

  async cargar() {
    await this.p.cargar();
    composeSeated();
    // a pie, con brío (más rápido que el paso de paseo de KayKit, que se hacía eterno en una sala de 12 m)
    this.p.marcha = { andar: 'Walking_A', correr: 'Running_A', walkRhythm: 1.5, runRhythm: 0.88 };
    if (this.id.tinte) this.p.tint(this.id.tinte, 0.18);
    // el androide samurái no suelta su katana (la que trae su modelo), en la izquierda: la derecha es para los utensilios
    if ((this.id.id === 'hanzo' || this.id.tipo === '4GTN') && this.p.figura?.grande) await this.p.couple('katana', KATANA);
    this.p.raiz.userData.habitante = this;
    this.measureFace(); this.measureHip();
    this.p.animateAfter = () => this.retouch();
    this.p.onChangeLook = () => { this.measureFace(); this.measureHip(); if (this.estado === 'durmiendo') this.p.parte(/^espalda:/, false); };
    return this;
  }

  // En qué eje local de la cabeza mira la cara (en reposo de pie mira al frente del personaje): para girarla luego hacia
  // la cámara (dormido) o hacia el Supervisor
  private measureFace() {
    const cabeza = this.p.modelo.getObjectByName('head');
    if (!cabeza || this.p.anim) { this.faceLocal = null; return; }
    const nombre = this.p.currentName; this.p.reproducir('Idle_A', 0);
    this.p.mixer.update(0); this.p.raiz.updateMatrixWorld(true);
    const qc = cabeza.getWorldQuaternion(new THREE.Quaternion());
    const frente = new THREE.Vector3(0, 0, 1).applyQuaternion(this.p.raiz.getWorldQuaternion(new THREE.Quaternion()));
    this.faceLocal = frente.applyQuaternion(qc.clone().invert()).normalize();
    if (nombre && nombre !== 'Idle_A') this.p.reproducir(nombre, 0);
  }

  // Dónde deja la cadera el clip de sentarse respecto a los pies (cada figura la suya): el clip la echa ~0,3 m atrás y a
  // ~0,4 m del suelo. Se sienta poniendo esa cadera sobre el asiento de verdad (medido), no los pies en el centro de la
  // silla: así el respaldo no le atraviesa ni se hunde en el cojín.
  private hip: { atras: number; alto: number } | null = null;
  private measureHip() {
    const bone = this.p.modelo.getObjectByName('hips');
    if (!bone || this.p.anim) { this.hip = null; return; }
    const nombre = this.p.currentName, giro = this.p.raiz.rotation.y;
    this.p.raiz.rotation.y = 0; this.p.reproducir('Sit_Chair_Idle', 0);
    this.p.mixer.update(0); this.p.raiz.updateMatrixWorld(true);
    const l = this.p.raiz.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    this.hip = { atras: -l.z, alto: l.y };
    this.p.raiz.rotation.y = giro;
    if (nombre && nombre !== 'Sit_Chair_Idle') this.p.reproducir(nombre, 0);
  }
  /** altura (del mundo) del cojín de la silla en ese punto, con un rayo hacia abajo sobre los muebles de la sala */
  private static rayo = new THREE.Raycaster();
  private seatHeight(centro: THREE.Vector3) {
    const y0 = this.sala.grupo.position.y;
    Habitante.rayo.set(new THREE.Vector3(centro.x, y0 + 0.85, centro.z), new THREE.Vector3(0, -1, 0)); Habitante.rayo.far = 0.8; Habitante.rayo.camera = mundo.camara() ?? new THREE.PerspectiveCamera();   // los sprites lo piden
    const hit = Habitante.rayo.intersectObject(this.sala.grupo, true).find(i => i.point.y > y0 + 0.2 && i.point.y < y0 + 0.8 && (i.object as any).isMesh && (i.object as any).visible);
    return hit ? hit.point.y : null;
  }
  /** dónde van los pies para que la cadera caiga sobre el asiento, y por dónde se llega (al lado de la silla) */
  private placeInChair(pt: RoomPoint, centro: THREE.Vector3) {
    const f = new THREE.Vector3(Math.sin(pt.giro), 0, Math.cos(pt.giro));
    const c = this.hip ?? { atras: 0.3, alto: 0.4 };
    const raiz = centro.clone().addScaledVector(f, c.atras + HIP_FORWARD);
    const cushion = this.seatHeight(centro);
    raiz.y = this.sala.grupo.position.y + (cushion != null ? Math.max(0, cushion - this.sala.grupo.position.y - (c.alto - MATTRESS)) : 0);
    // se llega por el lado de la silla que da a la cámara
    const lado = new THREE.Vector3(f.z, 0, -f.x); if (lado.z < 0) lado.negate();
    const arrival = raiz.clone().addScaledVector(lado, 0.6); arrival.y = this.sala.grupo.position.y;
    arrival.z = THREE.MathUtils.clamp(arrival.z, this.sala.grupo.position.z - BACKGROUND / 2 + 0.5, this.sala.grupo.position.z + BACKGROUND / 2 - 0.45);
    return { raiz, arrival };
  }
  private chairOutput: THREE.Vector3 | null = null;

  /** el DJ de la discoteca: siempre en la mesa de mezclas */
  private get clickDJ() { return this.sala.tipo === 'discoteca' && this.sala.puntos.some(x => x.tipo === 'puesto' && x.ofFoot); }

  get pos() { return this.p.raiz.position; }
  get sentado() { return this.seat; }

  /** Al arrancar el refugio: ya en su sitio (en su puesto o en su afición), sin el paseo hasta él */
  initialHobby() {
    if (this.estado !== 'ocioso') return;
    // al arrancar, cada uno en lo suyo: su afición, la pieza de la sala o su ronda (la mesa, para cuando haya trabajo)
    const hay = (t: RoomPoint['tipo']) => this.free(t).length > 0;
    this.newStay(this.clickDJ ? 'puesto' : hay('patrulla') ? 'patrulla' : hay('aficion') && Math.random() < 0.6 ? 'aficion' : hay('pieza') ? 'pieza' : undefined);
    const p = this.p;
    if (p.ruta.length) { const fin = p.ruta[p.ruta.length - 1]; p.raiz.position.copy(fin); const cb = p.onArrive; p.ruta = []; p.onArrive = null; cb?.(); }
    if (this.slide) { this.pos.copy(this.slide.hasta); this.slide = null; }
  }

  // sentado, tumbado o manejando algo en su sitio: no se le empuja
  get fijo() { return this.estado === 'durmiendo' || this.seat || (this.arrived && !!this.punto && ['cama', 'silla', 'aficion', 'puesto', 'pieza', 'consola'].includes(this.punto.tipo)); }

  // la sala se ha reconstruido o trasladado: se muda con ella y retoma lo que hacía
  mudarA(sala: Sala) {
    const local = this.pos.clone().sub(this.sala.grupo.position);
    this.releasePoint(); this.punto = null; this.sala = sala; this.p.parar(); this.seat = false; this.slide = null;
    this.pos.set(sala.grupo.position.x + THREE.MathUtils.clamp(local.x, -4, 4), sala.grupo.position.y, 1.2);
    this.stay = null;
    this.cambiar(this.estado, this.detalle, this.herramienta);
  }

  private releasePoint() { if (this.punto && this.punto.ocupado === this.id.id) this.punto.ocupado = null; this.punto = null; this.arrived = false; }
  private free(tipo: RoomPoint['tipo']) { return this.sala.puntos.filter(pt => pt.tipo === tipo && (!pt.ocupado || pt.ocupado === this.id.id)); }
  private mundo(local: THREE.Vector3) { return local.clone().add(this.sala.grupo.position); }
  private acceso(destino: THREE.Vector3) { const a = destino.clone(); a.y = this.sala.grupo.position.y; a.z = Math.max(a.z + 0.9, this.sala.grupo.position.z - BACKGROUND / 2 + 1.4); return a; }

  /** Se levanta si está sentado (con su clip) y luego sigue */
  private levantarse(luego: () => void) {
    if (!this.seat) { luego(); return; }
    this.seat = false;
    const destino = this.chairOutput ?? this.acceso(this.pos); this.chairOutput = null;
    this.untilBusy = this.reloj + 0.9;
    this.p.gesture('Sit_Chair_StandUp', () => { this.slide = { desde: this.pos.clone(), hasta: destino, t: 0, dur: 0.3 }; luego(); }, 0.15);
  }
  /** Sin clip (un aviso que no espera): de pie y fuera de la silla al momento */
  private leaveSeat() {
    if (this.seat || this.pos.y > this.sala.grupo.position.y + 0.05) { const a = this.chairOutput ?? this.acceso(this.pos); if (this.seat) this.pos.copy(a); this.pos.y = this.sala.grupo.position.y; }
    this.seat = false; this.slide = null; this.chairOutput = null;
  }

  /** Va a un punto (andando o al trote si está lejos), se coloca y luego hace lo suyo */
  private goAPoint(pt: RoomPoint, luego: () => void) {
    if (this.punto === pt && this.arrived && !this.p.ruta.length) { luego(); return; }
    this.levantarse(() => {
      this.releasePoint(); pt.ocupado = this.id.id; this.punto = pt;
      const destino = this.mundo(pt.pos);
      const correr = Math.hypot(destino.x - this.pos.x, destino.z - this.pos.z) > 4.5 && this.estado !== 'durmiendo' && this.estado !== 'ocioso';
      if (isSeat(pt)) {
        // llega por el lado de la silla, se pone delante del asiento y se sienta hacia atrás (la cadera, sobre el cojín)
        const { raiz, arrival } = this.placeInChair(pt, destino);
        this.p.goA([arrival], correr, () => {
          this.p.goalTurn = pt.giro;
          this.slide = { desde: this.pos.clone(), hasta: raiz, t: 0, dur: 0.5 };
          this.arrived = true; this.seat = true; this.chairOutput = arrival; this.untilBusy = this.reloj + 0.75;
          this.p.gesture('Sit_Chair_Down', () => luego(), 0.25);
        });
      } else if (pt.tipo === 'cama') {
        // se acerca por delante y se tumba
        this.p.goA([this.acceso(destino)], correr, () => {
          this.p.goalTurn = pt.giro; this.p.raiz.rotation.y = pt.giro;
          this.slide = { desde: this.pos.clone(), hasta: destino, t: 0, dur: 0.01 };
          this.arrived = true;
          luego();
        });
      } else this.p.goA(destino, correr, () => { this.p.goalTurn = pt.giro; this.arrived = true; luego(); });
    });
  }

  private withUtensil(nombre: string) {
    if (this.utensil === nombre) return;
    this.p.soltar('mano'); this.utensil = nombre;
    const u = UTENSILS[nombre];
    if (u) this.p.couple('mano', { ruta: u.ruta, bone: u.bone, escala: u.escala, rot: u.rot, pos: u.pos });
  }

  // ---------------------------------------------------------------- encargos
  private errand: { hasta: number; luego?: () => void } | null = null;
  get busyErrand() { return !!this.errand; }
  /** Un encargo de fuera (montar el proyector de su copia, hologramas.ts): deja lo que hace, va a `destino`, se gira a
   *  `giro` y hace `clip` con `utensil` durante `dur` segundos; luego avisa y vuelve a su rutina. Si no puede (te espera,
   *  duerme, habla contigo, ya tiene otro), dice que no y no hace nada. */
  encargar(destino: THREE.Vector3, giro: number, clip: string, utensil: string, dur: number, luego?: () => void) {
    const routine = this.estado === 'ocioso' || this.estado === 'pensando' || this.estado === 'trabajando';
    if (!routine || this.chatting || this.errand || this.scan) return false;
    const e = this.errand = { hasta: Infinity, luego };
    this.stay = null; this.sub = { hasta: Infinity, que: '' }; this.withUtensil('');
    this.levantarse(() => {
      if (this.errand !== e) return;
      this.releasePoint(); this.chore = 'andar';
      this.p.goA(destino, Math.hypot(destino.x - this.pos.x, destino.z - this.pos.z) > 4.5, () => {
        if (this.errand !== e) return;
        this.p.goalTurn = giro; this.chore = 'trastear'; this.withUtensil(utensil);
        this.p.inRest = clip; this.p.reproducir(clip, 0.3);
        audioWorld.accion(this.pos.clone().setY(this.pos.y + 0.5), 'metal', 0.7, this.sala);
        e.hasta = this.reloj + dur;
      });
    });
    return true;
  }
  /** Acaba el encargo (hecho o interrumpido): avisa a quien lo pidió y vuelve a lo suyo */
  private endErrand() {
    const e = this.errand; if (!e) return;
    this.errand = null; this.withUtensil(''); this.stay = null; this.sub = { hasta: 0, que: '' };
    this.p.inRest = 'Idle_A'; if (!this.p.ruta.length) this.p.reproducir('Idle_A', 0.3);
    e.luego?.();
  }

  // Cambio de estado (lo dispara la sesión real o el modo demo)
  cambiar(estado: DwellerState, detalle = '', herramienta: Herramienta = this.herramienta) {
    const anterior = this.estado, toolAnterior = this.herramienta;
    this.estado = estado; this.detalle = detalle; this.herramienta = herramienta;
    const p = this.p;
    // con un encargo a medias: entre ocioso, pensando y trabajando lo termina; lo demás (te espera, avería) lo corta
    if (this.errand) { if (estado === 'ocioso' || estado === 'pensando' || estado === 'trabajando') return; p.parar(); this.endErrand(); }
    p.contactShadow.visible = true;
    if (estado !== 'esperando' && estado !== 'terminado') this.lookCamera = false;
    if (estado === 'durmiendo') {
      this.withUtensil(''); this.stay = null; this.chore = 'dormir';
      const cama = this.free('cama')[0];
      if (cama) this.goAPoint(cama, () => { p.inRest = 'Lie_Idle'; p.parte(/^espalda:/, false); p.contactShadow.visible = false; p.reproducir('Lie_Idle', 0.5); });
      else { this.leaveSeat(); p.inRest = 'Sit_Floor_Idle'; p.reproducir('Sit_Floor_Idle'); }
      return;
    }
    p.parte(/^espalda:/, true);
    if (anterior === 'durmiendo' && this.punto?.tipo === 'cama') { p.raiz.position.y = this.sala.grupo.position.y; p.raiz.position.z += 1.0; this.releasePoint(); }
    if (estado === 'esperando') {
      this.withUtensil(''); this.stay = null; this.chore = 'avisar';
      this.releasePoint(); p.parar(); this.leaveSeat();
      this.lookCamera = true;
      p.inRest = 'Idle_A'; p.gesture('Waving', 'Idle_A');
      this.gestureClock = 3; this.waitingSince = performance.now();
    } else if (estado === 'terminado') {
      this.withUtensil(''); this.stay = null; this.chore = 'celebrar';
      this.releasePoint(); p.parar(); this.leaveSeat();
      this.lookCamera = true;
      p.inRest = 'Idle_A'; p.gesture('Cheering', 'Idle_A');
      this.gestureClock = 6;
    } else if (estado === 'error') {
      this.withUtensil(''); this.stay = null; this.chore = 'averia';
      p.parar(); this.releasePoint(); this.leaveSeat();
      p.gesture('Hit_A', () => { p.inRest = 'Sit_Floor_Idle'; p.reproducir('Sit_Floor_Down', 0.2, { bucle: false }); setTimeout(() => this.estado === 'error' && p.reproducir('Sit_Floor_Idle', 0.3), 900); });
    } else {
      // ocioso, pensando o trabajando: la rutina. Si ya está sentado en su puesto y lo nuevo también va ahí, sigue
      // sentado y solo cambia lo que hace con las manos; si no, se replanea
      const inStation = this.punto?.tipo === 'puesto' && this.arrived;
      const returnsOfNotice = ['esperando', 'terminado', 'error'].includes(anterior);
      if (estado !== 'ocioso' && inStation && !returnsOfNotice) { this.stay = { donde: 'puesto', hasta: this.reloj + this.duracion('puesto') }; this.sub.hasta = 0; }
      else if (estado !== anterior || herramienta !== toolAnterior || returnsOfNotice || !this.stay) {
        if (returnsOfNotice) { this.releasePoint(); p.inRest = 'Idle_A'; p.reproducir('Idle_A', 0.3); }
        this.stay = null;
        if (estado === 'ocioso' && !returnsOfNotice && anterior === 'ocioso') this.stay = { donde: 'paseo', hasta: this.reloj + entre(1, 4) };
      }
    }
  }

  // ---------------------------------------------------------------- la rutina
  private duracion(donde: Stay) {
    const trabaja = this.estado === 'trabajando', thinks = this.estado === 'pensando';
    switch (donde) {
      case 'puesto': return trabaja ? entre(60, 120) : thinks ? entre(25, 45) : entre(30, 60);
      case 'pieza': return entre(9, 16);
      case 'patrulla': return entre(30, 55);
      case 'aficion': return entre(25, 45);
      case 'consola': return entre(8, 14);
      default: return thinks ? entre(7, 12) : entre(5, 10);
    }
  }

  /** Elige dónde pasar el rato (o va a `forzar`) según su estado y lo que tiene la sala */
  private newStay(forzar?: Stay) {
    const hay = (t: RoomPoint['tipo']) => this.free(t).length > 0;
    const repetir = (e: Stay) => (this.ultima !== e ? 1 : e === 'puesto' ? (this.estado === 'ocioso' ? 0.5 : 1) : e === 'patrulla' ? 0.6 : 0.25);   // sin trabajo, tras un rato en la mesa a veces se levanta
    // de madrugada (hora de verdad), quien no tiene nada que hacer y tiene catre se echa a dormir un rato
    const h = new Date().getHours();
    if (!forzar && this.estado === 'ocioso' && (h >= 1 && h < 7) && hay('cama') && !this.chatting && !Habitante.quieto && Math.random() < 0.45) {
      this.wakeIn = this.reloj + entre(90, 300); this.cambiar('durmiendo'); return;
    }
    // la mesa es para trabajar: con una sesión, casi siempre (en el ordenador, sin levantarse); pensando, a menudo; sin
    // nada que hacer, también, pero con calma (leer, un café), o en su afición.
    // Los guardianes (salas con ruta de patrulla) no tienen mesa: patrullan
    // el DJ no deja los platos: en la discoteca, su sitio es la mesa de mezclas, con o sin sesión
    if (!forzar && this.clickDJ) forzar = 'puesto';
    let donde: Stay = forzar ?? 'paseo';
    const guardia = hay('patrulla');
    if (!forzar) {
      if (this.estado === 'trabajando') donde = hay('puesto') ? shuffle<Stay>({ puesto: 0.94, pieza: hay('pieza') ? (this.herramienta === 'buscar' ? 0.15 : 0.06) * repetir('pieza') : 0 }) ?? 'puesto'
        : shuffle<Stay>({ pieza: hay('pieza') ? 0.5 * repetir('pieza') : 0, consola: hay('consola') ? 0.4 * repetir('consola') : 0, patrulla: guardia ? 0.3 : 0 }) ?? 'paseo';
      else if (this.estado === 'pensando') donde = shuffle<Stay>({ puesto: hay('puesto') ? 0.45 : 0, paseo: Habitante.quieto ? 0 : 0.3 * repetir('paseo'), pieza: hay('pieza') ? 0.25 * repetir('pieza') : 0, consola: hay('puesto') ? 0 : 0.3, patrulla: guardia ? 0.5 : 0 }) ?? 'paseo';
      else donde = shuffle<Stay>({
        puesto: hay('puesto') ? 0.5 * repetir('puesto') : 0,
        pieza: hay('pieza') ? 0.12 * repetir('pieza') : 0,
        aficion: hay('aficion') ? 0.3 * repetir('aficion') : 0,
        consola: hay('consola') ? 0.05 * repetir('consola') : 0,
        patrulla: guardia ? 0.9 * repetir('patrulla') : 0,
        paseo: Habitante.quieto ? 0 : 0.08 * repetir('paseo'),
      }) ?? 'paseo';
    }
    if (Habitante.quieto && donde === 'paseo') donde = this.punto && this.arrived ? (this.punto.tipo as Stay) : 'paseo';
    this.ultima = donde;
    this.stay = { donde, hasta: this.reloj + this.duracion(donde) };
    this.sub = { hasta: Infinity, que: '' }; this.paso = 0;
    const p = this.p;
    const empezar = () => { this.sub.hasta = 0; };   // al llegar, la primera tarea de la estancia
    if (donde === 'paseo') {
      this.levantarse(() => {
        this.releasePoint(); this.withUtensil(Math.random() < 0.25 && this.estado === 'ocioso' ? 'taza' : '');
        const s = this.sala; const zones = s.walkZones ?? [[-s.ancho / 2 + 1, s.ancho / 2 - 1]];
        let destino: THREE.Vector3 | null = null;
        for (let k = 0; k < 10 && !destino; k++) {
          const [a, b] = azar(zones);
          const c = new THREE.Vector3(a + Math.random() * (b - a), 0, 1.0 + Math.random() * 0.8).add(s.grupo.position);
          if (Math.abs(c.x - this.pos.x) < 1.2 && k < 6) continue;   // que se note que va a algún sitio
          if (!Habitante.occupants().some(o => o !== p.raiz && Math.hypot(o.position.x - c.x, o.position.z - c.z) < 1.3)) destino = c;
        }
        if (destino) p.goA(destino, Math.abs(destino.x - this.pos.x) > 4.5 && this.estado !== 'ocioso', empezar); else empezar();
      });
      return;
    }
    const tipo = donde as RoomPoint['tipo'];
    const opciones = this.free(tipo);
    if (!opciones.length) { this.stay = { donde: 'paseo', hasta: this.reloj + 2 }; return; }
    // a su puesto, el suyo de siempre (el primero libre); a la pieza o los aparatos, a uno al azar
    const pt = tipo === 'puesto' ? opciones[0] : azar(opciones);
    this.goAPoint(pt, empezar);
  }

  /** Dentro de la estancia: lo siguiente que hace (con las manos, la pieza o su afición) */
  private newSub() {
    const p = this.p, e = this.stay; if (!e) return;
    const pt = this.punto;
    const trabaja = this.estado === 'trabajando', thinks = this.estado === 'pensando';
    if (e.donde === 'puesto' && pt?.tipo === 'puesto') {
      const que = trabaja
        ? shuffle({ teclear: this.herramienta === 'leer' || this.herramienta === 'buscar' ? 0.7 : 0.94, leer: this.herramienta === 'leer' || this.herramienta === 'buscar' ? 0.3 : 0.06 })
        : thinks ? shuffle({ leer: 0.45, pensar: 0.3, teclear: 0.25 })
        // sin nada que hacer, con calma: nada de teclear (eso es trabajar)
        : shuffle({ leer: 0.4, cafe: 0.35, pensar: 0.25 });
      const q = (que ?? 'pensar') as keyof typeof SEATED;
      this.chore = q;
      this.withUtensil(q === 'leer' ? (this.herramienta === 'buscar' && trabaja ? 'lupa' : 'diario') : q === 'cafe' ? 'taza' : '');
      this.typingRhythm = trabaja ? entre(1.5, 1.9) : entre(0.6, 0.9);   // trabajando, a toda prisa
      if (pt.ofFoot && this.clickDJ) {
        // pinchando: manos en los platos y el mezclador; con el tema arriba, los brazos al aire
        const pulse = musicPulse(this.sala.id);
        const clip = shuffle({ Working_B: 0.35, Working_A: 0.25, Interact: 0.2, Cheering: pulse.sonando && pulse.energy > 0.7 ? 0.35 : 0.05 }) ?? 'Working_B';
        this.chore = 'trastear'; this.withUtensil('');
        p.inRest = clip === 'Cheering' ? 'Working_B' : clip;
        if (clip === 'Cheering') p.gesture('Cheering', 'Working_B', 0.2); else p.reproducir(clip, 0.3);
        this.sub = { que: 'pinchar', hasta: this.reloj + (clip === 'Cheering' ? 2 : entre(4, 8)) };
        return;
      }
      if (pt.ofFoot) {
        // puesto de pie (banco, mesa de mezclas): trabaja de pie con las manos en la mesa
        const clip = q === 'teclear' ? azar(['Working_A', 'Working_C']) : q === 'leer' ? 'Holding_B' : q === 'cafe' ? 'Use_Item' : 'Idle_B';
        p.inRest = clip; p.reproducir(clip, 0.35);
      } else { p.inRest = SEATED[q]; p.reproducir(SEATED[q], 0.4); }
      this.sub = { que: q, hasta: this.reloj + (q === 'teclear' ? entre(trabaja ? 14 : 6, trabaja ? 28 : 12) : q === 'cafe' ? entre(6, 10) : entre(trabaja ? 4 : 8, trabaja ? 7 : 16)) };
      return;
    }
    if (e.donde === 'pieza' && pt?.tipo === 'pieza') {
      const acciones = pt.acciones?.length ? pt.acciones : [{ clip: pt.clip ?? 'Interact' }];
      const a = acciones[this.paso++ % acciones.length];
      this.chore = 'pieza';
      this.withUtensil(a.utensil ?? TOOL_OF[a.clip] ?? '');
      p.inRest = a.clip; p.reproducir(a.clip, 0.3);
      a.onMake?.();
      // y suena donde está (la pieza responde: metal, papel, pitidos…)
      const clase = SOUND_OF(a.clip, a.utensil);
      if (clase) setTimeout(() => audioWorld.accion(this.pos.clone().setY(this.pos.y + 1), clase, 0.8, this.sala), 350);
      const d = a.dur ?? Math.max(2.6, p.accion(a.clip).getClip().duration * (1 + Math.floor(Math.random() * 2)));
      this.sub = { que: a.clip, hasta: this.reloj + d };
      return;
    }
    if (e.donde === 'aficion' && pt?.tipo === 'aficion') {
      this.chore = 'aficion';
      if (pt.utensil) this.withUtensil(pt.utensil); else this.withUtensil('');
      if (pt.clip) { p.inRest = pt.clip; p.reproducir(pt.clip, 0.3); }
      this.gestureClock = 1.5;
      this.sub = { que: 'aficion', hasta: Infinity };
      return;
    }
    if (e.donde === 'consola' && pt?.tipo === 'consola') {
      // los aparatos de la sala (armarios, hornos, terminales de pie): con la herramienta que toca si trabaja
      this.chore = 'trastear';
      const h = this.herramienta;
      const clip = trabaja ? (h === 'terminal' ? 'Working_A' : h === 'buscar' ? 'Lockpicking' : h === 'web' ? 'Working_C' : pt.clip ?? 'Working_B') : pt.clip ?? 'Interact';
      this.withUtensil(trabaja && h === 'buscar' ? 'lupa' : TOOL_OF[clip] ?? '');
      p.inRest = clip; p.reproducir(clip, 0.35);
      this.sub = { que: clip, hasta: this.reloj + entre(5, 9) };
      return;
    }
    if (e.donde === 'patrulla') {
      const ronda = this.sala.puntos.filter(x => x.tipo === 'patrulla');
      if (this.sub.que === 'vigilar' || !pt || pt.tipo !== 'patrulla') {
        // a la siguiente parada de la ronda (o a la más cercana si acaba de empezar)
        const i = pt?.tipo === 'patrulla' ? ronda.indexOf(pt) : -1;
        const sig = i >= 0 ? ronda[(i + 1) % ronda.length] : ronda.slice().sort((a, b) => this.mundo(a.pos).distanceTo(this.pos) - this.mundo(b.pos).distanceTo(this.pos))[0];
        this.sub = { hasta: Infinity, que: 'ronda' };
        if (sig) this.goAPoint(sig, () => { this.sub.hasta = 0; this.sub.que = 'parada'; }); else this.sub.hasta = 0;
        return;
      }
      // en la parada: vigila hacia donde manda el punto, mira a un lado y a otro, a veces comprueba algo
      this.chore = 'mirar'; this.withUtensil('');
      p.goalTurn = pt.giro;
      const clip = shuffle({ Idle_B: 0.55, Idle_A: 0.25, Interact: 0.2 }) ?? 'Idle_B';
      p.inRest = clip === 'Interact' ? 'Idle_A' : clip;
      if (clip === 'Interact') p.gesture('Interact', 'Idle_A'); else p.reproducir(clip, 0.35);
      this.sub = { que: 'vigilar', hasta: this.reloj + entre(3, 6.5) };
      return;
    }
    // de paseo: mira alrededor, a la sala o a quien pase; a veces se estira o echa un vistazo a algo
    this.chore = this.chatting ? 'charlar' : 'pasear';
    const r = Math.random();
    if (!this.chatting && r < 0.3) p.goalTurn = (Math.random() - 0.5) * 2.2;
    else if (!this.chatting) p.goalTurn = Math.random() < 0.5 ? Math.PI + (Math.random() - 0.5) * 0.8 : (Math.random() - 0.5) * 0.6;
    p.inRest = r < 0.5 ? 'Idle_A' : 'Idle_B'; p.reproducir(p.inRest, 0.35);
    this.sub = { que: 'mirar', hasta: this.reloj + entre(2.5, 5) };
  }

  actualizar(dt: number) {
    const p = this.p;
    this.reloj += dt;
    this.zetas.activo = this.estado === 'durmiendo' && p.currentName === 'Lie_Idle';
    if (this.zetas.activo) { const c = p.modelo.getObjectByName('head'); if (c) { c.getWorldPosition(this.zetas.origen); this.zetas.origen.y += 0.75; this.zetas.origen.x += 0.25; this.zetas.origen.z += 0.2; } }
    this.zetas.actualizar(dt);
    if (this.slide) {
      const d = this.slide; d.t += dt;
      const k = Math.min(1, d.t / d.dur), s = k * k * (3 - 2 * k);
      p.raiz.position.lerpVectors(d.desde, d.hasta, s);
      if (k >= 1) this.slide = null;
    }
    if (this.estado === 'durmiendo' && this.wakeIn && this.reloj > this.wakeIn) { this.wakeIn = 0; this.cambiar('ocioso'); }
    if (this.lookCamera && !p.ruta.length) p.goalTurn = 0;
    if (p.ruta.length) this.chore = 'andar';
    if (this.waitingAfterChat > 0) { this.waitingAfterChat -= dt; p.actualizar(dt); return; }
    if (this.errand) { if (this.reloj > this.errand.hasta) this.endErrand(); else { p.actualizar(dt); return; } }
    this.vigilar(dt);
    const routine = this.estado === 'ocioso' || this.estado === 'pensando' || this.estado === 'trabajando';
    // quien charla contigo sin trabajar se queda a tu lado (mirándote); trabajando, sigue con lo suyo
    const parado = this.chatting && this.estado === 'ocioso';
    if (parado && !p.ruta.length && this.chore !== 'charlar' && !this.seat) { this.chore = 'charlar'; this.stay = null; if (!['Idle_A', 'Idle_B'].includes(p.currentName)) { p.inRest = 'Idle_A'; p.reproducir('Idle_A', 0.3); } this.withUtensil(''); }
    if (parado && this.seat && this.chore !== 'charlar' && this.reloj > this.untilBusy) { this.chore = 'charlar'; this.withUtensil(''); p.inRest = SEATED.pensar; p.reproducir(SEATED.pensar, 0.4); }
    if (routine && !parado && !p.ruta.length && this.reloj > this.untilBusy && !this.slide) {
      // le han parado a medio camino (una charla, un empujón): vuelve a ir a donde iba
      if (this.stay && this.sub.hasta === Infinity && this.sub.que !== 'aficion' && !this.arrived) this.newStay(this.stay.donde);
      else if (!this.stay || (this.reloj > this.stay.hasta && !(Habitante.quieto && !this.chatting && this.arrived))) this.newStay();
      else if (this.reloj > this.sub.hasta) this.newSub();
    }
    // en su afición: gesto periódico (disparo, riego)
    if (this.estado === 'ocioso' && this.punto?.tipo === 'aficion' && this.arrived && this.punto.gesture && !p.ruta.length) {
      this.gestureClock -= dt;
      if (this.gestureClock < 0) { const gs = this.punto.gesture; this.gestureClock = gs.cada * (0.7 + Math.random() * 0.6); p.gesture(gs.clip, p.inRest, 0.08); gs.onMake?.(); }
    }
    if (this.estado === 'esperando') {
      this.gestureClock -= dt;
      if (this.gestureClock < 0) { this.gestureClock = 4 + Math.random() * 2; if (!p.ruta.length) callOut(p, this.waitingSince); }
    }
    if (this.estado === 'terminado') {
      this.gestureClock -= dt;
      if (this.gestureClock < 0) { this.gestureClock = 9 + Math.random() * 6; if (!p.ruta.length) p.gesture(Math.random() < 0.6 ? 'Cheering' : 'Waving', 'Idle_A'); }
    }
    // el tecleo de las manos sube y baja con suavidad (al sentarse, al cambiar de tarea)
    const teclea = this.chore === 'teclear' && this.seat && p.currentName === SEATED.teclear;
    this.typing = THREE.MathUtils.damp(this.typing, teclea ? 1 : 0, 6, dt);
    // mirada: solo de pie y sin nada entre manos (en reposo, paseando o charlando contigo), y a vistazos: unos segundos y
    // vuelve a lo suyo. Sentado, trabajando o andando no se gira: la cabeza tiene su sitio
    const sup = mundo.supervisor();
    let wants = 0;
    const libre = !this.seat && !p.ruta.length && !this.slide && this.reloj > this.untilBusy && (this.estado === 'ocioso' || this.estado === 'terminado') && (this.chore === 'pasear' || this.chore === 'mirar' || this.chore === 'charlar' || this.chore === 'celebrar');
    if (sup && libre && Math.abs(sup.position.y - this.pos.y) < 1) {
      const d = Math.hypot(sup.position.x - this.pos.x, sup.position.z - this.pos.z);
      if (this.chatting) wants = 1;
      else if (d < 2.6) {
        if (this.reloj > this.vistazo.hasta && this.reloj > this.vistazo.siguiente) { this.vistazo.hasta = this.reloj + entre(1.5, 3); this.vistazo.siguiente = this.vistazo.hasta + entre(5, 11); }
        wants = this.reloj < this.vistazo.hasta ? 0.8 : 0;
      }
    }
    this.gaze = THREE.MathUtils.damp(this.gaze, wants, 2.5, dt);
    const largo = this.sesionId ? (vivo.get().parcial[this.sesionId] ?? '').length : 0;
    if (largo !== this.partialLong) { if (largo > this.partialLong) this.untilSpeaks = this.reloj + 0.8; this.partialLong = largo; }
    this.speaks = THREE.MathUtils.damp(this.speaks, this.talking && this.estado !== 'durmiendo' ? 1 : 0, 5, dt);
    p.actualizar(dt);
  }

  // ---------------------------------------------------------------- guardianes: escanean a quien entra
  private scan: { t: number; ring: THREE.Mesh; haz: THREE.Mesh } | null = null;
  private supInside = false; private lastScan = -999;
  private vigilar(dt: number) {
    const sup = mundo.supervisor(), p = this.p;
    if (this.scan) { this.animateScan(dt); return; }
    if (!sup || !this.sala.puntos.some(x => x.tipo === 'patrulla')) return;
    const s = this.sala.grupo.position;
    const dentro = Math.abs(sup.position.y - s.y) < 1 && Math.abs(sup.position.x - s.x) < this.sala.ancho / 2;
    const entra = dentro && !this.supInside; this.supInside = dentro;
    if (!entra || this.reloj - this.lastScan < 25) return;
    if (this.estado !== 'ocioso' || this.chatting || this.seat || this.reloj < this.untilBusy || Math.hypot(sup.position.x - this.pos.x, sup.position.z - this.pos.z) > 7) return;
    // alto: se planta, se gira hacia quien llega y le pasa el escáner de arriba abajo
    this.lastScan = this.reloj;
    p.parar(); this.stay = { donde: this.stay?.donde ?? 'patrulla', hasta: this.reloj + 4 }; this.sub = { hasta: this.reloj + 3.4, que: 'escanear' };
    this.releasePoint();
    p.goalTurn = Math.atan2(sup.position.x - this.pos.x, sup.position.z - this.pos.z);
    p.inRest = 'Idle_A'; p.gesture('Interact', 'Idle_A', 0.25);   // señala; escanea con el ojo (con la katana en alto parecía una amenaza)
    this.untilBusy = this.reloj + 3.2; this.chore = 'avisar';
    const luz = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff8a').multiplyScalar(1.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 48), luz); ring.rotation.x = Math.PI / 2;
    // el plano del barrido: un disco tenue dentro del anillo (de frente, el anillo solo es una línea)
    const velo = new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff8a'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const disco = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), velo); ring.add(disco);   // hijo del anillo: ya está tumbado con él
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6), luz);
    p.raiz.parent?.add(ring, haz);
    this.scan = { t: 0, ring, haz };
    setTimeout(() => SFX.holoAppears(), 450);
  }
  private animateScan(dt: number) {
    const e = this.scan!, sup = mundo.supervisor(); e.t += dt;
    const m = e.ring.material as THREE.MeshBasicMaterial;
    // 0,5 s levantando la mano; luego el anillo baja y sube por el cuerpo (2 s) y se apaga
    const k = THREE.MathUtils.clamp((e.t - 0.5) / 2, 0, 1);
    const velo = (e.ring.children[0] as THREE.Mesh)?.material as THREE.MeshBasicMaterial | undefined;
    m.opacity = e.t < 0.5 ? 0 : k < 0.1 ? k * 10 * 0.9 : k > 0.9 ? (1 - k) * 10 * 0.9 : 0.9 * (0.75 + 0.25 * Math.sin(e.t * 40));
    if (velo) velo.opacity = m.opacity * 0.22;
    if (sup) {
      const y = sup.position.y + 0.08 + 1.95 * (0.5 + 0.5 * Math.cos(k * Math.PI * 2));
      e.ring.position.set(sup.position.x, y, sup.position.z);
      // el haz, del ojo (la cabeza) del guardián al anillo
      const mano = this.p.headPoint(new THREE.Vector3()).add(new THREE.Vector3(0, -0.35, 0));
      const fin = e.ring.position.clone(), medio = mano.clone().add(fin).multiplyScalar(0.5);
      e.haz.position.copy(medio); e.haz.scale.set(1, mano.distanceTo(fin), 1);
      e.haz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), fin.sub(mano).normalize());
    }
    if (e.t > 2.6) {
      e.ring.parent?.remove(e.ring, e.haz); e.ring.geometry.dispose(); e.haz.geometry.dispose(); m.dispose(); if (velo) { velo.dispose(); (e.ring.children[0] as THREE.Mesh).geometry.dispose(); }
      this.scan = null;
      SFX.shortSuccess(); audioWorld.say(this, 'saludo');
      this.p.gesture('Interact', 'Idle_A', 0.2);   // «adelante»
    }
  }

  /** Retoques sobre la pose ya animada: la cabeza del que duerme hacia la cámara, la mirada al Supervisor y el
   *  tecleo de las manos (KayKit no trae dedos: muñecas y antebrazos que suben y bajan, a destiempo) */
  private retouch() {
    const p = this.p;
    const cabeza = p.modelo.getObjectByName('head');
    if (!cabeza || !this.faceLocal) return;
    if (this.estado === 'durmiendo' && p.currentName === 'Lie_Idle') { this.turnFace(cabeza, new THREE.Vector3(0.15, 0.35, 1).normalize(), 0.85, Math.PI); return; }
    if (this.gaze > 0.01) {
      // solo giro alrededor de la vertical y medido respecto al cuerpo: como mucho ±35°, repartido entre pecho y cabeza
      const sup = mundo.supervisor();
      if (sup) {
        let dif = Math.atan2(sup.position.x - this.pos.x, sup.position.z - this.pos.z) - p.raiz.rotation.y;
        dif = Math.atan2(Math.sin(dif), Math.cos(dif));
        const giro = THREE.MathUtils.clamp(dif, -0.62, 0.62) * this.gaze;
        const arriba = new THREE.Vector3(0, 1, 0), pecho = p.modelo.getObjectByName('chest');
        if (pecho) turnBoneWorld(pecho, arriba, giro * 0.3);
        turnBoneWorld(cabeza, arriba, giro * (pecho ? 0.7 : 1));
      }
    }
    if (this.speaks > 0.01) {
      // al hablar asiente y acompaña con la cabeza (sin boca que mover: KayKit no la trae)
      const q = cabeza.getWorldQuaternion(new THREE.Quaternion());
      const lado = this.faceLocal.clone().applyQuaternion(q).cross(new THREE.Vector3(0, 1, 0));
      if (lado.lengthSq() > 1e-6) {
        const t = this.reloj;
        turnBoneWorld(cabeza, lado.normalize(), (Math.sin(t * 8.5) * 0.035 + Math.sin(t * 5.1 + 1) * 0.025) * this.speaks);
        turnBoneWorld(cabeza, new THREE.Vector3(0, 1, 0), Math.sin(t * 2.3) * 0.04 * this.speaks);
      }
    }
    if (this.typing > 0.01) {
      const t = this.reloj * 7.5 * this.typingRhythm, arriba = new THREE.Vector3(0, 1, 0);
      for (const [lado, phase] of [['l', 0], ['r', 1.9]] as const) {
        const arm = p.modelo.getObjectByName('lowerarm' + lado), mano = p.modelo.getObjectByName('hand' + lado);
        if (!arm || !mano) continue;
        const a = arm.getWorldPosition(new THREE.Vector3()), b = mano.getWorldPosition(new THREE.Vector3());
        const eje = b.sub(a).cross(arriba); if (eje.lengthSq() < 1e-6) continue; eje.normalize();
        // golpes cortos y desiguales: la suma de dos senos con el ritmo de quien escribe a rachas
        const golpe = Math.max(0, Math.sin(t + phase)) ** 3 * 0.75 + Math.max(0, Math.sin(t * 1.63 + phase * 2.1)) ** 4 * 0.5;
        const racha = 0.55 + 0.45 * Math.sin(this.reloj * 0.9 + phase);
        turnBoneWorld(arm, eje, -0.16 * golpe * racha * this.typing);
        turnBoneWorld(mano, eje, -0.22 * golpe * racha * this.typing);
      }
    }
  }

  private turnFace(cabeza: THREE.Object3D, goal: THREE.Vector3, weight: number, maximo: number) {
    const q = cabeza.getWorldQuaternion(new THREE.Quaternion());
    const cara = this.faceLocal!.clone().applyQuaternion(q);
    let giro = new THREE.Quaternion().setFromUnitVectors(cara, goal);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(giro.w)));
    if (ang > maximo) giro = new THREE.Quaternion().slerp(giro, maximo / ang);   // no se tuerce el cuello
    const parcial = new THREE.Quaternion().slerp(giro, weight);
    const a = 2 * Math.acos(Math.min(1, parcial.w)); if (a < 1e-3) return;
    turnBoneWorld(cabeza, new THREE.Vector3(parcial.x, parcial.y, parcial.z).normalize(), a);
  }
}
