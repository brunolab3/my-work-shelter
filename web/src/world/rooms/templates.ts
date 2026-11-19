// Plantillas de las salas de recluta: cada tipo de repo con su silueta y su pieza protagonista (solo modelos del pack).
// - fundición (Rust, Go): forja de ladrillo con campana y chimenea, yunque sobre tocón, crisol, tina de temple.
// - laboratorio (Python): terrario de cristal, mesa de pruebas con fregadero e invernadero de bandejas.
// - estudio (web, Node): rack de servidores con pilotos y rincón con sofá.
// - archivo (carpeta sin git o sin tipo): estantería alta de cajas, fichero y mesa de consulta.
// The middle third is the work zone (WORK_ZONE in shared/decor.ts): the dweller's desk (centralDesk) under the task
// board (taskBoard.ts); each scene lives on the two sides. The only other screen is the desk's. Todas se espejan con la semilla.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom } from '../../engine/textures';
import { signInWall, stain, highBand, mountPilots, screenReal, switchOffWalls, centralDesk, lean, center, lying, HEIGHT, type Context } from './common';

export type Template = 'fundicion' | 'laboratorio' | 'estudio' | 'archivo' | 'banco';

// (qué plantilla le toca a cada repo según su tipo: plantillaDe, en shared/decor.ts)
export const TEMPLATE_SUBTITLE: Record<Template, string> = { fundicion: 'FUNDICIÓN', laboratorio: 'LABORATORIO', estudio: 'ESTUDIO', archivo: 'ARCHIVO', banco: 'TALLER' };
export const TEMPLATE_PANELS: Record<Template, string[]> = {
  fundicion: ['Wall_5', 'Wall_Empty', 'Wall_5'], laboratorio: ['Wall_2', 'Wall_1', 'Wall_4'],
  estudio: ['Wall_4', 'Wall_3', 'Wall_1'], archivo: ['Wall_3', 'Wall_5', 'Wall_1'], banco: ['Wall_4', 'Wall_1', 'Wall_3'],
};

// espejo por semilla: todo se escribe para el lado «normal» y se refleja en X
function mirror(ctx: Context) {
  const s = ctx.seed % 2 ? 1 : -1;
  const X = (x: number) => x * s;
  const obstacle = (x0: number, z0: number, x1: number, z1: number) => ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(x0), X(x1)), Math.min(z0, z1)), new THREE.Vector2(Math.max(X(x0), X(x1)), Math.max(z0, z1))));
  const segment = (a: number, b: number): [number, number] => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
  const point = (id: string, type: any, x: number, y: number, z: number, rotation: number, extra: Record<string, unknown> = {}) => ctx.room.points.push({ id, type, pos: new THREE.Vector3(X(x), y, z), rotation: rotation * s, ...extra } as any);
  return { s, X, obstacle, segment, point };
}

const tint = (o: THREE.Object3D, f: (m: THREE.MeshStandardMaterial, n: THREE.Mesh) => void) => o.traverse((n: any) => { if (n.isMesh) for (const m of [].concat(n.material)) f(m as THREE.MeshStandardMaterial, n); });

