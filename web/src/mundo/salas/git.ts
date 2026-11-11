// Control de Versiones (planta -2, derecha): git y GitHub. Pieza protagonista: la matriz de contribuciones de tu perfil
// de GitHub en una pantalla grande en la pared del fondo (la de cuadritos verdes, con tu racha), con un barrido de luz
// que la recorre y el cuadro de hoy latiendo. Debajo, sobre un estrado, el grafo de commits en holograma (una rama que
// sale y vuelve a la principal). A la izquierda, el puesto del cliente de git (se usa con E) con el estado de los repos
// del refugio en la pared; a la derecha, los pull requests que esperan tu revisión y los tuyos abiertos.
// Habitante: la Octocat (modelo propio sin esqueleto de KayKit, animada por código: ver octocat.ts). En el puesto del
// grafo y en la silla del cliente de git hace lo de todos; sus «clips» los traduce AnimOctocat a poses y gestos.
import * as THREE from 'three';
import { place, R } from '../../motor/assets';
import { cartel, PhosphorScreen, PanelRoom, ListScreen, lienzo, textureOf, SOURCES } from '../../motor/texturas';
import { overlayScreen } from '../util3d';
import { signInWall, mancha, highBand, monitorWall, textureHalo, workStation, type Contexto } from './comun';
import { vivo, cliente } from '../../red/cliente';

import { GREEN_GITHUB as VERDES, rachas } from '@shared/contribuciones';

const GREEN = VERDES[4];
export interface MatrixData { fuente: 'github' | 'local'; demo?: boolean; usuario?: string; nombre?: string; total: number; days: { fecha: string; n: number; nivel: number }[]; prs?: { mine: any[]; revisar: any[]; nMine: number; nReview: number }; error?: string }


const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmtN = new Intl.NumberFormat('es-ES');

