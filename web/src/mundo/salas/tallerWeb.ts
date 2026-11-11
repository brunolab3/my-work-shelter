// Sala de repositorio «taller web»: puestos de trabajo, el horno de builds y el comité de calidad.
import * as THREE from 'three';
import { place, R } from '../../motor/assets';
import { cartel, PhosphorScreen, corcho, PanelRoom } from '../../motor/texturas';
import { overlayScreen, screenFrontal } from '../util3d';
import { BACKGROUND, screenReal, signInWall, mancha, mountLiquid, mountPilots, highBand, Bubbles, workStation, aWall, type Contexto } from './comun';

export async function furnishTallerWeb(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  const { vCopper } = ctx;
  await highBand(ctx, { reloj: -0.4, gauge: -1.7 });
  // ventilador que gira detrás de la rejilla grande (se ve girar entre las lamas, no colgando debajo)
  const rejilla = await place(g, R.sf('Details_Vent_2'), { pos: [-5.15, 3.38, zB + 0.33], ancho: 0.62, sombra: false });
  aWall(g, rejilla);
  const cRej = new THREE.Box3().setFromObject(rejilla).getCenter(new THREE.Vector3());
  const fan = await place(g, R.sf('Details_Output_Small'), { pos: [cRej.x, cRej.y, cRej.z - 0.02], ancho: 0.4, anchor: 'centro', estatico: false, sombra: false });

  // ---- IZQUIERDA: el puesto del habitante (mesa de tres cuartos: se le ven las manos al teclear) y el monitor de pared con lo
  // que lee
  const pDiff = new PhosphorScreen(384, 256, v.pantalla); pDiff.speed = 40;
  screenReal(ctx, pDiff, 'cambios'); ctx.sala.pantallas.push(pDiff);
  await workStation(ctx, { id: 'silla', x: -4.15, z: -0.8, giro: 0.8, silla: R.mueble('chair_desk_B'), tex: pDiff.tex,
    encima: [{ ruta: R.mueble('lamp_desk'), x: -0.72, z: -0.22, c: { escala: K * 0.62, rot: 0.5 } }, { ruta: R.mueble('mug_B'), x: -0.62, z: 0.25, c: { escala: K * 0.75, rot: 0.4 } }, { ruta: R.mueble('cup_pencils'), x: 0.72, z: -0.25, c: { escala: K * 0.62 } }] });
  // monitor de pared (frente a cámara) con el archivo que se está leyendo
  const monWall = await place(g, R.mueble('monitor'), { pos: [-3.35, 2.0, zB + 0.62], escala: K * 1.05, estatico: false });
  place(g, R.cy('Support_Short'), { pos: [-3.35, 1.55, zB + 0.45], alto: 0.6, sombra: false });
  const pDesk = new PhosphorScreen(512, 320, v.pantalla, ' src/rutas.ts'); pDesk.speed = 60;
  screenReal(ctx, pDesk, 'commit');
  screenFrontal(monWall, pDesk.tex, { ancho: 0.84, alto: 0.66, cy: 0.6, dz: -0.02 }, 1.35);
  ctx.sala.pantallas.unshift(pDesk);
  // archivador con planos y caja (esquina izquierda, cierra el rincón)
  const cabinet = P(R.sf('Props_Shelf'), { pos: [-5.3, 0, zB + 0.5], alto: 2.4 });
  ctx.sobre(cabinet, R.mueble('book_set'), { pos: [-5.3, 0, zB + 0.5], escala: K * 0.9 }, { desde: 2.0 });
  ctx.sobre(cabinet, R.herr('journal_closed'), { pos: [-5.6, 0, zB + 0.48], escala: K * 0.6, rot: 0.3 }, { desde: 1.4 });
  ctx.sobre(cabinet, R.herr('blueprint_stacked'), { pos: [-5.05, 0, zB + 0.5], escala: K * 0.5, rot: -0.2 }, { desde: 0.95 });
  P(R.resource('Containers_Box_Small'), { pos: [-5.0, 0.04, zB + 0.5], escala: K * 0.9, rot: 0.15 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-4.2, zB + 1.0)));

  // ---- CENTRO: el «horno de builds» (cápsula con líquido, núcleo suspendido y burbujas) y la consola del habitante, de lado
  const cx = 0.6;
  P(R.sf('Props_Base'), { pos: [cx, 0, zB + 1.15], ancho: 1.9 });
  const capsula = await place(g, R.sf('Props_Pod'), { pos: [cx, 0.12, zB + 1.15], alto: 3.15, variant: v, own: true, estatico: false });
  const COLOR_LIQ = '#2fd46a';
  const liquid = mountLiquid(capsula, COLOR_LIQ);
  const core = await place(g, R.cy('Collectible_Board'), { pos: [cx, 1.45, zB + 1.15], alto: 0.55, anchor: 'centro', estatico: false, own: true, sombra: false });
  core.traverse((n: any) => { if (n.isMesh && n.material.name === 'Gold') { n.material.emissive = new THREE.Color('#ffb347'); n.material.emissiveIntensity = 0.6; } });
  const burbujas = new Bubbles(new THREE.Vector3(cx, 0.75, zB + 1.15), 0.32, 2.1, COLOR_LIQ);
  g.add(burbujas.grupo);
  // consola de lado contra la izquierda: el habitante trabaja de perfil
  P(R.cy('Computer_Large'), { pos: [-2.55, 0, zB + 0.5], alto: 2.2, rot: 0.3 });
  const sideConsole = await place(g, R.sf('Props_Computer'), { pos: [-1.75, 0, zB + 0.95], alto: 2.15, rot: 0.25, variant: v, estatico: false });
  const pBuild = new PhosphorScreen(256, 320, v.pantalla, ' npm run build'); pBuild.speed = 26;
  screenReal(ctx, pBuild, 'actividad');
  overlayScreen(sideConsole, /^Black$/, pBuild.tex, { brillo: 1.3, margin: 0.9 });
  ctx.sala.pantallas.push(pBuild);
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-2.5, zB), new THREE.Vector2(-1.25, zB + 1.3)));
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(cx - 1.0, zB), new THREE.Vector2(cx + 1.0, zB + 2.1)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(-0.72, 0, zB + 1.5), giro: -0.55, clip: 'Working_A' });
  ctx.sala.puntos.push({ id: 'horno', tipo: 'consola', pos: new THREE.Vector3(cx + 1.35, 0, zB + 2.05), giro: -Math.PI / 2 - 0.5, clip: 'Interact' });
  // la pieza: el horno de builds. Se le da al mando de la base (el líquido borbotea y el núcleo se acelera), se mira de
  // cerca con la lupa cómo va la build o se le da un golpe de llave a la tapa
  let shove = 0;
  const revive = () => { shove = 1; };
  const ovenToward = (x: number, z: number) => Math.atan2(cx - x, zB + 1.15 - z);
  ctx.sala.puntos.push({ id: 'horno-mando', tipo: 'pieza', pos: new THREE.Vector3(cx + 0.95, 0, zB + 2.2), giro: ovenToward(cx + 0.95, zB + 2.2),
    acciones: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'lupa', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  ctx.sala.puntos.push({ id: 'horno-tapa', tipo: 'pieza', pos: new THREE.Vector3(cx - 0.95, 0, zB + 2.2), giro: ovenToward(cx - 0.95, zB + 2.2),
    acciones: [{ clip: 'Working_C', utensil: 'llave', onMake: revive }, { clip: 'Interact', onMake: revive }] });
  // panel de estado de la sala (en la pared, a la derecha del horno)
  const panel = new PanelRoom(); panel.color = v.pantalla;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [2.3, 2.15, zB + 0.6], ancho: 1.55, estatico: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brillo: 1.25, margin: 0.94 }); ctx.aparato('panel', framePanel);
  // armario de servidores con pilotos (rompe la simetría del centro)
  P(R.sf('Props_Capsule'), { pos: [2.2, 0, zB + 0.55], alto: 1.55 });
  const pilotos = mountPilots(g, new THREE.Vector3(2.2, 0.95, zB + 1.0), v.pantalla);

  // ---- DERECHA: litera, corcho de notas, planta y bodegón
  P(R.casa('Bed_Bunk'), { pos: [4.55, 0, zB + 1.0], alto: 2.45, rot: Math.PI / 2 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(2.85, zB), new THREE.Vector2(6, zB + 1.8)));
  ctx.sala.puntos.push({ id: 'cama', tipo: 'cama', pos: new THREE.Vector3(4.55, 0.66, zB + 1.02), giro: Math.PI / 2, clip: 'Lie_Idle' });
  const notas = [{ texto: 'NO TOCAR main', color: '#f2e37a' }, { texto: 'PR #42 «revisar sin miedo»', color: '#f6b3a8' }, { texto: 'turno de café: tú', color: '#b8e3a4' }, { texto: 'el linter tiene razón (otra vez)', color: '#a9d4f0' }, { texto: '¿quién dejó un TODO aquí?', color: '#f2e37a' }];
  signInWall(g, corcho(notas, semilla), 4.6, 3.05, 1.6, 1.06, zB + 0.33);
  signInWall(g, cartel(['EL CÓDIGO', 'QUE NO', 'SE PRUEBA', 'SE REZA'], 'COMITÉ DE CALIDAD · WORK-SHELTER', '#d8c8a0', '#7a2a1e', 'ojo', semilla), 1.45, 2.3, 0.6, 0.84, zB + 0.33, 0.03);
  P(R.casa('Houseplant_3'), { pos: [3.15, 0, zB + 0.45], alto: 1.0 });
  P(R.herr('fishing_tacklebox'), { pos: [3.35, 0, 0.75], escala: K * 0.75, rot: -0.5 });
  P(R.sv('GasCan'), { pos: [5.6, 0, 1.15], alto: 0.6, rot: 0.6 });
  P(R.resource('Containers_Box_Medium'), { pos: [5.25, 0, 0.35], escala: K * 0.9, rot: 0.2 });
  P(R.sv('Backpack'), { pos: [4.45, 0, 0.55], alto: 0.62, rot: -0.9 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(4.0, 0.0), new THREE.Vector2(6, 1.6)));

  // ---- primer plano: tubería baja tirada en el suelo delante y caja cortada por el borde (cuarta capa)
  P(R.cy('Pipe_2'), { pos: [-3.9, 0.0, BACKGROUND / 2 - 0.2], ancho: 3.6, variant: vCopper }).then(o => { o.scale.y *= 0.55; o.scale.z *= 0.55; });
  P(R.sv('Trashcan'), { pos: [-5.65, 0, 1.3], alto: 0.75 });
  P(R.casa('Kitchen_Cabinet1'), { pos: [5.62, 0, zB + 0.42], alto: 1.9, rot: -Math.PI / 2 + 0.2 });
  P(R.resource('Fuel_C_Barrels'), { pos: [-5.5, 0, 0.3], escala: K * 0.6, rot: 0.3 });   // delante del archivador, sin meterse bajo la mesa
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, -0.25), new THREE.Vector2(-5.0, 0.85)));
  P(R.herr('bucket_metal'), { pos: [-5.1, 0, 1.75], escala: K * 0.6 });
  P(R.sf('Props_Crate'), { pos: [5.75, 0, BACKGROUND / 2 - 0.35], alto: 0.7, rot: 0.4 });
  mancha(g, -1.0, -0.6, 1.4, 4); mancha(g, 2.4, 0.2, 1.0, 9); mancha(g, -3.0, 1.5, 0.8, 13);


  ctx.sala.walkZones = [[-2.6, -2.2], [1.8, 2.7]];
  ctx.panel = panel;
  ctx.sparks = new THREE.Vector3(-1.75, 1.6, zB + 1.25);
  ctx.lamparas = [{ x: -2.6, z: 0.45, o: { intensidad: 80, goal: [-2.9, 0.4] } }, { x: -0.35, z: 0.6, o: { intensidad: 95, sombra: true, goal: [-0.6, 0.9] } }, { x: 2.95, z: 0.7, o: { intensidad: 62, goal: [2.8, 0.9] } }];
  // la cápsula ilumina su entorno (ancla de luz puntual de color: la enciende el reparto global)
  const anchor = { tipo: 'punto' as const, pos: new THREE.Vector3(cx, 1.6, zB + 1.9), intensidad: 6, color: new THREE.Color(COLOR_LIQ), distancia: 5.5, prioridad: 2 };
  ctx.sala.anclas.push(anchor);
  ctx.onState(e => {
    liquid.uniforms.uColor.value.copy(new THREE.Color(e === 'esperando' ? '#ff9a1f' : e === 'error' ? '#ff3a2a' : e === 'sin-sesion' ? '#1f5a35' : COLOR_LIQ));
    anchor.color.copy(liquid.uniforms.uColor.value);
    burbujas.color(liquid.uniforms.uColor.value);
  });
  ctx.alActualizar((dt, t, a) => {
    shove = Math.max(0, shove - dt * 0.6);
    liquid.uniforms.uTiempo.value = t; liquid.uniforms.uForce.value = 0.45 + a * 0.4 + shove * 0.45 + (ctx.sala.estado === 'esperando' ? 0.25 * (Math.sin(t * 6) > 0 ? 1 : 0) : 0);
    anchor.intensidad = 3 + a * 4 + Math.sin(t * 3) * 0.5;
    core.rotation.y += dt * (0.4 + a * 2.5 + shove * 6); core.position.y = 1.45 + Math.sin(t * 1.2) * 0.06;
    burbujas.rhythm = 6 + a * 30 + shove * 60; burbujas.actualizar(dt);
    fan.rotation.z -= dt * (4 + a * 14);
    pilotos(t, a);
    if (ctx.sala.estado === 'trabajando' && Math.random() < dt * (0.15 + a)) {
      const phrases = ['✓ tipos correctos', 'compilando módulos…', 'tests: 38 pasan', 'git diff --stat', 'leyendo componentes', 'vite: listo en 412 ms'];
      panel.lineas.push('> ' + phrases[Math.floor(Math.random() * phrases.length)]);
    }
  });
}
