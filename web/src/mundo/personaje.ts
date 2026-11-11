// Personajes KayKit con mezcla de clips, desplazamiento sin deslizamiento y accesorios en los handslots.
import * as THREE from 'three';
import { modelo, gltf, measure } from '../motor/assets';
import { loadClips, clip, speedNatural } from './animaciones';
import { CHARACTER_HEIGHT, SCALE_KAYKIT } from './sala';
import { AnimOctocat } from './octocat';
import { mountFigure, paint, type Figure } from './figura/montaje';
import { lookOf, lookSignature, type Look } from '@shared/aspecto';

export const REPARTO = {
  Engineer: 'kaykit/adventurers-2.0/Characters/gltf/Engineer.glb',
  Survivalist: 'kaykit/mystery-monthly-series-4/9 - March 2024 - Survivalist/character/Survivalist.glb',
  Hoarder: 'kaykit/mystery-monthly-series-6/8 - February 2026 - Hoarder/characters/Hoarder.glb',
  Hiker: 'kaykit/mystery-monthly-series-5/11 - May 2025 - Hiker/characters/Hiker.glb',
  Protagonist_A: 'kaykit/mystery-monthly-series-5/10 - April 2025 - Protagonists/characters/Protagonist_A.glb',
  Protagonist_B: 'kaykit/mystery-monthly-series-5/10 - April 2025 - Protagonists/characters/Protagonist_B.glb',
  Driver: 'kaykit/mystery-monthly-series-4/2 - August 2023 - Driver/character/gltf/Driver.glb',
  SpaceRanger: 'kaykit/mystery-monthly-series-4/7 - January 2024 - Space Ranger/character/SpaceRanger.glb',
  Clanker: 'kaykit/mystery-monthly-series-5/9 - March 2025 - Clanker/characters/Clanker.glb',
  Robot_One: 'kaykit/mystery-monthly-series-4/12 - June 2024 - Robot/characters/Robot_One.glb',
  Robot_Two: 'kaykit/mystery-monthly-series-4/12 - June 2024 - Robot/characters/Robot_Two.glb',
  '4GTN': 'kaykit/mystery-monthly-series-6/7 - January 2026 - 4GTN/characters/4GTN.glb',
  '4GTN_Forgotten': 'kaykit/mystery-monthly-series-6/7 - January 2026 - 4GTN/characters/4GTN_Forgotten.glb',
  Animatronic_Normal: 'kaykit/mystery-monthly-series-4/5 - November 2023 - Animatronic/characters/gltf/Animatronic_Normal.glb',
  Animatronic_Creepy: 'kaykit/mystery-monthly-series-4/5 - November 2023 - Animatronic/characters/gltf/Animatronic_Creepy.glb',
  CombatMech: 'kaykit/mystery-monthly-series-5/1 - July 2024 - Combat Mech/characters/CombatMech.glb',
  // La Octocat de Control de Versiones: modelo de la comunidad (CC-BY 4.0, ver LICENSES/octocat-CC-BY-4.0.txt)
  // repintado en colores planos; sin esqueleto de KayKit: se anima por código (AnimOctocat, octocat.ts)
  // (?v= sube cuando cambia el GLB: sin él, la caché del navegador seguía sirviendo la versión vieja)
  Octocat: 'terceros/octocat/Octocat.glb?v=2',
} as const;
export type AssignmentName = keyof typeof REPARTO;

// Alturas: todos a la de un personaje (humanos y robots, grandes o no); la Octocat, que es casi toda cabeza, algo menos
const HEIGHTS: Partial<Record<string, number>> = { Octocat: 1.45 };

// Sin el esqueleto Rig_Medium: los clips de KayKit no se les aplican y su animación es procedural (cuerpo, cabeza y tentáculos)
const PROCEDURAL = new Set<string>(['Octocat']);

