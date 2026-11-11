// Salas operativas: comunicaciones (radio, correo y chats), planificación (calendario) y logística (Linear).
// Sus pantallas muestran los datos que llegan del servidor (reales o DEMO).
import * as THREE from 'three';
import { place, R } from '../../motor/assets';
import { cartel, PhosphorScreen, PanelRoom, ListScreen, WeekWhiteboard, Reloj, BoardKanban, lienzo, textureOf, SOURCES } from '../../motor/texturas';
import { overlayScreen, screenFrontal } from '../util3d';
import { signInWall, mancha, highBand, monitorWall, workStation, caja, materialSteel, HEIGHT, type Contexto } from './comun';
import { vivo, cliente } from '../../red/cliente';
import { cruzarTablero, type PRBoard, type TaskWithPR, type TaskJira } from '@shared/tablero';
import { taskColor, pRTask } from '@shared/tareas';
import { aimColors, knowTasks } from '../../ui/tareas';

const SOURCE_ICON: Record<string, string> = { outlook: 'CORREO', google: 'GMAIL', mail: 'MAIL', discord: 'DISCORD', slack: 'SLACK', github: 'GITHUB', linear: 'LINEAR' };
const SOURCE_INK: Record<string, string> = { outlook: '#c8bfa4', google: '#e6d28a', mail: '#c6bce6', discord: '#d39a6a', slack: '#ffb36b', github: '#b8c4d8', linear: '#9dffb8' };   // acero, paja, óxido, ámbar, niebla, fósforo

