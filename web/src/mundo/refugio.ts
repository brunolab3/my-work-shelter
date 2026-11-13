// El mundo: el refugio entero (plantas, salas, ascensor, roca y superficie), sus habitantes y el Supervisor.
import * as THREE from 'three';
import type { Engine } from '../motor/render';
import { ShelterCamera } from '../motor/camara';
import { teclado } from '../motor/teclado';
import { BACKGROUND, HEIGHT, SLAB, FLOOR, FRAME, MODULO, caja, mundo, type Sala, type Interactive } from './salas/comun';
import { VARIANTS } from '../motor/paleta';
import { buildRoom, type SavedRoom } from './salas';
import { Steam, Sparks } from './efectos';
import { Gallery } from './tiro';
import { Helpers } from './ayudantes';
import { Messengers } from './mensajero';
import { Holograms, type Copia } from './hologramas';
import { Visitors } from './visitantes';
import { SHOP } from '@shared/catalogo';
import { Character } from './personaje';
import { lookOf, lookSignature, type Look } from '@shared/aspecto';
import { Habitante, type Identity } from './habitante';
import { TagsLayer } from './etiquetas';
import { Portrait } from './retrato';
import { Ascensor, ELEVATOR_WIDTH } from './ascensor';
import { LightsAssignment } from './luces';
import { rockFace } from './roca';
import { place, R } from '../motor/assets';
import { mergeStatic } from './util3d';
import { buildSurface } from './superficie';
import { buildEnvironment } from './entorno';
import { Sky } from './cielo';
import { juego } from '../ui/estadoJuego';
import { isCopy, idCopy } from '../ui/copias';
import { SFX, bootAmbient } from '../audio/sonido';
import { audioWorld } from '../audio/mundo';
import { vivo } from '../red/cliente';
import type { SessionSummary } from '@shared/protocolo';
import { INITIAL_ROOMS, INITIAL_DWELLERS, ROOM_SUPERVISOR } from '@shared/refugioInicial';
import { decorSignature } from '@shared/decorado';
import { alphabeticalOrder } from '@shared/disposicion';
import { t as tx } from '@shared/idioma';

const ROOM_WIDTH = 12;
const loadingAcc = new WeakMap<Character, Set<string>>();
const ROOM_STEP = ROOM_WIDTH + FRAME * 2;

export function xRoom(lado: 'izq' | 'der', orden: number) {
  const d = ELEVATOR_WIDTH / 2 + FRAME + FRAME + ROOM_WIDTH / 2 + orden * ROOM_STEP;
  return lado === 'izq' ? -d : d;
}
export const yRoom = (planta: number) => -planta * FLOOR;
// la calle está a la altura de la planta baja (un pelo por debajo de su suelo): se entra y se sale por la puerta
export const STREET = -0.1;

export class Refugio {
  motor: Engine;
  camara: ShelterCamera;
  salas: Sala[] = [];
  habitantes: Habitante[] = [];
  supervisor!: Character;
  ascensor!: Ascensor;
  reparto: LightsAssignment;
  sun!: THREE.DirectionalLight;
  listo: Promise<void>;
  following = true;
  etiquetas = new TagsLayer();
  cercano: Habitante | null = null;
  nearby: Copia | null = null;     // copia holográfica a mano para hablar (si está más cerca que cualquier habitante)
  nearDevice: { sala: Sala; it: Interactive } | null = null;
  distRoom = 30;
  viewGeneral = false;
  currentRoom: Sala | null = null;
  plantas = 1;
  private montado = false;           // el Supervisor va en el ascensor
  private focused: Habitante | null = null;
  private copyFocused: Copia | null = null;
  retrato: Portrait | null = null;
  progressCarga = 0;
  galeria = new Gallery(this);
  ayudantes = new Helpers(this);
  messengers = new Messengers(this);
  visitantes = new Visitors(this);
  hologramas = new Holograms(this);
  activityMode = false;
  private roomsTurn = 0;            // una actividad manda en la cámara y en el Supervisor
  private pulseAsc = false;