// ======================================================================== FUNDICIÓN (Rust, Go)
export async function furnishFoundry(ctx: Context) {
  const { g, zB, K, P, seed } = ctx; const { s, X, obstacle, segment, point } = mirror(ctx);
  await highBand(ctx, { gauge: X(-4.7), valves: [X(-3.3)], segments: [[X(-4.1), 3.6]] });
  // ---- RIGHT: the forge. Brick hearth, fire, crucible on top and the hood with its flue up to the ceiling
  const fx = 3.55, fz = zB + 1.0;
  // ladrillo refractario: el mismo modelo de piedra, tostado por el fuego; el fuego y el crisol, apoyados encima
  const isHome: THREE.Object3D[] = [];
  for (const dx of [-0.57, 0.57]) isHome.push(await place(g, R.resource('Stone_Bricks_Stack_Large'), { pos: [X(fx + dx), 0, fz], height: 0.92, own: true, variant: ctx.v }));
  for (const o of isHome) tint(o, m => m.color.multiply(new THREE.Color(0.78, 0.5, 0.38)));
  const fire = lean(await place(g, R.sv('Bonfire_Fire'), { pos: [X(fx - 0.3), 0, fz + 0.05], width: 0.95, own: true, isStatic: false, shadow: false }), isHome[0]);
  const flames: THREE.MeshStandardMaterial[] = [];
  tint(fire, m => { if (m.name === 'Fire') { m.emissive = new THREE.Color('#ff7a1a'); m.emissiveIntensity = 2.2; m.toneMapped = true; flames.push(m); } });
  const crucible = lean(await place(g, R.sv('Pot'), { pos: [X(fx + 0.68), 0, fz + 0.05], height: 0.42, rot: X(0.5), variant: ctx.v }), isHome[1]);
  const cCrucible = new THREE.Box3().setFromObject(crucible);
  const pour = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ff8a2a', emissiveIntensity: 2.4 }));
  pour.rotation.x = -Math.PI / 2; pour.position.set(X(fx + 0.68), cCrucible.max.y - 0.05, fz + 0.05); pour.userData.isStatic = false; g.add(pour);
  P(R.kitchen('extractorhood'), { pos: [X(fx), 2.0, zB + 0.3], width: 2.4, anchor: 'atras', own: true }).then(o => { o.scale.z *= 0.62; tint(o, m => { m.color.multiplyScalar(0.62); m.metalness = 0.55; m.roughness = 0.45; }); });
  P(R.tools('tongs'), { pos: [X(fx + 1.3), 0, fz + 0.62], height: 0.95, rotZ: X(-0.22) });
  P(R.tools('shovel'), { pos: [X(fx - 1.3), 0, fz + 0.62], height: 1.2, rotZ: X(0.2), rot: X(0.3) });
  obstacle(fx - 1.45, zB, fx + 1.45, zB + 1.75);
  // ---- LEFT, in front: the anvil on its stump, and the smith beside it (three-quarters)
  const ax = -2.65, az = -0.1;
  // el tocón (un tronco puesto de pie, en el suelo) y el yunque encima, apoyado de verdad; el martillo, tumbado en el suelo
  const stump = lean(center(await place(g, R.resource('Wood_Log_A'), { pos: [X(ax), 0, az], scale: 0.6, rotX: Math.PI / 2, variant: ctx.v }), X(ax), az), null);
  ctx.restsOn(stump, R.tools('anvil'), { pos: [X(ax), 0, az], scale: 0.42, rot: X(0.12) });
  ctx.restsOn(null, R.tools('hammer'), { pos: [X(ax - 0.3), 0, az + 0.55], scale: K * 0.6, ...lying(X(0.8)) });
  obstacle(ax - 0.4, az - 0.35, ax + 0.4, az + 0.35);
  const spark = new THREE.Vector3(X(ax), 1.0, az);
  point('yunque', 'aficion', ax - 0.82, 0, az + 0.05, 1.15, { clip: 'Hammering', utensil: 'martillo', gesture: { clip: 'Hammering', every: 2.4, onMake: () => ctx.room.effects?.sparks.burst(spark, 12) } });
  // ---- tina de temple (con vapor que sube de ella, lejos de la pantalla)
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.33, 20), new THREE.MeshStandardMaterial({ color: '#1b2a2c', roughness: 0.15, metalness: 0.6 }));
  water.rotation.x = -Math.PI / 2; water.position.set(X(5.45), 0.72, zB + 0.75); g.add(water);
  ctx.P(R.resource('Food_Barrel_Empty'), { pos: [X(5.45), 0, zB + 0.75], height: 0.8 }).then(o => { water.position.y = new THREE.Box3().setFromObject(o).max.y - 0.08; });
  obstacle(5.05, zB, 6, zB + 1.2);
  // ---- MIDDLE: the master founder's desk, under the task board
  const pFoundry = new PhosphorScreen(256, 320, ctx.v.screen, tr('world.tpl.batch')); pFoundry.speed = 24;
  screenReal(ctx, pFoundry, 'actividad'); ctx.room.screens.push(pFoundry);
  await centralDesk(ctx, { screen: 'ordenador', tex: pFoundry.tex, chair: R.furniture('chair_desk_B'),
    onTop: [{ path: R.tools('chisel'), x: -0.62, z: 0.25, c: { scale: K * 0.6, ...lying(0.4) } }, { path: R.tools('file'), x: 0.55, z: 0.3, c: { scale: K * 0.6, ...lying(-0.3) } },
      { path: R.resource('Iron_Bars'), x: 0.65, z: -0.2, c: { scale: K * 0.45, rot: 0.2 } }, { path: R.tools('lantern'), x: -0.68, z: -0.3, c: { scale: K * 0.45 } }] });
  // ---- IZQUIERDA: lingotes, mineral, piedra de afilar y botellas de gas contra la pared
  P(R.resource('Iron_Bars_Stack_Large'), { pos: [X(-5.35), 0, zB + 0.62], height: 0.78 });
  P(R.resource('Copper_Bars_Stack_Medium'), { pos: [X(-5.55), 0, zB + 1.45], height: 0.95 });
  P(R.tools('grindstone'), { pos: [X(-4.25), 0, zB + 0.95], width: 1.25, rot: X(0.35) });
  P(R.cy('Tank'), { pos: [X(-3.55), 0, zB + 0.42], height: 1.25 });
  P(R.sf('Details_Pipes_Long'), { pos: [X(-3.0), 0.9, zB + 0.34], height: 1.8, shadow: false });
  obstacle(-6, zB, -3.3, zB + 1.8);
  point('consola', 'consola', -3.35, 0, zB + 2.05, -2.3, { clip: 'Working_A' });   // afilando (lejos de la pantalla: la etiqueta no la tapa)
  P(R.resource('Iron_Nuggets'), { pos: [X(-2.2), 0, 0.9], scale: K * 0.55, rot: 0.8 });
  P(R.tools('bucket_metal'), { pos: [X(-2.75), 0, 1.15], scale: K * 0.5 });
  // la pieza: la forja. Se atiza el fuego (chispas y llamarada), se le da al fuelle o se coge un lingote del montón
  let flare = 0;
  const forgeMouth = new THREE.Vector3(X(fx - 0.3), 1.2, fz + 0.15);
  const poke = () => { flare = 1; ctx.room.effects?.sparks.burst(forgeMouth, 22); };
  point('forja', 'pieza', fx - 0.3, 0, zB + 2.05, Math.PI, { actions: [{ clip: 'Use_Item', onMake: poke }, { clip: 'Interact', onMake: poke }, { clip: 'PickUp' }] });
  point('crisol', 'pieza', fx + 0.85, 0, zB + 2.05, Math.PI + 0.3, { actions: [{ clip: 'Working_B', onMake: poke }, { clip: 'Interact' }] });
  signInWall(g, sign(t('world.poster.foundry'), t('world.poster.foundryFoot'), '#e6d2b0', '#6b2a14', 'rayo', seed + 3), X(-5.15), 2.45, 0.56, 0.78, zB + 0.33, 0.03 * s);
  stain(g, X(fx), 0.2, 1.6, seed); stain(g, X(ax), 0.4, 0.9, seed + 2);
  const panel = new PanelRoom(); panel.title = 'FUNDICIÓN'; panel.color = ctx.v.screen; ctx.panel = panel;
  ctx.room.walkZones = [segment(-1.8, -1.2), segment(1.2, 1.8)];
  ctx.vapor = { pos: new THREE.Vector3(X(5.45), 0.8, zB + 0.75), dir: new THREE.Vector3(-0.3 * s, 0.9, 0.2) };
  ctx.sparks = spark;
  ctx.lamps = [{ x: X(-4.3), z: 0.45, o: { intensity: 60, goal: [X(-4.3), -1.2] } }, { x: 0, z: 0.4, o: { intensity: 55, shadow: true, corta: true, goal: [0, -0.9] } }, { x: X(fx), z: 0.8, o: { intensity: 55, goal: [X(fx), -0.9] } }];
  // el fuego ilumina la forja y late con la actividad
  const anchor = { type: 'punto' as const, pos: new THREE.Vector3(X(fx - 0.2), 1.5, fz + 0.6), intensity: 3.5, color: new THREE.Color('#ff7a2a'), distance: 4, priority: 2 };   // la fragua alumbra la sala, no quema a quien trabaja al lado
  ctx.room.anchors.push(anchor);
  ctx.onUpdate((dt, t, a) => {
    const flicker = Math.sin(t * 11) * 0.35 + Math.sin(t * 4.3) * 0.5 + Math.sin(t * 23) * 0.15;
    flare = Math.max(0, flare - dt * 0.8);
    anchor.intensity = 3 + a * 2.2 + flicker * 0.8 + flare * 3;
    for (const m of flames) m.emissiveIntensity = 2 + a * 1.2 + flicker * 0.4 + flare * 1.5;
    fire.scale.y = 1 + flicker * 0.04 + flare * 0.35;
  });
}

