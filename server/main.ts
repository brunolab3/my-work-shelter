// Servidor local de work-shelter: sirve el juego, el material y un WebSocket con el estado, las sesiones de Claude Code,
// las terminales y las integraciones. Solo escucha en 127.0.0.1 y rechaza otros orígenes.
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { WebSocketServer, type WebSocket } from 'ws';
import { GAME_NAME, type ClientMessage, type ServerMessage, type InfoRepo, type Visitante } from '../shared/protocolo.ts';
import { Sessions } from './sesiones.ts';
import { Attachments } from './adjuntos.ts';
import { openAttachment, isPackage, revealLocal } from './abrir.ts';
import { openLink, servePage, existingPages, pagesUpdated } from './paginasLocales.ts';
import { cleanCompares } from './comparar.ts';
import { isCloneOfExample } from './ejemplos.ts';
import { mcpDecor, promptAdaptar, type CtxDecor } from './decoradoSala.ts';
import { mcpAssignment, mcpPlan, type CtxAssignment } from './reparto.ts';
import { mcpRooms, taskWorktree, type CtxRooms } from './avisosSalas.ts';
import { Plans, tasksOrder } from './planes.ts';
import { BlockersPR } from './bloqueosPR.ts';
import { TasksColors } from './coloresTareas.ts';
import { agruparPorTarea, planDeSala, applyPlan } from './organizar.ts';
import { ReviewsPR, REVIEWS_QUERY, remoteRepo } from './revisionesPR.ts';
import { TasksCleanup } from './limpiezaTareas.ts';
import { entornoGit } from './entornoGit.ts';
import { captureRoom } from './capturaSala.ts';
import { baseStock } from '../shared/decorado.ts';
import { readSecret } from './integraciones/llavero.ts';
import { Dictations } from './voz.ts';
import { Terminales, SOCKET_TERMINALS } from './terminales.ts';
import { openInDesktop, openInAppClaude, outsideOpen, closeOutside, hookCommand, resumeCommand, type ItemDesktop } from './escritorio.ts';
import { tonesForRepeated } from '../shared/reclutas.ts';
import { remoteName } from '../shared/tareas.ts';
import { Store, DATOS, folderOf, reposRoot, hideRoom, showRoom, isHideable } from './estado.ts';
import { infoRepo, sugerencias, expand, recentTranscripts, liveSessions, worktreeList, estiloSala, projectType } from './repos.ts';
import { Integraciones } from './integraciones/index.ts';
import { gameAction, ensurePlayer, growCrops, taskReward } from './juego.ts';
import { generateRecruit } from '../shared/reclutas.ts';
import { distribute, disposicionDeSerie, isRoomOfRepo, PLANNING_ROOM, placeRoom, moveFloor } from '../shared/disposicion.ts';
import { STYLE_PALETTE, areaByType, isArea } from '../shared/sectores.ts';
import { isLanguage, setLanguage } from '../shared/idioma.ts';
import * as controlRemoto from './controlRemoto.ts';
import { SlackRemote } from './slackMando.ts';
import { REMOTE_DELAY_MS, type RemoteDeps } from './mando.ts';
import { sanitizeLook, TYPES_STOCK } from '../shared/aspecto.ts';
import { t } from '../shared/idioma.ts';

// reinicio desde el juego: antes de apagar el servidor viejo se carga el nuevo con esta variable para ver que arranca
// (un error de sintaxis o una importación rota se detectan aquí y el juego sigue en marcha)
if (process.env.SHELTER_COMPROBAR) process.exit(0);

const RAIZ = path.resolve(import.meta.dirname, '..');
const PUERTO = Number(process.env.SHELTER_PUERTO || 3778);
const WEB = path.join(RAIZ, 'dist', 'web');
const ASSETS = path.join(RAIZ, 'assets');
const GRACE_MS = 20_000;
// huellas del código (scripts/huellas.cjs): /salud dice la de este servidor para que ./shelter sepa si es de antes de
// los últimos cambios, y el reinicio las usa para recompilar el cliente o volver a abrir la app entera si hace falta
const huellas = createRequire(import.meta.url)('../scripts/huellas.cjs') as { huella(grupo: 'cliente' | 'servidor' | 'app'): string; clienteAlDia(): boolean };
const SERVER_FINGERPRINT = huellas.huella('servidor');
// los orígenes del servidor de desarrollo (Vite, 5173) solo con SHELTER_DEV=1: en uso normal, solo el propio refugio
const DEVELOPMENT = !!process.env.SHELTER_DEV;
const VITE = Number(process.env.SHELTER_PUERTO_VITE || 5173);   // varios refugios de prueba a la vez, cada uno con su Vite
const ORIGINS = new Set([`http://127.0.0.1:${PUERTO}`, `http://localhost:${PUERTO}`, ...(DEVELOPMENT ? [`http://127.0.0.1:${VITE}`, `http://localhost:${VITE}`] : [])]);
// secreto por arranque: va dentro de la página que sirve el refugio (o en DATOS/token para Vite en desarrollo) y se exige
// al abrir el WebSocket. Otra web no puede leerlo y otro usuario del Mac no puede leer el archivo (0600).
// Con el supervisor (./shelter) el secreto es del arranque entero y sobrevive a los reinicios del servidor.
const TOKEN = /^[0-9a-f]{32,}$/.test(process.env.SHELTER_TOKEN ?? '') ? process.env.SHELTER_TOKEN! : randomBytes(24).toString('hex');
delete process.env.SHELTER_TOKEN;   // que no lo herede nada de lo que lanza el servidor
// se escribe al conseguir el puerto (un segundo servidor que no arranca no pisa el del primero)
const writeToken = () => { try { mkdirSync(DATOS, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DATOS, 'token'), TOKEN, { mode: 0o600 }); } catch (e) { console.error('No pude escribir el token:', (e as Error).message); } };
const tokenValid = (t: string | null) => { if (!t) return false; const a = Buffer.from(t), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
const HOSTS = /^(127\.0\.0\.1|localhost):\d+$/;
process.on('uncaughtException', e => console.error('Error no capturado (el refugio sigue):', e));
// si se cae la ventana que lo lanzó, su salida ya no va a ningún sitio: escribir en ella no puede tumbar el servidor
for (const f of [process.stdout, process.stderr]) f.on('error', () => {});
process.on('unhandledRejection', e => console.error('Promesa rechazada sin capturar (el refugio sigue):', e));

const insideOf = (ruta: string, dir: string) => ruta === dir || ruta.startsWith(dir + path.sep);
const almacen = new Store();
if (almacen.estado.idioma) setLanguage(almacen.estado.idioma);
ensurePlayer(almacen);
const repos: Record<string, InfoRepo> = {};
const clients = new Set<WebSocket>();
let graceTimer: NodeJS.Timeout | null = null;

function pathRoom(ruta: string): string | undefined {
  // las rutas dentro de un worktree (.claude/worktrees/x o worktrees externos) se resuelven al repo principal
  let mejor: { id: string; largo: number } | undefined;
  for (const s of almacen.estado.salas) {
    const candidatas = [folderOf(s), ...(s.ruta ? (repos[s.id]?.worktrees ?? []).map(w => w.ruta) : [])];
    for (const c of candidatas) if ((ruta === c || ruta.startsWith(c + path.sep)) && c.length > (mejor?.largo ?? 0)) mejor = { id: s.id, largo: c.length };
  }
  return mejor?.id;
}

const adjuntos = new Attachments(DATOS);
// el decorado de las salas de repo, para las herramientas de su habitante («Adaptar la sala al repo», decoradoSala.ts)
const ctxDecor: CtxDecor = {
  sala: id => almacen.estado.salas.find(s => s.id === id && isRoomOfRepo(s.tipo)),
  plantilla: id => { const s = almacen.estado.salas.find(x => x.id === id); return s ? baseStock(s, repos[id]) : 'taller'; },
  guardar: (id, d) => {
    almacen.cambiar(x => { const s = x.salas.find(y => y.id === id); if (!s) return; if (d) s.decorado = d; else delete s.decorado; });
    broadcast({ t: 'estado', estado: almacen.estado as any });
  },
  // la foto, con el propio juego (en desarrollo, el de Vite: el compilado puede ser de antes)
  capturar: id => captureRoom(`http://127.0.0.1:${DEVELOPMENT ? VITE : PUERTO}/?sala=${encodeURIComponent(id)}&revisar#t=${TOKEN}`, id),
};
// el reparto del trabajo desde las salas de coordinación (reparto.ts): cada parte, un trabajo nuevo en la sala de su
// repo y en un worktree propio
const ctxAssignment = (wing: string): CtxAssignment => ({
  salas: () => almacen.estado.salas.filter(s => s.tipo === 'repo' && s.ruta).map(s => ({
    id: s.id, nombre: s.nombre, ruta: s.ruta!, rama: repos[s.id]?.rama,
    habitante: almacen.estado.habitantes.find(h => h.salaId === s.id)?.nombre,
    inIsWing: s.ruta!.startsWith(wing + path.sep),
  })),
  pathRoom,
  empezar: async (salaId, prompt) => {
    const h = almacen.estado.habitantes.find(x => x.salaId === salaId);
    if (!h) throw new Error(t('server.theRoomHasNoDweller'));
    const sesionId = await startWork(undefined, { t: 'empezar', dwellerId: h.id, salaId, prompt, opciones: { worktree: true } });
    return { sesionId, habitante: h.nombre };
  },
  ...ctxPlan,
});
// el plan compartido de cada tarea repartida (planes.ts): lo leen las salas de sus partes y los cambios les llegan como mensaje
const planes = new Plans(DATOS);
// bloqueos entre PR marcados a mano en el tablero de despliegue de la sala de planificación
const bloqueosPR = new BlockersPR(DATOS);
// el color de cada tarea en tableros y hologramas (shared/tareas.ts)
const coloresTareas = new TasksColors(DATOS);
const ctxPlan: Pick<CtxAssignment, 'planes' | 'avisar' | 'mensajero' | 'sesionDeTarea'> = {
  planes,
  avisar: (id, texto) => { try { if (sesiones.lista().find(s => s.id === id)?.estado === 'cerrada') return false; sesiones.enviar(id, texto); return true; } catch { return false; } },
  sesionDeTarea: (salaId, clave) => {
    const k = clave.toLowerCase();
    return sesiones.lista().filter(s => s.salaId === salaId && s.estado !== 'cerrada' && path.basename(s.worktree ?? s.cwd).toLowerCase().includes(k)).sort((a, b) => b.actualizada - a.actualizada)[0]?.id;
  },
  mensajero: (desde, a, motivo) => broadcast({ t: 'mensajero', desde, a, motivo }),
};
// mensajes entre salas (avisosSalas.ts): a la conversación de la tarea o a una nueva con el habitante, en automático
const ctxRooms: CtxRooms = {
  salas: () => almacen.estado.salas.map(s => { const h = almacen.estado.habitantes.find(x => x.salaId === s.id); return { id: s.id, nombre: s.nombre, habitante: h && { id: h.id, nombre: h.nombre } }; }),
  sesionDeTarea: (salaId, clave) => ctxPlan.sesionDeTarea!(salaId, clave),
  worktreeDeTarea: (salaId, clave) => taskWorktree(repos[salaId]?.worktrees ?? [], clave),
  avisar: (id, texto) => ctxPlan.avisar(id, texto),
  empezar: (salaId, dwellerId, prompt, donde) => startWork(undefined, { t: 'empezar', dwellerId, salaId, prompt, opciones: { cwd: donde?.cwd, worktree: donde?.worktree, permisos: 'auto' } }),
  mensajero: (desde, a, motivo) => ctxPlan.mensajero(desde, a, motivo),
  aviso: texto => broadcast({ t: 'aviso', nivel: 'info', texto }),
};
const sesiones = new Sessions({
  pathRoom, reposOfShelter: () => gitPaths(), mcpRoom: id => (ctxDecor.sala(id) ? mcpDecor(id, ctxDecor) : undefined),
  mcpAssignment: (id, preguntar, sesionId) => { const s = almacen.estado.salas.find(x => x.id === id && x.tipo === 'coordinacion' && x.ruta); return s ? mcpAssignment(ctxAssignment(s.ruta!), { coordinacion: s.nombre, salaId: s.id, sesionId, preguntar }) : undefined; },
  mcpRooms: id => mcpRooms(ctxRooms, id),
  mcpPlan: id => { const s = almacen.estado.salas.find(x => x.id === id && x.tipo === 'repo'); return s && planes.ofRoom(id).length ? mcpPlan(ctxPlan, { salaId: id, sala: s.nombre }) : undefined; },
  trustedFolders: () => ((almacen.estado.ajustes as any).trustedFolders ?? []) as string[],
  trust: ruta => { const a = almacen.estado.ajustes as any; a.trustedFolders = [...new Set([...(a.trustedFolders ?? []), path.resolve(ruta)])]; almacen.guardar(); },
}, adjuntos);
const dictations = new Dictations(DATOS);
dictations.preparar();
const terminales = new Terminales(cwd => !!pathRoom(cwd) || almacen.estado.salas.some(s => { const c = folderOf(s); return cwd === c || cwd.startsWith(c + path.sep); }), () => [...clients].map(outputOf));
const integraciones = new Integraciones(almacen, (m) => broadcast(m));

// mando a distancia por Slack (mando.ts, slackMando.ts): las peticiones de aprobación, para responderlas sin salir del
// refugio, y la lista de salas y conversaciones para pasarlas a Remote Control; con una app propia y Socket Mode
// el Supervisor está usando el juego: lo dice cada página cada 30 s mientras su ventana está delante y la tocan
// (web/src/motor/foco.ts, watchPresence); sin aviso en 90 s, no
let lastUse = 0;
const mandoDeps: RemoteDeps = {
  retrasoMs: REMOTE_DELAY_MS,
  enUso: () => Date.now() - lastUse < 90_000,
  sesiones: () => sesiones.lista(),
  salas: () => almacen.estado.salas.filter(s => isRoomOfRepo(s.tipo) || sesiones.lista().some(x => x.salaId === s.id && x.estado !== 'cerrada')).map(s => ({ id: s.id, nombre: s.nombre })),
  habitante: s => almacen.estado.habitantes.find(h => h.id === s.dwellerId)?.nombre ?? 'Habitante',
  responder: (id, peticionId, decision, responses) => sesiones.responder(id, peticionId, decision, undefined, responses),
  aRemoteControl: ids => exitASurface(ids ? { sesiones: ids, remoto: true, windowNew: true } : { todo: true, remoto: true, windowNew: true }),
};
const slackRemote = new SlackRemote({ datos: DATOS, ...mandoDeps });

// una función de salida por socket (las terminales la recuerdan para enviar a cada pestaña y soltarla al cerrar)
const salidas = new WeakMap<WebSocket, (m: any) => void>();
function outputOf(ws: WebSocket) { let f = salidas.get(ws); if (!f) { f = x => enviar(ws, x); salidas.set(ws, f); } return f; }
function enviar(ws: WebSocket, m: ServerMessage) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }
function broadcast(m: ServerMessage) { const s = JSON.stringify(m); for (const c of clients) if (c.readyState === c.OPEN) c.send(s); }