// La matriz en un lienzo de 1680 × 480: cabecera, meses, 53 semanas × 7 días, leyenda y cifras.
class Matrix {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; firma = '';
  static W = 1680; static H = 480; static X0 = 78; static Y0 = 124; static STEP = 30; static SIDE = 25;
  hoy: { col: number; fila: number } | null = null; columnas = 53;
  constructor() { ({ c: this.c, g: this.g } = lienzo(Matrix.W, Matrix.H)); this.tex = textureOf(this.c); this.draw(null); }
  poner(d: MatrixData | null) { const f = d ? `${d.usuario}|${d.total}|${d.days.length}|${d.days.at(-1)?.fecha}|${d.days.at(-1)?.n}|${d.fuente}` : ''; if (f !== this.firma) { this.firma = f; this.draw(d); } }
  draw(d: MatrixData | null) {
    const { g } = this, { W, H, X0, Y0, STEP, SIDE } = Matrix;
    g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
    g.textBaseline = 'middle';
    // cabecera
    g.fillStyle = '#e6edf3'; g.font = `700 40px ${SOURCES.mono}`;
    g.fillText(d?.usuario ? '@' + d.usuario : d ? 'tus commits en el refugio' : 'conectando con GitHub…', 36, 48);
    if (d) {
      g.textAlign = 'right'; g.fillStyle = '#9aa7b4'; g.font = `500 30px ${SOURCES.mono}`;
      g.fillText(`${fmtN.format(d.total)} ${d.fuente === 'github' ? 'contribuciones' : 'commits'} en el último año`, W - 36, 50); g.textAlign = 'left';
    }
    g.fillStyle = '#21262d'; g.fillRect(36, 82, W - 72, 2);
    // la cuadrícula: columnas de domingo a sábado, como en GitHub
    const days = d?.days ?? [];
    const primero = days.length ? new Date(days[0].fecha + 'T12:00:00') : null;
    const desfase = primero ? primero.getDay() : 0;
    this.columnas = Math.max(53, Math.ceil((days.length + desfase) / 7));
    const cols = Math.min(this.columnas, Math.floor((W - X0 - 30) / STEP));
    const jump = this.columnas - cols;   // si sobran semanas, se ven las últimas
    g.font = `500 21px ${SOURCES.mono}`; g.fillStyle = '#7d8590';
    for (const [fila, txt] of [[1, 'lun'], [3, 'mié'], [5, 'vie']] as const) g.fillText(txt, 26, Y0 + fila * STEP + SIDE / 2);
    let mesBefore = -1; this.hoy = null;
    for (let col = 0; col < cols; col++) {
      // el mes se rotula en la primera semana que empieza en él (si cabe el rótulo antes del final)
      const sunday = days[Math.max(0, (col + jump) * 7 - desfase)];
      const m = sunday ? new Date(sunday.fecha + 'T12:00:00').getMonth() : -1;
      if (m !== mesBefore) { if (mesBefore !== -1 && col < cols - 2) { g.fillStyle = '#7d8590'; g.fillText(MONTHS[m], X0 + col * STEP, Y0 - 20); } mesBefore = m; }
      for (let fila = 0; fila < 7; fila++) {
        const k = (col + jump) * 7 + fila - desfase, x = X0 + col * STEP, y = Y0 + fila * STEP;
        const dia = days[k];
        if (k < 0 || !dia) { if (!d) { g.fillStyle = VERDES[0]; redondo(g, x, y, SIDE, 5); } continue; }
        g.fillStyle = VERDES[dia.nivel] ?? VERDES[0]; redondo(g, x, y, SIDE, 5);
        if (k === days.length - 1) this.hoy = { col, fila };
      }
    }
    // leyenda
    const yL = Y0 + 7 * STEP + 26;
    g.textAlign = 'right'; g.fillStyle = '#7d8590'; g.fillText('Más', W - 36, yL + SIDE / 2); g.textAlign = 'left';
    for (let i = 0; i < 5; i++) { g.fillStyle = VERDES[4 - i]; redondo(g, W - 100 - i * STEP, yL, SIDE, 5); }
    g.textAlign = 'right'; g.fillStyle = '#7d8590'; g.fillText('Menos', W - 100 - 4 * STEP - 12, yL + SIDE / 2); g.textAlign = 'left';
    if (d?.fuente === 'local') { g.fillStyle = '#d29922'; g.fillText('sin gh: cuenta tus commits locales', 36, yL + SIDE / 2); }
    // cifras
    if (days.length) {
      const { actual, mejor } = rachas(days), max = Math.max(...days.map(x => x.n)), semana = days.slice(-7).reduce((s, x) => s + x.n, 0);
      const cifras: [string, string][] = [['HOY', String(days.at(-1)!.n)], ['ESTA SEMANA', String(semana)], ['RACHA', `${actual} d`], ['MEJOR RACHA', `${mejor} d`], ['MEJOR DÍA', String(max)]];
      const ancho = (W - 72) / cifras.length, yC = H - 50;
      cifras.forEach(([et, n], i) => {
        const x = 36 + i * ancho;
        g.fillStyle = '#7d8590'; g.font = `600 20px ${SOURCES.mono}`; g.fillText(et, x, yC - 16);
        g.fillStyle = i === 2 && actual ? GREEN : '#e6edf3'; g.font = `700 34px ${SOURCES.mono}`; g.fillText(n, x, yC + 16);
      });
    }
    this.tex.needsUpdate = true;
  }
  /** Centro de un cuadro en coordenadas del lienzo, de 0 a 1 */
  centro(col: number, fila: number) { const { W, H, X0, Y0, STEP, SIDE } = Matrix; return { u: (X0 + col * STEP + SIDE / 2) / W, v: (Y0 + fila * STEP + SIDE / 2) / H }; }
}
function redondo(g: CanvasRenderingContext2D, x: number, y: number, l: number, r: number) { g.beginPath(); g.roundRect(x, y, l, l, r); g.fill(); }

