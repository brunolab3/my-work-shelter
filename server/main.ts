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
import { GAME_NAME, type ClientMessage, type ServerMessage, type InfoRepo, type Visitor, type SessionSummary, type MessageOrigin, type LogInput } from '../shared/protocol.ts';
import { DEFAULT_LOG_PAGE } from '../shared/logPages.ts';
import { linksPages } from '../shared/sessionPages.ts';
import { ToolOutputs } from './toolOutputs.ts';
import { Sessions } from './sessions.ts';
import { Attachments } from './attachments.ts';
import { openAttachment, isPackage, revealLocal } from './open.ts';
import { openLink, linkKind, imageThumbnail, servePage, existingPages, pagesUpdated } from './localPages.ts';
import { cleanCompares, COMPARES_FOLDER } from './compare.ts';
import { isCloneOfExample } from './examples.ts';
import { mcpDecor, adaptPrompt, type CtxDecor } from './roomDecor.ts';
import { mcpAssignment, mcpPlan, type CtxAssignment } from './dispatch.ts';
import { mcpRooms, sendToRoom, taskWorktree, type CtxRooms } from './roomNotices.ts';
import { Plans, tasksOrder } from './plans.ts';
import { Verifications } from './verifications.ts';
import { boardsSetup, doneTransition, saveBoard, startupNotices, taskTracker, type CtxTrackers, type Tracker } from './verificationBoards.ts';
import { finalCheckpoint, prRef, summaryOf, type BoardStatuses } from '../shared/verification.ts';
import { BlockersPR } from './prBlocks.ts';
import { TasksColors } from './taskColors.ts';
import { groupByTask, roomPlan, applyPlan } from './organize.ts';
import { ReviewsPR, REVIEWS_QUERY, remoteRepo } from './prReviews.ts';
import { CIFailures, CI_QUERY } from './ciFailures.ts';
import { cachedPRs, cachedTaskPRs, preflightOf, PageReviews, gatePush, preflightTools, type CtxPreflight } from './preflight.ts';
import { checklistFromClaudeMd } from '../shared/preflight.ts';
import { autoCompactWindow, handoffThreshold } from '../shared/compact.ts';
import { startFromHandoff } from './handoff.ts';
import { setFlag } from '../shared/flagged.ts';
import type { JiraTransition, PRBoard } from '../shared/board.ts';
import { blockersBetween, pRKey } from '../shared/deploy.ts';
import { TasksCleanup, orphanedConversations } from './taskCleanup.ts';
import { ReviewRoom, REVIEW_ROOM, REVIEW_ROOM_QUERY } from './reviewRoom.ts';
import { WorkLog, type WorkLogSources } from './workLog.ts';
import type { ReviewBoard } from '../shared/reviews.ts';
import { Scheduled, summary } from './scheduled.ts';
import { LimitResumes, scanStopped, resetMs, stopsWork, UNKNOWN_RESET_MS } from './limitResume.ts';
import type { PackPart, UsageWindow } from '../shared/scheduled.ts';
import { gitEnvironment } from './gitEnv.ts';
import { Clones, cloneDestination, cloneUrl, clonedRepos, listRepos, repoInfo, repoRef } from './githubClone.ts';
import { captureRoom } from './roomCapture.ts';
import { baseStock } from '../shared/decor.ts';
import { readSecret } from './integrations/keychain.ts';
import { Dictations } from './voice.ts';
import { Terminals, SOCKET_TERMINALS } from './terminals.ts';
import { raisedSessionLimit } from './sessionLimit.ts';
import { openInDesktop, openInAppClaude, outsideOpen, closeOutside, hookCommand, resumeCommand, type ItemDesktop } from './desktop.ts';
import { tonesForRepeated } from '../shared/recruits.ts';
import { pRTask, remoteName, taskKey, worktreeHasTask, worktreeTask } from '../shared/tasks.ts';
import { Store, DATA, folderOf, reposRoot, hideRoom, showRoom, isHideable, roomIdOf } from './state.ts';
import { infoRepo, suggestions, expand, recentTranscripts, liveSessions, worktreeList, hasBranch, branchesVisited, roomStyle, projectType, hideWorktreesUnder } from './repos.ts';
import { Integrations } from './integrations/index.ts';
import { gameAction, ensurePlayer, growCrops, taskReward } from './game.ts';
import { generateRecruit } from '../shared/recruits.ts';
import { distribute, defaultLayout, isRoomOfRepo, PLANNING_ROOM, placeRoom, moveFloor } from '../shared/layout.ts';
import { STYLE_PALETTE, areaByType, isArea } from '../shared/sectors.ts';
import { isLanguage, setLanguage, locale, tIs, roomNameIs } from '../shared/language.ts';
import * as controlRemoto from './remoteControl.ts';
import { SlackRemote } from './slackBot.ts';
import { REMOTE_DELAY_MS, type RemoteDeps } from './remoteBot.ts';
import { sanitizeLook, TYPES_STOCK } from '../shared/appearance.ts';
import { t } from '../shared/language.ts';
import { planLimits } from './planLimits.ts';
import { runningThings, stopDwellerProcess } from './runningThings.ts';
import { usageSpend } from './usageSpend.ts';

// reinicio desde el juego: antes de apagar el servidor viejo se carga el nuevo con esta variable para ver que arranca
// (un error de sintaxis o una importación rota se detectan aquí y el juego sigue en marcha)
if (process.env.SHELTER_COMPROBAR) process.exit(0);

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SHELTER_PUERTO || 3778);
const WEB = path.join(ROOT, 'dist', 'web');
const ASSETS = path.join(ROOT, 'assets');
const GRACE_MS = 20_000;
// huellas del código (scripts/fingerprints.cjs): /salud dice la de este servidor para que ./shelter sepa si es de antes de
// los últimos cambios, y el reinicio las usa para recompilar el cliente o volver a abrir la app entera si hace falta
const fingerprints = createRequire(import.meta.url)('../scripts/fingerprints.cjs') as { fingerprint(group: 'cliente' | 'servidor' | 'app'): string; clientUpToDate(): boolean };
const SERVER_FINGERPRINT = fingerprints.fingerprint('servidor');
// los orígenes del servidor de desarrollo (Vite, 5173) solo con SHELTER_DEV=1: en uso normal, solo el propio refugio
const DEVELOPMENT = !!process.env.SHELTER_DEV;
const VITE = Number(process.env.SHELTER_PUERTO_VITE || 5173);   // varios refugios de prueba a la vez, cada uno con su Vite
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, ...(DEVELOPMENT ? [`http://127.0.0.1:${VITE}`, `http://localhost:${VITE}`] : [])]);
// secreto por arranque: va dentro de la página que sirve el refugio (o en DATOS/token para Vite en desarrollo) y se exige
// al abrir el WebSocket. Otra web no puede leerlo y otro usuario del Mac no puede leer el archivo (0600).
// Con el supervisor (./shelter) el secreto es del arranque entero y sobrevive a los reinicios del servidor.
const TOKEN = /^[0-9a-f]{32,}$/.test(process.env.SHELTER_TOKEN ?? '') ? process.env.SHELTER_TOKEN! : randomBytes(24).toString('hex');
delete process.env.SHELTER_TOKEN;   // que no lo herede nada de lo que lanza el servidor
// se escribe al conseguir el puerto (un segundo servidor que no arranca no pisa el del primero)
const writeToken = () => { try { mkdirSync(DATA, { recursive: true, mode: 0o700 }); writeFileSync(path.join(DATA, 'token'), TOKEN, { mode: 0o600 }); } catch (e) { console.error('No pude escribir el token:', (e as Error).message); } };
const tokenValid = (t: string | null) => { if (!t) return false; const a = Buffer.from(t), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
const HOSTS = /^(127\.0\.0\.1|localhost):\d+$/;
process.on('uncaughtException', e => console.error('Error no capturado (el refugio sigue):', e));
// si se cae la ventana que lo lanzó, su salida ya no va a ningún sitio: escribir en ella no puede tumbar el servidor
for (const f of [process.stdout, process.stderr]) f.on('error', () => {});
process.on('unhandledRejection', e => console.error('Promesa rechazada sin capturar (el refugio sigue):', e));

const insideOf = (filePath: string, dir: string) => filePath === dir || filePath.startsWith(dir + path.sep);
const store = new Store();
if (store.state.language) setLanguage(store.state.language);
ensurePlayer(store);
const repos: Record<string, InfoRepo> = {};
const clients = new Set<WebSocket>();
let graceTimer: NodeJS.Timeout | null = null;

function pathRoom(filePath: string): string | undefined {
  // las rutas dentro de un worktree (.claude/worktrees/x o worktrees externos) se resuelven al repo principal
  let best: { id: string; length: number } | undefined;
  for (const s of store.state.rooms) {
    const candidates = [folderOf(s), ...(s.path ? (repos[s.id]?.worktrees ?? []).map(w => w.path) : [])];
    for (const c of candidates) if ((filePath === c || filePath.startsWith(c + path.sep)) && c.length > (best?.length ?? 0)) best = { id: s.id, length: c.length };
  }
  return best?.id;
}

const attachments = new Attachments(DATA);
// el decorado de las salas de repo, para las herramientas de su habitante («Adaptar la sala al repo», roomDecor.ts)
const ctxDecor: CtxDecor = {
  room: id => store.state.rooms.find(s => s.id === id && isRoomOfRepo(s.type)),
  template: id => { const s = store.state.rooms.find(x => x.id === id); return s ? baseStock(s, repos[id]) : 'taller'; },
  save: (id, d) => {
    store.change(x => { const s = x.rooms.find(y => y.id === id); if (!s) return; if (d) s.decor = d; else delete s.decor; });
    broadcast({ t: 'estado', state: store.state as any });
  },
  // la foto, con el propio juego (en desarrollo, el de Vite: el compilado puede ser de antes)
  capture: id => captureRoom(`http://127.0.0.1:${DEVELOPMENT ? VITE : PORT}/?sala=${encodeURIComponent(id)}&revisar#t=${TOKEN}`, id),
};
// el reparto del trabajo desde las salas de coordinación (dispatch.ts): cada parte, un trabajo nuevo en la sala de su
// repo y en un worktree propio
const ctxAssignment = (wing: string): CtxAssignment => ({
  rooms: () => store.state.rooms.filter(s => s.type === 'repo' && s.path).map(s => ({
    id: s.id, name: s.name, path: s.path!, branch: repos[s.id]?.branch,
    dweller: store.state.dwellers.find(h => h.roomId === s.id)?.name,
    inIsWing: s.path!.startsWith(wing + path.sep),
  })),
  pathRoom,
  start: async (roomId, prompt) => {
    const h = store.state.dwellers.find(x => x.roomId === roomId);
    if (!h) throw new Error(t('server.theRoomHasNoDweller'));
    const sid = await startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId, prompt, options: { worktree: true } });
    return { sessionId: sid, dweller: h.name };
  },
  ...ctxPlan,
});
// el plan compartido de cada tarea repartida (plans.ts): lo leen las salas de sus partes y los cambios les llegan como mensaje
const plans = new Plans(DATA);
// the production verification plan of each task (verifications.ts): the dweller writes it, the Overseer approves it in the pre-flight
const verifications = new Verifications(DATA, Date.now, () => broadcast({ t: 'verificaciones', states: verificationSummaries() }));
const verificationSummaries = () => Object.fromEntries(Object.entries(verifications.states()).map(([k, p]) => [k, summaryOf(p)]));
// the tracker's side (verificationBoards.ts): Jira's one prod-check and done pair, each Linear team's, linked or picked in the vault
const ctxTrackers: CtxTrackers = {
  action: (name, d) => integrations.action(name, d),
  connected: f => { const s = integrations.states()[f]; return s?.mode === 'real' && s.state === 'conectada'; },
  settings: () => { const a = store.state.settings as any; return { jira: a.verificationJira as BoardStatuses | undefined, boards: (a.verificationBoards ?? {}) as Record<string, BoardStatuses> }; },
  save: p => {   // the board's prod-check column follows it
    const a = store.state.settings as any;
    if (p.jira) a.verificationJira = p.jira;
    if (p.boards) a.verificationBoards = p.boards;
    store.save(); broadcast({ t: 'estado', state: store.state as any });
  },
};
// bloqueos entre PR marcados a mano en el tablero de despliegue de la sala de planificación
const prBlockers = new BlockersPR(DATA);
// el color de cada tarea en tableros y hologramas (shared/tasks.ts)
const taskColors = new TasksColors(DATA);
const ctxPlan: Pick<CtxAssignment, 'plans' | 'notify' | 'messenger' | 'sessionOfTask'> = {
  plans,
  // `origin`: who sent it, shown with it in the intercom (the game itself unless said: PR reviews, CI failures, plans). To
  // a busy conversation it waits in the scheduled list until its turn ends (never taken mid-turn, where it would
  // derail what it was doing), then starts a turn of its own; `fromSession`: the conversation that wrote it
  notify: (id: string, text: string, origin: MessageOrigin = { kind: 'game' }, fromSession?: string) => {
    try {
      const s = sessions.list().find(x => x.id === id);
      if (!s || s.state === 'cerrada') return false;
      if (busyState(s.state)) {
        const sender = fromSession ? sessions.list().find(x => x.id === fromSession) : undefined;
        scheduled.hold({ roomId: s.roomId, sessionId: s.id, claudeId: s.claudeId, cwd: path.resolve(s.worktree ?? s.cwd), title: s.title }, text, origin,
          origin.kind === 'room' ? { roomId: origin.roomId, sessionId: sender?.id, claudeId: sender?.claudeId } : { roomId: s.roomId });
        return true;
      }
      sessions.deliver(id, text, origin); return true;
    } catch { return false; }
  },
  sessionOfTask: (roomId, key) =>
    sessions.list().filter(s => s.roomId === roomId && s.state !== 'cerrada' && worktreeHasTask({ path: s.worktree ?? s.cwd }, key)).sort((a, b) => b.updated - a.updated)[0]?.id,
  messenger: (since, a, reason) => broadcast({ t: 'mensajero', since, a, reason }),
};
// a PR's CI failure or new reviews (ciFailures.ts, prReviews.ts): packed with the others of that PR for that conversation
// (scheduled.ts: pack), which go together once its turn ends and the PR's checks have finished: at once if both already
const prSettled = (url: string) => !ciFailures.checksOf(url)?.some(c => c.state === 'pendiente');
const notifyPR = (id: string, text: string, pr: PackPart & { url: string; label: string }) => {
  const s = sessions.list().find(x => x.id === id);
  if (!s || s.state === 'cerrada') return false;
  try { scheduled.pack({ roomId: s.roomId, sessionId: s.id, claudeId: s.claudeId, cwd: path.resolve(s.worktree ?? s.cwd), title: s.title }, { ...pr, text }, { roomId: s.roomId }); }
  catch { return false; }
  scheduled.sweep().catch(() => {});
  return true;
};
// mensajes entre salas (roomNotices.ts): a la conversación de la tarea o a una nueva con el habitante, en automático
const busyState = (state?: string) => ['arrancando', 'trabajando', 'esperando'].includes(state ?? '');
const ctxRooms: CtxRooms = {
  rooms: () => store.state.rooms.map(s => { const h = store.state.dwellers.find(x => x.roomId === s.id); return { id: s.id, name: roomNameIs(s), dweller: h && { id: h.id, name: h.name } }; }),
  sessionOfTask: (roomId, key) => ctxPlan.sessionOfTask!(roomId, key),
  // de git al momento: un worktree recién creado (por otra conversación) aún no está en `repos`, que se repasa cada 20 s
  worktreeOfTask: async (roomId, key) => { const s = store.state.rooms.find(x => x.id === roomId); return s ? taskWorktree(await worktreeList(folderOf(s)), key) : undefined; },
  notify: (id, text, origin, fromSession) => ctxPlan.notify(id, text, origin, fromSession),
  busy: id => busyState(sessions.list().find(s => s.id === id)?.state),
  resume: (roomId, cwd, prompt) => resumeInFolder(roomId, cwd, prompt, 'auto'),
  start: async (roomId, dwellerId, prompt, where) => {
    const m: Extract<ClientMessage, { t: 'empezar' }> = { t: 'empezar', dwellerId, roomId, prompt, options: { cwd: where?.cwd, worktree: where?.worktree, permissions: 'auto' } };
    const id = await startWork(undefined, m);
    // startWork quita el worktree si la carpeta no es un repo git; el nuevo se ve en los hologramas cuanto antes
    if (m.options.worktree) refreshReposSoon();
    return { id, inWorktree: !!(where?.cwd || m.options.worktree) };
  },
  delivery: (room, a) => broadcast({ t: 'entrega', room, ...a }),
  notice: text => broadcast({ t: 'aviso', level: 'info', text }),
  scheduled: { schedule: (...a) => scheduled.schedule(...a), ofConversation: id => scheduled.ofConversation(id), defer: (...a) => scheduled.defer(...a), overLimit: (...a) => scheduled.overLimit(...a), cancel: (id, since) => scheduled.cancel(id, since) },
  verifications: { plans: verifications,
    conversation: id => { const s = id ? sessions.list().find(x => x.id === id) : undefined; return s && { roomId: s.roomId, sessionId: s.id, claudeId: s.claudeId, cwd: path.resolve(s.worktree ?? s.cwd), title: s.title }; },
    taskOfSession: id => { const s = id ? sessions.list().find(x => x.id === id) : undefined; return s ? worktreeTask({ path: s.worktree ?? s.cwd }) : undefined; } },
  medals: { room: () => workLog.digestRoom(),
    propose: (sid, m) => {
      const claudeId = sid ? sessions.list().find(x => x.id === sid)?.claudeId : undefined;
      const r = workLog.proposeMedal({ ...m, ...(claudeId ? { conversation: claudeId } : {}) });
      if (!r.ok) return { ok: false, text: r.error };
      const medal = r.medal;
      ask(t('trophies.medal.ask', { req: medal.award ?? medal.requirement, fuente: t(`trophies.source.${medal.source ?? 'digest'}`), texto: medal.text, pruebas: medal.evidence.join(' · ') }), { si: t('trophies.medal.accept'), no: t('trophies.medal.dismiss') },
        async si => { workLog.decideMedal(medal.id, si); });
      return { ok: true, text: t('tool.medal.proposed', { req: medal.award ?? medal.requirement }) };
    },
    progress: report => {
      const r = workLog.recordProgress(report);
      if (!r.ok) return { ok: false, text: r.error };
      const level = r.progress.level ?? '—';
      broadcast({ t: 'aviso', level: 'info', text: t('trophies.verify.done', { nivel: level }) });
      return { ok: true, text: [t('tool.ladder.saved', { nivel: level }),
        ...(r.overridden.length ? [t('tool.ladder.overridden', { reqs: r.overridden.join(', ') })] : []),
        ...(r.unproven.length ? [t('tool.ladder.unproven', { reqs: r.unproven.join(', ') })] : [])].join('\n') };
    } },
  worktreeOfSession: async (roomId, sid) => {
    const s = store.state.rooms.find(x => x.id === roomId), sess = sessions.list().find(x => x.id === sid), cwd = sess && (sess.worktree ?? sess.cwd);
    if (!s || !cwd) return undefined;
    const w = (await worktreeList(folderOf(s))).find(w => !w.main && (cwd === w.path || cwd.startsWith(w.path + path.sep)));
    return w && { path: w.path, branch: w.branch, local: await hasBranch(w.path, 'local') };
  },
};
// failed tools' full outputs, on disk while their session lives (server/toolOutputs.ts)
const toolOutputs = new ToolOutputs(path.join(DATA, 'salidas'));
toolOutputs.clear();
const sessions = new Sessions({
  pathRoom, reposOfShelter: () => gitPaths(), mcpRoom: id => (ctxDecor.room(id) ? mcpDecor(id, ctxDecor) : undefined),
  mcpAssignment: (id, ask, sid) => { const s = store.state.rooms.find(x => x.id === id && x.type === 'coordinacion' && x.path); return s ? mcpAssignment(ctxAssignment(s.path!), { coordination: roomNameIs(s), roomId: s.id, sessionId: sid, ask }) : undefined; },
  mcpRooms: (id, sid, inWorktree) => mcpRooms(ctxRooms, id, sid, inWorktree),
  mcpPlan: id => { const s = store.state.rooms.find(x => x.id === id && x.type === 'repo'); return s && plans.ofRoom(id).length ? mcpPlan(ctxPlan, { roomId: id, room: s.name }) : undefined; },
  preflight: { state: cwd => preflightToolset.state(cwd), respond: (cwd, item, state, note) => preflightToolset.respond(cwd, item, state, note), puerta: cwd => gatePush(cwd, ctxPreflight) },
  trustedFolders: () => ((store.state.settings as any).trustedFolders ?? []) as string[],
  trust: filePath => { const a = store.state.settings as any; a.trustedFolders = [...new Set([...(a.trustedFolders ?? []).filter((r: string) => existsSync(r)), path.resolve(filePath)])]; store.save(); },
  clonedFolders: () => ((store.state.settings as any).clonedFolders ?? []) as string[],
  autoCompactWindow: () => autoCompactWindow((store.state.settings as any).autoCompactWindow),
  handoff: {
    threshold: () => handoffThreshold((store.state.settings as any).handoffAt),
    offered: id => (((store.state.settings as any).handoffOffered ?? []) as string[]).includes(id),
    mark: id => { const a = store.state.settings as any; a.handoffOffered = [...(a.handoffOffered ?? []), id].slice(-300); store.save(); },
  },
}, attachments, toolOutputs);
// trusted and cloned folders that no longer exist (removed worktrees, deleted clones) are dropped at startup, so the lists don't keep growing
for (const k of ['trustedFolders', 'clonedFolders']) { const a = store.state.settings as any; if (Array.isArray(a[k])) { const live = a[k].filter((r: unknown) => typeof r === 'string' && existsSync(r)); if (live.length !== a[k].length) { a[k] = live; store.save(); } } }
// clones from GitHub at the Main Gate: once done, the folder is a trust boundary (sessions.ts, confianza())
const clones = new Clones(undefined, c => { if (c.state !== 'hecho') return; const a = store.state.settings as any; a.clonedFolders = [...new Set([...(a.clonedFolders ?? []), c.path])]; store.save(); });
const ghConnected = async (): Promise<{ gh?: (args: string[]) => Promise<string> }> => { const c = await connectionGitHub(); return c.real ? { gh: async args => (await import('./git.ts')).gh(args, c.token, 30_000) } : {}; };
const dictations = new Dictations(DATA);
dictations.stage();
const terminals = new Terminals(cwd => !!pathRoom(cwd) || store.state.rooms.some(s => { const c = folderOf(s); return cwd === c || cwd.startsWith(c + path.sep); }), () => [...clients].map(outputOf));
const integrations = new Integrations(store, (m) => broadcast(m));