  constructor(motor: Engine) {
    this.motor = motor;
    this.camara = new ShelterCamera(motor.camera);
    this.reparto = new LightsAssignment(motor.scene, 6, 3);
    mundo.salas = () => this.salas; mundo.supervisor = () => this.supervisor?.raiz ?? null; mundo.currentRoom = () => this.currentRoom; mundo.habitantes = () => this.habitantes; mundo.camara = () => motor.camera;
    // las copias holográficas son intangibles: no cuentan como ocupantes (se pasea a través de ellas)
    Habitante.occupants = () => [...this.habitantes.map(h => h.p.raiz), ...(this.supervisor ? [this.supervisor.raiz] : [])];
    this.listo = this.construir();
    motor.eachFrame((dt, t) => this.actualizar(dt, t));
    motor.renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); this.zoomToward(e); }, { passive: false });
    teclado.escuchar(e => {
      if (juego.get().talkingWith) return false;
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.cercano) { this.interact(this.cercano); return true; }
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.nearby) { this.interactCopy(this.nearby); return true; }
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.nearDevice) { this.useDevice(this.nearDevice.sala, this.nearDevice.it); return true; }
      // la terminal de la sala, en su carpeta de trabajo (las especiales también tienen una)
      if (e.code === 'KeyT' && this.currentRoom && (this.currentRoom.ruta || vivo.get().estado?.salas?.some((s: any) => s.id === this.currentRoom!.id && s.carpeta))) { window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { salaId: this.currentRoom.id } })); return true; }
      // Espacio: el Supervisor salta (también andando)
      if (e.code === 'Space' && this.supervisor && !this.montado) { this.supervisor.saltar(); return true; }
      if (e.code === 'KeyZ' || e.code === 'Minus' || e.code === 'Equal') { this.toggleView(e.code === 'Equal' ? false : e.code === 'Minus' ? true : !this.viewGeneral); return true; }
    });
    window.addEventListener('refugio:fin-dialogo', () => this.dialogEnd());
    // el probador enseña el aspecto que se está eligiendo sobre el propio personaje (sin guardar todavía)
    window.addEventListener('refugio:probar', (e: any) => { const { quien, aspecto } = e.detail ?? {}; const p = quien === 'supervisor' ? this.supervisor : this.habitantes.find(h => h.id.id === quien)?.p; if (p && aspecto) p.changeLook(aspecto); });
    vivo.subscribe(() => { if (this.built) this.syncHolograms(); });
    let signatureAcc = '';
    vivo.subscribe(() => { const e = vivo.get().estado; if (!e || !this.built) return; const f = JSON.stringify([e.supervisor?.accesorios, e.habitantes?.map((h: any) => h.accesorios)]); if (f !== signatureAcc) { signatureAcc = f; this.applyAccessories(); } });
    let aspectos = '';
    vivo.subscribe(() => {
      const e = vivo.get().estado; if (!e || !this.built) return;
      const f = JSON.stringify([e.supervisor?.aspecto, e.supervisor?.personaje, (e.habitantes as any[])?.map(h => [h.aspecto, h.tone])]);
      if (f === aspectos) return; aspectos = f;
      this.changeSupervisor(lookOf({ tipo: e.supervisor?.personaje ?? 'Protagonist_B', aspecto: e.supervisor?.aspecto }));
      this.dressDwellers();
    });
    // viaje rápido desde el plano o la lista de ocupados; con `hablar`, abre el diálogo con ese habitante
    window.addEventListener('refugio:ir', (ev: any) => {
      const { salaId, dwellerId, talk } = ev.detail ?? {};
      if (isCopy(dwellerId)) { this.goACopy(dwellerId, talk); return; }
      this.goARoom(salaId);
      const h = this.habitantes.find(x => x.id.id === dwellerId);
      if (h) {
        const sp = this.supervisor.raiz.position; sp.x = h.pos.x + (h.pos.x > (this.currentRoom?.grupo.position.x ?? 0) ? -1.3 : 1.3); sp.z = Math.min(1.6, h.pos.z + 0.6);
        this.camara.immediate();
        if (talk) this.interact(h);
      }
    });
    vivo.subscribe(() => this.syncSessions());
    // clic: ir a un sitio; clic en un habitante: ir y hablar; clic en un aparato: ir y usarlo
    const lienzo = motor.renderer.domElement; let abajo: { x: number; y: number } | null = null;
    // arrastrar (más de 6 px con el botón pulsado) mueve la cámara; al soltar no hay clic
    let ultimo: { x: number; y: number } | null = null, dragging = false;
    lienzo.addEventListener('pointerdown', e => { if (e.button !== 0) return; abajo = ultimo = { x: e.clientX, y: e.clientY }; dragging = false; lienzo.setPointerCapture(e.pointerId); });
    lienzo.addEventListener('pointerup', e => { if (abajo && !dragging && Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) < 6) this.clic(e); abajo = ultimo = null; if (dragging) { dragging = false; lienzo.style.cursor = ''; } });
    lienzo.addEventListener('pointercancel', () => { abajo = ultimo = null; dragging = false; lienzo.style.cursor = ''; });
    lienzo.addEventListener('pointermove', e => {
      this.raton = this.ndc(e);
      if (!abajo || !ultimo || !(e.buttons & 1)) return;
      if (!dragging && Math.hypot(e.clientX - abajo.x, e.clientY - abajo.y) >= 6) { dragging = true; lienzo.style.cursor = 'grabbing'; this.apuntado = null; }
      if (dragging) { this.camara.drag(e.clientX - ultimo.x, e.clientY - ultimo.y, lienzo.clientHeight); ultimo = { x: e.clientX, y: e.clientY }; }
    });
    this.cameraDragging = () => dragging;
    lienzo.addEventListener('pointerleave', () => { this.raton = null; });
  }

  lightGlobal() {
    const s = this.motor.scene;
    s.add(new THREE.HemisphereLight('#b9c6d8', '#3a2c20', 0.3));
    const sun = new THREE.DirectionalLight('#ffe2bf', 0.42);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const sc = sun.shadow.camera; sc.left = -15; sc.right = 15; sc.top = 9; sc.bottom = -6; sc.near = 2; sc.far = 60;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.035; sun.shadow.radius = 3;
    s.add(sun, sun.target);
    this.sun = sun;
    const contra = new THREE.DirectionalLight('#a9c2ff', 1.1); contra.position.set(-3, 6, -14); s.add(contra, contra.target);
    s.fog = new THREE.Fog('#0a0908', 90, 260);
  }

  // Salas guardadas (del servidor; si no hay conexión, la disposición inicial)
  private async disposicion(): Promise<{ salas: SavedRoom[]; habitantes: (Identity & { salaId: string })[] }> {
    const t0 = performance.now();
    while (!vivo.get().estado && performance.now() - t0 < 1500) await new Promise(r => setTimeout(r, 50));
    const e = vivo.get().estado;
    const salas = (e?.salas ?? INITIAL_ROOMS) as SavedRoom[];
    const habitantes = ((e?.habitantes ?? INITIAL_DWELLERS) as any[]).map(h => ({ id: h.id, nombre: h.nombre, mote: h.mote, tipo: h.tipo, bio: h.bio, voz: h.voz, tinte: h.tinte, tone: h.tone, aspecto: h.aspecto, salaId: h.salaId }));
    return { salas, habitantes };
  }

  async construir() {
    this.lightGlobal();
    const { salas: saved, habitantes } = await this.disposicion();
    this.saved = saved;
    this.plantas = Math.max(...saved.map(s => s.planta)) + 1;
    // primero la sala del Supervisor, luego el resto: el refugio aparece por partes
    const orden = [...saved].sort((a, b) => (a.id === ROOM_SUPERVISOR ? -1 : b.id === ROOM_SUPERVISOR ? 1 : a.planta - b.planta));
    let n = 0;
    for (const sg of orden) {
      const sala = await this.mountRoom(sg, saved);
      this.progressCarga = ++n / orden.length;
      window.dispatchEvent(new CustomEvent('refugio:carga', { detail: { progreso: this.progressCarga, sala: sg.nombre } }));
      if (sg.id === ROOM_SUPERVISOR || (!this.supervisor && n === 1)) await this.prepareSupervisor(sala);
    }
    this.ascensor = new Ascensor(this.plantas);
    this.ascensor.rotular(saved);
    await this.ascensor.construir();
    this.motor.scene.add(this.ascensor.grupo);
    this.ascensor.llamar(this.currentRoom?.planta ?? 1);
    // roca alrededor de todo y, arriba, la calle (con la puerta y la torre del ascensor a pie de calle)
    const xs = this.salas.map(s => s.grupo.position.x);
    const x0 = Math.min(...xs, 0) - 40, x1 = Math.max(...xs, 0) + 40;
    this.limits = [x0, x1];
    this.redoRock();
    const hueco: [number, number] = [-ELEVATOR_WIDTH / 2 - FRAME, ELEVATOR_WIDTH / 2 + FRAME];
    const buildings = [hueco, ...this.salas.filter(s => s.planta === 0).map(s => [s.grupo.position.x - s.ancho / 2 - FRAME, s.grupo.position.x + s.ancho / 2 + FRAME] as [number, number])];
    this.motor.scene.add(await buildSurface(x0, x1, STREET, BACKGROUND / 2 + 0.25, -BACKGROUND / 2 - 0.4, buildings, hueco));
    this.cielo = new Sky(this.motor, STREET); this.motor.scene.add(this.cielo.grupo);   // cielo y luz de fuera según la hora real
    // habitantes
    for (const id of habitantes) {
      const h = await this.addDweller(id); if (!h) continue;
      // sin sesión nadie «trabaja»: los estados de trabajo solo los pone una sesión real (o la demo con ?ciclo)
      h.cambiar('ocioso');
      h.initialHobby();   // quien vive en una sala con afición (galería, proyección, hidroponía) empieza practicándola
      if (h.p.ruta.length) { const fin = h.p.ruta[h.p.ruta.length - 1]; h.p.raiz.position.copy(fin); const cb = h.p.onArrive; h.p.ruta = []; h.p.onArrive = null; cb?.(); }
    }
    bootAmbient();
    if (this.currentRoom) this.supervisor.raiz.position.copy(this.freeGap(this.currentRoom));
    const q = new URLSearchParams(location.search).get('sala'); if (q) this.goARoom(q, true);
    this.publish();
    this.syncSessions();
    if (new URLSearchParams(location.search).has('ciclo')) this.cycleDemo();
    this.built = true;
    this.syncHolograms(); this.applyAccessories();
    this.layoutSignature = this.signatureOf(vivo.get().estado);
    vivo.subscribe(() => { const f = this.signatureOf(vivo.get().estado); if (f && f !== this.layoutSignature) { this.layoutSignature = f; this.queue = this.queue.then(() => this.applyLayout()).catch(e => console.error(e)); } });
  }

  // ---- disposición: montar, rehacer y excavar salas en caliente (sin recargar ni tocar las sesiones)
  saved: SavedRoom[] = [];
  private built = false;
  private layoutSignature = '';
  private queue: Promise<void> = Promise.resolve();
  private roca: THREE.Object3D | null = null;
  private limits: [number, number] = [-60, 60];
  // (con qué carpetas faltan: cuando aparece una, p. ej. un repo de ejemplo recién clonado, su sala se vuelve a montar)
  private signatureOf(e: any) { return e ? JSON.stringify([e.salas?.map((s: any) => [s.id, s.planta, s.lado, s.orden, s.nombre, s.variant, s.estilo, s.area, s.ruta, decorSignature(s.decorado)]), e.habitantes?.map((h: any) => h.id + '@' + h.salaId), Object.entries(vivo.get().repos ?? {}).filter(([, r]: [string, any]) => r?.existe === false).map(([id]) => id).sort()]) : ''; }
  private stepsOf(sg: SavedRoom, saved: SavedRoom[]) {
    // el lado que mira al ascensor siempre tiene paso; el otro, solo si hay sala vecina
    const hay = (o: number) => saved.some(s => s.planta === sg.planta && s.lado === sg.lado && s.orden === o);
    return sg.lado === 'izq' ? { izq: hay(sg.orden + 1), der: true } : { izq: true, der: hay(sg.orden + 1) };
  }
  private numberOf(sg: SavedRoom, saved: SavedRoom[]) { const i = saved.filter(s => s.tipo === 'repo').sort(alphabeticalOrder).findIndex(s => s.id === sg.id); return i + 1; }   // en orden alfabético, como van en la planta
  // (con si su carpeta existe: un repo de ejemplo que termina de clonarse cambia su cartel; y con su carpeta y su
  // decorado: vincularla a otro repo o decorarla la vuelve a montar al momento)
  private roomSignature(sg: SavedRoom, saved: SavedRoom[]) { const p = this.stepsOf(sg, saved); return [sg.planta, sg.lado, sg.orden, p.izq, p.der, sg.variant, sg.estilo, sg.area, sg.nombre, sg.ruta, decorSignature(sg.decorado), this.numberOf(sg, saved), !!sg.ruta && vivo.get().repos[sg.id]?.existe === false].join('|'); }
  private async mountRoom(sg: SavedRoom, saved: SavedRoom[]) {
    const sala = await buildRoom(sg, this.numberOf(sg, saved), this.stepsOf(sg, saved), vivo.get().repos[sg.id]?.rama, !!sg.ruta && vivo.get().repos[sg.id]?.existe === false);
    sala.grupo.position.set(xRoom(sg.lado, sg.orden), yRoom(sg.planta), 0);
    sala.userData.firma = this.roomSignature(sg, saved);
    this.motor.scene.add(sala.grupo);
    this.salas.push(sala);
    return sala;
  }
  private redoRock() {
    if (this.roca) { this.motor.scene.remove(this.roca); this.roca.traverse((o: any) => o.geometry?.dispose()); }
    const huecos = this.salas.map(s => new THREE.Box2(new THREE.Vector2(s.grupo.position.x - s.ancho / 2 - FRAME - 0.05, s.grupo.position.y - SLAB * 0.38 - 0.18), new THREE.Vector2(s.grupo.position.x + s.ancho / 2 + FRAME + 0.05, s.grupo.position.y + HEIGHT + SLAB * 0.62 + 0.02)));
    huecos.push(new THREE.Box2(new THREE.Vector2(-ELEVATOR_WIDTH / 2 - FRAME - 0.05, yRoom(this.plantas - 1) - SLAB * 0.38 - 0.18), new THREE.Vector2(ELEVATOR_WIDTH / 2 + FRAME + 0.05, HEIGHT + SLAB * 0.62 + 0.02)));
    // la roca, de la calle hacia abajo, con las vetas y la bajante; arriba, lo que rodea la entrada
    const xs = this.salas.map(s => s.grupo.position.x);
    const xLeft = Math.min(...xs, 0) - ROOM_WIDTH / 2 - FRAME, xRight = Math.max(...xs, 0) + ROOM_WIDTH / 2 + FRAME;
    const rightOf = (p: number) => Math.max(...this.salas.filter(s => s.planta === p).map(s => s.grupo.position.x + s.ancho / 2 + FRAME), ELEVATOR_WIDTH / 2 + FRAME);
    // la roca acaba donde empieza la losa de la calle (0,6 m bajo el suelo): si subiera más, su plano y el frente de la
    // losa se pelearían por los mismos píxeles en la banda marrón de encima de la -1
    this.roca = rockFace(this.limits[0], this.limits[1], yRoom(this.plantas - 1) - 24, STREET - 0.6, BACKGROUND / 2 + 0.25, huecos);
    this.motor.scene.add(this.roca);
    this.embedStones(huecos);
    this.closeGap();
    const puerta = this.salas.find(x => x.tipo === 'puerta' && x.planta === 0);
    const inStreet = puerta ? { x0: puerta.grupo.position.x - puerta.ancho / 2 - FRAME, x1: puerta.grupo.position.x + puerta.ancho / 2 + FRAME, techo: HEIGHT + SLAB * 0.62 } : undefined;
    const firma = JSON.stringify([xLeft, xRight, this.plantas, inStreet, [0, 1].map(rightOf)]);
    if (firma !== this.environmentSignature) {
      this.environmentSignature = firma;
      buildEnvironment({ z: BACKGROUND / 2 + 0.25, xLeft, xRight, rightOf, yFloor: yRoom, plantas: this.plantas, suelo: STREET, huecos, puerta: inStreet }).then(g => {
        if (this.environmentSignature !== firma) return;
        if (this.entorno) this.motor.scene.remove(this.entorno);
        this.entorno = g; this.motor.scene.add(g);
      });
    }
  }
  private entorno: THREE.Group | null = null; private environmentSignature = '';
  private cielo: Sky | null = null;

  // el hueco del ascensor tiene pared en los lados sin sala: en la PB, la de la derecha da a la calle
  /** ¿hay sala pegada al ascensor por ese lado (-1 izquierda, 1 derecha) en esa planta? */
  hasRoomTogether(lado: number, planta: number) { return !!this.roomIn(lado * (ELEVATOR_WIDTH / 2 + FRAME * 2 + 1), planta); }
  private cierres: THREE.Group | null = null; private closuresSignature = '';
  private async closeGap() {
    const sides: [number, number][] = [];
    for (let p = 0; p < this.plantas; p++) for (const s of [-1, 1]) if (!this.hasRoomTogether(s, p)) sides.push([p, s]);
    const firma = JSON.stringify(sides); if (firma === this.closuresSignature) return; this.closuresSignature = firma;
    const g = new THREE.Group(); g.name = 'cierres-ascensor';
    const v = VARIANTS.neutro, vl = { ...v, id: v.id + '-lat' }, largo = BACKGROUND + 0.2;
    const ps: Promise<unknown>[] = [];
    for (const [p, s] of sides) {
      // cara de dentro (mira a la cabina) y cara de fuera (mira a la calle o a la roca), como el tabique de una sala;
      // el pilar del corte las enmarca por delante
      for (const [x, giro] of [[s * (ELEVATOR_WIDTH / 2 + 0.02), -s], [s * (ELEVATOR_WIDTH / 2 + FRAME - 0.02), s]])
        ps.push(place(g, R.sf('Wall_Empty'), { pos: [x, yRoom(p), -BACKGROUND / 2 + 0.25], rot: giro * Math.PI / 2, anchor: 'atras', variant: vl, sombra: false, alto: HEIGHT }).then(o => { o.scale.x = largo / MODULO; o.position.z += (largo - MODULO) / 2; o.scale.z = 0.35; }));
    }
    await Promise.all(ps);
    if (this.closuresSignature !== firma) return;
    mergeStatic(g);
    if (this.cierres) this.motor.scene.remove(this.cierres);
    this.cierres = g; this.motor.scene.add(g);
  }

  // piedras del pack de naturaleza medio enterradas en la cara de corte (estratos con bolos, no bandas lisas)
  private piedras: THREE.Group | null = null;
  private async embedStones(huecos: THREE.Box2[]) {
    if (this.piedras) { this.motor.scene.remove(this.piedras); this.piedras = null; }
    const g = new THREE.Group(); g.name = 'piedras'; this.piedras = g;
    let semilla = 4242; const r = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    const xs = this.salas.map(s => s.grupo.position.x);
    const xa = Math.min(...xs, 0) - 26, xb = Math.max(...xs, 0) + 26, ya = yRoom(this.plantas - 1) - 14, yb = STREET - 0.6;
    const ps: Promise<unknown>[] = [];
    const matsStone = new Map<string, THREE.Material>();
    // menos piedras, más grandes y de la misma tierra que la roca (no cubos negros sueltos): bloques medio enterrados
    // bloques grandes medio enterrados (la roca tiene masa) y piedra menuda entre ellos
    for (let k = 0; k < 190; k++) {
      const x = xa + r() * (xb - xa), y = ya + r() * (yb - ya), t = k < 60 ? 2.2 + r() * 2.6 : 0.6 + r() * r() * 1.8;
      if (y + t * 0.6 > yb - 0.4) continue;   // ningún bloque asoma por encima de la calle
      if (huecos.some(b => x > b.min.x - t - 0.3 && x < b.max.x + t + 0.3 && y > b.min.y - t - 0.3 && y < b.max.y + t + 0.3)) continue;
      ps.push(place(g, R.roca((r() < 0.25 ? 'Rock_Moss_' : 'Rock_') + (1 + Math.floor(r() * 7))), { pos: [x, y, BACKGROUND / 2 + 0.2], alto: t, rot: r() * 6.28, sombra: false }).then(o => {
        o.scale.z *= 0.32; o.rotation.x = (r() - 0.5) * 0.5;
        // materiales compartidos por nombre: así la fusión las junta en pocas llamadas de dibujo
        o.traverse((n: any) => { if (n.isMesh) { const k = n.material.name || 'roca'; let m: any = matsStone.get(k); if (!m) { m = n.material.clone(); m.color.multiplyScalar(0.5).lerp(new THREE.Color("#5a4030"), 0.55); m.emissive = new THREE.Color('#2a1a10'); m.emissiveIntensity = 0.35; matsStone.set(k, m); } n.material = m; } });
      }));
    }
    await Promise.all(ps);
    if (this.piedras !== g) return;
    mergeStatic(g);
    this.motor.scene.add(g);
  }

  private async addDweller(id: Identity & { salaId: string }) {
    const sala = this.salas.find(s => s.id === id.salaId); if (!sala) return null;
    const h = await new Habitante(id, sala).cargar();
    this.motor.scene.add(h.p.raiz, h.zetas.grupo);
    // aparece donde suele estar: en sus tramos de paseo (si la sala los define), nunca delante de la pieza de la sala
    const segments = sala.walkZones ?? [[-3, 3]]; const [a, b] = segments[Math.floor(Math.random() * segments.length)];
    h.p.raiz.position.set(sala.grupo.position.x + a + Math.random() * (b - a), sala.grupo.position.y, 1.2);
    this.habitantes.push(h);
    h.p.onStep = () => SFX.paso(THREE.MathUtils.clamp((h.pos.x - this.camara.goal.x) / 10, -1, 1), 0.08);
    return h;
  }
  private removeRoom(s: Sala) {
    this.motor.scene.remove(s.grupo);
    this.salas = this.salas.filter(x => x !== s);
  }

  async applyLayout() {
    const e = vivo.get().estado; if (!e) return;
    const saved = e.salas as SavedRoom[];
    const nuevas: Sala[] = [];
    // salas retiradas: fuera, con sus habitantes
    for (const s of [...this.salas]) if (!saved.some(g => g.id === s.id)) {
      for (const h of this.habitantes.filter(h => h.sala === s)) { this.motor.scene.remove(h.p.raiz, h.zetas.grupo); }
      this.habitantes = this.habitantes.filter(h => h.sala !== s);
      this.removeRoom(s);
    }
    // salas nuevas o cambiadas (trasladadas, o con un vecino nuevo que abre un paso en su tabique)
    for (const sg of saved) {
      const old = this.salas.find(s => s.id === sg.id);
      if (old && old.userData.firma === this.roomSignature(sg, saved)) continue;
      const sala = await this.mountRoom(sg, saved);
      if (old) {
        this.removeRoom(old);
        for (const h of this.habitantes.filter(h => h.sala === old)) h.mudarA(sala);
        if (this.currentRoom === old) { this.currentRoom = sala; const sp = this.supervisor.raiz.position; sp.set(sala.grupo.position.x + THREE.MathUtils.clamp(sp.x - old.grupo.position.x, -4, 4), sala.grupo.position.y, 1.3); this.frameRoom(sala); }
      } else nuevas.push(sala);
    }
    this.saved = saved;
    // plantas nuevas: el hueco del ascensor crece
    const plantas = Math.max(...saved.map(s => s.planta)) + 1;
    if (plantas !== this.plantas) {
      this.plantas = plantas;
      const viejo = this.ascensor; const asc = new Ascensor(plantas); asc.rotular(saved); await asc.construir();
      this.motor.scene.remove(viejo.grupo); this.motor.scene.add(asc.grupo); this.ascensor = asc;
      asc.llamar(this.floorOf(this.supervisor.raiz.position.y));
    }
    this.ascensor.rotular(saved);
    this.redoRock();
    // habitantes nuevos (reclutas o contratados)
    const newDweller: Habitante[] = [];
    for (const hg of e.habitantes as any[]) if (!this.habitantes.some(h => h.id.id === hg.id)) {
      const h = await this.addDweller({ id: hg.id, nombre: hg.nombre, mote: hg.mote, tipo: hg.tipo, bio: hg.bio, voz: hg.voz, tinte: hg.tinte, tone: hg.tone, aspecto: hg.aspecto, salaId: hg.salaId });
      if (h) { h.cambiar('ocioso'); h.waitingAfterChat = 14; if (nuevas.includes(h.sala)) h.p.raiz.visible = false; newDweller.push(h); }
    }
    for (const sala of nuevas) this.dig(sala, newDweller.filter(h => h.sala === sala));
    for (const h of newDweller) if (!nuevas.includes(h.sala)) this.recruitArrival(h, h.sala, 0);
    this.publish(); this.syncSessions(); this.syncHolograms(); this.applyAccessories(); this.visitantes.sincronizar();
  }

  // ---- excavación: un tapón de roca se desmorona desde el centro con polvo y chispas, y entra el recluta
  private foco: { x: number; y: number; hasta: number } | null = null;
  private reloj = 0;
  private dig(sala: Sala, reclutas: Habitante[]) {
    const x = sala.grupo.position.x, y = sala.grupo.position.y;
    const w = sala.ancho + FRAME * 2 + 0.2, alto = HEIGHT + SLAB + 0.4;
    const plug = rockFace(x - w / 2, x + w / 2, y - SLAB * 0.5, y + alto - SLAB * 0.4, BACKGROUND / 2 + 0.32, []);
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); plug.position.set(-x, -y, 0); pivot.add(plug); this.motor.scene.add(pivot);
    const dust = new Steam(new THREE.Vector3(x, y + 1.5, BACKGROUND / 2 + 0.6), 26, new THREE.Vector3(0, 0.5, 0.6));
    const sparks = new Sparks(); this.motor.scene.add(dust.grupo, sparks.grupo);
    const puerta = this.salas.find(s => s.tipo === 'puerta');
    const t0 = this.reloj + (puerta && reclutas.length ? 4.2 : 0);
    if (puerta && reclutas.length) { this.foco = { x: puerta.grupo.position.x, y: puerta.grupo.position.y, hasta: t0 }; puerta.userData.openGate?.(); SFX.roomGate(); SFX.clank(); }
    juego.set({ hint: { tecla: '', texto: `Excavando «${sala.nombre}»…` } });
    // el recluta asoma por la Puerta Principal mientras empieza la excavación
    for (const h of reclutas) if (puerta) {
      const xp = puerta.grupo.position.x + (puerta.userData.xGate ?? -3.4);
      h.p.raiz.visible = true; h.pos.set(xp, puerta.grupo.position.y, -1.6);
      h.p.goA([new THREE.Vector3(xp, puerta.grupo.position.y, 1.2), new THREE.Vector3(puerta.grupo.position.x - 0.2, puerta.grupo.position.y, 1.3)], false);
    }
    let golpe = 0; let fin = false;
    const tick = (dt: number) => {
      if (fin) return;
      const t = this.reloj - t0;
      if (t < 0) { dust.activo = false; dust.actualizar(dt); return; }
      if (!this.foco || this.foco.hasta < this.reloj + 0.1) this.foco = { x, y, hasta: t0 + 5.5 };
      const k = THREE.MathUtils.clamp(t / 4.2, 0, 1);
      pivot.scale.set(Math.max(0.001, 1 - k * k), 1, 1);
      dust.activo = k < 1; dust.origen.set(x + (Math.random() - 0.5) * w * (1 - k), y + 0.5 + Math.random() * 2.8, BACKGROUND / 2 + 0.5);
      dust.actualizar(dt); sparks.actualizar(dt);
      golpe -= dt; if (golpe <= 0 && k < 1) { golpe = 0.35 + Math.random() * 0.3; SFX.dig(); sparks.burst(new THREE.Vector3(x + (Math.random() - 0.5) * w * (1 - k), y + 0.4 + Math.random() * 2.5, BACKGROUND / 2 + 0.4), 10); this.camara.temblor = Math.max(this.camara.temblor, 0.22); }
      if (t > 6.5) {
        fin = true; this.tareas = this.tareas.filter(f => f !== tick); this.motor.scene.remove(pivot, dust.grupo, sparks.grupo); plug.traverse((o: any) => o.geometry?.dispose());
        juego.set({ hint: null });
        reclutas.forEach((h, i) => this.recruitArrival(h, sala, i * 0.8));
        if (!reclutas.length) { SFX.shortSuccess(); this.foco = null; }
      }
    };
    this.tareas.push(tick);
  }
  private tareas: ((dt: number) => void)[] = [];
  // el recluta entra en su sala por el paso del lado del ascensor y se presenta
  private recruitArrival(h: Habitante, sala: Sala, retraso: number) {
    setTimeout(() => {
      const lado = sala.lado === 'izq' ? 1 : -1; const x = sala.grupo.position.x + lado * (sala.ancho / 2 + 0.2);
      h.pos.set(x, sala.grupo.position.y, 1.3); h.p.raiz.visible = true;
      h.p.goA([new THREE.Vector3(sala.grupo.position.x + lado * 1.2, sala.grupo.position.y, 1.3)], false, () => { h.p.goalTurn = 0; h.cambiar('ocioso'); SFX.success(); });
      this.foco = { x: sala.grupo.position.x, y: sala.grupo.position.y, hasta: this.reloj + 5 };
      juego.set({ hint: { tecla: '', texto: `${h.id.nombre} «${h.id.mote}» se instala en ${sala.nombre}` } });
      setTimeout(() => juego.set({ hint: null }), 5000);
    }, retraso * 1000);
  }

  // el aspecto del Supervisor (y el de cada habitante) se elige en Chapa y Pintura: se cambia en caliente donde esté
  private signatureSupervisor = '';
  async changeSupervisor(a: Look) {
    const f = lookSignature(a);
    if (!this.supervisor || f === this.signatureSupervisor) return;
    this.signatureSupervisor = f;
    await this.supervisor.changeLook(a);
    if (this.signatureSupervisor === f) this.changeSparks(this.supervisor.raiz.position);
  }
  /** Los habitantes cuyo aspecto ha cambiado en el servidor se visten con el nuevo sin moverse de donde están */
  private dressDwellers() {
    const e = vivo.get().estado; if (!e) return;
    for (const h of this.habitantes) {
      if (!h.p.aspecto) continue;
      const g = (e.habitantes as any[]).find(x => x.id === h.id.id); if (!g) continue;
      const a = lookOf(g);
      if (lookSignature(a) === lookSignature(h.p.aspecto)) continue;
      h.id.aspecto = g.aspecto;
      h.p.changeLook(a).then(() => { if (h.sala === this.currentRoom) this.changeSparks(h.pos); });
    }
  }
  syncHolograms() { this.hologramas.sincronizar(); }

  // accesorios de la tienda puestos (Supervisor y habitantes que los han recibido de regalo)
  applyAccessories() {
    const e = vivo.get().estado; if (!e) return;
    const poner = (p: Character, ids: string[] = []) => {
      for (const clave of [...p.accesorios.keys()]) if (clave.startsWith('acc:') && !ids.includes(clave.slice(4))) p.soltar(clave);
      for (const id of ids) {
        const pend = loadingAcc.get(p) ?? new Set<string>(); loadingAcc.set(p, pend);
        if (p.accesorios.has('acc:' + id) || pend.has(id)) continue;
        const a = SHOP.find(x => x.id === id); if (!a?.ruta || !a.bone) continue;
        pend.add(id);
        p.couple('acc:' + id, { ruta: a.ruta, bone: a.bone, escala: a.escala ?? 1, pos: a.pos, rot: a.rot, rig: a.rig }).then(() => {
          // los blancos de las piezas de la tienda no queman bajo los focos (albedo ~200, más rugosos)
          p.accesorios.get('acc:' + id)?.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material) as any[]) { const hsl = { h: 0, s: 0, l: 0 }; m.color.getHSL(hsl); if (hsl.l > 0.7) m.color.setHSL(hsl.h, hsl.s, 0.62); m.roughness = Math.max(m.roughness ?? 0.5, 0.75); m.metalness = Math.min(m.metalness ?? 0, 0.2); } });
        }).finally(() => pend.delete(id));
      }
    };
    if (this.supervisor) poner(this.supervisor, e.supervisor?.accesorios);
    for (const h of this.habitantes) poner(h.p, (e.habitantes as any[]).find(x => x.id === h.id.id)?.accesorios);
  }

  private changeSparks(p: THREE.Vector3) { const s = this.currentRoom; if (s?.efectos) s.efectos.sparks.burst(p.clone().sub(s.grupo.position).add(new THREE.Vector3(0, 1, 0)), 14); SFX.conmutar(); }

  private async prepareSupervisor(sala: Sala) {
    const es = vivo.get().estado;
    const a = lookOf({ tipo: es?.supervisor?.personaje ?? 'Protagonist_B', aspecto: es?.supervisor?.aspecto });
    this.signatureSupervisor = lookSignature(a);
    const sup = new Character('supervisor', a);
    await sup.cargar();
    this.motor.scene.add(sup.raiz);
    sup.raiz.position.copy(this.freeGap(sala));
    sup.goalTurn = 0.3;
    sup.marcha = { andar: 'Walking_B', correr: 'Running_A', walkRhythm: 1.95, runRhythm: 1.28 };
    sup.onStep = () => SFX.paso(0, 0.2);
    this.supervisor = sup;
    this.currentRoom = sala;
    this.frameRoom(sala);
    this.camara.immediate();
  }

  // viaje rápido: lleva al Supervisor a una sala (desde el plano, la lista de ocupados o la URL de QA)
  goARoom(id: string, immediate = false) {
    const s = this.salas.find(x => x.id === id); if (!s || !this.supervisor) return;
    this.supervisor.parar(); this.montado = false;
    this.supervisor.raiz.position.copy(this.freeGap(s));
    this.currentRoom = s; this.viewGeneral = false; this.frameRoom(s);
    if (immediate) this.camara.immediate();
    if (this.ascensor) this.ascensor.llamar(s.planta);
    this.publish();
  }

  // sitio libre en la franja delantera de una sala: a 0,9 m o más de cualquier habitante, ayudante u obstáculo
  freeGap(s: Sala, preferred = 1.5) {
    const occupants = [...this.habitantes.map(h => h.pos), ...s.puntos.filter(pt => pt.ocupado || pt.tipo === 'aficion' || pt.tipo === 'pieza' || pt.tipo === 'puesto').map(pt => pt.pos.clone().add(s.grupo.position)), ...[...this.ayudantes.robots.values()].map(r => r.p.raiz.position), ...[...this.visitantes.figuras.values()].map(f => f.p.raiz.position), ...this.hologramas.positions()];
    const cx = s.grupo.position.x, y = s.grupo.position.y;
    for (const dx of [preferred, -preferred, 3, -3, 2.2, -2.2, 4.5, -4.5, 3.8, -3.8, 5.2, -5.2, 0.8, -0.8, 0]) for (const z of [1.35, 1.7, 0.9]) {   // el centro, lo último: ahí está la pieza de la sala
      const p = new THREE.Vector3(cx + dx, y, z);
      // nadie delante de nadie: lo que cuenta es la separación vista desde la cámara (en X), sea cual sea la profundidad
      if (occupants.some(o => Math.abs(o.y - y) < 1 && Math.abs(o.x - p.x) < 1.25)) continue;
      const p2 = new THREE.Vector2(dx, z);
      if (s.obstacles.some(b => b.clone().expandByScalar(0.35).containsPoint(p2))) continue;
      return p;
    }
    return new THREE.Vector3(cx + preferred, y, 1.35);
  }

  // ---- demo de la puerta de calidad (solo con ?ciclo)
  private stepsDemo: [number, () => void][] = [];
  private clockDemo = 0; private indexDemo = 0;
  private cycleDemo() {
    // el habitante de la primera sala de repo (ya no hay salas de serie con habitante fijo)
    const remi = this.habitantes.find(h => h.sala.tipo === 'repo'); if (!remi) return;
    this.stepsDemo = [
      [9, () => remi.cambiar('pensando', 'leyendo src/componentes/Cabecera.tsx', 'leer')],
      [8, () => remi.cambiar('trabajando', 'editando Cabecera.tsx', 'editar')],
      [8, () => remi.cambiar('trabajando', 'npm test', 'terminal')],
      [7, () => { remi.cambiar('esperando', 'permiso: git push'); SFX.highNotice(); }],
      [6, () => { remi.cambiar('terminado', 'listo: 3 archivos'); SFX.success(); juego.set(e => ({ scrap: e.scrap + 15 })); }],
      [6, () => remi.cambiar('trabajando', 'npm run build', 'terminal')],
    ];
    this.clockDemo = this.stepsDemo[0][0];
  }
  private advanceDemo(dt: number) {
    if (!this.stepsDemo.length) return;
    this.clockDemo -= dt;
    if (this.clockDemo <= 0) { const [, f] = this.stepsDemo[this.indexDemo % this.stepsDemo.length]; f(); this.publish(); this.indexDemo++; this.clockDemo = this.stepsDemo[this.indexDemo % this.stepsDemo.length][0]; }
  }

  // ---- sesiones reales → habitantes
  // con varios trabajos a la vez (pestañas del intercomunicador), el habitante enseña el más urgente
  private sessionOf(h: Habitante): SessionSummary | undefined {
    const urgency = (s: SessionSummary) => s.estado === 'esperando' ? 0 : s.estado === 'error' ? 1 : s.estado === 'terminada' && s.sinLeer ? 2 : s.estado === 'trabajando' || s.estado === 'arrancando' ? 3 : 4;
    // lo que se hace dentro de un worktree lo enseña su copia holográfica, no el habitante
    return Object.values(vivo.get().sesiones).filter(s => s.dwellerId === h.id.id && s.estado !== 'cerrada' && !this.hologramas.inWorktree(s)).sort((a, b) => urgency(a) - urgency(b) || b.actualizada - a.actualizada)[0];
  }
  private signatures = new Map<string, string>();
  syncSessions() {
    let cambio = false;
    for (const h of this.habitantes) {
      const s = this.sessionOf(h);
      const firma = s ? [s.id, s.estado, s.sinLeer, s.actividad?.modo, s.actividad?.texto].join('|') : 'sin';
      if (this.signatures.get(h.id.id) === firma) continue;
      const was = this.signatures.has(h.id.id);
      this.signatures.set(h.id.id, firma);
      h.sesionId = s?.id;
      if (!s) { if (was && h.estado !== 'durmiendo' && h.estado !== 'ocioso') h.cambiar('ocioso'); cambio = true; continue; }
      const m = s.actividad?.modo;
      if (s.estado === 'arrancando') h.cambiar('pensando', 'preparándose…', 'leer');
      else if (s.estado === 'trabajando') {
        if (!m || m === 'pensar') h.cambiar('pensando', s.actividad?.texto ?? 'pensando…', 'leer');
        else h.cambiar('trabajando', s.actividad?.texto ?? '', m === 'escribir' ? 'editar' : m === 'terminal' ? 'terminal' : m === 'web' ? 'web' : 'buscar');
      } else if (s.estado === 'esperando') { if (h.estado !== 'esperando') SFX.highNotice(); h.cambiar('esperando', s.pending?.titulo ?? 'te espera'); }
      else if (s.estado === 'terminada' && s.sinLeer) { if (h.estado !== 'terminado') SFX.success(); h.cambiar('terminado', 'listo: ' + (s.titulo ?? '')); }
      else if (s.estado === 'error') { if (h.estado !== 'error') SFX.error(); h.cambiar('error', s.error ?? 'avería'); }
      else h.cambiar('ocioso', s.titulo);
      cambio = true;
      h.sala.actividad = Math.min(1, 0.25 + (s.herramientas % 40) / 40 * 0.75);
    }
    if (cambio) this.publish();
  }

  // ---- cámara
  // La rueda amplía hacia lo que hay bajo el ratón (el punto se queda donde está) y la cámara se queda ahí: deja de seguir
  // al Supervisor hasta que él vuelva a moverse (o se cambie de sala o de vista)
  private freeCamera = false;
  // la cámara sigue al Supervisor cuando lo mueve quien juega (teclas); si anda solo (la ruta de un clic) se queda donde
  // está y se puede arrastrar mientras camina, hasta que se le vuelva a mover a mano o se reencuadre la sala
  private followsCamera = true;
  private lastPosSup = new THREE.Vector3();
  private zoomToward(e: WheelEvent) {
    const r = this.motor.renderer.domElement.getBoundingClientRect();
    this.rayo.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.motor.camera);
    const p = this.rayo.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    // en una charla la rueda acerca o aleja su encuadre (que se recalcula en cada fotograma) hacia lo que hay bajo el
    // ratón: lo que se corre va al desplazamiento, como lo arrastrado, y se queda hasta que el Supervisor ande
    if (this.focused || this.copyFocused) {
      const antes = this.zoomChat;
      this.zoomChat = THREE.MathUtils.clamp(antes * Math.exp(e.deltaY * 0.0012), 0.45, 4);
      if (!p) return;
      const k = 1 - this.zoomChat / antes, c = this.camara.goal.clone().add(this.camara.desplazamiento);
      this.camara.desplazamiento.x += (p.x - c.x) * k;
      this.camara.desplazamiento.y += (p.y - c.y) * k;
      return;
    }
    const antes = this.camara.distancia;
    this.camara.zoom(e.deltaY);
    this.viewGeneral = this.camara.distancia > this.distRoom * 2.2;
    if (this.montado || this.activityMode || this.foco || !p) return;
    // el centro de lo que se ve es el objetivo más lo arrastrado; lo que se corre va al desplazamiento, como en la charla
    // (sin libre, el seguimiento movería el objetivo y la ampliación se iría del ratón)
    const k = 1 - this.camara.distancia / antes, c = this.camara.goal.clone().add(this.camara.desplazamiento);
    this.camara.desplazamiento.x += (p.x - c.x) * k;
    this.camara.desplazamiento.y += (p.y - c.y) * k;
    this.freeCamera = true;
  }
  frameRoom(sala: Sala) {
    this.freeCamera = false; this.followsCamera = true;
    this.camara.encuadrar(new THREE.Vector3(sala.grupo.position.x, sala.grupo.position.y + 2.0, 0), sala.ancho + FRAME * 2 + 1.7, HEIGHT + SLAB * 2 + 0.4);
    this.distRoom = this.camara.distancia;
  }
  /** Foto del corte del refugio, de frente, para el plano: la imagen y dónde cae cada sala (en 0..1). */
  mapSnapshot() {
    type Rect = [number, number, number, number];
    const saved = this.saved ?? []; if (!saved.length) return null;
    const plantas = this.plantas;
    const rect = (x: number, y: number): Rect => [x - ROOM_WIDTH / 2 - FRAME, y - SLAB * 0.4, x + ROOM_WIDTH / 2 + FRAME, y + HEIGHT + SLAB * 0.6];
    const huecos = saved.map(g => ({ id: g.id, planta: g.planta, lado: g.lado, orden: g.orden, m: rect(xRoom(g.lado, g.orden), yRoom(g.planta)) }));
    const x0 = Math.min(...huecos.map(h => h.m[0]), -ELEVATOR_WIDTH) - 1.5, x1 = Math.max(...huecos.map(h => h.m[2]), ELEVATOR_WIDTH) + 1.5;
    const y0 = Math.min(...huecos.map(h => h.m[1])) - 1, y1 = HEIGHT + SLAB + 2.6;
    const cam = this.motor.camera, fabric = this.motor.renderer.domElement;
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vFov = THREE.MathUtils.degToRad(cam.fov);
    const d = Math.max((y1 - y0) / 2 / Math.tan(vFov / 2), (x1 - x0) / 2 / Math.tan(vFov / 2) / cam.aspect) * 1.02;
    const visTags = this.etiquetas.raiz.style.visibility; this.etiquetas.raiz.style.visibility = 'hidden';
    try {
      // de frente y sin inclinación: un corte, no una vista
      cam.position.set(cx, cy, d + BACKGROUND / 2); cam.lookAt(cx, cy, BACKGROUND / 2); cam.updateMatrixWorld();
      const proy = (x: number, y: number) => { const v = new THREE.Vector3(x, y, BACKGROUND / 2).project(cam); return [(v.x + 1) / 2 * fabric.width, (1 - v.y) / 2 * fabric.height]; };
      const [ax, ay] = proy(x0, y1), [bx, by] = proy(x1, y0);
      const norm = (m: Rect): Rect => { const [p0x, p0y] = proy(m[0], m[3]), [p1x, p1y] = proy(m[2], m[1]); return [(p0x - ax) / (bx - ax), (p0y - ay) / (by - ay), (p1x - ax) / (bx - ax), (p1y - ay) / (by - ay)]; };
      this.motor.composer.render(0);
      const w = Math.min(1400, Math.round(bx - ax)), h = Math.round(w * (by - ay) / (bx - ax));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(fabric, ax, ay, bx - ax, by - ay, 0, 0, w, h);
      return {
        url: c.toDataURL('image/jpeg', 0.86), aspecto: w / h,
        huecos: huecos.map(hh => ({ id: hh.id, planta: hh.planta, lado: hh.lado, orden: hh.orden, r: norm(hh.m) })),
        ascensor: norm([-ELEVATOR_WIDTH / 2 - FRAME, yRoom(plantas - 1) - SLAB * 0.4, ELEVATOR_WIDTH / 2 + FRAME, HEIGHT + SLAB * 0.6]),
        calle: norm([ELEVATOR_WIDTH / 2 + FRAME + 4, STREET, ELEVATOR_WIDTH / 2 + FRAME + 4, STREET]).slice(0, 2),   // rótulo «Calle», a la derecha del ascensor
      };
    } finally {
      cam.position.copy(pos); cam.quaternion.copy(quat); cam.updateMatrixWorld();
      this.etiquetas.raiz.style.visibility = visTags;
    }
  }

  toggleView(general: boolean) {
    this.viewGeneral = general; SFX.conmutar();
    if (general) {
      // todo el refugio con la planta baja, su rótulo y una franja de cielo arriba, por debajo de la regleta
      const xs = this.salas.map(s => s.grupo.position.x);
      const ancho = Math.max(...xs) - Math.min(...xs) + ROOM_WIDTH + 6;
      const arriba = HEIGHT + SLAB + 4.2, abajo = yRoom(this.plantas - 1) - SLAB - 0.8;
      const alto = (arriba - abajo) * 1.04;
      this.camara.encuadrar(new THREE.Vector3((Math.max(...xs) + Math.min(...xs)) / 2, (arriba + abajo) / 2 + alto * 0.03, 0), ancho, alto);
    } else if (this.currentRoom) this.frameRoom(this.currentRoom);
  }

  // viaje rápido hasta una copia holográfica (y, con `hablar`, su intercomunicador); si aún se está materializando, se espera
  private goACopy(id: string, talk: boolean, attempts = 0) {
    const f = this.hologramas.ofId(id);
    if (!f) return;
    if (!f.listo) { if (attempts < 40) setTimeout(() => this.goACopy(id, talk, attempts + 1), 150); return; }
    if (!this.focused && !this.copyFocused) this.goARoom(f.sala.id);
    const fp = f.p.raiz.position, sp = this.supervisor.raiz.position;
    if (Math.abs(sp.y - fp.y) > 1 || Math.hypot(sp.x - fp.x, sp.z - fp.z) > 2.2) {
      sp.set(fp.x + (fp.x > f.sala.grupo.position.x ? -1.3 : 1.3), f.sala.grupo.position.y, Math.min(1.6, fp.z + 0.4));
      this.camara.immediate();
    }
    if (talk) this.interactCopy(f);
  }

  // quien hablaba vuelve a lo suyo (al cambiar de interlocutor sin cerrar el intercomunicador, o al cerrarlo)
  // una charla nueva se encuadra de cero: lo alejado con la rueda en la anterior (hasta ver todo el refugio) y lo corrido
  // hacia el ratón no se arrastran a la siguiente (con alguien de otra planta, el encuadre salía lejos y descolocado); se
  // conserva solo un acercamiento moderado
  private freshChatFrame() {
    this.zoomChat = THREE.MathUtils.clamp(this.zoomChat, 0.45, 1);
    this.camara.desplazamiento.set(0, 0, 0);
  }

  private dropChat() {
    if (this.copyFocused) { this.hologramas.finishChat(this.copyFocused); this.copyFocused = null; }
    if (this.focused) { this.focused.waitingAfterChat = 3; this.focused.chatting = false; this.focused = null; }
  }

  dialogEnd() {
    const h = this.focused; this.focused = null;
    if (this.copyFocused) { this.hologramas.finishChat(this.copyFocused); this.copyFocused = null; }
    this.retrato?.destruir(); this.retrato = null;
    this.etiquetas.raiz.style.display = '';
    Habitante.quieto = false;
    if (this.currentRoom) this.frameRoom(this.currentRoom);
    if (h) { h.waitingAfterChat = 3; h.chatting = false; }
  }

  // con `andando` (un clic) la charla se abre ya y el Supervisor va hasta su sitio caminando mientras tanto
  interact(h: Habitante, andando = false) {
    SFX.abrir();
    if (this.focused !== h) { this.dropChat(); this.freshChatFrame(); }
    // a quien duerme se le despierta: se levanta de la litera para hablar (de tumbado no hay retrato ni encuadre)
    if (h.estado === 'durmiendo') { h.cambiar('ocioso'); h.p.inRest = 'Idle_A'; h.p.reproducir('Idle_A', 0.2); }
    this.focused = h; h.chatting = true;
    this.retrato?.destruir(); this.retrato = new Portrait(h.p);
    (window as any).__portrait = this.retrato.canvas;
    this.etiquetas.raiz.style.display = 'none';
    Habitante.quieto = true;
    juego.set({ talkingWith: h.id.id, hint: null });
    h.p.parar();
    const sp = this.supervisor.raiz.position;
    const sideH = h.pos.x - 1.3 > h.sala.grupo.position.x - h.sala.ancho / 2 + 0.6 ? -1 : 1;
    if (andando) this.goAChat(new THREE.Vector3(h.pos.x + sideH * 1.3, h.pos.y, Math.min(1.7, Math.max(h.pos.z + 0.35, 1.2))), h.pos);
    else if (Math.abs(sp.y - h.pos.y) < 1) { this.supervisor.parar(); sp.x = h.pos.x + sideH * 1.3; sp.z = Math.min(1.7, Math.max(h.pos.z + 0.35, 1.2)); }
    // el interlocutor, en tres cuartos hacia cámara (mirando un poco al Supervisor), y los demás se van al otro lado
    if (!h.sentado) h.p.goalTurn = Math.sign(this.supervisor.raiz.position.x - h.pos.x || 1) * 0.55;   // sentado a su mesa no gira la silla: te mira girando la cabeza
    for (const o of this.habitantes) {
      if (o === h || o.sala !== h.sala || o.fijo || Math.abs(o.pos.x - h.pos.x) > 2.6) continue;
      const lado = o.pos.x >= h.pos.x ? 1 : -1; const sx = h.sala.grupo.position.x, med = h.sala.ancho / 2 - 0.8;
      const dest = new THREE.Vector3(THREE.MathUtils.clamp(h.pos.x + lado * 3.2, sx - med, sx + med), o.pos.y, Math.min(o.pos.z, 0.2));
      o.p.goA(dest, false); o.waitingAfterChat = 8;
    }
    this.supervisor.goalTurn = Math.atan2(h.pos.x - this.supervisor.raiz.position.x, h.pos.z - this.supervisor.raiz.position.z);
    this.frameChat(h.p.raiz.position, h.sala, true);
  }

  /** Mientras dura una charla, la cámara sigue al interlocutor y lo deja en el centro de lo que el intercomunicador no
   *  tapa (la ventana va a la derecha, pero se mide de verdad: puede cambiar de tamaño). De suelo a techo de su sala; si
   *  hace falta enseñar algo de fuera de la sala para tenerlo a la vista, se enseña: lo importante es verle hacer. */
  private chatFree = { f: 0.5, medida: -1 };
  /** Zoom de la rueda sobre el encuadre de la charla (1: de suelo a techo); se queda de una charla a otra */
  private zoomChat = 1;
  private frameChat(pos: THREE.Vector3, sala: Sala, inicio = false) {
    const cam = this.motor.camera, fabric = this.motor.renderer.domElement.getBoundingClientRect();
    // lo que deja libre la ventana (medido cada cuarto de segundo: leer el DOM en cada fotograma fuerza el diseño)
    if (inicio || this.reloj - this.chatFree.medida > 0.25) {
      this.chatFree.medida = this.reloj;
      const v = document.querySelector('.consola')?.getBoundingClientRect();
      const izq = v && v.width > 0 && v.width < fabric.width * 0.95 ? (v.left - fabric.left) / fabric.width : 1;
      // sin ventana aún (se monta un instante después) se supone la de siempre: la mitad derecha
      this.chatFree.f = THREE.MathUtils.clamp(v ? izq : 0.5, 0.3, 1);
    }
    const f = this.chatFree.f;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    this.camara.encuadrar(new THREE.Vector3(this.camara.goal.x, sala.grupo.position.y + 1.9, 0), 9.6, 4.4);
    this.camara.distancia = THREE.MathUtils.clamp(this.camara.distancia * this.zoomChat, this.camara.minDist * 0.45, this.camara.maxDist);
    // media anchura vista a la profundidad del interlocutor
    const prof = this.camara.distancia * Math.cos(this.camara.elevation) - pos.z;
    const hw = prof * Math.tan(vFov / 2) * cam.aspect;
    // el centro del par (interlocutor y Supervisor, más peso al interlocutor) en el centro del hueco libre
    const sp = this.supervisor.raiz.position;
    const foco = Math.abs(sp.y - pos.y) < 1 ? pos.x * 0.7 + sp.x * 0.3 : pos.x;
    let mx = foco + hw - f * hw;
    // a ser posible, sin salirse de la sala por la izquierda ni por lo que se ve a la derecha del hueco libre
    const L = sala.grupo.position.x - sala.ancho / 2 - FRAME, Rr = sala.grupo.position.x + sala.ancho / 2 + FRAME;
    const minRoom = L + hw, maxRoom = Rr + hw - 2 * hw * f;
    if (minRoom <= maxRoom) mx = THREE.MathUtils.clamp(mx, minRoom, maxRoom);
    // pero el interlocutor siempre dentro del hueco libre, con margen
    mx = THREE.MathUtils.clamp(mx, pos.x + hw - 1.3 * hw * f, pos.x + hw - 0.7 * hw * f);   // entre el 35 % y el 65 % del hueco
    this.camara.goal.x = mx;
  }

  // el Supervisor camina hasta su sitio en la charla ya abierta y, al llegar, se vuelve hacia su interlocutor
  private goAChat(destino: THREE.Vector3, mirar: THREE.Vector3) {
    this.goAPoint(destino, () => { const sp = this.supervisor.raiz.position; this.supervisor.goalTurn = Math.atan2(mirar.x - sp.x, mirar.z - sp.z); });
  }

  // hablar con una copia holográfica: su propio intercomunicador, con su retrato en holograma
  interactCopy(f: Copia, andando = false) {
    SFX.abrir();
    if (this.copyFocused !== f) { this.dropChat(); this.freshChatFrame(); }
    this.copyFocused = f;
    this.retrato?.destruir(); this.retrato = new Portrait(f.p, 220, 260, true);
    (window as any).__portrait = this.retrato.canvas;
    this.etiquetas.raiz.style.display = 'none';
    Habitante.quieto = true;
    const fp = f.p.raiz.position, sala = f.sala;
    const sp = this.supervisor.raiz.position;
    const sideC = fp.x - 1.3 > sala.grupo.position.x - sala.ancho / 2 + 0.6 ? -1 : 1;
    if (andando) this.goAChat(new THREE.Vector3(fp.x + sideC * 1.3, sala.grupo.position.y, Math.min(1.7, Math.max(fp.z + 0.35, 1.2))), fp);
    else if (Math.abs(sp.y - fp.y) < 1) { this.supervisor.parar(); sp.x = fp.x + sideC * 1.3; sp.z = Math.min(1.7, Math.max(fp.z + 0.35, 1.2)); }
    this.hologramas.startChat(f, sp);
    // los habitantes que estorban en el encuadre se apartan
    for (const o of this.habitantes) {
      if (o.sala !== sala || o.fijo || Math.abs(o.pos.x - fp.x) > 2.6) continue;
      const lado = o.pos.x >= fp.x ? 1 : -1; const sx = sala.grupo.position.x, med = sala.ancho / 2 - 0.8;
      o.p.goA(new THREE.Vector3(THREE.MathUtils.clamp(fp.x + lado * 3.2, sx - med, sx + med), o.pos.y, Math.min(o.pos.z, 0.2)), false); o.waitingAfterChat = 8;
    }
    this.supervisor.goalTurn = Math.atan2(fp.x - sp.x, fp.z - sp.z);
    juego.set({ talkingWith: idCopy(f.ruta), hint: null });
    this.frameChat(fp, sala, true);
  }

  useDevice(sala: Sala, it: Interactive, vista?: string) {
    SFX.abrir(); this.supervisor.parar();
    this.supervisor.goalTurn = Math.PI;
    juego.set({ panel: it.panel as any, panelData: { salaId: sala.id, aparato: it.id, vista: vista ?? it.vista } });
  }

  // nadie se mete dentro de nadie: los que están de pie se apartan (más alrededor de quien habla con el Supervisor)
  private separate(dt: number) {
    const sp = this.supervisor.raiz.position;
    const hs = this.habitantes.filter(h => h.p.raiz.visible);
    // las copias holográficas son intangibles: no empujan a nadie, salvo la que habla con el Supervisor (se le deja sitio
    // a la escena, y si no, se habla con quien no se quiere)
    const copias = [...this.hologramas.figuras.values()].filter(f => f === this.copyFocused && f.listo && !f.leaving).map(f => ({ p: f.p.raiz.position, r: 1.7, fijo: true }));
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      const otros: { p: THREE.Vector3; r: number; fijo: boolean }[] = [...hs.slice(i + 1).map(b => ({ p: b.pos, r: b === this.focused || a === this.focused ? 1.7 : 1.15, fijo: b.fijo || b === this.focused })), ...copias];
      // el Supervisor solo aparta a los demás cuando está quieto en una charla o con un aparato abierto (dejan sitio a la
      // escena); andando no empuja ni choca con nadie: pasa por delante
      if (this.focused || this.copyFocused || juego.get().panel) otros.push({ p: sp, r: a === this.focused ? 1.1 : 1.2, fijo: true });
      for (const o of otros) {
        if (Math.abs(o.p.y - a.pos.y) > 0.8) continue;
        // lo que cuenta es la separación vista desde la cámara (eje X), salvo que uno esté bastante más al fondo
        const dx = a.pos.x - o.p.x, dz = a.pos.z - o.p.z;
        if (Math.abs(dz) > 1.2 || Math.abs(dx) >= o.r) continue;
        const d = Math.abs(dx) || 1e-3;
        const thrust = Math.min(o.r - d, dt * 2.2); const ux = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx), uz = 0;
        const aFixed = a.fijo || a === this.focused;
        if (!aFixed) { a.pos.x += ux * thrust * (o.fijo ? 1 : 0.5); a.pos.z = THREE.MathUtils.clamp(a.pos.z + uz * thrust * (o.fijo ? 1 : 0.5), -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.45); }
        if (!o.fijo && o.p !== sp) { o.p.x -= ux * thrust * (aFixed ? 1 : 0.5); o.p.z = THREE.MathUtils.clamp(o.p.z - uz * thrust * (aFixed ? 1 : 0.5), -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.45); }
      }
    }
  }

  // quien coincide en pantalla con el Supervisor da un paso atrás (medio metro: con esta cámara no se lee como más
  // profundidad, pero el Supervisor queda siempre por delante, como en un juego 2D)
  private leavePass(dt: number) {
    if (this.focused || this.copyFocused || this.montado) return;
    const sp = this.supervisor.raiz.position;
    for (const h of this.habitantes) {
      if (h.fijo || !h.p.raiz.visible || Math.abs(h.pos.y - sp.y) > 0.8) continue;
      const dx = Math.abs(h.pos.x - sp.x);
      if (dx > 0.95) continue;
      const atras = Math.max(-BACKGROUND / 2 + 0.6, sp.z - 0.5);
      if (h.pos.z > atras) h.pos.z = THREE.MathUtils.damp(h.pos.z, atras, 9, dt);
    }
  }

  // ---- clic para ir (y hablar o usar); al pasar el ratón por encima, el mismo letrero que de cerca
  private rayo = new THREE.Raycaster();
  private raton: THREE.Vector2 | null = null;
  private cameraDragging = () => false;
  apuntado: { tipo: 'habitante'; h: Habitante } | { tipo: 'copia'; f: Copia } | { tipo: 'aparato'; sala: Sala; it: Interactive; vista?: string } | { tipo: 'ascensor'; planta: number } | null = null;
  private ndc(e: PointerEvent) {
    const r = this.motor.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  // lo que hay bajo el puntero: un habitante, una copia o un aparato (su columna, del suelo a la pared del fondo);
  // si no, el punto del suelo (para ir andando)
  private apuntar(ndc: THREE.Vector2): { tipo: 'habitante'; h: Habitante } | { tipo: 'copia'; f: Copia } | { tipo: 'aparato'; sala: Sala; it: Interactive; vista?: string } | { tipo: 'ascensor'; planta: number } | { tipo: 'suelo'; p: THREE.Vector3; sala?: Sala; planta: number } | null {
    this.rayo.setFromCamera(ndc, this.motor.camera);
    const tocar = (caja: THREE.Box3) => { const p = this.rayo.ray.intersectBox(caja, new THREE.Vector3()); return p ? p.distanceTo(this.rayo.ray.origin) : Infinity; };
    const cuerpo = (c: THREE.Vector3) => new THREE.Box3(new THREE.Vector3(c.x - 0.45, c.y, c.z - 0.45), new THREE.Vector3(c.x + 0.45, c.y + 1.9, c.z + 0.45));
    // ¿un habitante? (caja aproximada del cuerpo)
    let mejor: Habitante | null = null, tmin = Infinity;
    for (const h of this.habitantes) { if (!h.p.raiz.visible) continue; const t = tocar(cuerpo(h.p.raiz.position)); if (t < tmin) { tmin = t; mejor = h; } }
    // ¿una copia holográfica? (la caja sigue a la figura, ande por donde ande)
    let copia: Copia | null = null;
    for (const f of this.hologramas.figuras.values()) {
      if (!f.listo || f.leaving) continue;
      const t = tocar(cuerpo(f.p.raiz.position)); if (t < tmin) { tmin = t; copia = f; mejor = null; }
    }
    // ¿un aparato? Lo que se ve de él (el tablero, la pantalla, el sillón); si la sala no lo ha medido, lo que tiene
    // detrás hasta la pared
    let aparato: { sala: Sala; it: Interactive; vista?: string } | null = null, tap = Infinity, medido = false;
    for (const sala of this.salas) for (const i of sala.interactive ?? []) {
      const x = sala.grupo.position.x + i.x, y = sala.grupo.position.y;
      const cajas = i.zones?.length ? i.zones.map(b => b.clone().translate(sala.grupo.position)) : [new THREE.Box3(new THREE.Vector3(x - 0.7, y, -BACKGROUND / 2), new THREE.Vector3(x + 0.7, y + 2.4, i.z + 0.5))];
      for (const c of cajas) { const t = tocar(c); if (t < tap) { tap = t; aparato = { sala, it: i }; medido = !!i.zones?.length; } }
    }
    // una pieza que es parte de un aparato (`userData.interactivo`: la pantalla del tablero en la pared), con su vista
    const piezas: THREE.Object3D[] = [];
    for (const s of this.salas) if (s.interactive?.length) s.grupo.traverse(o => { if (o.userData.interactivo) piezas.push(o); });
    const touched = this.rayo.intersectObjects(piezas, false)[0];
    if (touched && touched.distance <= tap + 0.05) {
      const sala = this.salas.find(s => s.grupo.getObjectById(touched.object.id));
      const it = sala?.interactive?.find(i => i.id === touched.object.userData.interactivo);
      if (sala && it) { tap = Math.min(tap, touched.distance); aparato = { sala, it, vista: touched.object.userData.vista }; medido = true; }
    }
    // ¿las puertas del ascensor?
    let ascensor: number | null = null;
    if (this.ascensor) for (let planta = 0; planta < this.plantas; planta++) {
      const y = yRoom(planta);
      const t = tocar(new THREE.Box3(new THREE.Vector3(-ELEVATOR_WIDTH / 2 + 0.2, y, -BACKGROUND / 2), new THREE.Vector3(ELEVATOR_WIDTH / 2 - 0.2, y + 3, 0.6)));
      if (t < tap) { tap = t; ascensor = planta; aparato = null; medido = true; }
    }
    // gana lo que está delante: quien se pone ante el tablón tapa el tablón; el DJ, tras su cabina, no la tapa (la
    // columna de un aparato sin medir es solo aproximada: ahí quien esté dentro gana siempre)
    if (tmin <= tap || !medido) { if (copia) return { tipo: 'copia', f: copia }; if (mejor) return { tipo: 'habitante', h: mejor }; }
    if (aparato) return { tipo: 'aparato', ...aparato };
    if (ascensor !== null) return { tipo: 'ascensor', planta: ascensor };
    // ¿el suelo de alguna sala o del rellano? (junto al punto de un aparato, ese aparato; en el rellano, el ascensor)
    for (let planta = 0; planta < this.plantas; planta++) {
      const y = yRoom(planta); const p = this.rayo.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
      if (!p || p.z < -BACKGROUND / 2 || p.z > BACKGROUND / 2 + 0.3) continue;
      const sala = this.salas.find(s => s.planta === planta && Math.abs(p.x - s.grupo.position.x) <= s.ancho / 2);
      if (!sala && Math.abs(p.x) > ELEVATOR_WIDTH / 2) continue;
      const it = sala?.interactive?.find(i => Math.hypot(sala.grupo.position.x + i.x - p.x, i.z - p.z) < 1.0);
      if (it && sala) return { tipo: 'aparato', sala, it };
      if (!sala && this.ascensor) return { tipo: 'ascensor', planta };
      return { tipo: 'suelo', p, sala, planta };
    }
    return null;
  }
  // Con una charla abierta, un clic en otro habitante (o copia) deja esa charla minimizada en la barra y va a por el
  // nuevo: así se van abriendo charlas una tras otra. Un aparato (un tablero, una pantalla) también: la charla se queda
  // en la barra y se abre su panel. El clic en lo demás (el suelo, el ascensor) no corta la charla
  private clic(e: PointerEvent) {
    const j = juego.get(); if (j.panel || !this.supervisor) return;
    const a = this.apuntar(this.ndc(e)); if (!a) return;
    if (j.talkingWith) {
      if ((a.tipo !== 'habitante' && a.tipo !== 'copia' && a.tipo !== 'aparato') || (a.tipo === 'habitante' && a.h === this.focused) || (a.tipo === 'copia' && a.f === this.copyFocused)) return;
      SFX.cerrar(); juego.set({ talkingWith: null, workIn: null }); this.dialogEnd();   // como minimizarIntercom (ui/Dialogo.tsx)
    }
    // la charla se abre con el clic; el Supervisor llega andando por detrás
    if (a.tipo === 'copia') { SFX.clic(); this.interactCopy(a.f, true); return; }
    if (a.tipo === 'habitante') { SFX.clic(); this.interact(a.h, true); return; }
    if (a.tipo === 'aparato') {
      // al punto del aparato (desde ahí se usa), no a donde cayó el rayo
      const { sala, it } = a; const destino = new THREE.Vector3(sala.grupo.position.x + it.x, sala.grupo.position.y, THREE.MathUtils.clamp(it.z, -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.5));
      destino.x = THREE.MathUtils.clamp(destino.x, sala.grupo.position.x - sala.ancho / 2 + 0.6, sala.grupo.position.x + sala.ancho / 2 - 0.6);
      // como con las charlas: el aparato se abre con el clic y el Supervisor llega andando por detrás (y se pone de cara)
      SFX.clic(); this.useDevice(sala, it, a.vista);
      this.goAPoint(destino, () => { if (juego.get().panelData?.aparato === it.id) this.supervisor.goalTurn = Math.PI; }); return;
    }
    if (a.tipo === 'ascensor') { this.goAPoint(new THREE.Vector3(0, yRoom(a.planta), 0.35)); SFX.clic(); return; }
    const { p, sala, planta } = a;
    const destino = new THREE.Vector3(p.x, yRoom(planta), THREE.MathUtils.clamp(p.z, -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.5));
    if (sala) destino.x = THREE.MathUtils.clamp(destino.x, sala.grupo.position.x - sala.ancho / 2 + 0.6, sala.grupo.position.x + sala.ancho / 2 - 0.6);
    this.goAPoint(destino); SFX.clic();
  }
  // donde va el letrero de un aparato apuntado: encima de lo que se ve de él (bajo el techo), o de su punto
  private deviceOver(sala: Sala, it: Interactive) {
    const g = sala.grupo.position;
    if (!it.zones?.length) return new THREE.Vector3(g.x + it.x, g.y + 2.4, it.z);
    const u = it.zones.reduce((u, b) => u.union(b), new THREE.Box3());
    return new THREE.Vector3(g.x + (u.min.x + u.max.x) / 2, g.y + Math.min(u.max.y, HEIGHT - 0.6), u.max.z);
  }
  // lo apuntado con el ratón (cada fotograma: los habitantes se mueven bajo un puntero quieto)
  private updateAimed() {
    const j = juego.get();
    if (this.cameraDragging()) return;
    const a = this.raton && !j.panel && this.supervisor && !this.montado ? this.apuntar(this.raton) : null;
    // con una charla abierta solo cuentan otro interlocutor (el clic cambia de charla) y los aparatos; lo demás no hace nada
    const otro = a && (a.tipo === 'aparato' || (a.tipo === 'habitante' && a.h !== this.focused) || (a.tipo === 'copia' && a.f !== this.copyFocused));
    const nuevo = a && a.tipo !== 'suelo' && (!j.talkingWith || otro) ? a : null;
    const igual = (x: typeof this.apuntado, y: typeof this.apuntado) => x === y || (!!x && !!y && x.tipo === y.tipo && (x.tipo === 'habitante' ? x.h === (y as any).h : x.tipo === 'copia' ? x.f === (y as any).f : x.tipo === 'ascensor' ? x.planta === (y as any).planta : x.it === (y as any).it));
    if (!igual(nuevo, this.apuntado)) { this.apuntado = nuevo; if (nuevo) SFX.hover(); this.motor.renderer.domElement.style.cursor = nuevo ? 'pointer' : ''; }
  }

  // camino por el pasillo delantero; si es otra planta, por el ascensor
  goAPoint(destino: THREE.Vector3, onArrive?: () => void) {
    const sp = this.supervisor.raiz.position; const correr = true;   // el Supervisor siempre va corriendo
    const yo = this.floorOf(sp.y), there = this.floorOf(destino.y);
    const pasillo = 1.25;
    if (yo === there) {
      const misma = this.roomIn(sp.x, yo) === this.roomIn(destino.x, yo) && Math.abs(sp.x) > ELEVATOR_WIDTH / 2;
      const ruta = misma ? [destino] : [new THREE.Vector3(sp.x, sp.y, pasillo), new THREE.Vector3(destino.x, sp.y, pasillo), destino];
      this.supervisor.goA(ruta, correr, onArrive ?? null); return;
    }
    // al rellano, subir a la cabina cuando esté aquí, viajar y seguir andando
    this.supervisor.goA([new THREE.Vector3(sp.x, sp.y, pasillo), new THREE.Vector3(0, sp.y, pasillo), new THREE.Vector3(0, sp.y, 0.35)], correr, () => {
      juego.set({ hint: { tecla: '', texto: 'Llamando al ascensor…' } });
      this.ascensor.llamar(yo, () => {
        this.montado = true; this.supervisor.goalTurn = 0; juego.set({ hint: null });
        this.ascensor.llamar(there, () => {
          this.montado = false; sp.z = 0.9;
          this.supervisor.goA([new THREE.Vector3(0, sp.y, pasillo), new THREE.Vector3(destino.x, sp.y, pasillo), destino], correr, onArrive ?? null);
        });
      });
    });
  }

  publish() {
    // las copias holográficas (worktrees) van por su cuenta, como interlocutores propios; la sala cuenta con ellas
    const copias = this.hologramas.summaries();
    const ef = new Map(this.habitantes.map(h => [h, { estado: h.estado, detalle: h.detalle, sesionId: h.sesionId }]));
    for (const s of this.salas) {
      const hs = [...this.habitantes.filter(h => h.sala === s).map(h => ({ id: h.id, ...ef.get(h)! })), ...copias.filter(c => c.sala === s.id).map(c => ({ id: { nombre: c.nombre }, estado: c.estado, detalle: c.detalle ?? '', sesionId: c.sesionId }))];
      const e = hs.some(h => h.estado === 'error') ? 'error' : hs.some(h => h.estado === 'esperando') ? 'esperando' : hs.some(h => h.estado === 'trabajando' || h.estado === 'pensando') ? 'trabajando' : hs.some(h => h.estado === 'terminado') ? 'terminada' : hs.length ? 'ociosa' : 'sin-sesion';
      const quien = hs.find(h => h.estado !== 'ocioso' && h.estado !== 'durmiendo');
      if (e !== s.estado) s.ponerEstado(e as any, quien ? `${quien.id.nombre}: ${quien.detalle}` : undefined);
      s.setIcon(hs.some(h => h.estado === 'error') ? 'error' : hs.some(h => h.estado === 'esperando') ? 'espera' : hs.some(h => h.estado === 'terminado') ? 'listo' : null);
    }
    const roomsServ: any[] = vivo.get().estado?.salas ?? [];
    juego.set({ habitantes: this.habitantes.map(h => ({ id: h.id.id, nombre: h.id.nombre, mote: h.id.mote, tipo: h.id.tipo, bio: h.id.bio, sala: h.sala.id, nameRoom: h.sala.nombre, ruta: roomsServ.find(x => x.id === h.sala.id)?.ruta ?? h.sala.ruta, carpeta: roomsServ.find(x => x.id === h.sala.id)?.carpeta ?? roomsServ.find(x => x.id === h.sala.id)?.ruta ?? h.sala.ruta, estado: ef.get(h)!.estado, detalle: ef.get(h)!.detalle, sesionId: ef.get(h)!.sesionId, robot: h.p.aspecto?.especie === 'robot' })), copias, currentRoom: this.currentRoom?.id ?? '' });
  }

  // ---- circulación del Supervisor por la planta (salas contiguas, pasos delanteros y rellano del ascensor)
  private roomIn(x: number, planta: number) { return this.salas.find(s => s.planta === planta && Math.abs(x - s.grupo.position.x) <= s.ancho / 2 + FRAME * 2 + 0.01); }
  floorOf(y: number) { return Math.round(-y / FLOOR); }
  private zoneIn(x: number, planta: number): { zmin: number; zmax: number; sala?: Sala } | null {
    if (Math.abs(x) <= ELEVATOR_WIDTH / 2 - 0.35) return { zmin: -0.8, zmax: 1.65 };
    const s = this.roomIn(x, planta);
    if (s) {
      const lx = x - s.grupo.position.x;
      if (Math.abs(lx) <= s.ancho / 2 - 0.5) return { zmin: -BACKGROUND / 2 + 0.5, zmax: BACKGROUND / 2 - 0.45, sala: s };
      // franja junto al tabique: solo se cruza por el hueco delantero, y solo si al otro lado hay sala o ascensor
      const otro = x + Math.sign(lx) * 1.6;
      const onOtherSide = Math.abs(otro) <= ELEVATOR_WIDTH / 2 || this.roomIn(otro, planta);
      if (onOtherSide) return { zmin: 0.65, zmax: 1.7, sala: s };
      return null;
    }
    // rellano entre el ascensor y la sala de al lado; si no hay sala, la pared del hueco cierra el paso (la PB da a la calle)
    if (Math.abs(x) <= ELEVATOR_WIDTH / 2 + FRAME * 2 + 0.2 && this.hasRoomTogether(Math.sign(x), planta)) return { zmin: 0.65, zmax: 1.7 };
    return null;
  }
  limitMovement = (pos: THREE.Vector3, d: THREE.Vector3) => {
    const planta = this.floorOf(pos.y);
    const nueva = pos.clone().add(d);
    const zone = this.zoneIn(nueva.x, planta);
    const z0 = this.zoneIn(pos.x, planta);
    if (!zone) { nueva.x = pos.x; if (z0) nueva.z = THREE.MathUtils.clamp(nueva.z, z0.zmin, z0.zmax); return nueva; }
    if (pos.z < zone.zmin - 1e-3 || pos.z > zone.zmax + 1e-3) {
      // para entrar en el hueco delantero hay que estar ya a su altura: no se atraviesa el tabique
      nueva.x = pos.x;
      if (z0) nueva.z = THREE.MathUtils.clamp(nueva.z, z0.zmin, z0.zmax);
    } else nueva.z = THREE.MathUtils.clamp(nueva.z, zone.zmin, zone.zmax);
    const s = zone.sala;
    if (s) {
      // la franja delantera (z ≥ CARRIL) es siempre paso libre: los muebles cuentan como obstáculo solo hasta ella, y si
      // uno corta el paso de lado, el Supervisor se desliza hacia delante en vez de quedarse clavado
      const r = 0.32, LANE = 1.6; const p2 = new THREE.Vector2(nueva.x - s.grupo.position.x, nueva.z);
      for (const b of s.obstacles) {
        const e = b.clone().expandByScalar(r); e.max.y = Math.min(e.max.y, LANE);
        if (e.containsPoint(p2)) {
          const sx = new THREE.Vector2(pos.x + d.x - s.grupo.position.x, pos.z), sz = new THREE.Vector2(pos.x - s.grupo.position.x, pos.z + d.z);
          if (!e.containsPoint(sx)) { nueva.z = pos.z; }
          else if (!e.containsPoint(sz)) { nueva.x = pos.x; }
          else { nueva.x = pos.x; nueva.z = pos.z; }
          if (nueva.x === pos.x && Math.abs(d.x) > Math.abs(d.z)) nueva.z = Math.min(zone.zmax, pos.z + Math.abs(d.x));   // rodear por delante
        }
      }
    }
    return nueva;
  };

  // ascensor: en el rellano, W/S (↑↓) suben y bajan
  private useElevator(dir: -1 | 1) {
    const sp = this.supervisor.raiz.position;
    const planta = this.floorOf(sp.y);
    const destino = planta - dir; // dir 1 = subir = planta menor
    if (destino < 0 || destino >= this.plantas) { SFX.noAllowed(); return; }
    if (this.ascensor.moving || this.ascensor.currentFloor !== planta) {
      juego.set({ hint: { tecla: dir > 0 ? 'W' : 'S', texto: 'Llamando al ascensor…' } });
      this.ascensor.llamar(planta, () => juego.set({ hint: null })); return;
    }
    this.montado = true;
    this.supervisor.parar();
    this.supervisor.raiz.position.set(0, sp.y, 0.35);
    this.supervisor.goalTurn = 0;
    this.ascensor.llamar(destino, () => { this.montado = false; this.supervisor.raiz.position.z = 1.0; });
    juego.set({ hint: null });
  }

  private supStill = 0; private supChange = 6;
  actualizar(dt: number, t: number) {
    if (!this.supervisor) return;
    const sp = this.supervisor.raiz.position;
    const eje = teclado.eje(); const { x, z } = eje;
    // corre desde el primer paso; con Shift, anda
    const correr = !eje.correr;
    const inLanding = Math.abs(sp.x) <= ELEVATOR_WIDTH / 2;
    if (!teclado.bloqueado && !this.montado && !this.activityMode) {
      if (inLanding && z !== 0 && !this.supervisor.ruta.length && this.ascensor) {
        this.followsCamera = true;
        if (!this.pulseAsc) this.useElevator(z < 0 ? 1 : -1);
        this.pulseAsc = true;
        this.supervisor.moveDirection(new THREE.Vector2(x, 0).normalize(), correr, dt, this.limitMovement);
      } else {
        this.pulseAsc = false;
        const dir = new THREE.Vector2(x, z); if (dir.lengthSq()) dir.normalize();
        // las teclas cancelan la ruta de un clic, pero sin frenar en seco: parar() pondría la velocidad a cero cada
        // fotograma y el Supervisor andaría al 15 % de su marcha
        if (dir.lengthSq() && this.supervisor.ruta.length) this.supervisor.ruta = [];
        if (dir.lengthSq()) this.followsCamera = true; else if (this.supervisor.ruta.length) this.followsCamera = false;
        if (dir.lengthSq() || !this.supervisor.ruta.length) this.supervisor.moveDirection(dir, correr, dt, this.limitMovement);
      }
    }
    if (this.ascensor) {
      this.ascensor.actualizar(dt);
      if (this.montado) { sp.y = this.ascensor.yBooth; sp.x = 0; }
    }
    this.supervisor.actualizar(dt);
    // parado no es una estatua: cada poco cambia de postura y mira alrededor
    const sv = this.supervisor;
    if (!sv.inMovement && !this.montado && !this.activityMode && !sv.currentName.startsWith('Sit')) {
      this.supStill += dt;
      if (this.supStill > this.supChange) { this.supChange = this.supStill + 6 + Math.random() * 7; sv.inRest = sv.inRest === 'Idle_A' ? 'Idle_B' : 'Idle_A'; sv.reproducir(sv.inRest, 0.45); }
    } else { this.supStill = 0; this.supChange = 5 + Math.random() * 5; }
    this.reloj += dt;
    for (const f of this.tareas) f(dt);
    this.galeria.actualizar(dt);
    this.ayudantes.actualizar(dt);
    this.messengers.actualizar(dt);
    this.visitantes.actualizar(dt);
    this.hologramas.actualizar(dt);
    this.advanceDemo(dt);
    for (const h of this.habitantes) h.actualizar(dt);
    this.separate(dt);
    this.leavePass(dt);
    this.retrato?.actualizar(dt);
    audioWorld.actualizar(dt, this);   // ambiente de cada sala, voces y tecleo de los habitantes
    // las salas cercanas se animan a pleno ritmo; las lejanas, de vez en cuando
    // de lejos (vista general) ninguna sala necesita animarse a pleno ritmo: se reparten en turnos de 4
    const farAll = this.camara.distancia > this.distRoom * 1.6;
    this.motor.frozenShadows = farAll;   // de lejos, sombras congeladas
    this.roomsTurn = (this.roomsTurn + 1) % 4;
    this.salas.forEach((s, i) => {
      const d = Math.hypot(s.grupo.position.x - this.camara.goal.x, s.grupo.position.y - this.camara.goal.y);
      if (d < 18 && !farAll) s.actualizar(dt, t);
      else if (this.roomsTurn === i % 4) s.actualizar(dt * 4, t);
    });
    // sala actual (por la posición del Supervisor)
    const planta = this.floorOf(sp.y);
    // en el rellano del ascensor cuenta la sala más cercana de esa planta (la terminal y los aparatos son de esa planta)
    const sala = this.salas.find(s => s.planta === planta && Math.abs(sp.x - s.grupo.position.x) <= s.ancho / 2 + FRAME)
      ?? (inLanding ? this.salas.filter(s => s.planta === planta).sort((a, b) => Math.abs(a.grupo.position.x - sp.x) - Math.abs(b.grupo.position.x - sp.x))[0] : undefined);
    if (sala && sala !== this.currentRoom && !this.montado) { this.currentRoom = sala; this.publish(); if (!this.viewGeneral && !this.focused && !this.copyFocused && this.followsCamera) this.frameRoom(sala); }
    // habitante más cercano para hablar
    let mejor: Habitante | null = null, dmin = 1.9;
    for (const h of this.habitantes) { if (Math.abs(h.pos.y - sp.y) > 1) continue; const d = Math.hypot(h.pos.x - sp.x, h.pos.z - sp.z); if (d < dmin) { dmin = d; mejor = h; } }
    // aparato más cercano (si no hay un habitante más a mano)
    let aparato: typeof this.nearDevice = null, damin = 1.5;
    if (this.currentRoom && !this.montado) for (const it of this.currentRoom.interactive ?? []) {
      const d = Math.hypot(this.currentRoom.grupo.position.x + it.x - sp.x, it.z - sp.z);
      if (d < damin && Math.abs(this.currentRoom.grupo.position.y - sp.y) < 1) { damin = d; aparato = { sala: this.currentRoom, it }; }
    }
    // una copia holográfica gana si está más cerca que el habitante (con un margen para no saltar de uno a otro)
    const cop = this.montado ? null : this.hologramas.nearby(sp, 1.9);
    let copia: Copia | null = null;
    if (cop && (!mejor || cop.d < dmin - (this.nearby === cop.f ? -0.15 : 0.15))) { copia = cop.f; mejor = null; dmin = cop.d; }
    if ((mejor || copia) && aparato && damin < dmin * 0.6) { mejor = null; copia = null; }
    if (mejor || copia) aparato = null;
    if (copia !== this.nearby) { this.nearby = copia; if (copia) SFX.hover(); }
    if (aparato?.it !== this.nearDevice?.it) { this.nearDevice = aparato; if (aparato) SFX.hover(); }
    if (mejor !== this.cercano) { this.cercano = mejor; if (mejor) SFX.hover(); }
    this.updateAimed();
    const ap = this.apuntado;
    const apH = ap?.tipo === 'habitante' ? ap.h : null, apC = ap?.tipo === 'copia' ? ap.f : null;
    // etiquetas (solo las de salas a la vista)
    const lejos = this.camara.distancia > this.distRoom * 1.45;
    const visibles = this.habitantes.filter(h => Math.abs(h.pos.x - this.camara.goal.x) < this.camara.distancia * 0.45 && Math.abs(h.pos.y - this.camara.goal.y) < this.camara.distancia * 0.3);
    // menos chips sobre las piezas: solo se rotula a quien pide atención, trabaja o está junto al Supervisor
    const relevant = (h: Habitante) => h === this.cercano || h === apH || !['ocioso', 'durmiendo'].includes(h.estado) || Math.abs(h.pos.x - sp.x) < 2.2;
    const items: any[] = visibles.filter(relevant).map(h => ({ k: h, pos: h.p.headPoint(), alto: 0.2, nombre: h.id.nombre, estado: h.estado, detalle: h === this.cercano && h.estado !== 'ocioso' && h.estado !== 'durmiendo' ? h.detalle : '', cerca: h === this.cercano || h === apH, lejos, prompt: h === this.cercano || h === apH ? tx('world.talk') : '', tecla: h === this.cercano ? 'E' : tx('world.click'), apuntado: h === apH }));
    // los visitantes son aparatos que se rotulan en su propio letrero (nunca un segundo encima ni sobre el Supervisor)
    const visitor = (it?: Interactive | null) => !!it?.id.startsWith('vis:');
    const nearDevice = visitor(this.nearDevice?.it) ? null : this.nearDevice;
    items.push(...this.visitantes.etiquetas(lejos, this.nearDevice?.it.id, ap?.tipo === 'aparato' ? ap.it.id : undefined).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distancia * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distancia * 0.3));
    items.push(...this.hologramas.etiquetas(lejos, sp, this.nearby, apC).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distancia * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distancia * 0.3));
    items.push(...this.ayudantes.etiquetas(lejos, sp).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distancia * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distancia * 0.3));
    items.push({ k: this.supervisor, pos: this.supervisor.headPoint(), alto: 0.2, nombre: nearDevice ? nearDevice.it.texto : tx('world.you'), estado: 'ocioso', detalle: '', cerca: !!nearDevice, lejos, prompt: nearDevice ? tx('world.use') : '', supervisor: true });
    // el aparato apuntado con el ratón (si no es el que ya está a mano), encima de su sitio
    if (ap?.tipo === 'aparato' && ap.it !== this.nearDevice?.it && !visitor(ap.it)) items.push({ k: ap.it, pos: this.deviceOver(ap.sala, ap.it), alto: 0, nombre: ap.it.texto, estado: 'ocioso', detalle: '', cerca: true, lejos, prompt: tx('world.use'), tecla: tx('world.click'), aparato: true, apuntado: true });
    // el aviso de un aparato va sobre el Supervisor: nunca encima de la pantalla o el cartel que se usa
    if (ap?.tipo === 'ascensor' && !(inLanding && ap.planta === planta)) items.push({ k: this.ascensor, pos: new THREE.Vector3(0, yRoom(ap.planta) + 3.2, 1), alto: 0, nombre: tx('world.elevator'), estado: 'ocioso', detalle: '', cerca: true, lejos, prompt: tx('world.go'), tecla: tx('world.click'), aparato: true, apuntado: true });
    else if (inLanding && !this.montado && this.ascensor) items.push({ k: this.ascensor, pos: new THREE.Vector3(0, sp.y + 3.2, 1), alto: 0, nombre: tx('world.elevator'), estado: 'ocioso', detalle: '', cerca: true, lejos, prompt: tx('world.wSUpAndDown') });
    // de lejos solo se rotula lo que pide atención (te espera, terminó sin leer, avería) y a ti
    if (lejos) for (let i = items.length - 1; i >= 0; i--) if (!items[i].supervisor && !items[i].apuntado && !['esperando', 'terminado', 'error'].includes(items[i].estado)) items.splice(i, 1);
    const tapado = !!juego.get().panel;
    this.etiquetas.raiz.style.visibility = tapado ? 'hidden' : '';
    if (!tapado) this.etiquetas.actualizar(this.motor.camera, items);
    // cámara
    if (this.foco && this.foco.hasta < this.reloj) { this.foco = null; if (this.currentRoom) this.frameRoom(this.currentRoom); }
    if (this.foco && !this.focused && !this.copyFocused) { this.camara.goal.x = this.foco.x; this.camara.goal.y = this.foco.y + 2.0; }
    else if (this.copyFocused) this.frameChat(this.copyFocused.p.raiz.position, this.copyFocused.sala);
    else if (this.focused) this.frameChat(this.focused.p.raiz.position, this.focused.sala);
    else if (this.montado) { this.camara.goal.x = 0; this.camara.goal.y = sp.y + 2; }
    else if (this.activityMode) { /* la actividad fija el encuadre */ }
    else if (!this.followsCamera) { /* anda solo: la cámara se queda donde está */ }
    else if (this.freeCamera) { if (sp.distanceToSquared(this.lastPosSup) > 1e-4) this.freeCamera = false; }   // ampliada en otro sitio: hasta que él se mueva
    else if (!this.viewGeneral && this.currentRoom) {
      // la cámara sigue al Supervisor (también por el rellano y de una sala a otra)
      const cerca = this.camara.distancia < this.distRoom * 0.8;
      const s = this.currentRoom;
      this.camara.goal.x = sp.x;
      this.camara.goal.y = s.grupo.position.y + (cerca ? 1.6 : 2.0);
    }
    // lo movido a mano arrastrando vuelve solo al encuadre en cuanto se mueve al Supervisor o sube al ascensor; con una charla
    // abierta se queda donde se deje (la cámara se mueve igual con el intercomunicador abierto que cerrado)
    if (!this.cameraDragging() && ((this.supervisor.inMovement && this.followsCamera) || this.montado || this.foco || this.activityMode)) this.camara.desplazamiento.multiplyScalar(Math.exp(-dt * 4));
    this.lastPosSup.copy(sp);
    this.camara.actualizar(dt);
    this.cielo?.actualizar(dt);
    // la sombra del sol y las luces dinámicas siguen al encuadre
    const c = this.camara.goal;
    this.sun.position.set(c.x - 6, c.y + 12, 16); this.sun.target.position.set(c.x, c.y - 2, 0);
    this.reparto.actualizar([...this.salas, ...(this.ascensor ? [{ anclas: this.ascensor.anclas, grupo: this.ascensor.cabina } as any] : [])], c, dt);
  }
}
