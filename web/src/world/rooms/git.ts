// Control de Versiones (planta -2, derecha): git y GitHub. Pieza protagonista: la matriz de contribuciones de tu perfil
// de GitHub en una pantalla grande en la pared del fondo (la de cuadritos verdes, con tu racha), con un barrido de luz
// que la recorre y el cuadro de hoy latiendo. Debajo, sobre un estrado, el grafo de commits en holograma (una rama que
// sale y vuelve a la principal). A la izquierda, el puesto del cliente de git (se usa con E) con el estado de los repos
// del refugio en la pared; a la derecha, los pull requests que esperan tu revisión y los tuyos abiertos.
// Habitante: la Octocat (modelo propio sin esqueleto de KayKit, animada por código: ver octocat.ts). En el puesto del
// grafo y en la silla del cliente de git hace lo de todos; sus «clips» los traduce AnimOctocat a poses y gestos.
import { t, t as tr, locale } from '@shared/language';
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, ListScreen, canvas, textureOf, SOURCES } from '../../engine/textures';
import { overlayScreen } from '../util3d';
import { signInWall, stain, highBand, monitorWall, textureHalo, workStation, type Context } from './common';
import { live, client } from '../../net/client';

import { GREEN_GITHUB as VERDES, streaks } from '@shared/contributions';

const GREEN = VERDES[4];
export interface MatrixData { source: 'github' | 'local'; demo?: boolean; user?: string; name?: string; total: number; days: { date: string; n: number; level: number }[]; prs?: { mine: any[]; toReview: any[]; nMine: number; nReview: number }; error?: string }


const MONTHS = tr('world.git.months').split('|');
const fmtN = new Intl.NumberFormat(locale());

// La matriz en un lienzo de 1680 × 480: cabecera, meses, 53 semanas × 7 días, leyenda y cifras.
class Matrix {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; signature = '';
  static W = 1680; static H = 480; static X0 = 78; static Y0 = 124; static STEP = 30; static SIDE = 25;
  today: { col: number; row: number } | null = null; columns = 53;
  constructor() { ({ c: this.c, g: this.g } = canvas(Matrix.W, Matrix.H)); this.tex = textureOf(this.c); this.draw(null); }
  set(d: MatrixData | null) { const f = d ? `${d.user}|${d.total}|${d.days.length}|${d.days.at(-1)?.date}|${d.days.at(-1)?.n}|${d.source}` : ''; if (f !== this.signature) { this.signature = f; this.draw(d); } }
  draw(d: MatrixData | null) {
    const { g } = this, { W, H, X0, Y0, STEP, SIDE } = Matrix;
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    // cabecera
    g.fillStyle = '#e6edf3'; g.font = `700 40px ${SOURCES.mono}`;
    g.fillText(d?.user ? '@' + d.user : d ? tr('world.git.yourCommits') : tr('world.git.connecting'), 36, 48);
    if (d) {
      g.textAlign = 'right'; g.fillStyle = '#9aa7b4'; g.font = `500 30px ${SOURCES.mono}`;
      g.fillText(tr(d.source === 'github' ? 'world.git.nContributionsYear' : 'world.git.nCommitsYear', { n: fmtN.format(d.total) }), W - 36, 50); g.textAlign = 'left';
    }
    g.fillStyle = '#21262d'; g.fillRect(36, 82, W - 72, 2);
    // la cuadrícula: columnas de domingo a sábado, como en GitHub
    const days = d?.days ?? [];
    const first = days.length ? new Date(days[0].date + 'T12:00:00') : null;
    const offset = first ? first.getDay() : 0;
    this.columns = Math.max(53, Math.ceil((days.length + offset) / 7));
    const cols = Math.min(this.columns, Math.floor((W - X0 - 30) / STEP));
    const jump = this.columns - cols;   // si sobran semanas, se ven las últimas
    g.font = `500 21px ${SOURCES.mono}`; g.fillStyle = '#7d8590';
    for (const [k, txt] of tr('world.git.weekdays').split('|').entries()) g.fillText(txt, 26, Y0 + (1 + 2 * k) * STEP + SIDE / 2);
    let monthBefore = -1; this.today = null;
    for (let col = 0; col < cols; col++) {
      // el mes se rotula en la primera semana que empieza en él (si cabe el rótulo antes del final)
      const sunday = days[Math.max(0, (col + jump) * 7 - offset)];
      const m = sunday ? new Date(sunday.date + 'T12:00:00').getMonth() : -1;
      if (m !== monthBefore) { if (monthBefore !== -1 && col < cols - 2) { g.fillStyle = '#7d8590'; g.fillText(MONTHS[m], X0 + col * STEP, Y0 - 20); } monthBefore = m; }
      for (let row = 0; row < 7; row++) {
        const k = (col + jump) * 7 + row - offset, x = X0 + col * STEP, y = Y0 + row * STEP;
        const day = days[k];
        if (k < 0 || !day) { if (!d) { g.fillStyle = VERDES[0]; roundRect(g, x, y, SIDE, 5); } continue; }
        g.fillStyle = VERDES[day.level] ?? VERDES[0]; roundRect(g, x, y, SIDE, 5);
        if (k === days.length - 1) this.today = { col, row };
      }
    }
    // leyenda
    const yL = Y0 + 7 * STEP + 26;
    g.textAlign = 'right'; g.fillStyle = '#7d8590'; g.fillText(tr('world.git.more'), W - 36, yL + SIDE / 2); g.textAlign = 'left';
    for (let i = 0; i < 5; i++) { g.fillStyle = VERDES[4 - i]; roundRect(g, W - 100 - i * STEP, yL, SIDE, 5); }
    g.textAlign = 'right'; g.fillStyle = '#7d8590'; g.fillText(tr('world.git.less'), W - 100 - 4 * STEP - 12, yL + SIDE / 2); g.textAlign = 'left';
    if (d?.source === 'local') { g.fillStyle = '#d29922'; g.fillText(tr('world.git.noGhLocal'), 36, yL + SIDE / 2); }
    // cifras
    if (days.length) {
      const { current, best } = streaks(days), max = Math.max(...days.map(x => x.n)), week = days.slice(-7).reduce((s, x) => s + x.n, 0);
      const figures: [string, string][] = [[tr('world.git.today'), String(days.at(-1)!.n)], [tr('world.git.thisWeek'), String(week)], [tr('world.git.streak'), `${current} d`], [tr('world.git.bestStreak'), `${best} d`], [tr('world.git.bestDay'), String(max)]];
      const width = (W - 72) / figures.length, yC = H - 50;
      figures.forEach(([et, n], i) => {
        const x = 36 + i * width;
        g.fillStyle = '#7d8590'; g.font = `600 20px ${SOURCES.mono}`; g.fillText(et, x, yC - 16);
        g.fillStyle = i === 2 && current ? GREEN : '#e6edf3'; g.font = `700 34px ${SOURCES.mono}`; g.fillText(n, x, yC + 16);
      });
    }
    this.tex.needsUpdate = true;
  }
  /** Centro de un cuadro en coordenadas del lienzo, de 0 a 1 */
  center(col: number, row: number) { const { W, H, X0, Y0, STEP, SIDE } = Matrix; return { u: (X0 + col * STEP + SIDE / 2) / W, v: (Y0 + row * STEP + SIDE / 2) / H }; }
}
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, l: number, r: number) { g.beginPath(); g.roundRect(x, y, l, l, r); g.fill(); }