// ---------------------------------------------------------------- comunicaciones
export async function furnishCommunications(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { reloj: 5.3, valves: [-2.0], segments: [[-3.6, 4.4], [4.1, 2.8]] });   // las tuberías no cruzan el tablón
  // pieza protagonista: la centralita de radio (consola grande con pantalla del feed y antenas en el techo)
  const feed = new ListScreen('BANDEJA COMÚN', 768, 480, v.pantalla);
  const frameFeed = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.1, 0.1), new THREE.MeshStandardMaterial({ color: '#1a1a16', roughness: 0.6, metalness: 0.4 }));
  frameFeed.position.set(0.2, 2.68, zB + 0.36); g.add(frameFeed); ctx.aparato('tablon', frameFeed);
  const screenFeed = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.9), new THREE.MeshStandardMaterial({ map: feed.tex, emissiveMap: feed.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screenFeed.position.set(0.2, 2.68, zB + 0.42); g.add(screenFeed);
  P(R.cy('Computer_Large'), { pos: [-1.7, 0, zB + 0.6], alto: 2.2, rot: 0.25 });
  P(R.cy('Computer_Large'), { pos: [2.1, 0, zB + 0.6], alto: 2.2, rot: -0.25 });
  P(R.cy('Antenna_1'), { pos: [-1.6, 4.0, zB + 0.8], alto: 0.9, sombra: false });
  P(R.cy('Antenna_2'), { pos: [2.2, 3.9, zB + 0.9], alto: 0.6, sombra: false });
  // el puesto de escucha de Ondina, delante del tablón y un poco girado (se le ven las manos): mesa larga con los dos
  // módulos del transmisor de onda corta a los lados, el monitor de onda en medio, teclado y los cascos
  const pWave = new PhosphorScreen(256, 320, v.pantalla, ' onda corta'); pWave.speed = 20;
  pWave.escribir(['14.230 MHz', 'señal: buena', 'escuchando…']); ctx.sala.pantallas.push(pWave);
  await workStation(ctx, { id: 'silla', x: 0.2, z: -0.95, giro: 0.28, mesa: R.mueble('desk_large'), deskScale: 0.8, pantalla: 'ordenador', tex: pWave.tex,
    encima: [{ ruta: R.sv('Radio'), x: -0.85, z: -0.12, c: { ancho: 0.72, rot: 0.08 } }, { ruta: R.sv('Radio'), x: 0.85, z: -0.12, c: { ancho: 0.66, rot: -0.12 } }, { ruta: R.mueble('lamp_desk_headphones'), x: 1.05, z: 0.3, c: { escala: K * 0.6, rot: -0.5 } }] });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-2.3, zB), new THREE.Vector2(-1.1, zB + 1.0)), new THREE.Box2(new THREE.Vector2(1.5, zB), new THREE.Vector2(2.7, zB + 1.0)));
  // la pieza: el tablón (la bandeja común). Se señala un aviso (el tablón se aviva), se apunta en el diario o se le da al
  // mando del rack de al lado
  let revives = 0; const revive = () => { revives = 1; };
  for (const [id, x] of [['tablon', -1.75], ['tablon-2', 2.15]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(x, 0, zB + 1.55), giro: Math.atan2(0.2 - x, -1.0),
    acciones: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  const { c: cAir, g: gAir } = lienzo(384, 96);
  const paintAir = (on: boolean) => { gAir.fillStyle = '#120b08'; gAir.fillRect(0, 0, 384, 96); gAir.strokeStyle = on ? '#ff4a3a' : '#4a2a2a'; gAir.lineWidth = 6; gAir.strokeRect(4, 4, 376, 88); gAir.fillStyle = on ? '#ff6a52' : '#5a3030'; gAir.shadowColor = '#ff4a3a'; gAir.shadowBlur = on ? 18 : 0; gAir.font = `800 52px ${SOURCES.titulo}`; gAir.textAlign = 'center'; gAir.textBaseline = 'middle'; gAir.fillText('EN EL AIRE', 192, 52); gAir.shadowBlur = 0; };
  paintAir(false); const texAir = textureOf(cAir);
  const aire = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshStandardMaterial({ map: texAir, emissiveMap: texAir, emissive: '#ffffff', emissiveIntensity: 1.1, color: '#000' }));
  aire.position.set(-2.95, 3.05, zB + 1.0); aire.renderOrder = 2; g.add(aire);   // por delante de tuberías y consolas, siempre a la vista
  // colgado del techo con dos cables y su caja (no flota en el aire)
  g.add(caja(1.18, 0.34, 0.06, materialSteel('#1b1714'), -2.95, 3.05, zB + 0.965));
  for (const dx of [-0.45, 0.45]) g.add(caja(0.014, HEIGHT - 3.22, 0.014, materialSteel('#2a2622'), -2.95 + dx, (HEIGHT + 3.22) / 2, zB + 0.965));
  let onAir = false;
  ctx.alActualizar(() => { const on = ctx.sala.estado === 'trabajando' || (vivo.get().notificaciones ?? []).some((n: any) => !n.vista && n.prioridad === 'alta'); if (on !== onAir) { onAir = on; paintAir(on); texAir.needsUpdate = true; } });
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(-1.45, 0, zB + 2.45), giro: Math.PI - 0.5, clip: 'Working_A' });
  // izquierda: casilleros de correo (estanterías con cajas) y tubo neumático
  const lockers = P(R.sf('Props_Shelf_Tall'), { pos: [-4.6, 0, zB + 0.5], alto: 3.0 }); ctx.aparato('radio', lockers);
  // baldas a 0,40 / 0,98 / 1,57 / 2,16: los paquetes, cada uno en la suya
  for (let i = 0; i < 12; i++) ctx.sobre(lockers, R.resource(['Containers_Box_Small', 'Containers_Crate_Small_Grey', 'Containers_Box_Medium'][i % 3]), { pos: [-5.2 + (i % 3) * 0.6, 0, zB + 0.5], ancho: 0.4, rot: (i * 0.3) % 0.6 - 0.3 }, { desde: [0.9, 1.5, 2.1, 2.7][Math.floor(i / 3)] });
  P(R.sf('Props_Vessel_Tall'), { pos: [-3.2, 0, zB + 0.5], alto: 2.2 });
  P(R.sf('Details_Pipes_Long'), { pos: [-3.2, 2.2, zB + 0.45], alto: 2.0, variant: ctx.vCopper, sombra: false });
  // derecha: monitores de canales (Discord y Slack) y sofá de espera
  const chats = new ListScreen('CANALES', 512, 320, v.pantalla);
  await monitorWall(ctx, 4.3, 2.3, 1.25, chats.tex, 1.1);
  P(R.casa('Couch_Small2'), { pos: [4.6, 0, zB + 0.9], alto: 1.0, rot: -0.2 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(3.4, zB), new THREE.Vector2(6, zB + 2.0)));
  signInWall(g, cartel(['ESCUCHA', 'MÁS', 'RESPONDE', 'MENOS'], 'OFICINA DE COMUNICACIONES · WORK-SHELTER', '#cfe3c0', '#2c4f2a', 'ojo', semilla), -2.9, 2.7, 0.56, 0.78, zB + 0.33, 0.03);
  const panel = new PanelRoom(); panel.titulo = 'TRÁFICO'; panel.color = v.pantalla;
  ctx.panel = panel;
  P(R.sv('Battery_Big'), { pos: [5.55, 0, 0.95], alto: 0.6 });
  mancha(g, -1.4, 0.8, 1.0, semilla);
  ctx.sala.walkZones = [[-2.6, -2.0], [2.7, 3.4]];
  ctx.sparks = new THREE.Vector3(2.1, 1.5, zB + 1.0);
  ctx.lamparas = [{ x: -3.8, z: 0.5, o: { intensidad: 80 } }, { x: 0.2, z: 0.6, o: { intensidad: 100, sombra: true, corta: true, goal: [0.2, -0.6] } }, { x: 4.2, z: 0.5, o: { intensidad: 80 } }];
  ctx.alActualizar((dt, t) => {
    const ns: any[] = vivo.get().notificaciones ?? [];
    // una línea por conversación (el servidor ya las junta), con cuántos mensajes trae
    const mas = (n: any) => (n.cuantos > 1 ? ` (${n.cuantos})` : '');
    const chat = (n: any) => n.fuente === 'discord' || n.fuente === 'slack';
    feed.poner(ns.slice(0, 7).map(n => ({ etiqueta: SOURCE_ICON[n.fuente] ?? n.fuente, texto: chat(n) ? `${n.titulo}${mas(n)}: ${n.titulo === n.autor ? '' : n.autor + ': '}${n.fragmento}` : `${n.autor}${mas(n)}: ${n.titulo}`, tinta: SOURCE_INK[n.fuente], urgente: n.prioridad === 'alta' && !n.vista })));
    chats.poner(ns.filter(chat).slice(0, 9).map(n => ({ etiqueta: n.titulo ?? n.canal ?? '', texto: `${n.titulo === n.autor ? '' : n.autor + ': '}${n.fragmento ?? ''}`, tinta: SOURCE_INK[n.fuente] })));
    revives = Math.max(0, revives - dt * 1.2);
    (screenFeed.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(t * 13) * 0.03 + revives * 0.4;
  });
}