// mando a distancia por Slack (remoteBot.ts, slackBot.ts): las peticiones de aprobación, para responderlas sin salir del
// refugio, y la lista de salas y conversaciones para pasarlas a Remote Control; con una app propia y Socket Mode
// el Supervisor está usando el juego: lo dice cada página cada 30 s mientras su ventana está delante y la tocan
// (web/src/engine/focus.ts, watchPresence); sin aviso en 90 s, no
let lastUse = 0;
const remoteDeps: RemoteDeps = {
  delayMs: REMOTE_DELAY_MS,
  inUse: () => Date.now() - lastUse < 90_000,
  sessions: () => sessions.list(),
  rooms: () => store.state.rooms.filter(s => isRoomOfRepo(s.type) || sessions.list().some(x => x.roomId === s.id && x.state !== 'cerrada')).map(s => ({ id: s.id, name: roomNameIs(s) })),
  dweller: s => store.state.dwellers.find(h => h.id === s.dwellerId)?.name ?? t('server.surface.dweller'),
  respond: (id, requestId, decision, responses) => sessions.respond(id, requestId, decision, undefined, responses),
  aRemoteControl: ids => exitASurface(ids ? { sessions: ids, remote: true, windowNew: true } : { all: true, remote: true, windowNew: true }),
};
const slackRemote = new SlackRemote({ data: DATA, ...remoteDeps });

// una función de salida por socket (las terminales la recuerdan para enviar a cada pestaña y soltarla al cerrar)
const outputs = new WeakMap<WebSocket, (m: any) => void>();
function outputOf(ws: WebSocket) { let f = outputs.get(ws); if (!f) { f = x => send(ws, x); outputs.set(ws, f); } return f; }
function send(ws: WebSocket, m: ServerMessage) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }
function broadcast(m: ServerMessage) { const s = JSON.stringify(m); for (const c of clients) if (c.readyState === c.OPEN) c.send(s); }

// conversaciones nacidas en el refugio (para no confundirlas con visitantes, aunque se cierren o se reinicie el servidor)
const ownIds = new Set<string>(((store.state.settings as any).ownSessions ?? []) as string[]);
sessions.on('sesion', s => {
  broadcast({ t: 'sesion', session: s });
  if (s.claudeId && !ownIds.has(s.claudeId)) { ownIds.add(s.claudeId); (store.state.settings as any).ownSessions = [...ownIds].slice(-300); store.save(); }
  // quien trabaja primero dentro de un worktree es su autor: el holograma de la sala es una copia suya
  const wt = s.state !== 'cerrada' ? pathWorktree(s.cwd) : undefined;
  if (wt && !authorsWorktree()[wt]) { authorsWorktree()[wt] = s.dwellerId; store.save(); refreshReposSoon(); }
});
function authorsWorktree(): Record<string, string> { const a = store.state.settings as any; return (a.authorsWorktree ??= {}); }
function pathWorktree(cwd: string) {
  for (const info of Object.values(repos)) for (const w of info.worktrees) if (!w.main && (cwd === w.path || cwd.startsWith(w.path + path.sep))) return w.path;
  return /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];
}
let timerRepos: NodeJS.Timeout | null = null;
function refreshReposSoon() { if (timerRepos) return; timerRepos = setTimeout(() => { timerRepos = null; refreshRepos().catch(() => {}); }, 400); }
sessions.on('sesion', () => aimOpen());
// a turn ended: what waited for it in the scheduled list goes out (scheduled.ts: hold)
sessions.on('sesion', (s: SessionSummary) => { if (!busyState(s.state)) scheduled.turnEnded({ sessionId: s.id, claudeId: s.claudeId }); });
// lo que pide aprobación, también al móvil (y su mensaje se recoge en cuanto se responde, aquí o allí)
sessions.on('sesion', s => { slackRemote.request(s).catch(() => {}); });
sessions.on('entradas', (sid, entries) => broadcast({ t: 'entradas', sessionId: sid, entries }));
sessions.on('texto', (sid, delta) => broadcast({ t: 'texto', sessionId: sid, delta }));
// the handoff summary is written: the new session starts from it and the old one closes (server/handoff.ts)
sessions.on('handoff', (old: SessionSummary, summary: string) => {
  startFromHandoff({ start: m => startWork(undefined, { t: 'empezar', ...m }), close: id => sessions.close(id) }, old, summary)
    .catch(err => broadcast({ t: 'aviso', level: 'error', text: t('server.handoffFailed', { error: (err as Error).message }) }));
});
sessions.on('fuera', sid => { toolOutputs.drop(sid); broadcast({ t: 'sesionFuera', sessionId: sid }); });
sessions.on('herramienta', () => {
  const before = store.state.jugador.cultivos.map(c => c.phase).join();
  store.state.jugador.toolsCalls++; growCrops(store); store.save();
  if (store.state.jugador.cultivos.map(c => c.phase).join() !== before) broadcast({ t: 'estado', state: store.state as any });
});
// the plan's usage, in the top bar (server/planLimits.ts): from the events and, while a session lives, read now and
// then (after each turn, at most once a minute, and every 5 min)
planLimits.on('cambio', limits => broadcast({ t: 'limites', limits }));
let usageReadAt = 0;
function readPlanUsage() {
  if (Date.now() - usageReadAt < 60_000) return;
  usageReadAt = Date.now();
  sessions.planUsage().then(rl => planLimits.fromUsage(rl)).catch(() => {});
}
setInterval(readPlanUsage, 5 * 60_000).unref();
// the tokens spent, on hover over that meter (server/usageSpend.ts): the first read of the transcripts is the long one,
// so it is done once the game has started
setTimeout(() => usageSpend.buckets().catch(() => {}), 20_000).unref();
// límites de uso del plan de Claude: el refugio avisa (una vez por estado) en vez de callarlo
let lastLimit = '';
// the plan's 5-hour window as the sessions report it: next-window messages wait for it to end (scheduled.ts)
const usage: UsageWindow = {};
sessions.on('limite', (i: any) => {
  const resets = resetMs(i?.resetsAt);
  if (resets && (!i.rateLimitType || i.rateLimitType === 'five_hour')) usage.endsAt = resets;
  if (stopsWork(i)) usage.blockedUntil = resets ?? Date.now() + UNKNOWN_RESET_MS; else if (i?.status === 'allowed') delete usage.blockedUntil;
  planLimits.fromEvent(i);
  if (!i || i.status === 'allowed') { lastLimit = ''; return; }
  const key = i.status + i.rateLimitType; if (key === lastLimit) return; lastLimit = key;
  const type = ({ five_hour: t('server.limit.fiveHour'), seven_day: t('server.limit.weekly'), seven_day_opus: t('server.limit.weeklyOpus'), seven_day_sonnet: t('server.limit.weeklySonnet') } as any)[i.rateLimitType] ?? '';
  const renews = i.resetsAt ? t('server.limit.renews', { cuando: new Date(i.resetsAt * (i.resetsAt < 1e12 ? 1000 : 1)).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }) : '';
  broadcast({ t: 'aviso', level: i.status === 'rejected' ? 'error' : 'aviso', text: i.status === 'rejected' ? t('server.limit.reached', { tipo: type, renueva: renews }) : t('server.limit.close', { tipo: type, renueva: renews, pct: i.utilization ? ` (${Math.round(i.utilization * 100)} %)` : '' }) });
});
sessions.on('turno', r => {
  readPlanUsage();
  // cada tarea terminada produce algo en el refugio: chatarra y, a veces, una pieza para la guía de campo
  if (r.state === 'terminada' && r.turnTools > 0) {
    const p = taskReward(store, r.turnTools);
    const who = store.state.dwellers.find(x => x.id === r.dwellerId)?.name ?? t('server.someone');
    broadcast({ t: 'estado', state: store.state as any });
    broadcast({ t: 'aviso', level: 'info', text: p.pieza ? t('server.taskRewardPiece', { quien: who, n: p.scrap, pieza: tIs(p.pieza.nombre), rareza: tIs(p.pieza.rarity) }) : t('server.taskReward', { quien: who, n: p.scrap }) });
  }
  const h = store.state.dwellers.find(x => x.id === r.dwellerId); if (h && r.claudeId) { h.lastSession = r.claudeId; store.save(); }
});

// las conversaciones abiertas, en disco: si el refugio entero se cae, `./shelter superficie` las retoma fuera
let openTimer: NodeJS.Timeout | null = null;
function aimOpen() {
  if (openTimer) return;
  openTimer = setTimeout(() => {
    openTimer = null;
    if (switchingOff) return;
    const list = sessions.list().filter(s => s.state !== 'cerrada' && s.claudeId).map(s => ({ claudeId: s.claudeId, cwd: s.cwd, title: s.title, dweller: store.state.dwellers.find(h => h.id === s.dwellerId)?.name, state: s.state, permissions: s.permissionMode }));
    try { writeFileSync(path.join(DATA, 'abiertas.json'), JSON.stringify(list), { mode: 0o600 }); } catch {}
  }, 1000);
}

