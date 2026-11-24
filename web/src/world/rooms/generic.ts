// Sala de repositorio genérica («banco de pruebas»): para carpetas que no son web, vídeo, marca ni landing.
// In the middle, the work zone: the dweller's desk under the room's task board (taskBoard.ts). Left, the workbench
// with its tools; right, the centrepiece, a server cabinet, and shelves. Se espeja según la semilla para que dos salas genéricas no sean iguales.
import { t } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom } from '../../engine/textures';
import { signInWall, stain, highBand, centralDesk, screenReal, aWall, lying, type Context } from './common';

export async function furnishGeneric(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  const s = seed % 2 ? 1 : -1;            // espejo
  const X = (x: number) => x * s;
  await highBand(ctx, { timer: X(4.9), valves: [X(-4.8)], segments: [[X(-4.4), 2.4]] });
  // the task board hangs in the middle of the wall, on two brackets
  for (const dx of [-1.5, 1.5]) P(R.cy('Support_Short'), { pos: [dx, 1.35, zB + 0.4], height: 0.55, shadow: false });
  // banco de trabajo con herramientas (tumbadas y apoyadas en el tablero) y su taburete
  const workbench = P(R.furniture('table_medium_long'), { pos: [X(-3.6), 0, zB + 0.95], scale: K * 0.8 });
  ctx.restsOn(workbench, R.tools('hammer'), { pos: [X(-4.1), 0, zB + 1.05], scale: K * 0.7, ...lying(1.2) });
  ctx.restsOn(workbench, R.tools('saw'), { pos: [X(-3.35), 0, zB + 0.85], scale: K * 0.6, ...lying(1.75) });
  ctx.restsOn(workbench, R.tools('wrench_A'), { pos: [X(-2.9), 0, zB + 1.2], scale: K * 0.7, ...lying(0.5) });
  ctx.restsOn(workbench, R.tools('screwdriver_A_long_color'), { pos: [X(-3.65), 0, zB + 1.3], scale: K * 0.7, ...lying(1.4) });
  ctx.restsOn(workbench, R.furniture('lamp_desk'), { pos: [X(-4.5), 0, zB + 0.7], scale: K * 0.7, rot: X(0.6) });
  P(R.furniture('chair_stool'), { pos: [X(-3.5), 0, zB + 1.85], scale: K });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(-4.6), X(-2.6)), zB + 0.3), new THREE.Vector2(Math.max(X(-4.6), X(-2.6)), zB + 1.6)));
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(X(-3.5), 0, zB + 2.15), rotation: Math.PI, clip: 'Working_B' });
  // right: the server cabinet with its pilots (Computer_Large), the room's centrepiece
  P(R.cy('Computer_Large'), { pos: [X(3.1), 0, zB + 0.55], height: 2.3, rot: X(-0.15) });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(2.4), X(3.8)), zB), new THREE.Vector2(Math.max(X(2.4), X(3.8)), zB + 1.1)));
  // the dweller's desk, in the middle under the board; on the right, by the room, a shelf, a standing lamp or a second
  // cabinet against the wall
  const pStation = new PhosphorScreen(384, 256, v.screen); pStation.speed = 30;
  screenReal(ctx, pStation, 'activity'); ctx.room.screens.push(pStation);
  await centralDesk(ctx, { tex: pStation.tex,
    onTop: [{ path: R.furniture('mug_B'), x: 0.72, z: 0.2, c: { scale: K * 0.7 } }, { path: R.tools('journal_closed'), x: -0.72, z: 0.0, c: { scale: K * 0.5, rot: 0.4 } }] });
  const plan = Math.floor(seed / 2) % 3;
  if (plan === 0) P(R.furniture('shelf_B_large_decorated'), { pos: [X(5.0), 1.6, zB + 0.35], scale: K * 0.7 }).then(o => aWall(g, o));
  else if (plan === 1) P(R.furniture('lamp_standing'), { pos: [X(5.6), 0, zB + 0.5], scale: K * 0.9 });
  else P(R.cy('Computer_Large'), { pos: [X(5.55), 0, zB + 0.5], height: 1.9, rot: X(-0.3) });
  // paredes y suelo con vida: una planta, cajas apiladas, un cable por el suelo y un segundo cartel
  P(R.home('Houseplant_3'), { pos: [X(-5.4), 0, zB + 0.6], height: 1.0 });
  // crates by the side wall, behind the front corner (that one is the room panel's): two on the floor, one on the first
  { const c0 = P(R.resource('Containers_Crate_Small_Grey'), { pos: [X(-5.35), 0, -0.85], scale: K * 0.55, rot: 0.2 });
    P(R.resource('Containers_Box_Medium'), { pos: [X(-5.3), 0, -0.3], scale: K * 0.55, rot: 1.0 });
    ctx.restsOn(c0, R.resource('Containers_Box_Small'), { pos: [X(-5.35), 0, -0.85], scale: K * 0.55, rot: 0.7 });
    ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(-6), X(-4.9)), -1.2), new THREE.Vector2(Math.max(X(-6), X(-4.9)), 0.0))); }
  // the centrepiece: the server cabinet. The dweller checks it (and the task board lights up), notes it down in the
  // journal or pokes it
  let revives = 0; const switchOn = () => { revives = 1; };
  const mat = ctx.room.userData.taskBoard?.mesh?.material as THREE.MeshStandardMaterial | undefined;
  for (const [id, dx] of [['screen', 2.6], ['screen-2', 3.6]] as const) ctx.room.points.push({ id, type: 'piece', pos: new THREE.Vector3(X(dx), 0, zB + 1.6), rotation: Math.PI + X(dx < 3 ? -0.35 : 0.35),
    actions: [{ clip: 'Interact', onMake: switchOn }, { clip: 'Holding_A', utensil: 'journal', dur: 4 }, { clip: 'Use_Item', onMake: switchOn }] });
  ctx.onUpdate(dt => { revives = Math.max(0, revives - dt * 0.8); if (mat) mat.emissiveIntensity = 0.95 + revives * 0.5; });
  P(R.sf('Details_Vent_3'), { pos: [X(2.95), 3.25, zB + 0.5], width: 0.9, shadow: false });
  signInWall(g, sign(t('world.poster.benchRules'), t('world.poster.benchRulesFoot'), '#e3d9c0', '#3a2a1e', 'bolt', seed + 7), X(-2.6), 1.75, 0.46, 0.64, zB + 0.33, 0.02 * s);
  signInWall(g, sign(t('world.poster.testBench'), t('world.poster.testBenchFoot'), '#e6dcc4', '#3a3226', 'gear', seed), X(-2.3), 2.75, 0.56, 0.78, zB + 0.33, 0.03 * s);
  const panel = new PanelRoom(); panel.title = 'BANCO'; panel.color = v.screen; ctx.panel = panel;
  stain(g, X(-2.0), 1.1, 1.1, seed);
  ctx.room.walkZones = [[-2.4, -1.9], [1.9, 2.4]];
  ctx.vapor = { pos: new THREE.Vector3(X(-4.4), 3.15, zB + 0.85), dir: new THREE.Vector3(0.3 * s, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(X(-3.4), 0.9, zB + 1.0);
  ctx.lamps = [{ x: X(-3.6), z: 0.5, o: { intensity: 85, goal: [X(-3.6), -1.3] } }, { x: 0, z: 0.9, o: { intensity: 90, shadow: true, corta: true } }, { x: X(4.2), z: 0.5, o: { intensity: 70 } }];
}