// conversaciones nacidas en el refugio (para no confundirlas con visitantes, aunque se cierren o se reinicie el servidor)
const ownIds = new Set<string>(((almacen.estado.ajustes as any).ownSessions ?? []) as string[]);
sesiones.on('sesion', s => {
  broadcast({ t: 'sesion', sesion: s });
  if (s.claudeId && !ownIds.has(s.claudeId)) { ownIds.add(s.claudeId); (almacen.estado.ajustes as any).ownSessions = [...ownIds].slice(-300); almacen.guardar(); }
  // quien trabaja primero dentro de un worktree es su autor: el holograma de la sala es una copia suya
  const wt = s.estado !== 'cerrada' ? pathWorktree(s.cwd) : undefined;
  if (wt && !authorsWorktree()[wt]) { authorsWorktree()[wt] = s.dwellerId; almacen.guardar(); refreshReposPronto(); }
});
function authorsWorktree(): Record<string, string> { const a = almacen.estado.ajustes as any; return (a.authorsWorktree ??= {}); }
function pathWorktree(cwd: string) {
  for (const info of Object.values(repos)) for (const w of info.worktrees) if (!w.principal && (cwd === w.ruta || cwd.startsWith(w.ruta + path.sep))) return w.ruta;
  return /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];
}
let timerRepos: NodeJS.Timeout | null = null;
function refreshReposPronto() { if (timerRepos) return; timerRepos = setTimeout(() => { timerRepos = null; refreshRepos().catch(() => {}); }, 400); }
sesiones.on('sesion', () => aimOpen());
// lo que pide aprobación, también al móvil (y su mensaje se recoge en cuanto se responde, aquí o allí)
sesiones.on('sesion', s => { slackRemote.peticion(s).catch(() => {}); });
sesiones.on('entradas', (sesionId, entradas) => broadcast({ t: 'entradas', sesionId, entradas }));
sesiones.on('texto', (sesionId, delta) => broadcast({ t: 'texto', sesionId, delta }));
sesiones.on('fuera', sesionId => broadcast({ t: 'sesionFuera', sesionId }));
sesiones.on('herramienta', () => {
  const antes = almacen.estado.jugador.cultivos.map(c => c.phase).join();
  almacen.estado.jugador.toolsCalls++; growCrops(almacen); almacen.guardar();
  if (almacen.estado.jugador.cultivos.map(c => c.phase).join() !== antes) broadcast({ t: 'estado', estado: almacen.estado as any });
});
// límites de uso del plan de Claude: el refugio avisa (una vez por estado) en vez de callarlo
let lastLimit = '';
sesiones.on('limite', (i: any) => {
  if (!i || i.status === 'allowed') { lastLimit = ''; return; }
  const clave = i.status + i.rateLimitType; if (clave === lastLimit) return; lastLimit = clave;
  const tipo = ({ five_hour: 'de 5 horas', seven_day: 'semanal', seven_day_opus: 'semanal de Opus', seven_day_sonnet: 'semanal de Sonnet' } as any)[i.rateLimitType] ?? '';
  const cuando = i.resetsAt ? ' Se renueva ' + new Date(i.resetsAt * (i.resetsAt < 1e12 ? 1000 : 1)).toLocaleString('es-ES', { weekday: 'long', hour: '2-digit', minute: '2-digit' }) + '.' : '';
  broadcast({ t: 'aviso', nivel: i.status === 'rejected' ? 'error' : 'aviso', texto: i.status === 'rejected' ? `Claude ha llegado al límite de uso ${tipo}.${cuando}` : `Queda poco del límite de uso ${tipo} de Claude${i.utilization ? ` (${Math.round(i.utilization * 100)} %)` : ''}.${cuando}` });
});
sesiones.on('turno', r => {
  // cada tarea terminada produce algo en el refugio: chatarra y, a veces, una pieza para la guía de campo
  if (r.estado === 'terminada' && r.turnTools > 0) {
    const p = taskReward(almacen, r.turnTools);
    const quien = almacen.estado.habitantes.find(x => x.id === r.dwellerId)?.nombre ?? 'Alguien';
    broadcast({ t: 'estado', estado: almacen.estado as any });
    broadcast({ t: 'aviso', nivel: 'info', texto: `${quien} ha terminado: +${p.scrap} de chatarra${p.pieza ? ` y ha encontrado ${p.pieza.nombre} (${p.pieza.rarity})` : ''}.` });
  }
  const h = almacen.estado.habitantes.find(x => x.id === r.dwellerId); if (h && r.claudeId) { h.lastSession = r.claudeId; almacen.guardar(); }
});

// las conversaciones abiertas, en disco: si el refugio entero se cae, `./shelter superficie` las retoma fuera
let openTimer: NodeJS.Timeout | null = null;
function aimOpen() {
  if (openTimer) return;
  openTimer = setTimeout(() => {
    openTimer = null;
    if (switchingOff) return;
    const lista = sesiones.lista().filter(s => s.estado !== 'cerrada' && s.claudeId).map(s => ({ claudeId: s.claudeId, cwd: s.cwd, titulo: s.titulo, habitante: almacen.estado.habitantes.find(h => h.id === s.dwellerId)?.nombre, estado: s.estado, permisos: s.modoPermisos }));
    try { writeFileSync(path.join(DATOS, 'abiertas.json'), JSON.stringify(lista), { mode: 0o600 }); } catch {}
  }, 1000);
}

