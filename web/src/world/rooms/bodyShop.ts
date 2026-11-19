// Chapa y Pintura, en la planta de ocio: la barbería y ropería del refugio. A la izquierda, la barbería: el sillón
// giratorio frente al espejo y el lavacabezas, el poste de barbero girando y Fito con las tijeras. A la derecha, la
// ropería: un escaparate de maniquíes vestidos con piezas del probador (cambian de modelito cada poco), la sombrerera con
// sombreros de verdad del catálogo y la cabina de prueba con su cortina. Sentarse en el sillón abre el probador.
import { t, tIs } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, canvas, textureOf, PhosphorScreen } from '../../engine/textures';
import { signInWall, stain, box, materialSteel, workStation, lying, aWall, surface, type Context } from './common';
import { textureNeon } from './disco';
import { Character } from '../character';
import { PIECES, FABRICS, type Look } from '@shared/appearance';
import { chunks } from '../figure/sources';

const GREEN = '#5fe0b0';

// poste de barbero: el cilindro de franjas que gira (la textura se desplaza), con sus remates de latón
function pole(g: THREE.Group, x: number, y: number, z: number) {
  const { c, g: x2 } = canvas(128, 256);
  x2.fillStyle = '#f2ece0'; x2.fillRect(0, 0, 128, 256);
  for (let k = -4; k < 8; k++) for (const [col, d] of [['#b8322b', 0], ['#2d4f8a', 32]] as const) {
    x2.fillStyle = col; x2.beginPath(); const y0 = k * 64 + d;
    x2.moveTo(0, y0); x2.lineTo(128, y0 - 64); x2.lineTo(128, y0 - 64 + 18); x2.lineTo(0, y0 + 18); x2.fill();
  }
  const tex = textureOf(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 1.6);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 28, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }));
  glass.position.set(x, y, z); glass.userData.isStatic = false; g.add(glass);
  const brass = materialSteel('#b08a3e');
  for (const dy of [-0.38, 0.38]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 24), brass); r.position.set(x, y + dy, z); g.add(r); }
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), brass); ball.position.set(x, y + 0.48, z); g.add(ball);
  g.add(box(0.05, 0.05, 0.16, brass, x, y, z - 0.12));
  return tex;
}

// un maniquí del escaparate: cabeza de maniquí y un modelito al azar del probador, quieto en su pose
function outfit(r: () => number): Look {
  const from = (slot: string) => PIECES.filter(p => p.slot === slot && p.especie !== 'robot');
  const pick = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  const torso = pick(from('torso'));
  const same = (slot: string) => from(slot).find(p => p.source === torso.source) ?? pick(from(slot));
  const pieces: Look['pieces'] = { torso: torso.id, brazos: same('brazos').id, piernas: (r() < 0.6 ? same('piernas') : pick(from('piernas'))).id };
  if (r() < 0.45) pieces.sombrero = pick(from('sombrero').filter(p => !p.breakdown)).id;
  if (r() < 0.25) pieces.espalda = pick(from('espalda')).id;
  return { especie: 'humano', pieces, colors: { piel: '#cdbfa6', ...(r() < 0.6 ? { torso1: pick(FABRICS) } : {}), ...(r() < 0.4 ? { piernas1: pick(FABRICS) } : {}) } };
}

