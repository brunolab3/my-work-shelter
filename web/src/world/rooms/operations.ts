// Salas operativas: comunicaciones (radio, correo y chats), planificación (calendario) y logística (Linear).
// Sus pantallas muestran los datos que llegan del servidor (reales o DEMO).
import * as THREE from 'three';
import { place, R } from '../../engine/assets';
import { sign, PhosphorScreen, PanelRoom, ListScreen, WeekWhiteboard, Clock, KanbanBoard, canvas, textureOf, SOURCES } from '../../engine/textures';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, stain, highBand, monitorWall, workStation, box, materialSteel, HEIGHT, type Context } from './common';
import { trophyShelf } from './trophyShelf';
import { live, client } from '../../net/client';
import { crossBoard, COLUMN_COLORS, type TaskWithPR, type TaskJira } from '@shared/board';
import { taskColor, pRTask } from '@shared/tasks';
import { aimColors, knowTasks, jiraBoard } from '../../ui/tasks';
import { t as tr, tIs, locale } from '@shared/language';

const SOURCE_ICON: Record<string, string> = { outlook: tr('world.ops.mail'), google: 'GMAIL', mail: 'MAIL', discord: 'DISCORD', slack: 'SLACK', github: 'GITHUB', linear: 'LINEAR' };
const SOURCE_INK: Record<string, string> = { outlook: '#c8bfa4', google: '#e6d28a', mail: '#c6bce6', discord: '#d39a6a', slack: '#ffb36b', github: '#b8c4d8', linear: '#9dffb8' };   // acero, paja, óxido, ámbar, niebla, fósforo