// ---------------------------------------------------------------- salir a la superficie
// Lo que estaba en el juego (conversaciones y terminales) sigue en tu escritorio: el botón ↗ de cada ventana, la tecla
// de pánico (⇧⌥⌘Esc), `./shelter superficie` o, solo, si el juego se cae (escritorio.ts)
const SHELTER = path.join(RAIZ, 'shelter');
const subiendo = new Set<string>();   // conversaciones que ya van camino de la superficie (no se abren dos veces)
async function exitASurface(d: Record<string, any>) {
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const idsSes = (d.todo ? sesiones.lista().filter(s => s.estado !== 'cerrada').map(s => s.id) : lista(d.sesiones)).filter(id => !subiendo.has(id));
  for (const id of idsSes) subiendo.add(id);
  try { return await subir(d, idsSes); } finally { for (const id of idsSes) subiendo.delete(id); }
}
async function subir(d: Record<string, any>, idsSes: string[]) {
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  // al móvil (remoto) solo van las conversaciones: Remote Control no lleva terminales
  const idsTerm = d.remoto ? [] : d.todo ? terminales.abiertas().filter(t => !t.fuera).map(t => t.id) : lista(d.terminales).filter(id => terminales.existe(id));
  const avisos: string[] = [];
  const nombre = (hid: string) => almacen.estado.habitantes.find(h => h.id === hid)?.nombre ?? 'Habitante';
  const roomOf = (cwd: string) => almacen.estado.salas.find(s => s.id === pathRoom(cwd))?.nombre ?? path.basename(cwd);
  // primero las terminales (al momento); las conversaciones que trabajan tardan un poco en pararse
  const terms: ItemDesktop[] = [];
  if (idsTerm.length && !terminales.outsideAccepts()) avisos.push('Las terminales abiertas antes de esta actualización no se pueden sacar: ciérralas y vuelve a abrirlas.');
  else for (const id of idsTerm) { const t = terminales.abiertas().find(x => x.id === id); if (t) terms.push({ titulo: `Terminal · ${roomOf(t.cwd)}`, comando: hookCommand(SHELTER, SOCKET_TERMINALS, id) }); }
  let app = '';
  const abrir = async (items: ItemDesktop[], windowNew: boolean) => { try { app = await openInDesktop(items, { windowNew }); return true; } catch (e) { avisos.push((e as Error).message); return false; } };
  if (terms.length) await abrir(terms, !!d.windowNew);
  const taken = (await Promise.all(idsSes.map(id => sesiones.sacar(id).catch(e => { avisos.push((e as Error).message); return null; })))).filter(Boolean) as Awaited<ReturnType<typeof sesiones.sacar>>[];
  // con Remote Control (d.remoto), también se sigue desde el móvil: la app de Claude la lista con este mismo nombre
  // con el nombre `repo:TAREA` (remoteName): así se reconoce en el móvil y, al volver, en la lista del visitante
  const remoteOf = (cwd: string) => {
    const sala = almacen.estado.salas.find(s => s.id === pathRoom(cwd)), wt = pathWorktree(cwd);
    return { repo: sala?.ruta ? path.basename(sala.ruta) : sala?.nombre ?? path.basename(cwd), wt: wt ? { ruta: wt, rama: Object.values(repos).flatMap(i => i.worktrees).find(w => w.ruta === wt)?.rama } : undefined };
  };
  const conv = taken.map(r => {
    const titulo = `${nombre(r.dwellerId)} · ${r.titulo}`, rc = remoteOf(r.cwd);
    return { titulo, comando: resumeCommand(d.remoto ? { ...r, remoto: remoteName(rc.repo, r.titulo, rc.wt) } : r) };
  });
  if (conv.length && !(await abrir(conv, !!d.windowNew && !terms.length)))
    avisos.push('Las conversaciones están guardadas: retómalas desde su habitante o con ' + taken.map(r => `claude --resume ${r.claudeId}`).join(', ') + '.');
  if (d.remoto && conv.length) broadcast({ t: 'aviso', nivel: 'info', texto: t('server.remoteControlOpened', { app: app || 'iTerm' }) });
  else if (terms.length || conv.length) broadcast({ t: 'aviso', nivel: 'info', texto: `A la superficie: ${[conv.length && `${conv.length} conversaci${conv.length > 1 ? 'ones' : 'ón'}`, terms.length && `${terms.length} terminal${terms.length > 1 ? 'es' : ''}`].filter(Boolean).join(' y ')} en ${app || 'tu escritorio'}.` });
  for (const a of avisos) broadcast({ t: 'aviso', nivel: 'aviso', texto: a });
  return { sesiones: conv.length, terminales: terms.length, avisos, app };
}
// A la app de Claude: una conversación abierta se cierra antes en el juego (no se escribe en dos sitios a la vez);
// una del archivo (claudeId) va tal cual, si no está viva aquí
async function aAppClaude(d: Record<string, any>) {
  let claudeId = String(d.claudeId ?? '');
  if (d.sesionId) {
    const id = String(d.sesionId);
    if (subiendo.has(id)) return { claudeId: null };
    subiendo.add(id);
    try { claudeId = (await sesiones.sacar(id, t('server.theClaudeApp'))).claudeId; } finally { subiendo.delete(id); }
  } else if (sesiones.lista().some(s => s.claudeId === claudeId && s.estado !== 'cerrada')) throw new Error(t('server.thatConversationIsOpenIn'));
  await openInAppClaude(claudeId);
  broadcast({ t: 'aviso', nivel: 'info', texto: t('server.theConversationContinuesInThe') });
  return { claudeId };
}
// tras sacar terminales, se espera a que se enganchen fuera antes de cerrar nada (si no, se irían con el juego)
async function waitHooks(ids: string[], ms = 10_000) {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise(r => setTimeout(r, 200))) if (ids.every(id => !terminales.existe(id) || terminales.fuera(id) > 0)) return;
}

// ---------------------------------------------------------------- repos y visitantes
// GitHub en la sala de Control de Versiones: solo con la integración conectada (en DEMO, de prueba; apagada, nada), con
// su token si lo hay
async function connectionGitHub() {
  const r = almacen.estado.integraciones.github;
  if (r?.modo !== 'real') return { real: false, off: r?.modo !== 'demo' };
  const token = r.secrets?.includes('token') ? await readSecret('github.token').catch(() => null) : null;
  return { real: true, token: token ?? undefined };
}
// un repo de ejemplo que ya no usa ninguna sala (se ha retirado o vinculado a otra carpeta): su copia, a la papelera
// (se recupera desde el Finder). Las carpetas tuyas nunca se tocan
async function throwCloneOfExample(ruta?: string) {
  if (!ruta || !isCloneOfExample(ruta) || !existsSync(ruta) || almacen.estado.salas.some(s => s.ruta === ruta)) return;
  try { const { aLaTrash } = await import('./archivos.ts'); await aLaTrash(path.dirname(ruta), [path.basename(ruta)]); }
  catch (err) { console.error('No pude tirar a la papelera el repo de ejemplo:', (err as Error).message); }
}
// una carpeta pasa a ser sala (desde la Puerta o al tomar la raíz de repos), con su recluta: el que viene de la puerta o
// uno nuevo. Devuelve su id ('' si ya tenía sala)
async function addRoom(ruta: string, habitante?: any): Promise<string> {
  const tipo = projectType(ruta);
  const info = await infoRepo(ruta);
  const isWing = !info.isGit && (info.subrepos?.length ?? 0) > 1;
  // id y hueco se deciden dentro del mismo cambio (dos reclutamientos a la vez no comparten hueco ni nombre)
  let id = '';
  almacen.cambiar(x => {
    if (x.salas.some(s => s.ruta === ruta) || x.ocultas?.some(o => o.sala.ruta === ruta)) return;
    const base = path.basename(ruta).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '-') || 'sala';
    id = x.salas.some(s => s.id === base) ? base + '-' + Date.now().toString(36) : base;
    // entra en la planta de repos por orden alfabético (las demás se corren lo que haga falta)
    x.salas = distribute([...x.salas, { id, tipo: isWing ? 'coordinacion' : 'repo', nombre: isWing ? wingName(x.salas, ruta) : path.basename(ruta), ruta, planta: 0, lado: 'izq', orden: 0, variant: STYLE_PALETTE[estiloSala(ruta, tipo)], estilo: estiloSala(ruta, tipo), area: areaByType(tipo) }]);
    // el recluta: el que viene de la puerta, o uno nuevo con el aspecto menos visto del refugio
    const ficha = habitante && typeof habitante === 'object' && habitante.nombre ? habitante : generateRecruit(Date.now() % 1e9, x.habitantes.map(h => h.nombre.toLowerCase()), false, x.habitantes.map(h => h.tipo));
    const h = cleanDweller({ ...ficha, salaId: id });
    if (h) { if (x.habitantes.some(o => o.id === h.id)) h.id += '-' + Date.now().toString(36); x.habitantes.push(h); }
    x.habitantes = tonesForRepeated(x.habitantes);   // si repite modelo, otro tono desde ya (no al siguiente arranque)
  });
  if (id) repos[id] = info;
  return id;
}
// retira una sala de repo (ya comprobado que nadie trabaja en ella): cierra sus conversaciones y sus terminales
function removeRoom(sr: { id: string; ruta?: string }) {
  closeRoom(sr);
  almacen.cambiar(x => { x.salas = distribute(x.salas.filter(s => s.id !== sr.id)); x.habitantes = x.habitantes.filter(h => h.salaId !== sr.id); });
  delete repos[sr.id];
}
// cierra las conversaciones, las terminales y el Remote Control de una sala que sale del juego (retirada u oculta)
function closeRoom(sr: { id: string; ruta?: string }) {
  for (const ses of sesiones.lista()) if (ses.salaId === sr.id) sesiones.cerrar(ses.id);
  // las terminales abiertas dentro de su carpeta se cierran con ella (no quedan shells invisibles)
  if (sr.ruta) for (const t of terminales.abiertas()) if (t.cwd === sr.ruta || t.cwd.startsWith(sr.ruta + path.sep)) terminales.cerrar(t.id);
  controlRemoto.apagar(sr.id);
}
// La raíz de repos recién elegida (bienvenida o cámara acorazada): entra cada repo de git de primer nivel (y las alas,
// carpetas con varios repos dentro) y se retiran las salas de repo de fuera de ella, salvo con alguien trabajando.
// Con la raíz en el hogar o en / no se toca nada (son demasiado amplias: ahí, la Puerta sugiere)
// las carpetas que ya tienen sala, a la vista u oculta (ni la raíz ni la Puerta las vuelven a proponer)
const takenFolders = (e: typeof almacen.estado) => [...e.salas.map(s => s.ruta), ...(e.ocultas ?? []).map(o => o.sala.ruta)].filter(Boolean) as string[];
async function takeRoot() {
  const e = almacen.estado, raiz = reposRoot(e);
  if (raiz === os.homedir() || raiz === path.parse(raiz).root || !existsSync(raiz)) return;
  const busy = (id: string) => sesiones.lista().some(s => s.salaId === id && ['arrancando', 'trabajando', 'esperando'].includes(s.estado));
  const fuera = e.salas.filter(s => (s.tipo === 'repo' || s.tipo === 'coordinacion') && s.id !== PLANNING_ROOM && s.ruta && !s.ruta.startsWith(raiz + path.sep) && !busy(s.id));
  for (const sr of fuera) { removeRoom(sr); await throwCloneOfExample(sr.ruta); }
  // las ocultas de fuera de la nueva raíz se olvidan (como las retiradas); las de dentro siguen sin volver
  if (e.ocultas?.some(o => !o.sala.ruta?.startsWith(raiz + path.sep))) almacen.cambiar(x => { x.ocultas = x.ocultas?.filter(o => o.sala.ruta?.startsWith(raiz + path.sep)); });
  for (const c of sugerencias(e.raizRepos, takenFolders(e))) {
    if (!c.isGit && ((await infoRepo(c.ruta)).subrepos?.length ?? 0) < 2) continue;
    try { await addRoom(c.ruta); } catch (err) { console.error(`No pude meter ${c.ruta} en el refugio:`, (err as Error).message); }
  }
  broadcast({ t: 'estado', estado: almacen.estado as any }); broadcast({ t: 'repos', repos });
}
async function refreshRepos() {
  const salas = almacen.estado.salas.filter(s => s.ruta);
  await Promise.all(salas.map(async s => { repos[s.id] = await infoRepo(s.ruta!); }));
  // quién trabaja dentro de cada worktree (no se puede desechar con alguien dentro) y quién lo creó
  const authors = authorsWorktree();
  const viejos = Object.keys(authors).filter(k => !existsSync(k) || !almacen.estado.habitantes.some(h => h.id === authors[k]));
  if (viejos.length) { for (const k of viejos) delete authors[k]; almacen.guardar(); }
  for (const info of Object.values(repos)) for (const w of info.worktrees) {
    const s = sesiones.lista().find(x => x.estado !== 'cerrada' && (x.cwd === w.ruta || x.cwd.startsWith(w.ruta + path.sep)));
    w.ocupado = s ? almacen.estado.habitantes.find(h => h.id === s.dwellerId)?.nombre ?? 'alguien' : undefined;
    if (!w.principal) w.autor = authors[w.ruta] ?? s?.dwellerId;
  }
  broadcast({ t: 'repos', repos });
}
// `wts`: las rutas de los worktrees de cada sala, si se acaban de leer (si no, las del último repaso de los repos)
function visitantes(wts?: Map<string, string[]>): Visitante[] {
  // las del propio refugio no son visitantes, tampoco las de antes de reiniciar el servidor (última de cada habitante)
  const propias = new Set([...sesiones.lista().map(s => s.claudeId), ...almacen.estado.habitantes.map(h => h.lastSession), ...ownIds].filter(Boolean));
  const out: Visitante[] = [];
  // en la carpeta de la sala y en cada uno de sus worktrees (cada uno es otro proyecto para Claude Code)
  const vistos = new Set<string>();
  const vivas = liveSessions();
  const enJuego = new Set(sesiones.lista().filter(s => s.estado !== 'cerrada').map(s => s.claudeId).filter(Boolean));
  for (const s of almacen.estado.salas) {
    if (!s.ruta || s.tipo === 'puente') continue;
    const dirs = [s.ruta, ...(wts?.get(s.id) ?? (repos[s.id]?.worktrees ?? []).filter(w => !w.principal).map(w => w.ruta))];
    // las abiertas ahora (aunque estén quietas) y las que han escrito hace poco (Claude Code sin ficha de sesión)
    for (const dir of dirs) for (const tr of [...vivas.filter(v => v.cwd === dir), ...recentTranscripts(dir)]) {
      // una abierta fuera ahora mismo es visitante aunque el refugio la llevara antes (salió a la superficie, se retomó
      // en la app de Claude): solo no lo es la que el refugio tiene abierta ahora
      const fuera = 'cwd' in tr;
      if ((fuera ? enJuego : propias).has(tr.id) || vistos.has(tr.id)) continue;
      vistos.add(tr.id);
      out.push({ claudeId: tr.id, salaId: s.id, cwd: dir, titulo: 'Sesión en una terminal', modified: tr.modified, ...(dir !== s.ruta ? { worktree: dir } : {}) });
    }
  }
  return out;
}
setInterval(() => { refreshRepos().catch(() => {}); }, 20_000).unref();
// limpieza de adjuntos de más de una semana
adjuntos.clean();
// y de las comparaciones de más de dos semanas (comparar.ts)
cleanCompares().catch(() => {});
setInterval(() => broadcast({ t: 'visitantes', visitantes: visitantes() }), 15_000).unref();
// las sesiones terminadas, leídas y quietas media hora se cierran solas (la conversación queda para retomarla)
// y nunca hay más de 12 procesos de Claude Code vivos: se cierran las terminadas más antiguas (aunque no se hayan leído).
// Nunca las que el Supervisor tiene a la vista o con algo escrito en su intercomunicador (enUso): se le cerraban
// mientras escribía una respuesta larga
const enUso = new Map<WebSocket, Set<string>>();
setInterval(() => {
  const used = new Set([...enUso.values()].flatMap(x => [...x]));
  for (const s of sesiones.lista()) if ((s.estado === 'terminada' || s.estado === 'ociosa') && !s.sinLeer && !used.has(s.id) && Date.now() - s.actualizada > 30 * 60_000) sesiones.cerrar(s.id);
  const still = sesiones.lista().filter(s => (s.estado === 'terminada' || s.estado === 'ociosa' || s.estado === 'error') && !used.has(s.id)).sort((a, b) => a.actualizada - b.actualizada);
  const vivas = sesiones.lista().filter(s => s.estado !== 'cerrada').length;
  for (const s of still.slice(0, Math.max(0, vivas - 12))) sesiones.cerrar(s.id);
}, 60_000).unref();