export async function furnishBodyshop(ctx: Context) {
  const { g, zB, K, P, seed } = ctx;
  let s = seed * 7919 + 1; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

  // ---- rótulo de neón al fondo, en el centro
  const matNeon = new THREE.MeshBasicMaterial({ map: textureNeon(tIs('CHAPA Y PINTURA'), t('world.chapa.neonSub'), GREEN), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.88), matNeon); neon.position.set(-0.1, 3.02, zB + 0.36); neon.userData.isStatic = false; g.add(neon);

  // ---- barbería (izquierda): espejo, lavacabezas, sillón giratorio, poste y Fito
  const xS = -3.3;
  // el espejo, que parezca espejo (la luna del pack es blanca lisa): metal pulido que refleja el entorno
  place(g, R.home('Bathroom_Mirror1'), { pos: [xS, 1.2, zB + 0.33], height: 1.35, own: true }).then(o => o.traverse((n: any) => {
    if (n.isMesh && n.material?.name === 'Mirror') { n.material.color.set('#b7cad3'); n.material.metalness = 1; n.material.roughness = 0.06; n.material.envMapIntensity = 1.4; n.material.emissive = new THREE.Color('#1c2a30'); }
  }));
  P(R.home('Bathroom_Sink'), { pos: [xS - 1.45, 0, zB + 0.55], height: 0.95 });
  P(R.home('Bathroom_Towel'), { pos: [xS - 1.45, 1.35, zB + 0.33], height: 0.55 });
  const armchair = await place(g, R.furniture('chair_desk_A'), { pos: [xS, 0, zB + 1.3], scale: K * 1.15, rot: 0.25, isStatic: false }); ctx.device('sillon', armchair);
  P(R.furniture('rug_oval_B'), { pos: [xS, 0.005, zB + 1.4], scale: K * 1.3 });
  const dresser = P(R.furniture('cabinet_small_decorated'), { pos: [xS + 1.3, 0, zB + 0.5], scale: K * 0.95 });
  ctx.restsOn(dresser, R.tools('scissors'), { pos: [xS + 1.25, 0, zB + 0.68], scale: 0.5, ...lying(1.2) });
  for (const k of [0, 1]) ctx.restsOn(dresser, R.kitchen('papertowel'), { pos: [xS + 1.45 + k * 0.2, 0, zB + 0.42], scale: K * 0.55 }, { since: 1.1 });
  const texPost = pole(g, -5.45, 1.75, zB + 0.48);
  P(R.home('Light_Floor1'), { pos: [-5.45, 0, zB + 1.2], height: 1.75 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-5.9, zB), new THREE.Vector2(-2.0, zB + 0.95)));
  // Fito corta junto al sillón, tijeras en mano
  ctx.room.points.push({ id: 'tijeras', type: 'aficion', pos: new THREE.Vector3(xS + 0.95, 0, zB + 1.35), rotation: -1.1, clip: 'Holding_B', utensil: 'tijeras', gesture: { clip: 'Use_Item', every: 6 } });
  // la pieza: el sillón del barbero. Se le da media vuelta (gira), se repasa con las tijeras o se ajusta su palanca
  let turn = 0; const rotate = () => { turn = 1; };
  ctx.room.points.push({ id: 'sillon', type: 'pieza', pos: new THREE.Vector3(xS - 0.85, 0, zB + 1.5), rotation: Math.PI / 2 - 0.2,
    actions: [{ clip: 'Interact', onMake: rotate }, { clip: 'Use_Item', utensil: 'tijeras' }, { clip: 'Working_C', utensil: 'llave', onMake: rotate }] });
  signInWall(g, sign(t('world.poster.bodyShop'), t('world.poster.bodyShopFoot'), '#e2efe6', '#1f4a3a', 'mano', seed), -1.55, 2.0, 0.5, 0.7, zB + 0.33, 0.02);

  // ---- ropería (derecha): escaparate de maniquíes sobre una tarima, sombrerera y cabina de prueba
  const platform = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.14, 1.0), new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.6 }));
  platform.position.set(2.45, 0.07, zB + 0.85); platform.receiveShadow = true; g.add(platform);
  g.add(box(3.34, 0.03, 1.04, materialSteel('#b08a3e'), 2.45, 0.155, zB + 0.85));
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(0.75, zB), new THREE.Vector2(4.15, zB + 1.4)));
  const mannequins: { p: Character | null; x: number }[] = [1.35, 2.45, 3.55].map(x => ({ p: null, x }));
  const dress = async (m: { p: Character | null; x: number }) => {
    const p = new Character('maniqui', outfit(r)); p.inRest = 'Idle_A'; p.mannequin = true;
    await p.load();
    p.play('Idle_A', 0); p.mixer.update(0.2);
    p.root.position.set(m.x, 0.17, zB + 0.85); p.root.rotation.y = (m.x - 2.45) * -0.25; p.goalTurn = p.root.rotation.y;
    p.contactShadow.visible = false; p.root.userData.isStatic = false;
    if (m.p) g.remove(m.p.root);
    m.p = p; g.add(p.root);
  };
  await Promise.all(mannequins.map(dress));

  // sombrerera: baldas en la pared con sombreros de verdad del probador, dos en cada una
  const shelves = [1.4, 2.0, 2.6], xB = 4.95;
  const racks = await Promise.all(shelves.map(y => place(g, R.furniture('shelf_B_large'), { pos: [xB, y - 0.2 * K, zB + 0.33], scale: K * 0.85, anchor: 'atras' })));
  for (const e of racks) aWall(g, e);
  // la cara de arriba de cada balda, medida ahora (los sombreros llegan después, cuando la sala ya está fusionada)
  const yHat = racks.map((e, i) => [-0.42, 0.42].map(dx => surface(e, g, xB + dx, zB + 0.52) ?? shelves[i]));
  const hats = ['sombrero.Hiker.Hat', 'sombrero.Witch.Hat', 'sombrero.Farmer_B.Hat', 'sombrero.Helper_A.Hat', 'sombrero.ToySoldier.Hat', 'sombrero.Mage.Hat'];
  hats.forEach(async (id, k) => {
    const p = PIECES.find(x => x.id === id); if (!p) return;
    const [t] = await chunks(p); if (!t) return;
    const mat = (Array.isArray(t.mesh.material) ? t.mesh.material[0] : t.mesh.material) as THREE.Material;
    const m = new THREE.Mesh(t.geo, mat); m.castShadow = true;
    const box3 = new THREE.Box3().setFromBufferAttribute(t.geo.attributes.position as THREE.BufferAttribute);
    const size = box3.getSize(new THREE.Vector3()), center = box3.getCenter(new THREE.Vector3());
    const e = 0.38 / Math.max(size.x, size.z); m.scale.setScalar(e);
    m.position.set(-center.x * e, -box3.min.y * e, -center.z * e);
    const o = new THREE.Group(); o.add(m); o.userData.isStatic = false;
    o.position.set(xB - 0.42 + (k % 2) * 0.84, yHat[Math.floor(k / 2)][k % 2] + 0.003, zB + 0.52); o.rotation.y = 0.35 - (k % 2) * 0.7;
    g.add(o);   // cada sombrero, apoyado en su balda (la altura medida)
  });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(4.2, zB), new THREE.Vector2(5.9, zB + 0.75)));
  signInWall(g, sign(t('world.poster.wardrobe'), t('world.poster.wardrobeFoot'), '#efe4c8', '#2d4f3f', 'engranaje', seed + 3), 0.45, 2.15, 0.48, 0.66, zB + 0.33, -0.02);

  // ---- el puesto: la mesa de corte de la ropería, de pie (un mueble bajo con cajones, a la altura de las manos), con
  // el monitor del catálogo, tela, tijeras y la cinta
  const pCatalog = new PhosphorScreen(384, 256, GREEN, t('world.chapa.catalog')); pCatalog.speed = 20;
  pCatalog.write([t('world.chapa.nTorsos', { n: PIECES.filter(p => p.slot === 'torso').length }), t('world.chapa.nHats', { n: PIECES.filter(p => p.slot === 'sombrero').length }), t('world.chapa.nFabrics', { n: FABRICS.length }), t('world.chapa.fittingRoom')]); ctx.room.screens.push(pCatalog);
  await workStation(ctx, { id: 'corte', x: 4.8, z: 0.2, rotation: -0.9, ofFoot: true, desk: R.furniture('cabinet_medium'), deskScale: 1.12, tex: pCatalog.tex, brightness: 1.0, keyboard: true,
    onTop: [{ path: R.furniture('rug_rectangle_stripes_A'), x: -0.45, z: 0.15, c: { width: 0.62, rot: 0.15 } }, { path: R.tools('scissors'), x: 0.55, z: 0.15, c: { scale: 0.5, ...lying(-0.7) } }, { path: R.tools('rope_bundle_B'), x: -0.7, z: -0.2, c: { scale: K * 0.35 } }] });

  // ---- vida: el poste gira, el neón zumba y el escaparate se cambia de ropa de vez en cuando
  let timer = 30 + r() * 20, nextTurn = 0;
  ctx.onUpdate((dt, t) => {
    turn = Math.max(0, turn - dt * 0.7);
    armchair.rotation.y = 0.25 + Math.sin((1 - turn) * Math.PI) * turn * 1.6;
    texPost.offset.y = (t * 0.35) % 1;
    const fail = Math.sin(t * 11.3) * Math.sin(t * 2.7) > 0.93;
    matNeon.opacity = fail ? 0.3 : 0.92 + 0.08 * Math.sin(t * 50);
    timer -= dt;
    if (timer < 0) { timer = 40 + r() * 30; dress(mannequins[nextTurn++ % mannequins.length]); }
  });

  // ---- luz: cálida de barbería en el sillón, fría de escaparate en los maniquíes
  ctx.room.anchors.push({ type: 'foco', pos: new THREE.Vector3(2.45, 4.1, 0.6), goal: new THREE.Vector3(2.45, 0.9, zB + 0.85), intensity: 30, color: new THREE.Color('#dfeaff'), angle: 0.6, penumbra: 0.5, distance: 7, priority: 1.2 });
  ctx.lamps = [{ x: -3.3, z: 0.6, o: { intensity: 48, shadow: true, corta: true } }, { x: 0.2, z: 1.0, o: { intensity: 36, color: '#ffe2b8', corta: true } }];
  stain(g, -2.2, 1.4, 0.9, seed);
  ctx.room.walkZones = [[-1.6, 0.6], [0.8, 3.2]];
}