// ======================================================================== LABORATORIO (Python)
export async function furnishLaboratory(ctx: Context) {
  const { g, zB, K, P, seed } = ctx; const { s, X, obstacle, segment, point } = mirror(ctx);
  switchOffWalls(g, 0.62, 0.75);
  // el blanco de catálogo (fregadero, estantería, bombona) a gris de laboratorio usado: quemaba bajo las lámparas
  const gray = (o: THREE.Object3D) => tint(o, m => { m.color.multiplyScalar(0.55); m.roughness = Math.max(m.roughness ?? 0.5, 0.75); });
  await highBand(ctx, { gauge: X(4.9), valves: [X(3.1)], segments: [[X(3.9), 3.6]] });
  // ---- RIGHT: the terrarium (glass eco module with trees), with watering cables coming down from the ceiling
  const tx = 3.7, tz = -0.85;
  const terrarium = await place(g, R.base('eco_module'), { pos: [X(tx), 0, tz], height: 2.3, own: true, isStatic: false });
  tint(terrarium, m => { if (m.name === 'Glass') { m.opacity = 0.28; m.color = new THREE.Color('#bfe6dd'); m.roughness = 0.05; } else if (m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.6) m.color.multiplyScalar(0.6); });
  for (const dx of [-0.45, 0.45]) P(R.cy('Cable_Thick'), { pos: [X(tx + dx), HEIGHT, tz - 0.2], height: 2.05, anchor: 'techo', shadow: false });
  obstacle(tx - 1.25, zB, tx + 1.25, tz + 1.2);
  // the terrarium's seed store: a sample capsule with green liquid and a crate of seedlings beside it
  P(R.sf('Props_Capsule'), { pos: [X(5.5), 0, zB + 0.55], height: 1.45, rot: X(-0.25), own: true }).then(o => tint(o, m => { if (m.color.getHSL({ h: 0, s: 0, l: 0 }).l > 0.6) m.color.multiplyScalar(0.6); }));
  P(R.resource('Food_Crate_Small_Berries'), { pos: [X(5.45), 0, zB + 1.2], scale: K * 0.6, rot: 0.3 });
  obstacle(5.05, zB, 6, zB + 1.55);
  point('terrario', 'aficion', tx + 1.45, 0, tz + 0.55, -1.25, { clip: 'Holding_A', utensil: 'lupa', gesture: { clip: 'Interact', every: 4.5 } });
  // la pieza: el terrario. Se mira con la lupa, se toca el cristal o se riega por la boca de arriba (sube el vaho y la
  // luz de dentro se aviva)
  let watering = 0; const water = () => { watering = 1; };
  const terrariumToward = (x: number, z: number) => Math.atan2(tx - x, tz - z);
  point('terrario-frente', 'pieza', tx - 0.55, 0, tz + 1.5, terrariumToward(tx - 0.55, tz + 1.5), { actions: [{ clip: 'Holding_A', utensil: 'lupa', dur: 4 }, { clip: 'Interact', onMake: water }, { clip: 'Use_Item', utensil: 'regadera', onMake: water }] });
  // ---- IZQUIERDA: mesa de pruebas con fregadero, frascos y pociones; encima, el cuaderno de experimentos (repo)
  const bx = -3.75;
  const sink = P(R.kitchen('kitchentable_sink_large'), { pos: [X(bx), 0, zB + 1.05], scale: K * 0.95, own: true });
  sink.then(gray);
  ctx.restsOn(sink, R.acc('potion_large_green'), { pos: [X(bx - 0.75), 0, zB + 1.15], height: 0.32 });
  ctx.restsOn(sink, R.acc('potion_medium_blue'), { pos: [X(bx - 0.45), 0, zB + 1.3], height: 0.24 });
  ctx.restsOn(sink, R.kitchen('jar_B_medium'), { pos: [X(bx + 0.6), 0, zB + 0.95], height: 0.3 });
  ctx.restsOn(sink, R.kitchen('jar_C_small'), { pos: [X(bx + 0.85), 0, zB + 1.2], height: 0.2 });
  ctx.restsOn(sink, R.tools('journal_open'), { pos: [X(bx + 0.4), 0, zB + 1.4], scale: K * 0.42, rot: X(-0.2) });
  ctx.restsOn(sink, R.tools('magnifying_glass'), { pos: [X(bx + 0.95), 0, zB + 1.5], scale: K * 0.45, ...lying(0.6) });
  obstacle(bx - 1.3, zB, bx + 1.3, zB + 1.9);
  point('consola', 'consola', bx + 1.85, 0, zB + 1.45, -1.2, { clip: 'Working_C' });
  // estantería estrecha de reactivos en la esquina
  const reactive = P(R.home('Shelf_1'), { pos: [X(-5.55), 0, zB + 0.55], height: 2.9, own: true });
  reactive.then(gray);
  // baldas a 0,61 / 1,18 / 1,76 / 2,33 (Shelf_1 de 2,9 m): cada frasco, en la suya
  for (const [path, height, y] of [[R.acc('potion_huge_orange'), 0.34, 1.0], [R.kitchen('jar_A_large'), 0.36, 1.6], [R.acc('potion_large_red'), 0.3, 2.15], [R.kitchen('jar_D_medium'), 0.3, 2.7]] as const)
    ctx.restsOn(reactive, path, { pos: [X(-5.55), 0, zB + 0.55], height }, { since: y });
  obstacle(-6, zB, -5.1, zB + 1.0);
  // ---- MIDDLE: the desk (with the test growing tray on it), under the task board
  const pLab = new PhosphorScreen(384, 256, ctx.v.screen, ' pytest'); pLab.speed = 28;
  screenReal(ctx, pLab, 'cambios'); ctx.room.screens.push(pLab);
  await centralDesk(ctx, { tex: pLab.tex,
    onTop: [{ path: R.base('space_farm_small'), x: -0.62, z: -0.15, c: { height: 0.36 } }, { path: R.acc('potion_small_green'), x: 0.75, z: 0.0, c: { height: 0.18 } }] });
  P(R.sv('PropaneTank'), { pos: [X(-2.2), 0, zB + 0.5], height: 1.35, own: true }).then(gray);
  P(R.home('Houseplant_7'), { pos: [X(5.45), 0, -0.4], height: 0.85, rot: 0.6 });
  obstacle(5.0, -0.75, 6, -0.05);
  signInWall(g, sign(t('world.poster.laboratory'), t('world.poster.laboratoryFoot'), '#dfe9d6', '#25472f', 'ojo', seed + 5), X(5.25), 2.55, 0.56, 0.78, zB + 0.33, -0.02 * s);
  signInWall(g, sign(t('world.poster.rule20'), t('world.poster.rule20Foot'), '#e8e1c8', '#2f3b52', 'engranaje', seed + 9), X(2.45), 2.6, 0.5, 0.62, zB + 0.33, 0.03 * s);
  // ---- floor: sample crate and bucket by the side wall, behind the front corner (the room panel's)
  P(R.resource('Containers_Crate_Small_Green'), { pos: [X(-5.4), 0, -0.6], scale: K * 0.7, rot: 0.4 });
  P(R.tools('bucket_metal'), { pos: [X(-4.9), 0, -0.15], scale: K * 0.5 });
  obstacle(-6, -1.0, -4.6, 0.05);
  stain(g, X(tx - 1.0), 0.7, 1.3, seed);
  const panel = new PanelRoom(); panel.title = 'LABORATORIO'; panel.color = ctx.v.screen; ctx.panel = panel;
  ctx.room.walkZones = [segment(-1.8, -1.2), segment(1.2, 1.8)];
  ctx.vapor = { pos: new THREE.Vector3(X(tx), 2.3, tz), dir: new THREE.Vector3(0.1 * s, 1, 0.1) };
  ctx.lamps = [{ x: X(bx + 1.45), z: 0.6, o: { intensity: 50, corta: true, goal: [X(bx + 0.6), -0.9] } }, { x: 0, z: 0.4, o: { intensity: 55, color: '#e6ffd8', corta: true, goal: [0, -0.6] } }, { x: X(tx), z: 0.9, o: { intensity: 55, shadow: true, goal: [X(tx), 0.2] } }];
  const anchor = { type: 'punto' as const, pos: new THREE.Vector3(X(tx), 1.2, tz + 0.4), intensity: 3, color: new THREE.Color('#7dffc0'), distance: 4.5, priority: 2 };
  ctx.room.anchors.push(anchor);
  ctx.onUpdate((dt, t, a) => {
    watering = Math.max(0, watering - dt * 0.5);
    anchor.intensity = 2.6 + a * 2.4 + watering * 2.5 + Math.sin(t * 1.3) * 0.3;
  });
}

