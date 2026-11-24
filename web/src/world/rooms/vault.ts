// Cámara acorazada (planta -1, izquierda): las llaves del refugio. Integraciones y ajustes; más adelante, claves.
// Pieza protagonista: la pared de cajas de seguridad, una por integración con su piloto de estado, tras una barrera
// láser que se apaga cuando el Supervisor se acerca al escáner. Vigilan una torreta de techo que le sigue con la
// mirada y un dron centinela; a la derecha, el puesto de guardia con las cámaras del refugio.
import { t, t as tr, locale } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PanelRoom, canvas, textureOf, dangerStrip, SOURCES } from '../../engine/textures';
import { overlayScreen } from '../util3d';
import { signInWall, stain, highBand, monitorWall, materialSteel, textureHalo, world, box, HEIGHT, STATE_TEXT, COLOR_STATE, type Context } from './common';
import { live } from '../../net/client';
import { ACTIVE_SOURCES } from '@shared/sources';

const SOURCES_INT: string[] = [...ACTIVE_SOURCES];   // una caja por fuente (el orden de la cámara acorazada)
const COL_INT: Record<string, string> = { demo: '#ffb000', connected: '#5dff8a', error: '#ff3a2a', 'not-configured': '#4a4a4a' };

export async function furnishCamera(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { valves: [-4.6, 5.55], segments: [[-4.9, 2.2], [4.7, 2.4]] });   // el centro, libre para la baliza
  // ---- pared de cajas de seguridad: 7 × 4 puertas remachadas sobre un armazón de acero
  const X0 = -0.7, STEP = 0.66, COLS = 7, ROWS = 4, Y0 = 0.74;
  const frame = materialSteel('#1f2226');
  g.add(box(COLS * STEP + 0.34, ROWS * STEP + 0.34, 0.32, frame, X0, Y0 + (ROWS - 1) * STEP / 2, zB + 0.47, true));
  // marco dorado alrededor (como las cámaras de los bancos de antes)
  for (const [w, h, x, y] of [[COLS * STEP + 0.5, 0.1, X0, Y0 - STEP / 2 - 0.13], [COLS * STEP + 0.5, 0.1, X0, Y0 + (ROWS - 0.5) * STEP + 0.13], [0.1, ROWS * STEP + 0.36, X0 - COLS * STEP / 2 - 0.2, Y0 + (ROWS - 1) * STEP / 2], [0.1, ROWS * STEP + 0.36, X0 + COLS * STEP / 2 + 0.2, Y0 + (ROWS - 1) * STEP / 2]] as const)
    g.add(box(w, h, 0.36, materialSteel('#8a6a2c'), x, y, zB + 0.48));
  const zP = zB + 0.645;
  const r = random(seed);
  const leds: { m: THREE.MeshBasicMaterial; source?: string; phase: number }[] = [];
  const geoLed = new THREE.SphereGeometry(0.03, 8, 6);
  const ps: Promise<unknown>[] = [];
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
    const x = X0 + (i - (COLS - 1) / 2) * STEP, y = Y0 + j * STEP;
    const source = j === 2 ? SOURCES_INT[i] : undefined;   // la fila de las integraciones, de izquierda a derecha
    const open = j === 1 && i === 6;
    if (open) {
      // una caja abierta: la puerta girada sobre su bisagra y, dentro, una llave que brilla
      const hinge = new THREE.Group(); hinge.position.set(x - 0.3, y, zP); g.add(hinge);
      ps.push(place(hinge, R.sf('Details_Plate_Details'), { pos: [0.3, 0, 0], height: 0.6, anchor: 'center', variant: ctx.vDark }).then(() => { hinge.rotation.y = -1.95; }));
      g.add(box(0.56, 0.56, 0.05, new THREE.MeshStandardMaterial({ color: '#0c0d0e', roughness: 0.9 }), x, y, zP - 0.04));
      ps.push(place(g, R.tools('key_C'), { pos: [x, y - 0.08, zP - 0.02], height: 0.34, rotZ: Math.PI / 2, own: true }).then(o => o.traverse((n: any) => { if (n.isMesh) { n.material.emissive = new THREE.Color('#ffc65a'); n.material.emissiveIntensity = 0.9; } })));
      const brightness = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#ffcf6a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
      brightness.scale.setScalar(0.7); brightness.position.set(x, y, zP + 0.05); g.add(brightness);
      continue;
    }
    ps.push(place(g, R.sf('Details_Plate_Details'), { pos: [x, y, zP], height: 0.6, anchor: 'center', variant: source ? v : ctx.vDark }));
    const led = new THREE.MeshBasicMaterial({ color: '#222' });
    const m = new THREE.Mesh(geoLed, led); m.position.set(x + 0.2, y + 0.2, zP + 0.04); m.scale.setScalar(source ? 1.6 : 1); g.add(m);
    leds.push({ m: led, source, phase: r() * 10 });
    if (source) {
      // rótulo de latón con el nombre de la integración
      const { c, g: gg } = canvas(256, 64);
      gg.fillStyle = '#b8913a'; gg.fillRect(0, 0, 256, 64); gg.strokeStyle = '#5e4a1c'; gg.lineWidth = 6; gg.strokeRect(3, 3, 250, 58);
      gg.fillStyle = '#231a0c'; gg.font = `800 34px ${SOURCES.mono}`; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(source.toUpperCase(), 128, 34);
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), new THREE.MeshStandardMaterial({ map: textureOf(c), roughness: 0.45, metalness: 0.6 }));
      plaque.position.set(x, y - 0.19, zP + 0.035); g.add(plaque);
    } else if (r() < 0.22) ps.push(place(g, R.tools(r() < 0.5 ? 'lock_A' : 'lock_B'), { pos: [x + 0.12, y - 0.24, zP + 0.05], height: 0.17, rot: (r() - 0.5) * 0.4 }));
  }
  await Promise.all(ps);
  // baliza de alarma sobre la pared: gira y tiñe la sala de rojo si alguna integración falla
  const beacon = new THREE.Group(); beacon.position.set(X0, Y0 + ROWS * STEP - 0.05, zB + 0.62); g.add(beacon); beacon.userData.isStatic = false;
  let matBeacon: THREE.MeshStandardMaterial | null = null;
  P(R.cy('Light_Square'), { height: 0.4, shadow: false, own: true, isStatic: false }, beacon).then(o => o.traverse((n: any) => { if (n.isMesh && n.material.name === 'Light') { matBeacon = n.material; n.material.color = new THREE.Color('#000'); n.material.emissive = new THREE.Color('#ff2a1a'); n.material.emissiveIntensity = 0.3; } }));
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4.5, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.geometry.translate(0, -2.25, 0); beam.geometry.rotateZ(Math.PI / 2); beam.position.y = 0.22; beacon.add(beam);
  const alarm = { type: 'point' as const, pos: new THREE.Vector3(X0, 3.0, zB + 1.4), intensity: 0, color: new THREE.Color('#ff3020'), distance: 7, priority: 2 };
  ctx.room.anchors.push(alarm);
  // ---- barrera láser delante de las cajas, entre dos postes emisores
  const xa = X0 - COLS * STEP / 2 - 0.45, xb = X0 + COLS * STEP / 2 + 0.45, zL = zB + 1.3;
  for (const x of [xa, xb]) { P(R.sf('Props_Vessel_Tall'), { pos: [x, 0, zL], height: 1.5 }); P(R.sf('Details_Output_Small'), { pos: [x, 1.5, zL], width: 0.2, shadow: false }); }
  const coreLaser = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4030').multiplyScalar(2.2), transparent: true });
  const halo = (() => { const { c, g: gg } = canvas(16, 64); const gr = gg.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,60,40,0)'); gr.addColorStop(0.5, 'rgba(255,60,40,0.9)'); gr.addColorStop(1, 'rgba(255,60,40,0)'); gg.fillStyle = gr; gg.fillRect(0, 0, 16, 64); return new THREE.MeshBasicMaterial({ map: textureOf(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); })();
  const rays: THREE.Object3D[] = [];
  for (const y of [0.32, 0.62, 0.92, 1.22]) {
    const ray = new THREE.Group(); ray.position.set((xa + xb) / 2, y, zL); ray.userData.isStatic = false; g.add(ray);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, xb - xa - 0.3, 6), coreLaser); n.rotation.z = Math.PI / 2; ray.add(n);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa - 0.3, 0.09), halo); ray.add(h);
    rays.push(ray);
  }
  // en el suelo, la franja de peligro y el rótulo de zona restringida
  const strip = dangerStrip(512, 32, '#b8302a', '#1c1a18'); strip.wrapS = THREE.RepeatWrapping; strip.repeat.set(8, 1);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa + 0.3, 0.16), new THREE.MeshStandardMaterial({ map: strip, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set((xa + xb) / 2, 0.015, zL + 0.14); g.add(floor);
  { const { c, g: gg } = canvas(1024, 96); gg.fillStyle = 'rgba(200,50,40,0.55)'; gg.font = `900 70px ${SOURCES.title}`; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(t('world.vault.restrictedArea'), 512, 52);
    const rot = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.32), new THREE.MeshStandardMaterial({ map: textureOf(c), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    rot.rotation.x = -Math.PI / 2; rot.position.set(X0, 0.016, zB + 0.95); g.add(rot); }
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(xa - 0.3, zB), new THREE.Vector2(xb + 0.3, zL + 0.25)));
  // la pieza: la pared de cajas, tras la barrera. Se revisa el inventario de llaves, se comprueba un cierre con la lupa o
  // se pasa la tarjeta por el lector del poste (las cajas de las integraciones parpadean)
  let review = 0; const sweep = () => { review = 1.5; };
  ctx.room.points.push({ id: 'boxes', type: 'piece', pos: new THREE.Vector3(X0 - 0.4, 0, zL + 0.6), rotation: Math.PI,
    actions: [{ clip: 'Holding_A', utensil: 'journal', dur: 4 }, { clip: 'Interact', onMake: sweep }, { clip: 'Holding_B', utensil: 'magnifier', dur: 3 }] });
  ctx.room.points.push({ id: 'post', type: 'piece', pos: new THREE.Vector3(xb - 0.1, 0, zL + 0.6), rotation: Math.PI + 0.45,
    actions: [{ clip: 'Use_Item', utensil: 'wrench', onMake: sweep }, { clip: 'Interact', onMake: sweep }] });
  // ---- escáner biométrico junto a la barrera: aquí se abren las integraciones y los ajustes (E)
  const XE = 2.6;
  const scanner = new Scanner(v.screen);
  const terminal = await place(g, R.sf('Props_ComputerSmall'), { pos: [XE, 0, zB + 0.95], height: 1.5, rot: -0.25, isStatic: false, variant: v });
  overlayScreen(terminal, /^Black$/, scanner.tex, { brightness: 1.3, margin: 0.9 }); ctx.device('scanner', terminal);
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(XE - 0.1, 0, zB + 1.85), rotation: Math.PI - 0.2, clip: 'Interact' });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(XE - 0.45, zB), new THREE.Vector2(XE + 0.45, zB + 1.35)));
  // ---- reserva enjaulada a la izquierda: lingotes, un cofre y la caja de caudales
  const zJ = zB + 1.45;
  // la reja con cristal blindado (el panel macizo del modelo, ahora ahumado): el oro se ve detrás
  const armored = new THREE.MeshStandardMaterial({ color: '#6a8a9a', transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.3, depthWrite: false });
  const glass = (o: THREE.Object3D) => o.traverse((n: any) => { if (n.isMesh && n.material.name === 'DarkGrey') { n.material = armored; n.renderOrder = 3; } });
  for (let k = 0; k < 3; k++) P(R.cy('Fence'), { pos: [-5.55 + k * 0.72, 0, zJ], height: 1.75, own: true }).then(glass);
  P(R.cy('Fence'), { pos: [-3.5, 0, zJ - 0.45], height: 1.75, rot: Math.PI / 2, own: true }).then(glass);
  ctx.room.anchors.push({ type: 'point', pos: new THREE.Vector3(-4.7, 1.3, zB + 1.3), intensity: 2.2, color: new THREE.Color('#ffc46a'), distance: 3, priority: 1 });
  const pale = P(R.resource('Pallet_Wood'), { pos: [-5.1, 0, zB + 0.85], width: 1.1 });
  ctx.restsOn(pale, R.resource('Gold_Bars_Stack_Large'), { pos: [-5.1, 0, zB + 0.85], width: 0.9, rot: 0.1 });
  P(R.resource('Gold_Bars_Stack_Small'), { pos: [-4.2, 0, zB + 1.05], width: 0.5, rot: -0.4 });
  const chest = P(R.sf('Props_Chest'), { pos: [-4.15, 0, zB + 0.5], height: 0.8, rot: 0.05, variant: v });
  ctx.restsOn(chest, R.resource('Money_Bills_Stack_Medium'), { pos: [-4.15, 0, zB + 0.5], width: 0.4, rot: 0.3 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-3.3, zJ + 0.2)));
  // ---- puesto de guardia a la derecha: las cámaras del refugio en un monitor de pared, mesa y silla
  const cctv = new Cctv();
  await monitorWall(ctx, 4.55, 2.3, 1.3, cctv.tex, 1.15);
  // Hanzo no tiene mesa: hace la ronda. Paradas (en orden) mirando a lo que vigila: la reserva enjaulada, la pared de
  // cajas tras la barrera, el escáner y las cámaras del refugio
  for (const [i, x, z, mx, mz] of [[0, -3.0, 1.05, -4.7, zB + 0.9], [1, -0.7, 0.95, X0, zB + 0.6], [2, 3.2, 0.9, XE, zB + 0.95], [3, 4.6, 0.55, 4.55, zB + 0.6]] as const)
    ctx.room.points.push({ id: 'round-' + i, type: 'patrol', pos: new THREE.Vector3(x, 0, z), rotation: Math.atan2(mx - x, mz - z) });
  // el sitio del guardia, sin mesa: un taburete alto junto a la pared de las cámaras y su taquilla
  P(R.sf('Props_Shelf'), { pos: [5.55, 0, zB + 0.5], height: 1.6, rot: -Math.PI / 2 }).then(o => ctx.restsOn(o, R.furniture('mug_B'), { pos: [5.55, 0, zB + 0.5], scale: K * 0.7 }, { since: 1.2 }));
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(5.1, zB), new THREE.Vector2(6, zB + 1.0)));
  signInWall(g, sign(t('world.poster.vault'), t('world.poster.vaultFoot'), '#e3e0d4', '#7a1f1a', 'hand', seed), 3.55, 2.75, 0.56, 0.78, zB + 0.33, 0.03);
  // ---- torreta del techo: sigue al Supervisor mientras está en la sala
  const turret = new THREE.Group(); turret.position.set(X0 + 0.2, HEIGHT - 0.02, zB + 1.85); turret.userData.isStatic = false; g.add(turret);
  P(R.cy('Turret_Gun'), { height: 0.55, rotX: Math.PI, isStatic: false, shadow: false }, turret);
  const eye = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#ff3a2a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  eye.scale.setScalar(0.22); eye.position.set(0, -0.32, 0.38); turret.add(eye);
  // ---- dron centinela que patrulla bajo el techo
  const drone = new THREE.Group(); drone.userData.isStatic = false; g.add(drone);
  P(R.cy('Enemy_Flying'), { height: 0.5, anchor: 'center', isStatic: false }, drone);
  const droneEye = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: '#ff5a3a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
  droneEye.scale.setScalar(0.3); droneEye.position.set(0, 0, 0.2); drone.add(droneEye);

  const panel = new PanelRoom(); panel.title = 'CÁMARA'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 1.6, 1.2, 1.1, seed); stain(g, -2.4, 1.6, 0.8, seed + 3);
  ctx.room.walkZones = [[-2.6, -1.0], [1.0, 2.0]];
  ctx.sparks = new THREE.Vector3(xb, 1.5, zL);
  ctx.lamps = [{ x: -4.6, z: 0.5, o: { intensity: 70, color: '#cfdcff' } }, { x: X0, z: 0.7, o: { intensity: 105, shadow: true, corta: true, goal: [X0, -1.5], color: '#e4ecff' } }, { x: 4.5, z: 0.5, o: { intensity: 75, color: '#ffd7a8' } }];

  const tmp = new THREE.Vector3();
  let red = 0, open = 0, xDrone = -4, droneDir = 1;
  ctx.onUpdate((dt, t) => {
    const ints = live.get().integrations ?? {};
    const fail = SOURCES_INT.some(f => ints[f]?.state === 'error');
    review = Math.max(0, review - dt);
    for (const l of leds) {
      if (l.source) { const e = ints[l.source]?.state ?? 'demo'; l.m.color.set(COL_INT[e] ?? '#444').multiplyScalar(e === 'error' ? 1.5 + Math.sin(t * 8) * 1.2 : review > 0 && Math.sin(t * 20 + l.phase) > 0 ? 4 : 2.4); }
      else l.m.color.set(Math.sin(t * 0.7 + l.phase * 3) > 0.6 ? '#ff3a2a' : '#2f8a4a').multiplyScalar(Math.sin(t * 0.7 + l.phase * 3) > 0.6 ? 1.6 : 0.9);
    }
    // ¿el Supervisor está en esta sala y cerca del escáner? La barrera se apaga y el escáner da paso
    const sup = world.supervisor();
    let inside = false, near = false;
    if (sup) { tmp.copy(sup.position); g.worldToLocal(tmp); inside = Math.abs(tmp.x) < 6.2 && Math.abs(tmp.y) < 1.5 && Math.abs(tmp.z) < 3; near = inside && Math.abs(tmp.x - XE) < 1.6; }
    open = THREE.MathUtils.damp(open, near ? 1 : 0, 6, dt);
    coreLaser.opacity = (1 - open) * (0.85 + 0.15 * Math.sin(t * 40)); halo.opacity = coreLaser.opacity * 0.9;
    for (const [k, ray] of rays.entries()) { ray.visible = open < 0.97; ray.position.y = [0.32, 0.62, 0.92, 1.22][k] + Math.sin(t * 1.3 + k) * 0.04; }
    scanner.update(t, near ? 'granted' : inside ? 'escaneando' : 'rest');
    // la torreta apunta al Supervisor si está dentro; si no, barre la sala despacio
    const rotation = inside ? Math.atan2(tmp.x - turret.position.x, tmp.z - turret.position.z) : Math.sin(t * 0.35) * 1.1;
    turret.rotation.y = THREE.MathUtils.lerp(turret.rotation.y, THREE.MathUtils.clamp(rotation, -1.4, 1.4), 1 - Math.exp(-dt * 3));
    (eye.material as THREE.SpriteMaterial).opacity = inside ? 0.9 : 0.35 + 0.2 * Math.sin(t * 3);
    // dron: va y viene bajo el techo, cabeceando al girar
    xDrone += droneDir * dt * 0.7; if (xDrone > 3.6) droneDir = -1; if (xDrone < -4.8) droneDir = 1;
    drone.position.set(xDrone, 3.55 + Math.sin(t * 2.1) * 0.07, zB + 2.35);
    drone.rotation.y = THREE.MathUtils.damp(drone.rotation.y, droneDir > 0 ? 0.5 : -0.5, 3, dt); drone.rotation.z = Math.sin(t * 1.7) * 0.06;
    // alarma
    red = THREE.MathUtils.damp(red, fail ? 1 : 0, 3, dt);
    beacon.rotation.y = t * 4 * red;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.09 * red; beam.visible = red > 0.02;
    if (matBeacon) (matBeacon as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + red * (2 + Math.sin(t * 8));
    alarm.intensity = red * (3 + 2 * Math.sin(t * 8));
    cctv.update(dt, t);
  });
}