// ---------------------------------------------------------------- salir a la superficie
// Lo que estaba en el juego (conversaciones y terminales) sigue en tu escritorio: el botón ↗ de cada ventana, la tecla
// de pánico (⇧⌥⌘Esc), `./shelter superficie` o, solo, si el juego se cae (desktop.ts)
const SHELTER = path.join(ROOT, 'shelter');
const uploading = new Set<string>();   // conversaciones que ya van camino de la superficie (no se abren dos veces)
async function exitASurface(d: Record<string, any>) {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const sessionIds = (d.all ? sessions.list().filter(s => s.state !== 'cerrada').map(s => s.id) : list(d.sessions)).filter(id => !uploading.has(id));
  for (const id of sessionIds) uploading.add(id);
  try { return await upload(d, sessionIds); } finally { for (const id of sessionIds) uploading.delete(id); }
}
async function upload(d: Record<string, any>, idsSes: string[]) {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  // al móvil (remoto) solo van las conversaciones: Remote Control no lleva terminales
  const idsTerm = d.remote ? [] : d.all ? terminals.openSessions().filter(t => !t.fuera).map(t => t.id) : list(d.terminals).filter(id => terminals.exists(id));
  const notices: string[] = [];
  const name = (hid: string) => store.state.dwellers.find(h => h.id === hid)?.name ?? t('server.surface.dweller');
  const roomOf = (cwd: string) => { const s = store.state.rooms.find(x => x.id === pathRoom(cwd)); return s ? roomNameIs(s) : path.basename(cwd); };
  // primero las terminales (al momento); las conversaciones que trabajan tardan un poco en pararse
  const terms: ItemDesktop[] = [];
  if (idsTerm.length && !terminals.outsideAccepts()) notices.push(t('server.oldTerminalsCannotGoOut'));
  else for (const id of idsTerm) { const term = terminals.openSessions().find(x => x.id === id); if (term) terms.push({ title: t('server.surface.terminalTitle', { carpeta: roomOf(term.cwd) }), command: hookCommand(SHELTER, SOCKET_TERMINALS, id) }); }
  let app = '';
  const open = async (items: ItemDesktop[], windowNew: boolean) => { try { app = await openInDesktop(items, { windowNew }); return true; } catch (e) { notices.push((e as Error).message); return false; } };
  if (terms.length) await open(terms, !!d.windowNew);
  const taken = (await Promise.all(idsSes.map(id => sessions.takeOut(id).catch(e => { notices.push((e as Error).message); return null; })))).filter(Boolean) as Awaited<ReturnType<typeof sessions.takeOut>>[];
  // con Remote Control (d.remoto), también se sigue desde el móvil: la app de Claude la lista con este mismo nombre
  // con el nombre `repo:TAREA` (remoteName): así se reconoce en el móvil y, al volver, en la lista del visitante
  const remoteOf = (cwd: string) => {
    const room = store.state.rooms.find(s => s.id === pathRoom(cwd)), wt = pathWorktree(cwd);
    return { repo: room?.path ? path.basename(room.path) : room?.name ?? path.basename(cwd), wt: wt ? { path: wt, branch: Object.values(repos).flatMap(i => i.worktrees).find(w => w.path === wt)?.branch } : undefined };
  };
  const conv = taken.map(r => {
    const title = `${name(r.dwellerId)} · ${r.title}`, rc = remoteOf(r.cwd);
    return { title, command: resumeCommand(d.remote ? { ...r, remote: remoteName(rc.repo, r.title, rc.wt) } : r) };
  });
  if (conv.length && !(await open(conv, !!d.windowNew && !terms.length)))
    notices.push(t('server.conversationsSavedResume', { comandos: taken.map(r => `claude --resume ${r.claudeId}`).join(', ') }));
  if (d.remote && conv.length) broadcast({ t: 'aviso', level: 'info', text: t('server.remoteControlOpened', { app: app || 'iTerm' }) });
  else if (terms.length || conv.length) broadcast({ t: 'aviso', level: 'info', text: t('server.surface.toTheSurface', { n: conv.length, m: terms.length, app: app || t('server.surface.yourDesktop') }) });
  for (const a of notices) broadcast({ t: 'aviso', level: 'aviso', text: a });
  return { sessions: conv.length, terminals: terms.length, notices, app };
}
// A la app de Claude: una conversación abierta se cierra antes en el juego (no se escribe en dos sitios a la vez);
// una del archivo (claudeId) va tal cual, si no está viva aquí
async function toClaudeApp(d: Record<string, any>) {
  let claudeId = String(d.claudeId ?? '');
  if (d.sessionId) {
    const id = String(d.sessionId);
    if (uploading.has(id)) return { claudeId: null };
    uploading.add(id);
    try { claudeId = (await sessions.takeOut(id, t('server.theClaudeApp'))).claudeId; } finally { uploading.delete(id); }
  } else if (sessions.list().some(s => s.claudeId === claudeId && s.state !== 'cerrada')) throw new Error(t('server.thatConversationIsOpenIn'));
  await openInAppClaude(claudeId);
  broadcast({ t: 'aviso', level: 'info', text: t('server.theConversationContinuesInThe') });
  return { claudeId };
}
// tras sacar terminales, se espera a que se enganchen fuera antes de cerrar nada (si no, se irían con el juego)
async function waitHooks(ids: string[], ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 200))) if (ids.every(id => !terminals.exists(id) || terminals.outside(id) > 0)) return;
}

// ---------------------------------------------------------------- repos y visitantes
// GitHub en la sala de Control de Versiones: solo con la integración conectada (en DEMO, de prueba; apagada, nada), con
// su token si lo hay
async function connectionGitHub() {
  const r = store.state.integrations.github;
  if (r?.mode !== 'real') return { real: false, off: r?.mode !== 'demo' };
  const token = r.secrets?.includes('token') ? await readSecret('github.token').catch(() => null) : null;
  return { real: true, token: token ?? undefined };
}
// un repo de ejemplo que ya no usa ninguna sala (se ha retirado o vinculado a otra carpeta): su copia, a la papelera
// (se recupera desde el Finder). Las carpetas tuyas nunca se tocan
async function throwCloneOfExample(filePath?: string) {
  if (!filePath || !isCloneOfExample(filePath) || !existsSync(filePath) || store.state.rooms.some(s => s.path === filePath)) return;
  try { const { moveToTrash: toTrash } = await import('./files.ts'); await toTrash(path.dirname(filePath), [path.basename(filePath)]); }
  catch (err) { console.error('No pude tirar a la papelera el repo de ejemplo:', (err as Error).message); }
}
// una carpeta pasa a ser sala (desde la Puerta o al tomar la raíz de repos), con su recluta: el que viene de la puerta o
// uno nuevo. Devuelve su id ('' si ya tenía sala)
async function addRoom(filePath: string, dweller?: any): Promise<string> {
  const type = projectType(filePath);
  const info = await infoRepo(filePath);
  const isWing = !info.isGit && (info.subrepos?.length ?? 0) > 1;
  // id y hueco se deciden dentro del mismo cambio (dos reclutamientos a la vez no comparten hueco ni nombre)
  let id = '';
  store.change(x => {
    if (x.rooms.some(s => s.path === filePath) || x.hidden?.some(o => o.room.path === filePath)) return;
    const base = roomIdOf(filePath);
    id = x.rooms.some(s => s.id === base) ? base + '-' + Date.now().toString(36) : base;
    // entra en la planta de repos por orden alfabético (las demás se corren lo que haga falta)
    x.rooms = distribute([...x.rooms, { id, type: isWing ? 'coordinacion' : 'repo', name: isWing ? wingName(x.rooms, filePath) : path.basename(filePath), path: filePath, floor: 0, side: 'izq', orden: 0, variant: STYLE_PALETTE[roomStyle(filePath, type)], style: roomStyle(filePath, type), area: areaByType(type) }]);
    // el recluta: el que viene de la puerta, o uno nuevo con el aspecto menos visto del refugio
    const card = dweller && typeof dweller === 'object' && dweller.name ? dweller : generateRecruit(Date.now() % 1e9, x.dwellers.map(h => h.name.toLowerCase()), false, x.dwellers.map(h => h.type));
    const h = cleanDweller({ ...card, roomId: id });
    if (h) { if (x.dwellers.some(o => o.id === h.id)) h.id += '-' + Date.now().toString(36); x.dwellers.push(h); }
    x.dwellers = tonesForRepeated(x.dwellers);   // si repite modelo, otro tono desde ya (no al siguiente arranque)
  });
  if (id) repos[id] = info;
  return id;
}
// retira una sala de repo (ya comprobado que nadie trabaja en ella): cierra sus conversaciones y sus terminales
function removeRoom(sr: { id: string; path?: string }) {
  closeRoom(sr);
  store.change(x => { x.rooms = distribute(x.rooms.filter(s => s.id !== sr.id)); x.dwellers = x.dwellers.filter(h => h.roomId !== sr.id); });
  delete repos[sr.id];
}
// cierra las conversaciones, las terminales y el Remote Control de una sala que sale del juego (retirada u oculta)
function closeRoom(sr: { id: string; path?: string }) {
  for (const sess of sessions.list()) if (sess.roomId === sr.id) sessions.close(sess.id);
  // las terminales abiertas dentro de su carpeta se cierran con ella (no quedan shells invisibles)
  if (sr.path) for (const t of terminals.openSessions()) if (t.cwd === sr.path || t.cwd.startsWith(sr.path + path.sep)) terminals.close(t.id);
  controlRemoto.shutDown(sr.id);
}
// La raíz de repos recién elegida (bienvenida o cámara acorazada): entra cada repo de git de primer nivel (y las alas,
// carpetas con varios repos dentro) y se retiran las salas de repo de fuera de ella, salvo con alguien trabajando.
// Con la raíz en el hogar o en / no se toca nada (son demasiado amplias: ahí, la Puerta sugiere)
// las carpetas que ya tienen sala, a la vista u oculta (ni la raíz ni la Puerta las vuelven a proponer)
const takenFolders = (e: typeof store.state) => [...e.rooms.map(s => s.path), ...(e.hidden ?? []).map(o => o.room.path)].filter(Boolean) as string[];
async function takeRoot() {
  const e = store.state, root = reposRoot(e);
  if (root === os.homedir() || root === path.parse(root).root || !existsSync(root)) return;
  const busy = (id: string) => sessions.list().some(s => s.roomId === id && ['arrancando', 'trabajando', 'esperando'].includes(s.state));
  const outside = e.rooms.filter(s => (s.type === 'repo' || s.type === 'coordinacion') && s.id !== PLANNING_ROOM && s.path && !s.path.startsWith(root + path.sep) && !busy(s.id));
  for (const sr of outside) { removeRoom(sr); await throwCloneOfExample(sr.path); }
  // las ocultas de fuera de la nueva raíz se olvidan (como las retiradas); las de dentro siguen sin volver
  if (e.hidden?.some(o => !o.room.path?.startsWith(root + path.sep))) store.change(x => { x.hidden = x.hidden?.filter(o => o.room.path?.startsWith(root + path.sep)); });
  for (const c of suggestions(e.reposRoot, takenFolders(e))) {
    if (c.group || !c.isGit && ((await infoRepo(c.path)).subrepos?.length ?? 0) < 2) continue;
    try { await addRoom(c.path); } catch (err) { console.error(`No pude meter ${c.path} en el refugio:`, (err as Error).message); }
  }
  broadcast({ t: 'estado', state: store.state as any }); broadcast({ t: 'repos', repos });
}
async function refreshRepos() {
  const rooms = store.state.rooms.filter(s => s.path);
  await Promise.all(rooms.map(async s => { repos[s.id] = await infoRepo(s.path!); }));
  reviewCopies();
  // quién trabaja dentro de cada worktree (no se puede desechar con alguien dentro) y quién lo creó
  const authors = authorsWorktree();
  const stale = Object.keys(authors).filter(k => !existsSync(k) || !store.state.dwellers.some(h => h.id === authors[k]));
  if (stale.length) { for (const k of stale) delete authors[k]; store.save(); }
  for (const info of Object.values(repos)) for (const w of info.worktrees) {
    const s = sessions.list().find(x => x.state !== 'cerrada' && (x.cwd === w.path || x.cwd.startsWith(w.path + path.sep)));
    w.busy = s ? store.state.dwellers.find(h => h.id === s.dwellerId)?.name ?? 'alguien' : undefined;
    if (!w.main) w.author = authors[w.path] ?? s?.dwellerId;
  }
  broadcast({ t: 'repos', repos });
}
// `wts`: las rutas de los worktrees de cada sala, si se acaban de leer (si no, las del último repaso de los repos)
function visitors(wts?: Map<string, string[]>): Visitor[] {
  // las del propio refugio no son visitantes, tampoco las de antes de reiniciar el servidor (última de cada habitante)
  const own = new Set([...sessions.list().map(s => s.claudeId), ...store.state.dwellers.map(h => h.lastSession), ...ownIds].filter(Boolean));
  const out: Visitor[] = [];
  // en la carpeta de la sala y en cada uno de sus worktrees (cada uno es otro proyecto para Claude Code)
  const seen = new Set<string>();
  const live = liveSessions();
  const inGame = new Set(sessions.list().filter(s => s.state !== 'cerrada').map(s => s.claudeId).filter(Boolean));
  for (const s of store.state.rooms) {
    if (!s.path || s.type === 'puente') continue;
    const dirs = [s.path, ...(wts?.get(s.id) ?? (repos[s.id]?.worktrees ?? []).filter(w => !w.main).map(w => w.path))];
    // las abiertas ahora (aunque estén quietas) y las que han escrito hace poco (Claude Code sin ficha de sesión)
    for (const dir of dirs) for (const tr of [...live.filter(v => v.cwd === dir), ...recentTranscripts(dir)]) {
      // una abierta fuera ahora mismo es visitante aunque el refugio la llevara antes (salió a la superficie, se retomó
      // en la app de Claude): solo no lo es la que el refugio tiene abierta ahora
      const outside = 'cwd' in tr;
      if ((outside ? inGame : own).has(tr.id) || seen.has(tr.id)) continue;
      seen.add(tr.id);
      out.push({ claudeId: tr.id, roomId: s.id, cwd: dir, title: t('server.sessionInATerminal'), modified: tr.modified, ...(dir !== s.path ? { worktree: dir } : {}) });
    }
  }
  return out;
}
setInterval(() => { refreshRepos().catch(() => {}); }, 20_000).unref();
// limpieza de adjuntos de más de una semana
attachments.clean();
// and of the compares whose task is finished or that are over two weeks old (compare.ts)
cleanCompares().catch(() => {});
setInterval(() => { cleanCompares().catch(() => {}); }, 5 * 60_000).unref();
setInterval(() => broadcast({ t: 'visitantes', visitors: visitors() }), 15_000).unref();
// las sesiones terminadas, leídas y quietas media hora se cierran solas (la conversación queda para retomarla)
// y nunca hay más de 12 procesos de Claude Code vivos: se cierran las terminadas más antiguas (aunque no se hayan leído).
// Nunca las que el Supervisor tiene a la vista o con algo escrito en su intercomunicador (enUso): se le cerraban
// mientras escribía una respuesta larga. Those of a worktree already removed close as soon as they are idle and read
const inUse = new Map<WebSocket, Set<string>>();
setInterval(() => {
  const used = new Set([...inUse.values()].flatMap(x => [...x]));
  for (const id of orphanedConversations(sessions.list(), used, existsSync, reviewsRoot())) sessions.close(id);
  for (const s of sessions.list()) if ((s.state === 'terminada' || s.state === 'ociosa') && !s.unread && !used.has(s.id) && Date.now() - s.updated > 30 * 60_000) sessions.close(s.id);
  const still = sessions.list().filter(s => (s.state === 'terminada' || s.state === 'ociosa' || s.state === 'error') && !used.has(s.id)).sort((a, b) => a.updated - b.updated);
  const live = sessions.list().filter(s => s.state !== 'cerrada').length;
  for (const s of still.slice(0, Math.max(0, live - 12))) sessions.close(s.id);
}, 60_000).unref();

// avisos que preguntan sí o no al Supervisor (protocolo: NoticeQuestion): se quedan a la vista hasta contestarlos y la
// respuesta llega con la acción aviso.responder. Si el servidor se reinicia antes, la pregunta se pierde (no se hace nada)
const questions = new Map<string, (si: boolean) => Promise<void>>();
function ask(text: string, buttons: { si: string; no: string }, answer: (si: boolean) => Promise<void>) {
  const id = randomUUID();
  questions.set(id, answer);
  broadcast({ t: 'aviso', level: 'aviso', text, question: { id, ...buttons } });
}

// un mensaje a la conversación de una sala en una carpeta (su copia principal o un worktree): la abierta ahí; si no, se
// retoma la última de ahí (si no sigue abierta fuera) o se empieza una
async function sendToFolder(roomId: string, cwd: string, text: string, permissions: 'plan') {
  const h = store.state.dwellers.find(x => x.roomId === roomId); if (!h) return false;
  const open = openInFolder(roomId, cwd);
  if (open) return ctxPlan.notify(open.id, text);
  if (await resumeInFolder(roomId, cwd, text, permissions)) return true;
  await startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId, prompt: text, options: { cwd: path.resolve(cwd), permissions } });
  return true;
}
const openInFolder = (roomId: string, cwd: string) => sessions.list().find(x => x.state !== 'cerrada' && x.roomId === roomId && path.resolve(x.worktree ?? x.cwd) === path.resolve(cwd));
// the last conversation in a folder resumed with `texto` (none still open outside the game, and never an old fork): its id,
// or none if there is no such conversation
async function resumeInFolder(roomId: string, cwd: string, text: string, permissions: 'plan' | 'auto'): Promise<string | undefined> {
  const h = store.state.dwellers.find(x => x.roomId === roomId); if (!h) return undefined;
  const dir = path.resolve(cwd), outside = outsideOpen();
  const previous = (await sessions.history(dir).catch(() => [])).filter(x => (!x.cwd || path.resolve(x.cwd) === dir) && !x.fork && !outside.has(x.claudeId.toLowerCase())).sort((a, b) => b.modified - a.modified)[0];
  return previous && startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId, prompt: text, options: { cwd: dir, permissions, resume: previous.claudeId } });
}