// ---------------------------------------------------------------- agenda (tipo 'planificacion')
export async function furnishPlanning(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { valves: [4.8], segments: [[4.6, 2.6]] });
  // pieza protagonista: la pizarra de la semana con los eventos reales
  const pizarra = new WeekWhiteboard();
  const marco = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.8, 0.1), new THREE.MeshStandardMaterial({ color: '#3a2e22', roughness: 0.7 }));
  marco.position.set(-1.2, 2.3, zB + 0.36); g.add(marco); ctx.aparato('calendario', marco);
  const tabla = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshStandardMaterial({ map: pizarra.tex, roughness: 0.9, emissiveMap: pizarra.tex, emissive: '#ffffff', emissiveIntensity: 0.12 }));
  tabla.position.set(-1.2, 2.3, zB + 0.42); g.add(tabla);
  // relojes de pared (la hora local y la de la siguiente reunión)
  const reloj = new Reloj();
  const d = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshStandardMaterial({ map: reloj.tex, roughness: 0.5 })); d.position.set(2.7, 3.1, zB + 0.4); g.add(d);
  // mesa de reuniones con mapa y sillas
  const reunion = P(R.mueble('table_medium_long'), { pos: [-1.2, 0, 0.3], escala: K * 0.75 });
  ctx.sobre(reunion, R.herr('map'), { pos: [-1.35, 0, 0.3], escala: K * 0.55, rot: 0.2 });
  ctx.sobre(reunion, R.herr('drafting_compass'), { pos: [-0.55, 0, 0.5], escala: K * 0.45, rot: 0.9 });
  ctx.sobre(reunion, R.mueble('mug_A'), { pos: [-2.1, 0, 0.1], escala: K * 0.7 });
  ctx.sobre(reunion, R.herr('pencil_A_long'), { pos: [-1.95, 0, 0.55], escala: K * 0.6, rot: 0.4 });
  // las sillas, a los lados, de cara a la mesa (sin meterse en ella)
  for (const [x, r] of [[-2.55, Math.PI / 2], [0.15, -Math.PI / 2]] as const) P(R.mueble('chair_A'), { pos: [x, 0, 0.3], escala: K, rot: r });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-2.9, -0.35), new THREE.Vector2(0.5, 0.95)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(-3.4, 0, zB + 1.2), giro: Math.PI + 0.7, clip: 'Interact' });
  // la pieza: la pizarra de la semana. Se apunta en ella (se aviva), se repasa la agenda en el diario o se señala el día
  let revives = 0; const revive = () => { revives = 1; };
  for (const [id, x, gi] of [['pizarra', -2.85, Math.PI - 0.25], ['pizarra-2', 0.65, Math.PI + 0.3]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(x, 0, zB + 1.15), giro: gi,
    acciones: [{ clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }, { clip: 'Use_Item', onMake: revive }] });
  ctx.alActualizar(dt => { revives = Math.max(0, revives - dt); (tabla.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + revives * 0.22; });
  // derecha: archivador, monitor con la agenda de hoy y planta
  const agenda = new ListScreen('HOY', 512, 320, v.pantalla);
  await monitorWall(ctx, 3.0, 1.75, 1.15, agenda.tex, 1.1);
  await workStation(ctx, { id: 'silla', x: 3.45, z: -0.7, giro: -0.8, tex: agenda.tex, brillo: 1.0,
    encima: [{ ruta: R.herr('journal_open'), x: -0.68, z: 0.2, c: { escala: K * 0.45, rot: -0.3 } }, { ruta: R.mueble('cup_pencils'), x: 0.75, z: -0.2, c: { escala: K * 0.6 } }] });
  const drawers = P(R.casa('Drawer_3'), { pos: [5.45, 0, zB + 0.75], alto: 1.3, rot: -Math.PI / 2 });
  ctx.sobre(drawers, R.casa('Houseplant_5'), { pos: [5.45, 0, zB + 0.75], alto: 0.45 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(4.9, zB), new THREE.Vector2(6, zB + 1.9)));
  const estanteria = P(R.sf('Props_Shelf'), { pos: [-5.3, 0, zB + 0.5], alto: 2.3 });
  // la estantería llena: archivo de actas, agendas, planos enrollados y cajas de material (baldas a 0,39 / 0,95 / 1,51 / 2,07)
  const zE = zB + 0.5;
  const shelf = (y: number, piezas: [string, number, Record<string, number>][]) => { for (const [ruta, x, o] of piezas) { const { dz, ...c } = o; ctx.sobre(estanteria, ruta, { pos: [x, 0, zE + (dz ?? 0)], ...c }, { desde: y + 0.35 }); } };
  shelf(0.39, [[R.resource('Containers_Box_Medium'), -5.72, { alto: 0.4, rot: 0.15 }], [R.mueble('book_set'), -5.22, { ancho: 0.46 }], [R.resource('Containers_Crate_Small_Grey'), -4.78, { alto: 0.3, rot: -0.2 }]]);
  shelf(0.95, [[R.mueble('book_set'), -5.68, { ancho: 0.56 }], [R.mueble('book_set'), -5.14, { ancho: 0.5, rot: Math.PI }], [R.herr('journal_closed'), -4.8, { alto: 0.36, rot: 0.3 }]]);
  shelf(1.51, [[R.herr('map_rolled'), -5.75, { ancho: 0.2, alto: 0.12, rot: Math.PI / 2 }], [R.herr('map_rolled'), -5.62, { alto: 0.12, rot: Math.PI / 2 + 0.2, dz: 0.05 }], [R.resource('Containers_Box_Small'), -5.12, { alto: 0.34, rot: -0.3 }], [R.mueble('book_single'), -4.86, { alto: 0.4 }], [R.mueble('book_single'), -4.74, { alto: 0.36, rot: 0.2 }]]);
  shelf(2.07, [[R.resource('Containers_Box_Large'), -5.62, { alto: 0.46, rot: 0.1 }], [R.resource('Containers_Box_Small'), -4.95, { alto: 0.3, rot: 0.5 }]]);
  signInWall(g, cartel(['ESA REUNIÓN', 'PODÍA SER', 'UN CORREO'], 'COMITÉ DE AGENDA · WORK-SHELTER', '#d7e2ee', '#223d63', 'rayo', semilla), 5.0, 2.8, 0.56, 0.78, zB + 0.33, -0.03);
  const panel = new PanelRoom(); panel.titulo = 'AGENDA'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, 1.0, 1.2, 0.9, semilla);
  ctx.sala.walkZones = [[0.8, 1.8], [-3.6, -3.0]];   // nadie se queda delante de la estantería
  ctx.sparks = new THREE.Vector3(3.2, 1.0, zB + 1.0);
  ctx.lamparas = [{ x: -4.7, z: 0.4, o: { intensidad: 80 } }, { x: -1.2, z: 0.9, o: { intensidad: 100, sombra: true, corta: true, goal: [-1.2, -0.4] } }, { x: 3.6, z: 0.5, o: { intensidad: 80 } }];
  ctx.vapor = { pos: new THREE.Vector3(4.7, 3.15, zB + 0.85), dir: new THREE.Vector3(0.3, 0.9, 0.3) };
  const fmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
  ctx.alActualizar(() => {
    reloj.actualizar();
    const ev: any[] = vivo.get().eventos ?? [];
    pizarra.poner(ev);
    const hoy = new Date().toDateString();
    agenda.poner(ev.filter(e => new Date(e.inicio).toDateString() === hoy).slice(0, 9).map(e => ({ etiqueta: e.allElDay ? 'TODO EL DÍA' : fmt.format(e.inicio), texto: e.titulo, tinta: e.fuente === 'google' ? '#e6d28a' : '#7ad1ff', urgente: e.inicio > Date.now() && e.inicio - Date.now() < 15 * 60000 })));
  });
}