// avisos que preguntan sí o no al Supervisor (protocolo: NoticeQuestion): se quedan a la vista hasta contestarlos y la
// respuesta llega con la acción aviso.responder. Si el servidor se reinicia antes, la pregunta se pierde (no se hace nada)
const preguntas = new Map<string, (si: boolean) => Promise<void>>();
function ask(texto: string, botones: { si: string; no: string }, respuesta: (si: boolean) => Promise<void>) {
  const id = randomUUID();
  preguntas.set(id, respuesta);
  broadcast({ t: 'aviso', nivel: 'aviso', texto, pregunta: { id, ...botones } });
}

// un mensaje a la conversación de una sala en una carpeta (su copia principal o un worktree): la abierta ahí; si no, se
// retoma la última de ahí (si no sigue abierta fuera) o se empieza una
async function sendToFolder(salaId: string, cwd: string, texto: string, permisos: 'plan') {
  const h = almacen.estado.habitantes.find(x => x.salaId === salaId); if (!h) return false;
  const dir = path.resolve(cwd);
  const abierta = sesiones.lista().find(x => x.estado !== 'cerrada' && x.salaId === salaId && path.resolve(x.worktree ?? x.cwd) === dir);
  if (abierta) return ctxPlan.avisar(abierta.id, texto);
  const fuera = outsideOpen();
  const previa = (await sesiones.historial(dir).catch(() => [])).filter(x => (!x.cwd || path.resolve(x.cwd) === dir) && !fuera.has(x.claudeId.toLowerCase())).sort((a, b) => b.modified - a.modified)[0];
  await startWork(undefined, { t: 'empezar', dwellerId: h.id, salaId, prompt: texto, opciones: { cwd: dir, permisos, reanudar: previa?.claudeId } });
  return true;
}

// las revisiones de tus PR (revisionesPR.ts), cada minuto con GitHub conectado: a la conversación de la rama del PR
const remote = new Map<string, string | undefined>();
const roomRepo = (ruta: string) => remote.has(ruta) ? Promise.resolve(remote.get(ruta))
  : new Promise<string | undefined>(ok => execFile('git', ['-C', ruta, 'remote', 'get-url', 'origin'], { timeout: 6000, env: entornoGit() }, (err, out) => { const r = err ? undefined : remoteRepo(String(out)); if (!err) remote.set(ruta, r); ok(r); }));
// las salas de repo git, con sus worktrees y su repo de GitHub (owner/nombre)
const repoRooms = () => Promise.all(almacen.estado.salas.filter(s => s.tipo === 'repo' && s.ruta && repos[s.id]?.isGit).map(async s => ({
  id: s.id, nombre: s.nombre, ruta: s.ruta!, rama: repos[s.id]?.rama, worktrees: repos[s.id]?.worktrees ?? [], repo: await roomRepo(s.ruta!),
})));
const revisionesPR = new ReviewsPR(DATOS, {
  connection: connectionGitHub,
  consultar: async token => JSON.parse(await (await import('./git.ts')).gh(['api', 'graphql', '-f', 'query=' + REVIEWS_QUERY], token)),
  salas: repoRooms,
  sesiones: () => sesiones.lista(),
  avisar: ctxPlan.avisar,
  // sin conversación abierta en el worktree de la tarea: se retoma la última de ahí o se empieza, en modo plan
  abrir: (salaId, cwd, texto) => sendToFolder(salaId, cwd, texto, 'plan'),
  delivered: (salaId, worktree, pr, eventos) => {
    broadcast({ t: 'mensajero', desde: 'git', a: [salaId], motivo: 'revision', worktree });
    // que se vea: si no estás mirando esa conversación, la entrega pasaba desapercibida
    const sala = almacen.estado.salas.find(s => s.id === salaId)?.nombre ?? salaId, authors = [...new Set(eventos.map(e => e.autor))].join(', ');
    broadcast({ t: 'aviso', nivel: 'info', texto: t('server.newReviewDelivered', { authors, numero: pr.numero, repo: pr.repo, sala, rama: pr.rama }) });
  },
  withoutConversation: texto => broadcast({ t: 'aviso', nivel: 'info', texto }),
});
setInterval(() => { revisionesPR.sondear().catch(err => console.error('Revisiones de PR:', String((err as Error).message).split('\n')[0])); }, 60_000).unref();

// las tareas con todos sus PR fusionados o cerrados (limpiezaTareas.ts), cada cinco minutos con GitHub conectado: el juego
// quita solo sus worktrees si no queda otro trabajo en ellos (si queda, avisa de qué)
const limpiezaTareas = new TasksCleanup(DATOS, {
  connection: connectionGitHub,
  prs: async c => {
    const G = await import('./git.ts');
    const [recientes, abiertos] = await Promise.all([G.prsTablero(c), G.prsOpen(c)]);
    if (recientes.error) throw new Error(recientes.error);
    // los abiertos de hace más de dos semanas no salen en el tablero: sin ellos, una tarea parecería terminada
    const porUrl = new Map([...recientes.prs, ...abiertos.prs].map(p => [p.url, p]));
    return [...porUrl.values()];
  },
  salas: repoRooms,
  sesiones: () => sesiones.lista(),
  git: (cwd, args) => new Promise((ok, mal) => execFile('git', ['-C', cwd, ...args], { timeout: 60_000, env: entornoGit() }, (err, o, e) => err ? mal(new Error(String(e || err.message).trim())) : ok(String(o)))),
  papelera: async rutas => (await import('./archivos.ts')).toTrash(rutas),
  quitado: (salaId, tarea, w, sueltos) => {
    const sala = almacen.estado.salas.find(s => s.id === salaId)?.nombre ?? salaId;
    const texto = t('server.cleanupRemoved', { tarea: tarea.tarea, sala, nombre: path.basename(w.ruta), rama: w.rama || '—' });
    broadcast({ t: 'aviso', nivel: 'info', texto: sueltos ? `${texto} ${t('server.cleanupTrashed', { n: sueltos })}` : texto });
  },
  preguntar: (salaId, tarea, w, que, quitar) => {
    const sala = almacen.estado.salas.find(s => s.id === salaId)?.nombre ?? salaId;
    const texto = que.map(x => x.tipo === 'conversacion' ? t('server.cleanupLeftOpen') : t(x.tipo === 'cambios' ? 'server.cleanupLeftChanges' : x.tipo === 'stash' ? 'server.cleanupLeftStash' : 'server.cleanupLeftCommits', { n: x.n })).join(', ');
    ask(t('server.cleanupLeft', { tarea: tarea.tarea, sala, ruta: w.ruta, que: texto }), { si: t('server.cleanupRemoveAnyway'), no: t('server.cleanupKeep') }, async si => {
      if (!si) return;
      const r = await quitar().catch(e => { broadcast({ t: 'aviso', nivel: 'error', texto: t('server.cleanupCouldNot', { ruta: w.ruta, error: String((e as Error).message).split('\n')[0].slice(0, 160) }) }); return undefined; });
      if (r === 'esperando') broadcast({ t: 'aviso', nivel: 'info', texto: t('server.cleanupWhenClosed', { ruta: w.ruta }) });
    });
  },
  cambiado: () => { refreshRepos().catch(() => {}); },
});
setInterval(() => { limpiezaTareas.sondear().catch(err => console.error('Limpieza de tareas:', String((err as Error).message).split('\n')[0])); }, 5 * 60_000).unref();