// las revisiones de tus PR (prReviews.ts), cada minuto con GitHub conectado: a la conversación de la rama del PR
const remote = new Map<string, string | undefined>();
const roomRepo = (filePath: string) => remote.has(filePath) ? Promise.resolve(remote.get(filePath))
  : new Promise<string | undefined>(ok => execFile('git', ['-C', filePath, 'remote', 'get-url', 'origin'], { timeout: 6000, env: gitEnvironment() }, (err, out) => { const r = err ? undefined : remoteRepo(String(out)); if (!err) remote.set(filePath, r); ok(r); }));
// las salas de repo git, con sus worktrees (and the branches each one had: a PR goes to the worktree that made it) y su
// repo de GitHub (owner/nombre)
const repoRooms = () => Promise.all(store.state.rooms.filter(s => s.type === 'repo' && s.path && repos[s.id]?.isGit).map(async s => ({
  id: s.id, name: s.name, path: s.path!, branch: repos[s.id]?.branch, repo: await roomRepo(s.path!),
  worktrees: await Promise.all((repos[s.id]?.worktrees ?? []).map(async w => (w.main ? w : { ...w, visited: await branchesVisited(w.path) }))),
})));
const prReviews = new ReviewsPR(DATA, {
  connection: connectionGitHub,
  query: async token => JSON.parse(await (await import('./git.ts')).gh(['api', 'graphql', '-f', 'query=' + REVIEWS_QUERY], token)),
  rooms: repoRooms,
  sessions: () => sessions.list(),
  notify: notifyPR,
  // sin conversación abierta en el worktree de la tarea: se retoma la última de ahí o se empieza, en modo plan
  open: (roomId, cwd, text) => sendToFolder(roomId, cwd, text, 'plan'),
  delivered: (roomId, worktree, pr, events) => {
    broadcast({ t: 'mensajero', since: 'git', a: [roomId], reason: 'revision', worktree });
    // que se vea: si no estás mirando esa conversación, la entrega pasaba desapercibida
    const room = store.state.rooms.find(s => s.id === roomId)?.name ?? roomId, authors = [...new Set(events.map(e => e.author))].join(', ');
    broadcast({ t: 'aviso', level: 'info', text: t('server.newReviewDelivered', { authors, numero: pr.number, repo: pr.repo, sala: room, rama: pr.branch }) });
  },
  withoutConversation: text => broadcast({ t: 'aviso', level: 'info', text }),
});
setInterval(() => { prReviews.poll().catch(err => console.error('Revisiones de PR:', String((err as Error).message).split('\n')[0])); }, 60_000).unref();

// la CI que falla en tus PR (ciFailures.ts), cada minuto con GitHub conectado: una vez por PR y commit, a la conversación
// del worktree del PR (como las revisiones), con la clave de su tarea y los PR que esperan a ese
const roomRepoById = (id: string) => { const s = store.state.rooms.find(x => x.id === id); return s?.path ? roomRepo(s.path) : Promise.resolve(undefined); };
const ciFailures = new CIFailures(DATA, {
  connection: connectionGitHub,
  query: async token => JSON.parse(await (await import('./git.ts')).gh(['api', 'graphql', '-f', 'query=' + CI_QUERY], token)),
  log: async (repo, run, token) => (await import('./git.ts')).gh(['run', 'view', String(run), '-R', repo, '--log-failed'], token, 30_000),
  blockers: async prs => blockersBetween(prs, prBlockers.all(), await tasksOrder(plans.all(), roomRepoById)),
  rooms: repoRooms,
  sessions: () => sessions.list(),
  notify: notifyPR,
  open: (roomId, cwd, text) => sendToFolder(roomId, cwd, text, 'plan'),
  delivered: (roomId, worktree, pr, blocks) => {
    broadcast({ t: 'mensajero', since: 'git', a: [roomId], reason: 'ci', worktree });
    const room = store.state.rooms.find(s => s.id === roomId)?.name ?? roomId, key = pRKey(pr);
    broadcast({ t: 'aviso', level: 'aviso', text: t('server.ciFailureDelivered', {
      clave: key ? `[${key}] ` : '', numero: pr.number, repo: pr.repo, sala: room, rama: pr.branch, checks: pr.failures.map(f => f.name).slice(0, 3).join(', ') || 'CI',
      bloquea: blocks.length ? t('server.ciFailureBlocks', { prs: blocks.join(', ') }) : '',
    }) });
  },
  withoutConversation: text => broadcast({ t: 'aviso', level: 'info', text }),
});
setInterval(() => { ciFailures.poll().then(() => scheduled.sweep()).catch(err => console.error('Fallos de CI:', String((err as Error).message).split('\n')[0])); }, 60_000).unref();

// mensajes programados (scheduled.ts): cada minuto, lo vencido a su conversación (abierta o retomada en su carpeta,
// en modo plan) o a su sala como send_to_room. El primer repaso, cuando ya se han leído los worktrees de las salas
const scheduled: Scheduled = new Scheduled(DATA, {
  session: id => sessions.list().find(s => s.id === id),
  busy: d => busyState(sessions.list().find(s => s.state !== 'cerrada' && ((d.sessionId && s.id === d.sessionId) || (d.claudeId && s.claudeId === d.claudeId)))?.state),
  rooms: () => ctxRooms.rooms(),
  toConversation: async (x, text) => {
    const d = x.target;
    const open = sessions.list().find(s => s.state !== 'cerrada' && ((d.claudeId && s.claudeId === d.claudeId) || (!d.claudeId && s.id === d.sessionId)));
    let id: string;
    // straight in (not ctxPlan.notify, which would hold it again): scheduled.ts only delivers when it may
    if (open) { sessions.deliver(open.id, text, x.from ?? { kind: 'scheduled' }); id = open.id; }
    else {
      const room = store.state.rooms.find(s => s.id === d.roomId), h = store.state.dwellers.find(y => y.roomId === d.roomId);
      if (!room || !h) throw new Error(t('server.scheduledNoDweller'));
      // si su worktree ya no está, en la carpeta de la sala y sin retomar (la conversación era de otra carpeta)
      const cwd = existsSync(d.cwd) ? d.cwd : folderOf(room);
      // background work the Overseer left is their own job (the intercom's default mode); a dweller's own reminder, in plan mode
      id = await startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: room.id, prompt: text, options: { cwd, permissions: x.overseer || x.from?.kind === 'room' ? 'auto' : 'plan', resume: cwd === d.cwd ? d.claudeId : undefined } });
    }
    // one that waited for a turn to end was already announced when sent: it just goes in
    if (x.from) return id;
    const room = store.state.rooms.find(s => s.id === d.roomId);
    broadcast({ t: 'entrega', room: d.roomId, sessionId: id, ...(room && path.resolve(d.cwd) !== path.resolve(folderOf(room)) ? { worktree: d.cwd } : {}) });
    broadcast({ t: 'aviso', level: 'info', text: t('server.scheduledDelivered', { sala: room ? roomNameIs(room) : d.roomId, resumen: summary(x.message) }) });
    return id;
  },
  toRoom: (x, text) => sendToRoom(ctxRooms, x.origin.roomId, { room: x.target.room, key: x.target.key, thread: x.target.thread, message: text }, x.origin.sessionId, { scheduled: true }),
  wake: at => { setTimeout(() => { scheduled.sweep().catch(() => {}); }, Math.max(0, at - Date.now()) + 1_000).unref(); },
  changed: list => broadcast({ t: 'programados', list }),
  notice: text => broadcast({ t: 'aviso', level: 'aviso', text }),
  usage: () => usage,
  settled: prSettled,
});
setTimeout(() => {
  const sweep = () => { scheduled.sweep().catch(err => console.error('Mensajes programados:', String((err as Error).message).split('\n')[0])); };
  sweep(); setInterval(sweep, 60_000).unref();
}, 15_000).unref();

