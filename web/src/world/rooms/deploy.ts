// Sala de planificación (tipo 'coordinacion', sin decorado): la sala de mando del despliegue. La pieza protagonista es
// la pantalla de la pared con tus PR por estado, los bloqueos entre ellos como flechas y el orden en que pueden
// fusionarse (shared/deploy.ts); un clic en ella abre el tablero (web/src/ui/Deploy.tsx). Debajo, la mesa de
// planos donde se reparte el trabajo y, a los lados, el puesto del planificador y el monitor del panel de la sala.
import { t } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, canvas, textureOf, splitByWords, SOURCES } from '../../engine/textures';
import { overlayScreen } from '../util3d';
import { signInWall, stain, highBand, monitorWall, workStation, screenReal, type Context } from './common';
import { client } from '../../net/client';
import { ledgerPending } from '@shared/reviewCount';
import { DEPLOYMENT_COLUMNS, blockersBetween, deploymentColumn, deployWaves, type Blocker, type BlockerManual, type TaskOrder } from '@shared/deploy';
import type { PRBoard } from '@shared/board';
import { taskColor, pRTask } from '@shared/tasks';
import { knowTasks, versionColors } from '../../ui/tasks';

// el tablero del panel avisa al cambiar un bloqueo a mano: la pantalla lo relee sin esperar a la próxima lectura
let version = 0;
addEventListener('refugio:despliegue', () => { version++; });

const short = (p: PRBoard) => `${p.repo.split('/').pop()}#${p.number}`;

