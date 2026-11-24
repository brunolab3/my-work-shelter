// Salas de actividades: hidroponía (cultivos que crecen con las llamadas a herramientas) y galería de tiro.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PanelRoom, PhosphorScreen, canvas, textureOf, SOURCES } from '../../engine/textures';
import { signInWall, stain, highBand, materialSteel, box, HEIGHT, type Context, switchOffWalls, workStation, lying, lean } from './common';
import { live } from '../../net/client';
import { SFX } from '../../audio/sound';

const CROPS = ['Lettuce', 'Carrot', 'Corn', 'Pumpkin', 'Beet', 'Mushroom'];
// altura final (fase 4) de cada especie en metros; las fases previas crecen hasta ella
const CROP_HEIGHT: Record<string, number> = { Lettuce: 0.6, Carrot: 0.9, Corn: 1.3, Pumpkin: 0.7, Beet: 0.75, Mushroom: 0.45 };
// las raíces van dentro de la tierra (solo asoman las hojas) y las lechugas, verdes de verdad bajo la luz magenta
const SINK: Record<string, number> = { Carrot: 0.5, Beet: 0.38 };
const greens = new Map<THREE.Material, THREE.Material>();
function sprout(o: THREE.Object3D, especie: string) {
  const h = (o.userData.size as THREE.Vector3 | undefined)?.y ?? 0;
  if (SINK[especie]) o.position.y -= h * SINK[especie];
  if (especie === 'Lettuce') o.traverse((n: any) => {
    if (!n.isMesh || Array.isArray(n.material)) return;
    let m = greens.get(n.material); if (!m) { m = n.material.clone(); (m as any).color.lerp(new THREE.Color('#7fc24a'), 0.5); (m as any).emissive = new THREE.Color('#2a5a18'); (m as any).emissiveIntensity = 0.35; greens.set(n.material, m!); }
    n.material = m;
  });
}