// organizar las salas por tareas (organizar.ts): el plan de cada sala de repo y, confirmado, hacerlo
async function organizeRooms(salaId: string | undefined, aplicar: boolean) {
  const G = await import('./git.ts');
  const { prs, demo } = await G.prsOpen(await connectionGitHub());
  if (aplicar && demo) throw new Error(t('server.withoutGithubConnectedDemoThere'));
  const salas = almacen.estado.salas.filter(s => s.tipo === 'repo' && s.ruta && repos[s.id]?.isGit && (!salaId || s.id === salaId));
  const out: { salaId: string; sala: string; repo?: string; pasos: { tarea: string; prs: string[]; donde: string; crear: boolean; principal: boolean; conversation: boolean }[]; hecho?: string[] }[] = [];
  for (const s of salas) {
    const repo = await roomRepo(s.ruta!);
    // en DEMO los repos inventados (refugio/express) caen en la sala de su nombre
    const suyos = prs.filter(p => repo && (p.repo.toLowerCase() === repo || (demo && p.repo.split('/').pop()!.toLowerCase() === repo.split('/').pop())));
    const grupos = agruparPorTarea(suyos);
    if (!grupos.length) { out.push({ salaId: s.id, sala: s.nombre, repo, pasos: [] }); continue; }
    const info = repos[s.id]!;
    const pasos = planDeSala({ ruta: s.ruta!, rama: info.rama, worktrees: info.worktrees }, grupos, sesiones.lista());
    const fila = { salaId: s.id, sala: s.nombre, repo, pasos: pasos.map(p => ({ tarea: p.grupo.clave ?? `PR #${p.grupo.prs[0].numero}`, prs: p.grupo.prs.map(x => `#${x.numero} ${x.titulo}`), donde: path.basename(p.ruta), crear: p.crear, principal: p.principal, conversation: !!p.sesion })) } as (typeof out)[number];
    if (aplicar) {
      const h = almacen.estado.habitantes.find(x => x.salaId === s.id);
      const vivas = () => sesiones.lista().filter(x => ['arrancando', 'trabajando', 'esperando'].includes(x.estado)).length;
      fila.hecho = h ? await applyPlan({
        git: (cwd, args) => new Promise((ok, mal) => execFile('git', ['-C', cwd, ...args], { timeout: 60_000, env: entornoGit() }, (err, o, e) => err ? mal(new Error(String(e || err.message).trim())) : ok(String(o)))),
        empezar: (id, cwd, prompt) => startWork(undefined, { t: 'empezar', dwellerId: h.id, salaId: id, prompt, opciones: { cwd, permisos: 'plan' } }),
      }, { id: s.id, ruta: s.ruta! }, pasos, repo ?? s.nombre, () => almacen.estado.limiteSesiones - vivas()) : ['La sala no tiene habitante.'];
    }
    out.push(fila);
  }
  if (aplicar) await refreshRepos().catch(() => {});
  return { demo, salas: out };
}

// ---------------------------------------------------------------- acciones (peticiones con respuesta)
async function accion(nombre: string, d: Record<string, any> = {}): Promise<unknown> {
  const e = almacen.estado;
  switch (nombre) {
    case 'sugerencias': return sugerencias(e.raizRepos, takenFolders(e));
    case 'reclutar': {
      const ruta = path.resolve(expand(String(d.ruta || '')));
      if (ruta === path.parse(ruta).root || ruta === os.homedir()) throw new Error(t('server.thatFolderIsTooBroad'));
      if (!existsSync(ruta)) {
        if (!d.crear) throw new Error(t('server.thatFolderDoesNotExist'));
        const raiz = path.resolve(expand(e.raizRepos));
        if (!ruta.startsWith(raiz + path.sep)) throw new Error('Las carpetas nuevas se crean dentro de la raíz de repos (' + e.raizRepos + ').');
        await createFolder(ruta, !!d.git);
      }
      if (takenFolders(e).includes(ruta)) throw new Error(t('server.thatFolderAlreadyHasA'));
      const id = await addRoom(ruta, d.habitante);
      if (!id) throw new Error(t('server.thatFolderAlreadyHasA'));
      broadcast({ t: 'estado', estado: almacen.estado as any }); broadcast({ t: 'repos', repos });
      return { id };
    }
    case 'retirarSala': {
      const sr = e.salas.find(s => s.id === d.salaId);
      if (!sr) throw new Error(t('server.thatRoomDoesNotExist'));
      if ((sr.tipo !== 'repo' && sr.tipo !== 'coordinacion') || sr.id === PLANNING_ROOM) throw new Error(t('server.theShelterSServiceRooms'));
      // primero se comprueba (nada se corta) y luego se cierran las conversaciones terminadas de la sala
      if (sesiones.lista().some(s => s.salaId === d.salaId && ['arrancando', 'trabajando', 'esperando'].includes(s.estado))) throw new Error(t('server.someoneIsWorkingInThat'));
      removeRoom(sr);
      broadcast({ t: 'estado', estado: almacen.estado as any }); broadcast({ t: 'repos', repos });
      await throwCloneOfExample(sr.ruta);
      return true;
    }
    // ocultar una sala de repo la saca del juego (la planta que se queda vacía desaparece) sin olvidarla: vuelve, con su
    // habitante y su escena, desde la cámara acorazada (Salas del refugio)
    case 'sala.ocultar': {
      const sr = e.salas.find(s => s.id === d.salaId);
      if (!sr) throw new Error(t('server.thatRoomDoesNotExist'));
      if (!isHideable(sr)) throw new Error(t('server.serviceRoomsCannotBeHidden'));
      if (sesiones.lista().some(s => s.salaId === sr.id && ['arrancando', 'trabajando', 'esperando'].includes(s.estado))) throw new Error(t('server.someoneIsWorkingInThatHide'));
      closeRoom(sr);
      almacen.cambiar(x => { hideRoom(x, sr.id); });
      delete repos[sr.id];
      broadcast({ t: 'estado', estado: almacen.estado as any }); broadcast({ t: 'repos', repos });
      return true;
    }
    case 'sala.mostrar': {
      let hecho = false;
      almacen.cambiar(x => { hecho = showRoom(x, String(d.salaId)); });
      if (!hecho) throw new Error(t('server.thatRoomDoesNotExist'));
      const sr = almacen.estado.salas.find(s => s.id === d.salaId);
      if (sr?.ruta) repos[sr.id] = await infoRepo(sr.ruta);
      broadcast({ t: 'repos', repos }); broadcast({ t: 'estado', estado: almacen.estado as any });
      return true;
    }
    // la sala pasa a otra carpeta (un repo tuyo): conserva su sitio, su habitante y su aspecto; la escena vuelve a la
    // plantilla de su nuevo tipo de repo (luego el habitante la puede adaptar)
    case 'vincularSala': {
      const sr = e.salas.find(s => s.id === d.salaId);
      if (!sr || !isRoomOfRepo(sr.tipo)) throw new Error(t('server.onlyRepoRoomsCanBe'));
      if (sr.id === PLANNING_ROOM) throw new Error(t('server.theLogisticsRoomSFolder'));
      const ruta = path.resolve(expand(String(d.ruta || '')));
      if (ruta === path.parse(ruta).root || ruta === os.homedir()) throw new Error(t('server.thatFolderIsTooBroad'));
      if (!existsSync(ruta) || !statSync(ruta).isDirectory()) throw new Error(t('server.thatFolderDoesNotExist'));
      if (ruta === sr.ruta) throw new Error(t('server.thatIsAlreadyThisRoom'));
      if (takenFolders(e).includes(ruta)) throw new Error(t('server.thatFolderAlreadyHasA'));
      if (sesiones.lista().some(s => s.salaId === sr.id && ['arrancando', 'trabajando', 'esperando'].includes(s.estado))) throw new Error(t('server.someoneIsWorkingInThat2'));
      for (const ses of sesiones.lista()) if (ses.salaId === sr.id) sesiones.cerrar(ses.id);
      const anterior = sr.ruta;
      if (anterior) for (const t of terminales.abiertas()) if (t.cwd === anterior || t.cwd.startsWith(anterior + path.sep)) terminales.cerrar(t.id);
      controlRemoto.apagar(sr.id);
      const tipo = projectType(ruta);
      const info = await infoRepo(ruta);
      const isWing = !info.isGit && (info.subrepos?.length ?? 0) > 1;
      almacen.cambiar(x => {
        const s = x.salas.find(y => y.id === sr.id); if (!s) return;
        const estilo = estiloSala(ruta, tipo);
        Object.assign(s, { ruta, nombre: isWing ? wingName(x.salas.filter(y => y !== s), ruta) : path.basename(ruta), tipo: isWing ? 'coordinacion' : 'repo', estilo, variant: STYLE_PALETTE[estilo], area: areaByType(tipo) });
        delete s.decorado;
        // su última conversación era de la otra carpeta: no se retoma aquí
        for (const h of x.habitantes) if (h.salaId === s.id) delete h.lastSession;
        x.salas = distribute(x.salas);
      });
      // primero los repos: la sala se vuelve a montar con la plantilla del tipo nuevo, no con la del anterior
      repos[sr.id] = info; broadcast({ t: 'repos', repos }); broadcast({ t: 'estado', estado: almacen.estado as any });
      await throwCloneOfExample(anterior);
      return { id: sr.id };
    }
    // obras desde el plano: arrastrar una sala a un hueco (o a una planta nueva) o una planta entera a otra altura, o
    // volver a la disposición de serie
    case 'refugio.mover': {
      let hecho = false;
      almacen.cambiar(x => {
        const nuevas = d.salaId
          ? placeRoom(x.salas, String(d.salaId), { planta: Number(d.planta), lado: d.lado === 'der' ? 'der' : 'izq', orden: Number(d.orden) || 0, nueva: d.nueva === true })
          : moveFloor(x.salas, Number(d.de), Number(d.a));
        if (nuevas) { x.salas = nuevas; hecho = true; }
      });
      if (!hecho) throw new Error(t('server.itCannotBeMovedThat'));
      broadcast({ t: 'estado', estado: almacen.estado as any });
      return true;
    }
    case 'refugio.disposicionDeSerie': { almacen.cambiar(x => { x.salas = disposicionDeSerie(x.salas); }); broadcast({ t: 'estado', estado: almacen.estado as any }); return true; }
    // idioma de los textos (shared/idioma.ts): el cliente lo elige en Opciones y el servidor lo usa en sus avisos
    case 'idioma': {
      if (!isLanguage(d.idioma)) throw new Error('Idioma desconocido.');
      setLanguage(d.idioma); almacen.cambiar(x => { x.idioma = d.idioma; });
      return true;
    }
    // el área de un repo (frontend, backend o crítico): su sector y su color
    case 'sala.area': {
      const sr = e.salas.find(s => s.id === d.salaId);
      if (!sr || !isRoomOfRepo(sr.tipo) || sr.id === PLANNING_ROOM) throw new Error(t('server.onlyRepoRoomsHaveAn'));
      if (!isArea(d.area)) throw new Error(t('server.unknownArea'));
      almacen.cambiar(x => { const s = x.salas.find(y => y.id === sr.id); if (s) s.area = d.area; });
      broadcast({ t: 'estado', estado: almacen.estado as any });
      return true;
    }
    case 'sala.promptAdaptar': return promptAdaptar();
    case 'sala.quitarDecorado': { if (!ctxDecor.sala(String(d.salaId))) throw new Error(t('server.thatRoomDoesNotExist')); ctxDecor.guardar(String(d.salaId), null); return true; }
    case 'abrirEn': return abrirEn(String(d.app), String(d.ruta));
    case 'guardar': {
      const antes = { raiz: reposRoot(e), bienvenida: e.doneWelcome };
      almacen.cambiar(x => applySettings(x, d.parche ?? {})); broadcast({ t: 'estado', estado: almacen.estado as any });
      // la raíz elegida (otra, o la de la bienvenida al entrar) trae sus repos
      if (reposRoot(almacen.estado) !== antes.raiz || (!antes.bienvenida && almacen.estado.doneWelcome)) await takeRoot();
      if (typeof d.parche?.raizRepos === 'string') refreshReposPronto();
      return true;
    }   // la sala de planificación cambia de carpeta con la raíz
    case 'aspecto.guardar': {
      // el aspecto que se elige en Chapa y Pintura: del Supervisor o de un habitante (la Octocat no se cambia)
      const a = d.aspecto === null ? null : sanitizeLook(d.aspecto);
      if (d.aspecto !== null && !a) throw new Error(t('server.thatLookIsNotValid'));
      if (d.quien === 'supervisor') almacen.cambiar(x => { if (a) x.supervisor.aspecto = a; else delete x.supervisor.aspecto; });
      else {
        const h = e.habitantes.find(x => x.id === d.quien); if (!h) throw new Error(t('server.thereIsNobodyWithThat'));
        if (h.tipo === 'Octocat') throw new Error(t('server.theOctocatIsWhatIt'));
        almacen.cambiar(() => { if (a) { h.aspecto = a; delete h.tone; } else delete h.aspecto; });
      }
      broadcast({ t: 'estado', estado: almacen.estado as any });
      return true;
    }
    case 'reiniciarRefugio': { sesiones.cerrarTodas(); terminales.cerrarTodas(); almacen.reiniciar(); await refreshRepos(); broadcast({ t: 'estado', estado: almacen.estado as any }); return true; }
    // al abrir la lista de un visitante: al momento (con los worktrees al día), no la del último aviso (cada 15 s).
    // Solo `git worktree list`: el repaso entero de los repos (`git status` en cada uno) tardaba segundos en los grandes
    case 'visitantes': {
      const salas = almacen.estado.salas.filter(s => s.ruta && s.tipo !== 'puente');
      const wts = new Map(await Promise.all(salas.map(async s => [s.id, (await worktreeList(s.ruta!)).filter(w => !w.principal).map(w => w.ruta)] as const)));
      const v = visitantes(wts); broadcast({ t: 'visitantes', visitantes: v }); return v;
    }
    // el buscador (⌘K): las últimas conversaciones de cada sala con habitante, juntas y de la más reciente a la más vieja
    case 'conversaciones.recientes': {
      const fuera = outsideOpen();
      const lists = await Promise.all(e.salas.map(async s => {
        const h = e.habitantes.find(x => x.salaId === s.id);
        if (!h) return [];
        const dir = folderOf(s);
        if (!existsSync(dir)) return [];
        try { return (await sesiones.historial(dir, 6)).map(x => ({ ...x, salaId: s.id, dwellerId: h.id, fuera: fuera.has(x.claudeId.toLowerCase()) && !x.enCurso })); } catch { return []; }
      }));
      return lists.flat().sort((a, b) => b.modified - a.modified).slice(0, Math.min(40, Number(d.limite) || 20));
    }
    case 'aplicarCliente': return aplicarCliente();
    case 'reiniciarJuego': return reiniciarJuego();
    case 'superficie.sacar': return exitASurface(d);
    case 'superficie.appClaude': return aAppClaude(d);
    case 'presencia': lastUse = d.activo ? Date.now() : 0; return true;
    case 'slackRemote.estado': return slackRemote.estado();
    case 'slackRemote.conectar': return slackRemote.conectar(String(d.appToken ?? ''), String(d.botToken ?? ''));
    case 'slackRemote.emparejar': return slackRemote.emparejar();
    case 'slackRemote.aprobar': return slackRemote.ponerAprobar(!!d.si);
    case 'slackRemote.desconectar': return slackRemote.desconectar();
    // Remote Control de la sala (`claude remote-control` en su carpeta): sesiones desde claude.ai/code y el móvil
    case 'sala.controlRemoto': {
      const sr = e.salas.find(s => s.id === d.salaId);
      if (!sr || !isRoomOfRepo(sr.tipo) || !sr.ruta) throw new Error(t('server.remoteControlOnlyWorksIn'));
      if (d.switchOn === undefined) return controlRemoto.estado(sr.id);
      if (!d.switchOn) { controlRemoto.apagar(sr.id); return controlRemoto.estado(sr.id); }
      return controlRemoto.switchOn(sr.id, folderOf(sr), sr.nombre);
    }
    // organizar salas de repo por tareas: un worktree y una conversación por tarea con PR abiertos (organizar.ts).
    // Sin aplicar, solo el plan; con aplicar, lo hace (el Supervisor lo ha confirmado en el panel)
    case 'sala.organizar': return organizeRooms(d.salaId ? String(d.salaId) : undefined, !!d.aplicar);
    case 'tareas.colores': return coloresTareas.colores(d.claves);
    case 'despliegue.bloqueos': return bloqueosPR.todos();
    case 'despliegue.bloquear': return bloqueosPR.marcar(d.de, d.por, !!d.quitar);
    // el orden entre repos de cada tarea repartida (la parte de una sala espera a la de otra: planes.ts), por repo de GitHub
    case 'despliegue.orden': return tasksOrder(planes.todos(), id => { const s = e.salas.find(x => x.id === id); return s?.ruta ? roomRepo(s.ruta) : Promise.resolve(undefined); });
    case 'superficie.forzarCierre': return closeOutside(String(d.claudeId ?? ''));
    case 'repo': { const sala = e.salas.find(s => s.id === d.salaId); if (!sala?.ruta) throw new Error(t('server.roomWithoutAFolder')); return repos[sala.id] = await infoRepo(sala.ruta); }
    // archivo adjuntado en el intercomunicador: se copia a DATOS/uploads (se limpian a la semana) y se devuelve su ruta
    case 'subir': return adjuntos.guardar(String(d.nombre || ''), String(d.datos || ''));
    case 'adjunto.miniatura': return adjuntos.miniatura(String(d.ruta || ''));
    // un adjunto del cuaderno: imágenes y PDF en Vista Previa, texto en el editor de texto, lo demás en el Finder (abrir.ts)
    // un enlace a un archivo del Mac en una respuesta (web/src/ui/markdown.ts): sin ejecutar nada (abrir.ts)
    case 'aviso.responder': { const f = preguntas.get(String(d.id ?? '')); preguntas.delete(String(d.id ?? '')); if (f) await f(!!d.si); return true; }
    case 'paginas.existen': return existingPages(d.rutas, os.homedir());
    case 'paginas.actualizadas': return pagesUpdated(d.rutas, os.homedir());
    case 'enlace.local': return openLink(String(d.ruta ?? ''), os.homedir());
    case 'enlace.revelar': return revealLocal(String(d.ruta ?? ''), os.homedir());
    case 'adjunto.abrir': { const r = String(d.ruta || ''); if (!adjuntos.propio(r)) throw new Error(t('server.thatAttachmentIsGoneThey')); await openAttachment(adjuntos.dir, path.resolve(r)); return true; }
    default:
      if (nombre.startsWith('integracion.')) {
        const r: any = await integraciones.accion(nombre.slice(12), d);
        // Logística reparte los colores de las tareas: al leer el tablero de Jira, cada tarea recibe el suyo (o conserva
        // el que tenía) y viaja con ella; los demás tableros, las pantallas y los hologramas usan ese mismo
        if (nombre === 'integracion.panel' && d.fuente === 'jira' && Array.isArray(r?.tareas)) {
          const colores = coloresTareas.colores(r.tareas.map((t: any) => t.clave));
          return { ...r, tareas: r.tareas.map((t: any) => ({ ...t, color: colores[String(t.clave).toUpperCase()] })) };
        }
        return r;
      }
      if (nombre.startsWith('juego.')) { const r = gameAction(nombre.slice(6), d, almacen); broadcast({ t: 'estado', estado: almacen.estado as any }); return r; }
      if (nombre.startsWith('worktree.')) {
        const r = await (await import('./worktrees.ts')).actionWorktree(nombre.slice(9), d, { sesiones, repos, pathRoom, almacen, terminales });
        if (nombre === 'worktree.desechar') await refreshRepos().catch(() => {});   // todas las ventanas apagan el holograma ya
        return r;
      }
      if (nombre.startsWith('git.')) return (await import('./git.ts')).actionGit(nombre.slice(4), d, { allowedPath: gitPath, pathsRepos: gitPaths, alCambiar: () => refreshReposPronto(), github: connectionGitHub });
      if (nombre.startsWith('archivos.')) return (await import('./archivos.ts')).filesAction(nombre.slice(9), d, { allowedRoots: filesRoots, alCambiar: () => refreshReposPronto() });
      throw new Error('Acción desconocida: ' + nombre);
  }
}