// ======================================================================== ESTUDIO (web, Node)
export async function furnishStudio(ctx: Context) {
  const { g, zB, K, P, seed } = ctx; const { s, X, obstacle, segment, point } = mirror(ctx);
  // ---- MIDDLE: the desk, under the task board
  const pStation = new PhosphorScreen(384, 256, ctx.v.screen, ' npm run dev'); pStation.speed = 30;
  screenReal(ctx, pStation, 'actividad'); ctx.room.screens.push(pStation);
  await centralDesk(ctx, { id: 'silla', tex: pStation.tex, chair: R.furniture('chair_desk_B'),
    onTop: [{ path: R.furniture('lamp_desk'), x: -0.8, z: -0.25, c: { scale: K * 0.55, rot: 0.6 } }, { path: R.furniture('mug_A'), x: 0.8, z: 0.15, c: { scale: K * 0.7 } }, { path: R.furniture('cactus_small_A'), x: 0.62, z: -0.28, c: { scale: K * 0.6 } }] });
  // a plant and a crate of cables in the corner, by the rack
  P(R.home('Houseplant_1'), { pos: [X(-5.6), 0, zB + 0.45], height: 1.25 });
  P(R.resource('Containers_Crate_Small_Grey'), { pos: [X(-5.4), 0, zB + 1.2], scale: K * 0.55, rot: 0.4 });
  obstacle(-6, zB, -5.1, zB + 1.5);
  // ---- LEFT: the server rack (three cabinets with pilots, thick cables to the ceiling and the cooling beside it)
  const rx = -3.85;
  const pilots: ((t: number, a: number) => void)[] = [];
  for (const [i, dx] of [-0.72, 0, 0.72].entries()) {
    // each cabinet with its pilot lights (the room's screen is its task board)
    const cabinet = await place(g, R.sf('Props_Computer'), { pos: [X(rx + dx), 0, zB + 0.6], height: 2.35, variant: ctx.v, isStatic: false, own: true });
    tint(cabinet, m => { if (!m.emissiveMap && m.name !== 'Black') { m.color.multiplyScalar(0.7); } });
    pilots.push(mountPilots(g, new THREE.Vector3(X(rx + dx), 0.9 + i * 0.12, zB + 1.02), ctx.v.screen));
    P(R.cy('Cable_Thick'), { pos: [X(rx + dx), HEIGHT, zB + 0.55], height: HEIGHT - 2.35 + 0.05, anchor: 'techo', shadow: false });
  }
  P(R.cy('AC_Stacked'), { pos: [X(rx + 1.4), 0, zB + 0.55], height: 1.25, rot: X(-0.2) });
  P(R.cy('Cable_Long'), { pos: [X(rx - 1.0), 0.02, zB + 1.2], height: 0.12, rot: X(0.6), shadow: false });
  obstacle(rx - 1.1, zB, rx + 1.85, zB + 1.3);
  point('consola', 'consola', rx + 0.0, 0, zB + 1.75, Math.PI + 0.35, { clip: 'Working_A' });
  // la pieza: el rack. Se aprieta una conexión con la llave (los pilotos se disparan), se le da a un armario o se lee
  // de cerca su pantalla
  let burst = 0; const fire = () => { burst = 1.2; };
  point('rack', 'pieza', rx - 0.7, 0, zB + 1.7, Math.PI + 0.15, { actions: [{ clip: 'Working_C', utensil: 'llave', onMake: fire }, { clip: 'Interact', onMake: fire }, { clip: 'Holding_A', utensil: 'lupa', dur: 4 }] });
  point('rack-2', 'pieza', rx + 0.75, 0, zB + 1.7, Math.PI - 0.15, { actions: [{ clip: 'Interact', onMake: fire }, { clip: 'Use_Item', onMake: fire }] });
  // carrito con la consola portátil, a un lado del rack (no delante)
  const cart = P(R.furniture('table_small'), { pos: [X(rx + 1.25), 0, 0.35], scale: K * 0.7 });
  ctx.restsOn(cart, R.furniture('gameconsole_handheld'), { pos: [X(rx + 1.2), 0, 0.35], scale: K * 0.7, rot: 0.4 });
  ctx.restsOn(cart, R.furniture('mug_A'), { pos: [X(rx + 1.45), 0, 0.47], scale: K * 0.7 });
  obstacle(rx + 0.9, 0.0, rx + 1.6, 0.7);
  // ---- DERECHA: rincón de descanso con sofá de cara a cámara, estantería alta y planta
  P(R.furniture('couch_pillows'), { pos: [X(4.45), 0, zB + 0.95], scale: K * 0.85, rot: X(-0.12), own: true }).then(o => tint(o, m => m.color.multiplyScalar(0.62)));   // tapizado apagado: quemaba bajo la lámpara
  point('sofa', 'aficion', 4.1, 0.05, zB + 1.25, -0.12, { clip: 'Sit_Chair_Idle', utensil: 'taza' });
  P(R.furniture('table_low_decorated'), { pos: [X(4.3), 0, zB + 2.0], scale: K * 0.7 });
  const shelf = P(R.home('Shelf_2'), { pos: [X(5.6), 0, zB + 0.5], height: 3.1 });
  // Shelf_2 de 3,1 m: baldas a 0,90 / 1,34 / 1,78 / 2,22 / 2,66; cada cosa, apoyada en la suya
  for (const [k, y] of [1.2, 1.65, 2.1, 2.55].entries()) ctx.restsOn(shelf, R.furniture(k === 2 ? 'cup_pencils' : 'book_set'), { pos: [X(5.6), 0, zB + 0.5], scale: K * (k === 2 ? 0.55 : 0.45), rot: k * 0.5 }, { since: y });
  ctx.restsOn(shelf, R.resource('Containers_Box_Small'), { pos: [X(5.6), 0, zB + 0.5], scale: K * 0.5, rot: 0.3 }, { since: 0.85 });
  P(R.home('Houseplant_5'), { pos: [X(3.05), 0, zB + 0.4], height: 0.95 });
  obstacle(2.7, zB, 6, zB + 2.4);
  signInWall(g, sign(t('world.poster.studio'), t('world.poster.studioFoot'), '#e9e2cc', '#8a2b1c', 'rayo', seed + 11), X(4.35), 2.55, 0.56, 0.74, zB + 0.33, -0.02 * s);
  P(R.sf('Details_Vent_3'), { pos: [X(rx), 3.55, zB + 0.45], width: 1.6, shadow: false });
  stain(g, X(-1.0), 0.9, 1.0, seed);
  const panel = new PanelRoom(); panel.title = 'ESTUDIO'; panel.color = ctx.v.screen; ctx.panel = panel;
  ctx.room.walkZones = [segment(-1.8, -1.2), segment(1.2, 2.4)];
  ctx.vapor = { pos: new THREE.Vector3(X(rx + 1.4), 1.3, zB + 0.6), dir: new THREE.Vector3(0.2 * s, 1, 0.2) };
  ctx.lamps = [{ x: 0, z: 0.6, o: { intensity: 60, corta: true, goal: [0, 0.2] } }, { x: X(rx), z: 0.7, o: { intensity: 55, shadow: true, goal: [X(rx), 0.0] } }, { x: X(4.3), z: 0.5, o: { intensity: 45, goal: [X(4.3), -0.6] } }];
  ctx.onUpdate((dt, t, a) => { burst = Math.max(0, burst - dt); for (const p of pilots) p(t, Math.min(1, a + burst)); });
}

