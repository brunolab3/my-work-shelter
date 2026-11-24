// Sala de repositorio «escaparate» (estilo landing): in the middle the dweller's desk under the task board; left, the
// product totem showing the landing, with display spotlights; right, the brand's mascot and the «user testing» sofa.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom } from '../../engine/textures';
import { canvas, textureOf, SOURCES } from '../../engine/textures';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, stain, highBand, screenReal, centralDesk, surface, aWall, type Context } from './common';

export async function furnishShowcase(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  // el amarillo de las paredes del escaparate, en ocre apagado: a plena luz era lo que subía la sala por encima de 70
  { const copies = new Map<THREE.Material, THREE.Material>();
    g.traverse((n: any) => { if (!n.isMesh || Array.isArray(n.material) || !/^(Accent|Orange|Main|Main2)$/.test(n.material.name)) return;
      if (!copies.has(n.material)) { const m = n.material.clone(); m.color.multiplyScalar(/^(Main|Main2)$/.test(n.material.name) ? 0.8 : 0.62); copies.set(n.material, m); }
      n.material = copies.get(n.material)!; }); }
  await highBand(ctx, { timer: 4.9, valves: [-4.2], segments: [[-4.8, 2.4], [4.9, 2.2]] });   // ninguna tubería por delante del tablero
  // rótulo luminoso de la marca sobre el tablero de tareas: es un escaparate
  const { c: cl, g: gl } = canvas(768, 160);
  gl.fillStyle = '#120d06'; gl.fillRect(0, 0, 768, 160); gl.strokeStyle = '#d1a43a'; gl.lineWidth = 6; gl.strokeRect(6, 6, 756, 148);
  gl.fillStyle = '#ffd36a'; gl.shadowColor = '#ffb000'; gl.shadowBlur = 26; gl.font = `900 96px ${SOURCES.title}`; gl.textAlign = 'center'; gl.textBaseline = 'middle'; gl.fillText('PURIFICADOR', 384, 86, 720); gl.shadowBlur = 0;
  const texLogo = textureOf(cl);
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.52), new THREE.MeshStandardMaterial({ map: texLogo, emissiveMap: texLogo, emissive: '#ffffff', emissiveIntensity: 0.9, color: '#000' }));
  logo.position.set(0, 3.93, zB + 0.9); logo.renderOrder = 2; g.add(logo);   // con aire sobre el tablero
  ctx.onUpdate((dt, t) => { (logo.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.85 + (Math.sin(t * 23) > 0.97 ? -0.4 : 0) + Math.sin(t * 2) * 0.05; });
  // left: the display dais with the product totem (the pack's column with the landing on screen), product boxes at
  // its feet and two low spotlights pointed at it
  const cx = -3.65;
  const platform = await place(g, R.sf('Props_Base'), { pos: [cx, 0, zB + 1.3], width: 1.75 });
  const yT = surface(platform, g, cx, zB + 1.3) ?? 0.29;   // tablero de la tarima, medido
  const totem = await place(g, R.sf('Props_Computer'), { pos: [cx, yT, zB + 1.3], height: 1.8, isStatic: false, own: true, variant: v });
  // la pantalla del tótem es vertical: la landing en versión móvil (cabecera, titular, botón, imagen y bloques)
  const { c: cTot, g: gTot } = canvas(200, 560);
  { const G = gTot; G.fillStyle = '#f6d77a'; G.fillRect(0, 0, 200, 560); G.fillStyle = '#2a1c08';
    G.fillRect(14, 16, 46, 10); for (let i = 0; i < 3; i++) G.fillRect(150, 14 + i * 6, 34, 3);
    const [l1, l2, l3, l4] = t('world.landing.mobile').split('|');
    G.font = `900 40px ${SOURCES.title}`; G.fillText(l1, 14, 88); G.fillText(l2, 14, 128);
    G.font = `500 13px ${SOURCES.mono}`; G.globalAlpha = 0.75; G.fillText(l3, 14, 152); G.fillText(l4, 14, 168); G.globalAlpha = 1;
    G.fillStyle = '#2a1c08'; G.fillRect(14, 184, 120, 30); G.fillStyle = '#f6d77a'; G.font = `700 13px ${SOURCES.mono}`; G.fillText(t('world.tex.bookIt'), 22, 204);
    G.fillStyle = '#2a1c08'; G.beginPath(); G.arc(100, 300, 62, 0, 7); G.fill(); G.fillStyle = '#e2602b'; G.beginPath(); G.arc(124, 278, 20, 0, 7); G.fill();
    G.globalAlpha = 0.14; for (let i = 0; i < 3; i++) G.fillRect(14, 388 + i * 56, 172, 46); G.globalAlpha = 1;
    G.fillStyle = '#2a1c08'; G.font = `700 12px ${SOURCES.mono}`; ['Filtros', 'Modelos', 'Precios'].forEach((t, i) => G.fillText(t, 24, 416 + i * 56)); }
  const pTotem = textureOf(cTot);
  const plTotem = overlayScreen(totem, /^Black$/, pTotem, { brightness: 0.6, margin: 0.94 });
  const matsTotem = plTotem ? [plTotem.material as THREE.MeshStandardMaterial] : [];
  for (const x of [-0.6, 0.6]) ctx.restsOn(platform, R.cy('Light_Square'), { pos: [cx + x, 0, zB + 1.25], height: 0.5, rot: 0.785 });   // balizas de vitrina
  ctx.restsOn(platform, R.resource('Containers_Box_Small'), { pos: [cx + 0.38, 0, zB + 1.78], height: 0.22, rot: 0.35 });
  ctx.restsOn(platform, R.resource('Containers_Box_Small'), { pos: [cx - 0.36, 0, zB + 1.8], height: 0.18, rot: -0.5 });
  P(R.home('Light_Stand1'), { pos: [cx - 1.3, 0, zB + 1.55], height: 1.5, rot: 0.9 });
  P(R.home('Light_Stand1'), { pos: [cx + 1.3, 0, zB + 1.55], height: 1.5, rot: -0.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(cx - 1.6, zB), new THREE.Vector2(cx + 1.6, zB + 2.2)));
  // la pieza: el tótem. Se toca su pantalla (cambia de versión con un destello), se repasan las notas de diseño o se le
  // da al mando del costado
  let flare = 0;
  const play = () => { flare = 1; };
  const towardTotem = (x: number, z: number) => Math.atan2(cx - x, zB + 1.3 - z);
  ctx.room.points.push({ id: 'totem', type: 'piece', pos: new THREE.Vector3(cx + 0.62, 0, zB + 2.4), rotation: towardTotem(cx + 0.62, zB + 2.4),
    actions: [{ clip: 'Interact', onMake: play }, { clip: 'Holding_A', utensil: 'journal', dur: 4 }, { clip: 'Use_Item', onMake: play }] });
  ctx.room.points.push({ id: 'totem-2', type: 'piece', pos: new THREE.Vector3(cx - 0.62, 0, zB + 2.4), rotation: towardTotem(cx - 0.62, zB + 2.4),
    actions: [{ clip: 'Interact', onMake: play }, { clip: 'Waving' }] });
  // the design desk in the middle, under the task board: monitor with the changes, keyboard, pencils and a cactus
  const pDesign = new PhosphorScreen(384, 256, v.screen); pDesign.speed = 30;
  screenReal(ctx, pDesign, 'changes'); ctx.room.screens.push(pDesign);
  await centralDesk(ctx, { id: 'chair', tex: pDesign.tex,
    onTop: [{ path: R.furniture('cup_pencils'), x: 0.72, z: -0.22, c: { scale: K * 0.6 } }, { path: R.furniture('cactus_small_A'), x: -0.72, z: -0.2, c: { scale: K * 0.7 } }, { path: R.furniture('mug_A'), x: -0.6, z: 0.24, c: { scale: K * 0.7, rot: 0.5 } }] });
  P(R.home('Houseplant_6'), { pos: [-5.5, 0, zB + 0.6], height: 1.1 });
  P(R.furniture('shelf_B_large_decorated'), { pos: [-2.55, 2.45, zB + 0.35], scale: K * 0.8 }).then(o => aWall(g, o));
  // derecha: sofá de pruebas de usuario frente a una pantalla, con mesa baja y cartel
  P(R.furniture('couch_pillows'), { pos: [4.3, 0, zB + 0.95], scale: K, rot: -0.15, own: true }).then(o => o.traverse((n: any) => { if (n.isMesh) n.material.color.multiplyScalar(0.72); }));   // mostaza apagada
  P(R.furniture('table_low_decorated'), { pos: [4.0, 0, 0.45], scale: K * 0.8, rot: -0.15 });
  P(R.furniture('lamp_standing'), { pos: [5.6, 0, zB + 0.6], scale: K });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(2.9, zB), new THREE.Vector2(6, zB + 1.9)), new THREE.Box2(new THREE.Vector2(3.2, 0.0), new THREE.Vector2(4.8, 0.95)));
  ctx.room.points.push({ id: 'sofa', type: 'chair', pos: new THREE.Vector3(4.0, 0.05, zB + 1.25), rotation: -0.15, clip: 'Sit_Chair_Idle' });
  signInWall(g, sign(t('world.poster.growth'), t('world.poster.growthFoot'), '#f0d98a', '#2a1c08', 'bolt', seed), 3.2, 2.6, 0.6, 0.84, zB + 0.33, -0.03);
  // the brand's mascot on its plinth: a statue, polished by hand
  P(R.sf('Props_Statue'), { pos: [2.55, 0, zB + 0.55], height: 1.6, rot: -0.3 });
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(2.0, 0, zB + 1.4), rotation: 0.5, clip: 'Working_A' });
  // panel de estado de la sala (encima del sofá)
  const panel = new PanelRoom(); panel.title = 'ESCAPARATE'; panel.color = v.screen;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [4.5, 3.25, zB + 0.6], width: 1.55, isStatic: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brightness: 1.2, margin: 0.94 });
  ctx.panel = panel;
  // detalle de suelo y primer plano
  P(R.resource('Containers_Box_Small'), { pos: [-5.6, 0, 1.85], scale: K * 0.9, rot: 0.4 });
  P(R.sv('Can_Red'), { pos: [5.7, 0, 1.75], height: 0.35 });
  stain(g, 1.2, 0.6, 1.0, seed + 3);
  ctx.room.walkZones = [[-1.9, -1.3], [1.3, 1.9]];
  ctx.vapor = { pos: new THREE.Vector3(-4.2, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(2.55, 1.4, zB + 0.9);
  // the middle lamp hangs to one side of the sign, so it doesn't cross the letters
  ctx.lamps = [{ x: cx, z: 0.4, o: { intensity: 80, goal: [cx, -0.9] } }, { x: 1.65, z: 0.8, o: { intensity: 110, shadow: true, corta: true, goal: [0, -0.9] } }, { x: 3.9, z: 0.5, o: { intensity: 75 } }];
  let rotation = 0;
  ctx.onUpdate((dt, t, a) => {
    rotation += dt * (0.35 + a * 1.2); totem.rotation.y = Math.sin(rotation * 0.5) * 0.22;   // el tótem oscila hacia uno y otro lado del escaparate
    flare = Math.max(0, flare - dt * 1.5);
    for (const m of matsTotem) m.emissiveIntensity = 0.6 + flare * 1.4;
    if (ctx.room.state === 'working' && Math.random() < dt * (0.12 + a)) panel.lines.push('> ' + tr('world.landing.log').split('|')[Math.floor(Math.random() * 4)]);
  });
}