// Repos que maneja el cliente de git de Control de Versiones: los de las salas (y el del propio juego), sus worktrees
// y los repos de las alas de coordinación
function gitPaths() {
  const out = new Set<string>();
  for (const s of almacen.estado.salas) {
    if (!s.ruta) continue;
    const info = repos[s.id];
    if (info?.isGit) { out.add(info.ruta); for (const w of info.worktrees) out.add(w.ruta); }
    for (const r of info?.subrepos ?? []) out.add(r);
  }
  return [...out];
}
const gitPath = (r: string) => gitPaths().includes(r);
// Carpetas que se pueden explorar y editar en la ventana de Archivos: las de las salas de repo y de las alas, y los
// worktrees de sus repos
function filesRoots() {
  const out = new Set<string>();
  for (const s of almacen.estado.salas) {
    if (!s.ruta) continue;
    out.add(path.resolve(s.ruta));
    for (const w of repos[s.id]?.worktrees ?? []) out.add(path.resolve(w.ruta));
  }
  return [...out];
}

// Ajustes que el jugador puede cambiar desde la cámara acorazada y la bienvenida (lista blanca, con tipos)
const CHARACTERS = ['Protagonist_A', 'Protagonist_B', 'Engineer', 'Survivalist', 'Hiker', 'Hoarder', 'Driver', 'SpaceRanger'];
function applySettings(x: typeof almacen.estado, p: Record<string, any>) {
  if (typeof p.nombre === 'string') x.nombre = p.nombre.trim().slice(0, 32) || GAME_NAME;
  if (typeof p.raizRepos === 'string' && p.raizRepos.trim()) x.raizRepos = p.raizRepos.trim().slice(0, 300);
  if (Number.isFinite(p.limiteSesiones)) x.limiteSesiones = Math.max(1, Math.min(20, Math.round(p.limiteSesiones)));
  if (typeof p.doneWelcome === 'boolean') x.doneWelcome = p.doneWelcome;
  if (p.supervisor && typeof p.supervisor === 'object') {
    if (CHARACTERS.includes(p.supervisor.personaje)) x.supervisor.personaje = p.supervisor.personaje;
    // el aspecto por piezas (del probador); null lo quita y vuelve el del personaje de serie
    if (p.supervisor.aspecto === null) delete x.supervisor.aspecto;
    else if (p.supervisor.aspecto !== undefined) { const a = sanitizeLook(p.supervisor.aspecto); if (a) x.supervisor.aspecto = a; }
    if (Array.isArray(p.supervisor.accesorios)) x.supervisor.accesorios = p.supervisor.accesorios.filter((a: unknown) => typeof a === 'string' && x.jugador.tienda.includes(a)).slice(0, 4);
  }
}
function cleanDweller(h: any) {
  if (!h || typeof h !== 'object' || typeof h.salaId !== 'string') return null;
  const txt = (v: unknown, n: number, def = '') => (typeof v === 'string' ? v.slice(0, n) : def);
  const tipos = [...new Set([...CHARACTERS, ...TYPES_STOCK])];
  const aspecto = sanitizeLook(h.aspecto);
  return { id: txt(h.id, 60, 'h-' + Date.now().toString(36)).replace(/[^\w-]/g, '-'), nombre: txt(h.nombre, 30, 'Recluta'), mote: txt(h.mote, 40), tipo: tipos.includes(h.tipo) && h.tipo !== 'Protagonist_B' ? h.tipo : 'Hiker', bio: txt(h.bio, 300), salaId: h.salaId, voz: Number.isFinite(h.voz) ? Math.max(60, Math.min(260, h.voz)) : 120, ...(Number.isFinite(h.tone) && h.tone > 0 ? { tone: Math.min(359, Math.max(1, Math.round(h.tone) % 360 || 1)) } : {}), ...(aspecto ? { aspecto } : {}) };
}