// ---------------------------------------------------------------- Logística (Linear)
export async function furnishLogistics(ctx: Contexto) {
  const { g, v, zB, K, P, semilla } = ctx;
  await highBand(ctx, { reloj: -5.1, valves: [4.6], segments: [[4.9, 1.8]] });   // nada por delante de la pantalla
  ctx.vapor = { pos: new THREE.Vector3(-4.9, 3.15, zB + 0.85), dir: new THREE.Vector3(-0.3, 0.9, 0.3) };
  // pieza protagonista: la pantalla táctica con el tablero (columnas por estado)
  const tablero = new BoardKanban(v.pantalla);
  // el canto superior queda justo bajo el dintel de la sala; la gráfica del ciclo, abajo, por encima del holograma
  const YT = 2.5;
  const marco = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: '#1c1514', roughness: 0.5, metalness: 0.5 }));
  marco.position.set(0, YT, zB + 0.36); g.add(marco); ctx.aparato('tablero', marco);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2.35), new THREE.MeshStandardMaterial({ map: tablero.tex, emissiveMap: tablero.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(0, YT, zB + 0.43); g.add(screen);
  screen.userData.interactivo = 'tablero'; screen.userData.vista = 'jira';   // un clic en la pantalla abre directamente el tablero de Jira (refugio.ts, clic)
  // a la derecha, la consola de pie frente a la pantalla; a la izquierda, el puesto del jefe de logística (mesa de tres
  // cuartos con su monitor de incidencias)
  const pIssues = new PhosphorScreen(256, 256, v.pantalla); pIssues.speed = 18; pIssues.escribir(['issues: 14', 'en curso: 5', 'bloqueadas: 1']); ctx.sala.pantallas.push(pIssues);
  const c = await place(g, R.sf('Props_ComputerSmall'), { pos: [3.0, 0, zB + 1.3], alto: 1.45, rot: -0.5, estatico: false });
  overlayScreen(c, /^Black$/, pIssues.tex, { brillo: 1.2, margin: 0.9 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(2.55, zB + 0.8), new THREE.Vector2(3.45, zB + 1.75)));
  const pMias = new PhosphorScreen(384, 256, v.pantalla, ' mis incidencias'); pMias.speed = 18; pMias.escribir(['por hacer: 5', 'en curso: 3', 'en revisión: 3']); ctx.sala.pantallas.push(pMias);
  await workStation(ctx, { id: 'puesto', x: -3.05, z: -0.7, giro: 0.8, tex: pMias.tex, silla: R.mueble('chair_desk_A'),
    encima: [{ ruta: R.mueble('mug_A'), x: -0.72, z: 0.2, c: { escala: K * 0.7 } }, { ruta: R.herr('journal_closed'), x: 0.7, z: -0.1, c: { escala: K * 0.45, rot: 0.5 } }] });
  // mesa táctica con holograma (el ciclo actual) y consolas grandes a los lados
  P(R.sf('Props_Base'), { pos: [0, 0, zB + 1.9], ancho: 2.6 });
  // la pieza: la mesa táctica. Se mueve el holograma con las manos (el núcleo se acelera y el cono se aviva), se toca la
  // consola de su borde o se repasa el ciclo en el diario
  let impulse = 0; const revive = () => { impulse = 1; };
  for (const [id, x] of [['holo', -1.5], ['holo-2', 1.5]] as const) ctx.sala.puntos.push({ id, tipo: 'pieza', pos: new THREE.Vector3(x, 0, zB + 2.75), giro: Math.atan2(-x, -0.85),
    acciones: [{ clip: 'Ranged_Magic_Spellcasting', onMake: revive }, { clip: 'Interact', onMake: revive }, { clip: 'Holding_A', utensil: 'diario', dur: 4 }] });
  const holo = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 1.05, 1.05, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7a5a', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  holo.position.set(0, 0.82, zB + 1.9); g.add(holo);
  const coreHolo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a7a').multiplyScalar(2), wireframe: true }));
  coreHolo.position.set(0, 1.2, zB + 1.9); g.add(coreHolo);
  ctx.alActualizar((dt, t) => {
    impulse = Math.max(0, impulse - dt * 0.8);
    coreHolo.rotation.y += dt * (0.8 + impulse * 5); coreHolo.rotation.x += dt * 0.3;
    (holo.material as THREE.MeshBasicMaterial).opacity = 0.09 + Math.sin(t * 7) * 0.02 + impulse * 0.08;
  });
  P(R.cy('Computer_Large'), { pos: [-4.75, 0, zB + 0.55], alto: 2.2, rot: 0.3 });
  P(R.cy('Computer_Large'), { pos: [4.5, 0, zB + 0.55], alto: 2.2, rot: -0.3 });
  ctx.sala.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.35, zB), new THREE.Vector2(1.35, zB + 3.2)), new THREE.Box2(new THREE.Vector2(-6, zB), new THREE.Vector2(-4.1, zB + 1.1)), new THREE.Box2(new THREE.Vector2(3.9, zB), new THREE.Vector2(6, zB + 1.6)));
  ctx.sala.puntos.push({ id: 'consola', tipo: 'consola', pos: new THREE.Vector3(2.75, 0, zB + 2.05), giro: Math.PI - 0.5, clip: 'Working_A' });
  // lados: taquillas con carpetas, cajas de munición convertidas en archivo de tickets (una sobre otra) y la bengala de
  // las urgencias encima del baúl
  const locker = P(R.sf('Props_Shelf_Tall'), { pos: [-5.45, 0, zB + 0.5], alto: 2.3, rot: 0 });
  for (const [k, y] of [0.6, 1.05, 1.5].entries()) ctx.sobre(locker, R.mueble('book_set'), { pos: [-5.5 + (k % 2) * 0.15, 0, zB + 0.5], ancho: 0.55, rot: k * 0.2 }, { desde: y });
  const ammo = P(R.acc('ammo_crate_withLid'), { pos: [-4.3, 0, zB + 0.45], escala: K * 1.0, rot: 0.3 });
  ctx.sobre(ammo, R.acc('ammo_crate'), { pos: [-4.3, 0, zB + 0.45], escala: K * 0.9, rot: -0.2 });
  const baul = P(R.sf('Props_Chest'), { pos: [5.25, 0, zB + 1.2], alto: 0.8, rot: -0.2 });
  ctx.sobre(baul, R.sv('FlareGun'), { pos: [5.25, 0, zB + 1.2], alto: 0.12, rotX: -Math.PI / 2, rotZ: 0.6 });
  signInWall(g, cartel(['SI NO ESTÁ', 'EN UN TICKET,', 'NO PASÓ'], 'LOGÍSTICA · WORK-SHELTER', '#ead2c8', '#5e2423', 'engranaje', semilla), -5.0, 2.7, 0.56, 0.78, zB + 0.33, 0.03);
  const panel = new PanelRoom(); panel.titulo = 'TABLEROS'; panel.color = v.pantalla; ctx.panel = panel;
  mancha(g, 0, 1.1, 1.2, semilla);
  ctx.sala.walkZones = [[-1.9, -1.5], [1.5, 2.2]];
  ctx.sparks = new THREE.Vector3(3.0, 1.2, zB + 1.5);
  ctx.lamparas = [{ x: -4.2, z: 0.6, o: { intensidad: 80 } }, { x: 0, z: 0.9, o: { intensidad: 105, sombra: true, corta: true } }, { x: 4.2, z: 0.6, o: { intensidad: 80 } }];
  let lastReading = -1e9; let tareas: TaskJira[] | null = null; let prs: PRBoard[] = [];
  ctx.alActualizar((dt, t) => {
    // el tablero de la pared: tus tareas de Jira (en DEMO, las de ejemplo) por estado, con cuántos PR llevan
    if (t - lastReading > 120) {
      lastReading = t;
      cliente.accion<any>('integracion.panel', { fuente: 'jira' }).then(p => { tareas = p.tareas ?? []; aimColors(tareas!); }).catch(() => {});
      cliente.accion<any>('git.prsTablero', {}).then(p => { prs = p.prs ?? []; knowTasks(prs.map(pRTask)); }).catch(() => {});
    }
    if (tareas) {
      const crossing = cruzarTablero(tareas, prs);
      const prioridad = (p?: string) => /highest|blocker|critical/i.test(p ?? '') ? 1 : /high|alta/i.test(p ?? '') ? 2 : /low|baja/i.test(p ?? '') ? 4 : 3;
      const ficha = (i: TaskWithPR) => ({ id: i.clave, color: taskColor(i.clave), titulo: i.titulo, prioridad: prioridad(i.prioridad), sub: [i.estado, i.prs.length ? `${i.prs.length} PR` : ''].filter(Boolean).join(' · '), asignado: 'Tú' });
      tablero.poner(crossing.columnas.filter(c => c.id !== 'hecho').map(c => ({ nombre: c.nombre, fichas: c.tareas.map(ficha) })), null);
    } else {
      const ns: any[] = (vivo.get().notificaciones ?? []).filter((n: any) => n.fuente === 'linear');
      const fichas = ns.map(n => ({ id: n.canal ?? 'REF', titulo: (/«([^»]+)»/.exec(n.fragmento ?? '')?.[1]) ?? n.fragmento ?? n.titulo, prioridad: n.prioridad === 'alta' ? 1 : n.prioridad === 'media' ? 2 : 3, txt: n.fragmento ?? '' }));
      const col = (re: RegExp) => fichas.filter(f => re.test(f.txt));
      tablero.poner([
        { nombre: 'Por hacer', fichas: col(/asignad|nueva|creado/i) },
        { nombre: 'En curso', fichas: fichas.filter(f => !/asignad|nueva|creado|revisi/i.test(f.txt)) },
        { nombre: 'En revisión', fichas: col(/revisi/i) },
      ], { nombre: 'Ciclo 14', progreso: 62 });
    }
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(t * 11) * 0.03;
  });
}
