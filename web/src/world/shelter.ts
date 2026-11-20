// El mundo: el refugio entero (plantas, salas, ascensor, roca y superficie), sus habitantes y el Supervisor.
import * as THREE from 'three';
import type { Engine } from '../engine/render';
import { ShelterCamera } from '../engine/camera';
import { keyboard } from '../engine/keyboard';
import { BACKGROUND, HEIGHT, SLAB, FLOOR, FRAME, MODULE, box, world, type Room, type Interactive } from './rooms/common';
import { VARIANTS } from '../engine/palette';
import { buildRoom, type SavedRoom } from './rooms';
import { Steam, Sparks } from './effects';
import { Gallery } from './shootingGallery';
import { Helpers } from './helpers';
import { Messengers } from './messenger';
import { Holograms, type Copy } from './holograms';
import { Visitors } from './visitors';
import { SHOP } from '@shared/catalog';
import { Character } from './character';
import { lookOf, lookSignature, type Look } from '@shared/appearance';
import { Dweller, type Identity } from './dweller';
import { TagsLayer, scheduledMark, queuedMark } from './labels';
import { Portrait } from './portrait';
import { Elevator, ELEVATOR_WIDTH } from './elevator';
import { LightsAssignment } from './lights';
import { rockFace } from './rock';
import { place, R } from '../engine/assets';
import { mergeStatic } from './util3d';
import { buildSurface } from './surface';
import { buildEnvironment } from './environment';
import { Sky } from './sky';
import { juego } from '../ui/gameState';
import { isCopy, idCopy, branchCaption } from '../ui/copies';
import { taskCaption } from '@shared/tasks';
import type { TaskBoard, ShownRow } from './rooms/taskBoard';
import { SFX, bootAmbient } from '../audio/sound';
import { audioWorld } from '../audio/world';
import { live } from '../net/client';
import type { SessionSummary } from '@shared/protocol';
import { INITIAL_ROOMS, INITIAL_DWELLERS, ROOM_SUPERVISOR } from '@shared/initialShelter';
import { decorSignature } from '@shared/decor';
import { alphabeticalOrder } from '@shared/layout';
import { t as tx, tIs } from '@shared/language';

const ROOM_WIDTH = 12;
const loadingAcc = new WeakMap<Character, Set<string>>();
const ROOM_STEP = ROOM_WIDTH + FRAME * 2;

export function xRoom(side: 'izq' | 'der', orden: number) {
  const d = ELEVATOR_WIDTH / 2 + FRAME + FRAME + ROOM_WIDTH / 2 + orden * ROOM_STEP;
  return side === 'izq' ? -d : d;
}
export const yRoom = (floor: number) => -floor * FLOOR;
// la calle está a la altura de la planta baja (un pelo por debajo de su suelo): se entra y se sale por la puerta
export const STREET = -0.1;

export class Shelter {
  motor: Engine;
  camara: ShelterCamera;
  rooms: Room[] = [];
  dwellers: Dweller[] = [];
  supervisor!: Character;
  elevator!: Elevator;
  assignment: LightsAssignment;
  sun!: THREE.DirectionalLight;
  ready: Promise<void>;
  following = true;
  labels = new TagsLayer();
  nearest: Dweller | null = null;
  nearby: Copy | null = null;     // copia holográfica a mano para hablar (si está más cerca que cualquier habitante)
  nearDevice: { room: Room; it: Interactive } | null = null;
  distRoom = 30;
  viewGeneral = false;
  currentRoom: Room | null = null;
  floors = 1;
  private mounted = false;           // el Supervisor va en el ascensor
  private focused: Dweller | null = null;
  private copyFocused: Copy | null = null;
  portrait: Portrait | null = null;
  loadProgress = 0;
  galeria = new Gallery(this);
  helpers = new Helpers(this);
  messengers = new Messengers(this);
  visitors = new Visitors(this);
  holograms = new Holograms(this);
  activityMode = false;
  private roomsTurn = 0;            // una actividad manda en la cámara y en el Supervisor
  private pulseElevator = false;