// ======================================================================== ARCHIVO (carpeta sin git, sin tipo, o ala con varios repos)
export async function furnishFile(ctx: Context) {
  const { g, zB, K, P, seed } = ctx; const { s, X, obstacle, segment, point } = mirror(ctx);
  await highBand(ctx, { timer: X(5.35), valves: [X(4.6)], segments: [[X(4.2), 3.0]] });
  // ---- LEFT: the archive's tall shelf, full of boxes (each on its shelf)
  const ex = -3.7;
  const file = P(R.sf('Props_Shelf_Tall'), { pos: [X(ex), 0, zB + 0.75], height: 3.3 });
  const boxes = ['Containers_Box_Medium', 'Containers_Box_Small', 'Containers_Crate_Medium_Tan', 'Containers_Box_Large', 'Containers_Box_Small', 'Containers_Box_Medium'];
  const rr = (k: number) => ((seed * 31 + k * 17) % 100) / 100;
  // Props_Shelf_Tall de 3,3 m: baldas a 0,43 / 1,08 / 1,73 / 2,38 (0,65 entre baldas: las cajas, de 0,45 como mucho)
  for (const [n, y] of [0.9, 1.55, 2.2, 2.85].entries()) for (let k = 0; k < 3; k++) {
    if ((n * 3 + k + seed) % 5 === 4) continue;   // algún hueco: un archivo de verdad no está lleno
    const c = boxes[(n * 3 + k + seed) % boxes.length];
    ctx.restsOn(file, R.resource(c), { pos: [X(ex - 0.62 + k * 0.62 + (rr(n * 3 + k) - 0.5) * 0.06), 0, zB + 0.75], width: c === 'Containers_Box_Small' ? 0.34 : 0.5, rot: (rr(k + n) - 0.5) * 0.25 }, { since: y });
  }
  obstacle(ex - 1.2, zB, ex + 1.2, zB + 1.25);
  // la pieza: la estantería. Se baja una caja, se repasa el inventario en el diario o se busca con la lupa
  point('estanteria', 'pieza', ex - 0.55, 0, zB + 1.6, Math.PI + 0.1, { actions: [{ clip: 'PickUp' }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Interact' }] });
  point('estanteria-2', 'pieza', ex + 0.6, 0, zB + 1.6, Math.PI - 0.1, { actions: [{ clip: 'Holding_B', utensil: 'lupa', dur: 4 }, { clip: 'PickUp' }] });
  // ---- MIDDLE: the archivist's desk, under the task board
  const pArch = new PhosphorScreen(384, 256, ctx.v.screen, ' ls -la'); pArch.speed = 26;
  screenReal(ctx, pArch, 'commit'); ctx.room.screens.push(pArch);
  await centralDesk(ctx, { tex: pArch.tex, chair: R.furniture('chair_desk_B'),
    onTop: [{ path: R.furniture('lamp_table'), x: -0.75, z: -0.2, c: { scale: K * 0.45 } }, { path: R.tools('map'), x: 0.62, z: 0.1, c: { scale: K * 0.35, rot: 0.2 } }] });
  point('consola', 'consola', -4.9, 0, zB + 1.55, -0.6, { clip: 'Working_A' });   // at the books
  const books = P(R.home('Shelf_1'), { pos: [X(-5.6), 0, zB + 0.5], height: 3.0 });
  // Shelf_1 de 3 m: baldas a 0,05 / 0,63 / 1,22 / 1,82 / 2,41
  for (const [k, y] of [0.5, 1.1, 1.7, 2.3, 2.9].entries()) ctx.restsOn(books, R.furniture(k % 2 ? 'book_set' : 'book_single'), { pos: [X(-5.6), 0, zB + 0.5], scale: K * (k % 2 ? 0.45 : 0.6), rot: k * 0.4 }, { since: y });
  obstacle(-6, zB, -5.1, zB + 1.0);
  // ---- DERECHA: palé con cajas apiladas (cada una sobre la de debajo), montón de bultos, baúl y la mesa de consulta
  const pale = P(R.resource('Pallet_Wood'), { pos: [X(3.15), 0, zB + 0.85], scale: K * 0.7 });
  const c1 = ctx.restsOn(pale, R.resource('Containers_Box_Large'), { pos: [X(2.95), 0, zB + 0.8], scale: K * 0.7, rot: 0.2 });
  ctx.restsOn(c1, R.resource('Containers_Box_Medium'), { pos: [X(2.95), 0, zB + 0.8], scale: K * 0.6, rot: -0.15 });
  ctx.restsOn(pale, R.resource('Containers_Box_Medium'), { pos: [X(3.5), 0, zB + 1.2], scale: K * 0.55, rot: 0.5 });
  P(R.resource('Containers_Pile_Large'), { pos: [X(5.0), 0, zB + 0.7], height: 1.45, rot: X(-0.12) });
  P(R.tools('rope_bundle_A'), { pos: [X(2.45), 0, zB + 1.6], scale: K * 0.55 });
  obstacle(2.3, zB, 6, zB + 1.75);
  // mesa de consulta, a la derecha y por delante: mapa, lupa y flexo; la silla de lado (lectura de perfil)
  const mx = 3.85, mz = 0.45;
  const query = P(R.furniture('table_medium'), { pos: [X(mx), 0, mz], scale: K * 0.6 });
  ctx.restsOn(query, R.tools('map'), { pos: [X(mx + 0.05), 0, mz + 0.05], scale: K * 0.38, rot: 0.15 });
  ctx.restsOn(query, R.tools('magnifying_glass'), { pos: [X(mx + 0.3), 0, mz + 0.22], scale: K * 0.42, ...lying(-0.5) });
  ctx.restsOn(query, R.furniture('lamp_table'), { pos: [X(mx - 0.32), 0, mz - 0.3], scale: K * 0.45 });
  ctx.restsOn(query, R.tools('journal_closed'), { pos: [X(mx + 0.32), 0, mz - 0.28], scale: K * 0.42, rot: 0.3 });
  P(R.furniture('chair_A_wood'), { pos: [X(mx - 0.85), 0, mz], scale: K, rot: X(Math.PI / 2) });
  obstacle(mx - 0.5, mz - 0.5, mx + 0.5, mz + 0.5);
  point('lectura', 'aficion', mx - 0.85, 0, mz, Math.PI / 2, { clip: 'Sit_Chair_Idle', utensil: 'diario' });
  signInWall(g, sign(t('world.poster.archive'), t('world.poster.archiveFoot'), '#e2d8bf', '#4a3622', 'ojo', seed + 13), X(2.3), 2.6, 0.56, 0.78, zB + 0.33, 0.02 * s);
  // a crate by the side wall, behind the front corner (the room panel's)
  const box1 = P(R.sf('Props_Crate'), { pos: [X(-5.45), 0, -0.55], height: 0.55, rot: 0.5 });
  ctx.restsOn(box1, R.resource('Containers_Box_Small'), { pos: [X(-5.45), 0, -0.55], scale: K * 0.5, rot: 0.9 });
  obstacle(-6, -0.9, -5.0, -0.2);
  stain(g, X(ex + 1.0), 0.9, 1.2, seed);
  const panel = new PanelRoom(); panel.title = 'ARCHIVO'; panel.color = ctx.v.screen; ctx.panel = panel;
  ctx.room.walkZones = [segment(-1.8, -1.2), segment(1.2, 1.8)];
  ctx.vapor = { pos: new THREE.Vector3(X(4.6), 3.1, zB + 0.8), dir: new THREE.Vector3(-0.2 * s, 0.9, 0.3) };
  ctx.lamps = [{ x: 0, z: 0.8, o: { intensity: 55, corta: true, goal: [0, -0.3] } }, { x: X(ex), z: 0.6, o: { intensity: 80, shadow: true, goal: [X(ex), -0.6] } }, { x: X(mx), z: 0.6, o: { intensity: 55, goal: [X(mx), 0.2] } }];
}
