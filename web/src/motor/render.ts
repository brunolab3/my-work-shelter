// Renderer, postproceso y bucle. Un único perfil gráfico (es lowpoly: no hace falta más), 60 fps como máximo (menos si
// nada se mueve: ver ritmo.ts) y nada que pintar mientras el juego no está en primer plano (ver foco.ts). Contrato de QA: window.__ready() / window.__step(dt) /
// window.__noLoop.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Recarga la página del juego: sesiones, terminales y lo escrito siguen (viven en el servidor y en la página). */
export function reloadView() { location.reload(); }
import { frameRate, targetFps, cameraMoved } from './ritmo';
import { writing } from './teclado';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, NoiseEffect, BlendFunction, HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing';

// escala de render: en retina no se pinta a 2× (la interfaz HTML sigue nítida); SMAA suaviza los bordes. Con 1,1 la
// imagen se estiraba casi al doble y los rótulos de las salas se leían borrosos (portátil de referencia, 1440×900 retina: 118 fps con 1,5
// frente a 189 con 1,1; sigue sobrado para 60)
const TOPE_RESOLUTION = 1.5;
// anulación por URL para perfilar (?res=0.5)
const DEPURAR = new URLSearchParams(location.search);
const DEBUG_SCALE = +(DEPURAR.get('res') || 1);

/** Vigila la mano del Supervisor (ratón y teclas fuera de los campos de texto) y si hay una ventana maximizada encima */
class FrameRateWatch {
  private lastInput = -Infinity;
  private coveredCache = false;
  private coveredAt = -Infinity;
  constructor() {
    // lo que se escribe en un campo o se hace en una terminal o un navegador no mueve el refugio
    const mano = (e: Event) => { if (!writing(e)) this.lastInput = performance.now(); };
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown']) addEventListener(ev, mano, { capture: true, passive: true });
  }
  /** hubo ratón o teclas sobre el refugio en el último segundo */
  recentInput(now: number) { return now - this.lastInput < 1000; }
  /** una ventana maximizada (intercomunicador, terminal, navegador) tapa el refugio; se mira 4 veces por segundo */
  covered(now: number) {
    if (now - this.coveredAt > 250) {
      this.coveredAt = now;
      this.coveredCache = [...document.querySelectorAll('.maximizada')].some(el => (el as HTMLElement).getClientRects().length > 0);
    }
    return this.coveredCache;
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  bloom!: BloomEffect;
  reloj = new THREE.Clock();
  t = 0;
  private alActualizar: ((dt: number, t: number) => void)[] = [];
  container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    // low-power: en un Mac con GPU integrada y dedicada, «high-performance» encendería la dedicada por nada
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', stencil: false, depth: true, preserveDrawingBuffer: !!(window as any).__noLoop });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;   // las actualiza paso() con su ritmo
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'lienzo3d';
    container.appendChild(this.renderer.domElement);
    // si macOS le quita el contexto de WebGL a la página (la GPU se reinicia, falta memoria) el refugio se queda en
    // negro aunque todo siga funcionando: si no vuelve solo en unos segundos, se recarga la vista
    let perdido = 0;
    this.renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); console.warn('WebGL: contexto perdido');
      clearTimeout(perdido); perdido = window.setTimeout(() => reloadView(), 2500);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => clearTimeout(perdido));

    this.camera = new THREE.PerspectiveCamera(18, 16 / 9, 0.5, 600);
    this.scene.background = new THREE.Color('#0a0908');

    // Luz de entorno suave (como en los previews oficiales): da volumen a los personajes sin aplanarlos
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.24;
    this.scene.environmentRotation.set(0, Math.PI * 0.15, 0);

    this.mountPostprocess();
    window.addEventListener('resize', () => this.redimensionar());
    this.redimensionar();
  }

  private mountPostprocess() {
    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ luminanceThreshold: 0.92, luminanceSmoothing: 0.25, intensity: 0.7, mipmapBlur: true, radius: 0.7 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.renderer.toneMappingExposure = 0.98;
    const degree = new HueSaturationEffect({ saturation: 0.06, hue: 0 });
    const contraste = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0 });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
    const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    noise.blendMode.opacity.value = 0.035;
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, degree, contraste, vignette, noise));
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
  }

  frozenShadows = false;
  private cuadro = 0;

  redimensionar() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, TOPE_RESOLUTION) * DEBUG_SCALE;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  eachFrame(f: (dt: number, t: number) => void) { this.alActualizar.push(f); }

  // el bucle solo corre con el juego en primer plano: fuera, la GPU se queda quieta (ver foco.ts)
  private activo = false;
  onChangeFirstMap(activo: boolean) {
    if (activo === this.activo || (window as any).__noLoop) return;
    this.activo = activo;
    if (activo) { this.reloj.getDelta(); this.pending = 0; this.renderer.setAnimationLoop(() => this.bucle()); }
    else this.renderer.setAnimationLoop(null);
  }

  // tope de 60 fps (en una pantalla de 120 Hz se pinta un fotograma de cada dos), 30 o 10 según ritmo.ts. El tiempo de
  // los que se saltan se suma al siguiente, así el movimiento sigue yendo a tiempo real
  private pending = 0;
  private watch = new FrameRateWatch();
  private lastCamera = new THREE.Matrix4();
  private cameraMoving = false;
  fps = 60;   // el ritmo de ahora (QA: window.__engine.fps)
  private bucle() {
    this.pending += this.reloj.getDelta();
    const now = performance.now();
    // se mueve: la cámara se movió en el último fotograma pintado o hay ratón o teclas sobre el refugio
    const moving = this.cameraMoving || this.watch.recentInput(now);
    this.fps = targetFps(frameRate(), { moving, covered: this.watch.covered(now) });
    if (this.pending < 1 / this.fps - 0.002) return;   // margen para el jitter del vsync
    const dt = this.pending; this.pending = 0;
    this.paso(dt);
    this.cameraMoving = cameraMoved(this.camera.matrixWorld.elements, this.lastCamera.elements);
    this.lastCamera.copy(this.camera.matrixWorld);
  }

  paso(dt: number) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    for (const f of this.alActualizar) f(dt, this.t);
    // sombras del sol: una de cada tres (rehacer el mapa redibuja todo lo que proyecta; el mundo casi no se mueve y
    // a 20 Hz no se aprecia); de lejos, a ratos
    this.cuadro++;
    const r = this.renderer;
    if (this.frozenShadows) r.shadowMap.needsUpdate = this.cuadro % 6 === 0;
    else r.shadowMap.needsUpdate = this.cuadro % 3 === 0;
    this.composer.render(dt);
  }

  arrancar() {
    (window as any).__step = (dt: number) => this.paso(dt);
  }
}