function random(s: number) { let x = s >>> 0 || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }

// Pantalla del escáner: huella dactilar que se lee con una línea de barrido; verde al conceder el acceso
class Scanner {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private last = -1;
  constructor(private color: string) { ({ c: this.c, g: this.g } = canvas(256, 320)); this.tex = textureOf(this.c); }
  update(t: number, mode: 'rest' | 'escaneando' | 'granted') {
    const step = Math.floor(t * 12); if (step === this.last) return; this.last = step;
    const { g } = this; const W = 256, H = 320;
    const col = mode === 'granted' ? '#5dff8a' : mode === 'escaneando' ? this.color : '#3d6a78';
    g.fillStyle = '#041015'; g.fillRect(0, 0, W, H);
    g.strokeStyle = col; g.lineWidth = 3; g.globalAlpha = 0.85;
    // huella: arcos concéntricos con cortes, como las de los lectores de antes
    for (let k = 0; k < 11; k++) { const rr = 14 + k * 9; g.beginPath(); g.ellipse(128, 150, rr * 0.8, rr, 0, Math.PI * (0.9 + (k % 3) * 0.08), Math.PI * (2.1 - (k % 2) * 0.1)); g.stroke(); }
    g.globalAlpha = 1;
    if (mode !== 'granted') { const y = 50 + ((t * 90) % 200); const gr = g.createLinearGradient(0, y - 20, 0, y + 4); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, col); g.fillStyle = gr; g.globalAlpha = mode === 'rest' ? 0.35 : 0.8; g.fillRect(30, y - 20, W - 60, 24); g.globalAlpha = 1; }
    g.fillStyle = col; g.font = `700 24px ${SOURCES.mono}`; g.textAlign = 'center';
    g.fillText(mode === 'granted' ? tr('world.vault.access') : mode === 'escaneando' ? tr('world.vault.identify') : tr('world.panel.vault'), 128, 282);
    g.fillText(mode === 'granted' ? tr('world.vault.granted') : mode === 'escaneando' ? '· · ·' : tr('world.vault.sealed'), 128, 308);
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

// Monitor de vigilancia: cuatro cámaras del refugio con el estado de cada sala, ruido de señal, hora y REC
class Cctv {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private accum = 1; private turn = 0; private noise: HTMLCanvasElement[] = [];
  constructor() {
    ({ c: this.c, g: this.g } = canvas(512, 400)); this.tex = textureOf(this.c);
    for (let k = 0; k < 3; k++) { const { c, g } = canvas(128, 100); const d = g.createImageData(128, 100); for (let i = 0; i < d.data.length; i += 4) { const v = 20 + Math.random() * 45; d.data[i] = v * 0.8; d.data[i + 1] = v; d.data[i + 2] = v * 0.9; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); this.noise.push(c); }
  }
  update(dt: number, t: number) {
    this.accum += dt; if (this.accum < 0.12) return; this.accum = 0;
    const { g } = this; const W = 512, H = 400, w = W / 2, h = H / 2;
    const rooms = world.rooms().filter(s => s.type !== 'vault');
    const repos = rooms.filter(s => s.type === 'repo' || s.type === 'coordination');
    if (Math.floor(t / 6) !== this.turn) this.turn = Math.floor(t / 6);
    const views = [rooms.find(s => s.type === 'gate'), rooms.find(s => s.type === 'bridge'), repos[this.turn % Math.max(1, repos.length)], repos[(this.turn + 1) % Math.max(1, repos.length)]];
    views.forEach((s, k) => {
      const x = (k % 2) * w, y = Math.floor(k / 2) * h;
      g.drawImage(this.noise[(Math.floor(t * 8) + k) % 3], x, y, w, h);
      g.fillStyle = 'rgba(10,20,16,0.45)'; g.fillRect(x, y, w, h);
      const col = s ? COLOR_STATE[s.state] : '#555';
      // la sala, en silueta: el corte con su suelo y el piloto de su estado
      g.strokeStyle = 'rgba(200,230,210,0.5)'; g.lineWidth = 2; g.strokeRect(x + 30, y + 52, w - 60, h - 96);
      g.fillStyle = col; g.globalAlpha = 0.85; g.beginPath(); g.arc(x + w - 46, y + 72, 9, 0, 7); g.fill(); g.globalAlpha = 1;
      g.fillStyle = '#d8efe0'; g.font = `600 18px ${SOURCES.mono}`; g.textAlign = 'left';
      g.fillText(`CAM 0${k + 1}`, x + 10, y + 24);
      g.font = `700 20px ${SOURCES.mono}`; g.fillText((s?.name ?? tr('world.vault.noSignal')).slice(0, 18).toUpperCase(), x + 40, y + h - 66 + 6);
      g.fillStyle = col; g.font = `600 16px ${SOURCES.mono}`; g.fillText(s ? STATE_TEXT[s.state] : '', x + 40, y + h - 44 + 6);
      if (Math.sin(t * 4) > 0) { g.fillStyle = '#ff3a2a'; g.beginPath(); g.arc(x + w - 52, y + 18, 6, 0, 7); g.fill(); g.fillStyle = '#ffb0a0'; g.font = `600 14px ${SOURCES.mono}`; g.fillText('REC', x + w - 42, y + 23); }
    });
    g.fillStyle = '#0a0d0c'; g.fillRect(w - 2, 0, 4, H); g.fillRect(0, h - 2, W, 4);
    const time = new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    g.fillStyle = '#d8efe0'; g.font = `600 16px ${SOURCES.mono}`; g.textAlign = 'right'; g.fillText(time, W - 10, H - 10);
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let yy = 0; yy < H; yy += 3) g.fillRect(0, yy, W, 1);
    this.tex.needsUpdate = true;
  }
}