  constructor(motor: Engine) {
    this.motor = motor;
    this.camara = new ShelterCamera(motor.camera);
    this.assignment = new LightsAssignment(motor.scene, 6, 3);
    world.rooms = () => this.rooms; world.supervisor = () => this.supervisor?.root ?? null; world.currentRoom = () => this.currentRoom; world.dwellers = () => this.dwellers; world.camara = () => motor.camera;
    // las copias holográficas son intangibles: no cuentan como ocupantes (se pasea a través de ellas)
    Dweller.occupants = () => [...this.dwellers.map(h => h.p.root), ...(this.supervisor ? [this.supervisor.root] : [])];
    this.ready = this.build();
    motor.eachFrame((dt, t) => this.update(dt, t));
    motor.renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); this.zoomToward(e); }, { passive: false });
    keyboard.listen(e => {
      if (juego.get().talkingWith) return false;
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.nearest) { this.interact(this.nearest); return true; }
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.nearby) { this.interactCopy(this.nearby); return true; }
      if ((e.code === 'KeyE' || e.code === 'Enter') && this.nearDevice) { this.useDevice(this.nearDevice.room, this.nearDevice.it); return true; }
      // la terminal de la sala, en su carpeta de trabajo (las especiales también tienen una)
      if (e.code === 'KeyT' && this.currentRoom && (this.currentRoom.path || live.get().state?.rooms?.some((s: any) => s.id === this.currentRoom!.id && s.folder))) { window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { roomId: this.currentRoom.id } })); return true; }
      // Espacio: el Supervisor salta (también andando)
      if (e.code === 'Space' && this.supervisor && !this.mounted) { this.supervisor.seek(); return true; }
      if (e.code === 'KeyZ' || e.code === 'Minus' || e.code === 'Equal') { this.toggleView(e.code === 'Equal' ? false : e.code === 'Minus' ? true : !this.viewGeneral); return true; }
    });
    window.addEventListener('refugio:fin-dialogo', () => this.dialogEnd());
    // el probador enseña el aspecto que se está eligiendo sobre el propio personaje (sin guardar todavía)
    window.addEventListener('refugio:probar', (e: any) => { const { who, look } = e.detail ?? {}; const p = who === 'supervisor' ? this.supervisor : this.dwellers.find(h => h.id.id === who)?.p; if (p && look) p.changeLook(look); });
    live.subscribe(() => { if (this.built) this.syncHolograms(); });
    let signatureAcc = '';
    live.subscribe(() => { const e = live.get().state; if (!e || !this.built) return; const f = JSON.stringify([e.supervisor?.accessories, e.dwellers?.map((h: any) => h.accessories)]); if (f !== signatureAcc) { signatureAcc = f; this.applyAccessories(); } });
    let looks = '';
    live.subscribe(() => {
      const e = live.get().state; if (!e || !this.built) return;
      const f = JSON.stringify([e.supervisor?.look, e.supervisor?.character, (e.dwellers as any[])?.map(h => [h.look, h.tone])]);
      if (f === looks) return; looks = f;
      this.changeSupervisor(lookOf({ type: e.supervisor?.character ?? 'Protagonist_B', look: e.supervisor?.look }));
      this.dressDwellers();
    });
    // viaje rápido desde el plano o la lista de ocupados; con `hablar`, abre el diálogo con ese habitante
    window.addEventListener('refugio:ir', (ev: any) => {
      const { roomId, dwellerId, talk } = ev.detail ?? {};
      if (isCopy(dwellerId)) { this.goACopy(dwellerId, talk); return; }
      this.goARoom(roomId);
      const h = this.dwellers.find(x => x.id.id === dwellerId);
      if (h) {
        const sp = this.supervisor.root.position; sp.x = h.pos.x + (h.pos.x > (this.currentRoom?.group.position.x ?? 0) ? -1.3 : 1.3); sp.z = Math.min(1.6, h.pos.z + 0.6);
        this.camara.immediate();
        if (talk) this.interact(h);
      }
    });
    live.subscribe(() => this.syncSessions());
    // clic: ir a un sitio; clic en un habitante: ir y hablar; clic en un aparato: ir y usarlo
    const canvas = motor.renderer.domElement; let below: { x: number; y: number } | null = null;
    // arrastrar (más de 6 px con el botón pulsado) mueve la cámara; al soltar no hay clic
    let last: { x: number; y: number } | null = null, dragging = false;
    canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; below = last = { x: e.clientX, y: e.clientY }; dragging = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', e => { if (below && !dragging && Math.hypot(e.clientX - below.x, e.clientY - below.y) < 6) this.click(e); below = last = null; if (dragging) { dragging = false; canvas.style.cursor = ''; } });
    canvas.addEventListener('pointercancel', () => { below = last = null; dragging = false; canvas.style.cursor = ''; });
    canvas.addEventListener('pointermove', e => {
      this.mouse = this.ndc(e);
      if (!below || !last || !(e.buttons & 1)) return;
      if (!dragging && Math.hypot(e.clientX - below.x, e.clientY - below.y) >= 6) { dragging = true; canvas.style.cursor = 'grabbing'; this.aimed = null; }
      if (dragging) { this.camara.drag(e.clientX - last.x, e.clientY - last.y, canvas.clientHeight); last = { x: e.clientX, y: e.clientY }; }
    });
    this.cameraDragging = () => dragging;
    canvas.addEventListener('pointerleave', () => { this.mouse = null; });
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
    const backLight = new THREE.DirectionalLight('#a9c2ff', 1.1); backLight.position.set(-3, 6, -14); s.add(backLight, backLight.target);
    s.fog = new THREE.Fog('#0a0908', 90, 260);
  }

  // Salas guardadas (del servidor; si no hay conexión, la disposición inicial)
  private async layout(): Promise<{ rooms: SavedRoom[]; dwellers: (Identity & { roomId: string })[] }> {
    const t0 = performance.now();
    while (!live.get().state && performance.now() - t0 < 1500) await new Promise(r => setTimeout(r, 50));
    const e = live.get().state;
    const rooms = (e?.rooms ?? INITIAL_ROOMS) as SavedRoom[];
    const dwellers = ((e?.dwellers ?? INITIAL_DWELLERS) as any[]).map(h => ({ id: h.id, name: h.name, nickname: h.nickname, type: h.type, bio: h.bio, voice: h.voice, tint: h.tint, tone: h.tone, look: h.look, roomId: h.roomId }));
    return { rooms, dwellers };
  }

  async build() {
    this.lightGlobal();
    const { rooms: saved, dwellers } = await this.layout();
    this.saved = saved;
    this.floors = Math.max(...saved.map(s => s.floor)) + 1;
    // primero la sala del Supervisor, luego el resto: el refugio aparece por partes
    const orden = [...saved].sort((a, b) => (a.id === ROOM_SUPERVISOR ? -1 : b.id === ROOM_SUPERVISOR ? 1 : a.floor - b.floor));
    let n = 0;
    for (const sec of orden) {
      const room = await this.mountRoom(sec, saved);
      this.loadProgress = ++n / orden.length;
      window.dispatchEvent(new CustomEvent('refugio:carga', { detail: { progreso: this.loadProgress, room: sec.name } }));
      if (sec.id === ROOM_SUPERVISOR || (!this.supervisor && n === 1)) await this.prepareSupervisor(room);
    }
    this.elevator = new Elevator(this.floors);
    this.elevator.label(saved);
    await this.elevator.build();
    this.motor.scene.add(this.elevator.group);
    this.elevator.call(this.currentRoom?.floor ?? 1);
    // roca alrededor de todo y, arriba, la calle (con la puerta y la torre del ascensor a pie de calle)
    const xs = this.rooms.map(s => s.group.position.x);
    const x0 = Math.min(...xs, 0) - 40, x1 = Math.max(...xs, 0) + 40;
    this.limits = [x0, x1];
    this.redoRock();
    const gap: [number, number] = [-ELEVATOR_WIDTH / 2 - FRAME, ELEVATOR_WIDTH / 2 + FRAME];
    const buildings = [gap, ...this.rooms.filter(s => s.floor === 0).map(s => [s.group.position.x - s.width / 2 - FRAME, s.group.position.x + s.width / 2 + FRAME] as [number, number])];
    this.motor.scene.add(await buildSurface(x0, x1, STREET, BACKGROUND / 2 + 0.25, -BACKGROUND / 2 - 0.4, buildings, gap));
    this.sky = new Sky(this.motor, STREET); this.motor.scene.add(this.sky.group);   // cielo y luz de fuera según la hora real
    // habitantes
    for (const id of dwellers) {
      const h = await this.addDweller(id); if (!h) continue;
      // sin sesión nadie «trabaja»: los estados de trabajo solo los pone una sesión real (o la demo con ?ciclo)
      h.change('ocioso');
      h.initialHobby();   // quien vive en una sala con afición (galería, proyección, hidroponía) empieza practicándola
      if (h.p.path.length) { const end = h.p.path[h.p.path.length - 1]; h.p.root.position.copy(end); const cb = h.p.onArrive; h.p.path = []; h.p.onArrive = null; cb?.(); }
    }
    bootAmbient();
    if (this.currentRoom) this.supervisor.root.position.copy(this.freeGap(this.currentRoom));
    const q = new URLSearchParams(location.search).get('sala'); if (q) this.goARoom(q, true);
    this.publish();
    this.syncSessions();
    if (new URLSearchParams(location.search).has('ciclo')) this.cycleDemo();
    this.built = true;
    this.syncHolograms(); this.applyAccessories();
    this.layoutSignature = this.signatureOf(live.get().state);
    live.subscribe(() => { const f = this.signatureOf(live.get().state); if (f && f !== this.layoutSignature) { this.layoutSignature = f; this.queue = this.queue.then(() => this.applyLayout()).catch(e => console.error(e)); } });
  }

  // ---- disposición: montar, rehacer y excavar salas en caliente (sin recargar ni tocar las sesiones)
  saved: SavedRoom[] = [];
  private built = false;
  private layoutSignature = '';
  private queue: Promise<void> = Promise.resolve();
  private rock: THREE.Object3D | null = null;
  private limits: [number, number] = [-60, 60];
  // (con qué carpetas faltan: cuando aparece una, p. ej. un repo de ejemplo recién clonado, su sala se vuelve a montar)
  private signatureOf(e: any) { return e ? JSON.stringify([e.rooms?.map((s: any) => [s.id, s.floor, s.side, s.orden, s.name, s.variant, s.style, s.area, s.path, decorSignature(s.decor)]), e.dwellers?.map((h: any) => h.id + '@' + h.roomId), Object.entries(live.get().repos ?? {}).filter(([, r]: [string, any]) => r?.exists === false).map(([id]) => id).sort()]) : ''; }
  private stepsOf(sec: SavedRoom, saved: SavedRoom[]) {
    // el lado que mira al ascensor siempre tiene paso; el otro, solo si hay sala vecina
    const exists = (o: number) => saved.some(s => s.floor === sec.floor && s.side === sec.side && s.orden === o);
    return sec.side === 'izq' ? { left: exists(sec.orden + 1), right: true } : { left: true, right: exists(sec.orden + 1) };
  }
  private numberOf(sec: SavedRoom, saved: SavedRoom[]) { const i = saved.filter(s => s.type === 'repo').sort(alphabeticalOrder).findIndex(s => s.id === sec.id); return i + 1; }   // en orden alfabético, como van en la planta
  // (con si su carpeta existe: un repo de ejemplo que termina de clonarse cambia su cartel; y con su carpeta y su
  // decorado: vincularla a otro repo o decorarla la vuelve a montar al momento)
  private roomSignature(sec: SavedRoom, saved: SavedRoom[]) { const p = this.stepsOf(sec, saved); return [sec.floor, sec.side, sec.orden, p.left, p.right, sec.variant, sec.style, sec.area, sec.name, sec.path, decorSignature(sec.decor), this.numberOf(sec, saved), !!sec.path && live.get().repos[sec.id]?.exists === false].join('|'); }
  private async mountRoom(sec: SavedRoom, saved: SavedRoom[]) {
    const room = await buildRoom(sec, this.numberOf(sec, saved), this.stepsOf(sec, saved), live.get().repos[sec.id]?.branch, !!sec.path && live.get().repos[sec.id]?.exists === false);
    room.group.position.set(xRoom(sec.side, sec.orden), yRoom(sec.floor), 0);
    room.userData.signature = this.roomSignature(sec, saved);
    this.motor.scene.add(room.group);
    this.rooms.push(room);
    return room;
  }
  private redoRock() {
    if (this.rock) { this.motor.scene.remove(this.rock); this.rock.traverse((o: any) => o.geometry?.dispose()); }
    const gaps = this.rooms.map(s => new THREE.Box2(new THREE.Vector2(s.group.position.x - s.width / 2 - FRAME - 0.05, s.group.position.y - SLAB * 0.38 - 0.18), new THREE.Vector2(s.group.position.x + s.width / 2 + FRAME + 0.05, s.group.position.y + HEIGHT + SLAB * 0.62 + 0.02)));
    gaps.push(new THREE.Box2(new THREE.Vector2(-ELEVATOR_WIDTH / 2 - FRAME - 0.05, yRoom(this.floors - 1) - SLAB * 0.38 - 0.18), new THREE.Vector2(ELEVATOR_WIDTH / 2 + FRAME + 0.05, HEIGHT + SLAB * 0.62 + 0.02)));
    // la roca, de la calle hacia abajo, con las vetas y la bajante; arriba, lo que rodea la entrada
    const xs = this.rooms.map(s => s.group.position.x);
    const xLeft = Math.min(...xs, 0) - ROOM_WIDTH / 2 - FRAME, xRight = Math.max(...xs, 0) + ROOM_WIDTH / 2 + FRAME;
    const rightOf = (p: number) => Math.max(...this.rooms.filter(s => s.floor === p).map(s => s.group.position.x + s.width / 2 + FRAME), ELEVATOR_WIDTH / 2 + FRAME);
    // la roca acaba donde empieza la losa de la calle (0,6 m bajo el suelo): si subiera más, su plano y el frente de la
    // losa se pelearían por los mismos píxeles en la banda marrón de encima de la -1
    this.rock = rockFace(this.limits[0], this.limits[1], yRoom(this.floors - 1) - 24, STREET - 0.6, BACKGROUND / 2 + 0.25, gaps);
    this.motor.scene.add(this.rock);
    this.embedStones(gaps);
    this.closeGap();
    const puerta = this.rooms.find(x => x.type === 'puerta' && x.floor === 0);
    const inStreet = puerta ? { x0: puerta.group.position.x - puerta.width / 2 - FRAME, x1: puerta.group.position.x + puerta.width / 2 + FRAME, ceiling: HEIGHT + SLAB * 0.62 } : undefined;
    const signature = JSON.stringify([xLeft, xRight, this.floors, inStreet, [0, 1].map(rightOf)]);
    if (signature !== this.environmentSignature) {
      this.environmentSignature = signature;
      buildEnvironment({ z: BACKGROUND / 2 + 0.25, xLeft, xRight, rightOf, yFloor: yRoom, floors: this.floors, floor: STREET, gaps, puerta: inStreet }).then(g => {
        if (this.environmentSignature !== signature) return;
        if (this.environment) this.motor.scene.remove(this.environment);
        this.environment = g; this.motor.scene.add(g);
      });
    }
  }
  private environment: THREE.Group | null = null; private environmentSignature = '';
  private sky: Sky | null = null;

  // el hueco del ascensor tiene pared en los lados sin sala: en la PB, la de la derecha da a la calle
  /** ¿hay sala pegada al ascensor por ese lado (-1 izquierda, 1 derecha) en esa planta? */
  hasRoomTogether(side: number, floor: number) { return !!this.roomIn(side * (ELEVATOR_WIDTH / 2 + FRAME * 2 + 1), floor); }
  private closures: THREE.Group | null = null; private closuresSignature = '';
  private async closeGap() {
    const sides: [number, number][] = [];
    for (let p = 0; p < this.floors; p++) for (const s of [-1, 1]) if (!this.hasRoomTogether(s, p)) sides.push([p, s]);
    const signature = JSON.stringify(sides); if (signature === this.closuresSignature) return; this.closuresSignature = signature;
    const g = new THREE.Group(); g.name = 'cierres-ascensor';
    const v = VARIANTS.neutro, vl = { ...v, id: v.id + '-lat' }, length = BACKGROUND + 0.2;
    const ps: Promise<unknown>[] = [];
    for (const [p, s] of sides) {
      // cara de dentro (mira a la cabina) y cara de fuera (mira a la calle o a la roca), como el tabique de una sala;
      // el pilar del corte las enmarca por delante
      for (const [x, rotation] of [[s * (ELEVATOR_WIDTH / 2 + 0.02), -s], [s * (ELEVATOR_WIDTH / 2 + FRAME - 0.02), s]])
        ps.push(place(g, R.sf('Wall_Empty'), { pos: [x, yRoom(p), -BACKGROUND / 2 + 0.25], rot: rotation * Math.PI / 2, anchor: 'atras', variant: vl, shadow: false, height: HEIGHT }).then(o => { o.scale.x = length / MODULE; o.position.z += (length - MODULE) / 2; o.scale.z = 0.35; }));
    }
    await Promise.all(ps);
    if (this.closuresSignature !== signature) return;
    mergeStatic(g);
    if (this.closures) this.motor.scene.remove(this.closures);
    this.closures = g; this.motor.scene.add(g);
  }

  // piedras del pack de naturaleza medio enterradas en la cara de corte (estratos con bolos, no bandas lisas)
  private stones: THREE.Group | null = null;
  private async embedStones(gaps: THREE.Box2[]) {
    if (this.stones) { this.motor.scene.remove(this.stones); this.stones = null; }
    const g = new THREE.Group(); g.name = 'piedras'; this.stones = g;
    let seed = 4242; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const xs = this.rooms.map(s => s.group.position.x);
    const xa = Math.min(...xs, 0) - 26, xb = Math.max(...xs, 0) + 26, already = yRoom(this.floors - 1) - 14, yb = STREET - 0.6;
    const ps: Promise<unknown>[] = [];
    const matsStone = new Map<string, THREE.Material>();
    // menos piedras, más grandes y de la misma tierra que la roca (no cubos negros sueltos): bloques medio enterrados
    // bloques grandes medio enterrados (la roca tiene masa) y piedra menuda entre ellos
    for (let k = 0; k < 190; k++) {
      const x = xa + r() * (xb - xa), y = already + r() * (yb - already), t = k < 60 ? 2.2 + r() * 2.6 : 0.6 + r() * r() * 1.8;
      if (y + t * 0.6 > yb - 0.4) continue;   // ningún bloque asoma por encima de la calle
      if (gaps.some(b => x > b.min.x - t - 0.3 && x < b.max.x + t + 0.3 && y > b.min.y - t - 0.3 && y < b.max.y + t + 0.3)) continue;
      ps.push(place(g, R.rock((r() < 0.25 ? 'Rock_Moss_' : 'Rock_') + (1 + Math.floor(r() * 7))), { pos: [x, y, BACKGROUND / 2 + 0.2], height: t, rot: r() * 6.28, shadow: false }).then(o => {
        o.scale.z *= 0.32; o.rotation.x = (r() - 0.5) * 0.5;
        // materiales compartidos por nombre: así la fusión las junta en pocas llamadas de dibujo
        o.traverse((n: any) => { if (n.isMesh) { const k = n.material.name || 'roca'; let m: any = matsStone.get(k); if (!m) { m = n.material.clone(); m.color.multiplyScalar(0.5).lerp(new THREE.Color("#5a4030"), 0.55); m.emissive = new THREE.Color('#2a1a10'); m.emissiveIntensity = 0.35; matsStone.set(k, m); } n.material = m; } });
      }));
    }
    await Promise.all(ps);
    if (this.stones !== g) return;
    mergeStatic(g);
    this.motor.scene.add(g);
  }

  private async addDweller(id: Identity & { roomId: string }) {
    const room = this.rooms.find(s => s.id === id.roomId); if (!room) return null;
    const h = await new Dweller(id, room).load();
    this.motor.scene.add(h.p.root, h.zzz.group);
    // aparece donde suele estar: en sus tramos de paseo (si la sala los define), nunca delante de la pieza de la sala
    const segments = room.walkZones ?? [[-3, 3]]; const [a, b] = segments[Math.floor(Math.random() * segments.length)];
    h.p.root.position.set(room.group.position.x + a + Math.random() * (b - a), room.group.position.y, 1.2);
    this.dwellers.push(h);
    h.p.onStep = () => SFX.step(THREE.MathUtils.clamp((h.pos.x - this.camara.goal.x) / 10, -1, 1), 0.08);
    return h;
  }
  private removeRoom(s: Room) {
    this.motor.scene.remove(s.group);
    this.rooms = this.rooms.filter(x => x !== s);
  }

  async applyLayout() {
    const e = live.get().state; if (!e) return;
    const saved = e.rooms as SavedRoom[];
    const fresh: Room[] = [];
    // salas retiradas: fuera, con sus habitantes
    for (const s of [...this.rooms]) if (!saved.some(g => g.id === s.id)) {
      for (const h of this.dwellers.filter(h => h.room === s)) { this.motor.scene.remove(h.p.root, h.zzz.group); }
      this.dwellers = this.dwellers.filter(h => h.room !== s);
      this.removeRoom(s);
    }
    // salas nuevas o cambiadas (trasladadas, o con un vecino nuevo que abre un paso en su tabique)
    for (const sec of saved) {
      const old = this.rooms.find(s => s.id === sec.id);
      if (old && old.userData.signature === this.roomSignature(sec, saved)) continue;
      const room = await this.mountRoom(sec, saved);
      if (old) {
        this.removeRoom(old);
        for (const h of this.dwellers.filter(h => h.room === old)) h.relocateTo(room);
        if (this.currentRoom === old) { this.currentRoom = room; const sp = this.supervisor.root.position; sp.set(room.group.position.x + THREE.MathUtils.clamp(sp.x - old.group.position.x, -4, 4), room.group.position.y, 1.3); this.frameRoom(room); }
      } else fresh.push(room);
    }
    this.saved = saved;
    // plantas nuevas: el hueco del ascensor crece
    const floors = Math.max(...saved.map(s => s.floor)) + 1;
    if (floors !== this.floors) {
      this.floors = floors;
      const old = this.elevator; const elev = new Elevator(floors); elev.label(saved); await elev.build();
      this.motor.scene.remove(old.group); this.motor.scene.add(elev.group); this.elevator = elev;
      elev.call(this.floorOf(this.supervisor.root.position.y));
    }
    this.elevator.label(saved);
    this.redoRock();
    // habitantes nuevos (reclutas o contratados)
    const newDweller: Dweller[] = [];
    for (const hg of e.dwellers as any[]) if (!this.dwellers.some(h => h.id.id === hg.id)) {
      const h = await this.addDweller({ id: hg.id, name: hg.name, nickname: hg.nickname, type: hg.type, bio: hg.bio, voice: hg.voice, tint: hg.tint, tone: hg.tone, look: hg.look, roomId: hg.roomId });
      if (h) { h.change('ocioso'); h.waitingAfterChat = 14; if (fresh.includes(h.room)) h.p.root.visible = false; newDweller.push(h); }
    }
    for (const room of fresh) this.dig(room, newDweller.filter(h => h.room === room));
    for (const h of newDweller) if (!fresh.includes(h.room)) this.recruitArrival(h, h.room, 0);
    this.publish(); this.syncSessions(); this.syncHolograms(); this.applyAccessories(); this.visitors.sync();
  }

  // ---- excavación: un tapón de roca se desmorona desde el centro con polvo y chispas, y entra el recluta
  private focus: { x: number; y: number; until: number } | null = null;
  private timer = 0;
  private dig(room: Room, recruits: Dweller[]) {
    const x = room.group.position.x, y = room.group.position.y;
    const w = room.width + FRAME * 2 + 0.2, height = HEIGHT + SLAB + 0.4;
    const plug = rockFace(x - w / 2, x + w / 2, y - SLAB * 0.5, y + height - SLAB * 0.4, BACKGROUND / 2 + 0.32, []);
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); plug.position.set(-x, -y, 0); pivot.add(plug); this.motor.scene.add(pivot);
    const dust = new Steam(new THREE.Vector3(x, y + 1.5, BACKGROUND / 2 + 0.6), 26, new THREE.Vector3(0, 0.5, 0.6));
    const sparks = new Sparks(); this.motor.scene.add(dust.group, sparks.group);
    const puerta = this.rooms.find(s => s.type === 'puerta');
    const t0 = this.timer + (puerta && recruits.length ? 4.2 : 0);
    if (puerta && recruits.length) { this.focus = { x: puerta.group.position.x, y: puerta.group.position.y, until: t0 }; puerta.userData.openGate?.(); SFX.roomGate(); SFX.clank(); }
    juego.set({ hint: { key: '', text: `Excavando «${room.name}»…` } });
    // el recluta asoma por la Puerta Principal mientras empieza la excavación
    for (const h of recruits) if (puerta) {
      const xp = puerta.group.position.x + (puerta.userData.xGate ?? -3.4);
      h.p.root.visible = true; h.pos.set(xp, puerta.group.position.y, -1.6);
      h.p.goA([new THREE.Vector3(xp, puerta.group.position.y, 1.2), new THREE.Vector3(puerta.group.position.x - 0.2, puerta.group.position.y, 1.3)], false);
    }
    let beat = 0; let end = false;
    const tick = (dt: number) => {
      if (end) return;
      const t = this.timer - t0;
      if (t < 0) { dust.active = false; dust.update(dt); return; }
      if (!this.focus || this.focus.until < this.timer + 0.1) this.focus = { x, y, until: t0 + 5.5 };
      const k = THREE.MathUtils.clamp(t / 4.2, 0, 1);
      pivot.scale.set(Math.max(0.001, 1 - k * k), 1, 1);
      dust.active = k < 1; dust.origin.set(x + (Math.random() - 0.5) * w * (1 - k), y + 0.5 + Math.random() * 2.8, BACKGROUND / 2 + 0.5);
      dust.update(dt); sparks.update(dt);
      beat -= dt; if (beat <= 0 && k < 1) { beat = 0.35 + Math.random() * 0.3; SFX.dig(); sparks.burst(new THREE.Vector3(x + (Math.random() - 0.5) * w * (1 - k), y + 0.4 + Math.random() * 2.5, BACKGROUND / 2 + 0.4), 10); this.camara.temblor = Math.max(this.camara.temblor, 0.22); }
      if (t > 6.5) {
        end = true; this.tareas = this.tareas.filter(f => f !== tick); this.motor.scene.remove(pivot, dust.group, sparks.group); plug.traverse((o: any) => o.geometry?.dispose());
        juego.set({ hint: null });
        recruits.forEach((h, i) => this.recruitArrival(h, room, i * 0.8));
        if (!recruits.length) { SFX.shortSuccess(); this.focus = null; }
      }
    };
    this.tareas.push(tick);
  }
  private tareas: ((dt: number) => void)[] = [];
  // el recluta entra en su sala por el paso del lado del ascensor y se presenta
  private recruitArrival(h: Dweller, room: Room, delay: number) {
    setTimeout(() => {
      const side = room.side === 'izq' ? 1 : -1; const x = room.group.position.x + side * (room.width / 2 + 0.2);
      h.pos.set(x, room.group.position.y, 1.3); h.p.root.visible = true;
      h.p.goA([new THREE.Vector3(room.group.position.x + side * 1.2, room.group.position.y, 1.3)], false, () => { h.p.goalTurn = 0; h.change('ocioso'); SFX.success(); });
      this.focus = { x: room.group.position.x, y: room.group.position.y, until: this.timer + 5 };
      juego.set({ hint: { key: '', text: tx('world.recruitMovesIn', { nombre: h.id.name, mote: tIs(h.id.nickname), sala: room.name }) } });
      setTimeout(() => juego.set({ hint: null }), 5000);
    }, delay * 1000);
  }

  // el aspecto del Supervisor (y el de cada habitante) se elige en Chapa y Pintura: se cambia en caliente donde esté
  private signatureSupervisor = '';
  async changeSupervisor(a: Look) {
    const f = lookSignature(a);
    if (!this.supervisor || f === this.signatureSupervisor) return;
    this.signatureSupervisor = f;
    await this.supervisor.changeLook(a);
    if (this.signatureSupervisor === f) this.changeSparks(this.supervisor.root.position);
  }
  /** Los habitantes cuyo aspecto ha cambiado en el servidor se visten con el nuevo sin moverse de donde están */
  private dressDwellers() {
    const e = live.get().state; if (!e) return;
    for (const h of this.dwellers) {
      if (!h.p.look) continue;
      const g = (e.dwellers as any[]).find(x => x.id === h.id.id); if (!g) continue;
      const a = lookOf(g);
      if (lookSignature(a) === lookSignature(h.p.look)) continue;
      h.id.look = g.look;
      h.p.changeLook(a).then(() => { if (h.room === this.currentRoom) this.changeSparks(h.pos); });
    }
  }
  syncHolograms() { this.holograms.sync(); }

  // accesorios de la tienda puestos (Supervisor y habitantes que los han recibido de regalo)
  applyAccessories() {
    const e = live.get().state; if (!e) return;
    const set = (p: Character, ids: string[] = []) => {
      for (const key of [...p.accessories.keys()]) if (key.startsWith('acc:') && !ids.includes(key.slice(4))) p.drop(key);
      for (const id of ids) {
        const pend = loadingAcc.get(p) ?? new Set<string>(); loadingAcc.set(p, pend);
        if (p.accessories.has('acc:' + id) || pend.has(id)) continue;
        const a = SHOP.find(x => x.id === id); if (!a?.ruta || !a.bone) continue;
        pend.add(id);
        p.couple('acc:' + id, { path: a.ruta, bone: a.bone, scale: a.escala ?? 1, pos: a.pos, rot: a.rot, rig: a.rig }).then(() => {
          // los blancos de las piezas de la tienda no queman bajo los focos (albedo ~200, más rugosos)
          p.accessories.get('acc:' + id)?.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material) as any[]) { const hsl = { h: 0, s: 0, l: 0 }; m.color.getHSL(hsl); if (hsl.l > 0.7) m.color.setHSL(hsl.h, hsl.s, 0.62); m.roughness = Math.max(m.roughness ?? 0.5, 0.75); m.metalness = Math.min(m.metalness ?? 0, 0.2); } });
        }).finally(() => pend.delete(id));
      }
    };
    if (this.supervisor) set(this.supervisor, e.supervisor?.accessories);
    for (const h of this.dwellers) set(h.p, (e.dwellers as any[]).find(x => x.id === h.id.id)?.accessories);
  }

  private changeSparks(p: THREE.Vector3) { const s = this.currentRoom; if (s?.effects) s.effects.sparks.burst(p.clone().sub(s.group.position).add(new THREE.Vector3(0, 1, 0)), 14); SFX.toggle(); }

  private async prepareSupervisor(room: Room) {
    const es = live.get().state;
    const a = lookOf({ type: es?.supervisor?.character ?? 'Protagonist_B', look: es?.supervisor?.look });
    this.signatureSupervisor = lookSignature(a);
    const sup = new Character('supervisor', a);
    await sup.load();
    this.motor.scene.add(sup.root);
    sup.root.position.copy(this.freeGap(room));
    sup.goalTurn = 0.3;
    sup.gait = { walk: 'Walking_B', run: 'Running_A', walkRhythm: 1.95, runRhythm: 1.28 };
    sup.onStep = () => SFX.step(0, 0.2);
    this.supervisor = sup;
    this.currentRoom = room;
    this.frameRoom(room);
    this.camara.immediate();
  }

  // viaje rápido: lleva al Supervisor a una sala (desde el plano, la lista de ocupados o la URL de QA)
  goARoom(id: string, immediate = false) {
    const s = this.rooms.find(x => x.id === id); if (!s || !this.supervisor) return;
    this.supervisor.stop(); this.mounted = false;
    this.supervisor.root.position.copy(this.freeGap(s));
    this.currentRoom = s; this.viewGeneral = false; this.frameRoom(s);
    if (immediate) this.camara.immediate();
    if (this.elevator) this.elevator.call(s.floor);
    this.publish();
  }

  // sitio libre en la franja delantera de una sala: a 0,9 m o más de cualquier habitante, ayudante u obstáculo
  freeGap(s: Room, preferred = 1.5) {
    const occupants = [...this.dwellers.map(h => h.pos), ...s.points.filter(pt => pt.busy || pt.type === 'aficion' || pt.type === 'pieza' || pt.type === 'puesto').map(pt => pt.pos.clone().add(s.group.position)), ...[...this.helpers.robots.values()].map(r => r.p.root.position), ...[...this.visitors.figures.values()].map(f => f.p.root.position), ...this.holograms.positions()];
    const cx = s.group.position.x, y = s.group.position.y;
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
    const sender = this.dwellers.find(h => h.room.type === 'repo'); if (!sender) return;
    this.stepsDemo = [
      [9, () => sender.change('pensando', 'leyendo src/componentes/Cabecera.tsx', 'leer')],
      [8, () => sender.change('trabajando', 'editando Cabecera.tsx', 'editar')],
      [8, () => sender.change('trabajando', 'npm test', 'terminal')],
      [7, () => { sender.change('esperando', 'permiso: git push'); SFX.highNotice(); }],
      [6, () => { sender.change('terminado', 'listo: 3 archivos'); SFX.success(); juego.set(e => ({ scrap: e.scrap + 15 })); }],
      [6, () => sender.change('trabajando', 'npm run build', 'terminal')],
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
  private sessionOf(h: Dweller): SessionSummary | undefined {
    const urgency = (s: SessionSummary) => s.state === 'esperando' ? 0 : s.state === 'error' ? 1 : s.state === 'terminada' && s.unread ? 2 : s.state === 'trabajando' || s.state === 'arrancando' ? 3 : 4;
    // lo que se hace dentro de un worktree lo enseña su copia holográfica, no el habitante
    return Object.values(live.get().sessions).filter(s => s.dwellerId === h.id.id && s.state !== 'cerrada' && !this.holograms.inWorktree(s)).sort((a, b) => urgency(a) - urgency(b) || b.updated - a.updated)[0];
  }
  private signatures = new Map<string, string>();
  // each dweller's ✉ n (queuedMark): messages its conversations outside worktrees have not taken yet
  private queued = new Map<string, string>();
  syncSessions() {
    let changed = false;
    const sessions = Object.values(live.get().sessions);
    for (const h of this.dwellers) {
      const q = queuedMark(sessions.filter(s => s.dwellerId === h.id.id && s.queue?.length && !this.holograms.inWorktree(s)));
      if (q) this.queued.set(h.id.id, q); else this.queued.delete(h.id.id);
      const s = this.sessionOf(h);
      const signature = s ? [s.id, s.state, s.unread, s.activity?.mode, s.activity?.text].join('|') : 'sin';
      if (this.signatures.get(h.id.id) === signature) continue;
      const was = this.signatures.has(h.id.id);
      this.signatures.set(h.id.id, signature);
      h.sessionId = s?.id;
      if (!s) { if (was && h.state !== 'durmiendo' && h.state !== 'ocioso') h.change('ocioso'); changed = true; continue; }
      const m = s.activity?.mode;
      if (s.state === 'arrancando') h.change('pensando', tx('windows.gettingReady'), 'leer');
      else if (s.state === 'trabajando') {
        if (!m || m === 'pensar') h.change('pensando', s.activity?.text ?? tx('windows.thinking'), 'leer');
        else h.change('trabajando', s.activity?.text ?? '', m === 'escribir' ? 'editar' : m === 'terminal' ? 'terminal' : m === 'web' ? 'web' : 'buscar');
      } else if (s.state === 'esperando') { if (h.state !== 'esperando') SFX.highNotice(); h.change('esperando', s.pending?.title ?? tx('windows.waitingForYou')); }
      else if (s.state === 'terminada' && s.unread) { if (h.state !== 'terminado') SFX.success(); h.change('terminado', tx('windows.readyTitulo', { titulo: s.title ?? '' })); }
      else if (s.state === 'error') { if (h.state !== 'error') SFX.error(); h.change('error', s.error ?? tx('windows.fault')); }
      else h.change('ocioso', s.title);
      changed = true;
      h.room.activity = Math.min(1, 0.25 + (s.tools % 40) / 40 * 0.75);
    }
    if (changed) this.publish();
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
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.motor.camera);
    const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    // en una charla la rueda acerca o aleja su encuadre (que se recalcula en cada fotograma) hacia lo que hay bajo el
    // ratón: lo que se corre va al desplazamiento, como lo arrastrado, y se queda hasta que el Supervisor ande
    if (this.focused || this.copyFocused) {
      const before = this.zoomChat;
      this.zoomChat = THREE.MathUtils.clamp(before * Math.exp(e.deltaY * 0.0012), 0.45, 4);
      if (!p) return;
      const k = 1 - this.zoomChat / before, c = this.camara.goal.clone().add(this.camara.displacement);
      this.camara.displacement.x += (p.x - c.x) * k;
      this.camara.displacement.y += (p.y - c.y) * k;
      return;
    }
    const before = this.camara.distance;
    this.camara.zoom(e.deltaY);
    this.viewGeneral = this.camara.distance > this.distRoom * 2.2;
    if (this.mounted || this.activityMode || this.focus || !p) return;
    // el centro de lo que se ve es el objetivo más lo arrastrado; lo que se corre va al desplazamiento, como en la charla
    // (sin libre, el seguimiento movería el objetivo y la ampliación se iría del ratón)
    const k = 1 - this.camara.distance / before, c = this.camara.goal.clone().add(this.camara.displacement);
    this.camara.displacement.x += (p.x - c.x) * k;
    this.camara.displacement.y += (p.y - c.y) * k;
    this.freeCamera = true;
  }
  frameRoom(room: Room) {
    this.freeCamera = false; this.followsCamera = true;
    this.camara.frame(new THREE.Vector3(room.group.position.x, room.group.position.y + 2.0, 0), room.width + FRAME * 2 + 1.7, HEIGHT + SLAB * 2 + 0.4);
    this.distRoom = this.camara.distance;
  }
  /** Foto del corte del refugio, de frente, para el plano: la imagen y dónde cae cada sala (en 0..1). */
  mapSnapshot() {
    type Rect = [number, number, number, number];
    const saved = this.saved ?? []; if (!saved.length) return null;
    const floors = this.floors;
    const rect = (x: number, y: number): Rect => [x - ROOM_WIDTH / 2 - FRAME, y - SLAB * 0.4, x + ROOM_WIDTH / 2 + FRAME, y + HEIGHT + SLAB * 0.6];
    const gaps = saved.map(g => ({ id: g.id, floor: g.floor, side: g.side, orden: g.orden, m: rect(xRoom(g.side, g.orden), yRoom(g.floor)) }));
    const x0 = Math.min(...gaps.map(h => h.m[0]), -ELEVATOR_WIDTH) - 1.5, x1 = Math.max(...gaps.map(h => h.m[2]), ELEVATOR_WIDTH) + 1.5;
    const y0 = Math.min(...gaps.map(h => h.m[1])) - 1, y1 = HEIGHT + SLAB + 2.6;
    const cam = this.motor.camera, fabric = this.motor.renderer.domElement;
    const pos = cam.position.clone(), quat = cam.quaternion.clone();
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, vFov = THREE.MathUtils.degToRad(cam.fov);
    const d = Math.max((y1 - y0) / 2 / Math.tan(vFov / 2), (x1 - x0) / 2 / Math.tan(vFov / 2) / cam.aspect) * 1.02;
    const visTags = this.labels.root.style.visibility; this.labels.root.style.visibility = 'hidden';
    try {
      // de frente y sin inclinación: un corte, no una vista
      cam.position.set(cx, cy, d + BACKGROUND / 2); cam.lookAt(cx, cy, BACKGROUND / 2); cam.updateMatrixWorld();
      const project = (x: number, y: number) => { const v = new THREE.Vector3(x, y, BACKGROUND / 2).project(cam); return [(v.x + 1) / 2 * fabric.width, (1 - v.y) / 2 * fabric.height]; };
      const [ax, ay] = project(x0, y1), [bx, by] = project(x1, y0);
      const norm = (m: Rect): Rect => { const [p0x, p0y] = project(m[0], m[3]), [p1x, p1y] = project(m[2], m[1]); return [(p0x - ax) / (bx - ax), (p0y - ay) / (by - ay), (p1x - ax) / (bx - ax), (p1y - ay) / (by - ay)]; };
      this.motor.composer.render(0);
      const w = Math.min(1400, Math.round(bx - ax)), h = Math.round(w * (by - ay) / (bx - ax));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(fabric, ax, ay, bx - ax, by - ay, 0, 0, w, h);
      return {
        url: c.toDataURL('image/jpeg', 0.86), look: w / h,
        gaps: gaps.map(hh => ({ id: hh.id, floor: hh.floor, side: hh.side, orden: hh.orden, r: norm(hh.m) })),
        elevator: norm([-ELEVATOR_WIDTH / 2 - FRAME, yRoom(floors - 1) - SLAB * 0.4, ELEVATOR_WIDTH / 2 + FRAME, HEIGHT + SLAB * 0.6]),
        street: norm([ELEVATOR_WIDTH / 2 + FRAME + 4, STREET, ELEVATOR_WIDTH / 2 + FRAME + 4, STREET]).slice(0, 2),   // rótulo «Calle», a la derecha del ascensor
      };
    } finally {
      cam.position.copy(pos); cam.quaternion.copy(quat); cam.updateMatrixWorld();
      this.labels.root.style.visibility = visTags;
    }
  }

  toggleView(general: boolean) {
    this.viewGeneral = general; SFX.toggle();
    if (general) {
      // todo el refugio con la planta baja, su rótulo y una franja de cielo arriba, por debajo de la regleta
      const xs = this.rooms.map(s => s.group.position.x);
      const width = Math.max(...xs) - Math.min(...xs) + ROOM_WIDTH + 6;
      const above = HEIGHT + SLAB + 4.2, below = yRoom(this.floors - 1) - SLAB - 0.8;
      const height = (above - below) * 1.04;
      this.camara.frame(new THREE.Vector3((Math.max(...xs) + Math.min(...xs)) / 2, (above + below) / 2 + height * 0.03, 0), width, height);
    } else if (this.currentRoom) this.frameRoom(this.currentRoom);
  }

  // viaje rápido hasta una copia holográfica (y, con `hablar`, su intercomunicador); si aún se está materializando, se espera
  private goACopy(id: string, talk: boolean, attempts = 0) {
    const f = this.holograms.ofId(id);
    if (!f) return;
    if (!f.ready) { if (attempts < 40) setTimeout(() => this.goACopy(id, talk, attempts + 1), 150); return; }
    if (!this.focused && !this.copyFocused) this.goARoom(f.room.id);
    const fp = f.p.root.position, sp = this.supervisor.root.position;
    if (Math.abs(sp.y - fp.y) > 1 || Math.hypot(sp.x - fp.x, sp.z - fp.z) > 2.2) {
      sp.set(fp.x + (fp.x > f.room.group.position.x ? -1.3 : 1.3), f.room.group.position.y, Math.min(1.6, fp.z + 0.4));
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
    this.camara.displacement.set(0, 0, 0);
  }

  private dropChat() {
    if (this.copyFocused) { this.holograms.finishChat(this.copyFocused); this.copyFocused = null; }
    if (this.focused) { this.focused.waitingAfterChat = 3; this.focused.chatting = false; this.focused = null; }
  }

  dialogEnd() {
    const h = this.focused; this.focused = null;
    if (this.copyFocused) { this.holograms.finishChat(this.copyFocused); this.copyFocused = null; }
    this.portrait?.destroy(); this.portrait = null;
    this.labels.root.style.display = '';
    Dweller.still = false;
    if (this.currentRoom) this.frameRoom(this.currentRoom);
    if (h) { h.waitingAfterChat = 3; h.chatting = false; }
  }

  // con `andando` (un clic) la charla se abre ya y el Supervisor va hasta su sitio caminando mientras tanto
  interact(h: Dweller, walking = false) {
    SFX.open();
    if (this.focused !== h) { this.dropChat(); this.freshChatFrame(); }
    // a quien duerme se le despierta: se levanta de la litera para hablar (de tumbado no hay retrato ni encuadre)
    if (h.state === 'durmiendo') { h.change('ocioso'); h.p.inRest = 'Idle_A'; h.p.play('Idle_A', 0.2); }
    this.focused = h; h.chatting = true;
    this.portrait?.destroy(); this.portrait = new Portrait(h.p);
    (window as any).__portrait = this.portrait.canvas;
    this.labels.root.style.display = 'none';
    Dweller.still = true;
    juego.set({ talkingWith: h.id.id, hint: null });
    h.p.stop();
    const sp = this.supervisor.root.position;
    const sideH = h.pos.x - 1.3 > h.room.group.position.x - h.room.width / 2 + 0.6 ? -1 : 1;
    if (walking) this.goAChat(new THREE.Vector3(h.pos.x + sideH * 1.3, h.pos.y, Math.min(1.7, Math.max(h.pos.z + 0.35, 1.2))), h.pos);
    else if (Math.abs(sp.y - h.pos.y) < 1) { this.supervisor.stop(); sp.x = h.pos.x + sideH * 1.3; sp.z = Math.min(1.7, Math.max(h.pos.z + 0.35, 1.2)); }
    // el interlocutor, en tres cuartos hacia cámara (mirando un poco al Supervisor), y los demás se van al otro lado
    if (!h.seated) h.p.goalTurn = Math.sign(this.supervisor.root.position.x - h.pos.x || 1) * 0.55;   // sentado a su mesa no gira la silla: te mira girando la cabeza
    for (const o of this.dwellers) {
      if (o === h || o.room !== h.room || o.fixed || Math.abs(o.pos.x - h.pos.x) > 2.6) continue;
      const side = o.pos.x >= h.pos.x ? 1 : -1; const sx = h.room.group.position.x, measured = h.room.width / 2 - 0.8;
      const dest = new THREE.Vector3(THREE.MathUtils.clamp(h.pos.x + side * 3.2, sx - measured, sx + measured), o.pos.y, Math.min(o.pos.z, 0.2));
      o.p.goA(dest, false); o.waitingAfterChat = 8;
    }
    this.supervisor.goalTurn = Math.atan2(h.pos.x - this.supervisor.root.position.x, h.pos.z - this.supervisor.root.position.z);
    this.frameChat(h.p.root.position, h.room, true);
  }

  /** Mientras dura una charla, la cámara sigue al interlocutor y lo deja en el centro de lo que el intercomunicador no
   *  tapa (la ventana va a la derecha, pero se mide de verdad: puede cambiar de tamaño). De suelo a techo de su sala; si
   *  hace falta enseñar algo de fuera de la sala para tenerlo a la vista, se enseña: lo importante es verle hacer. */
  private chatFree = { f: 0.5, measured: -1 };
  /** Zoom de la rueda sobre el encuadre de la charla (1: de suelo a techo); se queda de una charla a otra */
  private zoomChat = 1;
  private frameChat(pos: THREE.Vector3, room: Room, start = false) {
    const cam = this.motor.camera, fabric = this.motor.renderer.domElement.getBoundingClientRect();
    // lo que deja libre la ventana (medido cada cuarto de segundo: leer el DOM en cada fotograma fuerza el diseño)
    if (start || this.timer - this.chatFree.measured > 0.25) {
      this.chatFree.measured = this.timer;
      const v = document.querySelector('.consola')?.getBoundingClientRect();
      const left = v && v.width > 0 && v.width < fabric.width * 0.95 ? (v.left - fabric.left) / fabric.width : 1;
      // sin ventana aún (se monta un instante después) se supone la de siempre: la mitad derecha
      this.chatFree.f = THREE.MathUtils.clamp(v ? left : 0.5, 0.3, 1);
    }
    const f = this.chatFree.f;
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    this.camara.frame(new THREE.Vector3(this.camara.goal.x, room.group.position.y + 1.9, 0), 9.6, 4.4);
    this.camara.distance = THREE.MathUtils.clamp(this.camara.distance * this.zoomChat, this.camara.minDist * 0.45, this.camara.maxDist);
    // media anchura vista a la profundidad del interlocutor
    const prof = this.camara.distance * Math.cos(this.camara.elevation) - pos.z;
    const hw = prof * Math.tan(vFov / 2) * cam.aspect;
    // el centro del par (interlocutor y Supervisor, más peso al interlocutor) en el centro del hueco libre
    const sp = this.supervisor.root.position;
    const focus = Math.abs(sp.y - pos.y) < 1 ? pos.x * 0.7 + sp.x * 0.3 : pos.x;
    let mx = focus + hw - f * hw;
    // a ser posible, sin salirse de la sala por la izquierda ni por lo que se ve a la derecha del hueco libre
    const L = room.group.position.x - room.width / 2 - FRAME, Rr = room.group.position.x + room.width / 2 + FRAME;
    const minRoom = L + hw, maxRoom = Rr + hw - 2 * hw * f;
    if (minRoom <= maxRoom) mx = THREE.MathUtils.clamp(mx, minRoom, maxRoom);
    // pero el interlocutor siempre dentro del hueco libre, con margen
    mx = THREE.MathUtils.clamp(mx, pos.x + hw - 1.3 * hw * f, pos.x + hw - 0.7 * hw * f);   // entre el 35 % y el 65 % del hueco
    this.camara.goal.x = mx;
  }

  // el Supervisor camina hasta su sitio en la charla ya abierta y, al llegar, se vuelve hacia su interlocutor
  private goAChat(target: THREE.Vector3, watch: THREE.Vector3) {
    this.goAPoint(target, () => { const sp = this.supervisor.root.position; this.supervisor.goalTurn = Math.atan2(watch.x - sp.x, watch.z - sp.z); });
  }

  // hablar con una copia holográfica: su propio intercomunicador, con su retrato en holograma
  interactCopy(f: Copy, walking = false) {
    SFX.open();
    if (this.copyFocused !== f) { this.dropChat(); this.freshChatFrame(); }
    this.copyFocused = f;
    this.portrait?.destroy(); this.portrait = new Portrait(f.p, 220, 260, true);
    (window as any).__portrait = this.portrait.canvas;
    this.labels.root.style.display = 'none';
    Dweller.still = true;
    const fp = f.p.root.position, room = f.room;
    const sp = this.supervisor.root.position;
    const sideC = fp.x - 1.3 > room.group.position.x - room.width / 2 + 0.6 ? -1 : 1;
    if (walking) this.goAChat(new THREE.Vector3(fp.x + sideC * 1.3, room.group.position.y, Math.min(1.7, Math.max(fp.z + 0.35, 1.2))), fp);
    else if (Math.abs(sp.y - fp.y) < 1) { this.supervisor.stop(); sp.x = fp.x + sideC * 1.3; sp.z = Math.min(1.7, Math.max(fp.z + 0.35, 1.2)); }
    this.holograms.startChat(f, sp);
    // los habitantes que estorban en el encuadre se apartan
    for (const o of this.dwellers) {
      if (o.room !== room || o.fixed || Math.abs(o.pos.x - fp.x) > 2.6) continue;
      const side = o.pos.x >= fp.x ? 1 : -1; const sx = room.group.position.x, measured = room.width / 2 - 0.8;
      o.p.goA(new THREE.Vector3(THREE.MathUtils.clamp(fp.x + side * 3.2, sx - measured, sx + measured), o.pos.y, Math.min(o.pos.z, 0.2)), false); o.waitingAfterChat = 8;
    }
    this.supervisor.goalTurn = Math.atan2(fp.x - sp.x, fp.z - sp.z);
    juego.set({ talkingWith: idCopy(f.path), hint: null });
    this.frameChat(fp, room, true);
  }

  useDevice(room: Room, it: Interactive, view?: string, here = true) {
    SFX.open(); this.supervisor.stop();
    if (here) this.tapDevice(room, it);
    juego.set({ panel: it.panel as any, panelData: { roomId: room.id, device: it.id, view: view ?? it.view } });
  }
  // next to the device: the Overseer faces it, plays its gesture and the scene reacts (the room panel's screen flashes)
  private tapDevice(room: Room, it: Interactive) {
    this.supervisor.goalTurn = it.rotation ?? Math.PI;
    if (it.gesture) this.supervisor.gesture(it.gesture);
    room.userData.onUse?.[it.id]?.();
  }

  // nadie se mete dentro de nadie: los que están de pie se apartan (más alrededor de quien habla con el Supervisor)
  private separate(dt: number) {
    const sp = this.supervisor.root.position;
    const hs = this.dwellers.filter(h => h.p.root.visible);
    // las copias holográficas son intangibles: no empujan a nadie, salvo la que habla con el Supervisor (se le deja sitio
    // a la escena, y si no, se habla con quien no se quiere)
    const copies = [...this.holograms.figures.values()].filter(f => f === this.copyFocused && f.ready && !f.leaving).map(f => ({ p: f.p.root.position, r: 1.7, fixed: true }));
    for (let i = 0; i < hs.length; i++) {
      const a = hs[i];
      const others: { p: THREE.Vector3; r: number; fixed: boolean }[] = [...hs.slice(i + 1).map(b => ({ p: b.pos, r: b === this.focused || a === this.focused ? 1.7 : 1.15, fixed: b.fixed || b === this.focused })), ...copies];
      // el Supervisor solo aparta a los demás cuando está quieto en una charla o con un aparato abierto (dejan sitio a la
      // escena); andando no empuja ni choca con nadie: pasa por delante
      if (this.focused || this.copyFocused || juego.get().panel) others.push({ p: sp, r: a === this.focused ? 1.1 : 1.2, fixed: true });
      for (const o of others) {
        if (Math.abs(o.p.y - a.pos.y) > 0.8) continue;
        // lo que cuenta es la separación vista desde la cámara (eje X), salvo que uno esté bastante más al fondo
        const dx = a.pos.x - o.p.x, dz = a.pos.z - o.p.z;
        if (Math.abs(dz) > 1.2 || Math.abs(dx) >= o.r) continue;
        const d = Math.abs(dx) || 1e-3;
        const thrust = Math.min(o.r - d, dt * 2.2); const ux = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx), uz = 0;
        const aFixed = a.fixed || a === this.focused;
        if (!aFixed) { a.pos.x += ux * thrust * (o.fixed ? 1 : 0.5); a.pos.z = THREE.MathUtils.clamp(a.pos.z + uz * thrust * (o.fixed ? 1 : 0.5), -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.45); }
        if (!o.fixed && o.p !== sp) { o.p.x -= ux * thrust * (aFixed ? 1 : 0.5); o.p.z = THREE.MathUtils.clamp(o.p.z - uz * thrust * (aFixed ? 1 : 0.5), -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.45); }
      }
    }
  }

  // quien coincide en pantalla con el Supervisor da un paso atrás (medio metro: con esta cámara no se lee como más
  // profundidad, pero el Supervisor queda siempre por delante, como en un juego 2D)
  private leavePass(dt: number) {
    if (this.focused || this.copyFocused || this.mounted) return;
    const sp = this.supervisor.root.position;
    for (const h of this.dwellers) {
      if (h.fixed || !h.p.root.visible || Math.abs(h.pos.y - sp.y) > 0.8) continue;
      const dx = Math.abs(h.pos.x - sp.x);
      if (dx > 0.95) continue;
      const behind = Math.max(-BACKGROUND / 2 + 0.6, sp.z - 0.5);
      if (h.pos.z > behind) h.pos.z = THREE.MathUtils.damp(h.pos.z, behind, 9, dt);
    }
  }

  // ---- clic para ir (y hablar o usar); al pasar el ratón por encima, el mismo letrero que de cerca
  private ray = new THREE.Raycaster();
  private mouse: THREE.Vector2 | null = null;
  private cameraDragging = () => false;
  aimed: { type: 'habitante'; h: Dweller } | { type: 'copia'; f: Copy } | { type: 'aparato'; room: Room; it: Interactive; view?: string } | { type: 'fila'; room: Room; row: ShownRow; pos: THREE.Vector3 } | { type: 'ascensor'; floor: number } | null = null;
  private ndc(e: PointerEvent) {
    const r = this.motor.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  // lo que hay bajo el puntero: un habitante, una copia o un aparato (su columna, del suelo a la pared del fondo);
  // si no, el punto del suelo (para ir andando)
  private log(ndc: THREE.Vector2): { type: 'habitante'; h: Dweller } | { type: 'copia'; f: Copy } | { type: 'aparato'; room: Room; it: Interactive; view?: string } | { type: 'fila'; room: Room; row: ShownRow; pos: THREE.Vector3 } | { type: 'ascensor'; floor: number } | { type: 'suelo'; p: THREE.Vector3; room?: Room; floor: number } | null {
    this.ray.setFromCamera(ndc, this.motor.camera);
    const play = (box: THREE.Box3) => { const p = this.ray.ray.intersectBox(box, new THREE.Vector3()); return p ? p.distanceTo(this.ray.ray.origin) : Infinity; };
    const body = (c: THREE.Vector3, k = 1) => new THREE.Box3(new THREE.Vector3(c.x - 0.45 * k, c.y, c.z - 0.45 * k), new THREE.Vector3(c.x + 0.45 * k, c.y + 1.9 * k, c.z + 0.45 * k));
    // ¿un habitante? (caja aproximada del cuerpo)
    let best: Dweller | null = null, tmin = Infinity;
    for (const h of this.dwellers) { if (!h.p.root.visible) continue; const t = play(body(h.p.root.position)); if (t < tmin) { tmin = t; best = h; } }
    // ¿una copia holográfica? (la caja sigue a la figura, ande por donde ande)
    let copy: Copy | null = null;
    for (const f of this.holograms.figures.values()) {
      if (!f.ready || f.leaving) continue;
      const t = play(body(f.p.root.position, f.p.root.scale.y)); if (t < tmin) { tmin = t; copy = f; best = null; }
    }
    // ¿un aparato? Lo que se ve de él (el tablero, la pantalla, el sillón); si la sala no lo ha medido, lo que tiene
    // detrás hasta la pared
    let device: { room: Room; it: Interactive; view?: string } | null = null, tap = Infinity, measured = false;
    for (const room of this.rooms) for (const i of room.interactive ?? []) {
      const x = room.group.position.x + i.x, y = room.group.position.y;
      const boxes = i.zones?.length ? i.zones.map(b => b.clone().translate(room.group.position)) : [new THREE.Box3(new THREE.Vector3(x - 0.7, y, -BACKGROUND / 2), new THREE.Vector3(x + 0.7, y + 2.4, i.z + 0.5))];
      for (const c of boxes) { const t = play(c); if (t < tap) { tap = t; device = { room, it: i }; measured = !!i.zones?.length; } }
    }
    // una pieza que es parte de un aparato (`userData.interactivo`: la pantalla del tablero en la pared), con su vista
    const pieces: THREE.Object3D[] = [];
    for (const s of this.rooms) if (s.interactive?.length) s.group.traverse(o => { if (o.userData.interactive) pieces.push(o); });
    const touched = this.ray.intersectObjects(pieces, false)[0];
    if (touched && touched.distance <= tap + 0.05) {
      const room = this.rooms.find(s => s.group.getObjectById(touched.object.id));
      const it = room?.interactive?.find(i => i.id === touched.object.userData.interactive);
      if (room && it) { tap = Math.min(tap, touched.distance); device = { room, it, view: touched.object.userData.view }; measured = true; }
    }
    // a row of a room's task board (people and devices in front of it win): talk to that copy
    const boards = this.rooms.map(s => s.userData.taskBoard?.mesh as THREE.Mesh | undefined).filter((m): m is THREE.Mesh => !!m);
    const onBoard = boards.length ? this.ray.intersectObjects(boards, false)[0] : undefined;
    if (onBoard?.uv && onBoard.distance < tmin && onBoard.distance <= tap + 0.05) {
      const room = this.rooms.find(s => s.userData.taskBoard?.mesh === onBoard.object);
      const row = room && (room.userData.taskBoard.board as TaskBoard).rowAt(onBoard.uv);
      if (room && row) return { type: 'fila', room, row, pos: onBoard.point.clone() };
    }
    // ¿las puertas del ascensor?
    let elevator: number | null = null;
    if (this.elevator) for (let floor = 0; floor < this.floors; floor++) {
      const y = yRoom(floor);
      const t = play(new THREE.Box3(new THREE.Vector3(-ELEVATOR_WIDTH / 2 + 0.2, y, -BACKGROUND / 2), new THREE.Vector3(ELEVATOR_WIDTH / 2 - 0.2, y + 3, 0.6)));
      if (t < tap) { tap = t; elevator = floor; device = null; measured = true; }
    }
    // gana lo que está delante: quien se pone ante el tablón tapa el tablón; el DJ, tras su cabina, no la tapa (la
    // columna de un aparato sin medir es solo aproximada: ahí quien esté dentro gana siempre)
    if (tmin <= tap || !measured) { if (copy) return { type: 'copia', f: copy }; if (best) return { type: 'habitante', h: best }; }
    if (device) return { type: 'aparato', ...device };
    if (elevator !== null) return { type: 'ascensor', floor: elevator };
    // ¿el suelo de alguna sala o del rellano? (junto al punto de un aparato, ese aparato; en el rellano, el ascensor)
    for (let floor = 0; floor < this.floors; floor++) {
      const y = yRoom(floor); const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
      if (!p || p.z < -BACKGROUND / 2 || p.z > BACKGROUND / 2 + 0.3) continue;
      const room = this.rooms.find(s => s.floor === floor && Math.abs(p.x - s.group.position.x) <= s.width / 2);
      if (!room && Math.abs(p.x) > ELEVATOR_WIDTH / 2) continue;
      const it = room?.interactive?.find(i => Math.hypot(room.group.position.x + i.x - p.x, i.z - p.z) < 1.0);
      if (it && room) return { type: 'aparato', room, it };
      if (!room && this.elevator) return { type: 'ascensor', floor };
      return { type: 'suelo', p, room, floor };
    }
    return null;
  }
  // Con una charla abierta, un clic en otro habitante (o copia) deja esa charla minimizada en la barra y va a por el
  // nuevo: así se van abriendo charlas una tras otra. Un aparato (un tablero, una pantalla) también: la charla se queda
  // en la barra y se abre su panel. El clic en lo demás (el suelo, el ascensor) no corta la charla
  private click(e: PointerEvent) {
    const j = juego.get(); if (j.panel || !this.supervisor) return;
    const a = this.log(this.ndc(e)); if (!a) return;
    if (j.talkingWith) {
      if ((a.type !== 'habitante' && a.type !== 'copia' && a.type !== 'aparato' && a.type !== 'fila') || (a.type === 'habitante' && a.h === this.focused) || (a.type === 'copia' && a.f === this.copyFocused)) return;
      SFX.close(); juego.set({ talkingWith: null, workIn: null }); this.dialogEnd();   // como minimizarIntercom (ui/Dialog.tsx)
    }
    // la charla se abre con el clic; el Supervisor llega andando por detrás
    if (a.type === 'copia') { SFX.click(); this.interactCopy(a.f, true); return; }
    if (a.type === 'habitante') { SFX.click(); this.interact(a.h, true); return; }
    if (a.type === 'fila') { SFX.click(); this.talkFromBoard(a.room, a.row); return; }
    if (a.type === 'aparato') {
      // al punto del aparato (desde ahí se usa), no a donde cayó el rayo
      const { room, it } = a; const target = new THREE.Vector3(room.group.position.x + it.x, room.group.position.y, THREE.MathUtils.clamp(it.z, -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.5));
      target.x = THREE.MathUtils.clamp(target.x, room.group.position.x - room.width / 2 + 0.6, room.group.position.x + room.width / 2 - 0.6);
      // como con las charlas: el aparato se abre con el clic y el Supervisor llega andando por detrás (y se pone de cara)
      SFX.click(); this.useDevice(room, it, a.view, false);
      this.goAPoint(target, () => { if (juego.get().panelData?.device === it.id) this.tapDevice(room, it); }); return;
    }
    if (a.type === 'ascensor') { this.goAPoint(new THREE.Vector3(0, yRoom(a.floor), 0.35)); SFX.click(); return; }
    const { p, room, floor } = a;
    const target = new THREE.Vector3(p.x, yRoom(floor), THREE.MathUtils.clamp(p.z, -BACKGROUND / 2 + 0.6, BACKGROUND / 2 - 0.5));
    if (room) target.x = THREE.MathUtils.clamp(target.x, room.group.position.x - room.width / 2 + 0.6, room.group.position.x + room.width / 2 - 0.6);
    this.goAPoint(target); SFX.click();
  }
  // a task board's row: its copy's hologram (or, without one, the room's dweller); the main copy, the room's dweller
  private talkFromBoard(room: Room, row: ShownRow) {
    const f = row.main ? undefined : this.holograms.ofId(idCopy(row.path));
    if (f) { this.goACopy(idCopy(row.path), true); return; }
    const h = this.dwellers.find(x => x.room === room);
    if (h) this.interact(h, true);
  }
  // what a pointed row of a task board is called: its task and title, or the main copy with its dweller
  private rowCaption(room: Room, row: ShownRow) {
    if (row.main) return `${tx('world.taskBoard.mainCopy')} · ${this.dwellers.find(x => x.room === room)?.id.name ?? room.name}`;
    return row.key ? taskCaption(row.key, row.title) : branchCaption(row.branch);
  }
  // donde va el letrero de un aparato apuntado: encima de lo que se ve de él (bajo el techo), o de su punto
  private deviceOver(room: Room, it: Interactive) {
    const g = room.group.position;
    if (!it.zones?.length) return new THREE.Vector3(g.x + it.x, g.y + 2.4, it.z);
    const u = it.zones.reduce((u, b) => u.union(b), new THREE.Box3());
    return new THREE.Vector3(g.x + (u.min.x + u.max.x) / 2, g.y + Math.min(u.max.y, HEIGHT - 0.6), u.max.z);
  }
  // lo apuntado con el ratón (cada fotograma: los habitantes se mueven bajo un puntero quieto)
  private updateAimed() {
    const j = juego.get();
    if (this.cameraDragging()) return;
    const a = this.mouse && !j.panel && this.supervisor && !this.mounted ? this.log(this.mouse) : null;
    // con una charla abierta solo cuentan otro interlocutor (el clic cambia de charla) y los aparatos; lo demás no hace nada
    const other = a && (a.type === 'aparato' || a.type === 'fila' || (a.type === 'habitante' && a.h !== this.focused) || (a.type === 'copia' && a.f !== this.copyFocused));
    const newer = a && a.type !== 'suelo' && (!j.talkingWith || other) ? a : null;
    const same = (x: typeof this.aimed, y: typeof this.aimed) => x === y || (!!x && !!y && x.type === y.type && (x.type === 'habitante' ? x.h === (y as any).h : x.type === 'copia' ? x.f === (y as any).f : x.type === 'ascensor' ? x.floor === (y as any).floor : x.type === 'fila' ? x.room === (y as any).room && x.row.path === (y as any).row.path : x.it === (y as any).it));
    if (!same(newer, this.aimed)) { this.aimed = newer; if (newer) SFX.hover(); this.motor.renderer.domElement.style.cursor = newer ? 'pointer' : ''; }
  }

  // camino por el pasillo delantero; si es otra planta, por el ascensor
  goAPoint(target: THREE.Vector3, onArrive?: () => void) {
    const sp = this.supervisor.root.position; const run = true;   // el Supervisor siempre va corriendo
    const me = this.floorOf(sp.y), there = this.floorOf(target.y);
    const corridor = 1.25;
    if (me === there) {
      const same = this.roomIn(sp.x, me) === this.roomIn(target.x, me) && Math.abs(sp.x) > ELEVATOR_WIDTH / 2;
      const path = same ? [target] : [new THREE.Vector3(sp.x, sp.y, corridor), new THREE.Vector3(target.x, sp.y, corridor), target];
      this.supervisor.goA(path, run, onArrive ?? null); return;
    }
    // al rellano, subir a la cabina cuando esté aquí, viajar y seguir andando
    this.supervisor.goA([new THREE.Vector3(sp.x, sp.y, corridor), new THREE.Vector3(0, sp.y, corridor), new THREE.Vector3(0, sp.y, 0.35)], run, () => {
      juego.set({ hint: { key: '', text: tx('windows.callingTheElevator') } });
      this.elevator.call(me, () => {
        this.mounted = true; this.supervisor.goalTurn = 0; juego.set({ hint: null });
        this.elevator.call(there, () => {
          this.mounted = false; sp.z = 0.9;
          this.supervisor.goA([new THREE.Vector3(0, sp.y, corridor), new THREE.Vector3(target.x, sp.y, corridor), target], run, onArrive ?? null);
        });
      });
    });
  }

  publish() {
    // las copias holográficas (worktrees) van por su cuenta, como interlocutores propios; la sala cuenta con ellas
    const copies = this.holograms.summaries();
    const ef = new Map(this.dwellers.map(h => [h, { state: h.state, detail: h.detail, sessionId: h.sessionId }]));
    for (const s of this.rooms) {
      const hs = [...this.dwellers.filter(h => h.room === s).map(h => ({ id: h.id, ...ef.get(h)! })), ...copies.filter(c => c.room === s.id).map(c => ({ id: { name: c.name }, state: c.state, detail: c.detail ?? '', sessionId: c.sessionId }))];
      const e = hs.some(h => h.state === 'error') ? 'error' : hs.some(h => h.state === 'esperando') ? 'esperando' : hs.some(h => h.state === 'trabajando' || h.state === 'pensando') ? 'trabajando' : hs.some(h => h.state === 'terminado') ? 'terminada' : hs.length ? 'ociosa' : 'sin-sesion';
      const who = hs.find(h => h.state !== 'ocioso' && h.state !== 'durmiendo');
      if (e !== s.state) s.setState(e as any, who ? `${who.id.name}: ${who.detail}` : undefined);
      s.setIcon(hs.some(h => h.state === 'error') ? 'error' : hs.some(h => h.state === 'esperando') ? 'espera' : hs.some(h => h.state === 'terminado') ? 'listo' : null);
    }
    const roomsServ: any[] = live.get().state?.rooms ?? [];
    juego.set({ dwellers: this.dwellers.map(h => ({ id: h.id.id, name: h.id.name, nickname: h.id.nickname, type: h.id.type, bio: h.id.bio, room: h.room.id, nameRoom: h.room.name, path: roomsServ.find(x => x.id === h.room.id)?.path ?? h.room.path, folder: roomsServ.find(x => x.id === h.room.id)?.folder ?? roomsServ.find(x => x.id === h.room.id)?.path ?? h.room.path, state: ef.get(h)!.state, detail: ef.get(h)!.detail, sessionId: ef.get(h)!.sessionId, robot: h.p.look?.especie === 'robot' })), copies, currentRoom: this.currentRoom?.id ?? '' });
  }

  // ---- circulación del Supervisor por la planta (salas contiguas, pasos delanteros y rellano del ascensor)
  private roomIn(x: number, floor: number) { return this.rooms.find(s => s.floor === floor && Math.abs(x - s.group.position.x) <= s.width / 2 + FRAME * 2 + 0.01); }
  floorOf(y: number) { return Math.round(-y / FLOOR); }
  private zoneIn(x: number, floor: number): { zmin: number; zmax: number; room?: Room } | null {
    if (Math.abs(x) <= ELEVATOR_WIDTH / 2 - 0.35) return { zmin: -0.8, zmax: 1.65 };
    const s = this.roomIn(x, floor);
    if (s) {
      const lx = x - s.group.position.x;
      if (Math.abs(lx) <= s.width / 2 - 0.5) return { zmin: -BACKGROUND / 2 + 0.5, zmax: BACKGROUND / 2 - 0.45, room: s };
      // franja junto al tabique: solo se cruza por el hueco delantero, y solo si al otro lado hay sala o ascensor
      const other = x + Math.sign(lx) * 1.6;
      const onOtherSide = Math.abs(other) <= ELEVATOR_WIDTH / 2 || this.roomIn(other, floor);
      if (onOtherSide) return { zmin: 0.65, zmax: 1.7, room: s };
      return null;
    }
    // rellano entre el ascensor y la sala de al lado; si no hay sala, la pared del hueco cierra el paso (la PB da a la calle)
    if (Math.abs(x) <= ELEVATOR_WIDTH / 2 + FRAME * 2 + 0.2 && this.hasRoomTogether(Math.sign(x), floor)) return { zmin: 0.65, zmax: 1.7 };
    return null;
  }
  limitMovement = (pos: THREE.Vector3, d: THREE.Vector3) => {
    const floor = this.floorOf(pos.y);
    const next = pos.clone().add(d);
    const zone = this.zoneIn(next.x, floor);
    const z0 = this.zoneIn(pos.x, floor);
    if (!zone) { next.x = pos.x; if (z0) next.z = THREE.MathUtils.clamp(next.z, z0.zmin, z0.zmax); return next; }
    if (pos.z < zone.zmin - 1e-3 || pos.z > zone.zmax + 1e-3) {
      // para entrar en el hueco delantero hay que estar ya a su altura: no se atraviesa el tabique
      next.x = pos.x;
      if (z0) next.z = THREE.MathUtils.clamp(next.z, z0.zmin, z0.zmax);
    } else next.z = THREE.MathUtils.clamp(next.z, zone.zmin, zone.zmax);
    const s = zone.room;
    if (s) {
      // la franja delantera (z ≥ CARRIL) es siempre paso libre: los muebles cuentan como obstáculo solo hasta ella, y si
      // uno corta el paso de lado, el Supervisor se desliza hacia delante en vez de quedarse clavado
      const r = 0.32, LANE = 1.6; const p2 = new THREE.Vector2(next.x - s.group.position.x, next.z);
      for (const b of s.obstacles) {
        const e = b.clone().expandByScalar(r); e.max.y = Math.min(e.max.y, LANE);
        if (e.containsPoint(p2)) {
          const sx = new THREE.Vector2(pos.x + d.x - s.group.position.x, pos.z), sz = new THREE.Vector2(pos.x - s.group.position.x, pos.z + d.z);
          if (!e.containsPoint(sx)) { next.z = pos.z; }
          else if (!e.containsPoint(sz)) { next.x = pos.x; }
          else { next.x = pos.x; next.z = pos.z; }
          if (next.x === pos.x && Math.abs(d.x) > Math.abs(d.z)) next.z = Math.min(zone.zmax, pos.z + Math.abs(d.x));   // rodear por delante
        }
      }
    }
    return next;
  };

  // ascensor: en el rellano, W/S (↑↓) suben y bajan
  private useElevator(dir: -1 | 1) {
    const sp = this.supervisor.root.position;
    const floor = this.floorOf(sp.y);
    const target = floor - dir; // dir 1 = subir = planta menor
    if (target < 0 || target >= this.floors) { SFX.notAllowed(); return; }
    if (this.elevator.moving || this.elevator.currentFloor !== floor) {
      juego.set({ hint: { key: dir > 0 ? 'W' : 'S', text: tx('windows.callingTheElevator') } });
      this.elevator.call(floor, () => juego.set({ hint: null })); return;
    }
    this.mounted = true;
    this.supervisor.stop();
    this.supervisor.root.position.set(0, sp.y, 0.35);
    this.supervisor.goalTurn = 0;
    this.elevator.call(target, () => { this.mounted = false; this.supervisor.root.position.z = 1.0; });
    juego.set({ hint: null });
  }

  private supStill = 0; private supChange = 6;
  update(dt: number, t: number) {
    if (!this.supervisor) return;
    const sp = this.supervisor.root.position;
    const axis = keyboard.axis(); const { x, z } = axis;
    // corre desde el primer paso; con Shift, anda
    const run = !axis.run;
    const inLanding = Math.abs(sp.x) <= ELEVATOR_WIDTH / 2;
    if (!keyboard.blocked && !this.mounted && !this.activityMode) {
      if (inLanding && z !== 0 && !this.supervisor.path.length && this.elevator) {
        this.followsCamera = true;
        if (!this.pulseElevator) this.useElevator(z < 0 ? 1 : -1);
        this.pulseElevator = true;
        this.supervisor.moveDirection(new THREE.Vector2(x, 0).normalize(), run, dt, this.limitMovement);
      } else {
        this.pulseElevator = false;
        const dir = new THREE.Vector2(x, z); if (dir.lengthSq()) dir.normalize();
        // las teclas cancelan la ruta de un clic, pero sin frenar en seco: parar() pondría la velocidad a cero cada
        // fotograma y el Supervisor andaría al 15 % de su marcha
        if (dir.lengthSq() && this.supervisor.path.length) this.supervisor.path = [];
        if (dir.lengthSq()) this.followsCamera = true; else if (this.supervisor.path.length) this.followsCamera = false;
        if (dir.lengthSq() || !this.supervisor.path.length) this.supervisor.moveDirection(dir, run, dt, this.limitMovement);
      }
    }
    if (this.elevator) {
      this.elevator.update(dt);
      if (this.mounted) { sp.y = this.elevator.yBooth; sp.x = 0; }
    }
    this.supervisor.update(dt);
    // parado no es una estatua: cada poco cambia de postura y mira alrededor
    const sv = this.supervisor;
    if (!sv.inMovement && !this.mounted && !this.activityMode && !sv.currentName.startsWith('Sit')) {
      this.supStill += dt;
      if (this.supStill > this.supChange) { this.supChange = this.supStill + 6 + Math.random() * 7; sv.inRest = sv.inRest === 'Idle_A' ? 'Idle_B' : 'Idle_A'; sv.play(sv.inRest, 0.45); }
    } else { this.supStill = 0; this.supChange = 5 + Math.random() * 5; }
    this.timer += dt;
    for (const f of this.tareas) f(dt);
    this.galeria.actualizar(dt);
    this.helpers.update(dt);
    this.messengers.update(dt);
    this.visitors.update(dt);
    this.holograms.update(dt);
    this.advanceDemo(dt);
    // con una copia trabajando en su sala, su habitante también está de faena (la copia se queda en su proyector)
    const roomsWithCopies = this.holograms.busyRooms();
    for (const h of this.dwellers) { h.roomWork(roomsWithCopies.has(h.room.id)); h.update(dt); }
    this.separate(dt);
    this.leavePass(dt);
    this.portrait?.update(dt);
    audioWorld.update(dt, this);   // ambiente de cada sala, voces y tecleo de los habitantes
    // las salas cercanas se animan a pleno ritmo; las lejanas, de vez en cuando
    // de lejos (vista general) ninguna sala necesita animarse a pleno ritmo: se reparten en turnos de 4
    const farAll = this.camara.distance > this.distRoom * 1.6;
    this.motor.frozenShadows = farAll;   // de lejos, sombras congeladas
    this.roomsTurn = (this.roomsTurn + 1) % 4;
    this.rooms.forEach((s, i) => {
      const d = Math.hypot(s.group.position.x - this.camara.goal.x, s.group.position.y - this.camara.goal.y);
      if (d < 18 && !farAll) s.update(dt, t);
      else if (this.roomsTurn === i % 4) s.update(dt * 4, t);
    });
    // sala actual (por la posición del Supervisor)
    const floor = this.floorOf(sp.y);
    // en el rellano del ascensor cuenta la sala más cercana de esa planta (la terminal y los aparatos son de esa planta)
    const room = this.rooms.find(s => s.floor === floor && Math.abs(sp.x - s.group.position.x) <= s.width / 2 + FRAME)
      ?? (inLanding ? this.rooms.filter(s => s.floor === floor).sort((a, b) => Math.abs(a.group.position.x - sp.x) - Math.abs(b.group.position.x - sp.x))[0] : undefined);
    if (room && room !== this.currentRoom && !this.mounted) { this.currentRoom = room; this.publish(); if (!this.viewGeneral && !this.focused && !this.copyFocused && this.followsCamera) this.frameRoom(room); }
    // habitante más cercano para hablar
    let best: Dweller | null = null, dmin = 1.9;
    for (const h of this.dwellers) { if (Math.abs(h.pos.y - sp.y) > 1) continue; const d = Math.hypot(h.pos.x - sp.x, h.pos.z - sp.z); if (d < dmin) { dmin = d; best = h; } }
    // aparato más cercano (si no hay un habitante más a mano)
    let device: typeof this.nearDevice = null, damin = 1.5;
    if (this.currentRoom && !this.mounted) for (const it of this.currentRoom.interactive ?? []) {
      const d = Math.hypot(this.currentRoom.group.position.x + it.x - sp.x, it.z - sp.z);
      if (d < damin && Math.abs(this.currentRoom.group.position.y - sp.y) < 1) { damin = d; device = { room: this.currentRoom, it }; }
    }
    // una copia holográfica gana si está más cerca que el habitante (con un margen para no saltar de uno a otro)
    const cop = this.mounted ? null : this.holograms.nearby(sp, 1.9);
    let copy: Copy | null = null;
    if (cop && (!best || cop.d < dmin - (this.nearby === cop.f ? -0.15 : 0.15))) { copy = cop.f; best = null; dmin = cop.d; }
    if ((best || copy) && device && damin < dmin * 0.6) { best = null; copy = null; }
    if (best || copy) device = null;
    if (copy !== this.nearby) { this.nearby = copy; if (copy) SFX.hover(); }
    if (device?.it !== this.nearDevice?.it) { this.nearDevice = device; if (device) SFX.hover(); }
    if (best !== this.nearest) { this.nearest = best; if (best) SFX.hover(); }
    this.updateAimed();
    const aim = this.aimed;
    const aimH = aim?.type === 'habitante' ? aim.h : null, aimC = aim?.type === 'copia' ? aim.f : null;
    // etiquetas (solo las de salas a la vista)
    const farSide = this.camara.distance > this.distRoom * 1.45;
    const visible = this.dwellers.filter(h => Math.abs(h.pos.x - this.camara.goal.x) < this.camara.distance * 0.45 && Math.abs(h.pos.y - this.camara.goal.y) < this.camara.distance * 0.3);
    // menos chips sobre las piezas: solo se rotula a quien pide atención, trabaja o está junto al Supervisor
    // y a quien tiene un mensaje programado pendiente (su ⏰, scheduledMark)
    const relevant = (h: Dweller) => h === this.nearest || h === aimH || !['ocioso', 'durmiendo'].includes(h.state) || Math.abs(h.pos.x - sp.x) < 2.2 || !!scheduledMark(h.room.id) || this.queued.has(h.id.id);
    const items: any[] = visible.filter(relevant).map(h => ({ k: h, scheduled: scheduledMark(h.room.id), queued: this.queued.get(h.id.id), pos: h.p.headPoint(), height: 0.2, name: h.id.name, state: h.state, detail: h === this.nearest && h.state !== 'ocioso' && h.state !== 'durmiendo' ? h.detail : '', near: h === this.nearest || h === aimH, farSide, prompt: h === this.nearest || h === aimH ? tx('world.talk') : '', key: h === this.nearest ? 'E' : tx('world.click'), aimed: h === aimH }));
    // los visitantes son aparatos que se rotulan en su propio letrero (nunca un segundo encima ni sobre el Supervisor)
    const visitor = (it?: Interactive | null) => !!it?.id.startsWith('vis:');
    const nearDevice = visitor(this.nearDevice?.it) ? null : this.nearDevice;
    items.push(...this.visitors.labels(farSide, this.nearDevice?.it.id, aim?.type === 'aparato' ? aim.it.id : undefined).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distance * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distance * 0.3));
    // what the pointer is over for the holograms' and helpers' tags: the figure, or its tag as drawn last frame
    const pointer = this.mouse && !juego.get().panel && !this.cameraDragging() ? this.mouse : null;
    const canvas = pointer && this.motor.renderer.domElement.getBoundingClientRect();
    const overTag = pointer && canvas ? this.labels.at(canvas.left + (pointer.x + 1) / 2 * canvas.width, canvas.top + (1 - pointer.y) / 2 * canvas.height) : undefined;
    if (pointer) this.ray.setFromCamera(pointer, this.motor.camera);
    const overHelper = (pointer ? this.helpers.at(this.ray.ray) : undefined) ?? overTag;
    items.push(...this.holograms.labels(farSide, this.nearby, aimC, overTag).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distance * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distance * 0.3));
    items.push(...this.helpers.labels(overHelper).filter(x => Math.abs(x.pos.x - this.camara.goal.x) < this.camara.distance * 0.45 && Math.abs(x.pos.y - this.camara.goal.y) < this.camara.distance * 0.3));
    items.push({ k: this.supervisor, pos: this.supervisor.headPoint(), height: 0.2, name: nearDevice ? nearDevice.it.text : tx('world.you'), state: 'ocioso', detail: '', near: !!nearDevice, farSide, prompt: nearDevice ? tx('world.use') : '', supervisor: true });
    // el aparato apuntado con el ratón (si no es el que ya está a mano), encima de su sitio
    if (aim?.type === 'aparato' && aim.it !== this.nearDevice?.it && !visitor(aim.it)) items.push({ k: aim.it, pos: this.deviceOver(aim.room, aim.it), height: 0, name: aim.it.text, state: 'ocioso', detail: '', near: true, farSide, prompt: tx('world.use'), key: tx('world.click'), device: true, aimed: true });
    if (aim?.type === 'fila') items.push({ k: 'fila:' + aim.row.path, pos: aim.pos, height: 0, name: this.rowCaption(aim.room, aim.row), state: 'ocioso', detail: '', near: true, farSide, prompt: tx('world.talk'), key: tx('world.click'), device: true, aimed: true });
    // el aviso de un aparato va sobre el Supervisor: nunca encima de la pantalla o el cartel que se usa
    if (aim?.type === 'ascensor' && !(inLanding && aim.floor === floor)) items.push({ k: this.elevator, pos: new THREE.Vector3(0, yRoom(aim.floor) + 3.2, 1), height: 0, name: tx('world.elevator'), state: 'ocioso', detail: '', near: true, farSide, prompt: tx('world.go'), key: tx('world.click'), device: true, aimed: true });
    else if (inLanding && !this.mounted && this.elevator) items.push({ k: this.elevator, pos: new THREE.Vector3(0, sp.y + 3.2, 1), height: 0, name: tx('world.elevator'), state: 'ocioso', detail: '', near: true, farSide, prompt: tx('world.wSUpAndDown') });
    // de lejos solo se rotula lo que pide atención (te espera, terminó sin leer, avería) y a ti
    if (farSide) for (let i = items.length - 1; i >= 0; i--) if (!items[i].supervisor && !items[i].aimed && !['esperando', 'terminado', 'error'].includes(items[i].state)) items.splice(i, 1);
    const covered = !!juego.get().panel;
    this.labels.root.style.visibility = covered ? 'hidden' : '';
    if (!covered) this.labels.update(this.motor.camera, items);
    // cámara
    if (this.focus && this.focus.until < this.timer) { this.focus = null; if (this.currentRoom) this.frameRoom(this.currentRoom); }
    if (this.focus && !this.focused && !this.copyFocused) { this.camara.goal.x = this.focus.x; this.camara.goal.y = this.focus.y + 2.0; }
    else if (this.copyFocused) this.frameChat(this.copyFocused.p.root.position, this.copyFocused.room);
    else if (this.focused) this.frameChat(this.focused.p.root.position, this.focused.room);
    else if (this.mounted) { this.camara.goal.x = 0; this.camara.goal.y = sp.y + 2; }
    else if (this.activityMode) { /* la actividad fija el encuadre */ }
    else if (!this.followsCamera) { /* anda solo: la cámara se queda donde está */ }
    else if (this.freeCamera) { if (sp.distanceToSquared(this.lastPosSup) > 1e-4) this.freeCamera = false; }   // ampliada en otro sitio: hasta que él se mueva
    else if (!this.viewGeneral && this.currentRoom) {
      // la cámara sigue al Supervisor (también por el rellano y de una sala a otra)
      const near = this.camara.distance < this.distRoom * 0.8;
      const s = this.currentRoom;
      this.camara.goal.x = sp.x;
      this.camara.goal.y = s.group.position.y + (near ? 1.6 : 2.0);
    }
    // lo movido a mano arrastrando vuelve solo al encuadre en cuanto se mueve al Supervisor o sube al ascensor; con una charla
    // abierta se queda donde se deje (la cámara se mueve igual con el intercomunicador abierto que cerrado)
    if (!this.cameraDragging() && ((this.supervisor.inMovement && this.followsCamera) || this.mounted || this.focus || this.activityMode)) this.camara.displacement.multiplyScalar(Math.exp(-dt * 4));
    this.lastPosSup.copy(sp);
    this.camara.update(dt);
    this.sky?.update(dt);
    // la sombra del sol y las luces dinámicas siguen al encuadre
    const c = this.camara.goal;
    this.sun.position.set(c.x - 6, c.y + 12, 16); this.sun.target.position.set(c.x, c.y - 2, 0);
    this.assignment.update([...this.rooms, ...(this.elevator ? [{ anchors: this.elevator.anchors, group: this.elevator.car } as any] : [])], c, dt);
  }
}
