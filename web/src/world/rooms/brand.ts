// Sala de repositorio «archivo de marca» (estilo marca): in the middle the dweller's desk under the task board; right,
// the wall of colour samples and logos with its table; left, the drawing table, catalogue shelves and paint cans.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { cartel, PhosphorScreen, PanelRoom, markSamples } from '../../engine/textures';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, mancha, highBand, type Contexto, screenReal, centralDesk, aWall } from './common';

export async function furnishFileMark(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { valves: [-4.0], segments: [[-4.6, 2.6]] });   // ninguna tubería por delante del muro ni del tablero de tareas
  // pieza protagonista: el muro de muestras, retroiluminado como una mesa de luz
  const tex = markSamples();
  // (on the right, clear of the work zone)
  const MX = 3.95, MW = 3.5;
  const muro = new THREE.Mesh(new THREE.PlaneGeometry(MW, 2.3), new THREE.MeshStandardMaterial({ map: tex, color: '#a8a296', emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.08, roughness: 0.85 }));
  muro.position.set(MX, 2.35, zB + 0.33); g.add(muro);
  for (const [x, y, w, h] of [[MX, 3.55, MW + 0.3, 0.12], [MX, 1.15, MW + 0.3, 0.12], [MX - MW / 2 - 0.1, 2.35, 0.12, 2.5], [MX + MW / 2 + 0.1, 2.35, 0.12, 2.5]] as const) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.6, metalness: 0.3 })); b.position.set(x, y, zB + 0.36); g.add(b); }
  // mesa de dibujo (caballete con planos) delante del muro, a la izquierda
  const dibujo = P(R.mueble('table_medium'), { pos: [-3.9, 0, zB + 1.4], escala: K * 0.85, rot: 0.2 });
  ctx.sobre(dibujo, R.herr('blueprint_stacked'), { pos: [-3.9, 0, zB + 1.4], escala: K * 0.55, rot: 0.25 });
  ctx.sobre(dibujo, R.herr('drafting_compass'), { pos: [-3.45, 0, zB + 1.7], escala: K * 0.5, rot: 1.1 });
  ctx.sobre(dibujo, R.mueble('lamp_desk'), { pos: [-4.35, 0, zB + 1.0], escala: K * 0.7, rot: 1.2 });
  P(R.mueble('chair_stool_wood'), { pos: [-3.0, 0, zB + 1.9], escala: K });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-4.8, zB + 0.6), new THREE.Vector2(-3.1, zB + 2.2)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(-3.2, 0, zB + 2.35), giro: Math.PI + 0.6, clip: 'Working_B' });
  // estanterías de catálogos de color (libros) y botes de pintura
  const library = P(R.casa('Bookshelf'), { pos: [-5.35, 0, zB + 0.42], alto: 3.4 });
  for (const y of [1.2, 1.7, 2.2]) ctx.sobre(library, R.mueble('book_set'), { pos: [-5.35, 0, zB + 0.45], escala: K * 1.0 }, { desde: y });
  const latas = ['Can_Red', 'Can_Open', 'Can_Closed', 'Can_Red', 'Can_Broken'];
  latas.forEach((l, i) => P(R.sv(l), { pos: [-2.45 - (i % 3) * 0.3, 0, zB + 0.45 + (i % 2) * 0.18 + Math.floor(i / 3) * 0.32], alto: 0.42, rot: i }));
  // middle: the dweller's desk (the monitor shows the style guide), under the task board; right, a cabinet and a plant
  const pGuide = new PhosphorScreen(384, 256, v.pantalla, ' tokens.css'); pGuide.speed = 26;
  screenReal(ctx, pGuide, 'commit'); ctx.sala.pantallas.push(pGuide);
  await centralDesk(ctx, { id: 'silla', silla: R.mueble('chair_desk_B'), tex: pGuide.tex,
    encima: [{ ruta: R.herr('pencil_A_long'), x: 0.55, z: 0.25, c: { escala: K * 0.7, rot: 0.6 } }, { ruta: R.mueble('pictureframe_standing_B'), x: -0.7, z: -0.25, c: { escala: K * 0.7, rot: 0.3 } }, { ruta: R.mueble('mug_B'), x: 0.75, z: -0.1, c: { escala: K * 0.7 } }] });
  P(R.mueble('cabinet_medium_decorated'), { pos: [5.3, 0, zB + 0.5], escala: K * 0.75, rot: -Math.PI / 2 });
  P(R.casa('Houseplant_8'), { pos: [2.45, 0, zB + 0.5], alto: 0.9 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-3.2, zB), new THREE.Vector2(-2.1, zB + 1.1)), new THREE.Box2(new THREE.Vector2(2.1, zB), new THREE.Vector2(2.8, zB + 0.85)), new THREE.Box2(new THREE.Vector2(4.9, zB), new THREE.Vector2(6, zB + 1.3)));
  // state sign (between the bookcase and the wall; decoration: the room panel is roomPanel.ts) and a humour poster
  const panel = new PanelRoom(); panel.titulo = 'MANUAL DE MARCA'; panel.color = v.pantalla;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [-3.95, 2.45, zB + 0.6], ancho: 1.4, estatico: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brillo: 1.2, margin: 0.94 });
  ctx.panel = panel;
  signInWall(g, cartel(t('world.poster.brand'), t('world.poster.brandFoot'), '#e9dfc9', '#b8402e', 'mano', semilla), -2.4, 1.85, 0.5, 0.7, zB + 0.33, 0.04);
  P(R.resource('Containers_Box_Medium'), { pos: [-2.6, 0, 1.75], escala: K * 0.8, rot: 0.3 });
  mancha(g, -2.0, 0.3, 1.2, semilla + 7);
  // in front of the wall, the samples table: open brand book, colour samples and a frame with the logo
  const TX = 3.55;
  const muestras = P(R.mueble('table_medium'), { pos: [TX, 0, -0.1], escala: K * 0.75 });
  ctx.sobre(muestras, R.mueble('book_set'), { pos: [TX - 0.35, 0, -0.05], escala: K * 0.65, rot: 0.3 });
  ctx.sobre(muestras, R.mueble('pictureframe_standing_A'), { pos: [TX + 0.35, 0, -0.25], escala: K * 0.75, rot: -0.3 });
  ctx.sobre(muestras, R.herr('map_empty'), { pos: [TX + 0.15, 0, 0.2], escala: K * 0.4, rot: 0.15 });
  ctx.sobre(muestras, R.herr('magnifying_glass'), { pos: [TX + 0.5, 0, 0.2], escala: K * 0.45, rotX: -Math.PI / 2, rot: 0.6 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(TX - 0.65, -0.75), new THREE.Vector2(TX + 0.65, 0.55)));
  // la pieza: el muro de muestras y su mesa. Se coge una muestra, se compara con la lupa contra el muro (que se enciende
  // como una mesa de luz) o se señala en el muro
  let luz = 0; const switchOn = () => { luz = 1; };
  ctx.sala.puntos.push({ id: 'muestras', tipo: 'pieza', pos: new THREE.Vector3(TX - 1.05, 0, -0.1), giro: Math.PI / 2,
    acciones: [{ clip: 'PickUp' }, { clip: 'Holding_A', utensil: 'lupa', dur: 4, onMake: switchOn }, { clip: 'Interact', onMake: switchOn }] });
  ctx.sala.puntos.push({ id: 'muro', tipo: 'pieza', pos: new THREE.Vector3(MX + 0.9, 0, -1.2), giro: Math.PI + 0.15,
    acciones: [{ clip: 'Interact', onMake: switchOn }, { clip: 'Use_Item' }] });
  ctx.sala.walkZones = [[-1.9, -1.3], [1.3, 1.9]];
  ctx.vapor = { pos: new THREE.Vector3(-5.0, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };   // away from the task board
  ctx.sparks = new THREE.Vector3(3.6, 1.2, zB + 1.0);
  ctx.lamparas = [{ x: -3.8, z: 0.5, o: { intensidad: 85 } }, { x: 0, z: 0.4, o: { intensidad: 80, corta: true, goal: [0, -0.9] } }, { x: MX, z: 0.4, o: { intensidad: 90, sombra: true, goal: [MX, -1.4] } }];
  ctx.alActualizar((dt, t, a) => {
    luz = Math.max(0, luz - dt * 0.7);
    (muro.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.07 + a * 0.08 + luz * 0.3 + Math.sin(t * 0.8) * 0.01;
    if (ctx.sala.estado === 'trabajando' && Math.random() < dt * (0.12 + a)) panel.lineas.push('> ' + tr('world.brand.log').split('|')[Math.floor(Math.random() * 4)]);
  });
}
