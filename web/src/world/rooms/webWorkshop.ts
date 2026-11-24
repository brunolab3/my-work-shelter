// Sala de repositorio «taller web»: in the middle the dweller's desk under the task board; left, the build oven; right,
// the bunk and the notes.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, corkboard, PanelRoom } from '../../engine/textures';
import { overlayScreen } from '../util3d';
import { BACKGROUND, screenReal, signInWall, stain, mountLiquid, mountPilots, highBand, Bubbles, centralDesk, aWall, type Context } from './common';

export async function furnishWebWorkshop(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  const { vCopper } = ctx;
  await highBand(ctx, { gauge: -1.75 });
  // ventilador que gira detrás de la rejilla grande (se ve girar entre las lamas, no colgando debajo)
  const vent = await place(g, R.sf('Details_Vent_2'), { pos: [-5.15, 3.38, zB + 0.33], width: 0.62, shadow: false });
  aWall(g, vent);
  const grilleCenter = new THREE.Box3().setFromObject(vent).getCenter(new THREE.Vector3());
  const fan = await place(g, R.sf('Details_Output_Small'), { pos: [grilleCenter.x, grilleCenter.y, grilleCenter.z - 0.02], width: 0.4, anchor: 'center', isStatic: false, shadow: false });

  // ---- MIDDLE: the dweller's desk under the task board
  const pDiff = new PhosphorScreen(384, 256, v.screen); pDiff.speed = 40;
  screenReal(ctx, pDiff, 'changes'); ctx.room.screens.push(pDiff);
  await centralDesk(ctx, { id: 'chair', chair: R.furniture('chair_desk_B'), tex: pDiff.tex,
    onTop: [{ path: R.furniture('lamp_desk'), x: -0.72, z: -0.22, c: { scale: K * 0.62, rot: 0.5 } }, { path: R.furniture('mug_B'), x: -0.62, z: 0.25, c: { scale: K * 0.75, rot: 0.4 } }, { path: R.furniture('cup_pencils'), x: 0.72, z: -0.25, c: { scale: K * 0.62 } }] });
  // archivador con planos y caja (esquina izquierda, cierra el rincón)
  const cabinet = P(R.sf('Props_Shelf'), { pos: [-5.3, 0, zB + 0.5], height: 2.4 });
  ctx.restsOn(cabinet, R.furniture('book_set'), { pos: [-5.3, 0, zB + 0.5], scale: K * 0.9 }, { since: 2.0 });
  ctx.restsOn(cabinet, R.tools('journal_closed'), { pos: [-5.6, 0, zB + 0.48], scale: K * 0.6, rot: 0.3 }, { since: 1.4 });
  ctx.restsOn(cabinet, R.tools('blueprint_stacked'), { pos: [-5.05, 0, zB + 0.5], scale: K * 0.5, rot: -0.2 }, { since: 0.95 });
  P(R.resource('Containers_Box_Small'), { pos: [-5.0, 0.04, zB + 0.5], scale: K * 0.9, rot: 0.15 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-4.2, zB + 1.0)));

  // ---- LEFT: the «build oven» (capsule with liquid, a floating core and bubbles) and the dweller's console, in profile
  const cx = -3.35;
  P(R.sf('Props_Base'), { pos: [cx, 0, zB + 1.15], width: 1.9 });
  const capsula = await place(g, R.sf('Props_Pod'), { pos: [cx, 0.12, zB + 1.15], height: 3.15, variant: v, own: true, isStatic: false });
  const COLOR_LIQ = '#2fd46a';
  const liquid = mountLiquid(capsula, COLOR_LIQ);
  const core = await place(g, R.cy('Collectible_Board'), { pos: [cx, 1.45, zB + 1.15], height: 0.55, anchor: 'center', isStatic: false, own: true, shadow: false });
  core.traverse((n: any) => { if (n.isMesh && n.material.name === 'Gold') { n.material.emissive = new THREE.Color('#ffb347'); n.material.emissiveIntensity = 0.6; } });
  const bubbles = new Bubbles(new THREE.Vector3(cx, 0.75, zB + 1.15), 0.32, 2.1, COLOR_LIQ);
  g.add(bubbles.group);
  // the oven's supplies beside it: a crate of parts with a wrench on it, and a plant
  const box = P(R.resource('Containers_Crate_Medium_Wood'), { pos: [cx + 1.25, 0, zB + 0.5], height: 0.6, rot: 0.25 });
  ctx.restsOn(box, R.tools('wrench_A'), { pos: [cx + 1.25, 0, zB + 0.5], scale: K * 0.6, rotX: -Math.PI / 2, rotZ: 0.7 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(cx - 1.0, zB), new THREE.Vector2(cx + 1.6, zB + 2.1)));
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(cx + 1.4, 0, zB + 1.45), rotation: -Math.PI / 2, clip: 'Working_A' });
  ctx.room.points.push({ id: 'oven', type: 'console', pos: new THREE.Vector3(cx + 1.35, 0, zB + 2.05), rotation: -Math.PI / 2 - 0.5, clip: 'Interact' });
  // la pieza: el horno de builds. Se le da al mando de la base (el líquido borbotea y el núcleo se acelera), se mira de
  // cerca con la lupa cómo va la build o se le da un golpe de llave a la tapa
  let shove = 0;
  const revive = () => { shove = 1; };
  const ovenToward = (x: number, z: number) => Math.atan2(cx - x, zB + 1.15 - z);
  ctx.room.points.push({ id: 'oven-knob', type: 'piece', pos: new THREE.Vector3(cx + 0.95, 0, zB + 2.2), rotation: ovenToward(cx + 0.95, zB + 2.2),
    actions: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'magnifier', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  ctx.room.points.push({ id: 'oven-lid', type: 'piece', pos: new THREE.Vector3(cx - 0.95, 0, zB + 2.2), rotation: ovenToward(cx - 0.95, zB + 2.2),
    actions: [{ clip: 'Working_C', utensil: 'wrench', onMake: revive }, { clip: 'Interact', onMake: revive }] });
  // panel de estado de la sala (en la pared, a la derecha del horno)
  const panel = new PanelRoom(); panel.color = v.screen;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [2.6, 2.2, zB + 0.6], width: 1.3, isStatic: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brightness: 1.25, margin: 0.94 });
  // armario de servidores con pilotos (rompe la simetría del centro)
  P(R.sf('Props_Capsule'), { pos: [2.45, 0, zB + 0.55], height: 1.55 });
  const pilots = mountPilots(g, new THREE.Vector3(2.45, 0.95, zB + 1.0), v.screen);

  // ---- DERECHA: litera, corcho de notas, planta y bodegón
  P(R.home('Bed_Bunk'), { pos: [4.55, 0, zB + 1.0], height: 2.45, rot: Math.PI / 2 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(2.85, zB), new THREE.Vector2(6, zB + 1.8)));
  ctx.room.points.push({ id: 'cama', type: 'cama', pos: new THREE.Vector3(4.55, 0.66, zB + 1.02), rotation: Math.PI / 2, clip: 'Lie_Idle' });
  const notes = tr('world.web.notes').split('|').map((text, i) => ({ text, color: ['#f2e37a', '#f6b3a8', '#b8e3a4', '#a9d4f0', '#f2e37a'][i] }));
  signInWall(g, corkboard(notes, seed), 4.6, 3.05, 1.6, 1.06, zB + 0.33);
  signInWall(g, sign(t('world.poster.quality'), t('world.poster.qualityFoot'), '#d8c8a0', '#7a2a1e', 'eye', seed), -2.0, 2.45, 0.5, 0.7, zB + 0.33, 0.03);
  P(R.home('Houseplant_3'), { pos: [3.15, 0, zB + 0.45], height: 1.0 });
  // its gear on the floor, short of the front corner (the room panel's)
  P(R.tools('fishing_tacklebox'), { pos: [3.75, 0, 0.75], scale: K * 0.75, rot: -0.5 });
  P(R.resource('Containers_Box_Medium'), { pos: [3.95, 0, 0.2], scale: K * 0.9, rot: 0.2 });
  P(R.sv('Backpack'), { pos: [3.2, 0, 0.4], height: 0.62, rot: -0.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(2.9, -0.1), new THREE.Vector2(4.4, 1.1)));

  // ---- primer plano: tubería baja tirada en el suelo delante y caja cortada por el borde (cuarta capa)
  P(R.cy('Pipe_2'), { pos: [-3.9, 0.0, BACKGROUND / 2 - 0.2], width: 3.6, variant: vCopper }).then(o => { o.scale.y *= 0.55; o.scale.z *= 0.55; });
  P(R.sv('Trashcan'), { pos: [-4.4, 0, 0.45], height: 0.75 });
  P(R.home('Kitchen_Cabinet1'), { pos: [5.62, 0, zB + 0.42], height: 1.9, rot: -Math.PI / 2 + 0.2 });
  P(R.resource('Fuel_C_Barrels'), { pos: [-5.5, 0, -0.6], scale: K * 0.6, rot: 0.3 });   // in front of the cabinet, short of the front corner
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, -1.2), new THREE.Vector2(-5.0, 0.0)));
  P(R.tools('bucket_metal'), { pos: [-5.1, 0, 1.75], scale: K * 0.6 });
  P(R.sf('Props_Crate'), { pos: [5.75, 0, BACKGROUND / 2 - 0.35], height: 0.7, rot: 0.4 });
  stain(g, -1.0, -0.6, 1.4, 4); stain(g, 2.4, 0.2, 1.0, 9); stain(g, -3.0, 1.5, 0.8, 13);


  ctx.room.walkZones = [[-1.9, -1.3], [1.3, 1.9]];
  ctx.panel = panel;
  ctx.sparks = new THREE.Vector3(cx + 1.25, 1.0, zB + 0.6);
  ctx.lamps = [{ x: cx, z: 0.45, o: { intensity: 80, goal: [cx, 0.4] } }, { x: 0, z: 0.6, o: { intensity: 95, shadow: true, goal: [0, 0.2] } }, { x: 2.95, z: 0.7, o: { intensity: 62, goal: [2.8, 0.9] } }];
  // la cápsula ilumina su entorno (ancla de luz puntual de color: la enciende el reparto global)
  const anchor = { type: 'point' as const, pos: new THREE.Vector3(cx, 1.6, zB + 1.9), intensity: 6, color: new THREE.Color(COLOR_LIQ), distance: 5.5, priority: 2 };
  ctx.room.anchors.push(anchor);
  ctx.onState(e => {
    liquid.uniforms.uColor.value.copy(new THREE.Color(e === 'waiting' ? '#ff9a1f' : e === 'error' ? '#ff3a2a' : e === 'no-session' ? '#1f5a35' : COLOR_LIQ));
    anchor.color.copy(liquid.uniforms.uColor.value);
    bubbles.color(liquid.uniforms.uColor.value);
  });
  ctx.onUpdate((dt, t, a) => {
    shove = Math.max(0, shove - dt * 0.6);
    liquid.uniforms.uTiempo.value = t; liquid.uniforms.uForce.value = 0.45 + a * 0.4 + shove * 0.45 + (ctx.room.state === 'waiting' ? 0.25 * (Math.sin(t * 6) > 0 ? 1 : 0) : 0);
    anchor.intensity = 3 + a * 4 + Math.sin(t * 3) * 0.5;
    core.rotation.y += dt * (0.4 + a * 2.5 + shove * 6); core.position.y = 1.45 + Math.sin(t * 1.2) * 0.06;
    bubbles.rhythm = 6 + a * 30 + shove * 60; bubbles.update(dt);
    fan.rotation.z -= dt * (4 + a * 14);
    pilots(t, a);
    if (ctx.room.state === 'working' && Math.random() < dt * (0.15 + a)) {
      const phrases = tr('world.web.log').split('|');
      panel.lines.push('> ' + phrases[Math.floor(Math.random() * phrases.length)]);
    }
  });
}
