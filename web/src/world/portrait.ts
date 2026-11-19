// Retrato en vivo de un habitante para el intercomunicador: un busto renderizado aparte (otro canvas WebGL pequeño)
// que copia en cada fotograma la animación que está haciendo el personaje en la sala.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Character } from './character';
import { clip } from './animations';

export class Portrait {
  canvas: HTMLCanvasElement;
  private r: THREE.WebGLRenderer; private scene = new THREE.Scene(); private cam: THREE.PerspectiveCamera;
  private copy: THREE.Object3D; private mixer: THREE.AnimationMixer; private action: THREE.AnimationAction | null = null; private name = '';
  private accum = 0; private live = true;
  private nodes: [THREE.Object3D, THREE.Object3D][] | null = null;   // pieza del personaje → pieza de la copia (animados por código)
  // `holo`: el de una copia holográfica, en luz como en la sala (su material, con el corte de materializarse siempre abierto)
  constructor(private p: Character, width = 220, height = 260, holo = false) {
    this.canvas = document.createElement('canvas');
    this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
    this.r.setPixelRatio(Math.min(2, devicePixelRatio)); this.r.setSize(width, height, false);
    this.r.outputColorSpace = THREE.SRGBColorSpace; this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.0;
    this.scene.background = new THREE.Color(holo ? '#031118' : '#0b1610');
    this.scene.add(new THREE.HemisphereLight('#cfe9d8', '#2a2018', 1.2));
    const key = new THREE.DirectionalLight('#ffdcb0', 2.2); key.position.set(1.5, 2.5, 3); this.scene.add(key);
    const backLight = new THREE.DirectionalLight('#7dffb0', 1.6); backLight.position.set(-2, 2, -3); this.scene.add(backLight);
    this.copy = SkeletonUtils.clone(p.model);
    this.copy.position.set(0, 0, 0); this.copy.rotation.set(0, 0, 0);
    if (holo) this.holograph();
    this.scene.add(this.copy);
    this.mixer = new THREE.AnimationMixer(this.copy);
    if (p.anim) {   // mismas piezas en el mismo orden (el clon conserva la jerarquía); la raíz no, que mira a cámara
      const orig: THREE.Object3D[] = [], copy: THREE.Object3D[] = [];
      p.model.traverse(n => { if (n !== p.model) orig.push(n); }); this.copy.traverse(n => { if (n !== this.copy) copy.push(n); });
      this.nodes = orig.map((o, i) => [o, copy[i]] as [THREE.Object3D, THREE.Object3D]);
    }
    // encuadre de busto: la cabeza y los hombros
    const head = new THREE.Vector3(); this.copy.updateMatrixWorld(true);
    const bone = this.copy.getObjectByName('head');
    this.cam = new THREE.PerspectiveCamera(24, width / height, 0.1, 50);
    // la caja real del modelo posado (precisa: con las mallas con piel deformadas por sus huesos)
    const box = new THREE.Box3().setFromObject(this.copy, true);
    if (bone) bone.getWorldPosition(head);
    // hay robots cuyo hueso «head» está a media altura (el pivote del torso): entonces manda la caja del modelo
    if (bone && p.anim) {
      // la Octocat es casi toda cabeza: se encuadra la cabeza entera (sin los bigotes, que se salen) y un poco de tentáculos
      const header = new THREE.Box3(); bone.traverse((n: any) => { if (n.isMesh && n.material?.map) header.expandByObject(n, true); });
      const c = header.getCenter(new THREE.Vector3()), t = header.getSize(new THREE.Vector3());
      const d = (t.x * 1.08 / 2) / Math.tan(Math.atan(Math.tan(THREE.MathUtils.degToRad(12)) * this.cam.aspect));
      this.cam.position.set(d * 0.12, c.y - t.y * 0.02, d); this.cam.lookAt(0, c.y - t.y * 0.1, 0);
    } else if (bone && head.y > box.min.y + (box.max.y - box.min.y) * 0.62) {
      const k = (this.p.scale / 0.8); this.cam.position.set(0.3, head.y + 0.42 * k, 2.5 * k); this.cam.lookAt(0, head.y + 0.3 * k, 0);
    } else {
      // robots sin cabeza en su sitio: se encuadra el tercio alto del modelo, sea del tamaño que sea
      const b = box; const h = b.max.y - b.min.y, w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      const cy = b.max.y - h * 0.3, d = Math.max(h * 0.62, w * 0.9) / 2 / Math.tan(THREE.MathUtils.degToRad(12)) + w * 0.3;
      this.cam.position.set(d * 0.12, cy + h * 0.06, d); this.cam.lookAt(0, cy, 0);
    }
  }
  private holograph() {
    const own = new Map<THREE.Material, THREE.Material>();
    const ownMaterial = (m: any) => {
      if (!m?.isShaderMaterial || !m.uniforms?.uCut) return m;
      let c = own.get(m) as THREE.ShaderMaterial | undefined;
      if (!c) {
        c = m.clone() as THREE.ShaderMaterial;
        // comparte el color, el tiempo y el parpadeo de la figura; el corte y la opacidad son suyos
        for (const k of ['uColor', 'uTiempo', 'uGlitch', 'uSemilla', 'uMapa', 'uConMapa']) if (m.uniforms[k]) c.uniforms[k] = m.uniforms[k];
        c.uniforms.uCut = { value: 1e4 }; c.uniforms.uOpacity = { value: 1 };
        if (c.uniforms.uLines) c.uniforms.uLines = { value: 420 };   // de cerca, líneas más finas: se le ve la cara
        own.set(m, c);
      }
      return c;
    };
    // y sin recorte por la esfera envolvente que hereda de la figura (calculada en la sala, a veces a medio materializar)
    this.copy.traverse((n: any) => { if (n.isMesh) { n.material = Array.isArray(n.material) ? n.material.map(ownMaterial) : ownMaterial(n.material); n.frustumCulled = false; } });
  }
  update(dt: number) {
    if (!this.live) return;
    this.accum += dt; if (this.accum < 1 / 30) return; const d = this.accum; this.accum = 0;
    if (this.nodes) {
      // animada por código (la Octocat): se copia la pose de cada pieza tal cual (la deformación de los tentáculos
      // ya viene en la geometría, que es la misma)
      for (const [o, c] of this.nodes) { c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale); }
      this.copy.rotation.y = THREE.MathUtils.damp(this.copy.rotation.y, 0.25, 4, d);
      this.r.render(this.scene, this.cam);
      return;
    }
    const n = this.p.currentName;
    if (n && n !== this.name) {
      this.action?.fadeOut(0.25);
      try { this.action = this.mixer.clipAction(this.p.clipOf(n)); this.action.reset().fadeIn(0.25).play(); this.name = n; } catch {}
    }
    if (this.action && this.p.current) this.action.time = this.p.current.time;
    this.mixer.update(d);
    // la cabeza mira un poco a cámara (sin girar el cuerpo)
    this.copy.rotation.y = THREE.MathUtils.damp(this.copy.rotation.y, 0.25, 4, d);
    this.r.render(this.scene, this.cam);
  }
  // dispose() no suelta el contexto de WebGL: sigue vivo hasta que lo recoja el GC y, pasados 16 (un intercomunicador
  // cada uno), Chromium mata el más antiguo, que es el del refugio (se queda en negro y se recarga la vista)
  destroy() { this.live = false; this.r.dispose(); this.r.forceContextLoss(); this.canvas.remove(); }
}