// ---------------------------------------------------------------- hidroponía
export async function furnishHydroponics(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  switchOffWalls(g, 0.62, 0.75);   // el invernadero brilla por sus bancales, no por las paredes
  await highBand(ctx, { gauge: 4.8, valves: [-4.6], segments: [[-2.0, 7.4]] });
  // bancales: tres mesas de cultivo con luces de crecimiento magenta y plantas por fases
  const planters: { x: number; z: number; especie: string; floors: THREE.Object3D[] }[] = [];
  const phases: THREE.Object3D[][] = [];
  const XB = [-3.75, -0.4, 2.95];   // bancales algo a la izquierda: a la derecha queda el puesto de control
  for (const [i, x] of XB.entries()) {
    // bancal: dos macetones elevados del pack espacial, con tierra y dos hileras de plantas en sus cuatro fases
    for (const dx of [-0.62, 0.62]) ctx.device('cultivos', P(R.sf('Props_CrateLong'), { pos: [x + dx, 0, zB + 1.15], height: 0.8, variant: v }));
    const dirt = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.05, 0.62), new THREE.MeshStandardMaterial({ color: '#2e2117', roughness: 1 }));
    dirt.position.set(x, 0.83, zB + 1.15); g.add(dirt);
    // lámpara de cultivo colgada justo encima: carcasa oscura, tubo magenta y la luz sobre las hojas
    const casing = box(2.3, 0.08, 0.34, materialSteel('#2a2826'), x, 2.32, zB + 1.15); g.add(casing);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ad1').multiplyScalar(2.4) }));
    tube.position.set(x, 2.27, zB + 1.15); g.add(tube);
    for (const sx of [-1.05, 1.05]) g.add(box(0.025, HEIGHT - 2.36, 0.025, materialSteel('#3a3833'), x + sx, (HEIGHT + 2.36) / 2, zB + 1.15));
    const especie = CROPS[i % CROPS.length];
    const floors: THREE.Object3D[] = [];
    for (let k = 0; k < 10; k++) {
      const row = k % 2, col = Math.floor(k / 2);
      const group = new THREE.Group(); group.position.set(x - 0.92 + col * 0.46 + row * 0.12, 0.85, zB + 1.15 + (row ? 0.14 : -0.13)); g.add(group); group.userData.isStatic = false;
      for (let f = 1; f <= 4; f++) place(group, R.crop(`${especie}_${f}`), { height: CROP_HEIGHT[especie] * [0.55, 0.75, 0.9, 1][f - 1], isStatic: false }).then(o => { o.userData.phase = f; o.visible = f === 1; o.rotation.y = k * 1.3; sprout(o, especie); });
      floors.push(group);
    }
    planters.push({ x, z: zB + 1.15, especie, floors });
    phases.push(floors);
    ctx.room.anchors.push({ type: 'point', pos: new THREE.Vector3(x, 2.0, zB + 1.3), intensity: 3.2, color: new THREE.Color('#ff6ad8'), distance: 2.6, priority: i === 1 ? 1 : 0 });
  }
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-5.05, zB), new THREE.Vector2(4.25, zB + 1.75)));
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(-2.1, 0, zB + 2.25), rotation: Math.PI, clip: 'Working_C' });
  ctx.room.points.push({ id: 'watering', type: 'hobby', pos: new THREE.Vector3(1.3, 0, zB + 2.2), rotation: Math.PI, clip: 'Holding_A', utensil: 'wateringCan', gesture: { clip: 'Interact', every: 4 } });
  // la pieza: los bancales. Se riega (las plantas se mecen), se cosecha o se mira una hoja con la lupa
  const wiggle = [0, 0, 0];
  for (const [id, i, dx] of [['bancal', 1, -0.55], ['bancal-2', 0, 0.75]] as const) ctx.room.points.push({ id, type: 'piece', pos: new THREE.Vector3(XB[i] + dx, 0, zB + 2.0), rotation: Math.PI,
    actions: [{ clip: 'Use_Item', utensil: 'wateringCan', onMake: () => { wiggle[i] = 1.5; } }, { clip: 'PickUp', onMake: () => { wiggle[i] = 0.8; } }, { clip: 'Holding_A', utensil: 'magnifier', dur: 4 }] });
  // el puesto de control del cultivo, a la derecha, casi de perfil: mesa con el monitor de riego y la libreta
  const pWatering = new PhosphorScreen(384, 256, v.screen, t('world.leisure.watering')); pWatering.speed = 22; ctx.room.screens.push(pWatering);
  await workStation(ctx, { x: 5.2, z: -0.55, rotation: -1.3, tex: pWatering.tex, brightness: 1.0,
    onTop: [{ path: R.tools('journal_open'), x: 0.55, z: 0.2, c: { scale: K * 0.42, rot: 0.3 } }, { path: R.furniture('cactus_small_B'), x: -0.72, z: -0.15, c: { scale: K * 0.7 } }] });
  // depósito de agua, sacos y cestas de cosecha (en el rincón izquierdo, fuera del pasillo)
  P(R.base('water_storage'), { pos: [-5.45, 0, zB + 0.55], scale: K * 0.55 });
  for (const x of [-2.07, 1.27]) P(R.sf('Details_Pipes_Medium'), { pos: [x, 2.9, zB + 0.4], height: 1.0, shadow: false });
  P(R.resource('Food_Crate_Small_Empty'), { pos: [-5.4, 0, 1.0], scale: K * 0.8, rot: 0.3 });
  P(R.resource('Food_Basket_A_Berries'), { pos: [3.45, 0, 1.2], scale: K * 0.8, rot: -0.4 });
  P(R.tools('bucket_metal'), { pos: [-4.85, 0, 1.25], scale: K * 0.6 });
  ctx.restsOn(null, R.tools('trowel'), { pos: [-5.15, 0, 1.45], scale: K * 0.6, ...lying(0.7) });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, 0.6), new THREE.Vector2(-4.5, 1.7)));
  signInWall(g, sign(t('world.poster.farming'), t('world.poster.farmingFoot'), '#d6ecc8', '#2c4f2a', 'hand', seed), -5.2, 2.6, 0.56, 0.78, zB + 0.33, 0.03);
  const panel = new PanelRoom(); panel.title = 'CULTIVOS'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 1.6, 1.0, 1.1, seed);
  ctx.room.walkZones = [[-1.4, 0.8], [2.4, 3.6]];
  ctx.vapor = { pos: new THREE.Vector3(-4.6, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };
  ctx.lamps = [{ x: -3.75, z: 0.9, o: { intensity: 60 } }, { x: -0.4, z: 0.9, o: { intensity: 70, shadow: true } }, { x: 3.2, z: 0.9, o: { intensity: 60, goal: [4.2, -0.2] } }];
  (ctx.room.userData as any).planters = planters;
  // replantar con otra especie: se cargan sus cuatro fases en los mismos huecos
  const changeSpecies = (i: number, especie: string) => {
    const b = planters[i]; b.especie = especie;
    b.floors.forEach((group, k) => {
      for (const o of [...group.children]) group.remove(o);
      for (let f = 1; f <= 4; f++) place(group, R.crop(`${especie}_${f}`), { height: (CROP_HEIGHT[especie] ?? 0.5) * [0.35, 0.6, 0.85, 1][f - 1], isStatic: false }).then(o => { o.userData.phase = f; o.visible = f === 1; o.rotation.y = k * 1.3; });
    });
  };
  ctx.onUpdate(() => {
    const cultivos: any[] = live.get().state?.jugador?.cultivos ?? [];
    phases.forEach((floors, i) => {
      // sin partida aún, cada bancal enseña una fase distinta para que se lea qué es la sala
      const c = cultivos[i];
      const phase = c ? Math.min(4, Math.max(2, c.phase ?? 1)) : [3, 4, 2][i] ?? 3;   // recién plantado ya asoma: nunca un bancal vacío
      if (c && c.especie !== planters[i].especie) changeSpecies(i, c.especie);
      for (const pl of floors) pl.children.forEach(o => { o.visible = o.userData.phase === phase; });
    });
    // las plantas que se riegan o se cosechan se mecen un momento
    const t = performance.now() / 1000;
    phases.forEach((floors, i) => { if (wiggle[i] <= 0) return; wiggle[i] = Math.max(0, wiggle[i] - 1 / 60); floors.forEach((pl, k) => { pl.rotation.z = Math.sin(t * 9 + k) * 0.08 * wiggle[i]; }); });
  });
}