/** La pantalla grande: columnas por estado, fichas con su ola, flechas de bloqueo y el orden de despliegue abajo */
export class DeploymentBoard {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private signature = '';
  // 1408×624: la proporción de la pantalla (5,3 × 2,35 m)
  constructor(private color = '#9dffb8') { ({ c: this.c, g: this.g } = canvas(1408, 624)); this.tex = textureOf(this.c); this.set([], [], false); }
  set(prs: PRBoard[], blockers: Blocker[], demo: boolean) {
    const f = JSON.stringify([prs.map(p => [p.url, p.state, p.review, p.checks, p.ledger, p.title, taskColor(pRTask(p))]), blockers, demo]); if (f === this.signature) return; this.signature = f;
    const { g } = this; const W = this.c.width, H = this.c.height; const col = this.color;
    const INK = '#dcf2e2', BACKGROUND = '#06100a', CARD = '#0f1d14', RED = '#ff5a4a', PURPLE = '#b48cff';
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, W, H); g.textBaseline = 'top'; g.textAlign = 'left';
    const byUrl = new Map(prs.map(p => [p.url, p]));
    const { waves, cycle } = deployWaves(prs, blockers);
    const wave = new Map(waves.flatMap((o, k) => o.map(p => [p.url, k + 1] as const)));
    const pending = (b: Blocker) => byUrl.get(b.by)?.state !== 'fusionado';
    const blocked = new Set(blockers.filter(pending).map(b => b.from));
    // cabecera
    g.fillStyle = col; g.font = `700 30px ${SOURCES.mono}`; g.shadowColor = col; g.shadowBlur = 10;
    g.fillText(`${t('world.deploy.title')}${demo ? ' · DEMO' : ''}`, 28, 18); g.shadowBlur = 0;
    const mergeBy = prs.filter(p => p.state === 'abierto' || p.state === 'borrador').length;
    g.font = `600 24px ${SOURCES.mono}`; g.textAlign = 'right';
    g.fillStyle = col; g.fillText(t('world.deploy.nToMerge', { n: mergeBy }), W - 28 - (blocked.size ? 230 : 0), 20);
    if (blocked.size) { g.fillStyle = RED; g.fillText(blocked.size === 1 ? t('world.deploy.oneBlocked') : t('world.deploy.nBlocked', { n: blocked.size }), W - 28, 20); }
    g.textAlign = 'left';
    // columnas
    const cols = DEPLOYMENT_COLUMNS.map(c => ({ ...c, prs: prs.filter(p => deploymentColumn(p) === c.id).sort((a, b) => (wave.get(a.url) ?? 99) - (wave.get(b.url) ?? 99) || b.updated - a.updated) }));
    const n = cols.length, cw = (W - 56) / n, yc = 70, y0 = 112, y1 = 470, gap = 10, MAXC = 5;
    // con pocos PR, fichas más altas (y letra más grande) que se leen desde lejos
    const rows = Math.max(1, ...cols.map(c => Math.min(c.prs.length, MAXC)));
    const fh = THREE.MathUtils.clamp((y1 - y0 - (rows - 1) * gap) / rows, 64, 140), large = fh >= 100;
    const fId = large ? 22 : 18, fTit = large ? 22 : 18;
    const spot = new Map<string, { x0: number; x1: number; y: number }>();
    cols.forEach((c, i) => {
      const x = 28 + i * cw + 7, w = cw - 14;
      g.fillStyle = col + '24'; g.fillRect(x, yc, w, 34);
      g.fillStyle = col; g.font = `700 22px ${SOURCES.mono}`; g.fillText(c.name.toUpperCase(), x + 12, yc + 6);
      g.textAlign = 'right'; g.fillText(String(c.prs.length), x + w - 10, yc + 6); g.textAlign = 'left';
      const vis = c.prs.slice(0, c.prs.length > MAXC ? MAXC - 1 : MAXC), more = c.prs.length - vis.length;
      if (!vis.length) { g.setLineDash([10, 8]); g.strokeStyle = col + '44'; g.lineWidth = 2; g.strokeRect(x + 2, y0, w - 4, fh); g.setLineDash([]); g.fillStyle = col + '66'; g.font = `600 20px ${SOURCES.mono}`; g.textAlign = 'center'; g.fillText('—', x + w / 2, y0 + 20); g.textAlign = 'left'; }
      vis.forEach((p, k) => {
        const y = y0 + k * (fh + gap);
        spot.set(p.url, { x0: x, x1: x + w, y: y + fh / 2 });
        // el color de su tarea (lo reparte Logística) en la franja y el borde; bloqueada, recuadrada en rojo
        const tone = taskColor(pRTask(p)), isBlocked = blocked.has(p.url);
        g.fillStyle = CARD; g.fillRect(x, y, w, fh);
        g.strokeStyle = isBlocked ? RED : tone + 'aa'; g.lineWidth = isBlocked ? 3.5 : 2.5; g.strokeRect(x + 1.5, y + 1.5, w - 3, fh - 3);
        const ci = p.checks === 'FAILURE' || p.checks === 'ERROR';
        g.fillStyle = tone; g.fillRect(x, y, 10, fh);
        g.fillStyle = taskColor(pRTask(p)); g.font = `700 ${fId}px ${SOURCES.mono}`; g.fillText(short(p), x + 16, y + 8);   // del color de su tarea
        let xd = x + w - 10;
        const o = wave.get(p.url);
        if (o) { const wave = t('world.deploy.wave', { n: o }); g.font = `700 15px ${SOURCES.mono}`; const tw = g.measureText(wave).width + 12; xd -= tw; g.fillStyle = col + '30'; g.fillRect(xd, y + 6, tw, 21); g.fillStyle = col; g.fillText(wave, xd + 6, y + 9); xd -= 6; }
        if (p.checks && p.state !== 'fusionado') { g.font = `700 16px ${SOURCES.mono}`; g.fillStyle = ci ? RED : p.checks === 'SUCCESS' ? '#5dff8a' : '#ffb000'; const t = ci ? 'CI ✗' : p.checks === 'SUCCESS' ? 'CI ✓' : 'CI …'; xd -= g.measureText(t).width; g.fillText(t, xd, y + 9); }
        // lo que queda por contestar en sus revisiones: hilos sin resolver y resúmenes sin respuesta (con cero, nada)
        if (p.state !== 'fusionado' && p.state !== 'cerrado' && ledgerPending(p.ledger)) {
          const l = p.ledger!, t = [l.unresolved > 0 && `💬${l.unresolved}`, l.unansweredSummaries > 0 && `✉${l.unansweredSummaries}`].filter(Boolean).join(' ');
          g.font = `700 16px ${SOURCES.mono}`; xd -= 10 + g.measureText(t).width; g.fillStyle = '#ffb000'; g.fillText(t, xd, y + 9);
        }
        g.fillStyle = INK; g.font = `500 ${fTit}px ${SOURCES.mono}`;
        const lines = Math.max(1, Math.floor((fh - fId - 22) / (fTit * 1.2)));
        splitByWords(g, p.title, w - 28, Math.min(3, lines)).forEach((l, m) => g.fillText(l, x + 16, y + fId + 16 + m * fTit * 1.2));
      });
      if (more) { const y = y0 + vis.length * (fh + gap); g.fillStyle = col + '1c'; g.fillRect(x, y, w, 34); g.fillStyle = col; g.font = `600 18px ${SOURCES.mono}`; g.fillText(t('world.tex.nMore', { n: more }), x + 14, y + 8); }
    });
    // flechas: del PR que bloquea al que espera (las pendientes, rojas; las ya fusionadas, moradas y tenues)
    for (const b of blockers) {
      const a = spot.get(b.by), z = spot.get(b.from); if (!a || !z) continue;
      const active = pending(b);
      g.strokeStyle = active ? RED : PURPLE + '88'; g.fillStyle = g.strokeStyle; g.lineWidth = active ? 3 : 2;
      if (b.reason === 'manual') g.setLineDash([10, 7]);
      let sx: number, ex: number, c1: number, c2: number;
      if (a.x1 <= z.x0) { sx = a.x1; ex = z.x0 - 2; c1 = c2 = (sx + ex) / 2; }
      else if (z.x1 <= a.x0) { sx = a.x0; ex = z.x1 + 2; c1 = c2 = (sx + ex) / 2; }
      else { sx = a.x1; ex = z.x1 + 2; c1 = c2 = Math.max(a.x1, z.x1) + 34; }   // en la misma columna, por fuera
      g.beginPath(); g.moveTo(sx, a.y); g.bezierCurveTo(c1, a.y, c2, z.y, ex, z.y); g.stroke(); g.setLineDash([]);
      const dir = ex < c2 ? -1 : 1;   // la punta mira hacia la ficha
      g.beginPath(); g.moveTo(ex, z.y); g.lineTo(ex - dir * 14, z.y - 8); g.lineTo(ex - dir * 14, z.y + 8); g.closePath(); g.fill();
    }
    // pie: el orden de despliegue por olas
    const by = 486, bh = 70;
    g.fillStyle = '#0a160e'; g.fillRect(28, by, W - 56, bh); g.strokeStyle = col + '44'; g.lineWidth = 1.5; g.strokeRect(28, by, W - 56, bh);
    g.fillStyle = col; g.font = `700 20px ${SOURCES.mono}`; g.fillText(t('world.deploy.order'), 44, by + 10);
    g.font = `600 22px ${SOURCES.mono}`; g.fillStyle = INK;
    const orden = waves.length ? waves.map((o, k) => `${k + 1} · ${o.map(short).join(', ')}`).join('   →   ') : prs.length ? t('world.deploy.nothingToMerge') : t('world.deploy.readingPRs');
    g.fillText(splitByWords(g, orden + (cycle.length ? '   ' + t('world.deploy.cycle', { prs: cycle.map(short).join(', ') }) : ''), W - 100, 1)[0] ?? '', 44, by + 38);
    for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y, W, 1); }
    this.tex.needsUpdate = true;
  }
}