// 4GTN trae otro esqueleto (Rig_Large, con otras proporciones): los clips de Rig_Medium llevan la traslación de cada
// hueso y le metían la cabeza en el pecho y lo dejaban en cuclillas. A él solo se le aplican las rotaciones, y la
// cadera, a su propia altura.
// Las figuras sobre el esqueleto grande (robots grandes) se adaptan igual.
const clipsAdapted = new Map<string, THREE.AnimationClip>();
function clipAdaptado(tipo: string, nombre: string, factorHip: number) {
  const k = tipo + '|' + factorHip.toFixed(4) + '|' + nombre; const ya = clipsAdapted.get(k); if (ya) return ya;
  const c = clip(nombre).clone();
  c.tracks = c.tracks.filter(t => !t.name.endsWith('.position') || t.name === 'hips.position');
  for (const t of c.tracks) if (t.name === 'hips.position') { t.values = Float32Array.from(t.values, v => v * factorHip); }
  clipsAdapted.set(k, c); return c;
}

const LOCOMOTION = new Set(['Walking_A', 'Walking_B', 'Walking_C', 'Running_A', 'Running_B', 'Sneaking', 'Walking_Backwards']);

export interface Accessory { ruta: string; bone: 'handslotr' | 'handslotl' | 'handl' | 'handr' | 'head' | 'chest'; escala?: number; pos?: [number, number, number]; rot?: [number, number, number]; rig?: boolean }

export class Character {
  raiz = new THREE.Group();
  modelo!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  escala = 1;
  actual: THREE.AnimationAction | null = null;
  currentName = '';
  private acciones = new Map<string, THREE.AnimationAction>();
  private speeds = new Map<string, number>();
  // locomoción
  ruta: THREE.Vector3[] = [];
  speed = 0;
  corriendo = false;
  goalTurn = 0;
  inRest = 'Idle_A';
  // clips y ritmo de la marcha (el ritmo acelera el clip y la velocidad a la vez: los pies no deslizan)
  marcha = { andar: 'Walking_A', correr: 'Running_A', walkRhythm: 1.15, runRhythm: 0.9 };
  onArrive: (() => void) | null = null;
  private timeOne: { nombre: string; luego: string | (() => void) } | null = null;
  accesorios = new Map<string, THREE.Object3D>();
  // pasos: se detecta el apoyo de cada pie para sincronizar el sonido con la animación
  onStep: ((pie: number) => void) | null = null;
  animateAfter: (() => void) | null = null;   // retoques procedurales sobre la pose (girar la cabeza…)
  private belowFoot = [true, true];
  private footBones: THREE.Object3D[] = [];
  contactShadow!: THREE.Mesh;
  tipo: string;
  /** el aspecto por piezas (todos menos la Octocat) y la figura montada con él */
  aspecto: Look | null = null;
  figura: Figure | null = null;
  private factorHip = 0;   // solo para los esqueletos que no son Rig_Medium (ver SOLO_ROTACIONES)
  /** Animación por código (los que no llevan Rig_Medium, ver PROCEDURALES); el modelo ya no trae clips propios */
  anim: AnimOctocat | null = null;
  private clipOwn: THREE.AnimationClip | null = null;
  private headOver = 0;

  constructor(tipo: string, aspecto?: Look | null) { this.tipo = tipo; if (!PROCEDURAL.has(tipo)) this.aspecto = aspecto ?? lookOf({ tipo }); }
  /** maniquí de escaparate: cabeza lisa, sin cara */
  maniqui = false;

