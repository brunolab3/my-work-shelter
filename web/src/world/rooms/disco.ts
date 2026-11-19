// La discoteca del refugio («Búnker»), en la planta de ocio: la música para currar. Lo que suena es lo que se pone en
// Spotify, dentro del juego (vivo.musica, ver ui/Disco.tsx): la pantalla LED del fondo enseña la carátula y el tema, los platos giran, la pista de
// baile se enciende a ritmo, la bola de espejos reparte puntos de luz por la sala y los altavoces laten. Sin música,
// la sala se queda en penumbra de local cerrado: la bola quieta, la pista apagada y el rótulo de neón parpadeando.
// El ritmo sale de `pulsoMusica('discoteca')` (audio/music.ts: la música propia de la sala, o Spotify); si suena Spotify
// y el pulso no dice nada, 118 golpes por minuto (Spotify web no cuenta el tempo del tema). En la pista bailan unos robots
// chiquitines (dancers.ts).
import { t, t as tr } from '@shared/language';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { place, R } from '../../engine/assets';
import { sign, PanelRoom, canvas, textureOf, SOURCES, PhosphorScreen, splitByWords } from '../../engine/textures';
import { signInWall, stain, box, materialSteel, switchOffWalls, surface, world, HEIGHT, type Context } from './common';
import { overlayScreen } from '../util3d';
import { live } from '../../net/client';
import type { MusicState } from '@shared/protocol';
import { musicPulse } from '../../audio/music';
import { mountDancers, type Rhythm } from './dancers';

const BPM = 118;
const NEON = ['#ff3fb4', '#3fe0ff', '#ffb347', '#9b5bff'];
const music = (): MusicState | null => live.get().music;
const playing = () => music()?.state === 'sonando';
// el pulso de la sala: lo que diga el motor de audio y, si no dice nada pero suena Spotify, el tempo fijo
let clockSpotify = 0;
function rhythm(dt = 0): Rhythm {
  const p = musicPulse('discoteca');
  if (p.playing) return { playing: true, bpm: p.bpm || BPM, pulse: p.beat + p.phase, energy: p.energy };
  if (playing()) { clockSpotify += dt * BPM / 60; return { playing: true, bpm: BPM, pulse: clockSpotify, energy: 0.7 }; }
  return { playing: false, bpm: BPM, pulse: clockSpotify, energy: 0 };
}
let roomRhythm: Rhythm = rhythm();
// golpe de bombo: 1 justo en el golpe y se apaga enseguida
const beatPulse = () => Math.exp(-(roomRhythm.pulse % 1) * 5);

