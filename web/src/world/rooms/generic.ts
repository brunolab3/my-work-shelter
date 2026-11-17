// Sala de repositorio genérica («banco de pruebas»): para carpetas que no son web, vídeo, marca ni landing.
// Pieza protagonista: el tablero de tareas de la sala (taskBoard.ts), grande en el centro de la pared.
// Distribución propia: banco de trabajo con herramientas a la izquierda, armario de servidores al fondo, catre y
// estanterías a la derecha. Se espeja según la semilla para que dos salas genéricas no sean iguales.
import { t } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { cartel, PhosphorScreen, PanelRoom } from '../../engine/textures';
import { signInWall, mancha, highBand, workStation, screenReal, aWall, tumbada, type Contexto } from './common';

export async function furnishGeneric(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  const s = semilla % 2 ? 1 : -1;            // espejo
  const X = (x: number) => x * s;
  await highBand(ctx, { reloj: X(4.9), valves: [X(-4.8)], segments: [[X(-4.4), 2.4]] });
  // the task board hangs in the middle of the wall, on two brackets
  for (const dx of [-1.5, 1.5]) P(R.cy('Support_Short'), { pos: [X(0.3) + dx, 1.35, zB + 0.4], alto: 0.55, sombra: false });
  // banco de trabajo con herramientas (tumbadas y apoyadas en el tablero) y su taburete
  const banco = P(R.mueble('table_medium_long'), { pos: [X(-3.6), 0, zB + 0.95], escala: K * 0.8 });
  ctx.sobre(banco, R.herr('hammer'), { pos: [X(-4.1), 0, zB + 1.05], escala: K * 0.7, ...tumbada(1.2) });
  ctx.sobre(banco, R.herr('saw'), { pos: [X(-3.35), 0, zB + 0.85], escala: K * 0.6, ...tumbada(1.75) });
  ctx.sobre(banco, R.herr('wrench_A'), { pos: [X(-2.9), 0, zB + 1.2], escala: K * 0.7, ...tumbada(0.5) });
  ctx.sobre(banco, R.herr('screwdriver_A_long_color'), { pos: [X(-3.65), 0, zB + 1.3], escala: K * 0.7, ...tumbada(1.4) });
  ctx.sobre(banco, R.mueble('lamp_desk'), { pos: [X(-4.5), 0, zB + 0.7], escala: K * 0.7, rot: X(0.6) });
  P(R.mueble('chair_stool'), { pos: [X(-3.5), 0, zB + 1.85], escala: K });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(-4.6), X(-2.6)), zB + 0.3), new THREE.Vector2(Math.max(X(-4.6), X(-2.6)), zB + 1.6)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(X(-3.5), 0, zB + 2.15), giro: Math.PI, clip: 'Working_B' });
  // armario de servidores con pilotos (Computer_Large) junto a la pantalla
  P(R.cy('Computer_Large'), { pos: [X(2.6), 0, zB + 0.55], alto: 2.3, rot: X(-0.15) });
  ctx.sala.puntos.push({ id: 'servidor', tipo: 'consola', pos: new THREE.Vector3(X(2.4), 0, zB + 1.6), giro: Math.PI + X(0.3), clip: 'Working_A' });
  // derecha: el puesto (mesa de tres cuartos con monitor y teclado) y, según la sala, una estantería, una lámpara de pie o
  // un segundo armario contra la pared
  const pStation = new PhosphorScreen(384, 256, v.pantalla); pStation.speed = 30;
  screenReal(ctx, pStation, 'actividad'); ctx.sala.pantallas.push(pStation);
  await workStation(ctx, { x: X(4.35), z: -0.75, giro: X(-0.8), tex: pStation.tex,
    encima: [{ ruta: R.mueble('mug_B'), x: 0.72, z: 0.2, c: { escala: K * 0.7 } }, { ruta: R.herr('journal_closed'), x: -0.72, z: 0.0, c: { escala: K * 0.5, rot: 0.4 } }] });
  const plan = Math.floor(semilla / 2) % 3;
  if (plan === 0) P(R.mueble('shelf_B_large_decorated'), { pos: [X(5.0), 1.6, zB + 0.35], escala: K * 0.7 }).then(o => aWall(g, o));
  else if (plan === 1) P(R.mueble('lamp_standing'), { pos: [X(5.6), 0, zB + 0.5], escala: K * 0.9 });
  else P(R.cy('Computer_Large'), { pos: [X(5.55), 0, zB + 0.5], alto: 1.9, rot: X(-0.3) });
  // paredes y suelo con vida: una planta, cajas apiladas, un cable por el suelo y un segundo cartel
  P(R.casa('Houseplant_3'), { pos: [X(-5.4), 0, zB + 0.6], alto: 1.0 });
  // cajas en el rincón, fuera del pasillo: dos en el suelo y una encima de la primera, apoyada de verdad
  { const c0 = P(R.resource('Containers_Crate_Small_Grey'), { pos: [X(-5.35), 0, 0.45], escala: K * 0.55, rot: 0.2 });
    P(R.resource('Containers_Box_Medium'), { pos: [X(-5.3), 0, 1.05], escala: K * 0.55, rot: 1.0 });
    ctx.sobre(c0, R.resource('Containers_Box_Small'), { pos: [X(-5.35), 0, 0.45], escala: K * 0.55, rot: 0.7 });
    ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(Math.min(X(-6), X(-4.9)), 0.1), new THREE.Vector2(Math.max(X(-6), X(-4.9)), 1.4))); }
  // la pieza: el tablero de tareas. Se señala lo que dice (y se enciende), se apunta en el diario o se le da al mando de
  // la pared
  let revives = 0; const switchOn = () => { revives = 1; };
  const mat = ctx.sala.userData.tableroTareas?.mesh?.material as THREE.MeshStandardMaterial | undefined;
  for (const [id, dx] of [['pantalla', -0.55], ['pantalla-2', 1.15]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(X(dx), 0, zB + 1.3), giro: Math.PI + X(dx < 0 ? -0.35 : 0.35),
    acciones: [{ clip: 'Interact', onMake: switchOn }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Use_Item', onMake: switchOn }] });
  ctx.alActualizar(dt => { revives = Math.max(0, revives - dt * 0.8); if (mat) mat.emissiveIntensity = 0.95 + revives * 0.5; });
  P(R.sf('Details_Vent_3'), { pos: [X(2.95), 3.25, zB + 0.5], ancho: 0.9, sombra: false });
  signInWall(g, cartel(t('world.poster.benchRules'), t('world.poster.benchRulesFoot'), '#e3d9c0', '#3a2a1e', 'rayo', semilla + 7), X(-2.6), 1.75, 0.46, 0.64, zB + 0.33, 0.02 * s);
  signInWall(g, cartel(t('world.poster.testBench'), t('world.poster.testBenchFoot'), '#e6dcc4', '#3a3226', 'engranaje', semilla), X(-1.9), 2.75, 0.56, 0.78, zB + 0.33, 0.03 * s);
  const panel = new PanelRoom(); panel.titulo = 'BANCO'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, X(-2.0), 1.1, 1.1, semilla);
  ctx.sala.walkZones = [[-1.6, 1.6]];
  ctx.vapor = { pos: new THREE.Vector3(X(-4.4), 3.15, zB + 0.85), dir: new THREE.Vector3(0.3 * s, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(X(-3.4), 0.9, zB + 1.0);
  ctx.lamparas = [{ x: X(-3.6), z: 0.5, o: { intensidad: 85, goal: [X(-3.6), -1.3] } }, { x: X(0.3), z: 0.9, o: { intensidad: 90, sombra: true, corta: true } }, { x: X(4.2), z: 0.5, o: { intensidad: 70 } }];
}