// El grafo de commits en holograma: la principal en vertical y una rama que sale, hace dos commits y vuelve
class GraphHolo {
  group = new THREE.Group(); private nodes: THREE.Mesh[] = []; private t0 = 0;
  constructor(color: string) {
    const mNode = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mLine = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(0.055, 1);
    const main = [0, 0.16, 0.32, 0.48, 0.64, 0.8].map(y => new THREE.Vector3(0, y, 0));
    const branch = [new THREE.Vector3(0.24, 0.3, 0.1), new THREE.Vector3(0.26, 0.5, 0.12)];
    for (const p of [...main, ...branch]) { const n = new THREE.Mesh(geo, mNode); n.position.copy(p); this.group.add(n); this.nodes.push(n); }
    const line = (ps: THREE.Vector3[]) => this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(ps).getPoints(24)), mLine));
    line(main);
    line([main[1], new THREE.Vector3(0.18, 0.2, 0.08), branch[0], branch[1], new THREE.Vector3(0.18, 0.6, 0.08), main[4]]);
  }
  /** Un commit nuevo en el refugio: el grafo destella de abajo arriba */
  heartbeat() { this.t0 = performance.now() / 1000; }
  update(dt: number, t: number) {
    this.group.rotation.y += dt * 0.45;
    const phase = t - this.t0;
    this.nodes.forEach((n, i) => { const k = phase < 2 ? Math.max(0, 1 - Math.abs(phase * 4 - i * 0.6)) : 0; n.scale.setScalar(1 + k * 0.9 + Math.sin(t * 3 + i) * 0.08); });
  }
}