// conversations stopped by the usage limit (limitResume.ts): resumed one at a time once it renews, in their folder by
// Claude Code id if they are no longer open. Never with more permissions than they had
const SAFE_MODES = ['auto', 'default', 'acceptEdits', 'plan'];
const limitResumes: LimitResumes = new LimitResumes(DATA, {
  resume: async (x, text) => {
    const open = sessions.list().find(s => s.state !== 'cerrada' && s.claudeId === x.claudeId);
    if (open) {
      if (!open.limit) return 'gone';   // the Overseer already continued it
      if (!ctxPlan.notify(open.id, text)) throw new Error(t('server.thatConversationIsStillOpen'));
      return 'ok';
    }
    if (!existsSync(x.cwd)) return 'gone';
    const roomId = x.roomId && store.state.rooms.some(r => r.id === x.roomId) ? x.roomId : pathRoom(x.cwd);
    const room = store.state.rooms.find(r => r.id === roomId);
    const h = store.state.dwellers.find(y => y.id === x.dwellerId && y.roomId === roomId) ?? store.state.dwellers.find(y => y.roomId === roomId);
    if (!room || !h) return 'gone';
    const id = await startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: room.id, prompt: text, options: { cwd: x.cwd, resume: x.claudeId, permissions: SAFE_MODES.includes(x.permissions ?? '') ? x.permissions : 'auto', model: x.model, effort: x.effort } });
    broadcast({ t: 'entrega', room: room.id, sessionId: id, ...(path.resolve(x.cwd) !== path.resolve(folderOf(room)) ? { worktree: x.cwd } : {}) });
    return 'ok';
  },
  changed: list => { for (const x of list) sessions.limitAt(x.claudeId, x.resumeAt); },
  notice: text => broadcast({ t: 'aviso', level: 'info', text }),
});
sessions.on('paradaLimite', (r: SessionSummary & { stoppedAt: number }) => {
  if (!r.claudeId || !r.limit) return;
  limitResumes.add({ claudeId: r.claudeId, cwd: path.resolve(r.worktree ?? r.cwd), roomId: r.roomId, dwellerId: r.dwellerId, title: r.title, permissions: r.permissionMode, model: r.model, effort: r.effort, stoppedAt: r.stoppedAt, resetsAt: r.limit.resetsAt });
});
sessions.on('limiteSigue', (claudeId: string) => limitResumes.drop(claudeId));
sessions.on('limite', (i: any) => { if (stopsWork(i)) limitResumes.hold(resetMs(i.resetsAt) ?? Date.now() + UNKNOWN_RESET_MS); });
// on start, once the rooms' worktrees are read: conversations whose transcript ends in a limit stop (stopped before
// this existed, or with the queue lost) join the queue; then a round every half minute
setTimeout(() => {
  const folders = store.state.rooms.flatMap(r => [folderOf(r), ...(r.path ? (repos[r.id]?.worktrees ?? []).map(w => w.path) : [])]);
  const outside = outsideOpen(), live = new Set(sessions.list().map(s => s.claudeId));
  const found = scanStopped(folders).filter(f => !limitResumes.has(f.claudeId) && !live.has(f.claudeId) && !outside.has(f.claudeId.toLowerCase()));
  for (const f of found) limitResumes.add({ claudeId: f.claudeId, cwd: f.cwd, roomId: pathRoom(f.cwd), stoppedAt: f.at, resetsAt: f.resetsAt ?? f.at + UNKNOWN_RESET_MS, permissions: f.permissions });
  const first = limitResumes.list()[0];
  if (found.length && first) broadcast({ t: 'aviso', level: 'info', text: t('server.limitFound', { n: limitResumes.list().length, cuando: new Date(first.resumeAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) });
  const sweep = () => { limitResumes.sweep().catch(err => console.error('Reanudar tras el límite:', String((err as Error).message).split('\n')[0])); };
  sweep(); setInterval(sweep, 30_000).unref();
}, 20_000).unref();

// el pre-flight de una tarea (preflight.ts): sus partes en todas las salas, con sincronía, CI, revisión y bloqueos.
// Solo lectura; los PR de GitHub, a lo sumo una lectura por minuto (R en la ventana fuerza otra)
const prsPreflight = cachedPRs(async () => {
  const G = await import('./git.ts'), c = await connectionGitHub();
  const [recent, open] = await Promise.all([G.prsBoard(c), G.prsOpen(c).catch(() => ({ prs: [] as PRBoard[] }))]);
  const byUrl = new Map([...recent.prs, ...open.prs].map(p => [p.url, p]));
  return { prs: [...byUrl.values()], demo: recent.demo, error: recent.error };
});
// la lista «antes de subir» del Supervisor (ajustes.checklistPreflight, en la cámara acorazada): la primera vez se toma
// de la sección «Before pushing» de su ~/.claude/CLAUDE.md, una sola vez; luego es suya y se edita en el juego
function checklistItems(): string[] {
  const a = store.state.settings as any;
  if (!Array.isArray(a.checklistPreflight)) {
    let text = ''; try { text = readFileSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'), 'utf8'); } catch {}
    a.checklistPreflight = checklistFromClaudeMd(text); store.save();
  }
  return (a.checklistPreflight as unknown[]).filter((x): x is string => typeof x === 'string');
}
// lo que el Supervisor hace con las páginas de comparación (validarlas o mandarles notas), atado a su commit
const pageReviews = new PageReviews(DATA, COMPARES_FOLDER);
const ctxPreflight: CtxPreflight = {
  prs: prsPreflight,
  // and the ones naming the task at any age: a task merged weeks ago is out of the board's two weeks
  taskPrs: cachedTaskPRs(async key => (await import('./git.ts')).prsOfTask(await connectionGitHub(), key)),
  // worktrees read live: repos[] refreshes every 20 s, and one made and pushed in between would escape the push gate
  rooms: async () => Promise.all((await repoRooms()).map(async s => {
    const live = await worktreeList(s.path).catch(() => []);
    return live.length ? { ...s, worktrees: live } : s;
  })),
  manual: () => prBlockers.all(),
  orden: () => tasksOrder(plans.all(), roomRepoById),
  verification: key => verifications.get(key),
  tracker: key => { const p = verifications.get(key); return taskTracker(ctxTrackers, key, !!p && finalCheckpoint(p)?.state === 'evidenced'); },
  plan: key => plans.get(key)?.parts.map(x => ({ roomId: x.roomId, room: x.room, title: x.title, waitA: x.waitA })),
  color: key => taskColors.colors([key])[key],
  compares: () => pageReviews.compares(),
  reviews: url => ({ ledger: prReviews.ledgerOf(url), threads: prReviews.threadsOf(url) }),
  ciChecks: url => ciFailures.checksOf(url),
  checklist: () => ({ items: checklistItems(), answers: key => pageReviews.checklistOf(key) }),
  git: (cwd, args) => new Promise((ok, fail) => execFile('git', ['-C', cwd, ...args], { timeout: 15_000, env: gitEnvironment() }, (err, o, e) => err ? fail(new Error(String(e || err.message).trim())) : ok(String(o)))),
};
// las del habitante (preflight_status, preflight_answer) y la puerta de `git push` de sus conversaciones
// production verification (verifications.ts): every five minutes, open what merged and keep the rechecks scheduled
const sweepVerifications = () => verifications.sweep({
  prs: async (key, plan) => {
    const [all, taskPrs] = await Promise.all([prsPreflight(false), ctxPreflight.taskPrs!(key, false).catch(() => [] as PRBoard[])]);
    const refs = new Set(plan.points.map(c => c.pr).filter(Boolean));
    return [...new Map([...taskPrs, ...all.prs].map(p => [p.url, p])).values()]
      .filter(p => p.state !== 'cerrado' && (pRTask(p) === key || refs.has(prRef(`${p.repo}#${p.number}`))))
      .map(p => ({ ref: prRef(`${p.repo}#${p.number}`)!, merged: p.state === 'fusionado' }));
  },
  inProdCheck: async key => !!(await taskTracker(ctxTrackers, key))?.inProdCheck,
  schedule: (c, when, message) => scheduled.scheduleGame(c, when, message),
  pending: id => scheduled.pending(id),
  cancel: id => { scheduled.cancel(id); },
  notify: (text, level) => broadcast({ t: 'aviso', level, text }),
}).catch(err => console.error('Verificaciones:', String((err as Error).message).split('\n')[0]));
setTimeout(() => { sweepVerifications(); setInterval(sweepVerifications, 5 * 60_000).unref(); }, 30_000).unref();
// once per start: Jira's pair set up if it never was, and what is still without a prod-check status
setTimeout(() => {
  startupNotices(ctxTrackers).then(l => { for (const text of l) broadcast({ t: 'aviso', level: 'info', text }); }).catch(() => {});
}, 90_000).unref();
const preflightToolset = preflightTools(ctxPreflight, (key, worktree, head, item, a) => pageReviews.answer(key, worktree, head, item, a));

// las tareas con todos sus PR fusionados o cerrados (taskCleanup.ts), cada cinco minutos con GitHub conectado: el juego
// quita solo sus worktrees si no queda otro trabajo en ellos (si queda, avisa de qué), once a merged one is verified in production
const tasksCleanup = new TasksCleanup(DATA, {
  connection: connectionGitHub,
  prs: async c => {
    const G = await import('./git.ts');
    const [recent, open] = await Promise.all([G.prsBoard(c), G.prsOpen(c)]);
    if (recent.error) throw new Error(recent.error);
    // los abiertos de hace más de dos semanas no salen en el tablero: sin ellos, una tarea parecería terminada
    const byUrl = new Map([...recent.prs, ...open.prs].map(p => [p.url, p]));
    return [...byUrl.values()];
  },
  rooms: repoRooms,
  sessions: () => sessions.list(),
  scheduled: () => scheduled.list(),
  plans: () => verifications.states(),
  noPlan: (roomId, task, w, key, plan, session, skip) => {
    const room = store.state.rooms.find(s => s.id === roomId)?.name ?? roomId;
    // to the conversation that proposed the plan, else the latest in the worktree, else a new one there
    const c = plan?.conversation ?? (session ? { roomId, sessionId: session.id, claudeId: session.claudeId, cwd: path.resolve(session.worktree ?? session.cwd), title: session.title } : { roomId, cwd: path.resolve(w.path) });
    scheduled.scheduleGame(c, Date.now(), t(plan ? 'prompt.verification.cleanupUnapproved' : 'prompt.verification.cleanupNoPlan', { clave: key }));
    ask(t(plan ? 'server.cleanupUnapproved' : 'server.cleanupNoPlan', { tarea: key, sala: room, nombre: path.basename(w.path) }), { si: t('server.cleanupSkipVerification'), no: t('server.cleanupWaitVerification') }, async si => {
      if (!si) return;
      skip();
      tasksCleanup.poll().catch(err => console.error('Limpieza de tareas:', String((err as Error).message).split('\n')[0]));
    });
  },
  git: (cwd, args) => new Promise((ok, fail) => execFile('git', ['-C', cwd, ...args], { timeout: 60_000, env: gitEnvironment() }, (err, o, e) => err ? fail(new Error(String(e || err.message).trim())) : ok(String(o)))),
  trash: async paths => (await import('./files.ts')).toTrash(paths),
  removed: (roomId, task, w, loose) => {
    const room = store.state.rooms.find(s => s.id === roomId)?.name ?? roomId;
    const text = t('server.cleanupRemoved', { tarea: task.task, sala: room, nombre: path.basename(w.path), rama: w.branch || '—' });
    broadcast({ t: 'aviso', level: 'info', text: loose ? `${text} ${t('server.cleanupTrashed', { n: loose })}` : text });
  },
  ask: (roomId, task, w, what, remove) => {
    const room = store.state.rooms.find(s => s.id === roomId)?.name ?? roomId;
    const text = what.map(x => x.type === 'conversacion' ? t('server.cleanupLeftOpen') : t(x.type === 'cambios' ? 'server.cleanupLeftChanges' : x.type === 'stash' ? 'server.cleanupLeftStash' : x.type === 'programados' ? 'server.cleanupLeftScheduled' : 'server.cleanupLeftCommits', { n: x.n })).join(', ');
    ask(t('server.cleanupLeft', { tarea: task.task, sala: room, ruta: w.path, que: text }), { si: t('server.cleanupRemoveAnyway'), no: t('server.cleanupKeep') }, async si => {
      if (!si) return;
      const r = await remove().catch(e => { broadcast({ t: 'aviso', level: 'error', text: t('server.cleanupCouldNot', { ruta: w.path, error: String((e as Error).message).split('\n')[0].slice(0, 160) }) }); return undefined; });
      if (r === 'esperando') broadcast({ t: 'aviso', level: 'info', text: t('server.cleanupWhenClosed', { ruta: w.path }) });
    });
  },
  changed: () => { refreshRepos().catch(() => {}); },
});
setInterval(() => { tasksCleanup.poll().catch(err => console.error('Limpieza de tareas:', String((err as Error).message).split('\n')[0])); }, 5 * 60_000).unref();

// the Review room (reviewRoom.ts): others' PRs that ask for the Overseer's review, every minute with GitHub connected;
// each review opened has its folder (its worktrees, hidden from the repos' rooms) and its conversation in the room
const reviewsRoot = () => { const s = store.state.rooms.find(x => x.id === REVIEW_ROOM); return s ? folderOf(s) : path.join(DATA, 'salas', REVIEW_ROOM); };
hideWorktreesUnder([reviewsRoot()]);
let reviewState: { state: ReviewBoard['state']; error?: string } = { state: 'reading' };
const reviewBoard = (): ReviewBoard => ({ ...reviewState, reviews: reviewState.state === 'ok' ? reviewRoom.reviews() : [] });
// the started reviews stand in the Review room as holograms: their folders, as that room's worktrees
function reviewCopies() {
  const lupe = store.state.dwellers.find(h => h.roomId === REVIEW_ROOM)?.id;
  repos[REVIEW_ROOM] = { path: reviewsRoot(), exists: true, isGit: false, changes: 0, type: 'generico',
    worktrees: reviewRoom.startedReviews().filter(r => existsSync(r.folder)).map(r => ({ path: r.folder, branch: '', main: false, changes: 0, advanced: 0, author: lupe, review: { key: r.key, title: r.title, repos: r.repos } })) };
}
const reviewRoom = new ReviewRoom(DATA, {
  connection: connectionGitHub,
  query: async token => JSON.parse(await (await import('./git.ts')).gh(['api', 'graphql', '-f', 'query=' + REVIEW_ROOM_QUERY], token)),
  rooms: async () => (await repoRooms()).map(r => ({ id: r.id, path: r.path, repo: r.repo })),
  root: reviewsRoot,
  git: (cwd, args) => new Promise((ok, fail) => execFile('git', ['-C', cwd, ...args], { timeout: 120_000, env: gitEnvironment() }, (err, o, e) => err ? fail(new Error(String(e || err.message).trim())) : ok(String(o)))),
  sessions: () => sessions.list(),
  open: async (folder, text, tell) => {
    const o = openInFolder(REVIEW_ROOM, folder);
    if (o) { if (tell) ctxPlan.notify(o.id, text); return o.id; }
    const resumed = await resumeInFolder(REVIEW_ROOM, folder, text, 'auto');
    if (resumed) return resumed;
    const h = store.state.dwellers.find(x => x.roomId === REVIEW_ROOM);
    if (!h) throw new Error(t('panels.theRoomSalaHasNo', { sala: t('world.review') }));
    return startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: REVIEW_ROOM, prompt: text, options: { cwd: folder, permissions: 'auto' } });
  },
  tell: async (folder, text) => {
    const o = openInFolder(REVIEW_ROOM, folder);
    if (o) return ctxPlan.notify(o.id, text);
    return !!(await resumeInFolder(REVIEW_ROOM, folder, text, 'auto'));
  },
  jira: async key => {
    if (!ctxTrackers.connected('jira')) return undefined;
    const x: any = await integrations.action('tarea', { source: 'jira', key });
    return x?.title ? { title: x.title, status: x.state, epic: x.epic ? `${x.epic.key} ${x.epic.title}` : undefined, description: x.description } : undefined;
  },
  trash: async paths => (await import('./files.ts')).toTrash(paths),
  ask: (text, yes) => ask(text, { si: t('reviews.removeAnyway'), no: t('reviews.keep') }, async si => { if (si) await yes().catch(e => broadcast({ t: 'aviso', level: 'error', text: String((e as Error).message).split('\n')[0] })); }),
  notice: text => broadcast({ t: 'aviso', level: 'info', text }),
  changed: () => { reviewCopies(); broadcast({ t: 'revisiones', board: reviewBoard() }); broadcast({ t: 'repos', repos }); },
});
async function pollReviews() {
  const c = await connectionGitHub();
  if (!c.real) { if (reviewState.state !== 'off') { reviewState = { state: 'off' }; broadcast({ t: 'revisiones', board: reviewBoard() }); } return; }
  try { await reviewRoom.poll(); reviewState = { state: 'ok' }; }
  catch (err) { reviewState = { state: reviewRoom.ready ? 'ok' : 'error', error: String((err as Error).message).split('\n')[0].slice(0, 200) }; console.error('Review room:', reviewState.error); }
  broadcast({ t: 'revisiones', board: reviewBoard() });
}
setTimeout(() => { pollReviews().catch(() => {}); }, 5_000).unref();
setInterval(() => { pollReviews().catch(() => {}); }, 60_000).unref();

// the work log and trophies (workLog.ts): every minute the rooms' worktrees and the conversations, every five also
// what Jira and GitHub already gave the boards, merged into DATOS/bitacora.json; read by the Sync update panel (Planning)
// and the trophies' panel and shelf (Vault)
const workLog = new WorkLog(DATA, path.join(ROOT, 'docs', 'ladder.example.json'));
const workLogSources: WorkLogSources = {
  jira: async () => integrations.action('panel', { source: 'jira' }) as any,   // off: it throws, and the sweep skips it
  prs: async () => prsPreflight(false),
  worktrees: () => {
    const rooms = store.state.rooms.filter(s => s.type === 'repo' && repos[s.id]?.isGit);
    return { rooms: rooms.map(s => s.id), live: rooms.flatMap(s => (repos[s.id]?.worktrees ?? []).filter(w => !w.main).map(w => ({ path: w.path, roomId: s.id, branch: w.branch || undefined }))) };
  },
  sessions: () => sessions.list().filter(s => s.roomId !== REVIEW_ROOM),
  reviews: () => reviewState.state === 'ok' ? reviewRoom.reviews().flatMap(r => r.prs) : null,
  verified: () => Object.entries(verifications.states()).filter(([, p]) => finalCheckpoint(p)?.state === 'evidenced').map(([k]) => k),
  notify: text => broadcast({ t: 'aviso', level: 'info', text }),
};
let workLogRound = 0;
const sweepWorkLog = () => {
  workLog.sweep(workLogSources, workLogRound++ % 5 === 0).then(() => {
    // the Friday digest: one conversation a week with the dweller of the ladder's digestRoom (Planning by default), which proposes medals with award_propose
    const room = workLog.digestRoom(), h = store.state.dwellers.find(x => x.roomId === room);
    const prompt = h ? workLog.digest() : undefined;
    if (prompt && h) startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: room, prompt, options: { permissions: 'auto' } }).catch(err => console.error('Medallas:', String((err as Error).message).split('\n')[0]));
  }).catch(err => console.error('Bitácora:', String((err as Error).message).split('\n')[0]));
};
setTimeout(() => { sweepWorkLog(); setInterval(sweepWorkLog, 60_000).unref(); }, 45_000).unref();

// organizar las salas por tareas (organize.ts): el plan de cada sala de repo y, confirmado, hacerlo
async function organizeRooms(roomId: string | undefined, apply: boolean) {
  const G = await import('./git.ts');
  const { prs, demo } = await G.prsOpen(await connectionGitHub());
  if (apply && demo) throw new Error(t('server.withoutGithubConnectedDemoThere'));
  const rooms = store.state.rooms.filter(s => s.type === 'repo' && s.path && repos[s.id]?.isGit && (!roomId || s.id === roomId));
  const out: { roomId: string; room: string; repo?: string; steps: { task: string; prs: string[]; where: string; create: boolean; main: boolean; conversation: boolean }[]; done?: string[] }[] = [];
  for (const s of rooms) {
    const repo = await roomRepo(s.path!);
    // en DEMO los repos inventados (refugio/express) caen en la sala de su nombre
    const theirs = prs.filter(p => repo && (p.repo.toLowerCase() === repo || (demo && p.repo.split('/').pop()!.toLowerCase() === repo.split('/').pop())));
    const groups = groupByTask(theirs);
    if (!groups.length) { out.push({ roomId: s.id, room: s.name, repo, steps: [] }); continue; }
    const info = repos[s.id]!;
    const steps = roomPlan({ path: s.path!, branch: info.branch, worktrees: info.worktrees }, groups, sessions.list());
    const row = { roomId: s.id, room: s.name, repo, steps: steps.map(p => ({ task: p.group.key ?? `PR #${p.group.prs[0].number}`, prs: p.group.prs.map(x => `#${x.number} ${x.title}`), where: path.basename(p.path), create: p.create, main: p.main, conversation: !!p.session })) } as (typeof out)[number];
    if (apply) {
      const h = store.state.dwellers.find(x => x.roomId === s.id);
      const live = () => sessions.list().filter(x => ['arrancando', 'trabajando', 'esperando'].includes(x.state)).length;
      row.done = h ? await applyPlan({
        git: (cwd, args) => new Promise((ok, fail) => execFile('git', ['-C', cwd, ...args], { timeout: 60_000, env: gitEnvironment() }, (err, o, e) => err ? fail(new Error(String(e || err.message).trim())) : ok(String(o)))),
        start: (id, cwd, prompt) => startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: id, prompt, options: { cwd, permissions: 'plan' } }),
      }, { id: s.id, path: s.path! }, steps, repo ?? s.name, () => store.state.sessionLimit - live()) : [t('server.theRoomHasNoDweller')];
    }
    out.push(row);
  }
  if (apply) await refreshRepos().catch(() => {});
  return { demo, rooms: out };
}

