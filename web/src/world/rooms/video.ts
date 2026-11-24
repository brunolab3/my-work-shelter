// Sala de repositorio «sala de proyección» (estilo vídeo). Left third: cinema, con la pantalla grande en alto
// (fotograma y, debajo, la línea de tiempo del render), telón a los lados y dos filas rectas de butacas tapizadas
// (sillón del pack estrechado: respaldo y brazos de verdad), and the projector hanging beside the task board (bobinas
// que giran y haz visible hasta la pantalla). Middle: the editing desk with two monitors and the clapperboard, under the
// task board. Right: the film camera on its tripod and the render rack with its pilots.
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, makeFrame, TimeLine, canvas, textureOf, SOURCES } from '../../engine/textures';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, stain, highBand, HEIGHT, screenReal, mountPilots, centralDesk, lean, aWall, type Context } from './common';

// repinta un modelo con materiales propios: { nombreDeMaterial: color } ('*' para todos los demás)
function repaint(o: THREE.Object3D, colors: Record<string, string>, roughness = 0.85) {
  o.traverse((m: any) => {
    if (!m.isMesh) return;
    for (const mt of ([] as THREE.MeshStandardMaterial[]).concat(m.material)) {
      const c = colors[mt.name] ?? colors['*']; if (!c) continue;
      mt.map = null; mt.color.set(c); mt.roughness = roughness; mt.metalness = 0.05; mt.needsUpdate = true;
    }
  });
  return o;
}

// pirámide de luz desde el objetivo hasta las cuatro esquinas de la pantalla: aditiva, sin escribir profundidad,
// brillante junto al proyector y casi apagada al llegar a la pantalla
function projectorBeam(apex: THREE.Vector3, corners: THREE.Vector3[], color: string, shrinks = 1) {
  const c0 = new THREE.Color(color), c1 = new THREE.Color(color).multiplyScalar(0.06);
  const center = corners.reduce((a, e) => a.add(e), new THREE.Vector3()).multiplyScalar(1 / corners.length);
  const es = corners.map(e => e.clone().lerp(center, 1 - shrinks));
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = es[i], b = es[(i + 1) % 4];
    pos.push(apex.x, apex.y, apex.z, a.x, a.y, a.z, b.x, b.y, b.z);
    col.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b, c1.r, c1.g, c1.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.renderOrder = 3; m.userData.isStatic = false; m.frustumCulled = false;
  return m;
}