// ---------------------------------------------------------------- pantalla LED: carátula, tema y ecualizador
class ScreenDJ {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  private cover: HTMLImageElement | null = null; private urlCover = ''; private key = ''; private timer = 0;
  constructor() { ({ c: this.c, g: this.g } = canvas(1024, 448)); this.tex = textureOf(this.c); this.draw(0); }
  update(dt: number, t: number) {
    const m = music();
    const url = m?.hint?.cover ?? '';
    if (url !== this.urlCover) {
      this.urlCover = url; this.cover = null;
      if (url) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { if (this.urlCover === url) { this.cover = im; this.key = ''; } }; im.src = url; }
    }
    // mientras suena, a 12 imágenes por segundo (el ecualizador); si no, solo cuando cambia algo
    this.timer -= dt;
    const k = [m?.state, m?.hint?.title, m?.hint?.artist, !!this.cover, roomRhythm.playing].join('|');
    if (playing() ? this.timer <= 0 : k !== this.key) { this.timer = 1 / 12; this.key = k; this.draw(t); }
  }
  draw(t: number) {
    const { g } = this; const W = 1024, H = 448; const m = music(); const p = m?.hint; const liveAlready = m?.state === 'sonando';
    g.fillStyle = '#05040a'; g.fillRect(0, 0, W, H);
    if (!p) {
      // local cerrado: el logotipo del club
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = NEON[0]; g.shadowBlur = 30; g.fillStyle = '#ffd1ee'; g.font = `800 150px ${SOURCES.title}`; g.fillText(tr('world.disco.bunker'), W / 2, H / 2 - 30);
      g.shadowColor = NEON[1]; g.shadowBlur = 16; g.fillStyle = '#bff6ff'; g.font = `600 40px ${SOURCES.label}`;
      g.fillText(roomRhythm.playing ? tr('world.disco.liveHouse') : tr('world.disco.closedPutMusic'), W / 2, H / 2 + 90);
      g.shadowBlur = 0; g.textAlign = 'left';
    } else {
      const L = 384, x0 = 32, y0 = 32;
      if (this.cover) g.drawImage(this.cover, x0, y0, L, L);
      else { g.fillStyle = '#1b1426'; g.fillRect(x0, y0, L, L); g.fillStyle = NEON[0]; g.font = `800 220px ${SOURCES.title}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♫', x0 + L / 2, y0 + L / 2); g.textAlign = 'left'; }
      const xt = x0 + L + 40, an = W - xt - 32;
      g.textBaseline = 'top';
      g.fillStyle = liveAlready ? NEON[2] : '#8c8496'; g.font = `600 30px ${SOURCES.mono}`; g.fillText(liveAlready ? tr('world.disco.playing') : tr('world.disco.paused'), xt, 40);
      g.shadowColor = NEON[0]; g.shadowBlur = liveAlready ? 18 : 0; g.fillStyle = '#fff0fa'; g.font = `800 64px ${SOURCES.title}`;
      splitByWords(g, p.title, an, 2).forEach((l, i) => g.fillText(l, xt, 92 + i * 68));
      g.shadowBlur = 0; g.fillStyle = '#bff6ff'; g.font = `600 36px ${SOURCES.label}`;
      g.fillText(splitByWords(g, p.artist, an, 1)[0] ?? '', xt, 240);
      // ecualizador de barras a ritmo (de adorno: la página de Spotify no comparte el sonido)
      const n = 18, bw = an / n, base = 410;
      for (let i = 0; i < n; i++) {
        const h = liveAlready ? 18 + Math.abs(Math.sin(t * (2.1 + i * 0.37) + i * 1.7)) * 70 * (0.55 + 0.45 * beatPulse()) * (1 - i / n * 0.45) : 6;
        g.fillStyle = NEON[i % 2 ? 1 : 0]; g.globalAlpha = 0.9; g.fillRect(xt + i * bw + 3, base - h, bw - 6, h);
      }
      g.globalAlpha = 1;
    }
    // rejilla de píxeles de la pantalla LED
    g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1); for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    this.tex.needsUpdate = true;
  }
}

// rótulo de neón (texto con halo sobre negro, sumado a la escena: brilla con el bloom)
export function textureNeon(text: string, sub: string, color: string, w = 1024, h = 300) {
  const { c, g } = canvas(w, h);
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let tl = h * 0.62; g.font = `800 ${tl}px ${SOURCES.title}`; while (g.measureText(text).width > w * 0.9 && tl > 40) { tl -= 6; g.font = `800 ${tl}px ${SOURCES.title}`; }
  for (const [blur, alfa] of [[40, 0.9], [16, 1], [0, 1]] as const) { g.shadowColor = color; g.shadowBlur = blur; g.globalAlpha = alfa; g.fillStyle = blur ? color : '#fff4fb'; g.fillText(text, w / 2, sub ? h * 0.4 : h / 2); }
  if (sub) { g.shadowBlur = 12; g.shadowColor = '#3fe0ff'; g.fillStyle = '#d6fbff'; g.font = `600 ${h * 0.16}px ${SOURCES.label}`; g.fillText(sub, w / 2, h * 0.84); }
  return textureOf(c);
}

// altavoz de cabina: caja lacada con dos conos que laten
function speaker(g: THREE.Group, x: number, zB: number, height: number, cones: THREE.Object3D[]) {
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.95, height, 0.7, 3, 0.05), new THREE.MeshStandardMaterial({ color: '#141316', roughness: 0.45, metalness: 0.2 }));
  body.position.set(x, height / 2, zB + 0.75); body.castShadow = true; body.receiveShadow = true; g.add(body);
  const rubber = new THREE.MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.85 });
  const membrane = new THREE.MeshStandardMaterial({ color: '#2a2930', roughness: 0.6, metalness: 0.15 });
  const ring = new THREE.MeshStandardMaterial({ color: '#8f8a80', roughness: 0.35, metalness: 0.8 });
  const profile = [new THREE.Vector2(0.02, -0.05), new THREE.Vector2(0.12, -0.035), new THREE.Vector2(0.26, -0.01), new THREE.Vector2(0.3, 0)];
  for (const [y, r] of [[height * 0.68, 0.34], [height * 0.3, 0.38]] as const) {
    const cone = new THREE.Group(); cone.position.set(x, y, zB + 1.105); cone.userData.isStatic = false;
    const m = new THREE.Mesh(new THREE.LatheGeometry(profile.map(v => v.clone().multiplyScalar(r / 0.3)), 28), membrane); m.rotation.x = Math.PI / 2; cone.add(m);
    const c = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), rubber); c.rotation.x = Math.PI / 2; c.position.z = -0.03; cone.add(c);
    const a = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.025, 8, 32), ring); a.position.z = 0.005; g.add(a); a.position.copy(cone.position);
    g.add(cone); cones.push(cone);
  }
}

export async function furnishDisco(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  switchOffWalls(g, 0.4, 0.55);   // un club: las paredes casi no se ven, brilla lo que tiene que brillar

  // ---- pantalla LED al fondo, con su marco
  const screen = new ScreenDJ();
  const YP = 2.6;
  g.add(box(4.9, 2.25, 0.12, materialSteel('#121115'), 0, YP, zB + 0.3));
  const led = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 2.06), new THREE.MeshBasicMaterial({ map: screen.tex, color: new THREE.Color('#ffffff').multiplyScalar(1.15), toneMapped: false }));
  led.position.set(0, YP, zB + 0.37); g.add(led);

  // ---- cabina: mostrador oscuro, dos platos, mesa de mezclas y los cascos
  const xs = [-0.65, 0.65];
  const yHead = 0.95;   // a la altura de la cintura del DJ: se le ve pinchar
  const counter = await place(g, R.kitchen('kitchencounter_straight_B'), { pos: [0, 0, zB + 1.15], height: yHead, own: true }); ctx.device('cabina', counter);
  { const t = counter.userData.size as THREE.Vector3; counter.scale.set(2.7 / t.x, 1, 0.62 / t.z);
    counter.traverse((n: any) => { if (n.isMesh) { n.material.color.multiplyScalar(0.12).lerp(new THREE.Color('#150f1a'), 0.7); n.material.roughness = 0.45; n.material.metalness = 0.4; } }); }
  const yBoard = surface(counter, g, 0.9, zB + 1.15) ?? yHead;   // el tablero, medido: platos y mesa de mezclas, apoyados
  // frente de la cabina: franja de neón que late
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON[0]).multiplyScalar(2), toneMapped: false }));
  strip.position.set(0, yHead - 0.12, zB + 1.47); strip.userData.isStatic = false; g.add(strip);
  const platters: THREE.Object3D[] = [];
  const texPlate = (() => { const { c, g: x } = canvas(256, 256); const gr = x.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, '#2a2a2e'); gr.addColorStop(1, '#0b0b0d'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); x.strokeStyle = 'rgba(255,255,255,0.06)'; for (let r = 40; r < 126; r += 4) { x.beginPath(); x.arc(128, 128, r, 0, Math.PI * 2); x.stroke(); } x.fillStyle = '#e0952f'; x.beginPath(); x.arc(128, 128, 38, 0, Math.PI * 2); x.fill(); x.fillStyle = '#222'; x.beginPath(); x.arc(128, 128, 5, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff3'; x.fillRect(124, 92, 8, 26); return textureOf(c); })();
  for (const x of xs) {
    g.add(box(0.62, 0.07, 0.5, materialSteel('#2b2a2e'), x, yBoard + 0.035, zB + 1.1));
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 40), [new THREE.MeshStandardMaterial({ color: '#111' }), new THREE.MeshStandardMaterial({ map: texPlate, roughness: 0.35 }), new THREE.MeshStandardMaterial({ color: '#111' })]);
    plate.position.set(x - 0.05, yBoard + 0.08, zB + 1.1); plate.userData.isStatic = false; g.add(plate); platters.push(plate);
    const arm = box(0.025, 0.02, 0.32, materialSteel('#bdb6a8'), x + 0.2, yBoard + 0.1, zB + 1.08); arm.rotation.y = 0.35; g.add(arm);
  }
  // mesa de mezclas: pilotos que bailan con el ritmo
  g.add(box(0.34, 0.09, 0.42, materialSteel('#1d1c20'), 0, yBoard + 0.045, zB + 1.1));
  const pilots: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.035), new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON[i % 3]).multiplyScalar(1.6), toneMapped: false })); p.position.set(-0.09 + (i % 3) * 0.09, yBoard + 0.095, zB + 1.0 + Math.floor(i / 3) * 0.18); p.userData.isStatic = false; g.add(p); pilots.push(p); }
  ctx.restsOn(counter, R.furniture('lamp_desk_headphones'), { pos: [1.18, 0, zB + 1.32], scale: K * 0.55, rot: -0.6 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.4, zB + 0.84), new THREE.Vector2(1.4, zB + 1.5)));   // el mostrador; detrás, el sitio del DJ
  // el puesto: la cabina. El DJ pincha de pie detrás de ella, de cara a la pista (y a la cámara): se le ven las manos
  // en los platos
  ctx.room.points.push({ id: 'platos', type: 'puesto', ofFoot: true, desk: +yBoard.toFixed(3), pos: new THREE.Vector3(0, 0, zB + 0.6), rotation: 0, clip: 'Working_B' });
  // la pieza: la mesa de mezclas, desde el costado de la cabina: se saca un disco de la caja, se le da al cue (la franja y
  // los pilotos destellan) o se celebra el drop
  let cue = 0; const giveCue = () => { cue = 1; };
  const discs = P(R.resource('Containers_Box_Small'), { pos: [2.0, 0, zB + 0.6], width: 0.5, rot: 0.2, own: true });
  discs.then(o => o.traverse((n: any) => { if (n.isMesh) n.material.color.multiplyScalar(0.35).lerp(new THREE.Color('#2a1630'), 0.5); }));
  for (let k = 0; k < 6; k++) ctx.restsOn(discs, R.furniture('book_single'), { pos: [1.86 + k * 0.055, 0, zB + 0.6], height: 0.3, rot: Math.PI / 2 + (k % 2) * 0.08, own: true }, { since: 2 })
    .then(o => o.traverse((n: any) => { if (n.isMesh) n.material.color.set(NEON[k % NEON.length]).multiplyScalar(0.35); }));
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(1.7, zB), new THREE.Vector2(2.35, zB + 0.95)));
  ctx.room.points.push({ id: 'mezclas', type: 'pieza', pos: new THREE.Vector3(1.75, 0, zB + 1.45), rotation: -Math.PI / 2 - 0.35,
    actions: [{ clip: 'PickUp' }, { clip: 'Interact', onMake: giveCue }, { clip: 'Cheering', onMake: giveCue }] });

  // ---- altavoces a los lados de la pantalla
  const cones: THREE.Object3D[] = [];
  speaker(g, -3.05, zB, 1.9, cones); speaker(g, 3.05, zB, 1.9, cones);
  for (const x of [-3.05, 3.05]) ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(x - 0.5, zB), new THREE.Vector2(x + 0.5, zB + 1.15)));

  // ---- pista de baile: baldosas de cristal que se encienden a ritmo
  const nx = 8, nz = 3, side = 0.62, x0 = -((nx - 1) * side) / 2, z0 = zB + 1.95;
  const tiles: { m: THREE.MeshBasicMaterial; i: number; k: number }[] = [];
  const base = new THREE.Mesh(new THREE.BoxGeometry(nx * side + 0.08, 0.03, nz * side + 0.08), materialSteel('#0c0b0e')); base.position.set(0, 0.015, z0 + ((nz - 1) * side) / 2); g.add(base);
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const m = new THREE.MeshBasicMaterial({ color: '#1a1420', toneMapped: false });
    const b = new THREE.Mesh(new THREE.PlaneGeometry(side - 0.05, side - 0.05), m);
    b.rotation.x = -Math.PI / 2; b.position.set(x0 + i * side, 0.034, z0 + k * side); b.userData.isStatic = false; g.add(b);
    tiles.push({ m, i, k });
  }

  // ---- bola de espejos colgada del techo, con los puntos de luz que reparte
  const facets = new THREE.IcosahedronGeometry(0.24, 3).toNonIndexed();
  const col: number[] = []; for (let f = 0; f < facets.attributes.position.count / 3; f++) { const l = 0.45 + Math.random() * 0.55; for (let j = 0; j < 3; j++) col.push(l, l, l * 1.05); }
  facets.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); facets.computeVertexNormals();
  const matBall = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.18, flatShading: true, emissive: '#3a3448', emissiveIntensity: 0.6 });
  const ball = new THREE.Mesh(facets, matBall); const YB = HEIGHT - 0.52, ZBall = 0.35;   // por encima de la pantalla, sin taparla
  ball.position.set(0, YB, ZBall); ball.userData.isStatic = false; g.add(ball);
  g.add(box(0.012, HEIGHT - YB - 0.3, 0.012, materialSteel('#777'), 0, (HEIGHT + YB + 0.3) / 2, ZBall));
  const nPoints = 70;
  const dirs = Array.from({ length: nPoints }, () => ({ th: Math.random() * Math.PI * 2, ph: -0.15 - Math.random() * 1.1, c: new THREE.Color(NEON[Math.floor(Math.random() * 3)]) }));
  const geoP = new THREE.BufferGeometry(); const posP = new Float32Array(nPoints * 3); const colP = new Float32Array(nPoints * 3);
  dirs.forEach((d, i) => d.c.toArray(colP, i * 3));
  geoP.setAttribute('position', new THREE.BufferAttribute(posP, 3)); geoP.setAttribute('color', new THREE.BufferAttribute(colP, 3));
  const texPoint = (() => { const { c, g: x } = canvas(64, 64); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return textureOf(c); })();
  const matP = new THREE.PointsMaterial({ size: 0.3, map: texPoint, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const lightPoints = new THREE.Points(geoP, matP); lightPoints.userData.isStatic = false; lightPoints.frustumCulled = false; g.add(lightPoints);
  const width = ctx.width / 2 - 0.05;

  // ---- a la izquierda: la gramola (el ordenador con Spotify) bajo el rótulo de neón
  const jukebox = await place(g, R.sf('Props_Computer'), { pos: [-4.55, 0, zB + 0.75], height: 1.75, rot: 0.3, isStatic: false, variant: v });
  const jukeboxScreen = new PhosphorScreen(256, 256, '#ff7ad1'); jukeboxScreen.speed = 14; jukeboxScreen.write(tr('world.disco.jukebox').split('|'));
  overlayScreen(jukebox, /^Black$/, jukeboxScreen.tex, { brightness: 1.3, margin: 0.9 }); ctx.room.screens.push(jukeboxScreen);
  const matNeon = new THREE.MeshBasicMaterial({ map: textureNeon(tr('world.disco.bunker'), tr('world.disco.neonSub'), NEON[0]), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.65), matNeon); neon.position.set(-4.6, 3.05, zB + 0.36); neon.userData.isStatic = false; g.add(neon);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-5.6, zB), new THREE.Vector2(-3.9, zB + 1.1)));

  // ---- a la derecha: rincón para descansar los oídos
  place(g, R.furniture('couch_pillows'), { pos: [4.65, 0, zB + 0.62], scale: K * 1.0, own: true }).then(o => o.traverse((n: any) => {
    if (n.isMesh) { const c = n.material.color as THREE.Color; const hsl = c.getHSL({ h: 0, s: 0, l: 0 }); n.material.color = new THREE.Color().setHSL(0.94, 0.6, hsl.l * 0.3 + 0.04); n.material.roughness = 0.9; }
  }));
  const nightstand = P(R.furniture('table_low'), { pos: [4.65, 0, zB + 1.6], scale: K * 0.9 });
  ctx.restsOn(nightstand, R.furniture('cup'), { pos: [4.45, 0, zB + 1.55], scale: K * 0.9 });
  ctx.restsOn(nightstand, R.furniture('cup'), { pos: [4.9, 0, zB + 1.68], scale: K * 0.9, rot: 1.2 });
  P(R.home('Light_Floor3'), { pos: [5.65, 0, zB + 0.5], height: 1.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(3.7, zB), new THREE.Vector2(5.8, zB + 2.0)));
  signInWall(g, sign(t('world.poster.disco'), t('world.poster.discoFoot'), '#f2d6ea', '#5a1a48', 'rayo', seed), 4.6, 2.75, 0.56, 0.78, zB + 0.33, -0.02);

  // ---- luz: focos de colores sobre la pista que laten con la música; la sala, en penumbra
  const spotlights = [
    { type: 'foco' as const, pos: new THREE.Vector3(-2.2, HEIGHT - 0.3, 1.2), goal: new THREE.Vector3(-0.8, 0, zB + 2.3), intensity: 0, color: new THREE.Color(NEON[0]), angle: 0.45, penumbra: 0.4, distance: 8, priority: 1.5 },
    { type: 'foco' as const, pos: new THREE.Vector3(2.2, HEIGHT - 0.3, 1.2), goal: new THREE.Vector3(0.8, 0, zB + 2.3), intensity: 0, color: new THREE.Color(NEON[1]), angle: 0.45, penumbra: 0.4, distance: 8, priority: 1.5 },
  ];
  ctx.room.anchors.push(...spotlights);
  ctx.room.anchors.push({ type: 'punto', pos: new THREE.Vector3(0, 1.6, zB + 1.0), intensity: 2.5, color: new THREE.Color('#ff7ad1'), distance: 4, priority: 0.5 });
  // (ninguna en el centro: ahí cuelga la bola)
  ctx.lamps = [{ x: -3.9, z: 0.5, o: { intensity: 38, color: '#ff8ad8', corta: true } }, { x: -1.7, z: 1.2, o: { intensity: 50, shadow: true, corta: true } }, { x: 3.9, z: 0.5, o: { intensity: 38, color: '#8ae4ff', corta: true } }];

  const panel = new PanelRoom(); panel.title = 'PISTA'; panel.color = '#ff7ad1'; ctx.panel = panel;
  stain(g, 2.4, 1.2, 1.0, seed);
  ctx.room.walkZones = [[-2.3, 2.3]];
  ctx.vapor = { pos: new THREE.Vector3(-1.6, 0.25, zB + 1.7), dir: new THREE.Vector3(0.6, 0.15, 0.4) };   // máquina de humo a ras de suelo

  // ---- los robots chiquitines que bailan en la pista: a los lados de la cabina y por delante, dejando ver al DJ y los
  // platos (el centro, libre); no son obstáculos y se apartan del Supervisor
  const dance = mountDancers(g, [[-2.05, zB + 2.1], [-1.4, zB + 2.9], [1.4, zB + 2.9], [2.05, zB + 2.1], [2.75, zB + 3.05]], () => roomRhythm, () => world.supervisor());
  (ctx.room.userData as any).dancers = dance.dancers;

  // ---- vida: todo a ritmo mientras suena
  const dir = new THREE.Vector3(); let gait = 0, signaturePanel = '';
  ctx.onUpdate((dt, t) => {
    roomRhythm = rhythm(dt);
    const s = roomRhythm.playing;
    gait = THREE.MathUtils.damp(gait, s ? 1 : 0, 2.5, dt);   // la sala «arranca» y se apaga con fundido
    const b = beatPulse() * gait * (0.75 + 0.25 * roomRhythm.energy);
    dance.update(dt);
    screen.update(dt, t);
    for (const p of platters) p.rotation.y -= dt * 3.49 * gait;   // 33⅓ rpm
    for (const c of cones) c.scale.setScalar(1 + b * 0.06);
    pilots.forEach((p, i) => { p.visible = gait < 0.1 ? i === 0 : Math.sin(t * 7 + i * 1.9) + b > 0.2; });
    cue = Math.max(0, cue - dt * 1.5);
    (strip.material as THREE.MeshBasicMaterial).color.set(NEON[0]).multiplyScalar(0.6 + 1.6 * (0.3 + b) * gait + 0.25 + cue * 1.5);
    if (cue > 0) pilots.forEach((p, i) => { p.visible = Math.sin(t * 30 + i) > -0.2; });
    // la pista: ondas de color que salen del centro, con el golpe más brillante
    const beat = Math.floor(roomRhythm.pulse);   // (golpes: los colores cambian en cada uno)
    for (const bd of tiles) {
      if (gait < 0.02) { bd.m.color.set('#1a1420'); continue; }
      const wave = Math.sin(Math.hypot(bd.i - (nx - 1) / 2, bd.k * 1.4) * 0.9 - t * 4.2);
      const tone = NEON[(bd.i + bd.k + beat) % 3];
      bd.m.color.set(tone).multiplyScalar((0.15 + Math.max(0, wave) * 0.9 + b * 0.6) * gait);
    }
    // la bola gira y los puntos de luz barren las paredes y el suelo
    ball.rotation.y += dt * 0.5 * (0.15 + gait);
    matBall.emissiveIntensity = 0.35 + gait * (0.4 + b * 0.8);
    matP.opacity = 0.85 * gait;
    if (gait > 0.01) {
      dirs.forEach((d, i) => {
        const th = d.th + ball.rotation.y;
        dir.set(Math.cos(d.ph) * Math.sin(th), Math.sin(d.ph), -Math.cos(d.ph) * Math.cos(th));
        // donde corta el rayo: la pared del fondo, el suelo o las paredes de los lados (lo primero que encuentre)
        let k = Infinity;
        if (dir.z < 0) k = Math.min(k, (zB + 0.42 - ZBall) / dir.z);
        if (dir.y < 0) k = Math.min(k, (0.05 - YB) / dir.y);
        if (dir.x !== 0) k = Math.min(k, ((dir.x > 0 ? width : -width) - 0) / dir.x);
        const visible = Number.isFinite(k) && k > 0 && ZBall + dir.z * k < 2.2;
        posP[i * 3] = visible ? dir.x * k : 0; posP[i * 3 + 1] = visible ? YB + dir.y * k : -50; posP[i * 3 + 2] = visible ? ZBall + dir.z * k : 0;
      });
      geoP.attributes.position.needsUpdate = true;
    }
    // focos de colores: laten con el golpe y cambian de color cada cuatro compases
    spotlights.forEach((f, i) => { f.intensity = gait * (35 + b * 70); f.color.set(NEON[(i + Math.floor(beat / 4)) % NEON.length]); });
    // el neón parpadea como los de verdad (más de noche, con el local cerrado)
    const fail = Math.sin(t * 13.7) * Math.sin(t * 3.1) > (s ? 0.97 : 0.85);
    matNeon.opacity = fail ? 0.25 : 0.9 + 0.1 * Math.sin(t * 50);
    // el panel de la sala: lo que suena
    const m = music();
    const lines = m?.hint ? [`> ${m.hint.title}`.slice(0, 34), `> ${m.hint.artist}`.slice(0, 34), m.state === 'sonando' ? tr('world.disco.playingLine') : tr('world.disco.pausedLine')] : [tr('world.disco.offLine'), tr('world.disco.putMusicLine')];
    const f = lines.join('|'); if (f !== signaturePanel) { signaturePanel = f; panel.lines = lines; panel.state = m?.state === 'sonando' ? tr('world.disco.live') : tr('world.disco.closed'); }
  });
}