// ---------------------------------------------------------------- acciones (peticiones con respuesta)
// a dweller's `claude` by the Claude session it resumes (server/runningThings.ts: those started before the mark)
const sessionOfClaude = (claudeId: string) => sessions.list().find(s => s.claudeId === claudeId)?.id;
async function action(name: string, d: Record<string, any> = {}): Promise<unknown> {
  const e = store.state;
  switch (name) {
    case 'sugerencias': return suggestions(e.reposRoot, takenFolders(e));
    // «From GitHub…»: your repos (with the integration connected) and where each one is already cloned
    case 'github.repos': {
      const c = await ghConnected(), already = clonedRepos(expand(e.reposRoot), [...e.rooms, ...(e.hidden ?? []).map(o => o.room)]);
      const mark = <T extends { repo: string }>(r: T) => ({ ...r, cloned: already.get(r.repo.toLowerCase()) });
      if (!c.gh) return { off: true, repos: [] };
      try { return { repos: (await listRepos(c.gh)).map(mark) }; }
      catch (err) { return { error: (err as Error).message, repos: [] }; }
    }
    case 'github.repo': {
      const repo = repoRef(String(d.text ?? ''));
      if (!repo) throw new Error(t('server.githubRepoBadRef'));
      const c = await ghConnected(), already = clonedRepos(expand(e.reposRoot), [...e.rooms, ...(e.hidden ?? []).map(o => o.room)]);
      // without the integration the repo isn't checked: git clone says if it doesn't exist or you can't read it
      const info = c.gh ? await repoInfo(c.gh, repo) : { repo, name: repo.split('/')[1], isPrivate: false, archived: false, description: '', pushed: 0 };
      return { ...info, cloned: already.get(info.repo.toLowerCase()) };
    }
    case 'github.clonar': {
      const repo = repoRef(String(d.repo ?? ''));
      if (!repo) throw new Error(t('server.githubRepoBadRef'));
      const target = cloneDestination(expand(String(d.path ?? '')), expand(e.reposRoot), takenFolders(e));
      const protocol = await (await import('./git.ts')).gh(['config', 'get', 'git_protocol', '-h', 'github.com']).catch(() => '');
      return clones.start(repo, target, cloneUrl(repo, protocol));
    }
    case 'github.clon': { const c = clones.check(String(d.id)); if (!c) throw new Error(t('server.cloneFailed')); return c; }
    case 'github.cancelar': return clones.cancel(String(d.id));
    case 'reclutar': {
      const filePath = path.resolve(expand(String(d.path || '')));
      if (filePath === path.parse(filePath).root || filePath === os.homedir()) throw new Error(t('server.thatFolderIsTooBroad'));
      if (!existsSync(filePath)) {
        if (!d.create) throw new Error(t('server.thatFolderDoesNotExist'));
        const root = path.resolve(expand(e.reposRoot));
        if (!filePath.startsWith(root + path.sep)) throw new Error(t('server.newFoldersInsideRoot', { raiz: e.reposRoot }));
        await createFolder(filePath, !!d.git);
      }
      if (takenFolders(e).includes(filePath)) throw new Error(t('server.thatFolderAlreadyHasA'));
      const id = await addRoom(filePath, d.dweller);
      if (!id) throw new Error(t('server.thatFolderAlreadyHasA'));
      broadcast({ t: 'estado', state: store.state as any }); broadcast({ t: 'repos', repos });
      return { id };
    }
    case 'retirarSala': {
      const sr = e.rooms.find(s => s.id === d.roomId);
      if (!sr) throw new Error(t('server.thatRoomDoesNotExist'));
      if ((sr.type !== 'repo' && sr.type !== 'coordinacion') || sr.id === PLANNING_ROOM) throw new Error(t('server.theShelterSServiceRooms'));
      // primero se comprueba (nada se corta) y luego se cierran las conversaciones terminadas de la sala
      if (sessions.list().some(s => s.roomId === d.roomId && ['arrancando', 'trabajando', 'esperando'].includes(s.state))) throw new Error(t('server.someoneIsWorkingInThat'));
      removeRoom(sr);
      broadcast({ t: 'estado', state: store.state as any }); broadcast({ t: 'repos', repos });
      await throwCloneOfExample(sr.path);
      return true;
    }
    // ocultar una sala de repo la saca del juego (la planta que se queda vacía desaparece) sin olvidarla: vuelve, con su
    // habitante y su escena, desde la cámara acorazada (Salas del refugio)
    case 'sala.ocultar': {
      const sr = e.rooms.find(s => s.id === d.roomId);
      if (!sr) throw new Error(t('server.thatRoomDoesNotExist'));
      if (!isHideable(sr)) throw new Error(t('server.serviceRoomsCannotBeHidden'));
      if (sessions.list().some(s => s.roomId === sr.id && ['arrancando', 'trabajando', 'esperando'].includes(s.state))) throw new Error(t('server.someoneIsWorkingInThatHide'));
      closeRoom(sr);
      store.change(x => { hideRoom(x, sr.id); });
      delete repos[sr.id];
      broadcast({ t: 'estado', state: store.state as any }); broadcast({ t: 'repos', repos });
      return true;
    }
    case 'sala.mostrar': {
      let done = false;
      store.change(x => { done = showRoom(x, String(d.roomId)); });
      if (!done) throw new Error(t('server.thatRoomDoesNotExist'));
      const sr = store.state.rooms.find(s => s.id === d.roomId);
      if (sr?.path) repos[sr.id] = await infoRepo(sr.path);
      broadcast({ t: 'repos', repos }); broadcast({ t: 'estado', state: store.state as any });
      return true;
    }
    // la sala pasa a otra carpeta (un repo tuyo): conserva su sitio, su habitante y su aspecto; la escena vuelve a la
    // plantilla de su nuevo tipo de repo (luego el habitante la puede adaptar)
    case 'vincularSala': {
      const sr = e.rooms.find(s => s.id === d.roomId);
      if (!sr || !isRoomOfRepo(sr.type)) throw new Error(t('server.onlyRepoRoomsCanBe'));
      if (sr.id === PLANNING_ROOM) throw new Error(t('server.theLogisticsRoomSFolder'));
      const filePath = path.resolve(expand(String(d.path || '')));
      if (filePath === path.parse(filePath).root || filePath === os.homedir()) throw new Error(t('server.thatFolderIsTooBroad'));
      if (!existsSync(filePath) || !statSync(filePath).isDirectory()) throw new Error(t('server.thatFolderDoesNotExist'));
      if (filePath === sr.path) throw new Error(t('server.thatIsAlreadyThisRoom'));
      if (takenFolders(e).includes(filePath)) throw new Error(t('server.thatFolderAlreadyHasA'));
      if (sessions.list().some(s => s.roomId === sr.id && ['arrancando', 'trabajando', 'esperando'].includes(s.state))) throw new Error(t('server.someoneIsWorkingInThat2'));
      for (const sess of sessions.list()) if (sess.roomId === sr.id) sessions.close(sess.id);
      const previous = sr.path;
      if (previous) for (const t of terminals.openSessions()) if (t.cwd === previous || t.cwd.startsWith(previous + path.sep)) terminals.close(t.id);
      controlRemoto.shutDown(sr.id);
      const type = projectType(filePath);
      const info = await infoRepo(filePath);
      const isWing = !info.isGit && (info.subrepos?.length ?? 0) > 1;
      store.change(x => {
        const s = x.rooms.find(y => y.id === sr.id); if (!s) return;
        const style = roomStyle(filePath, type);
        Object.assign(s, { path: filePath, name: isWing ? wingName(x.rooms.filter(y => y !== s), filePath) : path.basename(filePath), type: isWing ? 'coordinacion' : 'repo', style, variant: STYLE_PALETTE[style], area: areaByType(type) });
        delete s.decor;
        // su última conversación era de la otra carpeta: no se retoma aquí
        for (const h of x.dwellers) if (h.roomId === s.id) delete h.lastSession;
        x.rooms = distribute(x.rooms);
      });
      // primero los repos: la sala se vuelve a montar con la plantilla del tipo nuevo, no con la del anterior
      repos[sr.id] = info; broadcast({ t: 'repos', repos }); broadcast({ t: 'estado', state: store.state as any });
      await throwCloneOfExample(previous);
      return { id: sr.id };
    }
    // obras desde el plano: arrastrar una sala a un hueco (o a una planta nueva) o una planta entera a otra altura, o
    // volver a la disposición de serie
    case 'refugio.mover': {
      let done = false;
      store.change(x => {
        const fresh = d.roomId
          ? placeRoom(x.rooms, String(d.roomId), { floor: Number(d.floor), side: d.side === 'der' ? 'der' : 'izq', orden: Number(d.orden) || 0, newFloor: d.newFloor === true })
          : moveFloor(x.rooms, Number(d.from), Number(d.a));
        if (fresh) { x.rooms = fresh; done = true; }
      });
      if (!done) throw new Error(t('server.itCannotBeMovedThat'));
      broadcast({ t: 'estado', state: store.state as any });
      return true;
    }
    case 'refugio.disposicionDeSerie': { store.change(x => { x.rooms = defaultLayout(x.rooms); }); broadcast({ t: 'estado', state: store.state as any }); return true; }
    // idioma de los textos (shared/language.ts): el cliente lo elige en Opciones y el servidor lo usa en sus avisos
    case 'idioma': {
      if (!isLanguage(d.language)) throw new Error(t('server.unknownLanguage'));
      setLanguage(d.language); store.change(x => { x.language = d.language; });
      return true;
    }
    // el área de un repo (frontend, backend o crítico): su sector y su color
    case 'sala.area': {
      const sr = e.rooms.find(s => s.id === d.roomId);
      if (!sr || !isRoomOfRepo(sr.type) || sr.id === PLANNING_ROOM) throw new Error(t('server.onlyRepoRoomsHaveAn'));
      if (!isArea(d.area)) throw new Error(t('server.unknownArea'));
      store.change(x => { const s = x.rooms.find(y => y.id === sr.id); if (s) s.area = d.area; });
      broadcast({ t: 'estado', state: store.state as any });
      return true;
    }
    case 'sala.promptAdaptar': return adaptPrompt();
    case 'sala.quitarDecorado': { if (!ctxDecor.room(String(d.roomId))) throw new Error(t('server.thatRoomDoesNotExist')); ctxDecor.save(String(d.roomId), null); return true; }
    case 'abrirEn': return openIn(String(d.app), String(d.path));
    case 'guardar': {
      const before = { root: reposRoot(e), welcome: e.doneWelcome };
      store.change(x => applySettings(x, d.patch ?? {})); broadcast({ t: 'estado', state: store.state as any });
      // la raíz elegida (otra, o la de la bienvenida al entrar) trae sus repos
      if (reposRoot(store.state) !== before.root || (!before.welcome && store.state.doneWelcome)) await takeRoot();
      if (typeof d.patch?.reposRoot === 'string') refreshReposSoon();
      return true;
    }   // la sala de planificación cambia de carpeta con la raíz
    case 'aspecto.guardar': {
      // el aspecto que se elige en Chapa y Pintura: del Supervisor o de un habitante (la Octocat no se cambia)
      const a = d.look === null ? null : sanitizeLook(d.look);
      if (d.look !== null && !a) throw new Error(t('server.thatLookIsNotValid'));
      if (d.who === 'supervisor') store.change(x => { if (a) x.supervisor.look = a; else delete x.supervisor.look; });
      else {
        const h = e.dwellers.find(x => x.id === d.who); if (!h) throw new Error(t('server.thereIsNobodyWithThat'));
        if (h.type === 'Octocat') throw new Error(t('server.theOctocatIsWhatIt'));
        store.change(() => { if (a) { h.look = a; delete h.tone; } else delete h.look; });
      }
      broadcast({ t: 'estado', state: store.state as any });
      return true;
    }
    case 'reiniciarRefugio': { sessions.closeAll(); terminals.closeAll(); store.restart(); await refreshRepos(); broadcast({ t: 'estado', state: store.state as any }); return true; }
    // al abrir la lista de un visitante: al momento (con los worktrees al día), no la del último aviso (cada 15 s).
    // Solo `git worktree list`: el repaso entero de los repos (`git status` en cada uno) tardaba segundos en los grandes
    case 'visitantes': {
      const rooms = store.state.rooms.filter(s => s.path && s.type !== 'puente');
      const wts = new Map(await Promise.all(rooms.map(async s => [s.id, (await worktreeList(s.path!)).filter(w => !w.main).map(w => w.path)] as const)));
      const v = visitors(wts); broadcast({ t: 'visitantes', visitors: v }); return v;
    }
    // el buscador (⌘K): las últimas conversaciones de cada sala con habitante, juntas y de la más reciente a la más vieja
    case 'conversaciones.recientes': {
      const outside = outsideOpen();
      const lists = await Promise.all(e.rooms.map(async s => {
        const h = e.dwellers.find(x => x.roomId === s.id);
        if (!h) return [];
        const dir = folderOf(s);
        if (!existsSync(dir)) return [];
        try { return (await sessions.history(dir, 6)).map(x => ({ ...x, roomId: s.id, dwellerId: h.id, outside: outside.has(x.claudeId.toLowerCase()) && !x.inProgress })); } catch { return []; }
      }));
      return lists.flat().sort((a, b) => b.modified - a.modified).slice(0, Math.min(40, Number(d.limit) || 20));
    }
    case 'aplicarCliente': return applyClient();
    case 'reiniciarJuego': return restartGame();
    case 'superficie.sacar': return exitASurface(d);
    case 'superficie.appClaude': return toClaudeApp(d);
    case 'presencia': lastUse = d.active ? Date.now() : 0; return true;
    // the top bar's memory chip (web/src/ui/RunningThings.tsx): read only while its popover is open
    case 'procesos': return runningThings(sessionOfClaude);
    case 'procesos.parar': {
      const r = await stopDwellerProcess(Number(d.pid), sessionOfClaude);
      if ('error' in r) throw new Error(t('server.running.notADwellers'));
      const s = sessions.list().find(x => x.id === r.sessionId);
      const who = store.state.dwellers.find(h => h.id === s?.dwellerId)?.name ?? s?.title ?? t('server.running.unknownConversation');
      broadcast({ t: 'aviso', level: 'info', text: t('server.running.stopped', { quien: who, orden: r.command.slice(0, 120), n: r.n }) });
      return true;
    }
    case 'slackRemote.estado': return slackRemote.state();
    case 'slackRemote.conectar': return slackRemote.connect(String(d.appToken ?? ''), String(d.botToken ?? ''));
    case 'slackRemote.emparejar': return slackRemote.pair();
    case 'slackRemote.aprobar': return slackRemote.setApprove(!!d.si);
    case 'slackRemote.desconectar': return slackRemote.disconnect();
    // Remote Control de la sala (`claude remote-control` en su carpeta): sesiones desde claude.ai/code y el móvil
    case 'sala.controlRemoto': {
      const sr = e.rooms.find(s => s.id === d.roomId);
      if (!sr || !isRoomOfRepo(sr.type) || !sr.path) throw new Error(t('server.remoteControlOnlyWorksIn'));
      if (d.switchOn === undefined) return controlRemoto.state(sr.id);
      if (!d.switchOn) { controlRemoto.shutDown(sr.id); return controlRemoto.state(sr.id); }
      return controlRemoto.switchOn(sr.id, folderOf(sr), sr.name);
    }
    // organizar salas de repo por tareas: un worktree y una conversación por tarea con PR abiertos (organize.ts).
    // Sin aplicar, solo el plan; con aplicar, lo hace (el Supervisor lo ha confirmado en el panel)
    case 'sala.organizar': return organizeRooms(d.roomId ? String(d.roomId) : undefined, !!d.apply);
    case 'tareas.colores': return taskColors.colors(d.keys);
    case 'despliegue.bloqueos': return prBlockers.all();
    case 'uso.gasto': return usageSpend.buckets();
    case 'preflight.tarea': return preflightOf(String(d.key ?? ''), ctxPreflight, !!d.force);
    case 'preflight.checklist': return checklistItems();
    case 'verificacion.tableros': return boardsSetup(ctxTrackers, (['jira', 'linear'] as const).find(f => f === d.source) as Tracker | undefined);
    case 'verificacion.tablero': return saveBoard(ctxTrackers, d.source, d.board, d);
    // the workflow's own transition to the done status, once the task is verified (the Overseer's click in the pre-flight)
    case 'verificacion.cerrar': {
      const k = taskKey(String(d.key ?? '')), p = k ? verifications.get(k) : undefined;
      const tr = k ? await taskTracker(ctxTrackers, k, !!p && finalCheckpoint(p)?.state === 'evidenced') : undefined;
      if (!k || !tr?.move) throw new Error(t('verification.cannotMove'));
      const { transitions } = (await integrations.action('transiciones', { source: 'jira', key: k, column: 'hecho', current: tr.state })) as { transitions?: JiraTransition[] };
      const x = doneTransition((transitions ?? []) as JiraTransition[], tr.done);
      if (!x) throw new Error(t('verification.noDoneTransition', { estado: tr.done ?? '—' }));
      return integrations.action('mover', { source: 'jira', key: k, column: 'hecho', id: x.id });
    }
    // ⚑ a conversation the Overseer still has to act on (shared/flagged.ts), by its Claude Code session id
    case 'conversacion.pendiente': {
      const id = String(d.claudeId ?? ''); if (!id) throw new Error(t('server.isStillStartingFlag'));
      const a = store.state.settings as any; a.flaggedConversations = setFlag(a.flaggedConversations, id, !!d.on); store.save();
      broadcast({ t: 'estado', state: store.state as any }); return true;
    }
    case 'revision.tablero': return reviewBoard();
    case 'revision.abrir': { const k = String(d.key ?? ''); if (!k) throw new Error(t('reviews.notFound', { clave: '—' })); return reviewRoom.open(k); }
    case 'revision.terminar': return reviewRoom.finish(String(d.key ?? ''));
    case 'bitacora.leer': return workLog.read(workLogSources);
    case 'bitacora.escalera': return workLog.ensureLadder();
    // the Overseer asks for the ladder's verification: one conversation with the dweller of the ladder's room
    case 'escalera.verificar': {
      const room = workLog.digestRoom(), h = store.state.dwellers.find(x => x.roomId === room);
      if (!h) throw new Error(t('panels.theRoomSalaHasNo', { sala: room }));
      const id = await startWork(undefined, { t: 'empezar', dwellerId: h.id, roomId: room, prompt: workLog.verifyPrompt(), options: { permissions: 'auto' } });
      return { id, roomId: room, dwellerId: h.id };
    }
    case 'medalla.decidir': return workLog.decideMedal(String(d.id ?? ''), d.accept === true) ?? null;
    case 'medalla.meter': { const r = workLog.enterMedal({ award: String(d.award ?? ''), text: String(d.text ?? ''), evidence: [String(d.evidence ?? '')] }); if (!r.ok) throw new Error(r.error); return r.medal; }
    case 'verificacion.aprobar': { const k = taskKey(String(d.key ?? '')); return (k && verifications.approve(k)) ?? null; }
    case 'paginas.responder': return pageReviews.respond(d.path, d.state);
    case 'preflight.puerta': { const r = path.resolve(String(d.path ?? '')); if (!gitPath(r)) throw new Error(t('server.thatFolderIsNotA')); return gatePush(r, ctxPreflight); }
    case 'despliegue.bloquear': return prBlockers.mark(d.from, d.by, !!d.remove);
    // el orden entre repos de cada tarea repartida (la parte de una sala espera a la de otra: plans.ts), por repo de GitHub
    case 'despliegue.orden': return tasksOrder(plans.all(), id => { const s = e.rooms.find(x => x.id === id); return s?.path ? roomRepo(s.path) : Promise.resolve(undefined); });
    case 'superficie.forzarCierre': return closeOutside(String(d.claudeId ?? ''));
    case 'repo': { const room = e.rooms.find(s => s.id === d.roomId); if (!room?.path) throw new Error(t('server.roomWithoutAFolder')); return repos[room.id] = await infoRepo(room.path); }
    // archivo adjuntado en el intercomunicador: se copia a DATOS/uploads (se limpian a la semana) y se devuelve su ruta
    case 'subir': return attachments.save(String(d.name || ''), String(d.data || ''));
    case 'adjunto.miniatura': return attachments.thumbnail(String(d.path || ''));
    // un adjunto del cuaderno: imágenes y PDF en Vista Previa, texto en el editor de texto, lo demás en el Finder (open.ts)
    // un enlace a un archivo del Mac en una respuesta (web/src/ui/markdown.ts): sin ejecutar nada (open.ts)
    case 'aviso.responder': { const f = questions.get(String(d.id ?? '')); questions.delete(String(d.id ?? '')); if (f) await f(!!d.si); return true; }
    // mensajes programados (scheduled.ts): el Supervisor los cancela o les cambia la hora o el texto
    // «New session with a handoff» in the intercom's notice (sessions.ts: handoff())
    case 'sesion.relevo': sessions.handoff(String(d.sessionId ?? '')); return true;
    case 'programados.cancelar': return scheduled.cancel(String(d.id ?? ''));
    // the Overseer's ⌥Enter / ⏰ Schedule in the intercom (`when`: a time, or by default the day's final 5-hour window): to its
    // conversation (`sessionId`), the one being resumed, or a new one
    case 'programados.ventana': {
      const sess = d.sessionId ? sessions.list().find(x => x.id === d.sessionId) : undefined, room = e.rooms.find(x => x.id === (sess?.roomId ?? d.roomId));
      if (!room) throw new Error(t('server.thatRoomDoesNotExist'));
      const cwd = sess ? sess.worktree ?? sess.cwd : typeof d.cwd === 'string' && d.cwd ? d.cwd : folderOf(room);
      const x = scheduled.scheduleOverseer({ roomId: room.id, sessionId: sess?.id, claudeId: sess?.claudeId ?? (typeof d.claudeId === 'string' ? d.claudeId : undefined), cwd: path.resolve(cwd), title: sess?.title ?? (typeof d.title === 'string' ? d.title : undefined) }, String(d.message ?? ''), typeof d.when === 'string' && d.when ? d.when : undefined);
      // «When it finishes» to a conversation that is already free goes out now
      if (x.afterTurn) scheduled.turnEnded({ sessionId: x.origin.sessionId });
      return x;
    }
    case 'programados.ahora': await scheduled.sendNow(String(d.id ?? '')); return true;
    case 'programados.editar': return scheduled.edit(String(d.id ?? ''), { when: d.when === undefined ? undefined : String(d.when), message: d.message === undefined ? undefined : String(d.message) });
    case 'paginas.existen': return existingPages(d.paths, os.homedir());
    case 'salida.leer': return toolOutputs.read(String(d.sessionId ?? ''), String(d.id ?? ''));
    // the entries of a conversation that can link pages (shared/sessionPages.ts), the whole log's: a live one's or, by
    // room and claudeId, a closed one's transcript. The intercom holds only a page of the log
    case 'cuaderno.enlaces': {
      const room = d.roomId ? store.state.rooms.find(s => s.id === d.roomId) : undefined;
      const all: LogInput[] = d.sessionId ? (await sessions.page(String(d.sessionId), Number.MAX_SAFE_INTEGER)).entries : room && d.claudeId ? await sessions.transcript(String(d.claudeId), folderOf(room)) : [];
      return all.filter(linksPages).map(({ id, ts, type, text, question }) => ({ id, ts, type, text, ...(question ? { question } : {}) }));
    }
    case 'paginas.actualizadas': return pagesUpdated(d.paths, os.homedir());
    case 'enlace.local': return openLink(String(d.path ?? ''), os.homedir(), d.outside === true);
    case 'enlace.tipo': return linkKind(String(d.path ?? ''), os.homedir());
    case 'enlace.miniatura': return imageThumbnail(String(d.path ?? ''), os.homedir());
    case 'enlace.revelar': return revealLocal(String(d.path ?? ''), os.homedir());
    case 'adjunto.abrir': { const r = String(d.path || ''); if (!attachments.own(r)) throw new Error(t('server.thatAttachmentIsGoneThey')); await openAttachment(attachments.dir, path.resolve(r)); return true; }
    default:
      if (name.startsWith('integracion.')) {
        const r: any = await integrations.action(name.slice(12), d);
        // Logística reparte los colores de las tareas: al leer el tablero de Jira, cada tarea recibe el suyo (o conserva
        // el que tenía) y viaja con ella; los demás tableros, las pantallas y los hologramas usan ese mismo
        if (name === 'integracion.panel' && d.source === 'jira' && Array.isArray(r?.tareas)) {
          return { ...r, tareas: taskColors.paint(r.tareas) };
        }
        return r;
      }
      if (name.startsWith('juego.')) { const r = gameAction(name.slice(6), d, store); broadcast({ t: 'estado', state: store.state as any }); return r; }
      if (name.startsWith('worktree.')) {
        const r = await (await import('./worktrees.ts')).actionWorktree(name.slice(9), d, { sessions, repos, pathRoom, store, terminals });
        if (name === 'worktree.desechar') await refreshRepos().catch(() => {});   // todas las ventanas apagan el holograma ya
        return r;
      }
      if (name.startsWith('git.')) return (await import('./git.ts')).actionGit(name.slice(4), d, { allowedPath: gitPath, pathsRepos: gitPaths, onChange: () => refreshReposSoon(), github: connectionGitHub, ledger: url => prReviews.ledgerOf(url) });
      if (name.startsWith('archivos.')) return (await import('./files.ts')).filesAction(name.slice(9), d, { allowedRoots: filesRoots, onChange: () => refreshReposSoon() });
      throw new Error(t('server.unknownAction', { nombre: name }));
  }
}