// El grafo de commits en holograma: la principal en vertical y una rama que sale, hace dos commits y vuelve
class GraphHolo {
  grupo = new THREE.Group(); private nodos: THREE.Mesh[] = []; private t0 = 0;
  constructor(color: string) {
    const mNode = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mLine = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.IcosahedronGeometry(0.055, 1);
    const principal = [0, 0.16, 0.32, 0.48, 0.64, 0.8].map(y => new THREE.Vector3(0, y, 0));
    const rama = [new THREE.Vector3(0.24, 0.3, 0.1), new THREE.Vector3(0.26, 0.5, 0.12)];
    for (const p of [...principal, ...rama]) { const n = new THREE.Mesh(geo, mNode); n.position.copy(p); this.grupo.add(n); this.nodos.push(n); }
    const linea = (ps: THREE.Vector3[]) => this.grupo.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(ps).getPoints(24)), mLine));
    linea(principal);
    linea([principal[1], new THREE.Vector3(0.18, 0.2, 0.08), rama[0], rama[1], new THREE.Vector3(0.18, 0.6, 0.08), principal[4]]);
  }
  /** Un commit nuevo en el refugio: el grafo destella de abajo arriba */
  heartbeat() { this.t0 = performance.now() / 1000; }
  actualizar(dt: number, t: number) {
    this.grupo.rotation.y += dt * 0.45;
    const phase = t - this.t0;
    this.nodos.forEach((n, i) => { const k = phase < 2 ? Math.max(0, 1 - Math.abs(phase * 4 - i * 0.6)) : 0; n.scale.setScalar(1 + k * 0.9 + Math.sin(t * 3 + i) * 0.08); });
  }
}