export async function furnishGit(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { valves: [], segments: [[-4.7, 2.4], [5.0, 1.8]] });   // nada cruza la matriz; sin volantes: los tramos quedan tras los monitores
  // ---- la matriz de contribuciones
  const matrix = new Matrix();
  const XM = 0.3, YM = 2.55, AM = 6.3, HM = AM * Matrix.H / Matrix.W;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(AM + 0.24, HM + 0.24, 0.12), new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.5, metalness: 0.55 }));
  frame.position.set(XM, YM, zB + 0.36); g.add(frame); ctx.device('matrix', frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(AM, HM), new THREE.MeshStandardMaterial({ map: matrix.tex, emissiveMap: matrix.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(XM, YM, zB + 0.43); g.add(screen);
  // el barrido de luz que recorre la matriz y el cuadro de hoy, latiendo
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.18, HM * 0.5), new THREE.MeshBasicMaterial({ map: textureHalo(), color: GREEN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  sweep.position.set(XM, YM + HM * 0.06, zB + 0.45); sweep.renderOrder = 3; g.add(sweep);
  const today = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: GREEN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  today.scale.setScalar(0.24); today.renderOrder = 3; g.add(today);
  ctx.room.anchors.push({ type: 'point', pos: new THREE.Vector3(XM, YM, zB + 1.3), intensity: 2.2, color: new THREE.Color('#3ad15a'), distance: 4.5, priority: 2 });
  // ---- estrado con el grafo de commits en holograma
  const ZE = zB + 1.85;
  P(R.sf('Props_Base'), { pos: [XM, 0, ZE], width: 2.2 });
  const graph = new GraphHolo(GREEN); graph.group.position.set(XM, 0.42, ZE); g.add(graph.group);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.2, 0.95, 24, 1, true), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.set(XM, 0.42 + 0.47, ZE); g.add(cone);
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(XM - 1.15, zB), new THREE.Vector2(XM + 1.15, ZE + 0.9)));
  ctx.room.points.push({ id: 'console', type: 'console', pos: new THREE.Vector3(XM + 1.6, 0, ZE + 0.75), rotation: -2.2, clip: 'Interact' });
  // la pieza: el estrado con el grafo. Se toca un commit (el grafo destella de abajo arriba), se alza la rama para verla
  // entera o se repasa el historial en el diario
  const heartbeat = () => graph.heartbeat();
  for (const [id, dx] of [['graph', -1.45], ['graph-2', 1.45]] as const) ctx.room.points.push({ id, type: 'piece', pos: new THREE.Vector3(XM + dx, 0, ZE + 1.05), rotation: Math.atan2(-dx, -1.05),
    actions: [{ clip: 'Interact', onMake: heartbeat }, { clip: 'Ranged_Magic_Raise', onMake: heartbeat }, { clip: 'Holding_A', utensil: 'journal', dur: 4 }] });
  // ---- izquierda: el puesto del cliente de git y la flota de repos en la pared
  const fleet = new ListScreen(tr('world.git.shelterRepos'), 640, 400, v.screen);
  ctx.device('client', await monitorWall(ctx, -4.45, 2.45, 1.3, fleet.tex, 1.15));
  // el puesto del cliente de git, de tres cuartos: mesa con el terminal (los últimos commits del refugio), teclado y taza
  const console = new PhosphorScreen(256, 256, v.screen); console.speed = 22; console.write(['$ git status', tr('world.git.readingRepos')]); ctx.room.screens.push(console);
  const stationGit = await workStation(ctx, { id: 'chair', x: -3.95, z: -0.7, rotation: 0.8, screen: 'computer', tex: console.tex,
    onTop: [{ path: R.furniture('mug_A'), x: -0.72, z: 0.2, c: { scale: K * 0.7 } }, { path: R.furniture('cup_pencils'), x: 0.75, z: -0.22, c: { scale: K * 0.55 } }] });
  ctx.device('client', stationGit.desk);
  const shelf = P(R.sf('Props_Shelf'), { pos: [-5.6, 0, zB + 0.75], height: 2.0, rot: Math.PI / 2 });
  // baldas a 0,32 / 0,81 / 1,30: cada caja, en la suya
  for (let i = 0; i < 6; i++) ctx.restsOn(shelf, R.resource(['Containers_Box_Small', 'Containers_Crate_Small_Grey'][i % 2]), { pos: [-5.62, 0, zB + 0.45 + (i % 2) * 0.55], width: 0.34, rot: (i * 0.4) % 0.8 - 0.4 }, { since: [0.7, 1.2, 1.7][Math.floor(i / 2)] });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-5.2, zB + 1.5)));
  // ---- derecha: pull requests en la pared, servidor y cartel
  const prs = new ListScreen('PULL REQUESTS', 640, 400, v.screen);
  await monitorWall(ctx, 4.75, 2.45, 1.3, prs.tex, 1.15);
  P(R.cy('Computer_Large'), { pos: [5.35, 0, zB + 0.6], height: 2.0, rot: -0.3 });
  const drawer = P(R.sf('Props_Crate'), { pos: [4.2, 0, zB + 0.75], height: 0.7, rot: 0.3 });
  ctx.restsOn(drawer, R.sv('Battery_Big'), { pos: [4.2, 0, zB + 0.72], height: 0.45, rot: -0.4 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(3.7, zB), new THREE.Vector2(6, zB + 1.5)));
  signInWall(g, sign(t('world.poster.versionControl'), t('world.poster.versionControlFoot'), '#d9e6f2', '#1f3a5a', 'hand', seed), 3.85, 2.85, 0.5, 0.7, zB + 0.33, -0.03);

  const panel = new PanelRoom(); panel.title = 'VERSIONES'; panel.color = v.screen; ctx.panel = panel;
  stain(g, -1.6, 1.2, 0.9, seed); stain(g, 2.6, 0.9, 0.8, seed + 3);
  ctx.room.walkZones = [[-2.7, -1.6], [2.2, 3.2]];
  ctx.sparks = new THREE.Vector3(5.2, 1.4, zB + 1.0);
  // las lámparas de los lados, cortas: no cuelgan por delante de los monitores de pared
  ctx.lamps = [{ x: -3.7, z: 0.6, o: { intensity: 85, color: '#ffd29a', corta: true, goal: [-3.9, -0.4] } }, { x: XM, z: 1.0, o: { intensity: 70, corta: true, shadow: true, goal: [XM, -0.6], color: '#d8ffe2' } }, { x: 4.6, z: 0.6, o: { intensity: 80, corta: true } }];

  // ---- datos: la matriz y los PR (el servidor los guarda 15 min) y los repos del refugio (llegan solos)
  let data: MatrixData | null = null, lastReading = -1e9, signatureCommits = '';
  ctx.onUpdate((dt, t) => {
    if (t - lastReading > 600) { lastReading = t; client.action<MatrixData>('git.github').then(d => { data = d; }).catch(() => {}); }
    matrix.set(data);
    // el cuadro de hoy
    if (matrix.today && data) { const { u, v: vv } = matrix.center(matrix.today.col, matrix.today.row); today.position.set(XM - AM / 2 + u * AM, YM + HM / 2 - vv * HM, zB + 0.46); (today.material as THREE.SpriteMaterial).opacity = 0.35 + 0.35 * Math.sin(t * 3.2); }
    // el barrido, de izquierda a derecha cada 7 s
    const f = (t % 7) / 7; sweep.position.x = XM - AM / 2 + 0.3 + f * (AM - 0.6); (sweep.material as THREE.MeshBasicMaterial).opacity = 0.32 * Math.sin(Math.PI * f);
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.96 + Math.sin(t * 11) * 0.02;
    graph.update(dt, t);
    (cone.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 7) * 0.012;
    // la flota: cada repo del refugio con su rama y lo que tiene pendiente
    const e = live.get(), rooms: any[] = e.state?.rooms ?? [];
    const repos = rooms.filter(s => s.path && e.repos[s.id]?.isGit).map(s => ({ s, r: e.repos[s.id] }));
    fleet.set(repos.sort((a, b) => b.r.changes - a.r.changes).map(({ s, r }) => ({ label: r.changes ? `● ${r.changes}` : tr('world.git.clean'), text: `${s.name} · ${r.branch ?? '?'}`, ink: r.changes ? '#ffb347' : GREEN, urgent: r.changes > 20 })));
    // la consola: los últimos commits de todo el refugio; con uno nuevo, el grafo destella
    const commits = repos.flatMap(({ s, r }) => (r.commits ?? []).map((c: any) => ({ ...c, room: s.name }))).sort((a: any, b: any) => b.date - a.date).slice(0, 5);
    const signature = commits.map((c: any) => c.hash).join();
    if (signature !== signatureCommits) { if (signatureCommits) graph.heartbeat(); signatureCommits = signature; console.write(['$ git log --all', ...commits.map((c: any) => `${c.hash} ${c.message}`.slice(0, 26)), '$ _']); }
    // pull requests
    const p = data?.prs;
    prs.set(!p ? [{ label: data ? tr('world.git.noGh') : '…', text: data ? tr('world.git.installGh') : tr('world.git.connectingShort') }]
      : [...p.toReview.map((x: any) => ({ label: tr('world.git.review'), text: `${x.repo.split('/')[1] ?? x.repo} #${x.number} ${x.title}`, ink: '#ffb347', urgent: true })),
        ...p.mine.map((x: any) => ({ label: x.draft ? tr('world.git.draft') : x.review === 'APPROVED' ? tr('world.git.approved') : x.review === 'CHANGES_REQUESTED' ? tr('world.git.changes') : tr('world.git.yours'), text: `${x.repo.split('/')[1] ?? x.repo} #${x.number} ${x.title}`, ink: x.review === 'APPROVED' ? GREEN : x.review === 'CHANGES_REQUESTED' ? '#ff7a6a' : '#8ac8ff' }))]);
    panel.lines = [tr('world.git.nReposWithChanges', { n: repos.filter(x => x.r.changes).length }), p ? tr('world.git.nPRsToReview', { n: p.nReview }) : ''];
  });
}