// ---------------------------------------------------------------- comunicaciones
export async function furnishCommunications(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { timer: 5.3, valves: [-2.0], segments: [[-3.6, 4.4], [4.1, 2.8]] });   // las tuberías no cruzan el tablón
  // pieza protagonista: la centralita de radio (consola grande con pantalla del feed y antenas en el techo)
  const feed = new ListScreen(tr('world.ops.commonInbox'), 768, 480, v.screen);
  const frameFeed = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.1, 0.1), new THREE.MeshStandardMaterial({ color: '#1a1a16', roughness: 0.6, metalness: 0.4 }));
  frameFeed.position.set(0.2, 2.68, zB + 0.36); g.add(frameFeed); ctx.device('tablon', frameFeed);
  const screenFeed = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.9), new THREE.MeshStandardMaterial({ map: feed.tex, emissiveMap: feed.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screenFeed.position.set(0.2, 2.68, zB + 0.42); g.add(screenFeed);
  P(R.cy('Computer_Large'), { pos: [-1.7, 0, zB + 0.6], height: 2.2, rot: 0.25 });
  P(R.cy('Computer_Large'), { pos: [2.1, 0, zB + 0.6], height: 2.2, rot: -0.25 });
  P(R.cy('Antenna_1'), { pos: [-1.6, 4.0, zB + 0.8], height: 0.9, shadow: false });
  P(R.cy('Antenna_2'), { pos: [2.2, 3.9, zB + 0.9], height: 0.6, shadow: false });
  // el puesto de escucha de Ondina, delante del tablón y un poco girado (se le ven las manos): mesa larga con los dos
  // módulos del transmisor de onda corta a los lados, el monitor de onda en medio, teclado y los cascos
  const pWave = new PhosphorScreen(256, 320, v.screen, tr('world.ops.shortwave')); pWave.speed = 20;
  pWave.write(tr('world.ops.radioLines').split('|')); ctx.room.screens.push(pWave);
  await workStation(ctx, { id: 'silla', x: 0.2, z: -0.95, rotation: 0.28, desk: R.furniture('desk_large'), deskScale: 0.8, screen: 'ordenador', tex: pWave.tex,
    onTop: [{ path: R.sv('Radio'), x: -0.85, z: -0.12, c: { width: 0.72, rot: 0.08 } }, { path: R.sv('Radio'), x: 0.85, z: -0.12, c: { width: 0.66, rot: -0.12 } }, { path: R.furniture('lamp_desk_headphones'), x: 1.05, z: 0.3, c: { scale: K * 0.6, rot: -0.5 } }] });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-2.3, zB), new THREE.Vector2(-1.1, zB + 1.0)), new THREE.Box2(new THREE.Vector2(1.5, zB), new THREE.Vector2(2.7, zB + 1.0)));
  // la pieza: el tablón (la bandeja común). Se señala un aviso (el tablón se aviva), se apunta en el diario o se le da al
  // mando del rack de al lado
  let revives = 0; const revive = () => { revives = 1; };
  for (const [id, x] of [['tablon', -1.75], ['tablon-2', 2.15]] as const) ctx.room.points.push({ id, type: 'pieza', pos: new THREE.Vector3(x, 0, zB + 1.55), rotation: Math.atan2(0.2 - x, -1.0),
    actions: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  const { c: cAir, g: gAir } = canvas(384, 96);
  const paintAir = (on: boolean) => { gAir.fillStyle = '#120b08'; gAir.fillRect(0, 0, 384, 96); gAir.strokeStyle = on ? '#ff4a3a' : '#4a2a2a'; gAir.lineWidth = 6; gAir.strokeRect(4, 4, 376, 88); gAir.fillStyle = on ? '#ff6a52' : '#5a3030'; gAir.shadowColor = '#ff4a3a'; gAir.shadowBlur = on ? 18 : 0; gAir.font = `800 52px ${SOURCES.title}`; gAir.textAlign = 'center'; gAir.textBaseline = 'middle'; gAir.fillText(tr('world.ops.onAir'), 192, 52); gAir.shadowBlur = 0; };
  paintAir(false); const texAir = textureOf(cAir);
  const vent = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshStandardMaterial({ map: texAir, emissiveMap: texAir, emissive: '#ffffff', emissiveIntensity: 1.1, color: '#000' }));
  vent.position.set(-2.95, 3.05, zB + 1.0); vent.renderOrder = 2; g.add(vent);   // por delante de tuberías y consolas, siempre a la vista
  // colgado del techo con dos cables y su caja (no flota en el aire)
  g.add(box(1.18, 0.34, 0.06, materialSteel('#1b1714'), -2.95, 3.05, zB + 0.965));
  for (const dx of [-0.45, 0.45]) g.add(box(0.014, HEIGHT - 3.22, 0.014, materialSteel('#2a2622'), -2.95 + dx, (HEIGHT + 3.22) / 2, zB + 0.965));
  let onAir = false;
  ctx.onUpdate(() => { const on = ctx.room.state === 'trabajando' || (live.get().notifications ?? []).some((n: any) => !n.view && n.priority === 'alta'); if (on !== onAir) { onAir = on; paintAir(on); texAir.needsUpdate = true; } });
  ctx.room.points.push({ id: 'consola', type: 'consola', pos: new THREE.Vector3(-1.45, 0, zB + 2.45), rotation: Math.PI - 0.5, clip: 'Working_A' });
  // izquierda: casilleros de correo (estanterías con cajas) y tubo neumático
  const lockers = P(R.sf('Props_Shelf_Tall'), { pos: [-4.6, 0, zB + 0.5], height: 3.0 }); ctx.device('radio', lockers);
  // baldas a 0,40 / 0,98 / 1,57 / 2,16: los paquetes, cada uno en la suya
  for (let i = 0; i < 12; i++) ctx.restsOn(lockers, R.resource(['Containers_Box_Small', 'Containers_Crate_Small_Grey', 'Containers_Box_Medium'][i % 3]), { pos: [-5.2 + (i % 3) * 0.6, 0, zB + 0.5], width: 0.4, rot: (i * 0.3) % 0.6 - 0.3 }, { since: [0.9, 1.5, 2.1, 2.7][Math.floor(i / 3)] });
  P(R.sf('Props_Vessel_Tall'), { pos: [-3.2, 0, zB + 0.5], height: 2.2 });
  P(R.sf('Details_Pipes_Long'), { pos: [-3.2, 2.2, zB + 0.45], height: 2.0, variant: ctx.vCopper, shadow: false });
  // derecha: monitores de canales (Discord y Slack) y sofá de espera
  const chats = new ListScreen(tr('world.ops.channels'), 512, 320, v.screen);
  await monitorWall(ctx, 4.3, 2.3, 1.25, chats.tex, 1.1);
  P(R.home('Couch_Small2'), { pos: [4.6, 0, zB + 0.9], height: 1.0, rot: -0.2 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(3.4, zB), new THREE.Vector2(6, zB + 2.0)));
  signInWall(g, sign(tr('world.poster.communications'), tr('world.poster.communicationsFoot'), '#cfe3c0', '#2c4f2a', 'ojo', seed), -2.9, 2.7, 0.56, 0.78, zB + 0.33, 0.03);
  const panel = new PanelRoom(); panel.title = 'TRÁFICO'; panel.color = v.screen;
  ctx.panel = panel;
  P(R.sv('Battery_Big'), { pos: [5.55, 0, 0.95], height: 0.6 });
  stain(g, -1.4, 0.8, 1.0, seed);
  ctx.room.walkZones = [[-2.6, -2.0], [2.7, 3.4]];
  ctx.sparks = new THREE.Vector3(2.1, 1.5, zB + 1.0);
  ctx.lamps = [{ x: -3.8, z: 0.5, o: { intensity: 80 } }, { x: 0.2, z: 0.6, o: { intensity: 100, shadow: true, corta: true, goal: [0.2, -0.6] } }, { x: 4.2, z: 0.5, o: { intensity: 80 } }];
  ctx.onUpdate((dt, t) => {
    const ns: any[] = live.get().notifications ?? [];
    // una línea por conversación (el servidor ya las junta), con cuántos mensajes trae
    const more = (n: any) => (n.count > 1 ? ` (${n.count})` : '');
    const chat = (n: any) => n.source === 'discord' || n.source === 'slack';
    feed.set(ns.slice(0, 7).map(n => ({ label: SOURCE_ICON[n.source] ?? n.source, text: chat(n) ? `${n.title}${more(n)}: ${n.title === n.author ? '' : n.author + ': '}${n.snippet}` : `${n.author}${more(n)}: ${n.title}`, ink: SOURCE_INK[n.source], urgent: n.priority === 'alta' && !n.view })));
    chats.set(ns.filter(chat).slice(0, 9).map(n => ({ label: n.title ?? n.channel ?? '', text: `${n.title === n.author ? '' : n.author + ': '}${n.snippet ?? ''}`, ink: SOURCE_INK[n.source] })));
    revives = Math.max(0, revives - dt * 1.2);
    (screenFeed.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(t * 13) * 0.03 + revives * 0.4;
  });
}

// ---------------------------------------------------------------- agenda (tipo 'planificacion')
export async function furnishPlanning(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { valves: [4.8], segments: [[4.6, 2.6]] });
  // pieza protagonista: la pizarra de la semana con los eventos reales
  const whiteboard = new WeekWhiteboard();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.8, 0.1), new THREE.MeshStandardMaterial({ color: '#3a2e22', roughness: 0.7 }));
  frame.position.set(-1.2, 2.3, zB + 0.36); g.add(frame); ctx.device('calendario', frame);
  const plank = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshStandardMaterial({ map: whiteboard.tex, roughness: 0.9, emissiveMap: whiteboard.tex, emissive: '#ffffff', emissiveIntensity: 0.12 }));
  plank.position.set(-1.2, 2.3, zB + 0.42); g.add(plank);
  // relojes de pared (la hora local y la de la siguiente reunión)
  const timer = new Clock();
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshStandardMaterial({ map: timer.tex, roughness: 0.5 })); d.position.set(2.7, 3.1, zB + 0.4); g.add(d);
  // mesa de reuniones con mapa y sillas
  const reunion = P(R.furniture('table_medium_long'), { pos: [-1.2, 0, 0.3], scale: K * 0.75 });
  ctx.restsOn(reunion, R.tools('map'), { pos: [-1.35, 0, 0.3], scale: K * 0.55, rot: 0.2 });
  ctx.restsOn(reunion, R.tools('drafting_compass'), { pos: [-0.55, 0, 0.5], scale: K * 0.45, rot: 0.9 });
  ctx.restsOn(reunion, R.furniture('mug_A'), { pos: [-2.1, 0, 0.1], scale: K * 0.7 });
  ctx.restsOn(reunion, R.tools('pencil_A_long'), { pos: [-1.95, 0, 0.55], scale: K * 0.6, rot: 0.4 });
  // las sillas, a los lados, de cara a la mesa (sin meterse en ella)
  for (const [x, r] of [[-2.55, Math.PI / 2], [0.15, -Math.PI / 2]] as const) P(R.furniture('chair_A'), { pos: [x, 0, 0.3], scale: K, rot: r });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-2.9, -0.35), new THREE.Vector2(0.5, 0.95)));
  ctx.room.points.push({ id: 'consola', type: 'consola', pos: new THREE.Vector3(-3.4, 0, zB + 1.2), rotation: Math.PI + 0.7, clip: 'Interact' });
  // la pieza: la pizarra de la semana. Se apunta en ella (se aviva), se repasa la agenda en el diario o se señala el día
  let revives = 0; const revive = () => { revives = 1; };
  for (const [id, x, gi] of [['pizarra', -2.85, Math.PI - 0.25], ['pizarra-2', 0.65, Math.PI + 0.3]] as const) ctx.room.points.push({ id, type: 'pieza', pos: new THREE.Vector3(x, 0, zB + 1.15), rotation: gi,
    actions: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  ctx.onUpdate(dt => { revives = Math.max(0, revives - dt); (plank.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + revives * 0.22; });
  // derecha: archivador, monitor con la agenda de hoy y planta
  const agenda = new ListScreen(tr('world.tex.today'), 512, 320, v.screen);
  await monitorWall(ctx, 3.0, 1.75, 1.15, agenda.tex, 1.1);
  await workStation(ctx, { id: 'silla', x: 3.45, z: -0.7, rotation: -0.8, tex: agenda.tex, brightness: 1.0,
    onTop: [{ path: R.tools('journal_open'), x: -0.68, z: 0.2, c: { scale: K * 0.45, rot: -0.3 } }, { path: R.furniture('cup_pencils'), x: 0.75, z: -0.2, c: { scale: K * 0.6 } }] });
  const drawers = P(R.home('Drawer_3'), { pos: [5.45, 0, zB + 0.75], height: 1.3, rot: -Math.PI / 2 });
  ctx.restsOn(drawers, R.home('Houseplant_5'), { pos: [5.45, 0, zB + 0.75], height: 0.45 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(4.9, zB), new THREE.Vector2(6, zB + 1.9)));
  const bookcase = P(R.sf('Props_Shelf'), { pos: [-5.3, 0, zB + 0.5], height: 2.3 });
  // la estantería llena: archivo de actas, agendas, planos enrollados y cajas de material (baldas a 0,39 / 0,95 / 1,51 / 2,07)
  const zE = zB + 0.5;
  const shelf = (y: number, pieces: [string, number, Record<string, number>][]) => { for (const [path, x, o] of pieces) { const { dz, ...c } = o; ctx.restsOn(bookcase, path, { pos: [x, 0, zE + (dz ?? 0)], ...c }, { since: y + 0.35 }); } };
  shelf(0.39, [[R.resource('Containers_Box_Medium'), -5.72, { height: 0.4, rot: 0.15 }], [R.furniture('book_set'), -5.22, { width: 0.46 }], [R.resource('Containers_Crate_Small_Grey'), -4.78, { height: 0.3, rot: -0.2 }]]);
  shelf(0.95, [[R.furniture('book_set'), -5.68, { width: 0.56 }], [R.furniture('book_set'), -5.14, { width: 0.5, rot: Math.PI }], [R.tools('journal_closed'), -4.8, { height: 0.36, rot: 0.3 }]]);
  shelf(1.51, [[R.tools('map_rolled'), -5.75, { width: 0.2, height: 0.12, rot: Math.PI / 2 }], [R.tools('map_rolled'), -5.62, { height: 0.12, rot: Math.PI / 2 + 0.2, dz: 0.05 }], [R.resource('Containers_Box_Small'), -5.12, { height: 0.34, rot: -0.3 }], [R.furniture('book_single'), -4.86, { height: 0.4 }], [R.furniture('book_single'), -4.74, { height: 0.36, rot: 0.2 }]]);
  shelf(2.07, [[R.resource('Containers_Box_Large'), -5.62, { height: 0.46, rot: 0.1 }], [R.resource('Containers_Box_Small'), -4.95, { height: 0.3, rot: 0.5 }]]);
  signInWall(g, sign(tr('world.poster.calendar'), tr('world.poster.calendarFoot'), '#d7e2ee', '#223d63', 'rayo', seed), 5.0, 2.8, 0.56, 0.78, zB + 0.33, -0.03);
  const panel = new PanelRoom(); panel.title = 'AGENDA'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 1.0, 1.2, 0.9, seed);
  ctx.room.walkZones = [[0.8, 1.8], [-3.6, -3.0]];   // nadie se queda delante de la estantería
  ctx.sparks = new THREE.Vector3(3.2, 1.0, zB + 1.0);
  ctx.lamps = [{ x: -4.7, z: 0.4, o: { intensity: 80 } }, { x: -1.2, z: 0.9, o: { intensity: 100, shadow: true, corta: true, goal: [-1.2, -0.4] } }, { x: 3.6, z: 0.5, o: { intensity: 80 } }];
  ctx.vapor = { pos: new THREE.Vector3(4.7, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };
  const fmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' });
  ctx.onUpdate(() => {
    timer.update();
    const ev: any[] = live.get().events ?? [];
    whiteboard.set(ev);
    const today = new Date().toDateString();
    agenda.set(ev.filter(e => new Date(e.start).toDateString() === today).slice(0, 9).map(e => ({ label: e.allDay ? tr('world.allDay') : fmt.format(e.start), text: e.title, ink: e.source === 'google' ? '#e6d28a' : '#7ad1ff', urgent: e.start > Date.now() && e.start - Date.now() < 15 * 60000 })));
  });
}

// reescribe una pantalla de fósforo solo si cambia lo que dice (se vuelve a teclear)
const signatures = new WeakMap<PhosphorScreen, string>();
function rewrite(p: PhosphorScreen, lines: string[]) {
  const f = lines.join('\n'); if (signatures.get(p) === f) return; signatures.set(p, f);
  p.lines = []; p.queue = [...lines];
}

// ---------------------------------------------------------------- Logística (Linear)
export async function furnishLogistics(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { timer: -5.1, valves: [4.6], segments: [[4.9, 1.8]] });   // nada por delante de la pantalla
  ctx.vapor = { pos: new THREE.Vector3(-4.9, 3.15, zB + 0.85), dir: new THREE.Vector3(-0.3, 0.9, 0.3) };
  // pieza protagonista: la pantalla táctica con el tablero (columnas por estado)
  const board = new KanbanBoard(v.screen);
  // el canto superior queda justo bajo el dintel de la sala; la gráfica del ciclo, abajo, por encima del holograma
  const YT = 2.5;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: '#1c1514', roughness: 0.5, metalness: 0.5 }));
  frame.position.set(0, YT, zB + 0.36); g.add(frame); ctx.device('tablero', frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2.35), new THREE.MeshStandardMaterial({ map: board.tex, emissiveMap: board.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(0, YT, zB + 0.43); g.add(screen);
  screen.userData.interactive = 'tablero'; screen.userData.view = 'jira';   // un clic en la pantalla abre directamente el tablero de Jira (shelter.ts, clic)
  // a la derecha, la consola de pie frente a la pantalla; a la izquierda, el puesto del jefe de logística (mesa de tres
  // cuartos con su monitor de incidencias)
  const pIssues = new PhosphorScreen(256, 256, v.screen); pIssues.speed = 18; pIssues.write(tr('world.ops.issuesDemo').split('|')); ctx.room.screens.push(pIssues);
  const c = await place(g, R.sf('Props_ComputerSmall'), { pos: [3.0, 0, zB + 1.3], height: 1.45, rot: -0.5, isStatic: false });
  overlayScreen(c, /^Black$/, pIssues.tex, { brightness: 1.2, margin: 0.9 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(2.55, zB + 0.8), new THREE.Vector2(3.45, zB + 1.75)));
  const pMine = new PhosphorScreen(384, 256, v.screen, tr('world.ops.myIssues')); pMine.speed = 18; pMine.write(tr('world.ops.myIssuesDemo').split('|')); ctx.room.screens.push(pMine);
  await workStation(ctx, { id: 'puesto', x: -3.05, z: -0.7, rotation: 0.8, tex: pMine.tex, chair: R.furniture('chair_desk_A'),
    onTop: [{ path: R.furniture('mug_A'), x: -0.72, z: 0.2, c: { scale: K * 0.7 } }, { path: R.tools('journal_closed'), x: 0.7, z: -0.1, c: { scale: K * 0.45, rot: 0.5 } }] });
  // mesa táctica con holograma (el ciclo actual) y consolas grandes a los lados
  P(R.sf('Props_Base'), { pos: [0, 0, zB + 1.9], width: 2.6 });
  // la pieza: la mesa táctica. Se mueve el holograma con las manos (el núcleo se acelera y el cono se aviva), se toca la
  // consola de su borde o se repasa el ciclo en el diario
  let impulse = 0; const revive = () => { impulse = 1; };
  for (const [id, x] of [['holo', -1.5], ['holo-2', 1.5]] as const) ctx.room.points.push({ id, type: 'pieza', pos: new THREE.Vector3(x, 0, zB + 2.75), rotation: Math.atan2(-x, -0.85),
    actions: [{ clip: 'Ranged_Magic_Spellcasting', onMake: revive }, { clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }] });
  const holo = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.05, 1.05, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7a5a', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  holo.position.set(0, 0.82, zB + 1.9); g.add(holo);
  const coreHolo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a7a').multiplyScalar(2), wireframe: true }));
  coreHolo.position.set(0, 1.2, zB + 1.9); g.add(coreHolo);
  ctx.onUpdate((dt, t) => {
    impulse = Math.max(0, impulse - dt * 0.8);
    coreHolo.rotation.y += dt * (0.8 + impulse * 5); coreHolo.rotation.x += dt * 0.3;
    (holo.material as THREE.MeshBasicMaterial).opacity = 0.09 + Math.sin(t * 7) * 0.02 + impulse * 0.08;
  });
  P(R.cy('Computer_Large'), { pos: [-4.75, 0, zB + 0.55], height: 2.2, rot: 0.3 });
  P(R.cy('Computer_Large'), { pos: [4.5, 0, zB + 0.55], height: 2.2, rot: -0.3 });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.35, zB), new THREE.Vector2(1.35, zB + 3.2)), new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-4.1, zB + 1.1)), new THREE.Box2(new THREE.Vector2(3.9, zB), new THREE.Vector2(6, zB + 1.6)));
  ctx.room.points.push({ id: 'consola', type: 'consola', pos: new THREE.Vector3(2.75, 0, zB + 2.05), rotation: Math.PI - 0.5, clip: 'Working_A' });
  // lados: taquillas con carpetas, cajas de munición convertidas en archivo de tickets (una sobre otra) y la bengala de
  // las urgencias encima del baúl
  const locker = P(R.sf('Props_Shelf_Tall'), { pos: [-5.45, 0, zB + 0.5], height: 2.3, rot: 0 });
  for (const [k, y] of [0.6, 1.05, 1.5].entries()) ctx.restsOn(locker, R.furniture('book_set'), { pos: [-5.5 + (k % 2) * 0.15, 0, zB + 0.5], width: 0.55, rot: k * 0.2 }, { since: y });
  const ammo = P(R.acc('ammo_crate_withLid'), { pos: [-4.3, 0, zB + 0.45], scale: K * 1.0, rot: 0.3 });
  ctx.restsOn(ammo, R.acc('ammo_crate'), { pos: [-4.3, 0, zB + 0.45], scale: K * 0.9, rot: -0.2 });
  const chest = P(R.sf('Props_Chest'), { pos: [5.25, 0, zB + 1.2], height: 0.8, rot: -0.2 });
  ctx.restsOn(chest, R.sv('FlareGun'), { pos: [5.25, 0, zB + 1.2], height: 0.12, rotX: -Math.PI / 2, rotZ: 0.6 });
  // the trophy shelf, on the wall right of the board, above the console (a click opens Trophies and career)
  trophyShelf(ctx, 3.6, 1.95, 1.35);
  signInWall(g, sign(tr('world.poster.planning'), tr('world.poster.planningFoot'), '#ead2c8', '#5e2423', 'engranaje', seed), -5.0, 2.7, 0.56, 0.78, zB + 0.33, 0.03);
  const panel = new PanelRoom(); panel.title = 'TABLEROS'; panel.color = v.screen; ctx.panel = panel;
  stain(g, 0, 1.1, 1.2, seed);
  ctx.room.walkZones = [[-1.9, -1.5], [1.5, 2.2]];
  ctx.sparks = new THREE.Vector3(3.0, 1.2, zB + 1.5);
  ctx.lamps = [{ x: -4.2, z: 0.6, o: { intensity: 80 } }, { x: 0, z: 0.9, o: { intensity: 105, shadow: true, corta: true } }, { x: 4.2, z: 0.6, o: { intensity: 80 } }];
  let lastReading = -1e9;
  ctx.onUpdate((dt, t) => {
    // el tablero de la pared: tus tareas de Jira (en DEMO, las de ejemplo) por estado, con cuántos PR llevan. Lee cada
    // minuto (el servidor guarda Jira dos) y pinta lo último que haya leído cualquiera: el panel, al abrirlo o con R,
    // la pone al día al momento
    if (t - lastReading > 60) {
      lastReading = t;
      client.action<any>('integration.panel', { source: 'jira' }).then(p => { aimColors(p.tareas ?? []); knowTasks((p.tareas ?? []).map((t: TaskJira) => t.key)); jiraBoard.set({ tareas: p.tareas ?? [] }); }).catch(() => {});
      client.action<any>('git.prsBoard', {}).then(p => { knowTasks((p.prs ?? []).map(pRTask)); jiraBoard.set({ prs: p.prs ?? [] }); }).catch(() => {});
    }
    const { tareas, prs } = jiraBoard.get();
    const jiraStatuses = live.get().state?.settings?.verificationJira;   // Jira's prod-check status (its column)
    if (tareas) {
      const crossing = crossBoard(tareas, prs, jiraStatuses);
      const priority = (p?: string) => /highest|blocker|critical/i.test(p ?? '') ? 1 : /high|alta/i.test(p ?? '') ? 2 : /low|baja/i.test(p ?? '') ? 4 : 3;
      const card = (i: TaskWithPR) => ({ id: i.key, color: taskColor(i.key), title: i.title, priority: priority(i.priority), sub: [i.state, i.prs.length ? `${i.prs.length} PR` : ''].filter(Boolean).join(' · '), assignee: tr('world.you') });
      board.title = 'JIRA · ' + tr('panels.myJiraTasks');
      const live = crossing.columns.filter(c => c.id !== 'hecho');
      board.set(live.map(c => ({ name: tIs(c.name), cards: c.tareas.map(card), ink: COLUMN_COLORS[c.id] })), null);
      // las dos pantallas pequeñas, con las cuentas de verdad (no los números de muestra)
      const n = (id: string) => crossing.columns.find(c => c.id === id)?.tareas.length ?? 0;
      const counts = [`${tIs('Por hacer').toLowerCase()}: ${n('porHacer')}`, `${tIs('En curso').toLowerCase()}: ${n('enCurso')}`, `${tIs('En revisión').toLowerCase()}: ${n('revision')}`];
      const totals = [`jira: ${live.reduce((s, c) => s + c.tareas.length, 0)}`, `prs: ${prs.filter(p => p.state === 'abierto' || p.state === 'borrador').length}`, `${tIs('Bloqueado').toLowerCase()}: ${n('bloqueado')}`];
      rewrite(pMine, counts); rewrite(pIssues, totals);
    } else {
      const ns: any[] = (live.get().notifications ?? []).filter((n: any) => n.source === 'linear');
      const cards = ns.map(n => ({ id: n.channel ?? 'REF', title: (/«([^»]+)»/.exec(n.snippet ?? '')?.[1]) ?? n.snippet ?? n.title, priority: n.priority === 'alta' ? 1 : n.priority === 'media' ? 2 : 3, txt: n.snippet ?? '' }));
      const col = (re: RegExp) => cards.filter(f => re.test(f.txt));
      board.set([
        { name: tIs('Por hacer'), cards: col(/asignad|nueva|creado/i) },
        { name: tIs('En curso'), cards: cards.filter(f => !/asignad|nueva|creado|revisi/i.test(f.txt)) },
        { name: tIs('En revisión'), cards: col(/revisi/i) },
      ], { name: tr('world.ops.cycleN', { n: 14 }), progreso: 62 });
    }
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(t * 11) * 0.03;
  });
}