// Puente de Mando: el habitante cambia el propio juego; el cliente se recompila y se recarga en caliente.
// Las sesiones viven en el servidor y la recarga cae dentro del margen de reconexión: nadie pierde su trabajo.
let compiling: Promise<unknown> | null = null;
function compileClient() {
  if (compiling) return Promise.reject(new Error(t('server.iAmAlreadyRebuildingThe')));
  return compiling = new Promise((ok, ko) => execFile(process.execPath, [path.join(RAIZ, 'scripts', 'huellas.cjs'), 'compilar'], { cwd: RAIZ, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, errOut) => {
    compiling = null;
    if (err) { broadcast({ t: 'aviso', nivel: 'error', texto: 'La compilación ha fallado: ' + String(errOut || err.message).split('\n').filter(Boolean).slice(-3).join(' · ') }); ko(err); return; }
    ok(true);
  }));
}
function aplicarCliente() {
  if (compiling) throw new Error(t('server.iAmAlreadyRebuildingThe'));
  broadcast({ t: 'aviso', nivel: 'info', texto: t('server.maintenanceRebuildingTheShelterClient') });
  compileClient().then(() => {
    broadcast({ t: 'aviso', nivel: 'info', texto: t('server.newClientReadyReloadingWithout') });
    setTimeout(() => broadcast({ t: 'recargar' }), 900);
  }, () => {});
  return { enCurso: true };
}

// Reinicio desde la regleta: recompila el cliente si su código ha cambiado, comprueba que el servidor nuevo
// carga y sale con el código 75 para que el supervisor (./shelter o npm run dev) lo vuelva a lanzar con el mismo
// secreto. Las terminales siguen vivas en su anfitrión; las conversaciones de los habitantes se cortan y quedan
// guardadas para retomarlas. Si algo falla, no se apaga nada y el juego sigue como estaba.
// Abierto como app, si han cambiado archivos que solo se leen al abrirla (Electron, el supervisor, ./shelter; la app
// pasa su huella en SHELTER_HUELLA_APP), sale con el 76: el supervisor y ./shelter salen con él y la app se vuelve a
// abrir sola, con las terminales igual de vivas.
const RESTART_CODE = 75, RELAY_CODE = 76;
let reiniciando = false;
async function reiniciarJuego() {
  if (!process.env.SHELTER_SUPERVISADO) throw new Error(t('server.thisServerWasNotStarted'));
  if (reiniciando) throw new Error(t('server.iAmAlreadyRestarting'));
  reiniciando = true;
  try {
    if (!DEVELOPMENT && !huellas.clienteAlDia()) { broadcast({ t: 'aviso', nivel: 'info', texto: t('server.restartRebuildingTheClient') }); await compileClient(); }
    await checkServer();
  } catch (e) { reiniciando = false; throw e; }
  const relevo = !!process.env.SHELTER_HUELLA_APP && process.env.SHELTER_HUELLA_APP !== huellas.huella('app');
  console.log(relevo ? '\nReiniciando la app entera a petición del Supervisor…' : '\nReiniciando el servidor a petición del Supervisor…');
  broadcast({ t: 'reiniciando' });
  dropAll();
  setTimeout(() => process.exit(relevo ? RELAY_CODE : RESTART_CODE), 400);
  return true;
}
// lo que se deja al reiniciar: las conversaciones se cortan (quedan guardadas) y las terminales siguen en su anfitrión
function dropAll() {
  for (const paso of [() => sesiones.cerrarTodas(), () => dictations.stopAll(), () => terminales.dropHost(), () => integraciones.parar(), () => slackRemote.parar(), () => almacen.saveAlready()])
    try { paso(); } catch (e) { console.error('Al reiniciar:', (e as Error).message); }
}
// ./shelter abre la app y se encuentra en marcha un servidor de antes de los últimos cambios (scripts/huellas.cjs,
// ponerAlDia): con ventanas conectadas se reinicia como con el botón; sin ninguna (la app de antes ya se cerró) se
// aparta, sin cerrar las terminales, para que la app nueva lance el suyo y sea suyo.
function setOnDay(): 'reinicio' | 'relevo' {
  if (clients.size) { reiniciarJuego().catch(e => console.error('Al poner al día:', (e as Error).message)); return 'reinicio'; }
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  console.log('\nSe abre una app con el código nuevo: le dejo el sitio.');
  dropAll();
  setTimeout(() => process.exit(0), 400);
  return 'relevo';
}
function checkServer() {
  return new Promise<void>((ok, ko) => execFile(process.execPath, [...process.execArgv.filter(a => !a.startsWith('--inspect')), path.join(RAIZ, 'server', 'main.ts')], { cwd: RAIZ, timeout: 60_000, env: { ...process.env, SHELTER_COMPROBAR: '1' } }, (err, _out, errOut) => {
    if (!err) { ok(); return; }
    const detalle = String(errOut || err.message).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('at ')).slice(-4).join(' · ');
    ko(new Error('No reinicio: el servidor nuevo no arranca. ' + detalle));
  }));
}

function createFolder(ruta: string, withGit: boolean) {
  return new Promise<void>((res, rej) => execFile('/bin/mkdir', ['-p', ruta], err => err ? rej(err) : withGit ? execFile('git', ['init', ruta], e2 => e2 ? rej(e2) : res()) : res()));
}

function abrirEn(app: string, ruta: string) {
  const r = path.resolve(ruta);
  if (!pathRoom(r)) throw new Error(t('server.thatFolderDoesNotBelong2'));
  if (!['finder', 'terminal', 'editor'].includes(app) || !existsSync(r) || !statSync(r).isDirectory()) throw new Error(t('server.onlyRoomFoldersOpenIn'));
  const args = app === 'finder' ? (isPackage(r) ? ['-R', r] : [r]) : app === 'terminal' ? ['-a', 'Terminal', r] : (existsSync('/Applications/Cursor.app') ? ['-a', 'Cursor', r] : existsSync('/Applications/Visual Studio Code.app') ? ['-a', 'Visual Studio Code', r] : ['-a', 'TextEdit', r]);
  spawn('open', args, { detached: true, stdio: 'ignore' }).unref();
  return true;
}

// Un habitante puede llevar varios trabajos a la vez (una pestaña del intercomunicador por conversación). Solo
// limita el máximo de sesiones vivas del refugio.
// una carpeta con varios repos es una sala de logística (planifica y reparte tareas entre sus repos); si ya hay una,
// la nueva lleva también el nombre de su carpeta
const wingName = (salas: { tipo: string; nombre: string }[], ruta: string) => salas.some(s => s.tipo === 'coordinacion' && s.nombre.startsWith('Logística')) ? `Logística ${path.basename(ruta)}` : 'Logística';
const pathsList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);
// ws: quien lo pide (sin él, lo lanza el propio refugio: el reparto desde una sala de coordinación)
async function startWork(ws: WebSocket | undefined, m: Extract<ClientMessage, { t: 'empezar' }>): Promise<string> {
  const e = almacen.estado;
  if (typeof m.salaId !== 'string' || typeof m.dwellerId !== 'string' || typeof m.prompt !== 'string') throw new Error('Mensaje mal formado.');
  m.opciones = m.opciones && typeof m.opciones === 'object' ? m.opciones : {};
  const sala = e.salas.find(s => s.id === m.salaId);
  if (!sala) throw new Error(t('server.thatRoomDoesNotExist'));
  // solo en la carpeta de trabajo de la sala o en uno de sus worktrees (las especiales tienen una propia)
  const carpeta = folderOf(sala);
  if (!sala.ruta) mkdirSync(carpeta, { recursive: true });
  const cwd = m.opciones.cwd ? path.resolve(m.opciones.cwd) : carpeta;
  if (cwd !== carpeta && pathRoom(cwd) !== sala.id) throw new Error(t('server.thatFolderDoesNotBelong3'));
  if (!e.habitantes.some(h => h.id === m.dwellerId && h.salaId === sala.id)) throw new Error(t('server.thatDwellerDoesNotLive'));
  // retomar una conversación que ya está abierta no la duplica: se vuelve a ella
  const abierta = m.opciones.reanudar ? sesiones.lista().find(p => p.claudeId === m.opciones.reanudar && p.estado !== 'cerrada') : undefined;
  if (abierta) return abierta.id;
  if (m.opciones.reanudar && outsideOpen().has(m.opciones.reanudar.toLowerCase())) throw new Error(t('server.thatConversationIsStillOpen'));
  // el límite cuenta las que trabajan o esperan; las terminadas ociosas no bloquean (y se cierran solas a los 30 min)
  const vivas = sesiones.lista().filter(x => ['arrancando', 'trabajando', 'esperando'].includes(x.estado)).length;
  if (vivas >= e.limiteSesiones) throw new Error(t('server.thereAreAlreadyLiveSessions', { vivas, limiteSesiones: e.limiteSesiones }));
  // los worktrees son solo de las salas de proyecto: el Puente de Mando y las especiales trabajan en su carpeta
  if (sala.tipo !== 'repo') m.opciones.worktree = false;
  // un nombre de worktree (mensajes entre salas): solo letras, números, guiones y puntos; si no, uno con el título
  if (typeof m.opciones.worktree === 'string' && !/^[\w.-]{1,80}$/.test(m.opciones.worktree)) m.opciones.worktree = true;
  // en un ala (carpeta con varios repos) no hay un único repo donde crear el worktree: se trabaja en la carpeta
  if (m.opciones.worktree && !existsSync(path.join(cwd, '.git'))) { m.opciones.worktree = false; const aviso: ServerMessage = { t: 'aviso', nivel: 'aviso', texto: t('server.isNotAGitRepo', { nombre: sala.nombre }) }; if (ws) enviar(ws, aviso); else broadcast(aviso); }
  const r = await sesiones.empezar(m.dwellerId, m.salaId, cwd, m.prompt, m.opciones, adjuntos.describir(pathsList(m.adjuntos)));
  if (m.opciones.reanudar && ws) enviar(ws, { t: 'entradas', sesionId: r.id, entradas: sesiones.cuaderno(r.id) });
  return r.id;
}