// Repos que maneja el cliente de git de Control de Versiones: los de las salas (y el del propio juego), sus worktrees
// y los repos de las alas de coordinación
function gitPaths() {
  const out = new Set<string>();
  for (const s of store.state.rooms) {
    if (!s.path) continue;
    const info = repos[s.id];
    if (info?.isGit) { out.add(info.path); for (const w of info.worktrees) out.add(w.path); }
    for (const r of info?.subrepos ?? []) out.add(r);
  }
  return [...out];
}
const gitPath = (r: string) => gitPaths().includes(r);
// Carpetas que se pueden explorar y editar en la ventana de Archivos: las de las salas de repo y de las alas, y los
// worktrees de sus repos
function filesRoots() {
  const out = new Set<string>();
  for (const s of store.state.rooms) {
    if (!s.path) continue;
    out.add(path.resolve(s.path));
    for (const w of repos[s.id]?.worktrees ?? []) out.add(path.resolve(w.path));
  }
  return [...out];
}

// Ajustes que el jugador puede cambiar desde la cámara acorazada y la bienvenida (lista blanca, con tipos)
const CHARACTERS = ['Protagonist_A', 'Protagonist_B', 'Engineer', 'Survivalist', 'Hiker', 'Hoarder', 'Driver', 'SpaceRanger'];
function applySettings(x: typeof store.state, p: Record<string, any>) {
  if (typeof p.name === 'string') x.name = p.name.trim().slice(0, 32) || GAME_NAME;
  if (typeof p.reposRoot === 'string' && p.reposRoot.trim()) x.reposRoot = p.reposRoot.trim().slice(0, 300);
  if (Number.isFinite(p.sessionLimit)) x.sessionLimit = Math.max(1, Math.min(20, Math.round(p.sessionLimit)));
  if (typeof p.doneWelcome === 'boolean') x.doneWelcome = p.doneWelcome;
  // the window dwellers auto-compact at, in tokens (0: Claude Code's own); it applies to conversations launched afterwards
  if (Number.isFinite(p.autoCompactWindow)) (x.settings as any).autoCompactWindow = p.autoCompactWindow === 0 ? 0 : autoCompactWindow(p.autoCompactWindow);
  // from how much context the intercom suggests a new session with a handoff, in tokens (0: never)
  if (Number.isFinite(p.handoffAt)) (x.settings as any).handoffAt = p.handoffAt === 0 ? 0 : handoffThreshold(p.handoffAt);
  // la lista «antes de subir» del pre-flight: un punto por línea
  if (Array.isArray(p.checklistPreflight)) (x.settings as any).checklistPreflight = [...new Set(p.checklistPreflight.filter((i: unknown) => typeof i === 'string').map((i: string) => i.trim().slice(0, 160)).filter(Boolean))].slice(0, 30);
  if (p.supervisor && typeof p.supervisor === 'object') {
    if (CHARACTERS.includes(p.supervisor.character)) x.supervisor.character = p.supervisor.character;
    // el aspecto por piezas (del probador); null lo quita y vuelve el del personaje de serie
    if (p.supervisor.look === null) delete x.supervisor.look;
    else if (p.supervisor.look !== undefined) { const a = sanitizeLook(p.supervisor.look); if (a) x.supervisor.look = a; }
    if (Array.isArray(p.supervisor.accessories)) x.supervisor.accessories = p.supervisor.accessories.filter((a: unknown) => typeof a === 'string' && x.jugador.tienda.includes(a)).slice(0, 4);
  }
}
function cleanDweller(h: any) {
  if (!h || typeof h !== 'object' || typeof h.roomId !== 'string') return null;
  const txt = (v: unknown, n: number, def = '') => (typeof v === 'string' ? v.slice(0, n) : def);
  const types = [...new Set([...CHARACTERS, ...TYPES_STOCK])];
  const look = sanitizeLook(h.look);
  return { id: txt(h.id, 60, 'h-' + Date.now().toString(36)).replace(/[^\w-]/g, '-'), name: txt(h.name, 30, 'Recluta'), nickname: txt(h.nickname, 40), type: types.includes(h.type) && h.type !== 'Protagonist_B' ? h.type : 'Hiker', bio: txt(h.bio, 300), roomId: h.roomId, voice: Number.isFinite(h.voice) ? Math.max(60, Math.min(260, h.voice)) : 120, ...(Number.isFinite(h.tone) && h.tone > 0 ? { tone: Math.min(359, Math.max(1, Math.round(h.tone) % 360 || 1)) } : {}), ...(look ? { look } : {}) };
}

// Puente de Mando: el habitante cambia el propio juego; el cliente se recompila y se recarga en caliente.
// Las sesiones viven en el servidor y la recarga cae dentro del margen de reconexión: nadie pierde su trabajo.
let compiling: Promise<unknown> | null = null;
function compileClient() {
  if (compiling) return Promise.reject(new Error(t('server.iAmAlreadyRebuildingThe')));
  return compiling = new Promise((ok, ko) => execFile(process.execPath, [path.join(ROOT, 'scripts', 'fingerprints.cjs'), 'compilar'], { cwd: ROOT, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, errOut) => {
    compiling = null;
    if (err) { broadcast({ t: 'aviso', level: 'error', text: t('server.buildFailed', { detalle: String(errOut || err.message).split('\n').filter(Boolean).slice(-3).join(' · ') }) }); ko(err); return; }
    ok(true);
  }));
}
function applyClient() {
  if (compiling) throw new Error(t('server.iAmAlreadyRebuildingThe'));
  broadcast({ t: 'aviso', level: 'info', text: t('server.maintenanceRebuildingTheShelterClient') });
  compileClient().then(() => {
    broadcast({ t: 'aviso', level: 'info', text: t('server.newClientReadyReloadingWithout') });
    setTimeout(() => broadcast({ t: 'recargar' }), 900);
  }, () => {});
  return { inProgress: true };
}

// Reinicio desde la regleta: recompila el cliente si su código ha cambiado, comprueba que el servidor nuevo
// carga y sale con el código 75 para que el supervisor (./shelter o npm run dev) lo vuelva a lanzar con el mismo
// secreto. Las terminales siguen vivas en su anfitrión; las conversaciones de los habitantes se cortan y quedan
// guardadas para retomarlas. Si algo falla, no se apaga nada y el juego sigue como estaba.
// Abierto como app, si han cambiado archivos que solo se leen al abrirla (Electron, el supervisor, ./shelter; la app
// pasa su huella en SHELTER_HUELLA_APP), sale con el 76: el supervisor y ./shelter salen con él y la app se vuelve a
// abrir sola, con las terminales igual de vivas.
const RESTART_CODE = 75, RELAY_CODE = 76;
let restarting = false;
async function restartGame() {
  if (!process.env.SHELTER_SUPERVISADO) throw new Error(t('server.thisServerWasNotStarted'));
  if (restarting) throw new Error(t('server.iAmAlreadyRestarting'));
  restarting = true;
  try {
    if (!DEVELOPMENT && !fingerprints.clientUpToDate()) { broadcast({ t: 'aviso', level: 'info', text: t('server.restartRebuildingTheClient') }); await compileClient(); }
    await checkServer();
  } catch (e) { restarting = false; throw e; }
  const handover = !!process.env.SHELTER_HUELLA_APP && process.env.SHELTER_HUELLA_APP !== fingerprints.fingerprint('app');
  console.log(handover ? '\nReiniciando la app entera a petición del Supervisor…' : '\nReiniciando el servidor a petición del Supervisor…');
  broadcast({ t: 'reiniciando' });
  dropAll();
  setTimeout(() => process.exit(handover ? RELAY_CODE : RESTART_CODE), 400);
  return true;
}
// lo que se deja al reiniciar: las conversaciones se cortan (quedan guardadas) y las terminales siguen en su anfitrión
function dropAll() {
  for (const step of [() => sessions.closeAll(), () => dictations.stopAll(), () => terminals.dropHost(), () => integrations.stop(), () => slackRemote.stop(), () => store.saveAlready()])
    try { step(); } catch (e) { console.error('Al reiniciar:', (e as Error).message); }
}
// ./shelter abre la app y se encuentra en marcha un servidor de antes de los últimos cambios (scripts/fingerprints.cjs,
// ponerAlDia): con ventanas conectadas se reinicia como con el botón; sin ninguna (la app de antes ya se cerró) se
// aparta, sin cerrar las terminales, para que la app nueva lance el suyo y sea suyo.
function setOnDay(): 'reinicio' | 'relevo' {
  if (clients.size) { restartGame().catch(e => console.error('Al poner al día:', (e as Error).message)); return 'reinicio'; }
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  console.log('\nSe abre una app con el código nuevo: le dejo el sitio.');
  dropAll();
  setTimeout(() => process.exit(0), 400);
  return 'relevo';
}
function checkServer() {
  return new Promise<void>((ok, ko) => execFile(process.execPath, [...process.execArgv.filter(a => !a.startsWith('--inspect')), path.join(ROOT, 'server', 'main.ts')], { cwd: ROOT, timeout: 60_000, env: { ...process.env, SHELTER_COMPROBAR: '1' } }, (err, _out, errOut) => {
    if (!err) { ok(); return; }
    const detail = String(errOut || err.message).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('at ')).slice(-4).join(' · ');
    ko(new Error(t('server.noRestartNewServerFails', { detalle: detail })));
  }));
}

function createFolder(filePath: string, withGit: boolean) {
  return new Promise<void>((res, rej) => execFile('/bin/mkdir', ['-p', filePath], err => err ? rej(err) : withGit ? execFile('git', ['init', filePath], e2 => e2 ? rej(e2) : res()) : res()));
}

