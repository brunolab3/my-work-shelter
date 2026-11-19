// Personajes KayKit con mezcla de clips, desplazamiento sin deslizamiento y accesorios en los handslots.
import * as THREE from 'three';
import { model, gltf, measure } from '../engine/assets';
import { loadClips, clip, speedNatural } from './animations';
import { CHARACTER_HEIGHT, SCALE_KAYKIT } from './room';
import { AnimOctocat } from './octocat';
import { mountFigure, paint, type Figure } from './figure/assembly';
import { lookOf, lookSignature, type Look } from '@shared/appearance';

export const CAST = {
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
export type AssignmentName = keyof typeof CAST;

// Alturas: todos a la de un personaje (humanos y robots, grandes o no); la Octocat, que es casi toda cabeza, algo menos
const HEIGHTS: Partial<Record<string, number>> = { Octocat: 1.45 };

// Sin el esqueleto Rig_Medium: los clips de KayKit no se les aplican y su animación es procedural (cuerpo, cabeza y tentáculos)
const PROCEDURAL = new Set<string>(['Octocat']);

// 4GTN trae otro esqueleto (Rig_Large, con otras proporciones): los clips de Rig_Medium llevan la traslación de cada
// hueso y le metían la cabeza en el pecho y lo dejaban en cuclillas. A él solo se le aplican las rotaciones, y la
// cadera, a su propia altura.
// Las figuras sobre el esqueleto grande (robots grandes) se adaptan igual.
const clipsAdapted = new Map<string, THREE.AnimationClip>();
function adaptedClip(type: string, name: string, factorHip: number) {
  const k = type + '|' + factorHip.toFixed(4) + '|' + name; const already = clipsAdapted.get(k); if (already) return already;
  const c = clip(name).clone();
  c.tracks = c.tracks.filter(t => !t.name.endsWith('.position') || t.name === 'hips.position');
  for (const t of c.tracks) if (t.name === 'hips.position') { t.values = Float32Array.from(t.values, v => v * factorHip); }
  clipsAdapted.set(k, c); return c;
}

const LOCOMOTION = new Set(['Walking_A', 'Walking_B', 'Walking_C', 'Running_A', 'Running_B', 'Sneaking', 'Walking_Backwards']);

export interface Accessory { path: string; bone: 'handslotr' | 'handslotl' | 'handl' | 'handr' | 'head' | 'chest'; scale?: number; pos?: [number, number, number]; rot?: [number, number, number]; rig?: boolean }

// Quien te espera saluda; si lleva rato esperando (20 s), además salta antes de saludar
export function callOut(p: Character, since: number) {
  // salta y saluda desde el principio; al principio, una de cada dos veces solo saluda; pasados 20 s, siempre salta
  if (performance.now() - since > 20_000 || Math.random() < 0.5) p.seek(() => p.gesture('Waving', 'Idle_A'));
  else p.gesture('Waving', 'Idle_A');
}

export class Character {
  root = new THREE.Group();
  model!: THREE.Object3D;
  mixer!: THREE.AnimationMixer;
  scale = 1;
  current: THREE.AnimationAction | null = null;
  currentName = '';
  private actions = new Map<string, THREE.AnimationAction>();
  private speeds = new Map<string, number>();
  // locomoción
  path: THREE.Vector3[] = [];
  speed = 0;
  running = false;
  goalTurn = 0;
  inRest = 'Idle_A';
  // clips y ritmo de la marcha (el ritmo acelera el clip y la velocidad a la vez: los pies no deslizan)
  gait = { walk: 'Walking_A', run: 'Running_A', walkRhythm: 1.15, runRhythm: 0.9 };
  onArrive: (() => void) | null = null;
  private timeOne: { name: string; then: string | (() => void) } | null = null;
  accessories = new Map<string, THREE.Object3D>();
  // pasos: se detecta el apoyo de cada pie para sincronizar el sonido con la animación
  onStep: ((pie: number) => void) | null = null;
  animateAfter: (() => void) | null = null;   // retoques procedurales sobre la pose (girar la cabeza…)
  private belowFoot = [true, true];
  private footBones: THREE.Object3D[] = [];
  contactShadow!: THREE.Mesh;
  type: string;
  /** el aspecto por piezas (todos menos la Octocat) y la figura montada con él */
  look: Look | null = null;
  figure: Figure | null = null;
  private factorHip = 0;   // solo para los esqueletos que no son Rig_Medium (ver SOLO_ROTACIONES)
  /** Animación por código (los que no llevan Rig_Medium, ver PROCEDURALES); el modelo ya no trae clips propios */
  anim: AnimOctocat | null = null;
  private clipOwn: THREE.AnimationClip | null = null;
  private headOver = 0;

  constructor(type: string, look?: Look | null) { this.type = type; if (!PROCEDURAL.has(type)) this.look = look ?? lookOf({ type }); }
  /** maniquí de escaparate: cabeza lisa, sin cara */
  mannequin = false;

  async load() {
    await loadClips();
    const procedural = PROCEDURAL.has(this.type);
    if (this.look) {
      this.figure = await mountFigure(this.look, { mannequin: this.mannequin });
      this.model = this.figure.model;
      this.scale = CHARACTER_HEIGHT / this.figure.modelHeight;
      this.prepareModel();
    } else {
      this.model = await model(CAST[this.type as AssignmentName] ?? CAST.Protagonist_B, { own: true });
      // tela y plástico mates: con el brillo de serie, la ropa blanca y las gorras se quemaban bajo las lámparas
      this.model.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material) as THREE.MeshStandardMaterial[]) if (m.isMeshStandardMaterial) { m.roughness = Math.max(m.roughness ?? 0.5, 0.82); m.metalness = Math.min(m.metalness ?? 0, 0.1); if (m.map?.image) m.map = softWhites(m.map); } });
      const { size } = measure(this.model);
      this.scale = (HEIGHTS[this.type] ?? CHARACTER_HEIGHT) / size.y;
      this.prepareModel();
    }
    if (procedural) {
      this.anim = new AnimOctocat(this.model, this.scale);
      this.anim.onFinish = () => { if (this.timeOne) this.finishGesture(); };
      this.anim.onStep = pie => this.onStep?.(pie);
      // si el modelo trajera un clip propio, iría siempre en marcha (hoy no trae ninguno)
      this.clipOwn = (await gltf(CAST[this.type as AssignmentName])).animations[0] ?? null;
      if (this.clipOwn) { this.current = this.mixer.clipAction(this.clipOwn); this.current.play(); }
      // las etiquetas, por encima de las orejas
      this.root.updateMatrixWorld(true);
      const header = this.model.getObjectByName('head'), y = header?.getWorldPosition(new THREE.Vector3()).y ?? 0;
      this.headOver = new THREE.Box3().setFromObject(this.model).max.y - y + 0.12;
    }
    // sombra de contacto suave bajo los pies (asienta al personaje en el suelo además de la sombra real)
    this.contactShadow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * (HEIGHTS[this.type] ?? CHARACTER_HEIGHT) / CHARACTER_HEIGHT, 24), materialShadowContact());
    this.contactShadow.rotation.x = -Math.PI / 2; this.contactShadow.position.y = 0.012; this.contactShadow.renderOrder = 1;
    this.root.add(this.contactShadow);
    this.play(this.inRest, 0);
    return this;
  }

  /** Escala, cuelga y anima el modelo recién cargado (también al cambiar de aspecto) */
  private prepareModel() {
    this.model.scale.setScalar(this.scale);
    this.root.add(this.model);
    this.root.name = 'personaje:' + this.type;
    this.root.userData.isStatic = false;
    this.factorHip = 0;
    if (this.figure?.large) {
      const hip = this.model.getObjectByName('hips'), ref = clip('Idle_A').tracks.find(t => t.name === 'hips.position');
      this.factorHip = hip && ref && ref.values[1] ? hip.position.y / ref.values[1] : 1;
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    this.mixer.addEventListener('finished', (e: any) => { if (this.timeOne && e.action === this.actions.get(this.timeOne.name)) this.finishGesture(); });
  }

  /** Se viste con otro aspecto sin dejar de hacer lo que hacía: misma animación, mismos utensilios en la mano.
   *  Si solo cambian los colores, se repinta sin montar nada. */
  private changing = 0;
  async changeLook(a: Look) {
    if (!this.figure || !this.look) return;
    if (lookSignature(a) === lookSignature(this.look)) return;
    const pieces = (x: Look) => lookSignature({ ...x, colors: {} });
    const onlyColors = pieces(a) === pieces(this.look);
    this.look = structuredClone(a);
    if (onlyColors) { paint(this.figure, a); return; }
    const n = ++this.changing;
    const fig = await mountFigure(a);
    if (n !== this.changing) return;
    const name = this.currentName || this.inRest, specs = [...this.specsAccessories.entries()];
    this.mixer.stopAllAction(); this.root.remove(this.model);
    for (const k of [...this.accessories.keys()]) this.accessories.delete(k);
    this.figure = fig; this.model = fig.model; this.scale = CHARACTER_HEIGHT / fig.modelHeight;
    this.actions.clear(); this.speeds.clear(); this.current = null; this.currentName = ''; this.footBones = []; this._head = undefined;
    this.prepareModel();
    this.play(name, 0);
    for (const [k, spec] of specs) await this.couple(k, spec);
    this.onChangeLook?.();
  }
  /** aviso para quien depende del modelo (la cabeza que gira al dormir, el retrato) */
  onChangeLook: (() => void) | null = null;

  // punto justo encima de la cabeza (para anclar etiquetas e iconos)
  private _head: THREE.Object3D | null | undefined;
  headPoint(target = new THREE.Vector3()) {
    if (this._head === undefined) this._head = this.model.getObjectByName('head') ?? null;
    if (this._head) { this._head.getWorldPosition(target); target.y += this.anim ? this.headOver : 0.42 * (this.scale / 0.8); }
    else target.copy(this.root.position).setY(this.root.position.y + 2.1);
    return target;
  }

  /** El clip tal como lo lleva este personaje (adaptado a su esqueleto si no es Rig_Medium) */
  clipOf(name: string) { return this.clipOwn && this.anim ? this.clipOwn : this.factorHip ? adaptedClip(this.type, name, this.factorHip) : clip(name); }

  private finishGesture() {
    const l = this.timeOne!.then; this.timeOne = null;
    if (typeof l === 'function') l(); else this.play(l);
  }

  action(name: string) {
    let a = this.actions.get(name);
    if (!a) { a = this.mixer.clipAction(this.clipOf(name)); this.actions.set(name, a); }
    return a;
  }

  play(name: string, fade = 0.28, opts: { loop?: boolean; vel?: number; since?: number } = {}) {
    if (this.anim) {   // por código: la pose o el gesto que corresponde al clip
      if (this.currentName === name && opts.loop !== false) return this.current;
      this.anim.set(name, opts.loop === false); this.currentName = name;
      return this.current;
    }
    if (this.currentName === name && this.current?.isRunning() && opts.loop !== false) { if (opts.vel) this.current.timeScale = opts.vel; return this.current; }
    const a = this.action(name);
    a.reset();
    a.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = opts.loop === false;
    a.timeScale = opts.vel ?? 1;
    if (opts.since) a.time = opts.since;
    a.enabled = true; a.setEffectiveWeight(1);
    if (this.current && fade > 0) {
      // sincroniza la fase al pasar entre clips de locomoción (no hay tirón de pies)
      if (LOCOMOTION.has(name) && LOCOMOTION.has(this.currentName)) a.time = (this.current.time / this.current.getClip().duration) * a.getClip().duration;
      a.play(); this.current.crossFadeTo(a, fade, false);
    } else { this.current?.stop(); a.play(); }
    this.current = a; this.currentName = name;
    return a;
  }

  // Reproduce un clip una vez y vuelve a otro (o llama a una función)
  gesture(name: string, then: string | (() => void) = this.inRest, fade = 0.2) {
    this.timeOne = { name, then };
    this.play(name, fade, { loop: false });
  }

  // Saltar (quien te llama, el Supervisor con Espacio): de pie, el salto de KayKit; andando (o sin Rig_Medium), un bote
  // del modelo dentro de su raíz, que no corta la marcha
  private hop = -1;
  private hopThen: (() => void) | null = null;
  seek(then: string | (() => void) = this.inRest) {
    if (this.hop >= 0 || this.currentName === 'Jump_Full_Short') return;
    if (!this.inMovement && !this.anim) { this.gesture('Jump_Full_Short', then, 0.1); return; }
    this.hop = 0; this.hopThen = typeof then === 'function' ? then : null;
  }

  speedOf(name: string) {
    if (this.anim) return /^Running/.test(name) ? 2.3 : /^Sneaking/.test(name) ? 0.6 : 1.05;   // a saltitos, sin pies que medir
    if (!this.speeds.has(name)) this.speeds.set(name, speedNatural(name, this.model));
    return this.speeds.get(name)!;
  }

  goA(points: THREE.Vector3[] | THREE.Vector3, run = false, onArrive: (() => void) | null = null) {
    this.path = Array.isArray(points) ? points.map(p => p.clone()) : [points.clone()];
    this.running = run; this.onArrive = onArrive;
  }

  // parar es también dejar de andar: sin esto, quien se paraba a hablar (el Supervisor al llegar por clic, el habitante
  // al que se le habla) se quedaba con el clip de andar puesto, andando en el sitio
  stop() { this.path = []; this.speed = 0; this.onArrive = null; if (LOCOMOTION.has(this.currentName)) this.play(this.inRest, 0.25); }

  get inMovement() { return this.path.length > 0 || this.speed > 0.05; }

  // Movimiento dirigido (teclado): dirección en el plano XZ normalizada o cero
  moveDirection(dir: THREE.Vector2, run: boolean, dt: number, limit?: (p: THREE.Vector3, d: THREE.Vector3) => THREE.Vector3) {
    const clipLoco = run ? this.gait.run : this.gait.walk;
    const vObj = dir.lengthSq() > 0 ? this.speedOf(clipLoco) * (run ? this.gait.runRhythm : this.gait.walkRhythm) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, vObj, 10, dt);
    if (dir.lengthSq() > 0) {
      this.goalTurn = Math.atan2(dir.x, dir.y);
      const d = new THREE.Vector3(dir.x, 0, dir.y).multiplyScalar(this.speed * dt);
      const next = limit ? limit(this.root.position, d) : this.root.position.clone().add(d);
      this.root.position.copy(next);
      this.play(clipLoco, 0.18, { vel: Math.max(0.5, this.speed / this.speedOf(clipLoco)) });
    } else if (LOCOMOTION.has(this.currentName)) this.play(this.inRest, 0.22);
  }

  update(dt: number) {
    // seguir ruta
    if (this.path.length) {
      const goal = this.path[0];
      const d = goal.clone().sub(this.root.position); d.y = 0;
      const dist = d.length();
      const clipLoco = this.running ? this.gait.run : this.gait.walk;
      const vNat = this.speedOf(clipLoco) * (this.running ? this.gait.runRhythm : this.gait.walkRhythm);
      // frena al final del último tramo
      const vObj = this.path.length === 1 ? Math.min(vNat, Math.max(0.35, dist * 3)) : vNat;
      this.speed = THREE.MathUtils.damp(this.speed, vObj, 8, dt);
      if (dist < Math.max(0.05, this.speed * dt * 1.2)) {
        this.root.position.x = goal.x; this.root.position.z = goal.z; this.root.position.y = goal.y;
        this.path.shift();
        if (!this.path.length) {
          this.speed = 0;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) cb();
          // si lo que tocaba al llegar no ha puesto otro clip (ni otra ruta), a reposo: nunca andando en el sitio
          if (!this.path.length && LOCOMOTION.has(this.currentName)) this.play(this.inRest, 0.25);
        }
      } else {
        d.normalize();
        this.root.position.addScaledVector(d, this.speed * dt);
        this.root.position.y = THREE.MathUtils.damp(this.root.position.y, goal.y, 12, dt);
        this.goalTurn = Math.atan2(d.x, d.z);
        this.play(clipLoco, 0.2, { vel: Math.max(0.4, this.speed / this.speedOf(clipLoco)) });
      }
    }
    // giro suave hacia el objetivo (por el camino corto)
    let dg = this.goalTurn - this.root.rotation.y;
    dg = Math.atan2(Math.sin(dg), Math.cos(dg));
    this.root.rotation.y += dg * (1 - Math.exp(-dt * 10));
    this.mixer.update(dt);
    this.anim?.update(dt, this.speed);
    if (this.hop >= 0) {
      this.hop += dt / 0.55;
      const f = Math.min(1, this.hop);
      this.model.position.y = 4 * f * (1 - f) * 0.45 * (this.scale / 0.8);
      if (f >= 1) { this.hop = -1; this.model.position.y = 0; const l = this.hopThen; this.hopThen = null; l?.(); }
    }
    this.animateAfter?.();
    if (this.onStep && (this.speed > 0.2)) {
      if (!this.footBones.length) this.footBones = ['footl', 'footr'].map(n => this.model.getObjectByName(n)!).filter(Boolean);
      const v = new THREE.Vector3();
      this.footBones.forEach((h, k) => {
        h.getWorldPosition(v);
        const height = v.y - this.root.position.y;
        const below = height < 0.075;
        if (below && !this.belowFoot[k]) this.onStep!(k);
        this.belowFoot[k] = below;
      });
    }
  }

  private specsAccessories = new Map<string, Accessory>();
  async couple(key: string, a: Accessory) {
    this.drop(key);
    this.specsAccessories.set(key, a);
    const g = await gltf(a.path);
    const o = g.scene.clone(true);
    o.traverse((n: any) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; if (n.material.map) n.material.map.colorSpace = THREE.SRGBColorSpace; } });
    // los accesorios KayKit vienen a la escala del personaje original (sin escalar): se compensa la escala del hueso
    o.scale.setScalar(a.scale ?? 1);
    if (a.pos) o.position.set(...a.pos);
    if (a.rot) o.rotation.set(...a.rot);
    const bone = this.model.getObjectByName(a.bone);
    if (!bone || !this.specsAccessories.has(key)) return;
    if (a.rig) {
      // pieza modelada en el espacio del personaje (como la mochila del Hoarder): se cuelga del hueso deshaciendo su transformación
      this.model.updateMatrixWorld(true);
      const m = bone.matrixWorld.clone().invert().multiply(this.model.matrixWorld);
      o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(1); o.applyMatrix4(m);
    }
    bone.add(o); this.accessories.set(key, o);
  }
  drop(key: string) { this.specsAccessories.delete(key); const o = this.accessories.get(key); if (o) { o.parent?.remove(o); this.accessories.delete(key); } }

  // Mostrar/ocultar partes del modelo (mochila, gafas) para variantes
  part(name: RegExp, visible: boolean) { this.model.traverse(n => { if (name.test(n.name)) n.visible = visible; }); }

  // Tinte de todo el modelo (los visitantes, empolvados)
  tint(color: string, strength = 0.25) {
    const c = new THREE.Color(color);
    this.model.traverse((n: any) => { if (n.isMesh && n.material.map) n.material.color.lerp(c, strength); });
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
export function turnBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  const qParent = new THREE.Quaternion(); parent.getWorldQuaternion(qParent);
  const qWorld = qParent.clone().multiply(bone.quaternion);
  qWorld.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  bone.quaternion.copy(qParent.invert().multiply(qWorld));
}

// los blancos de la ropa, comprimidos en la textura (piel y colores intactos): bajo un foco no llegan a quemar
const soft = new Map<string, THREE.Texture>();
function softWhites(t: THREE.Texture): THREE.Texture {
  const already = soft.get(t.uuid); if (already) return already;
  const img = t.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return t;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height); const px = d.data; const THRESHOLD = 190;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (l <= THRESHOLD) continue;
    const k = (THRESHOLD + (l - THRESHOLD) * 0.45) / l;
    px[i] *= k; px[i + 1] *= k; px[i + 2] *= k;
  }
  g.putImageData(d, 0, 0);
  const n = new THREE.CanvasTexture(c);
  n.flipY = t.flipY; n.colorSpace = t.colorSpace; n.wrapS = t.wrapS; n.wrapT = t.wrapT; n.magFilter = t.magFilter; n.minFilter = t.minFilter; n.channel = t.channel;
  soft.set(t.uuid, n); return n;
}
