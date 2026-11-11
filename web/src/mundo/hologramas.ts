// Worktrees como copias holográficas: cada worktree de un repo es un holograma del habitante que lo creó (su clon de
// ensayo), con su proyector en un rincón libre de la franja delantera de la sala y su propio ordenador holográfico.
// Nunca usa los puestos del original (consola, silla, cama): pensando, consulta su portátil sentado en el proyector;
// trabajando, maneja pantallas en el aire; esperando, te llama; terminado, lo celebra; avería, se distorsiona; sin
// nada que hacer, se pasea cerca de su proyector, tenue (y se para a mirarte si te acercas). Al crearse se
// materializa junto a su autor y va a su sitio; al desecharse se desvanece.
// Cada copia es un interlocutor propio, como un clon: con E (o un clic) se habla con ella en su intercomunicador, que
// no es el de su autor (ui/copias.ts); lo que se trabaja dentro del worktree vive en él.
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import { Habitante } from './habitante';
import { callOut, type Character } from './personaje';
import { gltf, measure, R } from '../motor/assets';
import { vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { SHOP } from '@shared/catalogo';
import type { InfoWorktree, SessionSummary } from '@shared/protocolo';
import { taskColor, worktreeTask } from '@shared/tareas';
import { knowTasks, versionColors } from '../ui/tareas';
import type { DwellerState, DwellerSummary } from '../ui/estadoJuego';
import { idCopy, branchCaption, pathWorktree } from '../ui/copias';

const MAX_BY_ROOM = 30;   // alto a propósito: son intangibles, si no caben se solapan sin estorbar
const COLOR = new THREE.Color('#58e6ff'), COLOR_FAULT = new THREE.Color('#ff6a4a');
const Z_SPOT = 1.5;
const RADIO_WALK = 2.4;   // sin nada que hacer, se pasea hasta aquí de su proyector
const tiempo = { value: 0 };

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

interface Uniforms { uColor: { value: THREE.Color }; uTiempo: typeof tiempo; uOpacity: { value: number }; uCut: { value: number }; uGlitch: { value: number }; uSemilla: { value: number } }

function holograph(o: THREE.Object3D, u: Uniforms) {
  const cache = new Map<THREE.Texture | null, THREE.ShaderMaterial>();
  const material = (mapa: THREE.Texture | null) => {
    let m = cache.get(mapa);
    if (!m) {
      m = new THREE.ShaderMaterial({ uniforms: { ...u, uMapa: { value: mapa }, uConMapa: { value: mapa ? 1 : 0 }, uLines: { value: 150 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: true });
      cache.set(mapa, m);
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
// en el proyector: sentado con el portátil (pensando o en reposo con avería) o con las pantallas en el aire (trabajando);
// en cualquier sitio: de pie (te espera, terminó, habla contigo) o paseando (sin nada que hacer)
type Pose = 'reposo' | 'portatil' | 'manos' | 'pie' | 'paseo';
const IN_PROJECTOR = new Set<Pose>(['reposo', 'portatil', 'manos']);
const WALKING = /^(Walking|Running)/;
export interface Copia {
  ruta: string; w: InfoWorktree; sala: Sala; authorId: string;
  p: Character; u: Uniforms; base: THREE.Object3D | null; portatil: THREE.Group; pantallas: THREE.Group;
  sitio: THREE.Vector3; giro: number;
  estado: DwellerState; detalle: string; sesionId?: string; firma: string;
  pose: Pose | ''; fromPose: number; poseWanted: Pose; gestureClock: number; waitingSince: number;
  opacidad: number; goalCut: number; leaving: boolean; listo: boolean;
  walkClock: number; destino: THREE.Vector3 | null; returning: boolean;
  talking: boolean; chatTurn: number;   // en una charla con el Supervisor: de pie y mirándole
  tarea?: string; tone: THREE.Color; versionTone?: number;         // la tarea del worktree y su color (shared/tareas.ts); sin tarea, el cian de serie
}

export class Holograms {
  figuras = new Map<string, Copia>();
  private desde = performance.now();
  constructor(private r: Refugio) {}

  /** Todos los worktrees (no principales) con su sala: los de git y los que una sesión acaba de crear. */
  private worktrees() {
    const repos = vivo.get().repos ?? {};
    const out: { w: InfoWorktree; sala: Sala }[] = [];
    for (const s of this.r.salas) for (const w of repos[s.id]?.worktrees ?? []) if (!w.principal) out.push({ w, sala: s });
    const todos = out.map(x => x.w);
    for (const s of Object.values(vivo.get().sesiones) as SessionSummary[]) {
      if (s.estado === 'cerrada') continue;
      const ruta = pathWorktree(s.cwd, todos); if (!ruta || out.some(x => x.w.ruta === ruta)) continue;
      const sala = this.r.salas.find(x => x.id === s.salaId); if (!sala) continue;
      const w: InfoWorktree = { ruta, rama: ruta.split('/').pop() ?? '', principal: false, cambios: 0, advanced: 0, autor: s.dwellerId };
      out.push({ w, sala }); todos.push(w);
    }
    return out;
  }

  /** Sesiones que trabajan dentro de algún worktree: las anima su holograma, no el habitante original. */
  inWorktree(s: SessionSummary) { return !!pathWorktree(s.cwd, this.worktrees().map(x => x.w)); }

  private insideSession(ruta: string): SessionSummary | undefined {
    const urg = (s: SessionSummary) => s.estado === 'esperando' ? 0 : s.estado === 'error' ? 1 : s.estado === 'terminada' && s.sinLeer ? 2 : s.estado === 'trabajando' || s.estado === 'arrancando' ? 3 : 4;
    return (Object.values(vivo.get().sesiones) as SessionSummary[]).filter(s => s.estado !== 'cerrada' && (s.cwd === ruta || s.cwd?.startsWith(ruta + '/'))).sort((a, b) => urg(a) - urg(b) || b.actualizada - a.actualizada)[0];
  }

  private authorOf(w: InfoWorktree, sala: Sala) {
    const hs = this.r.habitantes;
    const propio = hs.find(h => h.id.id === w.autor);
    if (propio) return propio;
    // sin autor conocido (creado fuera del refugio): uno de la sala, siempre el mismo para ese worktree
    const ofRoom = hs.filter(h => h.sala === sala); const lista = ofRoom.length ? ofRoom : hs;
    const k = [...w.ruta].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return lista[k % lista.length];
  }

  sincronizar() {
    if (!this.r.salas.length || !this.r.habitantes.length) return;
    const lista = this.worktrees();
    const roomBy = new Map<Sala, number>();
    const seen = new Set<string>();
    let cambio = false;
    for (const { w, sala } of lista) {
      const n = roomBy.get(sala) ?? 0; if (n >= MAX_BY_ROOM) continue; roomBy.set(sala, n + 1);
      seen.add(w.ruta);
      const autor = this.authorOf(w, sala); if (!autor) continue;
      const ya = this.figuras.get(w.ruta);
      // otro autor: la copia nueva nace a su lado; la sala reconstruida (disposición nueva): reaparece en su sitio sin más
      let effect = true;
      if (ya && (ya.authorId !== autor.id.id || ya.sala !== sala)) { effect = ya.authorId !== autor.id.id; this.quitar(ya, true); }
      else if (ya) { ya.w = w; if (ya.listo) cambio = this.aplicar(ya) || cambio; continue; }
      this.crear(w, sala, autor, effect); cambio = true;
    }
    for (const f of [...this.figuras.values()]) if (!seen.has(f.ruta) && !f.leaving) { this.quitar(f); cambio = true; }
    if (cambio) this.r.publish();
  }

  // ---- un hueco en la franja delantera. Lo que cuenta es lo que se solapa en pantalla (en X), y las salas van llenas:
  // se puntúa cada hueco y gana el que menos estorba. Nunca encima de otra copia; muy caro tapar la pieza central, el
  // puesto de un habitante (para no pisar al original) o un aparato; algo, las zonas de paseo, los muebles que asoman
  // por delante y los sitios de los robots ayudantes; y a igualdad, mejor del lado contrario. El sitio del visitante, nunca
  private sitio(sala: Sala, ruta: string) {
    const lejos = sala.lado === 'izq' ? -1 : 1, medio = sala.ancho / 2 - 0.9;
    const otros = [...this.figuras.values()].filter(f => f.sala === sala && f.ruta !== ruta && !f.leaving).map(f => f.sitio.x - sala.grupo.position.x);
    const puestos = sala.puntos.filter(pt => pt.tipo !== 'mirar' && pt.tipo !== 'charla').map(pt => pt.pos.x);
    const devices = (sala.interactive ?? []).filter(i => !i.id.startsWith('vis:')).map(i => i.x);
    // entre copias, bien separadas: cada una con su sitio para que se distinga a quién se habla
    const coste = (x: number) =>
      (otros.some(o => Math.abs(o - x) < 1.3) ? 1000 : otros.some(o => Math.abs(o - x) < 2.2) ? 30 : 0) + (Math.abs(x) < 1.8 ? 100 : 0)
      + (puestos.some(px => Math.abs(px - x) < 1.2) ? 50 : 0) + (devices.some(ax => Math.abs(ax - x) < 1.0) ? 40 : 0)
      + ((sala.walkZones ?? []).some(([a, b]) => x > a - 0.6 && x < b + 0.6) ? 10 : 0)
      + (sala.obstacles.some(b => b.max.y > 0.3 && b.min.x - 0.5 < x && b.max.x + 0.5 > x) ? 5 : 0)
      + ([-3.2, 3.0, -1.4, 1.6, -4.6, 4.4].some(r => Math.abs(r - x) < 0.8) ? 4 : 0)
      // el sitio del visitante (junto al paso del ascensor, `Visitors.crear`) queda siempre libre, haya visitas o no
      + (Math.abs(-lejos * (sala.ancho / 2 - 1.1) - x) < 1.4 ? 1000 : 0)
      + Math.abs(lejos * medio - x);
    let mejor = lejos * medio, cmin = Infinity;
    for (let x = -medio; x <= medio + 1e-6; x += 0.3) { const c = coste(x); if (c < cmin) { cmin = c; mejor = x; } }
    return new THREE.Vector3(sala.grupo.position.x + mejor, sala.grupo.position.y, Z_SPOT);
  }

  private async crear(w: InfoWorktree, sala: Sala, autor: Habitante, effect = true) {
    const u: Uniforms = { uColor: { value: COLOR.clone() }, uTiempo: tiempo, uOpacity: { value: 0 }, uCut: { value: -1e4 }, uGlitch: { value: 0 }, uSemilla: { value: Math.random() } };
    // el mismo aspecto que su autor (modelo, tono, silueta y accesorios), y luego en luz
    const clon = new Habitante(autor.id, sala);
    const sitio = this.sitio(sala, w.ruta);
    const lado = Math.sign(sala.grupo.position.x - sitio.x) || 1;
    const f: Copia = {
      ruta: w.ruta, w, sala, authorId: autor.id.id, p: clon.p, u, base: null, portatil: new THREE.Group(), pantallas: new THREE.Group(),
      sitio, giro: lado * 1.05, estado: 'ocioso', detalle: '', firma: '', pose: '', fromPose: 0, poseWanted: 'reposo', gestureClock: 3, waitingSince: 0,
      opacidad: 0, goalCut: 1e4, leaving: false, listo: false,
      walkClock: 3 + Math.random() * 4, destino: null, returning: false, talking: false, chatTurn: 0, tone: COLOR,
    };
    this.taskTone(f); u.uColor.value.copy(f.tone);
    this.figuras.set(w.ruta, f);
    await clon.cargar();
    if (this.figuras.get(w.ruta) !== f) return;
    const p = f.p;
    await this.accesorios(p, autor.id.id);
    await Promise.all([this.mountLaptop(f), this.mountBase(f)]);
    if (this.figuras.get(w.ruta) !== f) return;
    for (const o of [p.modelo, f.portatil, f.pantallas]) holograph(o, u);
    p.contactShadow.visible = false;
    p.raiz.name = 'holograma:' + w.ruta;
    p.marcha = { andar: 'Walking_B', correr: 'Running_A', walkRhythm: 1.45, runRhythm: 1 };
    // recién creado con el refugio ya en marcha: se materializa junto a su autor y va a su sitio
    const inHot = effect && performance.now() - this.desde > 8000 && autor.sala === sala && autor.p.raiz.visible;
    const y = sala.grupo.position.y;
    if (inHot) {
      const ap = autor.pos; const dx = Math.sign(sitio.x - ap.x) || 1;
      p.raiz.position.set(THREE.MathUtils.clamp(ap.x + dx * 0.8, sala.grupo.position.x - sala.ancho / 2 + 0.7, sala.grupo.position.x + sala.ancho / 2 - 0.7), y, THREE.MathUtils.clamp(ap.z + 0.6, 0.9, 1.7));
      p.goalTurn = 0; p.raiz.rotation.y = 0;
      u.uCut.value = y; f.goalCut = y + 2.6; f.opacidad = 1; u.uOpacity.value = 1;
      SFX.holoAppears();
      this.r.motor.scene.add(p.raiz);
      p.reproducir('Spawn_Ground', 0, { bucle: false });
      setTimeout(() => { if (f.leaving) return; p.goA([new THREE.Vector3(p.raiz.position.x, y, Z_SPOT), sitio], false, () => { f.pose = 'pie'; f.fromPose = 0; this.aplicar(f, true); f.listo = true; this.r.publish(); }); }, 1300);
    } else {
      p.raiz.position.copy(sitio); p.raiz.rotation.y = f.giro; p.goalTurn = f.giro;
      u.uCut.value = 1e4; f.goalCut = 1e4;
      this.r.motor.scene.add(p.raiz);
      this.aplicar(f, true); this.changePose(f, f.poseWanted, true); f.listo = true; u.uOpacity.value = f.opacidad; this.r.publish();
    }
    if (f.base) this.r.motor.scene.add(f.base);
    // quien estaba de paseo justo ahí le deja el sitio
    for (const h of this.r.habitantes) if (h.sala === sala && h.estado === 'ocioso' && !h.fijo && Math.abs(h.pos.x - sitio.x) < 1.1) h.p.goA(this.r.freeGap(sala));
  }

  private async accesorios(p: Character, authorId: string) {
    const ids: string[] = (vivo.get().estado?.habitantes as any[] | undefined)?.find(x => x.id === authorId)?.accesorios ?? [];
    await Promise.all(ids.map(id => { const a = SHOP.find(x => x.id === id); return a?.ruta && a.bone ? p.couple('acc:' + id, { ruta: a.ruta, bone: a.bone, escala: a.escala ?? 1, pos: a.pos, rot: a.rot, rig: a.rig }).catch(() => {}) : null; }));
  }

  // su ordenador: un teclado y una pantalla de los muebles KayKit, en luz como él (en el suelo o flotando en el aire)
  private async mountLaptop(f: Copia) {
    const [tec, mon] = await Promise.all([gltf(R.mueble('keyboard')), gltf(R.mueble('monitor'))]);
    const adjust = (o: THREE.Object3D, ancho: number) => { const { tam } = measure(o); o.scale.setScalar(ancho / Math.max(tam.x, tam.z, 1e-3)); return o; };
    const teclado = adjust(tec.scene.clone(true), 0.36); teclado.position.set(0, 0.01, 0.5);
    const pantalla = adjust(mon.scene.clone(true), 0.38); pantalla.position.set(0, 0.01, 0.74); pantalla.rotation.y = Math.PI; pantalla.rotation.x = -0.12;
    f.portatil.add(teclado, pantalla);
    // en arco delante de él, a la altura de las manos (la cámara no las ve tapándole la cabeza)
    const p1 = adjust(mon.scene.clone(true), 0.5); p1.position.set(-0.22, 0.88, 0.72); p1.rotation.y = Math.PI - 0.35;
    const p2 = adjust(mon.scene.clone(true), 0.42); p2.position.set(0.36, 0.8, 0.6); p2.rotation.y = Math.PI + 0.5;
    f.pantallas.add(p1, p2);
    for (const g of [f.portatil, f.pantallas]) { g.visible = false; f.p.raiz.add(g); }
  }

  // el proyector: una plataforma baja de KayKit en el suelo, con su material (no es holograma)
  private async mountBase(f: Copia) {
    try {
      const g = await gltf(R.base('landingpad_small'));
      const o = g.scene.clone(true);
      const { tam } = measure(o); o.scale.setScalar(1.0 / Math.max(tam.x, tam.z, 1e-3));
      o.traverse((n: any) => { if (n.isMesh) { n.receiveShadow = true; n.castShadow = false; } });
      const base = new THREE.Group(); base.add(o); base.position.copy(f.sitio); base.userData.estatico = false;
      f.base = base;
      f.sitio.y += measure(o).tam.y;   // de pie (o sentado) encima de la plataforma
    } catch { f.base = null; }
  }

  // ---- la sesión de dentro → pose y animación
  private aplicar(f: Copia, forzar = false): boolean {
    const s = this.insideSession(f.ruta);
    const m = s?.actividad?.modo;
    let estado: DwellerState = 'ocioso', detalle = '', wants: Pose = 'paseo';
    if (s) {
      if (s.estado === 'arrancando') { estado = 'pensando'; detalle = 'preparándose…'; wants = 'portatil'; }
      else if (s.estado === 'trabajando') {
        if (!m || m === 'pensar') { estado = 'pensando'; detalle = s.actividad?.texto ?? 'pensando…'; wants = 'portatil'; }
        else { estado = 'trabajando'; detalle = s.actividad?.texto ?? ''; wants = 'manos'; }
      } else if (s.estado === 'esperando') { estado = 'esperando'; detalle = s.pending?.titulo ?? 'te espera'; wants = 'pie'; }
      else if (s.estado === 'terminada' && s.sinLeer) { estado = 'terminado'; detalle = 'listo: ' + (s.titulo ?? ''); wants = 'pie'; }
      else if (s.estado === 'error') { estado = 'error'; detalle = s.error ?? 'avería'; wants = 'reposo'; }
      else { detalle = s.titulo ?? ''; wants = 'paseo'; }
    }
    const firma = [s?.id, estado, detalle, f.w.cambios, f.w.advanced].join('|');
    if (firma === f.firma && !forzar) return false;
    const antes = f.estado;
    f.firma = firma; f.estado = estado; f.detalle = detalle; f.sesionId = s?.id; f.poseWanted = wants;
    if (estado !== antes) {
      if (estado === 'terminado') { SFX.success(); f.p.gesture('Cheering', 'Idle_A'); f.pose = 'pie'; f.fromPose = tiempo.value; }
      else if (estado === 'error') { SFX.holoGlitch(); f.u.uGlitch.value = 1; }
      else if (estado === 'esperando') { SFX.highNotice(); f.waitingSince = performance.now(); }
    }
    if (estado !== 'error') f.u.uGlitch.value = 0;
    f.opacidad = estado === 'ocioso' ? 0.6 : 1;
    return estado !== antes;
  }

  private changePose(f: Copia, pose: Pose, inmediata = false) {
    const p = f.p; const sentado = f.pose === 'reposo' || f.pose === 'portatil';
    const sentar = pose === 'reposo' || pose === 'portatil';
    f.pose = pose; f.fromPose = tiempo.value;
    if (pose === 'paseo') f.walkClock = Math.max(f.walkClock, 1.6);   // primero termina de levantarse
    f.portatil.visible = pose === 'portatil' || pose === 'reposo';
    f.pantallas.visible = pose === 'manos';
    if (IN_PROJECTOR.has(pose)) p.goalTurn = f.giro; else if (pose === 'pie') p.goalTurn = 0;
    if (sentar) {
      p.inRest = 'Sit_Floor_Idle';
      if (sentado || inmediata) p.reproducir('Sit_Floor_Idle', inmediata ? 0 : 0.35);
      else p.gesture('Sit_Floor_Down', 'Sit_Floor_Idle', 0.25);
    } else {
      const clip = pose === 'manos' ? 'Ranged_Magic_Spellcasting_Long' : 'Idle_A';
      p.inRest = clip;
      if (sentado && !inmediata) p.gesture('Sit_Floor_StandUp', clip, 0.2);
      else if (pose === 'pie' && f.estado === 'esperando' && !f.talking) { p.gesture('Waving', 'Idle_A'); f.gestureClock = 3; }
      else p.reproducir(clip, inmediata ? 0 : 0.3);
    }
  }

  private quitar(f: Copia, ya = false) {
    f.leaving = true; this.figuras.delete(f.ruta); f.p.parar();
    const fuera = () => { this.r.motor.scene.remove(f.p.raiz); if (f.base) this.r.motor.scene.remove(f.base); };
    if (ya || !f.p.raiz.parent) { fuera(); return; }
    SFX.apagado();
    // se desvanece de la cabeza a los pies
    f.u.uCut.value = Math.min(f.u.uCut.value, f.p.raiz.position.y + 2.6); f.goalCut = f.p.raiz.position.y - 0.05;
    setTimeout(fuera, 1400);
    this.outgoing.add(f);
  }
  private outgoing = new Set<Copia>();

  actualizar(dt: number) {
    tiempo.value += dt;
    for (const f of [...this.figuras.values(), ...this.outgoing]) {
      if (!f.p.mixer || !f.p.raiz.parent) { if (f.leaving && !f.p.raiz.parent) this.outgoing.delete(f); continue; }
      const u = f.u;
      // materializar o desvanecer: el corte sube (o baja) a ritmo constante
      if (u.uCut.value !== f.goalCut && u.uCut.value > -1e3 && u.uCut.value < 1e3) {
        const paso = dt * 2.2; const d = f.goalCut - u.uCut.value;
        u.uCut.value = Math.abs(d) <= paso ? f.goalCut : u.uCut.value + Math.sign(d) * paso;
        if (u.uCut.value >= f.p.raiz.position.y + 2.55 && !f.leaving) { u.uCut.value = 1e4; f.goalCut = 1e4; }
      }
      u.uOpacity.value = THREE.MathUtils.damp(u.uOpacity.value, f.opacidad, 3, dt);
      if (f.estado === 'error') u.uGlitch.value = 0.35 + 0.65 * Math.max(0, Math.sin(tiempo.value * 3.1 + u.uSemilla.value * 9));
      this.taskTone(f);
      u.uColor.value.lerp(f.estado === 'error' ? COLOR_FAULT : f.tone, 1 - Math.exp(-dt * 4));   // del color de su tarea; con avería, en rojo
      if (f.listo && !f.leaving) this.drive(f, dt);
      f.p.actualizar(dt);
    }
  }

  // ---- qué hace cada copia: hablar contigo, volver a su proyector para trabajar, pasearse o cambiar de postura
  private drive(f: Copia, dt: number) {
    const p = f.p, pos = p.raiz.position;
    if (f.talking) {
      if (p.inMovement || WALKING.test(p.currentName)) { p.parar(); p.reproducir(p.inRest, 0.25); }
      if (f.pose !== 'pie') this.changePose(f, 'pie');
      p.goalTurn = f.chatTurn;
      return;
    }
    const wants = f.poseWanted;
    // lo de trabajar se hace en el proyector: si andaba de paseo, vuelve primero
    if (IN_PROJECTOR.has(wants) && Math.hypot(pos.x - f.sitio.x, pos.z - f.sitio.z) > 0.08) {
      if (!f.returning || !p.inMovement) {
        f.returning = true; f.destino = f.sitio;
        if (f.pose !== 'pie' && f.pose !== 'paseo') this.changePose(f, 'paseo');
        p.goA(f.sitio, false, () => { f.returning = false; f.destino = null; this.changePose(f, f.poseWanted); });
      }
      return;
    }
    if (f.returning) return;
    // entre pensar y trabajar no se levanta y se sienta a cada herramienta: cada postura dura al menos unos segundos
    const vaiven = (f.pose === 'portatil' && wants === 'manos') || (f.pose === 'manos' && wants === 'portatil');
    if (wants !== f.pose && (!vaiven || tiempo.value - f.fromPose > 6)) { if (p.inMovement && wants !== 'paseo') p.parar(); this.changePose(f, wants); }
    if (f.estado === 'esperando' && f.pose === 'pie') { f.gestureClock -= dt; if (f.gestureClock < 0) { f.gestureClock = 4 + Math.random() * 2; callOut(f.p, f.waitingSince); } }
    if (f.pose === 'paseo') this.pasear(f, dt);
  }

  // sin nada que hacer, da vueltas cerca de su proyector, sin pisar a nadie; si el Supervisor se le acerca, se para y le mira
  private pasear(f: Copia, dt: number) {
    const p = f.p, pos = p.raiz.position, sp = this.r.supervisor?.raiz.position;
    if (sp && Math.abs(sp.y - pos.y) < 1 && Math.hypot(sp.x - pos.x, sp.z - pos.z) < 1.7) {
      if (p.inMovement) { p.parar(); f.destino = null; p.reproducir(p.inRest, 0.25); }
      p.goalTurn = Math.atan2(sp.x - pos.x, sp.z - pos.z);
      f.walkClock = Math.max(f.walkClock, 2.5);
      return;
    }
    if (p.inMovement) return;
    f.walkClock -= dt; if (f.walkClock > 0) return;
    f.walkClock = 5 + Math.random() * 7;
    const sala = f.sala, sx = sala.grupo.position.x, med = sala.ancho / 2 - 0.8, y = sala.grupo.position.y;
    let dest: THREE.Vector3 | null = Math.random() < 0.25 && Math.hypot(pos.x - f.sitio.x, pos.z - f.sitio.z) > 0.5 ? f.sitio : null;
    for (let k = 0; !dest && k < 14; k++) {
      const x = THREE.MathUtils.clamp(f.sitio.x + (Math.random() * 2 - 1) * RADIO_WALK, sx - med, sx + med), z = 0.85 + Math.random() * 0.85;
      const libre = Math.hypot(x - pos.x, z - pos.z) > 0.8
        && ![...this.figuras.values()].some(o => o !== f && Math.abs((o.destino ?? o.p.raiz.position).x - x) < 1.3)
        && !this.r.habitantes.some(h => h.sala === sala && Math.hypot(h.pos.x - x, h.pos.z - z) < 1.2);
      if (libre) dest = new THREE.Vector3(x, y, z);
    }
    if (!dest) return;
    const casa = dest === f.sitio;
    f.destino = dest;
    p.goA(dest, false, () => { f.destino = null; p.reproducir(p.inRest, 0.3); p.goalTurn = casa ? f.giro : (Math.random() * 2 - 1) * 0.8; });
  }

  // ---- charla con el Supervisor
  startChat(f: Copia, lookA: THREE.Vector3) {
    f.talking = true; f.returning = false; f.destino = null; f.p.parar();
    if (WALKING.test(f.p.currentName)) f.p.reproducir(f.p.inRest, 0.2);
    f.chatTurn = Math.sign(lookA.x - f.p.raiz.position.x || 1) * 0.55;
  }
  finishChat(f: Copia) { f.talking = false; f.walkClock = 4; this.aplicar(f, true); }

  /** La copia más cercana a `junto` (en su planta), a menos de `max`. */
  nearby(junto: THREE.Vector3, max: number): { f: Copia; d: number } | null {
    let mejor: { f: Copia; d: number } | null = null;
    for (const f of this.figuras.values()) {
      if (!f.listo || f.leaving || Math.abs(f.p.raiz.position.y - junto.y) > 1) continue;
      const d = Math.hypot(f.p.raiz.position.x - junto.x, f.p.raiz.position.z - junto.z);
      if (d < max && (!mejor || d < mejor.d)) mejor = { f, d };
    }
    return mejor;
  }
  ofId(id: string) { for (const f of this.figuras.values()) if (idCopy(f.ruta) === id) return f; }
  ofPath(ruta: string) { const r = ruta.replace(/\/+$/, ''); for (const f of this.figuras.values()) if (f.ruta.replace(/\/+$/, '') === r) return f; }

  /** El robot mensajero le trae una revisión de su PR (mensajero.ts): de pie o paseando, se para, se gira hacia él y
   *  la recoge; sentado en el proyector o hablando con el Supervisor, sigue a lo suyo */
  receive(f: Copia, desde: THREE.Vector3) {
    if (f.talking || f.leaving || !f.listo || (f.pose !== 'pie' && f.pose !== 'paseo')) return;
    const p = f.p, pos = p.raiz.position;
    p.parar(); f.destino = null; f.walkClock = Math.max(f.walkClock, 4); f.gestureClock = Math.max(f.gestureClock, 3);
    p.goalTurn = Math.atan2(desde.x - pos.x, desde.z - pos.z);
    p.gesture('PickUp', p.inRest);
  }

  // sus proyectores y por dónde andan (para que los habitantes no se les metan dentro)
  positions() { return [...this.figuras.values()].flatMap(f => [f.sitio, f.p.raiz.position]); }

  /** Cada copia, como interlocutor de la interfaz (regleta, barra, intercomunicador). */
  // cada copia, del color de la tarea que trabaja (el mismo que en los tableros): de un vistazo se ve qué tarea tiene
  // sesiones en qué sala
  private taskTone(f: Copia) {
    const t = worktreeTask(f.w), v = versionColors.get().v;
    if (t === f.tarea && f.versionTone === v) return;
    if (t !== f.tarea) knowTasks([t]);
    f.tarea = t; f.versionTone = v; f.tone = t ? new THREE.Color(taskColor(t)) : COLOR;
  }
  summaries(): DwellerSummary[] {
    return [...this.figuras.values()].map(f => {
      const autor = this.r.habitantes.find(h => h.id.id === f.authorId), a = autor?.id;
      const nombre = a?.nombre ?? 'Copia';
      return {
        id: idCopy(f.ruta), nombre: `${nombre} ◇ ${branchCaption(f.w.rama)}`, mote: 'copia holográfica', tipo: a?.tipo ?? '',
        bio: `Copia holográfica de ${nombre} «${a?.mote ?? ''}». Trabaja en el worktree ${f.w.rama || f.ruta}, sin tocar la copia principal del repo.`,
        sala: f.sala.id, nameRoom: f.sala.nombre, ruta: f.ruta, carpeta: f.ruta, estado: f.listo ? f.estado : 'ocioso', detalle: f.detalle, sesionId: f.sesionId,
        robot: autor?.p.aspecto?.especie === 'robot',
        copia: { ruta: f.ruta, rama: f.w.rama, authorId: f.authorId, nameAuthor: nombre, nicknameAuthor: a?.mote ?? '', cambios: f.w.cambios, advanced: f.w.advanced },
      };
    });
  }

  etiquetas(lejos: boolean, junto: THREE.Vector3, selected: Copia | null, aimed: Copia | null = null) {
    return [...this.figuras.values()].filter(f => f.listo && f.p.mixer).map(f => {
      const cerca = f.p.raiz.position.distanceTo(junto) < 2.4, elegida = f === selected || f === aimed;
      const git = f.w.cambios ? `${f.w.cambios} cambios` : f.w.advanced ? `${f.w.advanced} commits por integrar` : 'limpia';
      const detalle = !cerca ? '' : f.estado === 'ocioso' ? git : f.detalle.slice(0, 48);
      const autor = this.r.habitantes.find(h => h.id.id === f.authorId);
      return { k: f, pos: f.p.headPoint(), alto: 0.2, nombre: `${autor?.id.nombre ?? 'Copia'} ◇ ${f.tarea ?? branchCaption(f.w.rama)}`, color: f.tarea ? taskColor(f.tarea) : undefined, estado: f.estado, detalle, cerca: elegida, lejos, prompt: elegida ? 'Hablar' : '', tecla: f === selected ? 'E' : 'Clic', apuntado: f === aimed && f !== selected, relevant: cerca || elegida || f.estado !== 'ocioso' };
    }).filter(x => x.relevant);
  }
}