// ---------------------------------------------------------------- mensajes de un cliente
async function manejar(ws: WebSocket, m: ClientMessage) {
  const e = almacen.estado;
  switch (m.t) {
    case 'hola':
      enviar(ws, { t: 'bienvenida', versionClaude: sesiones.version, claudeOk: !!sesiones.claude, estado: e as any, sesiones: sesiones.lista(), repos, demo: Object.values(e.integraciones).length > 0 && Object.values(e.integraciones).every(i => i.modo === 'demo') });
      enviar(ws, { t: 'visitantes', visitantes: visitantes() });
      integraciones.greet(ws, enviar);
      for (const t of terminales.abiertas()) terminales.abrir(t.id, t.cwd, 80, 24, outputOf(ws));
      break;
    case 'empezar': {
      // con `peticion`, se contesta con el id de la sesión (la pestaña del intercomunicador la sigue) o con el error
      try { const id = await startWork(ws, m); if (m.peticion) enviar(ws, { t: 'respuesta', peticion: m.peticion, datos: id }); }
      catch (err) { if (m.peticion) enviar(ws, { t: 'respuesta', peticion: m.peticion, error: (err as Error).message }); else throw err; }
      break;
    }
    case 'enviar': sesiones.enviar(m.sesionId, String(m.texto ?? ''), adjuntos.describir(pathsList(m.adjuntos))); break;
    case 'vozEmpezar': dictations.empezar(String(m.id), String(m.idioma || 'es-ES'), ws, ev => enviar(ws, { t: 'voz', id: m.id, ...ev })); break;
    case 'vozAudio': dictations.audio(String(m.id), String(m.datos || '')); break;
    case 'vozFin': dictations.terminar(String(m.id)); break;
    case 'vozCancelar': dictations.cancelar(String(m.id)); break;
    case 'responder': sesiones.responder(m.sesionId, m.peticionId, m.decision, m.mensaje, m.responses); break;
    case 'interrumpir': await sesiones.interrumpir(m.sesionId); break;
    case 'cerrarSesion': sesiones.cerrar(m.sesionId); break;
    case 'leida': sesiones.leida(m.sesionId); break;
    case 'enUso': enUso.set(ws, new Set(Array.isArray(m.sesiones) ? m.sesiones.map(String) : [])); break;
    case 'lateral': await sesiones.lateral(m.sesionId, m.pregunta); break;
    case 'modoPermisos': await sesiones.modo(m.sesionId, m.modo); break;
    case 'historial': {
      const sala = e.salas.find(s => s.id === m.salaId);
      // el de una copia holográfica, el de su worktree (si es de esa sala)
      const ofCopy = !!(sala && m.cwd && pathRoom(path.resolve(m.cwd)) === sala.id);
      const dir = ofCopy ? path.resolve(String(m.cwd)) : sala && folderOf(sala);
      const fuera = outsideOpen();
      // Claude Code junta en un proyecto las conversaciones de todos los worktrees del repo: la copia solo ve las de
      // dentro del suyo (las que no dicen dónde se hicieron no son de ningún worktree)
      const lista = dir ? (await sesiones.historial(dir)).filter(x => !ofCopy || (!!x.cwd && insideOf(path.resolve(x.cwd), dir))) : [];
      enviar(ws, { t: 'respuesta', peticion: m.peticion, datos: lista.map(x => (fuera.has(x.claudeId.toLowerCase()) && !x.enCurso ? { ...x, fuera: true } : x)) }); break;
    }
    case 'cargarConversacion': { const sala = e.salas.find(s => s.id === m.salaId); enviar(ws, { t: 'respuesta', peticion: m.peticion, datos: sala ? await sesiones.transcripcion(m.claudeId, folderOf(sala)) : [] }); break; }
    case 'cuaderno': enviar(ws, { t: 'respuesta', peticion: m.peticion, datos: sesiones.cuaderno(m.sesionId) }); break;
    case 'comandos': enviar(ws, { t: 'respuesta', peticion: m.peticion, datos: m.sesionId ? sesiones.comandos(m.sesionId) : [] }); break;
    case 'terminalAbrir': terminales.abrir(m.id, m.cwd, m.cols, m.filas, outputOf(ws)); break;
    case 'terminalEntrada': terminales.entrada(m.id, m.datos); break;
    case 'terminalTamano': terminales.tamano(m.id, m.cols, m.filas); break;
    case 'terminalCerrar': terminales.cerrar(m.id); break;
    case 'salir': apagar('El Supervisor ha cerrado el refugio.'); break;
    case 'accion': {
      try { enviar(ws, { t: 'respuesta', peticion: m.peticion ?? '', datos: await accion(m.nombre, m.datos) }); }
      catch (err) { enviar(ws, { t: 'respuesta', peticion: m.peticion ?? '', error: (err as Error).message }); }
      break;
    }
  }
}

// ---------------------------------------------------------------- HTTP estático
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
// Caché: lo compilado lleva la huella en el nombre (dist/web/assets/*-<hash>.js) y no cambia nunca; todo lo demás
// (modelos, texturas, índices, que se rehacen con el mismo nombre) se vuelve a comprobar en cada carga con su ETag
// y, si no ha cambiado, va un 304 sin cuerpo. Así nunca se ve una versión vieja de nada.
function serve(req: http.IncomingMessage, res: http.ServerResponse, raiz: string, rel: string) {
  const ruta = path.normalize(path.join(raiz, rel));
  if (!(ruta === raiz || ruta.startsWith(raiz + path.sep)) || !existsSync(ruta)) return false;
  const st = statSync(ruta);
  if (!st.isFile()) return false;
  const immutable = raiz === WEB && rel.startsWith('/assets/');
  const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const cabeceras = { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, cabeceras); res.end(); return true; }
  res.writeHead(200, { ...cabeceras, 'Content-Type': TYPES[path.extname(ruta).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(ruta).pipe(res);
  return true;
}
const servidor = http.createServer((req, res) => {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403); res.end(); return; }
  let url: string;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url.startsWith('/assets/') && serve(req, res, ASSETS, url.slice(8))) return;
  // las páginas HTML del Mac que se ven en el juego (paginasLocales.ts), con su llave y aisladas
  if (url.startsWith('/pagina/')) { servePage(req, res, url).then(ok => { if (!ok) { res.writeHead(404); res.end(); } }, () => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
  if (url === '/salud') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, claude: !!sesiones.claude, version: sesiones.version, codigo: SERVER_FINGERPRINT })); return; }
  // ./shelter, al abrir la app con un servidor de antes de los últimos cambios aún en marcha, le pide ponerse al día.
  // Con el secreto del arranque y sin Origin: una página web no puede pedirlo.
  if (url === '/poner-al-dia' && req.method === 'POST') {
    const t = req.headers['x-shelter-token'];
    if (req.headers.origin || typeof t !== 'string' || !tokenValid(t)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(setOnDay());
    return;
  }
  // (frame-src: la ventana «Página» enseña páginas de este Mac: las de /pagina/ y las que sirve una herramienta en local,
  // como una página de revisión con notas; cada una en su <iframe> aislado, web/src/ui/Navegadores.tsx)
  // la página del juego lleva el secreto de este arranque para abrir el WebSocket
  // la página NO lleva el secreto (cualquier proceso local podría pedirla): llega en el fragmento #t= de la URL que abre
  // el lanzador (leído de DATOS/token, 0600), como hace Jupyter. Política de contenido estricta: nada se carga de fuera
  // salvo las carátulas de lo que suena en la discoteca (imágenes del CDN de Spotify, que lee la pletina).
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.scdn.co; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' blob: data: ws://127.0.0.1:${PUERTO} ws://localhost:${PUERTO}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; frame-src 'self' http://127.0.0.1:* http://localhost:*`;
  const page = () => { const f = path.join(WEB, 'index.html'); if (!existsSync(f)) return false; res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer' }); res.end(readFileSync(f, 'utf8')); return true; };
  if (existsSync(WEB) && (url === '/' || url === '/index.html' ? page() : (serve(req, res, WEB, url) || page()))) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('El juego no está compilado. Ejecuta ./shelter');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
servidor.on('upgrade', (req, socket, cabeza) => {
  const origen = req.headers.origin || '';
  const t = new URL(req.url || '/', 'http://x').searchParams.get('t');
  if (!ORIGINS.has(origen) || !HOSTS.test(req.headers.host || '') || !(req.url || '').startsWith('/ws') || !tokenValid(t)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, cabeza, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  clients.add(ws);
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  ws.on('message', async raw => {
    let m: ClientMessage;
    try { m = JSON.parse(String(raw)); } catch { return; }
    try { await manejar(ws, m); } catch (err) { enviar(ws, { t: 'aviso', nivel: 'error', texto: (err as Error).message }); }
  });
  ws.on('close', () => {
    clients.delete(ws); enUso.delete(ws); terminales.soltar(outputOf(ws)); dictations.soltar(ws);
    if (!clients.size) graceTimer = setTimeout(async () => {
      graceTimer = null;
      // el juego se ha caído (nadie ha pulsado Salir: eso apaga al momento): lo que estaba abierto sale a tu escritorio
      // en vez de perderse. Solo con la ventana del juego (./shelter o la app) y con los datos de verdad (o en la QA)
      if (process.env.SHELTER_SALIR_SIN_CLIENTES && (!process.env.SHELTER_DATOS || process.env.SHELTER_ESCRITORIO_PRUEBA) && (sesiones.lista().some(s => s.estado !== 'cerrada') || terminales.abiertas().length)) {
        console.log('El juego se ha caído: saco a tu escritorio lo que estaba abierto.');
        const ids = terminales.abiertas().map(t => t.id);
        try { await exitASurface({ todo: true, windowNew: true }); await waitHooks(ids); } catch (e) { console.error('No pude salir a la superficie:', (e as Error).message); }
        if (clients.size) return;   // ha vuelto alguien mientras tanto
      }
      // nadie ha vuelto: se paran las sesiones y las terminales (recargar dentro del margen no mata nada); las que
      // están abiertas en tu escritorio siguen
      const n = sesiones.vivas().length; sesiones.cerrarTodas(); const t = terminales.cerrarTodas(true);
      if (n || t) console.log(`Sin clientes durante ${GRACE_MS / 1000} s: ${n} sesiones y ${t} terminales paradas.`);
      if (process.env.SHELTER_SALIR_SIN_CLIENTES) apagar('Sin clientes');
    }, GRACE_MS);
  });
});

let switchingOff = false;
function apagar(motivo: string) {
  if (switchingOff) return; switchingOff = true;
  console.log(`\nApagando el refugio (${motivo})…`);
  // cada paso por separado: si uno falla (p. ej. no se puede guardar), el resto se hace igual y el proceso sale
  // al salir de verdad no queda nada abierto (para `./shelter superficie`, si luego no hay refugio)
  for (const paso of [() => sesiones.cerrarTodas(), () => dictations.stopAll(), () => writeFileSync(path.join(DATOS, 'abiertas.json'), '[]'), () => terminales.apagar(), () => integraciones.parar(), () => slackRemote.parar(), () => almacen.saveAlready(), () => broadcast({ t: 'aviso', nivel: 'info', texto: t('server.workShelterHasClosedSee') })])
    try { paso(); } catch (e) { console.error('Al apagar:', (e as Error).message); }
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', () => apagar('Ctrl+C'));
process.on('SIGTERM', () => apagar('SIGTERM'));

servidor.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') { console.error(`El puerto ${PUERTO} ya está en uso: ¿hay otro work-shelter abierto? Ciérralo o usa SHELTER_PUERTO.`); process.exit(2); }
  throw e;
});
servidor.listen(PUERTO, '127.0.0.1', async () => {
  writeToken();
  console.log(`work-shelter escucha en http://127.0.0.1:${PUERTO}  (datos: ${DATOS})`);
  if (!sesiones.claude) console.warn('AVISO: no encuentro el binario `claude`. Instala Claude Code e inicia sesión para que los habitantes trabajen.');
  else console.log(`Claude Code: ${sesiones.version}`);
  await refreshRepos();
  integraciones.arrancar();
  // solo el refugio de verdad escucha al mando de Slack (una segunda conexión de Socket Mode a la misma app se repartiría
  // los eventos); los de prueba, con SHELTER_SLACK=1
  if (!process.env.SHELTER_DATOS || process.env.SHELTER_SLACK === '1') slackRemote.iniciar().catch(e => console.error('Slack (mando):', (e as Error).message));
  controlRemoto.restaurar(almacen.estado.salas.map(s => ({ id: s.id, nombre: s.nombre, cwd: isRoomOfRepo(s.tipo) && s.ruta ? folderOf(s) : undefined }))).catch(() => {});
});