export async function furnishGit(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { valves: [], segments: [[-4.7, 2.4], [5.0, 1.8]] });   // nada cruza la matriz; sin volantes: los tramos quedan tras los monitores
  // ---- la matriz de contribuciones
  const matriz = new Matrix();
  const XM = 0.3, YM = 2.55, AM = 6.3, HM = AM * Matrix.H / Matrix.W;
  const marco = new THREE.Mesh(new THREE.BoxGeometry(AM + 0.24, HM + 0.24, 0.12), new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.5, metalness: 0.55 }));
  marco.position.set(XM, YM, zB + 0.36); g.add(marco); ctx.aparato('matriz', marco);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(AM, HM), new THREE.MeshStandardMaterial({ map: matriz.tex, emissiveMap: matriz.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(XM, YM, zB + 0.43); g.add(screen);
  // el barrido de luz que recorre la matriz y el cuadro de hoy, latiendo
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(0.18, HM * 0.5), new THREE.MeshBasicMaterial({ map: textureHalo(), color: GREEN, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  sweep.position.set(XM, YM + HM * 0.06, zB + 0.45); sweep.renderOrder = 3; g.add(sweep);
  const hoy = new THREE.Sprite(new THREE.SpriteMaterial({ map: textureHalo(), color: GREEN, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  hoy.scale.setScalar(0.24); hoy.renderOrder = 3; g.add(hoy);
  ctx.sala.anclas.push({ tipo: 'punto', pos: new THREE.Vector3(XM, YM, zB + 1.3), intensidad: 2.2, color: new THREE.Color('#3ad15a'), distancia: 4.5, prioridad: 2 });
  // ---- estrado con el grafo de commits en holograma
  const ZE = zB + 1.85;
  P(R.sf('Props_Base'), { pos: [XM, 0, ZE], ancho: 2.2 });
  const grafo = new GraphHolo(GREEN); grafo.grupo.position.set(XM, 0.42, ZE); g.add(grafo.grupo);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.2, 0.95, 24, 1, true), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.set(XM, 0.42 + 0.47, ZE); g.add(cone);
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(XM - 1.15, zB), new THREE.Vector2(XM + 1.15, ZE + 0.9)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(XM + 1.6, 0, ZE + 0.75), giro: -2.2, clip: 'Interact' });
  // la pieza: el estrado con el grafo. Se toca un commit (el grafo destella de abajo arriba), se alza la rama para verla
  // entera o se repasa el historial en el diario
  const latir = () => grafo.heartbeat();
  for (const [id, dx] of [['grafo', -1.45], ['grafo-2', 1.45]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(XM + dx, 0, ZE + 1.05), giro: Math.atan2(-dx, -1.05),
    acciones: [{ clip: 'Interact', onMake: latir }, { clip: 'Ranged_Magic_Raise', onMake: latir }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }] });
  // ---- izquierda: el puesto del cliente de git y la flota de repos en la pared
  const flota = new ListScreen('REPOS DEL REFUGIO', 640, 400, v.pantalla);
  ctx.aparato('cliente', await monitorWall(ctx, -4.45, 2.45, 1.3, flota.tex, 1.15));
  // el puesto del cliente de git, de tres cuartos: mesa con el terminal (los últimos commits del refugio), teclado y taza
  const consola = new PhosphorScreen(256, 256, v.pantalla); consola.speed = 22; consola.escribir(['$ git status', 'leyendo repos…']); ctx.sala.pantallas.push(consola);
  const stationGit = await workStation(ctx, { id: 'silla', x: -3.95, z: -0.7, giro: 0.8, pantalla: 'ordenador', tex: consola.tex,
    encima: [{ ruta: R.mueble('mug_A'), x: -0.72, z: 0.2, c: { escala: K * 0.7 } }, { ruta: R.mueble('cup_pencils'), x: 0.75, z: -0.22, c: { escala: K * 0.55 } }] });
  ctx.aparato('cliente', stationGit.mesa);
  const estante = P(R.sf('Props_Shelf'), { pos: [-5.6, 0, zB + 0.75], alto: 2.0, rot: Math.PI / 2 });
  // baldas a 0,32 / 0,81 / 1,30: cada caja, en la suya
  for (let i = 0; i < 6; i++) ctx.sobre(estante, R.resource(['Containers_Box_Small', 'Containers_Crate_Small_Grey'][i % 2]), { pos: [-5.62, 0, zB + 0.45 + (i % 2) * 0.55], ancho: 0.34, rot: (i * 0.4) % 0.8 - 0.4 }, { desde: [0.7, 1.2, 1.7][Math.floor(i / 2)] });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-5.2, zB + 1.5)));
  // ---- derecha: pull requests en la pared, servidor y cartel
  const prs = new ListScreen('PULL REQUESTS', 640, 400, v.pantalla);
  await monitorWall(ctx, 4.75, 2.45, 1.3, prs.tex, 1.15);
  P(R.cy('Computer_Large'), { pos: [5.35, 0, zB + 0.6], alto: 2.0, rot: -0.3 });
  const cajon = P(R.sf('Props_Crate'), { pos: [4.2, 0, zB + 0.75], alto: 0.7, rot: 0.3 });
  ctx.sobre(cajon, R.sv('Battery_Big'), { pos: [4.2, 0, zB + 0.72], alto: 0.45, rot: -0.4 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(3.7, zB), new THREE.Vector2(6, zB + 1.5)));
  signInWall(g, cartel(['NUNCA', 'FORCE PUSH', 'A MAIN'], 'CONTROL DE VERSIONES · WORK-SHELTER', '#d9e6f2', '#1f3a5a', 'mano', semilla), 3.85, 2.85, 0.5, 0.7, zB + 0.33, -0.03);

  const panel = new PanelRoom(); panel.titulo = 'VERSIONES'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, -1.6, 1.2, 0.9, semilla); mancha(g, 2.6, 0.9, 0.8, semilla + 3);
  ctx.sala.walkZones = [[-2.7, -1.6], [2.2, 3.2]];
  ctx.sparks = new THREE.Vector3(5.2, 1.4, zB + 1.0);
  // las lámparas de los lados, cortas: no cuelgan por delante de los monitores de pared
  ctx.lamparas = [{ x: -3.7, z: 0.6, o: { intensidad: 85, color: '#ffd29a', corta: true, goal: [-3.9, -0.4] } }, { x: XM, z: 1.0, o: { intensidad: 70, corta: true, sombra: true, goal: [XM, -0.6], color: '#d8ffe2' } }, { x: 4.6, z: 0.6, o: { intensidad: 80, corta: true } }];

  // ---- datos: la matriz y los PR (el servidor los guarda 15 min) y los repos del refugio (llegan solos)
  let datos: MatrixData | null = null, lastReading = -1e9, signatureCommits = '';
  ctx.alActualizar((dt, t) => {
    if (t - lastReading > 600) { lastReading = t; cliente.accion<MatrixData>('git.github').then(d => { datos = d; }).catch(() => {}); }
    matriz.poner(datos);
    // el cuadro de hoy
    if (matriz.hoy && datos) { const { u, v: vv } = matriz.centro(matriz.hoy.col, matriz.hoy.fila); hoy.position.set(XM - AM / 2 + u * AM, YM + HM / 2 - vv * HM, zB + 0.46); (hoy.material as THREE.SpriteMaterial).opacity = 0.35 + 0.35 * Math.sin(t * 3.2); }
    // el barrido, de izquierda a derecha cada 7 s
    const f = (t % 7) / 7; sweep.position.x = XM - AM / 2 + 0.3 + f * (AM - 0.6); (sweep.material as THREE.MeshBasicMaterial).opacity = 0.32 * Math.sin(Math.PI * f);
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.96 + Math.sin(t * 11) * 0.02;
    grafo.actualizar(dt, t);
    (cone.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 7) * 0.012;
    // la flota: cada repo del refugio con su rama y lo que tiene pendiente
    const e = vivo.get(), salas: any[] = e.estado?.salas ?? [];
    const repos = salas.filter(s => s.ruta && e.repos[s.id]?.isGit).map(s => ({ s, r: e.repos[s.id] }));
    flota.poner(repos.sort((a, b) => b.r.cambios - a.r.cambios).map(({ s, r }) => ({ etiqueta: r.cambios ? `● ${r.cambios}` : '✓ limpio', texto: `${s.nombre} · ${r.rama ?? '?'}`, tinta: r.cambios ? '#ffb347' : GREEN, urgente: r.cambios > 20 })));
    // la consola: los últimos commits de todo el refugio; con uno nuevo, el grafo destella
    const commits = repos.flatMap(({ s, r }) => (r.commits ?? []).map((c: any) => ({ ...c, sala: s.nombre }))).sort((a: any, b: any) => b.fecha - a.fecha).slice(0, 5);
    const firma = commits.map((c: any) => c.hash).join();
    if (firma !== signatureCommits) { if (signatureCommits) grafo.heartbeat(); signatureCommits = firma; consola.escribir(['$ git log --all', ...commits.map((c: any) => `${c.hash} ${c.mensaje}`.slice(0, 26)), '$ _']); }
    // pull requests
    const p = datos?.prs;
    prs.poner(!p ? [{ etiqueta: datos ? 'sin gh' : '…', texto: datos ? 'instala gh y «gh auth login»' : 'conectando con GitHub' }]
      : [...p.revisar.map((x: any) => ({ etiqueta: 'REVISAR', texto: `${x.repo.split('/')[1] ?? x.repo} #${x.numero} ${x.titulo}`, tinta: '#ffb347', urgente: true })),
        ...p.mine.map((x: any) => ({ etiqueta: x.borrador ? 'BORRADOR' : x.revision === 'APPROVED' ? 'APROBADO' : x.revision === 'CHANGES_REQUESTED' ? 'CAMBIOS' : 'TUYO', texto: `${x.repo.split('/')[1] ?? x.repo} #${x.numero} ${x.titulo}`, tinta: x.revision === 'APPROVED' ? GREEN : x.revision === 'CHANGES_REQUESTED' ? '#ff7a6a' : '#8ac8ff' }))]);
    panel.lineas = [`${repos.filter(x => x.r.cambios).length} repos con cambios`, p ? `${p.nReview} PR por revisar` : ''];
  });
}