// motas de polvo que solo existen dentro del haz (se ven porque las ilumina)
function beamSpecks(apex: THREE.Vector3, corners: THREE.Vector3[], n = 70) {
  const { c, g } = canvas(32, 32); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const t = new Float32Array(n), u = new Float32Array(n), w = new Float32Array(n), phase = new Float32Array(n);
  for (let i = 0; i < n; i++) { t[i] = 0.12 + Math.random() * 0.85; u[i] = Math.random(); w[i] = Math.random(); phase[i] = Math.random() * 10; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, map: textureOf(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  points.frustumCulled = false; points.userData.isStatic = false; points.renderOrder = 4;
  const [a, b, , d] = corners; const ex = b.clone().sub(a), ey = d.clone().sub(a);
  const p = new THREE.Vector3(), base = new THREE.Vector3();
  const update = (dt: number, tt: number, strength: number) => {
    for (let i = 0; i < n; i++) {
      t[i] += dt * 0.012; u[i] += Math.sin(tt * 0.3 + phase[i]) * dt * 0.01; w[i] += dt * (0.006 + 0.004 * Math.sin(phase[i]));
      if (t[i] > 0.97 || u[i] < 0.03 || u[i] > 0.97 || w[i] > 0.97) { t[i] = 0.12 + Math.random() * 0.2; u[i] = 0.05 + Math.random() * 0.9; w[i] = 0.05 + Math.random() * 0.5; }
      base.copy(a).addScaledVector(ex, u[i]).addScaledVector(ey, w[i]);
      p.copy(apex).lerp(base, t[i]);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const brightness = (1 - t[i]) * (0.55 + 0.45 * Math.sin(tt * 2 + phase[i])) * strength;
      col[i * 3] = brightness; col[i * 3 + 1] = brightness * 0.95; col[i * 3 + 2] = brightness * 1.1;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  };
  return { points, update };
}

// claqueta: la pizarra del pack con su cara pintada (franjas y tiza)
function clapperboardTexture() {
  const { c, g } = canvas(256, 220);
  g.fillStyle = '#16161a'; g.fillRect(0, 0, 256, 220);
  for (let i = -2; i < 12; i++) { g.fillStyle = i % 2 ? '#e8e2d4' : '#16161a'; g.beginPath(); g.moveTo(i * 26, 0); g.lineTo(i * 26 + 26, 0); g.lineTo(i * 26 + 8, 44); g.lineTo(i * 26 - 18, 44); g.fill(); }
  g.fillStyle = '#e8e2d4'; g.fillRect(0, 50, 256, 3); g.fillRect(0, 118, 256, 2); g.fillRect(128, 53, 2, 65);
  g.font = `700 22px ${SOURCES.label}`; g.textBaseline = 'middle';
  const [scene, take] = tr('world.video.slate').split('|'); g.fillText(scene, 12, 72); g.fillText(take, 140, 72);
  g.font = `800 42px ${SOURCES.title}`; g.fillText('1', 30, 100); g.fillText('3', 160, 100);
  g.font = `700 20px ${SOURCES.label}`; g.fillText('PROMO 30 S', 12, 145); g.fillText('DIR. WORK-SHELTER', 12, 175);
  return textureOf(c);
}

export async function furnishProjection(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  const ps: Promise<unknown>[] = [];
  const photos = [0, 1, 2, 3].map(n => makeFrame(n, 640, 360));

  // ================================================================ CINEMA (left third)
  const cx = -3.85;                     // eje de la pantalla y de las butacas
  const imgW = 2.3, imgH = 1.3, imgY = 3.22, stripH = 0.3, stripY = 2.24;   // la pantalla va en alto: las cabezas del público quedan por debajo de la línea de tiempo
  const zP = zB + 0.47;
  // marco: un cartel del pack, ensanchado, con la cara en negro mate
  const yUp = imgY + imgH / 2, yBelow = stripY - stripH / 2;
  const frame = await place(g, R.cy('Sign_1'), { pos: [cx, (yUp + yBelow) / 2, zB + 0.38], width: imgW + 0.3, anchor: 'center', own: true, shadow: false });
  frame.scale.y = (yUp - yBelow + 0.26) / frame.userData.size.y;
  repaint(frame, { Texture_Signs: '#0b0a0d', Grey: '#2a2527' }, 0.7);
  const largeCanvas = new THREE.Mesh(new THREE.PlaneGeometry(imgW, imgH), new THREE.MeshStandardMaterial({ map: photos[0], emissiveMap: photos[0], emissive: '#ffffff', emissiveIntensity: 0.78, color: '#000' }));
  largeCanvas.position.set(cx, imgY, zP); g.add(largeCanvas);
  const line = new TimeLine();
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(imgW, stripH), new THREE.MeshStandardMaterial({ map: line.tex, emissiveMap: line.tex, emissive: '#ffffff', emissiveIntensity: 0.7, color: '#000' }));
  strip.position.set(cx, stripY, zP); g.add(strip);
  // telón a los dos lados (cortina del pack en terciopelo granate)
  for (const s of [-1, 1]) ps.push(place(g, R.home('Curtains_Single'), { pos: [cx + s * (imgW / 2 + 0.42), 0, zB + 0.42], height: 4.0, own: true }).then(o => { o.scale.x *= 0.62; repaint(o, { Couch_Blue: '#5c1724', LightMetal: '#8c6a3c' }, 0.95); }));
  // la pantalla tiñe un poco la sala (luz de relleno del color del fotograma)
  ctx.room.anchors.push({ type: 'point', pos: new THREE.Vector3(cx, 2.6, zB + 1.5), intensity: 6, color: new THREE.Color('#e7a6c8'), distance: 5, priority: 1 });

  // butacas: dos filas rectas encaradas a la pantalla (de espaldas a cámara); the back one, of two
  const STEP = 0.8;
  const armchair = (x: number, z: number) => place(g, R.home('Couch_Small1'), { pos: [x, 0, z], height: 0.86, rot: Math.PI, own: true })
    .then(o => { o.scale.x = 0.6; repaint(o, { Couch_Blue: '#6e1d2c', Black: '#1b1819' }, 0.9); });
  const aheadRow = [-1.5, -0.5, 0.5, 1.5].map(k => cx + k * STEP), behindRow = [-0.5, 0.5].map(k => cx + k * STEP);
  ps.push(...aheadRow.map(x => armchair(x, -0.55)), ...behindRow.map(x => armchair(x, 0.72)));
  ctx.room.obstacles.push(
    new THREE.Box2(new THREE.Vector2(cx - 2 * STEP - 0.05, -1.05), new THREE.Vector2(cx + 2 * STEP + 0.05, -0.05)),
    new THREE.Box2(new THREE.Vector2(cx - STEP - 0.05, 0.25), new THREE.Vector2(cx + STEP + 0.05, 1.22)));
  // the dweller, in a seat of the back row, watching the screen
  ctx.room.points.push({ id: 'butaca', type: 'hobby', pos: new THREE.Vector3(cx + 0.5 * STEP, 0.05, 0.68), rotation: Math.PI, clip: 'Sit_Chair_Idle' });
  // latas de película apiladas junto al telón
  for (let i = 0; i < 3; i++) P(R.sv('Can_Closed'), { pos: [-5.55 + (i % 2) * 0.05, i * 0.1, zB + 1.15], height: 0.1, width: 0.42, rot: i * 0.7, variant: v });

  // ================================================================ PROJECTION BOOTH AND EDITING (middle and right)
  // proyector colgado del techo (beside the task board): cuerpo (caja del pack), objetivo apuntando a la pantalla y dos bobinas que giran
  const PX = -2.15, PY = 3.6, PZ = zB + 1.35;
  P(R.cy('Support_Short'), { pos: [PX + 0.05, HEIGHT, PZ], height: HEIGHT - PY - 0.2, anchor: 'ceiling', shadow: false });
  ps.push(place(g, R.sf('Props_Crate'), { pos: [PX, PY - 0.22, PZ], height: 0.42, own: true, shadow: false }).then(o => { o.scale.x *= 1.35; repaint(o, { '*': '#2c2a2e' }, 0.6); }));
  const lens = await place(g, R.sf('Details_Cylinder'), { pos: [PX - 0.42, PY - 0.02, PZ], height: 0.2, rotZ: Math.PI / 2, anchor: 'center', shadow: false, own: true });
  repaint(lens, { '*': '#141316' }, 0.4);
  const eye = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2dc').multiplyScalar(2.2) }));
  eye.position.set(PX - 0.53, PY - 0.02, PZ); eye.rotation.y = -Math.PI / 2; g.add(eye);
  const coils: THREE.Object3D[] = [];
  for (const [dx, r] of [[-0.2, 0.46], [0.25, 0.4]] as const) {
    const b = await place(g, R.sf('Details_Output'), { pos: [PX + dx, PY + 0.2 + r / 2, PZ], width: r, anchor: 'center', isStatic: false, own: true, shadow: false });
    b.scale.z *= 2; repaint(b, { '*': '#7c7678' }, 0.35); coils.push(b);
  }
  // haz: del objetivo a la pantalla (dos capas para que tenga borde suave) y motas dentro
  const apex = new THREE.Vector3(PX - 0.55, PY - 0.02, PZ);
  const corner = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => new THREE.Vector3(cx + sx * imgW / 2, imgY + sy * imgH / 2, zP));
  const beam = projectorBeam(apex, corner, '#3a3f52'), core = projectorBeam(apex, corner, '#2c3044', 0.72);
  g.add(beam, core);
  const specks = beamSpecks(apex, corner); g.add(specks.points);

  // luz rasante sobre la parte alta de la pared de la cabina (que no quede en negro)
  ctx.room.anchors.push({ type: 'spot', pos: new THREE.Vector3(2.4, 4.1, zB + 1.7), goal: new THREE.Vector3(2.4, 2.6, zB), intensity: 14, color: new THREE.Color('#ffd2a0'), angle: 0.9, penumbra: 0.8, distance: 6, priority: 0 });
  // cámara de cine en su trípode (tres mástiles de celosía del pack como patas), con las bobinas arriba y el objetivo hacia la sala
  const TX = 2.65, TZ = zB + 1.3, LEG = 1.4, OPENS = 0.2;
  for (const ang of [0.3, 0.3 + 2.1, 0.3 + 4.2]) ps.push(place(g, R.cy('Antenna_1'), { pos: [TX + Math.sin(ang) * LEG * Math.sin(OPENS), 0, TZ + Math.cos(ang) * LEG * Math.sin(OPENS)], height: LEG, own: true }).then(o => {
    o.rotation.order = 'YXZ'; o.rotation.set(-OPENS, ang, 0); repaint(o, { '*': '#3a383c' }, 0.5);
  }));
  const head = new THREE.Group(); head.position.set(TX, LEG * Math.cos(OPENS) - 0.02, TZ); head.rotation.y = 0.55; g.add(head);
  ps.push(place(head, R.sf('Props_Crate'), { pos: [0, 0, 0], height: 0.34, own: true, shadow: false }).then(o => { o.scale.x *= 1.45; repaint(o, { '*': '#232125' }, 0.55); }));
  ps.push(place(head, R.sf('Details_Cylinder'), { pos: [-0.4, 0.17, 0], height: 0.18, rotZ: Math.PI / 2, anchor: 'center', own: true, shadow: false }).then(o => repaint(o, { '*': '#121114' }, 0.35)));
  for (const [dx, r] of [[-0.12, 0.34], [0.2, 0.3]] as const) {
    const b = await place(head, R.sf('Details_Output'), { pos: [dx, 0.34 + r / 2 - 0.02, 0], width: r, anchor: 'center', isStatic: false, own: true, shadow: false });
    b.scale.z *= 2; repaint(b, { '*': '#6c6668' }, 0.35); coils.push(b);
  }
  head.userData.isStatic = false;
  // piloto rojo de grabación (se enciende al renderizar)
  const rec = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#2a0c0c' }));
  rec.position.set(-0.2, 0.28, 0.13); head.add(rec);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(TX - 0.4, TZ - 0.4), new THREE.Vector2(TX + 0.4, TZ + 0.4)));
  // la pieza: la cámara de cine. Se mira por el visor, se le da a la manivela (las bobinas se aceleran y se enciende el
  // piloto de grabación) o se ajusta el objetivo con la llave
  let rolling = 0; const roll = () => { rolling = 2.5; };
  const cameraToward = (x: number, z: number) => Math.atan2(TX - x, TZ - z);
  ctx.room.points.push({ id: 'vault', type: 'piece', pos: new THREE.Vector3(TX + 0.72, 0, TZ + 0.55), rotation: cameraToward(TX + 0.72, TZ + 0.55),
    actions: [{ clip: 'Interact', onMake: roll }, { clip: 'Working_B', onMake: roll }, { clip: 'Use_Item', utensil: 'wrench' }] });

  // the editing desk, in the middle under the task board: two monitors (render and preview), keyboard, the mug and the
  // clapperboard. It's the desk of whoever works in the room
  const MX = 3.6;   // the «RENDERING» sign, over the right-hand side
  const pRender = new PhosphorScreen(384, 256, v.screen, ' render --final'); pRender.speed = 24;
  screenReal(ctx, pRender, 'activity'); ctx.room.screens.push(pRender);
  const workstation = await centralDesk(ctx, { id: 'editing', screen: 'dual', tex: pRender.tex, brightness: 0.55, colorDesk: '#8c7466',
    onTop: [{ path: R.furniture('mug_A'), x: -0.78, z: 0.22, c: { scale: K * 0.75 } }] });
  for (const m of workstation.monitors) m.traverse((n: any) => { if (n.isMesh && !n.material.emissiveMap) { n.material = n.material.clone(); n.material.color.set('#34333a'); n.material.roughness = 0.6; } });
  const previous = screenFrontal(workstation.monitors[1], photos[1], { width: 0.84, height: 0.66, cy: 0.6, dz: -0.02 }, 0.45);
  const clapperboard = lean(await place(workstation.group, R.cy('Sign_Small_1'), { pos: [0.72, workstation.height, 0.12], width: 0.3, rot: -0.5, isStatic: false, own: true }), workstation.desk);
  repaint(clapperboard, { '*': '#16161a' }, 0.7);
  overlayScreen(clapperboard, /^Texture_Signs$/, clapperboardTexture(), { brightness: 0.18, margin: 0.96 });
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(4.15, 0, zB + 1.75), rotation: Math.PI - 0.5, clip: 'Working_A' });

  // rack de render: dos torres de módulos del pack (cajas con rejilla, como unidades de rack) con sus pilotos
  const pilots: ((t: number, a: number) => void)[] = [];
  for (const x of [4.6, 5.5]) {
    // cada módulo, apoyado de verdad sobre el de debajo (antes se metían unos en otros)
    let below: THREE.Object3D | null = null;
    for (let n = 0; n < 3; n++) {
      const m = await place(g, R.sf('Props_CrateLong'), { pos: [x, 0, zB + 0.62], height: 0.6, own: true });
      lean(m, below); below = m;
      repaint(m, { Main: '#4a4950', Accent: '#2c2b31', DarkAccent: '#232227', DarkGrey: '#1c1b20', Black: '#101013' }, 0.55);
      const box3 = new THREE.Box3().setFromObject(m);
      if (n !== 1) { const leds = new THREE.Group(); leds.position.set(x + 0.02, box3.min.y + 0.24, box3.max.z + 0.01); leds.scale.set(1.5, 0.9, 1); leds.userData.isStatic = false; g.add(leds); pilots.push(mountPilots(leds, new THREE.Vector3(0, 0, 0), v.screen)); }
    }
  }
  P(R.cy('Cable_Thick'), { pos: [5.05, HEIGHT, zB + 0.75], height: 1.1, anchor: 'ceiling', shadow: false });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(4.1, zB), new THREE.Vector2(6.0, zB + 1.15)));
  // banda alta solo sobre el rack (el resto de la pared es de la pantalla y los carteles)
  await highBand(ctx, { gauge: 4.35, valves: [5.7], segments: [[5.3, 1.7]] });
  // the «RENDERING» lit sign over the right-hand side (it lights up when the room works)
  const { c, g: cxx } = canvas(512, 128);
  const paint = (on: boolean) => { cxx.fillStyle = '#140a0a'; cxx.fillRect(0, 0, 512, 128); cxx.strokeStyle = on ? '#ff4a3a' : '#4a2a2a'; cxx.lineWidth = 8; cxx.strokeRect(6, 6, 500, 116); cxx.fillStyle = on ? '#ff6a52' : '#4a2a2a'; cxx.shadowColor = '#ff4a3a'; cxx.shadowBlur = on ? 22 : 0; cxx.font = `800 64px ${SOURCES.title}`; cxx.textAlign = 'center'; cxx.textBaseline = 'middle'; cxx.fillText(tr('world.video.rendering'), 256, 68); cxx.shadowBlur = 0; };
  paint(false); const texNotice = textureOf(c);
  const notice = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.32), new THREE.MeshStandardMaterial({ map: texNotice, emissiveMap: texNotice, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  notice.position.set(MX, 3.55, zB + 0.4); g.add(notice);
  // panel de la cola de render, en la pared sobre el rack (sobre la mesa, el tablero de tareas)
  const panel = new PanelRoom(); panel.title = 'COLA DE RENDER'; panel.color = v.screen;
  const framePanel = aWall(g, await place(g, R.cy('Sign_2'), { pos: [5.1, 2.5, zB + 0.5], width: 1.2, isStatic: false, own: true }));
  overlayScreen(framePanel, /^Texture_Signs$/, panel.tex, { brightness: 0.9, margin: 0.94 });
  ctx.panel = panel;
  signInWall(g, sign(t('world.poster.productions'), t('world.poster.productionsFoot'), '#d8c8f0', '#3a2a5a', 'eye', seed), 3.55, 2.35, 0.55, 0.77, zB + 0.33, 0.03);

  await Promise.all(ps);
  stain(g, 1.2, 1.0, 1.0, seed + 5);
  ctx.room.walkZones = [[-1.9, -1.3], [1.3, 1.9]];
  ctx.vapor = { pos: new THREE.Vector3(5.7, 3.15, zB + 0.85), dir: new THREE.Vector3(-0.3, 0.9, 0.3) };
  ctx.sparks = new THREE.Vector3(5.25, 1.9, zB + 0.9);
  ctx.lamps = [{ x: -4.85, z: 1.0, o: { intensity: 130, corta: true } }, { x: 0.6, z: 0.8, o: { intensity: 105, shadow: true, corta: true, goal: [0, -0.6] } }, { x: 4.5, z: 0.6, o: { intensity: 120 } }];

  let k = 0, tChange = 0, on = false;
  ctx.onUpdate((dt, t, a) => {
    const working = ctx.room.state === 'working';
    line.update(dt, working ? 1 + a * 3 : 0.15);
    tChange += dt;
    if (tChange > (working ? 2.2 : 6)) {
      tChange = 0; k++;
      const m = largeCanvas.material as THREE.MeshStandardMaterial; m.map = m.emissiveMap = photos[k % 4]; m.needsUpdate = true;
      const pm = previous.material as THREE.MeshStandardMaterial; pm.map = pm.emissiveMap = photos[(k + 1) % 4]; pm.needsUpdate = true;
    }
    if (working !== on) { on = working; paint(working); texNotice.needsUpdate = true; }
    // el haz parpadea con el obturador; las bobinas giran (más deprisa si renderiza)
    const strength = 0.9 + Math.sin(t * 9) * 0.06 + Math.sin(t * 23) * 0.04 + (working ? 0.25 : 0);
    (beam.material as THREE.MeshBasicMaterial).opacity = strength; (core.material as THREE.MeshBasicMaterial).opacity = strength;
    specks.update(dt, t, strength);
    rolling = Math.max(0, rolling - dt);
    for (const b of coils) b.rotation.z -= dt * (working || rolling > 0 ? 2.2 + rolling : 0.7);
    (rec.material as THREE.MeshBasicMaterial).color.set((working || rolling > 0) && Math.sin(t * 5) > 0 ? '#ff3020' : '#2a0c0c');
    for (const f of pilots) f(t, a);
    if (working && Math.random() < dt * (0.12 + a)) panel.lines.push('> ' + tr('world.video.log', { n: (t * 30) % 900 | 0 }).split('|')[Math.floor(Math.random() * 4)]);
  });
}
