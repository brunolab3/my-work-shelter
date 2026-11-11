// Sala de servicio: la Puerta Principal (reclutamiento). La planta -1 está en camara.ts y puente.ts.
import * as THREE from 'three';
import { place, R } from '../../motor/assets';
import { cartel, PanelRoom, ListScreen, lienzo, textureOf, SOURCES, strataTexture } from '../../motor/texturas';
import { signInWall, mancha, monitorWall, type Contexto } from './comun';

// ---------------------------------------------------------------- Puerta Principal
export async function furnishGate(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  // pieza protagonista: la puerta blindada redonda del género, compuesta con piezas del material fijo:
  // aro = marco de la ventana redonda (interiores), losa = engranaje (cyberpunk) muy grueso, placa «WS» pintada y
  // bisagra de pistón al marco. Al llegar un recluta la losa sale hacia delante y rueda a un lado.
  const XP = -3.4, YP = 2.05, R0 = 1.85;
  // detrás de la puerta, el pasillo excavado que sale a la calle, en perspectiva forzada (la cámara lo ve casi de
  // frente): anillos de refuerzo que menguan hacia la boca, roca que se oscurece hacia el fondo y la luz del atardecer
  // al final
  const texT = strataTexture(); texT.repeat.set(0.35, 0.35);
  const tunnel = new THREE.Mesh(new THREE.CircleGeometry(R0 * 0.98, 40), new THREE.MeshBasicMaterial({ map: texT, color: new THREE.Color('#b08a6a').multiplyScalar(1.7) }));   // la roca del túnel se ve aunque no le llegue el foco
  tunnel.position.set(XP, YP, zB + 0.3); g.add(tunnel); ctx.aparato('puerta', tunnel);
  const ring = new THREE.MeshStandardMaterial({ color: '#4a4338', metalness: 0.55, roughness: 0.5, emissive: '#2a1c10', emissiveIntensity: 0.6 });
  const rivet = new THREE.MeshBasicMaterial({ color: '#a8906a' });
  const N = 6;
  for (let k = 1; k <= N; k++) {
    // el punto de fuga sube y se va un poco a un lado (el túnel sube en rampa): no es una diana concéntrica
    const t = k / (N + 1), r = R0 * 0.97 * Math.pow(0.8, k), cy = YP + R0 * 0.42 * (1 - Math.pow(0.8, k)), cx = XP + R0 * 0.22 * (1 - Math.pow(0.8, k));
    // la roca de este tramo, con sus estratos, más oscura cuanto más al fondo
    const texK = texT.clone(); texK.repeat.set(0.35 * (1 + k * 0.25), 0.35 * (1 + k * 0.25)); texK.offset.set(k * 0.13, k * 0.07); texK.needsUpdate = true;
    const rockSegment = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ map: texK, color: new THREE.Color('#b08a6a').multiplyScalar(2.1 - t * 1.5) }));
    rockSegment.position.set(cx, cy, zB + 0.3 + k * 0.002); g.add(rockSegment);
    const aro = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07 * Math.pow(0.85, k), 8, 48), ring);
    aro.position.set(cx, cy, zB + 0.3 + k * 0.002 + 0.001); aro.userData.estatico = false; g.add(aro);
    for (let j = 0; j < 8; j++) { const a = j / 8 * Math.PI * 2; const m = new THREE.Mesh(new THREE.CircleGeometry(0.025 * Math.pow(0.85, k), 6), rivet); m.position.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zB + 0.3 + k * 0.002 + 0.06); g.add(m); }
  }
  // la boca: luz de atardecer al final del túnel, con su halo
  const xMouth = XP + R0 * 0.22 * (1 - Math.pow(0.8, N + 1)), yMouth = YP + R0 * 0.42 * (1 - Math.pow(0.8, N + 1)), rMouth = R0 * 0.97 * Math.pow(0.8, N + 1) * 0.85;
  const boca = new THREE.Mesh(new THREE.CircleGeometry(rMouth, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e8a060').multiplyScalar(0.9) }));
  boca.position.set(xMouth, yMouth, zB + 0.3 + (N + 1) * 0.002); g.add(boca);
  const { c: cv, g: gv } = lienzo(256, 256); const rg = gv.createRadialGradient(128, 128, 4, 128, 128, 128); rg.addColorStop(0, 'rgba(255,190,110,0.55)'); rg.addColorStop(0.35, 'rgba(255,150,80,0.18)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); gv.fillStyle = rg; gv.fillRect(0, 0, 256, 256);
  const shadowT = new THREE.Mesh(new THREE.PlaneGeometry(R0 * 1.4, R0 * 1.4), new THREE.MeshBasicMaterial({ map: textureOf(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  shadowT.position.set(xMouth, yMouth, zB + 0.3 + (N + 2) * 0.002); g.add(shadowT);
  // marco: anillo de placas del pack alrededor del hueco, sobre una corona pintada de franjas de peligro
  const { c: cc, g: gc } = lienzo(512, 512);
  for (let k = 0; k < 36; k++) { gc.fillStyle = k % 2 ? '#1c1a17' : '#c99a2e'; gc.beginPath(); gc.moveTo(256, 256); gc.arc(256, 256, 254, (k / 36) * Math.PI * 2, ((k + 1) / 36) * Math.PI * 2); gc.fill(); }
  gc.globalCompositeOperation = 'destination-out'; gc.beginPath(); gc.arc(256, 256, 226, 0, Math.PI * 2); gc.fill(); gc.globalCompositeOperation = 'source-over';
  const corona = new THREE.Mesh(new THREE.PlaneGeometry((R0 + 0.32) * 2, (R0 + 0.32) * 2), new THREE.MeshStandardMaterial({ map: textureOf(cc), transparent: true, roughness: 0.8, alphaTest: 0.5 }));
  corona.position.set(XP, YP, zB + 0.33); g.add(corona);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    P(R.sf('Details_Plate_Small'), { pos: [XP + Math.cos(a) * (R0 + 0.12), YP + Math.sin(a) * (R0 + 0.12) - 0.2, zB + 0.4], alto: 0.42, rotZ: a + Math.PI / 2, sombra: false, variant: v });
  }
  // la losa en su propio pivote (para rodar sobre su centro), con la placa del número pegada
  const pivot = new THREE.Group(); pivot.position.set(XP, YP, zB + 0.62); pivot.userData.estatico = false; g.add(pivot); g.updateMatrixWorld(true);
  // la losa: el disco con bisel del pack sci-fi (la base redonda), de canto hacia la sala, y la corona dentada detrás
  const slab = await place(pivot, R.sf('Props_Base'), { pos: [0, 0, 0], ancho: R0 * 2, anchor: 'centro', rotX: Math.PI / 2, estatico: false, own: true, variant: v });
  const teeth = await place(pivot, R.cy('Collectible_Gear'), { pos: [0, 0, -0.12], alto: R0 * 2.08, anchor: 'centro', estatico: false, own: true });
  teeth.traverse((n: any) => { if (n.isMesh) { n.material.color = new THREE.Color('#4e4940'); n.material.metalness = 0.5; n.material.roughness = 0.5; } });
  { pivot.updateMatrixWorld(true); const box3 = new THREE.Box3().setFromObject(slab); const c3 = box3.getCenter(new THREE.Vector3()); pivot.worldToLocal(c3); slab.position.sub(c3); pivot.updateMatrixWorld(true); }
  slab.traverse((n: any) => { if (n.isMesh) { n.material.metalness = 0.5; n.material.roughness = 0.45; n.castShadow = true; } });
  const { c: cp, g: gp } = lienzo(256, 256);
  for (let k = 0; k < 16; k++) { gp.fillStyle = k % 2 ? '#1c1a17' : '#d9a52b'; gp.beginPath(); gp.moveTo(128, 128); gp.arc(128, 128, 126, (k / 16) * Math.PI * 2, ((k + 1) / 16) * Math.PI * 2); gp.fill(); }
  gp.fillStyle = '#d9a52b'; gp.beginPath(); gp.arc(128, 128, 90, 0, Math.PI * 2); gp.fill();
  gp.fillStyle = '#1c1a17'; gp.font = `900 104px ${SOURCES.titulo}`; gp.textAlign = 'center'; gp.textBaseline = 'middle'; gp.fillText('WS', 128, 134);
  const plateN = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshStandardMaterial({ map: textureOf(cp), roughness: 0.65, metalness: 0.15 }));
  { const box3 = new THREE.Box3().setFromObject(slab); plateN.position.set(0, 0, pivot.worldToLocal(box3.max.clone()).z + 0.01); }
  pivot.add(plateN);
  // el centro de la losa es macizo: plancha de acero tras el número (el engranaje del pack es una corona)
  const core = new THREE.Mesh(new THREE.CircleGeometry(R0 * 0.62, 40), new THREE.MeshStandardMaterial({ color: '#5f594d', metalness: 0.6, roughness: 0.45 }));
  core.position.set(0, 0, plateN.position.z - 0.06); pivot.add(core);
  // bisagra: pistón del marco a la pared, con su placa de anclaje
  P(R.sf('Details_Cylinder_Long'), { pos: [XP + R0 + 0.75, YP + 0.2, zB + 0.62], ancho: 1.2, rotZ: 0.35, sombra: true, variant: v });
  P(R.sf('Details_Plate_Small'), { pos: [XP + R0 + 1.35, YP + 0.42, zB + 0.36], alto: 0.5, variant: v });
  P(R.sf('Details_Plate_Small'), { pos: [XP - R0 - 0.35, YP - 0.9, zB + 0.36], alto: 0.4, variant: v });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-0.9, zB + 1.0)));
  (ctx.sala.userData as any).xGate = XP;
  // la pieza: la puerta blindada. Se revisa el cierre con la llave (la losa da un tirón en su sitio), se comprueba la
  // junta con la lupa o se engrasa el pistón de la bisagra (chispas)
  let tug = 0; const tirar = () => { tug = 1; };
  const bisagra = new THREE.Vector3(XP + R0 + 0.3, YP + 0.05, zB + 0.75);
  ctx.sala.puntos.push({ id: 'puerta', tipo: 'pieza', pos: new THREE.Vector3(XP + 0.5, 0, zB + 1.55), giro: Math.PI - 0.12,
    acciones: [{ clip: 'Use_Item', utensil: 'llave', onMake: tirar }, { clip: 'Holding_A', utensil: 'lupa', dur: 4 }, { clip: 'Interact', onMake: tirar }] });
  ctx.sala.puntos.push({ id: 'bisagra', tipo: 'pieza', pos: new THREE.Vector3(XP + R0 + 0.55, 0, zB + 1.5), giro: Math.PI - 0.35,
    acciones: [{ clip: 'Working_C', utensil: 'llave', onMake: () => ctx.sala.efectos?.sparks.burst(bisagra, 14) }, { clip: 'Interact' }] });
  // panel de mando de la puerta (la consola y la palanca) y lista de reclutas (carpetas de la raíz de repos sin sala)
  const reclutas = new ListScreen('RECLUTAS EN ESPERA', 512, 380, v.pantalla);
  await monitorWall(ctx, 2.2, 2.3, 1.3, reclutas.tex, 1.15);
  P(R.sf('Props_ComputerSmall'), { pos: [0.75, 0, zB + 0.65], alto: 1.4, rot: 0.3 });
  P(R.cy('Lever'), { pos: [0.05, 0, zB + 1.2], alto: 0.7, rot: 0.2 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-0.3, zB), new THREE.Vector2(1.2, zB + 1.45)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(0.95, 0, zB + 1.75), giro: Math.PI - 0.3, clip: 'Interact' });
  // el Guardián no tiene mesa: hace la ronda. Paradas (en orden), cada una mirando a lo que vigila: la puerta blindada,
  // el pasillo hacia la calle, el panel de reclutas y la garita
  // (cada parada mira a un punto: la losa de la puerta desde los dos lados, la lista de reclutas y el pasillo de fuera)
  for (const [i, x, z, mx, mz] of [[0, -1.2, 0.75, XP, zB + 0.8], [1, -4.6, 1.2, XP, zB + 0.8], [2, 1.9, 0.55, 2.2, zB + 0.6], [3, 3.9, 1.0, 2.6, 3.5]] as const)
    ctx.sala.puntos.push({ id: 'ronda-' + i, tipo: 'patrulla', pos: new THREE.Vector3(x, 0, z), giro: Math.atan2(mx - x, mz - z) });
  // garita del guardián: sacos (los de arriba, apoyados en los de abajo) y señal de peligro
  P(R.cy('Sign_Corner_Hazard'), { pos: [5.4, 0, zB + 1.45], alto: 0.42, rot: -0.3 });
  for (let i = 0; i < 2; i++) {
    const saco = P(R.resource('Containers_Pile_Small'), { pos: [4.35 + i * 0.8, 0, zB + 0.6], escala: K * 0.8, rot: i });
    if (i === 0) ctx.sobre(saco, R.resource('Containers_Pile_Small'), { pos: [4.4, 0, zB + 0.6], escala: K * 0.65, rot: 2.2 });
    else ctx.sobre(saco, R.sv('Torch'), { pos: [5.15, 0, zB + 0.6], alto: 0.3, rot: 0.7 });   // la linterna del guardián, encima de las cajas
  }
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(3.9, zB), new THREE.Vector2(6, zB + 1.1)));
  ctx.sala.puntos.push({ id: 'guardia', tipo: 'mirar', pos: new THREE.Vector3(4.6, 0, 0.9), giro: -0.5, clip: 'Idle_A' });
  signInWall(g, cartel(['SIN', 'PACKAGE.JSON', 'NO SE ENTRA'], 'DIRECCIÓN DE WORK-SHELTER', '#e8d8b8', '#2a2520', 'mano', semilla), 5.2, 2.7, 0.56, 0.78, zB + 0.33, -0.03);
  const panel = new PanelRoom(); panel.titulo = 'PUERTA'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, XP, 0.6, 1.8, semilla);
  ctx.sala.walkZones = [[3.9, 5.0]];   // el Guardián vigila desde un lado: ni tapa la puerta ni la pantalla de reclutas
  ctx.sparks = new THREE.Vector3(-1.6, 0.9, zB + 0.9);
  ctx.lamparas = [{ x: -0.9, z: 0.9, o: { intensidad: 85, sombra: true, corta: true, goal: [XP, -1.6] } }, { x: 2.3, z: 0.6, o: { intensidad: 65, goal: [2.6, -0.5] } }, { x: 4.6, z: 0.5, o: { intensidad: 60 } }];
  let opening = 0;
  (ctx.sala.userData as any).openGate = () => { opening = 6; };
  let sugerencias: any[] = []; let tSuggestion = 0;
  ctx.alActualizar((dt, t) => {
    // apertura: sale 0,5 m (1 s), rueda 3,3 m a la derecha (1,6 s), espera y vuelve a cerrar
    const tA = opening > 0 ? 6 - opening : 0; if (opening > 0) opening -= dt;
    const salir = THREE.MathUtils.smoothstep(Math.min(tA, 6 - tA), 0, 1);
    const roll = THREE.MathUtils.smoothstep(Math.min(tA - 1, 5 - tA), 0, 1.6);
    const dx = roll * 3.3;
    tug = Math.max(0, tug - dt * 1.6);
    pivot.position.x = XP + dx; pivot.position.z = zB + 0.62 + salir * 0.5; pivot.rotation.z = -dx / R0 + Math.sin(tug * 18) * tug * 0.04;
    tSuggestion -= dt; if (tSuggestion <= 0) { tSuggestion = 20; import('../../red/cliente').then(({ cliente }) => cliente.accion<any[]>('sugerencias').then(s => { sugerencias = s ?? []; }).catch(() => {})); }
    reclutas.poner(sugerencias.slice(0, 9).map(s => ({ etiqueta: s.isGit ? 'REPO' : 'CARPETA', texto: s.nombre })));
  });
}