  async cargar() {
    await loadClips();
    const procedural = PROCEDURAL.has(this.tipo);
    if (this.aspecto) {
      this.figura = await mountFigure(this.aspecto, { maniqui: this.maniqui });
      this.modelo = this.figura.modelo;
      this.escala = CHARACTER_HEIGHT / this.figura.modelHeight;
      this.prepareModel();
    } else {
      this.modelo = await modelo(REPARTO[this.tipo as AssignmentName] ?? REPARTO.Protagonist_B, { own: true });
      // tela y plástico mates: con el brillo de serie, la ropa blanca y las gorras se quemaban bajo las lámparas
      this.modelo.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material) as THREE.MeshStandardMaterial[]) if (m.isMeshStandardMaterial) { m.roughness = Math.max(m.roughness ?? 0.5, 0.82); m.metalness = Math.min(m.metalness ?? 0, 0.1); if (m.map?.image) m.map = blancosSoft(m.map); } });
      const { tam } = measure(this.modelo);
      this.escala = (HEIGHTS[this.tipo] ?? CHARACTER_HEIGHT) / tam.y;
      this.prepareModel();
    }
    if (procedural) {
      this.anim = new AnimOctocat(this.modelo, this.escala);
      this.anim.onFinish = () => { if (this.timeOne) this.finishGesture(); };
      this.anim.onStep = pie => this.onStep?.(pie);
      // si el modelo trajera un clip propio, iría siempre en marcha (hoy no trae ninguno)
      this.clipOwn = (await gltf(REPARTO[this.tipo as AssignmentName])).animations[0] ?? null;
      if (this.clipOwn) { this.actual = this.mixer.clipAction(this.clipOwn); this.actual.play(); }
      // las etiquetas, por encima de las orejas
      this.raiz.updateMatrixWorld(true);
      const cab = this.modelo.getObjectByName('head'), y = cab?.getWorldPosition(new THREE.Vector3()).y ?? 0;
      this.headOver = new THREE.Box3().setFromObject(this.modelo).max.y - y + 0.12;
    }
    // sombra de contacto suave bajo los pies (asienta al personaje en el suelo además de la sombra real)
    this.contactShadow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * (HEIGHTS[this.tipo] ?? CHARACTER_HEIGHT) / CHARACTER_HEIGHT, 24), materialShadowContact());
    this.contactShadow.rotation.x = -Math.PI / 2; this.contactShadow.position.y = 0.012; this.contactShadow.renderOrder = 1;
    this.raiz.add(this.contactShadow);
    this.reproducir(this.inRest, 0);
    return this;
  }

  /** Escala, cuelga y anima el modelo recién cargado (también al cambiar de aspecto) */
  private prepareModel() {
    this.modelo.scale.setScalar(this.escala);
    this.raiz.add(this.modelo);
    this.raiz.name = 'personaje:' + this.tipo;
    this.raiz.userData.estatico = false;
    this.factorHip = 0;
    if (this.figura?.grande) {
      const hip = this.modelo.getObjectByName('hips'), ref = clip('Idle_A').tracks.find(t => t.name === 'hips.position');
      this.factorHip = hip && ref && ref.values[1] ? hip.position.y / ref.values[1] : 1;
    }
    this.mixer = new THREE.AnimationMixer(this.modelo);
    this.mixer.addEventListener('finished', (e: any) => { if (this.timeOne && e.action === this.acciones.get(this.timeOne.nombre)) this.finishGesture(); });
  }

  /** Se viste con otro aspecto sin dejar de hacer lo que hacía: misma animación, mismos utensilios en la mano.
   *  Si solo cambian los colores, se repinta sin montar nada. */
  private changing = 0;
  async changeLook(a: Look) {
    if (!this.figura || !this.aspecto) return;
    if (lookSignature(a) === lookSignature(this.aspecto)) return;
    const piezas = (x: Look) => lookSignature({ ...x, colores: {} });
    const onlyColors = piezas(a) === piezas(this.aspecto);
    this.aspecto = structuredClone(a);
    if (onlyColors) { paint(this.figura, a); return; }
    const n = ++this.changing;
    const fig = await mountFigure(a);
    if (n !== this.changing) return;
    const nombre = this.currentName || this.inRest, specs = [...this.specsAccessories.entries()];
    this.mixer.stopAllAction(); this.raiz.remove(this.modelo);
    for (const k of [...this.accesorios.keys()]) this.accesorios.delete(k);
    this.figura = fig; this.modelo = fig.modelo; this.escala = CHARACTER_HEIGHT / fig.modelHeight;
    this.acciones.clear(); this.speeds.clear(); this.actual = null; this.currentName = ''; this.footBones = []; this._head = undefined;
    this.prepareModel();
    this.reproducir(nombre, 0);
    for (const [k, spec] of specs) await this.couple(k, spec);
    this.onChangeLook?.();
  }
  /** aviso para quien depende del modelo (la cabeza que gira al dormir, el retrato) */
  onChangeLook: (() => void) | null = null;

  // punto justo encima de la cabeza (para anclar etiquetas e iconos)
  private _head: THREE.Object3D | null | undefined;
  headPoint(destino = new THREE.Vector3()) {
    if (this._head === undefined) this._head = this.modelo.getObjectByName('head') ?? null;
    if (this._head) { this._head.getWorldPosition(destino); destino.y += this.anim ? this.headOver : 0.42 * (this.escala / 0.8); }
    else destino.copy(this.raiz.position).setY(this.raiz.position.y + 2.1);
    return destino;
  }

  /** El clip tal como lo lleva este personaje (adaptado a su esqueleto si no es Rig_Medium) */
  clipOf(nombre: string) { return this.clipOwn && this.anim ? this.clipOwn : this.factorHip ? clipAdaptado(this.tipo, nombre, this.factorHip) : clip(nombre); }

  private finishGesture() {
    const l = this.timeOne!.luego; this.timeOne = null;
    if (typeof l === 'function') l(); else this.reproducir(l);
  }

  accion(nombre: string) {
    let a = this.acciones.get(nombre);
    if (!a) { a = this.mixer.clipAction(this.clipOf(nombre)); this.acciones.set(nombre, a); }
    return a;
  }

  reproducir(nombre: string, fade = 0.28, opts: { bucle?: boolean; vel?: number; desde?: number } = {}) {
    if (this.anim) {   // por código: la pose o el gesto que corresponde al clip
      if (this.currentName === nombre && opts.bucle !== false) return this.actual;
      this.anim.poner(nombre, opts.bucle === false); this.currentName = nombre;
      return this.actual;
    }
    if (this.currentName === nombre && this.actual?.isRunning() && opts.bucle !== false) { if (opts.vel) this.actual.timeScale = opts.vel; return this.actual; }
    const a = this.accion(nombre);
    a.reset();
    a.setLoop(opts.bucle === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = opts.bucle === false;
    a.timeScale = opts.vel ?? 1;
    if (opts.desde) a.time = opts.desde;
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.actual && fade > 0) {
      // sincroniza la fase al pasar entre clips de locomoción (no hay tirón de pies)
      if (LOCOMOTION.has(nombre) && LOCOMOTION.has(this.currentName)) a.time = (this.actual.time / this.actual.getClip().duration) * a.getClip().duration;
      a.play(); this.actual.crossFadeTo(a, fade, false);
    } else { this.actual?.stop(); a.play(); }
    this.actual = a; this.currentName = nombre;
    return a;
  }

  // Reproduce un clip una vez y vuelve a otro (o llama a una función)
  gesture(nombre: string, luego: string | (() => void) = this.inRest, fade = 0.2) {
    this.timeOne = { nombre, luego };
    this.reproducir(nombre, fade, { bucle: false });
  }

  speedOf(nombre: string) {
    if (this.anim) return /^Running/.test(nombre) ? 2.3 : /^Sneaking/.test(nombre) ? 0.6 : 1.05;   // a saltitos, sin pies que medir
    if (!this.speeds.has(nombre)) this.speeds.set(nombre, speedNatural(nombre, this.modelo));
    return this.speeds.get(nombre)!;
  }

  goA(puntos: THREE.Vector3[] | THREE.Vector3, correr = false, onArrive: (() => void) | null = null) {
    this.ruta = Array.isArray(puntos) ? puntos.map(p => p.clone()) : [puntos.clone()];
    this.corriendo = correr; this.onArrive = onArrive;
  }

  // parar es también dejar de andar: sin esto, quien se paraba a hablar (el Supervisor al llegar por clic, el habitante
  // al que se le habla) se quedaba con el clip de andar puesto, andando en el sitio
  parar() { this.ruta = []; this.speed = 0; this.onArrive = null; if (LOCOMOTION.has(this.currentName)) this.reproducir(this.inRest, 0.25); }

  get inMovement() { return this.ruta.length > 0 || this.speed > 0.05; }

  // Movimiento dirigido (teclado): dirección en el plano XZ normalizada o cero
  moveDirection(dir: THREE.Vector2, correr: boolean, dt: number, limitar?: (p: THREE.Vector3, d: THREE.Vector3) => THREE.Vector3) {
    const clipLoco = correr ? this.marcha.correr : this.marcha.andar;
    const vObj = dir.lengthSq() > 0 ? this.speedOf(clipLoco) * (correr ? this.marcha.runRhythm : this.marcha.walkRhythm) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, vObj, 10, dt);
    if (dir.lengthSq() > 0) {
      this.goalTurn = Math.atan2(dir.x, dir.y);
      const d = new THREE.Vector3(dir.x, 0, dir.y).multiplyScalar(this.speed * dt);
      const nueva = limitar ? limitar(this.raiz.position, d) : this.raiz.position.clone().add(d);
      this.raiz.position.copy(nueva);
      this.reproducir(clipLoco, 0.18, { vel: Math.max(0.5, this.speed / this.speedOf(clipLoco)) });
    } else if (LOCOMOTION.has(this.currentName)) this.reproducir(this.inRest, 0.22);
  }

  actualizar(dt: number) {
    // seguir ruta
    if (this.ruta.length) {
      const goal = this.ruta[0];
      const d = goal.clone().sub(this.raiz.position); d.y = 0;
      const dist = d.length();
      const clipLoco = this.corriendo ? this.marcha.correr : this.marcha.andar;
      const vNat = this.speedOf(clipLoco) * (this.corriendo ? this.marcha.runRhythm : this.marcha.walkRhythm);
      // frena al final del último tramo
      const vObj = this.ruta.length === 1 ? Math.min(vNat, Math.max(0.35, dist * 3)) : vNat;
      this.speed = THREE.MathUtils.damp(this.speed, vObj, 8, dt);
      if (dist < Math.max(0.05, this.speed * dt * 1.2)) {
        this.raiz.position.x = goal.x; this.raiz.position.z = goal.z; this.raiz.position.y = goal.y;
        this.ruta.shift();
        if (!this.ruta.length) {
          this.speed = 0;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) cb();
          // si lo que tocaba al llegar no ha puesto otro clip (ni otra ruta), a reposo: nunca andando en el sitio
          if (!this.ruta.length && LOCOMOTION.has(this.currentName)) this.reproducir(this.inRest, 0.25);
        }
      } else {
        d.normalize();
        this.raiz.position.addScaledVector(d, this.speed * dt);
        this.raiz.position.y = THREE.MathUtils.damp(this.raiz.position.y, goal.y, 12, dt);
        this.goalTurn = Math.atan2(d.x, d.z);
        this.reproducir(clipLoco, 0.2, { vel: Math.max(0.4, this.speed / this.speedOf(clipLoco)) });
      }
    }
    // giro suave hacia el objetivo (por el camino corto)
    let dg = this.goalTurn - this.raiz.rotation.y;
    dg = Math.atan2(Math.sin(dg), Math.cos(dg));
    this.raiz.rotation.y += dg * (1 - Math.exp(-dt * 10));
    this.mixer.update(dt);
    this.anim?.actualizar(dt, this.speed);
    this.animateAfter?.();
    if (this.onStep && (this.speed > 0.2)) {
      if (!this.footBones.length) this.footBones = ['footl', 'footr'].map(n => this.modelo.getObjectByName(n)!).filter(Boolean);
      const v = new THREE.Vector3();
      this.footBones.forEach((h, k) => {
        h.getWorldPosition(v);
        const alto = v.y - this.raiz.position.y;
        const abajo = alto < 0.075;
        if (abajo && !this.belowFoot[k]) this.onStep!(k);
        this.belowFoot[k] = abajo;
      });
    }
  }

  private specsAccessories = new Map<string, Accessory>();
  async couple(clave: string, a: Accessory) {
    this.soltar(clave);
    this.specsAccessories.set(clave, a);
    const g = await gltf(a.ruta);
    const o = g.scene.clone(true);
    o.traverse((n: any) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; if (n.material.map) n.material.map.colorSpace = THREE.SRGBColorSpace; } });
    // los accesorios KayKit vienen a la escala del personaje original (sin escalar): se compensa la escala del hueso
    o.scale.setScalar(a.escala ?? 1);
    if (a.pos) o.position.set(...a.pos);
    if (a.rot) o.rotation.set(...a.rot);
    const bone = this.modelo.getObjectByName(a.bone);
    if (!bone || !this.specsAccessories.has(clave)) return;
    if (a.rig) {
      // pieza modelada en el espacio del personaje (como la mochila del Hoarder): se cuelga del hueso deshaciendo su transformación
      this.modelo.updateMatrixWorld(true);
      const m = bone.matrixWorld.clone().invert().multiply(this.modelo.matrixWorld);
      o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.applyMatrix4(m);
    }
    bone.add(o); this.accesorios.set(clave, o);
  }
  soltar(clave: string) { this.specsAccessories.delete(clave); const o = this.accesorios.get(clave); if (o) { o.parent?.remove(o); this.accesorios.delete(clave); } }

  // Mostrar/ocultar partes del modelo (mochila, gafas) para variantes
  parte(nombre: RegExp, visible: boolean) { this.modelo.traverse(n => { if (nombre.test(n.name)) n.visible = visible; }); }

  // Tinte de todo el modelo (los visitantes, empolvados)
  tint(color: string, fuerza = 0.25) {
    const c = new THREE.Color(color);
    this.modelo.traverse((n: any) => { if (n.isMesh && n.material.map) n.material.color.lerp(c, fuerza); });
  }
}