function openIn(app: string, filePath: string) {
  const r = path.resolve(filePath);
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
const wingName = (rooms: { type: string; name: string }[], filePath: string) => rooms.some(s => s.type === 'coordinacion' && s.name.startsWith('Logística')) ? `Logística ${path.basename(filePath)}` : 'Logística';
const pathsList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);
// ws: quien lo pide (sin él, lo lanza el propio refugio: el reparto desde una sala de coordinación)
async function startWork(ws: WebSocket | undefined, m: Extract<ClientMessage, { t: 'empezar' }>): Promise<string> {
  const e = store.state;
  if (typeof m.roomId !== 'string' || typeof m.dwellerId !== 'string' || typeof m.prompt !== 'string') throw new Error(t('server.malformedMessage'));
  m.options = m.options && typeof m.options === 'object' ? m.options : {};
  const room = e.rooms.find(s => s.id === m.roomId);
  if (!room) throw new Error(t('server.thatRoomDoesNotExist'));
  // solo en la carpeta de trabajo de la sala o en uno de sus worktrees (las especiales tienen una propia)
  const folder = folderOf(room);
  if (!room.path) mkdirSync(folder, { recursive: true });
  const cwd = m.options.cwd ? path.resolve(m.options.cwd) : folder;
  if (cwd !== folder && pathRoom(cwd) !== room.id) throw new Error(t('server.thatFolderDoesNotBelong3'));
  if (!e.dwellers.some(h => h.id === m.dwellerId && h.roomId === room.id)) throw new Error(t('server.thatDwellerDoesNotLive'));
  // retomar una conversación que ya está abierta no la duplica: se vuelve a ella
  const open = m.options.resume ? sessions.list().find(p => p.claudeId === m.options.resume && p.state !== 'cerrada') : undefined;
  if (open) return open.id;
  if (m.options.resume && outsideOpen().has(m.options.resume.toLowerCase())) throw new Error(t('server.thatConversationIsStillOpen'));
  // el límite cuenta las que trabajan o esperan; las terminadas ociosas no bloquean (y se cierran solas a los 30 min)
  const live = sessions.list().filter(x => ['arrancando', 'trabajando', 'esperando'].includes(x.state)).length;
  if (live >= e.sessionLimit) {
    // el error sigue yendo a quien lo pidió; además se ofrece subir el límite y, si el Supervisor acepta, se reintenta
    const nuevo = raisedSessionLimit(e.sessionLimit);
    if (nuevo) ask(t('server.limitQuestion', { vivas: live, limiteSesiones: e.sessionLimit, nuevo }), { si: t('server.limitRaise', { nuevo }), no: t('server.limitDismiss') }, async si => {
      if (!si) return;
      store.state.sessionLimit = Math.max(store.state.sessionLimit, nuevo); store.save(); broadcast({ t: 'estado', state: store.state as any });
      await startWork(undefined, m).catch(err => broadcast({ t: 'aviso', level: 'error', text: (err as Error).message }));
    });
    throw new Error(t('server.thereAreAlreadyLiveSessions', { vivas: live, limiteSesiones: e.sessionLimit }));
  }
  // los worktrees son de las salas de proyecto: el Puente de Mando y las especiales trabajan en su carpeta, salvo el
  // worktree con nombre de una tarea (mensajes entre salas) si su carpeta es un repo git (lo comprueba lo de abajo)
  // un nombre de worktree (mensajes entre salas): solo letras, números, guiones y puntos; si no, uno con el título
  // (in a special room, none: it only gets a task-named one)
  if (typeof m.options.worktree === 'string' && !/^[\w.-]{1,80}$/.test(m.options.worktree)) m.options.worktree = room.type === 'repo';
  if (room.type !== 'repo' && typeof m.options.worktree !== 'string') m.options.worktree = false;
  // en un ala (carpeta con varios repos) no hay un único repo donde crear el worktree: se trabaja en la carpeta
  if (m.options.worktree && !existsSync(path.join(cwd, '.git'))) { m.options.worktree = false; const notice: ServerMessage = { t: 'aviso', level: 'aviso', text: t('server.isNotAGitRepo', { nombre: roomNameIs(room) }) }; if (ws) send(ws, notice); else broadcast(notice); }
  const r = await sessions.start(m.dwellerId, m.roomId, cwd, m.prompt, m.options, attachments.describe(pathsList(m.attachments)));
  if (m.options.resume && ws) send(ws, { t: 'entradas', sessionId: r.id, entries: sessions.logbook(r.id) });
  return r.id;
}

// ---------------------------------------------------------------- mensajes de un cliente
async function handle(ws: WebSocket, m: ClientMessage) {
  const e = store.state;
  switch (m.t) {
    case 'hola':
      send(ws, { t: 'bienvenida', versionClaude: sessions.version, claudeOk: !!sessions.claude, state: e as any, sessions: sessions.list(), repos, demo: Object.values(e.integrations).length > 0 && Object.values(e.integrations).every(i => i.mode === 'demo') });
      send(ws, { t: 'visitantes', visitors: visitors() });
      send(ws, { t: 'programados', list: scheduled.list() });
      send(ws, { t: 'verificaciones', states: verificationSummaries() });
      send(ws, { t: 'revisiones', board: reviewBoard() });
      send(ws, { t: 'limites', limits: planLimits.get() });
      integrations.greet(ws, send);
      for (const t of terminals.openSessions()) terminals.open(t.id, t.cwd, 80, 24, outputOf(ws));
      break;
    case 'empezar': {
      // con `peticion`, se contesta con el id de la sesión (la pestaña del intercomunicador la sigue) o con el error
      try { const id = await startWork(ws, m); if (m.request) send(ws, { t: 'respuesta', request: m.request, data: id }); }
      catch (err) { if (m.request) send(ws, { t: 'respuesta', request: m.request, error: (err as Error).message }); else throw err; }
      break;
    }
    case 'enviar': sessions.send(m.sessionId, String(m.text ?? ''), attachments.describe(pathsList(m.attachments))); break;
    case 'vozEmpezar': dictations.start(String(m.id), String(m.language || 'es-ES'), ws, ev => send(ws, { t: 'voz', id: m.id, ...ev })); break;
    case 'vozAudio': dictations.audio(String(m.id), String(m.data || '')); break;
    case 'vozFin': dictations.finish(String(m.id)); break;
    case 'vozCancelar': dictations.cancel(String(m.id)); break;
    case 'responder': sessions.respond(m.sessionId, m.requestId, m.decision, m.message, m.responses); break;
    case 'interrumpir': await sessions.interrupt(m.sessionId); break;
    case 'cerrarSesion': await sessions.closeAndStop(m.sessionId); break;
    case 'leida': sessions.markRead(m.sessionId); break;
    case 'retirar': send(ws, { t: 'respuesta', request: m.request, data: await sessions.withdraw(m.sessionId, m.messageId).catch(() => false) }); break;
    case 'enviarYa': send(ws, { t: 'respuesta', request: m.request, data: await sessions.sendNow(m.sessionId, m.messageId).catch(() => false) }); break;
    case 'enUso': inUse.set(ws, new Set(Array.isArray(m.sessions) ? m.sessions.map(String) : [])); break;
    case 'lateral': await sessions.lateral(m.sessionId, m.question); break;
    case 'modoPermisos': await sessions.mode(m.sessionId, m.mode); break;
    case 'historial': {
      const room = e.rooms.find(s => s.id === m.roomId);
      // el de una copia holográfica, el de su worktree (si es de esa sala)
      const ofCopy = !!(room && m.cwd && pathRoom(path.resolve(m.cwd)) === room.id);
      const dir = ofCopy ? path.resolve(String(m.cwd)) : room && folderOf(room);
      const outside = outsideOpen();
      // Claude Code junta en un proyecto las conversaciones de todos los worktrees del repo: la copia solo ve las de
      // dentro del suyo (las que no dicen dónde se hicieron no son de ningún worktree)
      const list = dir ? (await sessions.history(dir)).filter(x => !ofCopy || (!!x.cwd && insideOf(path.resolve(x.cwd), dir))) : [];
      send(ws, { t: 'respuesta', request: m.request, data: list.map(x => (outside.has(x.claudeId.toLowerCase()) && !x.inProgress ? { ...x, outside: true } : x)) }); break;
    }
    case 'cargarConversacion': { const room = e.rooms.find(s => s.id === m.roomId); const l = room ? await sessions.transcript(m.claudeId, folderOf(room)) : []; send(ws, { t: 'respuesta', request: m.request, data: m.limit ? l.slice(-m.limit) : l }); break; }
    case 'cuaderno': send(ws, { t: 'respuesta', request: m.request, data: sessions.logbook(m.sessionId) }); break;
    case 'cuadernoPagina': try { send(ws, { t: 'respuesta', request: m.request, data: await sessions.page(m.sessionId, Math.min(1000, Number(m.limit) || DEFAULT_LOG_PAGE), m.before) }); } catch (err) { send(ws, { t: 'respuesta', request: m.request, error: (err as Error).message }); } break;
    case 'comandos': send(ws, { t: 'respuesta', request: m.request, data: m.sessionId ? sessions.commands(m.sessionId) : [] }); break;
    case 'terminalAbrir': terminals.open(m.id, m.cwd, m.cols, m.rows, outputOf(ws)); break;
    case 'terminalEntrada': terminals.input(m.id, m.data); break;
    case 'terminalTamano': terminals.resize(m.id, m.cols, m.rows); break;
    case 'terminalCerrar': terminals.close(m.id); break;
    case 'salir': shutDown(t('server.overseerClosedTheShelter')); break;
    case 'accion': {
      try { send(ws, { t: 'respuesta', request: m.request ?? '', data: await action(m.name, m.data) }); }
      catch (err) { send(ws, { t: 'respuesta', request: m.request ?? '', error: (err as Error).message }); }
      break;
    }
  }
}

// ---------------------------------------------------------------- HTTP estático
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm' };
// Caché: lo compilado lleva la huella en el nombre (dist/web/assets/*-<hash>.js) y no cambia nunca; todo lo demás
// (modelos, texturas, índices, que se rehacen con el mismo nombre) se vuelve a comprobar en cada carga con su ETag
// y, si no ha cambiado, va un 304 sin cuerpo. Así nunca se ve una versión vieja de nada.
function serve(req: http.IncomingMessage, res: http.ServerResponse, root: string, rel: string) {
  const filePath = path.normalize(path.join(root, rel));
  if (!(filePath === root || filePath.startsWith(root + path.sep)) || !existsSync(filePath)) return false;
  const st = statSync(filePath);
  if (!st.isFile()) return false;
  const immutable = root === WEB && rel.startsWith('/assets/');
  const etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
  const headers = { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  res.writeHead(200, { ...headers, 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
  createReadStream(filePath).pipe(res);
  return true;
}
const server = http.createServer((req, res) => {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(403); res.end(); return; }
  let url: string;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  if (url.startsWith('/assets/') && serve(req, res, ASSETS, url.slice(8))) return;
  // las páginas HTML del Mac que se ven en el juego (localPages.ts), con su llave y aisladas
  if (url.startsWith('/pagina/')) { servePage(req, res, url).then(ok => { if (!ok) { res.writeHead(404); res.end(); } }, () => { if (!res.headersSent) res.writeHead(500); res.end(); }); return; }
  if (url === '/salud') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, claude: !!sessions.claude, version: sessions.version, code: SERVER_FINGERPRINT })); return; }
  // ./shelter, al abrir la app con un servidor de antes de los últimos cambios aún en marcha, le pide ponerse al día.
  // Con el secreto del arranque y sin Origin: una página web no puede pedirlo.
  if (url === '/poner-al-dia' && req.method === 'POST') {
    const t = req.headers['x-shelter-token'];
    if (req.headers.origin || typeof t !== 'string' || !tokenValid(t)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(setOnDay());
    return;
  }
  // (frame-src: la ventana «Página» enseña páginas de este Mac: las de /pagina/ y las que sirve una herramienta en local,
  // como una página de revisión con notas; cada una en su <iframe> aislado, web/src/ui/Browsers.tsx)
  // la página del juego lleva el secreto de este arranque para abrir el WebSocket
  // la página NO lleva el secreto (cualquier proceso local podría pedirla): llega en el fragmento #t= de la URL que abre
  // el lanzador (leído de DATOS/token, 0600), como hace Jupyter. Política de contenido estricta: nada se carga de fuera
  // salvo las carátulas de lo que suena en la discoteca (imágenes del CDN de Spotify, que lee la pletina).
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.scdn.co; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' blob: data: ws://127.0.0.1:${PORT} ws://localhost:${PORT}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; frame-src 'self' http://127.0.0.1:* http://localhost:*`;
  const page = () => { const f = path.join(WEB, 'index.html'); if (!existsSync(f)) return false; res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': csp, 'Referrer-Policy': 'no-referrer' }); res.end(readFileSync(f, 'utf8')); return true; };
  if (existsSync(WEB) && (url === '/' || url === '/index.html' ? page() : (serve(req, res, WEB, url) || page()))) return;
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(t('server.notBuilt'));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin || '';
  const t = new URL(req.url || '/', 'http://x').searchParams.get('t');
  if (!ORIGINS.has(origin) || !HOSTS.test(req.headers.host || '') || !(req.url || '').startsWith('/ws') || !tokenValid(t)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  clients.add(ws);
  if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  ws.on('message', async raw => {
    let m: ClientMessage;
    try { m = JSON.parse(String(raw)); } catch { return; }
    try { await handle(ws, m); } catch (err) { send(ws, { t: 'aviso', level: 'error', text: (err as Error).message }); }
  });
  ws.on('close', () => {
    clients.delete(ws); inUse.delete(ws); terminals.drop(outputOf(ws)); dictations.drop(ws);
    if (!clients.size) graceTimer = setTimeout(async () => {
      graceTimer = null;
      // el juego se ha caído (nadie ha pulsado Salir: eso apaga al momento): lo que estaba abierto sale a tu escritorio
      // en vez de perderse. Solo con la ventana del juego (./shelter o la app) y con los datos de verdad (o en la QA)
      if (process.env.SHELTER_SALIR_SIN_CLIENTES && (!process.env.SHELTER_DATOS || process.env.SHELTER_ESCRITORIO_PRUEBA) && (sessions.list().some(s => s.state !== 'cerrada') || terminals.openSessions().length)) {
        console.log('El juego se ha caído: saco a tu escritorio lo que estaba abierto.');
        const ids = terminals.openSessions().map(t => t.id);
        try { await exitASurface({ all: true, windowNew: true }); await waitHooks(ids); } catch (e) { console.error('No pude salir a la superficie:', (e as Error).message); }
        if (clients.size) return;   // ha vuelto alguien mientras tanto
      }
      // nadie ha vuelto: se paran las sesiones y las terminales (recargar dentro del margen no mata nada); las que
      // están abiertas en tu escritorio siguen
      const n = sessions.live().length; sessions.closeAll(); const t = terminals.closeAll(true);
      if (n || t) console.log(`Sin clientes durante ${GRACE_MS / 1000} s: ${n} sesiones y ${t} terminales paradas.`);
      if (process.env.SHELTER_SALIR_SIN_CLIENTES) shutDown('Sin clientes');
    }, GRACE_MS);
  });
});

let switchingOff = false;
function shutDown(reason: string) {
  if (switchingOff) return; switchingOff = true;
  console.log(`\nApagando el refugio (${reason})…`);
  // cada paso por separado: si uno falla (p. ej. no se puede guardar), el resto se hace igual y el proceso sale
  // al salir de verdad no queda nada abierto (para `./shelter superficie`, si luego no hay refugio)
  for (const step of [() => sessions.closeAll(), () => dictations.stopAll(), () => writeFileSync(path.join(DATA, 'abiertas.json'), '[]'), () => terminals.shutDown(), () => integrations.stop(), () => slackRemote.stop(), () => store.saveAlready(), () => broadcast({ t: 'aviso', level: 'info', text: t('server.workShelterHasClosedSee') })])
    try { step(); } catch (e) { console.error('Al apagar:', (e as Error).message); }
  setTimeout(() => process.exit(0), 1200);
}
process.on('SIGINT', () => shutDown('Ctrl+C'));
process.on('SIGTERM', () => shutDown('SIGTERM'));

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') { console.error(`El puerto ${PORT} ya está en uso: ¿hay otro work-shelter abierto? Ciérralo o usa SHELTER_PUERTO.`); process.exit(2); }
  throw e;
});
server.listen(PORT, '127.0.0.1', async () => {
  writeToken();
  console.log(`work-shelter escucha en http://127.0.0.1:${PORT}  (datos: ${DATA})`);
  if (!sessions.claude) console.warn('AVISO: no encuentro el binario `claude`. Instala Claude Code e inicia sesión para que los habitantes trabajen.');
  else console.log(`Claude Code: ${sessions.version}`);
  await refreshRepos();
  integrations.start();
  // solo el refugio de verdad escucha al mando de Slack (una segunda conexión de Socket Mode a la misma app se repartiría
  // los eventos); los de prueba, con SHELTER_SLACK=1
  if (!process.env.SHELTER_DATOS || process.env.SHELTER_SLACK === '1') slackRemote.start().catch(e => console.error('Slack (mando):', (e as Error).message));
  controlRemoto.restore(store.state.rooms.map(s => ({ id: s.id, name: s.name, cwd: isRoomOfRepo(s.type) && s.path ? folderOf(s) : undefined }))).catch(() => {});
});
