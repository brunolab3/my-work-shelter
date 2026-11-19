// Estudio de fotografía del probador: una escena pequeña con su luz y su cámara donde se monta una figura para verla
// de cerca (la vista previa, que se mueve) o para sacarle una miniatura (cada pieza puesta sobre quien se está vistiendo).
import * as THREE from 'three';
import { Character } from '../character';
import type { Look, Slot } from '@shared/appearance';

export type Focus = 'cara' | 'cabeza' | 'torso' | 'piernas' | 'cuerpo' | 'espalda';
export const FOCUS: Record<Slot | 'colores', Focus> = {
  cara: 'cara', cejas: 'cara', pelo: 'cabeza', barba: 'cara', cabeza: 'cabeza', sombrero: 'cabeza', gafas: 'cara',
  torso: 'torso', brazos: 'torso', piernas: 'piernas', espalda: 'espalda', complemento: 'cuerpo', colores: 'cuerpo',
};

export class Studio {
  r: THREE.WebGLRenderer; scene = new THREE.Scene(); cam: THREE.PerspectiveCamera;
  p: Character | null = null;
  private goal = new THREE.Vector3(0, 1, 0); private distance = 4; private heightCam = 1;
  private obj = { goal: new THREE.Vector3(0, 1, 0), distance: 4, heightCam: 1 };
  rotation = 0.35;
  constructor(public canvas: HTMLCanvasElement, width: number, height: number, photo = false) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: photo, powerPreference: 'low-power' });
    this.r.setPixelRatio(photo ? 1 : Math.min(2, devicePixelRatio)); this.r.setSize(width, height, false);
    this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.05;
    this.r.shadowMap.enabled = !photo;
    this.cam = new THREE.PerspectiveCamera(26, width / height, 0.05, 50);
    // luz de estudio: clave cálida, relleno frío, contraluz y un suelo que recibe la sombra
    this.scene.add(new THREE.HemisphereLight('#e8eef8', '#3a2f26', 1.15));
    const key = new THREE.DirectionalLight('#fff0dc', 2.4); key.position.set(2.2, 3.6, 3.2); key.castShadow = !photo;
    key.shadow.mapSize.set(1024, 1024); const sc = key.shadow.camera; sc.left = -1.5; sc.right = 1.5; sc.top = 2.5; sc.bottom = -0.5; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.03;
    this.scene.add(key);
    const filler = new THREE.DirectionalLight('#9fc4ff', 0.7); filler.position.set(-3, 1.6, 2); this.scene.add(filler);
    const backLight = new THREE.DirectionalLight('#ffd7a0', 1.4); backLight.position.set(-1.5, 2.6, -3); this.scene.add(backLight);
    if (!photo) {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    }
  }

  /** Monta la figura de un aspecto (la anterior se va cuando la nueva está lista) */
  private turn = 0;
  async set(a: Look, clipRest = 'Idle_A') {
    const n = ++this.turn;
    const p = new Character('probador', a); p.inRest = clipRest;
    await p.load();
    if (n !== this.turn) { release(p); return false; }
    p.contactShadow.visible = false;
    p.root.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    if (this.p) { this.scene.remove(this.p.root); release(this.p); }
    this.p = p; this.scene.add(p.root);
    p.mixer.update(0.6);
    return true;
  }

  /** Encuadre de una parte del cuerpo (con `inmediato`, sin viaje de cámara) */
  frame(e: Focus, immediate = false) {
    if (!this.p) return;
    const m = this.p.model; this.p.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m, true);
    const y = (n: string, def: number) => m.getObjectByName(n)?.getWorldPosition(new THREE.Vector3()).y ?? def;
    const above = box.max.y, head = y('head', above * 0.62), hip = y('hips', above * 0.3);
    const span = e === 'cara' ? [head + 0.02, Math.min(above, head + 0.78)] : e === 'cabeza' ? [head - 0.22, above + 0.06] : e === 'torso' ? [hip - 0.25, head + 0.45] : e === 'piernas' ? [-0.05, hip + 0.45] : [-0.05, above + 0.08];
    const height = span[1] - span[0], cy = (span[0] + span[1]) / 2;
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * (e === 'cara' ? 0.45 : e === 'cabeza' ? 0.62 : 0.85);
    const vfov = THREE.MathUtils.degToRad(this.cam.fov);
    const d = Math.max(height * 1.18 / 2 / Math.tan(vfov / 2), width * 1.12 / 2 / Math.tan(vfov / 2) / this.cam.aspect) + 0.2;
    this.obj.goal.set(0, cy, 0); this.obj.distance = d; this.obj.heightCam = cy + height * 0.08;
    if (e === 'espalda') this.rotation = Math.PI + 0.45;
    if (immediate) { this.goal.copy(this.obj.goal); this.distance = d; this.heightCam = this.obj.heightCam; }
  }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * 7);
    this.goal.lerp(this.obj.goal, k); this.distance += (this.obj.distance - this.distance) * k; this.heightCam += (this.obj.heightCam - this.heightCam) * k;
    if (this.p) { this.p.root.rotation.y = this.rotation; this.p.mixer.update(dt); this.p.anim?.update(dt, 0); }
    this.cam.position.set(this.goal.x, this.heightCam, this.goal.z + this.distance); this.cam.lookAt(this.goal);
    this.r.render(this.scene, this.cam);
  }

  destroy() { if (this.p) release(this.p); this.p = null; this.r.dispose(); this.r.forceContextLoss(); }
}

/** Suelta lo que es solo de esta figura (geometrías juntadas y materiales); las piezas, que comparten todas, se quedan */
export function release(p: Character) {
  p.mixer?.stopAllAction();
  p.root.traverse((o: any) => {
    if (!o.isMesh) return;
    if (o.geometry?.userData?.own) o.geometry.dispose();
    for (const m of [].concat(o.material) as THREE.Material[]) if (m?.userData?.own) m.dispose();
  });
}

// ---------------------------------------------------------------- miniaturas
// un solo estudio para todas, sin ventana: cada miniatura es la figura con esa pieza puesta, vista donde va la pieza
let photos: Studio | null = null;
const done = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
const SIDE = 176;
export function thumbnail(a: Look, e: Focus, current: () => boolean = () => true): Promise<string | null> {
  const key = e + '|' + JSON.stringify(a);
  const already = done.get(key); if (already) return Promise.resolve(already);
  const p = queue.then(async () => {
    const already2 = done.get(key); if (already2) return already2;
    if (!current()) return null;   // ya no se enseña (otra ranura, otro aspecto): ni se monta
    photos ??= new Studio(document.createElement('canvas'), SIDE, SIDE, true);
    await photos.set(a);
    photos.rotation = 0.3; photos.frame(e, true); photos.update(0);
    const url = photos.canvas.toDataURL('image/png');
    if (done.size > 600) done.delete(done.keys().next().value!);
    done.set(key, url); return url;
  });
  queue = p.catch(() => {});
  return p;
}