// ---------------------------------------------------------------- galería de tiro
export async function furnishGallery(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  switchOffWalls(g, 0.58, 0.7);   // la galería es un sótano de tiro, no un escaparate: la luz cae en las calles
  await highBand(ctx, { timer: 5.1, valves: [-4.8], segments: [[-2.0, 7.4]] });
  // dianas sobre raíles al fondo (escudos redondos de colores como blancos) y mostrador delante
  // cada diana cuelga de su carro en el raíl del techo por una varilla que llega a su eje (el centro del escudo): cuando
  // se mueve por la calle, carro y varilla van con ella; al acertarle, el escudo gira sobre su eje (ver shootingGallery.ts)
  const targets: THREE.Object3D[] = [], rods: THREE.Object3D[] = [];
  const rail = await place(g, R.cy('Rail_Long'), { pos: [0, 2.7, zB + 0.75], width: 9.5 });
  const yRail = new THREE.Box3().setFromObject(rail).min.y, yAxis = 1.37;
  // el raíl, colgado del techo por tres soportes (no flota)
  { const railUp = new THREE.Box3().setFromObject(rail).max.y;
    for (const x of [-4.2, 0, 4.2]) P(R.cy('Support_Short'), { pos: [x, HEIGHT, zB + 0.75], height: HEIGHT - railUp + 0.02, anchor: 'ceiling', shadow: false }); }
  for (const [i, x] of [-3.6, -1.2, 1.2, 3.6].entries()) {
    const d = await place(g, R.acc(i % 2 ? 'shield_round_color' : 'shield_round_barbarian'), { pos: [x, yAxis, zB + 0.8], scale: K * 1.0, anchor: 'center', isStatic: false, own: true });
    targets.push(d);
    const rod = new THREE.Group(); rod.position.x = x; rod.userData.isStatic = false; g.add(rod);
    rod.add(box(0.035, yRail - yAxis, 0.035, materialSteel('#3a3833'), 0, (yRail + yAxis) / 2, zB + 0.74));
    rod.add(box(0.16, 0.08, 0.12, materialSteel('#26241f'), 0, yRail - 0.04, zB + 0.74));   // el carro
    rods.push(rod);
  }
  // barra de tiro a lo ancho con separadores entre calles, panel de armas colgadas en la pared y munición
  // calles de tiro: cuatro tramos de barra entre los tiradores y las dianas (detrás de quien dispara, no delante),
  // con separadores y una anilla de latón por calle
  const benches: Promise<THREE.Object3D>[] = [];
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    // banco de tiro: mueble de frente macizo con puertas (el mostrador del pack de cocina, de poco fondo),
    // en madera oscura y gastada, y su caja de munición encima
    const workbench = place(g, R.kitchen('kitchencounter_straight_B'), { pos: [x, 0, -0.62], width: 1.85, own: true }).then(o => {
      o.scale.z *= 0.33; o.scale.y *= 0.92;
      o.traverse((n: any) => { if (n.isMesh) { n.material.color.multiplyScalar(0.4).lerp(new THREE.Color('#4a2e1e'), 0.55); n.material.roughness = 0.85; } });
      return o;
    });
    benches.push(workbench); ctx.device('tiro', workbench);
    ctx.restsOn(workbench, R.acc('ammo_crate'), { pos: [x + 0.6, 0, -0.62], scale: K * 0.78, rot: 0.25 });
    // número de calle pintado en el frente del banco (en el pack no hay rótulos: es pintura sobre la chapa)
    const { c: cn, g: gn } = canvas(128, 128); gn.fillStyle = '#d9a52b'; gn.beginPath(); gn.arc(64, 64, 58, 0, Math.PI * 2); gn.fill();
    gn.fillStyle = '#1c1a17'; gn.font = `900 84px ${SOURCES.title}`; gn.textAlign = 'center'; gn.textBaseline = 'middle'; gn.fillText(String([-3.6, -1.2, 1.2, 3.6].indexOf(x) + 1), 64, 70);
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshStandardMaterial({ map: textureOf(cn), roughness: 0.7 }));
    num.position.set(x - 0.55, 0.62, -0.62 + 0.315); g.add(num);
  }
  // separadores de calle altos, de acero, con su anilla de latón
  // mamparas de calle: placas del pack sci-fi de pie entre bancos, con franja de peligro
  for (const x of [-2.4, 0, 2.4]) {
    P(R.sf('Details_Plate_Long'), { pos: [x, 0, -0.55], height: 1.5, rot: Math.PI / 2, variant: v });
    g.add(box(0.07, 0.08, 0.7, materialSteel('#c99a2e'), x, 1.55, -0.55));
  }
  const panelWeapons = box(1.3, 0.9, 0.05, materialSteel('#2e2b28'), -5.0, 1.75, zB + 0.36); g.add(panelWeapons);
  // contraluz cálido tras el panel: las siluetas de las armas se leen aunque no le toque una luz del reparto
  const backlight = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb060').multiplyScalar(0.55), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  backlight.position.set(-5.0, 1.75, zB + 0.34); g.add(backlight);
  P(R.sv('Revolver_1'), { pos: [-5.3, 1.95, zB + 0.42], height: 0.36, rotX: Math.PI / 2, rotZ: 0.2 });
  P(R.sv('Pistol_2'), { pos: [-4.7, 1.95, zB + 0.42], height: 0.36, rotX: Math.PI / 2, rotZ: -0.2 });
  P(R.sv('Shotgun_1'), { pos: [-5.0, 1.45, zB + 0.42], width: 1.15, rotX: Math.PI / 2 });
  // la luz del armero: una puntual propia delante del panel (el reparto se la da: prioridad alta)
  ctx.restsOn(benches[0], R.home('Light_Desk'), { pos: [-3.1, 0, -0.65], height: 0.4, rot: 2.5 });
  const ammoBox = P(R.acc('ammo_crate_withLid'), { pos: [5.3, 0, zB + 0.55], scale: K * 1.1, rot: -0.3 });
  ctx.restsOn(ammoBox, R.acc('ammo_crate'), { pos: [5.3, 0, zB + 0.55], scale: K * 0.95, rot: -0.6 });
  // el puesto del encargado de la galería, casi de perfil contra la pared derecha: mesa con el monitor de récords
  const pRecords = new PhosphorScreen(384, 256, v.screen, t('world.leisure.records')); pRecords.speed = 20; ctx.room.screens.push(pRecords);
  await workStation(ctx, { x: 5.25, z: 0.25, rotation: -1.35, tex: pRecords.tex, brightness: 1.0,
    onTop: [{ path: R.sv('Pistol_2'), x: 0.55, z: 0.25, c: { height: 0.1, rotX: -Math.PI / 2, rotZ: 0.5 } }, { path: R.acc('arrow_crossbow'), x: -0.6, z: 0.2, c: { scale: 0.8, rot: 0.3 } }] });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(4.8, zB), new THREE.Vector2(6, zB + 1.15)));
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-4.7, -0.95), new THREE.Vector2(4.7, -0.15)), new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(6, zB + 0.6)));
  ctx.room.anchors.push({ type: 'point', pos: new THREE.Vector3(-5.0, 2.2, zB + 0.9), intensity: 12, color: new THREE.Color('#ffd9a0'), distance: 2.4, priority: 2 });
  // la tiradora tira de perfil, cruzando su calle, a una diana de práctica de pie: desde la cámara del corte se lee
  // (las dianas del fondo son las del juego de tiro del jugador). Cada disparo, un virote vuela y se queda clavado.
  const XT = 2.08, YT = 1.0, ZT = 0.3;
  g.add(box(0.06, YT - 0.2, 0.06, materialSteel('#3a3833'), XT, (YT - 0.2) / 2, ZT));
  g.add(box(0.5, 0.05, 0.3, materialSteel('#3a3833'), XT, 0.025, ZT));
  const practice = await place(g, R.acc('shield_round_color'), { pos: [XT, YT - 0.46, ZT], scale: K * 1.1, rot: -0.55, isStatic: false, own: true });
  const bolt = await place(g, R.acc('arrow_crossbow'), { pos: [0, 0, 0], scale: 0.9, rot: Math.PI / 2, anchor: 'center', isStatic: false });
  bolt.visible = false;
  let flight = -1, nailed = 0, trembles = 0, wait = 0;
  const XD = 0.85;   // la boca de la ballesta
  ctx.onUpdate(dt => {
    if (wait > 0) { wait -= dt; if (wait <= 0) flight = 0; }
    if (flight >= 0) {
      flight += dt / 0.22; const k = Math.min(1, flight);
      bolt.visible = true; bolt.position.set(XD + (XT - 0.12 - XD) * k, 0.9 - 0.04 * k, ZT - 0.05);
      if (flight >= 1) { flight = -1; nailed = 1.4; trembles = 0.5; SFX.white(); }
    } else if (nailed > 0) { nailed -= dt; if (nailed <= 0) bolt.visible = false; }
    if (trembles > 0) { trembles -= dt; practice.rotation.z = Math.sin(trembles * 60) * trembles * 0.25; } else practice.rotation.z = 0;
  });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(XT - 0.3, ZT - 0.25), new THREE.Vector2(XT + 0.3, ZT + 0.25)));
  // la pieza: la diana de práctica. Se arranca el virote clavado, se recoloca la diana (tiembla) o se miran los impactos
  // de cerca
  ctx.room.points.push({ id: 'diana', type: 'piece', pos: new THREE.Vector3(XT + 0.55, 0, ZT + 0.5), rotation: Math.atan2(-0.55, -0.5),
    actions: [{ clip: 'PickUp', onMake: () => { nailed = 0; bolt.visible = false; trembles = 0.3; } }, { clip: 'Interact', onMake: () => { trembles = 0.5; } }, { clip: 'Holding_A', utensil: 'magnifier', dur: 3 }] });
  ctx.room.points.push({ id: 'tirador', type: 'hobby', pos: new THREE.Vector3(0.58, 0, ZT), rotation: Math.PI / 2, clip: 'Ranged_1H_Aiming', utensil: 'ballesta',
    gesture: { clip: 'Ranged_1H_Shooting', every: 2.6, onMake: () => { wait = 0.2; nailed = 0; setTimeout(() => SFX.shot(0.35), 200); } } });   // el virote sale cuando el clip suelta la cuerda
  signInWall(g, sign(t('world.poster.shooting'), t('world.poster.shootingFoot'), '#ead2c8', '#5e2423', 'eye', seed), 5.0, 2.7, 0.56, 0.78, zB + 0.33, -0.03);
  const panel = new PanelRoom(); panel.title = 'RÉCORDS'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 0, 1.2, 1.4, seed);
  ctx.room.walkZones = [[-2.0, 2.4]];
  ctx.lamps = [{ x: -2.4, z: 0.2, o: { intensity: 85, goal: [-2.4, -1.4] } }, { x: 0, z: 1.0, o: { intensity: 90, shadow: true } }, { x: 2.4, z: 0.2, o: { intensity: 85, goal: [2.4, -1.4] } }];
  (ctx.room.userData as any).targets = targets;
  let signatureRecords = '';
  ctx.onUpdate((dt, t) => {
    targets.forEach((d, i) => { if (!d.userData.fall) d.position.x = [-3.6, -1.2, 1.2, 3.6][i] + Math.sin(t * (0.6 + i * 0.13) + i) * 0.35; rods[i].position.x = d.position.x; });

    const r = live.get().state?.jugador?.records ?? {};
    const records = [tr('world.leisure.shootingPoints', { n: r.tiro ?? 0 }), tr('world.leisure.radioSignals', { n: r.radio ?? 0 }), tr('world.leisure.harvest', { n: r.cosecha ?? 0 })];
    panel.lines = records.map(x => '> ' + x);
    const fr = panel.lines.join('|'); if (fr !== signatureRecords) { signatureRecords = fr; pRecords.lines = []; pRecords.queue = []; pRecords.write(records); }
  });
}