let _shadow: THREE.Material | null = null;
function materialShadowContact() {
  if (_shadow) return _shadow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  _shadow = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return _shadow;
}

export { SCALE_KAYKIT };

// Gira un hueso en espacio de mundo (después de la animación): p. ej. la cabeza de quien duerme hacia la cámara
export function turnBoneWorld(bone: THREE.Object3D, eje: THREE.Vector3, angulo: number) {
  const padre = bone.parent!;
  padre.updateWorldMatrix(true, false);
  const qParent = new THREE.Quaternion(); padre.getWorldQuaternion(qParent);
  const qWorld = qParent.clone().multiply(bone.quaternion);
  qWorld.premultiply(new THREE.Quaternion().setFromAxisAngle(eje, angulo));
  bone.quaternion.copy(qParent.invert().multiply(qWorld));
}

// los blancos de la ropa, comprimidos en la textura (piel y colores intactos): bajo un foco no llegan a quemar
const soft = new Map<string, THREE.Texture>();
function blancosSoft(t: THREE.Texture): THREE.Texture {
  const ya = soft.get(t.uuid); if (ya) return ya;
  const img = t.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return t;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height); const px = d.data; const UMBRAL = 190;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (l <= UMBRAL) continue;
    const k = (UMBRAL + (l - UMBRAL) * 0.45) / l;
    px[i] *= k; px[i + 1] *= k; px[i + 2] *= k;
  }
  g.putImageData(d, 0, 0);
  const n = new THREE.CanvasTexture(c);
  n.flipY = t.flipY; n.colorSpace = t.colorSpace; n.wrapS = t.wrapS; n.wrapT = t.wrapT; n.magFilter = t.magFilter; n.minFilter = t.minFilter; n.channel = t.channel;
  soft.set(t.uuid, n); return n;
}
