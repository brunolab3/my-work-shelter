// Sala de repositorio «archivo de marca» (estilo marca): in the middle the dweller's desk under the task board; right,
// the wall of colour samples and logos with its table; left, the drawing table, catalogue shelves and paint cans.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, markSamples } from '../../engine/textures';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, stain, highBand, type Context, screenReal, centralDesk, aWall } from './common';

export async function furnishFileMark(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { valves: [-4.0], segments: [[-4.6, 2.6]] });   // ninguna tubería por delante del muro ni del tablero de tareas
  // pieza protagonista: el muro de muestras, retroiluminado como una mesa de luz
  const tex = markSamples();
  // (on the right, clear of the work zone)
  const MX = 3.95, MW = 3.5;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(MW, 2.3), new THREE.MeshStandardMaterial({ map: tex, color: '#a8a296', emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.08, roughness: 0.85 }));
  wall.position.set(MX, 2.35, zB + 0.33); g.add(wall);
  for (const [x, y, w, h] of [[MX, 3.55, MW + 0.3, 0.12], [MX, 1.15, MW + 0.3, 0.12], [MX - MW / 2 - 0.1, 2.35, 0.12, 2.5], [MX + MW / 2 + 0.1, 2.35, 0.12, 2.5]] as const) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.6, metalness: 0.3 })); b.position.set(x, y, zB + 0.36); g.add(b); }
  // mesa de dibujo (caballete con planos) delante del muro, a la izquierda
  const drawing = P(R.furniture('table_medium'), { pos: [-3.9, 0, zB + 1.4], scale: K * 0.85, rot: 0.2 });
  ctx.restsOn(drawing, R.tools('blueprint_stacked'), { pos: [-3.9, 0, zB + 1.4], scale: K * 0.55, rot: 0.25 });
  ctx.restsOn(drawing, R.tools('drafting_compass'), { pos: [-3.45, 0, zB + 1.7], scale: K * 0.5, rot: 1.1 });
  ctx.restsOn(drawing, R.furniture('lamp_desk'), { pos: [-4.35, 0, zB + 1.0], scale: K * 0.7, rot: 1.2 });
  P(R.furniture('chair_stool_wood'), { pos: [-3.0, 0, zB + 1.9], scale: K });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-4.8, zB + 0.6), new THREE.Vector2(-3.1, zB + 2.2)));
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(-3.2, 0, zB + 2.35), rotation: Math.PI + 0.6, clip: 'Working_B' });
  // estanterías de catálogos de color (libros) y botes de pintura
  const library = P(R.home('Bookshelf'), { pos: [-5.35, 0, zB + 0.42], height: 3.4 });
  for (const y of [1.2, 1.7, 2.2]) ctx.restsOn(library, R.furniture('book_set'), { pos: [-5.35, 0, zB + 0.45], scale: K * 1.0 }, { since: y });
  const cans = ['Can_Red', 'Can_Open', 'Can_Closed', 'Can_Red', 'Can_Broken'];
  cans.forEach((l, i) => P(R.sv(l), { pos: [-2.45 - (i % 3) * 0.3, 0, zB + 0.45 + (i % 2) * 0.18 + Math.floor(i / 3) * 0.32], height: 0.42, rot: i }));
  // middle: the dweller's desk (the monitor shows the style guide), under the task board; right, a cabinet and a plant
  const pGuide = new PhosphorScreen(384, 256, v.screen, ' tokens.css'); pGuide.speed = 26;
  screenReal(ctx, pGuide, 'commit'); ctx.room.screens.push(pGuide);
  await centralDesk(ctx, { id: 'chair', chair: R.furniture('chair_desk_B'), tex: pGuide.tex,
    onTop: [{ path: R.tools('pencil_A_long'), x: 0.55, z: 0.25, c: { scale: K * 0.7, rot: 0.6 } }, { path: R.furniture('pictureframe_standing_B'), x: -0.7, z: -0.25, c: { scale: K * 0.7, rot: 0.3 } }, { path: R.furniture('mug_B'), x: 0.75, z: -0.1, c: { scale: K * 0.7 } }] });
  P(R.furniture('cabinet_medium_decorated'), { pos: [5.3, 0, zB + 0.5], scale: K * 0.75, rot: -Math.PI / 2 });
  P(R.home('Houseplant_8'), { pos: [2.45, 0, zB + 0.5], height: 0.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-3.2, zB), new THREE.Vector2(-2.1, zB + 1.1)), new THREE.Box2(new THREE.Vector2(2.1, zB), new THREE.Vector2(2.8, zB + 0.85)), new THREE.Box2(new THREE.Vector2(4.9, zB), new THREE.Vector2(6, zB + 1.3)));
  // state sign (between the bookcase and the wall; decoration: the room panel is roomPanel.ts) and a humour poster
  const panel = new PanelRoom(); panel.title = 'MANUAL DE MARCA'; panel.color = v.screen;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [-3.95, 2.45, zB + 0.6], width: 1.4, isStatic: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brightness: 1.2, margin: 0.94 });
  ctx.panel = panel;
  signInWall(g, sign(t('world.poster.brand'), t('world.poster.brandFoot'), '#e9dfc9', '#b8402e', 'hand', seed), -2.4, 1.85, 0.5, 0.7, zB + 0.33, 0.04);
  P(R.resource('Containers_Box_Medium'), { pos: [-2.6, 0, 1.75], scale: K * 0.8, rot: 0.3 });
  stain(g, -2.0, 0.3, 1.2, seed + 7);
  // in front of the wall, the samples table: open brand book, colour samples and a frame with the logo
  const TX = 3.55;
  const samples = P(R.furniture('table_medium'), { pos: [TX, 0, -0.1], scale: K * 0.75 });
  ctx.restsOn(samples, R.furniture('book_set'), { pos: [TX - 0.35, 0, -0.05], scale: K * 0.65, rot: 0.3 });
  ctx.restsOn(samples, R.furniture('pictureframe_standing_A'), { pos: [TX + 0.35, 0, -0.25], scale: K * 0.75, rot: -0.3 });
  ctx.restsOn(samples, R.tools('map_empty'), { pos: [TX + 0.15, 0, 0.2], scale: K * 0.4, rot: 0.15 });
  ctx.restsOn(samples, R.tools('magnifying_glass'), { pos: [TX + 0.5, 0, 0.2], scale: K * 0.45, rotX: -Math.PI / 2, rot: 0.6 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(TX - 0.65, -0.75), new THREE.Vector2(TX + 0.65, 0.55)));
  // la pieza: el muro de muestras y su mesa. Se coge una muestra, se compara con la lupa contra el muro (que se enciende
  // como una mesa de luz) o se señala en el muro
  let light = 0; const switchOn = () => { light = 1; };
  ctx.room.points.push({ id: 'samples', type: 'piece', pos: new THREE.Vector3(TX - 1.05, 0, -0.1), rotation: Math.PI / 2,
    actions: [{ clip: 'PickUp' }, { clip: 'Holding_A', utensil: 'magnifier', dur: 4, onMake: switchOn }, { clip: 'Interact', onMake: switchOn }] });
  ctx.room.points.push({ id: 'wall', type: 'piece', pos: new THREE.Vector3(MX + 0.9, 0, -1.2), rotation: Math.PI + 0.15,
    actions: [{ clip: 'Interact', onMake: switchOn }, { clip: 'Use_Item' }] });
  ctx.room.walkZones = [[-1.9, -1.3], [1.3, 1.9]];
  ctx.vapor = { pos: new THREE.Vector3(-5.0, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };   // away from the task board
  ctx.sparks = new THREE.Vector3(3.6, 1.2, zB + 1.0);
  ctx.lamps = [{ x: -3.8, z: 0.5, o: { intensity: 85 } }, { x: 0, z: 0.4, o: { intensity: 80, corta: true, goal: [0, -0.9] } }, { x: MX, z: 0.4, o: { intensity: 90, shadow: true, goal: [MX, -1.4] } }];
  ctx.onUpdate((dt, t, a) => {
    light = Math.max(0, light - dt * 0.7);
    (wall.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.07 + a * 0.08 + light * 0.3 + Math.sin(t * 0.8) * 0.01;
    if (ctx.room.state === 'working' && Math.random() < dt * (0.12 + a)) panel.lines.push('> ' + tr('world.brand.log').split('|')[Math.floor(Math.random() * 4)]);
  });
}