export async function furnishDeployment(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { timer: 5.1, valves: [-4.6], segments: [[-4.9, 1.8]] });   // nada por delante de la pantalla
  // la pantalla del despliegue, bajo el dintel
  const board = new DeploymentBoard('#9dffb8');
  const YT = 2.5;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: '#141a16', roughness: 0.5, metalness: 0.5 }));
  frame.position.set(0, YT, zB + 0.36); g.add(frame); ctx.device('despliegue', frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2.35), new THREE.MeshStandardMaterial({ map: board.tex, emissiveMap: board.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(0, YT, zB + 0.43); g.add(screen);
  screen.userData.interactive = 'despliegue'; screen.userData.view = 'despliegue';   // un clic en la pantalla abre el tablero (shelter.ts, clic)
  // on the left, the room's state on a wall monitor (decoration: the room panel is roomPanel.ts) and the planner's desk
  const panel = new PanelRoom(); panel.title = 'LOGÍSTICA'; panel.color = v.screen; ctx.panel = panel;
  await monitorWall(ctx, -4.6, 2.3, 1.1, panel.tex, 1.2, 0.2);
  const pStation = new PhosphorScreen(384, 256, v.screen); pStation.speed = 24; screenReal(ctx, pStation, 'actividad'); ctx.room.screens.push(pStation);
  await workStation(ctx, { id: 'puesto', x: -3.05, z: -0.7, rotation: 0.8, tex: pStation.tex, chair: R.furniture('chair_desk_A'),
    onTop: [{ path: R.tools('blueprint'), x: -0.55, z: 0.25, c: { width: 0.45, rot: 0.15 } }, { path: R.furniture('mug_A'), x: 0.7, z: 0.15, c: { scale: K * 0.7 } }] });
  // a la derecha, la consola de pie con el estado de los repos
  const pRepos = new PhosphorScreen(256, 256, v.screen); pRepos.speed = 18; screenReal(ctx, pRepos, 'repo'); ctx.room.screens.push(pRepos);
  const console = await place(g, R.sf('Props_ComputerSmall'), { pos: [3.0, 0, zB + 1.3], height: 1.45, rot: -0.5, isStatic: false });
  overlayScreen(console, /^Black$/, pRepos.tex, { brightness: 1.2, margin: 0.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(2.55, zB + 0.8), new THREE.Vector2(3.45, zB + 1.75)));
  ctx.room.points.push({ id: 'consola', type: 'consola', pos: new THREE.Vector3(2.75, 0, zB + 2.05), rotation: Math.PI - 0.5, clip: 'Working_A' });
  // la pieza: la mesa de planos con el holograma del refugio; se reparte el trabajo moviéndolo con las manos
  P(R.sf('Props_Base'), { pos: [0, 0, zB + 1.9], width: 2.6 });
  let impulse = 0; const revive = () => { impulse = 1; };
  for (const [id, x] of [['mesa', -1.5], ['mesa-2', 1.5]] as const) ctx.room.points.push({ id, type: 'pieza', pos: new THREE.Vector3(x, 0, zB + 2.75), rotation: Math.atan2(-x, -0.85),
    actions: [{ clip: 'Ranged_Magic_Spellcasting', onMake: revive }, { clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }] });
  const holo = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.05, 1.05, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#5dff8a', transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  holo.position.set(0, 0.82, zB + 1.9); g.add(holo);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9dffb8').multiplyScalar(2), wireframe: true }));
  core.position.set(0, 1.2, zB + 1.9); g.add(core);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.35, zB), new THREE.Vector2(1.35, zB + 3.2)), new THREE.Box2(new THREE.Vector2(3.9, zB), new THREE.Vector2(6, zB + 1.6)));
  // lados: taquilla con carpetas a la derecha y el cartel de la casa
  const locker = P(R.sf('Props_Shelf_Tall'), { pos: [5.45, 0, zB + 0.5], height: 2.3, rot: 0 });
  for (const [k, y] of [0.6, 1.05, 1.5].entries()) ctx.restsOn(locker, R.furniture('book_set'), { pos: [5.4 + (k % 2) * 0.15, 0, zB + 0.5], width: 0.55, rot: k * 0.2 }, { since: y });
  P(R.cy('Computer_Large'), { pos: [4.5, 0, zB + 0.55], height: 2.2, rot: -0.3 });
  signInWall(g, sign(t('world.poster.logistics'), t('world.poster.logisticsFoot'), '#d2ead8', '#1f4a2c', 'engranaje', seed), 4.1, 2.8, 0.56, 0.78, zB + 0.33, -0.03);
  stain(g, 0, 1.1, 1.2, seed);
  ctx.room.walkZones = [[-1.9, -1.5], [1.5, 2.2]];
  ctx.sparks = new THREE.Vector3(3.0, 1.2, zB + 1.5);
  ctx.lamps = [{ x: -4.2, z: 0.6, o: { intensity: 80 } }, { x: 0, z: 0.9, o: { intensity: 105, shadow: true, corta: true } }, { x: 4.2, z: 0.6, o: { intensity: 80 } }];
  // datos: tus PR, los bloqueos marcados a mano y el orden de los planes repartidos, cada dos minutos (y al cambiar uno en el tablero)
  let last = -1e9, view = -1; let prs: PRBoard[] = [], manual: BlockerManual[] = [], orden: TaskOrder[] = [], demo = false;
  const paint = () => board.set(prs, blockersBetween(prs, manual, orden), demo);
  let colors = -1;
  ctx.onUpdate((dt, t) => {
    if (colors !== versionColors.get().v) { colors = versionColors.get().v; paint(); }   // llegan los colores de las tareas
    if (t - last > 120 || view !== version) {
      last = t; view = version;
      client.action<any>('git.prsTablero', {}).then(p => { prs = p.prs ?? []; demo = !!p.demo; knowTasks(prs.map(pRTask)); paint(); }).catch(() => {});
      client.action<BlockerManual[]>('despliegue.bloqueos').then(l => { manual = l ?? []; paint(); }).catch(() => {});
      client.action<TaskOrder[]>('despliegue.orden').then(l => { orden = l ?? []; paint(); }).catch(() => {});
    }
    impulse = Math.max(0, impulse - dt * 0.8);
    core.rotation.y += dt * (0.8 + impulse * 5); core.rotation.x += dt * 0.3;
    (holo.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 7) * 0.02 + impulse * 0.08;
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(t * 11) * 0.03;
  });
}
