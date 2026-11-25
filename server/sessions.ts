// Núcleo de sesiones: cada habitante que trabaja es una sesión REAL de Claude Code lanzada con el Agent SDK
// usando el binario `claude` instalado (hereda login, ajustes, CLAUDE.md, hooks y MCP del usuario).
// Una query() por sesión con entrada en streaming; los eventos se convierten en estado del habitante;
// canUseTool se enruta al jugador. Diseño inspirado en code-town/server/sessions.ts (MIT).
import os from 'node:os';
import path from 'node:path';
import { cwdBeforeRelocation, lastActivity, projectFolder } from './repos.ts';
import { mcpReview } from './compare.ts';
import { SELF_GATED } from './mcpServers.ts';
import { mergeOf } from '../shared/preflight.ts';
import { reviewPostOf } from '../shared/reviews.ts';
import { COMPACT_URGE, handoffDue } from '../shared/compact.ts';
import { handMadeWorktree, newWorktreeOf, taskWorktreeIn, worktreeTask, ghCreateOf, githubRepoOf, isOriginalRepo, ORIGINAL_REPO } from '../shared/tasks.ts';
import { gh } from './git.ts';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { gitEnvironment } from './gitEnv.ts';
import { existsSync, readdirSync } from 'node:fs';
import { query, listSessions, getSessionMessages, getSessionInfo, type Query, type SDKMessage, type SDKUserMessage, type CanUseTool, type PermissionResult, type Options, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { SessionSummary, LogInput, PendingRequest, Helper, WorkOptions, HistoryElement, Command, Question, Attachment, InputView, MessageOrigin, QueuedMessage } from '../shared/protocol.ts';
import { applyLifecycle, takeConsumed, withdrawable } from '../shared/messageQueue.ts';
import { separateAttachments, type Attachments } from './attachments.ts';
import type { ToolOutputs } from './toolOutputs.ts';
import { logPage, prependOlder, type LogCursor, type LogPage } from '../shared/logPages.ts';
import { logHits } from '../shared/findText.ts';
import { ROOMS_FOLDERS } from './state.ts';
import { active } from '../shared/sources.ts';
import { describeTool, describeInput, permissionTitle, toolMode, toolPath, isAgent } from './tools.ts';
import { t } from '../shared/language.ts';
import { CONVERSATION_MARK, processesOf, stopProcesses } from './sessionProcesses.ts';
import { resetMs, stopsWork, UNKNOWN_RESET_MS } from './limitResume.ts';
import { ANNEX, bridgeAnnex, annexGit, HIDDEN_SKILLS, withoutWorkConnectors } from './annex.ts';

class Queue<T> implements AsyncIterable<T> {
  private items: T[] = []; private waits: ((r: IteratorResult<T>) => void)[] = []; private end = false;
  meter(x: T) { if (this.end) return; const w = this.waits.shift(); if (w) w({ value: x, done: false }); else this.items.push(x); }
  // takes back an item the reader has not read yet
  remove(f: (x: T) => boolean) { const i = this.items.findIndex(f); if (i < 0) return false; this.items.splice(i, 1); return true; }
  close() { this.end = true; for (const w of this.waits) w({ value: undefined as any, done: true }); this.waits = []; }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false }) : this.end ? Promise.resolve({ value: undefined as any, done: true }) : new Promise(r => this.waits.push(r)) };
  }
}

interface Pending { pet: PendingRequest; input: Record<string, unknown>; suggestions?: unknown[]; resolver: (r: PermissionResult) => void }

interface Session {
  r: SessionSummary;
  q?: Query; input?: Queue<SDKUserMessage>;
  alive: boolean; closing: boolean; interrupting: boolean; toolsOnStartTurn?: number;
  // lo último que se le ha mandado (uuid → texto), para decir qué mensajes en cola anula una interrupción
  sent: Map<string, string>;
  pending: Pending[];
  // sent while it was busy and not taken yet (shared/messageQueue.ts); unsent: still being prepared (attachments), not in
  // the input yet; withdrawn: taken back by the Overseer before reaching it
  queue: QueuedMessage[]; unsent: Set<string>; withdrawn: Set<string>;
  entries: LogInput[];
  // older entries than those in memory are in its transcript on disk (resumed, or cut at MAX_ENTRIES): page() reads them
  olderOnDisk?: boolean;
  tools: Map<string, { name: string }>;
  helpers: Map<string, Helper>;
  taskAHelper: Map<string, string>;
  // tareas en segundo plano vivas (subagentes, terminales, monitores): con alguna, el turno acaba pero el trabajo no
  background: Set<string>; awaitingBackground: boolean; backgroundTimer?: NodeJS.Timeout;
  commands: Command[];
  stderr: string;
  options: WorkOptions;
  partialText: string;
  // whether the main agent has written text to the user this turn, and whether a question without it was already held back
  textInTurn?: boolean; askHeld?: boolean;
  // an API error in this turn (a usage limit, overloaded...): the SDK may still end the turn as a success
  apiErrorInTurn?: { error: string; text: string };
  shipments: Promise<void>;   // los mensajes con imágenes tardan un poco en prepararse: salen en orden
  trustWaiting?: boolean; loadProject?: boolean;   // ver preguntarConfianza()
  // the usage limit stopped this turn (a `rejected` rate limit event or a limit error): its reset in ms, 0 if unknown
  limitHit?: number;
}

export interface RoomsResolver {
  pathRoom(filePath: string): string | undefined; reposOfShelter?(): string[];
  // las herramientas del juego para decorar la sala (server/roomDecor.ts), en las salas de repo: un servidor MCP por sesión
  mcpRoom?(roomId: string): McpSdkServerConfigWithInstance | undefined;
  // las de repartir el trabajo (server/dispatch.ts), en las salas de coordinación; preguntar: confirmación del Supervisor
  mcpAssignment?(roomId: string, ask: (title: string, input: InputView[]) => Promise<boolean>, sessionId: string): McpSdkServerConfigWithInstance | undefined;
  // las del plan compartido (leerlo y proponer cambios), en las salas que trabajan en una parte de un plan repartido
  mcpPlan?(roomId: string): McpSdkServerConfigWithInstance | undefined;
  // la de pasarle un mensaje o un encargo al habitante de otra sala (server/roomNotices.ts), en todas
  mcpRooms?(roomId: string, sessionId: string, inWorktree: boolean): McpSdkServerConfigWithInstance | undefined;
  // el pre-flight de la tarea (server/preflight.ts): las herramientas del habitante y la puerta de `git push`
  preflight?: {
    state(cwd: string): Promise<string>;
    respond(cwd: string, item: string, state: 'ok' | 'n/a' | 'pending', note?: string): Promise<string>;
    gate(cwd: string): Promise<{ key: string; branch?: string; head?: string; missing: string[] } | null>;
  };
  // carpetas que el Supervisor ha marcado de confianza en el juego (ver confianza())
  trustedFolders?(): string[]; trust?(filePath: string): void; clonedFolders?(): string[];
  // the window Claude Code auto-compacts at (vault setting, shared/compact.ts); undefined: Claude Code's own
  autoCompactWindow?(): number | undefined;
  // the new-session suggestion (shared/compact.ts): its threshold (undefined: off) and the conversations already offered
  // one, by Claude Code id, kept across restarts so it is offered once per conversation
  handoff?: { threshold(): number | undefined; offered(claudeId: string): boolean; mark(claudeId: string): void };
}

export function pathClaude(): string | undefined {
  if (process.env.CLAUDE_BIN && existsSync(process.env.CLAUDE_BIN)) return process.env.CLAUDE_BIN;
  try { return execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 }).trim() || undefined; } catch { return undefined; }
}
export function versionClaude(bin?: string) { try { return bin ? execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim() : undefined; } catch { return undefined; } }

// Entorno del hijo: el del usuario SIN credenciales de API (consume el plan del usuario, nunca claves)
export function cleanEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'])
    delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_CODE_') && !['CLAUDE_CODE_MAX_OUTPUT_TOKENS'].includes(k) && k !== 'CLAUDE_CODE_DISABLE_AUTO_MEMORY') delete env[k];
  // ni el secreto del servidor del juego (con él, cualquier herramienta podría manejar el refugio) ni sus ajustes
  for (const k of Object.keys(env)) if (k.startsWith('SHELTER_')) delete env[k];
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'work-shelter/0.1';
  // que avise de cuándo trabaja y cuándo para (session_state_changed), también en los turnos que no manda el juego
  env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS = '1';
  env.WORK_SHELTER = '1';
  return env;
}

// Confianza en la carpeta, como en la CLI de Claude Code: la configuración de proyecto de un repo (.claude/settings*.json
// con hooks y permisos, .mcp.json, CLAUDE.md, reglas, comandos y agentes) puede ejecutar órdenes o dirigir al agente, y
// en modo SDK no hay diálogo de «¿Confías en esta carpeta?». Si la carpeta trae algo de eso y no es de confianza, el
// juego lo pregunta antes de lanzar (petición «confianza»): sí, sí siempre (se apunta en el refugio) o sin ella (solo
// los ajustes del usuario). Es de confianza la que se ha aceptado en Claude Code (projects[ruta].hasTrustDialogAccepted
// en ~/.claude.json) o en el juego, para ella o una carpeta que la contenga; el repo del propio juego y las carpetas de
// las salas especiales también. Los repos de ejemplo son de fuera: se preguntan como cualquier otro.
// A repo cloned from GitHub by the game (`limites`) is a boundary: only trust in that folder or inside it counts, not a
// trusted folder above it (the repos root, say), since its config arrived from elsewhere.
const GAME_ROOT = path.resolve(import.meta.dirname, '..');
// a live session keeps its latest log entries in memory (older ones: its transcript, Sessions.page); a resumed one starts
// with the last RESUMED_ENTRIES of its transcript
const MAX_ENTRIES = 1500, RESUMED_ENTRIES = 800;
const TRANSCRIPT_CACHE_MS = 60_000;
// lo que puede traer instrucciones u órdenes de terceros (no .claude/worktrees)
const CONFIG_PROJECT = ['.claude/settings.json', '.claude/CLAUDE.md', '.claude/rules', '.claude/commands', '.claude/agents', '.claude/hooks', '.claude/skills', '.claude/output-styles', '.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md'];
const FOLDERS_OF_GAME = [ROOMS_FOLDERS];
// el settings.local.json lo escriben Claude Code y el juego («Sí, y no vuelvas a preguntar») y git lo ignora: solo
// cuenta si viene con el repo (versionado) o si la carpeta no es un repo
function localOfRepo(dir: string) {
  if (!existsSync(path.join(dir, '.claude', 'settings.local.json'))) return false;
  try { execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch', '--', '.claude/settings.local.json'], { cwd: dir, stdio: 'ignore', timeout: 5000 }); return true; }
  catch (e) { return (e as { status?: number }).status !== 1; }
}
export function projectConfig(cwd: string) {
  const dir = path.resolve(cwd);
  return [...CONFIG_PROJECT.filter(f => existsSync(path.join(dir, f))), ...(localOfRepo(dir) ? ['.claude/settings.local.json'] : [])];
}
export function trust(cwd: string, fileClaude = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json'), trusted: string[] = [], limits: string[] = []): 'no-config' | 'confiada' | 'no-trust' {
  const dir = path.resolve(cwd);
  if (!projectConfig(dir).length) return 'no-config';
  if ([GAME_ROOT, ...FOLDERS_OF_GAME].some(r => dir === r || dir.startsWith(r + path.sep))) return 'confiada';
  let projects: Record<string, any> = {};
  try { projects = JSON.parse(readFileSync(fileClaude, 'utf8')).projects ?? {}; } catch {}
  const inGame = new Set(trusted.map(c => path.resolve(c))), boundaries = new Set(limits.map(c => path.resolve(c)));
  for (let d = dir; ; d = path.dirname(d)) {
    if (projects[d]?.hasTrustDialogAccepted === true || inGame.has(d)) return 'confiada';
    if (path.dirname(d) === d || boundaries.has(d)) return 'no-trust';
  }
}

/** Nombre del worktree de un trabajo nuevo: la tarea en pocas palabras (se lee en la rama y en el holograma) y un
 *  sufijo para no chocar con otro de la misma tarea. */
export function worktreeName(task: string, now = Date.now()) {
  const words = task.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const p of words) { const n = slug ? `${slug}-${p}` : p; if (n.length > 32) break; slug = n; }
  return `shelter-${slug ? slug.slice(0, 32) + '-' : ''}${worktreeSuffix(now)}`;
}
export const worktreeSuffix = (now = Date.now()) => (now % 36 ** 4).toString(36).padStart(4, '0');

/** Crea el worktree de un trabajo nuevo donde lo haría Claude Code con --worktree (.claude/worktrees/<nombre>, rama
 *  worktree-<nombre>), desde la rama principal del remoto recién traída (o, sin remoto, desde lo que tenga la copia), para
 *  que la conversación arranque ya dentro. Arrancando en la copia principal, Claude Code lista las habilidades de los
 *  worktrees que hay dentro con un prefijo («.claude/worktrees/ABC-1:skill») que su herramienta Skill no reconoce. */
export async function createWorktree(repo: string, name: string): Promise<string> {
  const git = (args: string[], timeout = 30_000) => new Promise<string>((ok, ko) => execFile('git', args, { cwd: repo, env: gitEnvironment(), timeout }, (e, out, err) => (e ? ko(new Error(String(err || e.message).trim())) : ok(String(out).trim()))));
  const filePath = path.join(await git(['rev-parse', '--show-toplevel']), '.claude', 'worktrees', name);
  const main = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
  if (main) await git(['fetch', 'origin', main.replace(/^origin\//, '')], 20_000).catch(() => {});
  await git(['worktree', 'add', '--no-track', '-b', `worktree-${name}`, filePath, main || 'HEAD']);
  return filePath;
}

/** El worktree de una carpeta: la raíz de su copia en .claude/worktrees (también desde una subcarpeta suya) */
export function worktreeRoot(dir?: string): string | undefined {
  return dir ? /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(dir)?.[1] : undefined;
}

const quotedList = (texts: string[]) => texts.map(v => t('server.quoted', { v: v.length > 120 ? `${v.slice(0, 120)}…` : v })).join(', ');

// the Claude Code tag of the read-only forks older versions made of busy task conversations (room messages): still
// read so those transcripts, left in task worktrees, are never the ones resumed
export const FORK_TAG = 'shelter-fork';

export class Sessions extends EventEmitter {
  private s = new Map<string, Session>();
  claude = pathClaude();
  version = versionClaude(this.claude);
  constructor(private resolver: RoomsResolver, private attachments?: Attachments, private outputs?: ToolOutputs) { super(); }

  list() { return [...this.s.values()].map(x => x.r); }
  get(id: string) { return this.s.get(id); }
  live() { return [...this.s.values()].filter(x => x.alive); }
  private must(id: string) { const x = this.s.get(id); if (!x) throw new Error(t('server.unknownSession')); return x; }

  private lastEmission = new Map<string, { t: number; key: string; queue: string; timer?: NodeJS.Timeout }>();
  private play(x: Session) {
    x.r.updated = Date.now(); x.r.pendingCount = x.pending.length; x.r.pending = x.pending[0]?.pet; x.r.helpers = [...x.helpers.values()];
    x.r.queue = x.queue.length ? [...x.queue] : undefined;
    const queue = x.queue.map(m => m.id).join();
    const signature = () => JSON.stringify([x.r.state, x.r.activity, x.r.pending?.id, x.r.pendingCount, x.r.helpers, x.r.lastText?.length, x.r.unread, x.r.title, x.r.error, x.r.lateral, x.r.permissionMode, x.r.model, x.r.claudeId, x.r.turns, x.r.background, x.r.worktree, x.r.limit, x.r.queue?.map(m => m.id)]);
    const key = signature();
    const u = this.lastEmission.get(x.r.id);
    if (u && u.key === key) return;
    const now = Date.now();
    const emit = () => { const e = this.lastEmission.get(x.r.id); if (e) e.timer = undefined; this.lastEmission.set(x.r.id, { t: Date.now(), key: signature(), queue: x.queue.map(m => m.id).join() }); this.emit('session', { ...x.r, helpers: x.r.helpers.map(a => ({ ...a })) }); };
    // los cambios de estado salen al momento (and the queue's, which the log's entries follow at once); los de
    // actividad, como mucho 8 por segundo
    if (!u || u.key.split(',')[0] !== key.split(',')[0] || u.queue !== queue || now - u.t > 125) { if (u?.timer) clearTimeout(u.timer); emit(); }
    else if (!u.timer) u.timer = setTimeout(emit, 125);
  }
  private input(type: LogInput['type'], text: string, extra: Partial<LogInput> = {}): LogInput { return { id: randomUUID(), ts: Date.now(), type, text, ...extra }; }
  private add(x: Session, e: LogInput) { x.entries.push(e); if (x.entries.length > MAX_ENTRIES) { x.entries.splice(0, x.entries.length - MAX_ENTRIES); x.olderOnDisk = true; } this.emit('entries', x.r.id, [e]); }

  // a turn stopped by the usage limit is not an error: it waits for the reset and resumes on its own (limitResume.ts)
  private lastReset?: number;
  private limitStop(x: Session) {
    const resetsAt = x.limitHit || this.lastReset || Date.now() + UNKNOWN_RESET_MS;
    x.limitHit = undefined;
    x.r.state = 'idle'; x.r.error = undefined; x.r.unread = true; x.r.limit = { resetsAt };
    this.add(x, this.input('system', t('server.limitStopped')));
    this.emit('limitStopped', { ...x.r, stoppedAt: Date.now() });
  }
  /** When the queue will resume it (shown in the intercom) */
  limitAt(claudeId: string, resumeAt: number) {
    for (const x of this.s.values()) if (x.r.claudeId === claudeId && x.r.limit && x.r.limit.resumeAt !== resumeAt) { x.r.limit = { ...x.r.limit, resumeAt }; this.play(x); }
  }

  logbook(id: string) { return this.must(id).entries; }
  /** A page of the log (shared/logPages.ts): from memory and, past its start, from the transcript on disk */
  async page(id: string, limit: number, before?: LogCursor): Promise<LogPage<LogInput>> {
    const x = this.must(id);
    const p = logPage(x.entries, limit, before);
    if (p.more || !x.olderOnDisk || !x.r.claudeId) return p;
    if (p.entries.length >= limit) return { entries: p.entries, more: true };
    const from = p.entries[0] ?? before ?? x.entries[0];
    const disk = await this.transcript(x.r.claudeId, x.r.cwd).catch(() => [] as LogInput[]);
    const d = logPage(disk, limit - p.entries.length, from);
    return { entries: [...d.entries, ...p.entries], more: d.more };
  }
  /** ⌘F in an intercom: the matches in the whole log, from memory and, older than that, from the transcript on disk */
  async find(id: string, query: string) {
    const x = this.must(id);
    const older = x.olderOnDisk && x.r.claudeId ? await this.transcript(x.r.claudeId, x.r.cwd).catch(() => [] as LogInput[]) : [];
    return logHits(prependOlder(x.entries, older), query);
  }
  commands(id: string) { return this.must(id).commands; }

  // el init (que dice qué credencial se usa) no llega hasta el primer mensaje: antes de lanzar se mira que ningún
  // ajuste de Claude Code imponga una clave de API, para que ni el primer turno salga con ella
  private keyInSettings(cwd: string): string | null {
    const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const f of [path.join(home, 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]) {
      try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j.apiKeyHelper) return t('server.apiKeyHelperIn', { f }); if (j.env && (j.env.ANTHROPIC_API_KEY || j.env.ANTHROPIC_AUTH_TOKEN)) return t('server.aKeyInEnvOf', { f }); } catch {}
    }
    return null;
  }

  async start(dwellerId: string, roomId: string, cwd: string, prompt: string, o: WorkOptions, attachments: Attachment[] = []): Promise<SessionSummary> {
    // el worktree de un trabajo nuevo lo crea el juego y la conversación arranca en él; si no puede (no es un repo, git
    // falla), lo intenta Claude Code al arrancar (--worktree)
    if (o.worktree && !o.resume && !o.cwd) {
      const name = typeof o.worktree === 'string' ? o.worktree : worktreeName(prompt.slice(0, 80) || (attachments[0] ? t('server.lookAt', { name: attachments[0].name }) : t('server.newJob')));
      try { o = { ...o, cwd: await createWorktree(cwd, name), worktree: undefined }; }
      catch (e) { console.warn('No se pudo crear el worktree; lo creará Claude Code:', (e as Error).message); o = { ...o, worktree: name }; }
    }
    const key = this.keyInSettings(o.cwd || cwd);
    if (key) throw new Error(t('server.yourClaudeCodeSettingsForce', { key: key }));
    if (o.resume && [...this.s.values()].some(x => x.alive && x.r.claudeId === o.resume)) throw new Error(t('server.thatConversationIsAlreadyRunning'));
    if (!existsSync(o.cwd || cwd)) throw new Error(t('server.theFolderDoesNotExist', { cwd: o.cwd || cwd }));
    const id = randomUUID();
    const r: SessionSummary = {
      id, dwellerId, roomId, cwd: o.cwd || cwd, state: 'starting', unread: false, title: prompt.slice(0, 80) || (attachments[0] ? t('server.lookAt', { name: attachments[0].name }) : t('server.newJob')),
      pendingCount: 0, helpers: [], tools: 0, turns: 0, model: o.model || undefined, effort: o.effort || undefined,
      permissionMode: o.permissions || 'auto', created: Date.now(), updated: Date.now(), claudeId: o.resume, handoffFrom: o.handoffFrom, handoffClaudeId: o.handoffClaudeId,
    };
    const x: Session = { r, alive: false, closing: false, interrupting: false, sent: new Map(), pending: [], queue: [], unsent: new Set(), withdrawn: new Set(), entries: [], tools: new Map(), helpers: new Map(), taskAHelper: new Map(), background: new Set(), awaitingBackground: false, commands: [], stderr: '', options: o, partialText: '', shipments: Promise.resolve() };
    this.s.set(id, x);
    if (o.resume) {
      try { const all = await this.transcript(o.resume, r.cwd); x.entries = all.slice(-RESUMED_ENTRIES); x.olderOnDisk = all.length > RESUMED_ENTRIES; } catch {}
      x.entries.push(this.input('system', t('server.conversationResumed')));
      try { const info = await getSessionInfo(o.resume, { dir: r.cwd }); if (info) r.title = info.customTitle || info.summary || r.title; } catch {}
    }
    if (this.trust(r.cwd) === 'no-trust') this.askTrust(x, o.resume);
    else this.launch(x, o.resume).catch(e => console.error('No se pudo lanzar la sesión:', e));
    if (prompt.trim() || attachments.length) { this.add(x, this.input('usuario', prompt, attachments.length ? { attachments } : {})); this.enqueue(x, prompt, attachments); }
    this.play(x);
    return r;
  }

  private optionsBase(x: Session, resume?: string): Options {
    const o = x.options;
    return {
      cwd: x.r.cwd,
      // la configuración de proyecto de una carpeta que no es de confianza (hooks, MCP, permisos) solo se carga si el
      // Supervisor lo ha dicho al empezar: ver confianza()
      settingSources: this.trust(x.r.cwd) === 'no-trust' && !x.loadProject ? ['user'] : ['user', 'project', 'local'],
      pathToClaudeCodeExecutable: this.claude,
      model: x.r.model || undefined,
      effort: (o.effort || undefined) as Options['effort'],
      permissionMode: (x.r.permissionMode || 'auto') as Options['permissionMode'],
      allowDangerouslySkipPermissions: x.r.permissionMode === 'bypassPermissions' ? true : undefined,
      resume: resume,
      extraArgs: o.worktree && !resume ? { worktree: typeof o.worktree === 'string' ? o.worktree : worktreeName(x.r.title) } : {},
      // el habitante puede entrar en un worktree a media conversación (lo crea él, EnterWorktree o hace cd a uno): la
      // conversación pasa a ser de ese worktree (sus rutas relativas, su holograma, compare_changes y los mensajes de su
      // tarea) y se retoma ahí: si no, al relanzarla (tras interrumpirla o reiniciar el juego) volvería a la copia principal
      hooks: {
        CwdChanged: [{ hooks: [async (h: any) => { const w = worktreeRoot(h.new_cwd); if (w && (w !== x.r.worktree || w !== x.r.cwd)) { x.r.worktree = w; x.r.cwd = w; this.play(x); } return {}; }] }],
        // the pre-flight gate: a `git merge` or `gh pr merge` from a task worktree without the compare validated at its
        // commit (or, unless a draft, without the «before pushing» list answered) asks the Overseer first; a no denies it
        // with what's missing. Pushes don't ask: the pre-flight is checked before merging. A hook, not canUseTool, so it
        // holds in every permission mode
        PreToolUse: [
          { matcher: 'Bash', hooks: [async (h: any) => this.mergeGate(x, String(h?.tool_input?.command ?? ''))] },
          // posting on a PR (a review, a comment, a reply) always asks the Overseer first, from any conversation: the Review
          // room's dwellers draft reviews, never publish them on their own
          { matcher: 'Bash', hooks: [async (h: any) => this.reviewGate(x, String(h?.tool_input?.command ?? ''))] },
          // worktrees come from send_to_room with a task key: `git worktree add` from a main copy is denied. One task,
          // one worktree: creating another for a task that already has one is denied, with the path of the one it has
          { matcher: 'Bash', hooks: [async (h: any) => {
            const cmd = String(h?.tool_input?.command ?? '');
            if (handMadeWorktree(cmd, x.r.worktree)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: t('server.worktreeViaTask') } };
            const w = newWorktreeOf(cmd);
            return w ? this.oneWorktree(x, w.cwd, path.basename(w.path ?? ''), w.branch) : {};
          }] },
          // nobody reads pull requests or issues in the original repo (README): opening one there asks the user first
          { matcher: 'Bash', hooks: [async (h: any) => this.originalRepoGate(x, String(h?.tool_input?.command ?? ''))] },
          { matcher: 'EnterWorktree', hooks: [async (h: any) => this.oneWorktree(x, undefined, String(h?.tool_input?.name ?? ''))] },
        ],
      },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ANNEX + (x.r.roomId === 'bridge' ? ' ' + bridgeAnnex() : x.r.roomId === 'git' ? ' ' + annexGit(this.resolver.reposOfShelter?.() ?? []) : '') },
      ...(x.r.roomId === 'git' ? { additionalDirectories: this.resolver.reposOfShelter?.() ?? [] } : {}),
      includePartialMessages: true,
      settings: { skillOverrides: Object.fromEntries(HIDDEN_SKILLS.map(n => [n, 'off' as const])), ...(this.resolver.autoCompactWindow?.() ? { autoCompactWindow: this.resolver.autoCompactWindow() } : {}), ...(withoutWorkConnectors(x.r.roomId) ? { disableClaudeAiConnectors: true } : {}) },
      env: { ...cleanEnvironment(), [CONVERSATION_MARK]: x.r.id },
      stderr: d => { x.stderr = (x.stderr + d).slice(-4000); },
    };
  }

  private async oneWorktree(x: Session, dir: string | undefined, name: string, branch?: string): Promise<Record<string, unknown>> {
    const task = worktreeTask({ path: name, branch });
    if (!task) return {};
    const cwd = path.resolve(x.r.worktree ?? x.r.cwd, dir ?? '.');
    const list = await new Promise<string>(ok => execFile('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { env: gitEnvironment(), timeout: 10_000 }, (e, o) => ok(e ? '' : String(o))));
    const already = taskWorktreeIn(list, task);
    if (!already) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: t('server.oneWorktreePerTask', { task: task, path: already.path, branch: already.branch ?? '' }) } };
  }

  private async originalRepoGate(x: Session, cmd: string): Promise<Record<string, unknown>> {
    const c = ghCreateOf(cmd);
    if (!c) return {};
    let repo = c.repo;
    if (!repo) {
      // without -R gh aims at the cwd's repo or, from a fork, at its parent
      const cwd = x.r.worktree ?? x.r.cwd;
      const remotes = await new Promise<string>(ok => execFile('git', ['-C', cwd, 'remote', '-v'], { env: gitEnvironment(), timeout: 10_000 }, (e, o) => ok(e ? '' : String(o))));
      const repos = [...new Set(remotes.split('\n').map(l => githubRepoOf(l.split(/\s+/)[1] ?? '')).filter((r): r is string => !!r))];
      for (const r of repos) {
        if (isOriginalRepo(r) || isOriginalRepo(await gh(['api', `repos/${r}`, '--jq', '.parent.full_name // ""'], undefined, 10_000).catch(() => ''))) { repo = ORIGINAL_REPO; break; }
      }
    }
    if (!repo || !isOriginalRepo(repo)) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: t('server.originalRepoNobodyReads', { repo: ORIGINAL_REPO }) } };
  }

  private async reviewGate(x: Session, cmd: string): Promise<Record<string, unknown>> {
    const post = reviewPostOf(cmd);
    if (!post) return {};
    if (await this.confirm(x, t('server.reviewPostTitle'), [{ type: 'code', text: cmd, language: 'bash' }])) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: t('server.reviewPostDenied') } };
  }

  private async mergeGate(x: Session, cmd: string): Promise<Record<string, unknown>> {
    const merge = mergeOf(cmd);
    if (!merge || !this.resolver.preflight) return {};
    const base = x.r.worktree ?? x.r.cwd;
    const cwd = merge.cwd ? path.resolve(base, merge.cwd.replace(/^~(?=\/|$)/, os.homedir())) : base;
    const g = await this.resolver.preflight.gate(cwd).catch(() => null);
    if (!g || !g.missing.length) return {};
    const si = await this.confirm(x, t('server.preflightMergeTitle', { key: g.key, branch: g.branch ?? '', head: (g.head ?? '').slice(0, 7) }),
      [{ type: 'text', text: g.missing.map(f => '• ' + f).join('\n') }, { type: 'code', text: cmd, language: 'bash' }]);
    if (si) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: t('server.preflightMergeDenied', { what: g.missing.join('; ') }) } };
  }

  private trust(cwd: string) { return trust(cwd, undefined, this.resolver.trustedFolders?.(), this.resolver.clonedFolders?.()); }

  // la carpeta trae configuración de proyecto y no es de confianza: se pregunta antes de lanzar (lo que se escriba
  // mientras tanto espera en la cola)
  private askTrust(x: Session, resume?: string) {
    const queue = new Queue<SDKUserMessage>();
    x.input = queue; x.trustWaiting = true;
    const pet: PendingRequest = {
      id: randomUUID(), type: 'trust', tool: 'trust', canAlways: true,
      title: t('server.trustThisFolder'),
      input: [
        { type: 'text', text: t('server.itCanRunCommandsWithout') },
        ...projectConfig(x.r.cwd).map(f => ({ type: 'path' as const, text: path.join(x.r.cwd, f) })),
      ],
    };
    const follow = (load: boolean) => {
      x.trustWaiting = false; x.loadProject = load;
      if (!x.closing) this.launch(x, resume, queue).catch(e => console.error('No se pudo lanzar la sesión:', e));
    };
    x.pending.push({ pet, input: {}, resolver: r => follow(r.behavior === 'allow') });
    this.add(x, this.input('system', `❓ ${pet.title}`));
    this.refreshPending(x);
    this.emit('wait', { ...x.r });
  }

  private async launch(x: Session, resume?: string, queue = new Queue<SDKUserMessage>()) {
    x.input = queue; x.alive = true; this.forgetBackground(x);
    // the game's self-gated servers as allow rules: in auto mode the classifier runs before canUseTool, and would judge them
    const options: Options = { ...this.optionsBase(x, resume), canUseTool: this.canUse(x), allowedTools: SELF_GATED.map(s => `mcp__${s}`) };
    // el habitante de Planificación (el tablero de tareas) trabaja con el MCP oficial de Linear (la clave, si la hay, va por el entorno)
    if (x.r.roomId === 'logistics' && active('linear')) {
      try { const { mcpLinear, environmentMcpLinear } = await import('./integrations/linear.ts'); options.mcpServers = { ...(options.mcpServers ?? {}), ...(await mcpLinear()) }; options.env = { ...options.env, ...(await environmentMcpLinear()) }; }
      catch (e) { console.warn('MCP de Linear no disponible:', (e as Error).message); }
    }
    // each game server keyed by its own name (mcpServers.ts): the key is the `mcp__<key>__` the session sees
    const servers = [
      this.resolver.mcpRoom?.(x.r.roomId),
      this.resolver.mcpAssignment?.(x.r.roomId, (title, input) => this.confirm(x, title, input), x.r.id),
      this.resolver.mcpPlan?.(x.r.roomId),
      // in a worktree (or starting a new one) it also gets request_worktree_cleanup
      this.resolver.mcpRooms?.(x.r.roomId, x.r.id, !!(x.r.worktree ?? worktreeRoot(x.r.cwd) ?? options.extraArgs?.worktree)),
      // the compare page of its changes, to review them with notes in the game before pushing (server/compare.ts)
      mcpReview(() => x.r.worktree ?? x.r.cwd, this.resolver.preflight),
    ];
    options.mcpServers = { ...(options.mcpServers ?? {}), ...Object.fromEntries(servers.flatMap(s => (s ? [[s.name, s]] : []))) };
    x.q = query({ prompt: queue, options: options });
    x.alive = true; x.closing = false;
    this.consume(x, x.q);
  }

  private message(content: string | Record<string, unknown>[], uuid: string = randomUUID()): SDKUserMessage {
    return { type: 'user', message: { role: 'user', content: content as any }, parent_tool_use_id: null, uuid: uuid as any, origin: { kind: 'human' } as any } as SDKUserMessage;
  }
  // a la cola de entrada de la sesión; con adjuntos, las imágenes van dentro del mensaje (attachments.ts). Returns its
  // uuid: Claude Code reports it in its command_lifecycle frames (lifecycle())
  private enqueue(x: Session, text: string, attachments: Attachment[]) {
    const queue = x.input!, uuid = randomUUID();
    x.unsent.add(uuid);
    const meter = (m: SDKUserMessage) => {
      x.unsent.delete(uuid);
      if (x.withdrawn.delete(uuid)) return;
      x.sent.set(uuid, text);
      if (x.sent.size > 20) x.sent.delete(x.sent.keys().next().value!);
      queue.meter(m);
    };
    if (!attachments.length || !this.attachments) x.shipments = x.shipments.then(() => meter(this.message(text, uuid)));
    else { const att = this.attachments; x.shipments = x.shipments.then(async () => meter(this.message(await att.content(text, attachments).catch(() => text), uuid))); }
    return uuid;
  }

  // to a busy conversation (a turn running, a question waiting, the folder's trust being asked) a message waits in its
  // queue, seen in the intercom, until Claude Code takes it (lifecycle()); otherwise it goes straight into the log
  send(id: string, text: string, attachments: Attachment[] = [], origin: MessageOrigin = { kind: 'overseer' }) {
    const x = this.must(id);
    if (x.r.state === 'closed') throw new Error(t('server.thatConversationIsClosedResume'));
    if (text.trim() === '/stop') return this.interrupt(id);
    const busy = x.trustWaiting || (x.alive && ['starting', 'working', 'waiting'].includes(x.r.state));
    if (!x.alive && !x.trustWaiting) this.launch(x, x.r.claudeId).catch(e => console.error('No se pudo reanudar la sesión:', e));
    x.textInTurn = x.askHeld = false;
    // replying is carrying on: the new-session notice goes
    if (x.r.handoff === 'offered') x.r.handoff = undefined;
    if (x.r.limit) { x.r.limit = undefined; if (x.r.claudeId) this.emit('limitCleared', x.r.claudeId); }
    const uuid = this.enqueue(x, text, attachments);
    if (busy) x.queue.push({ id: uuid, ts: Date.now(), text, origin, ...attachments.length ? { attachments } : {} });
    else this.add(x, this.logged(text, origin, attachments));
    x.r.state = x.pending.length ? 'waiting' : 'working'; x.r.unread = false;
    this.play(x);
  }
  private logged(text: string, origin: MessageOrigin, attachments?: Attachment[]) {
    return this.input('usuario', text, { ...attachments?.length ? { attachments } : {}, ...origin.kind !== 'overseer' ? { origin } : {} });
  }

  // Claude Code took a queued message (at a tool boundary or to start a turn): it moves into the log; or it was cancelled
  private lifecycle(x: Session, uuid: string, state: string) {
    const r = applyLifecycle(x.queue, uuid, state);
    if (r.queue === x.queue) return;
    x.queue = r.queue;
    if (r.taken) this.add(x, this.logged(r.taken.text, r.taken.origin, r.taken.attachments));
    this.play(x);
  }

  /** Take back a queued message the Overseer wrote, if Claude Code has not taken it yet: whether it was */
  async withdraw(id: string, messageId: string): Promise<boolean> {
    const x = this.must(id);
    const m = x.queue.find(q => q.id === messageId);
    if (!m || !withdrawable(m)) return false;
    // still being prepared, or still in the input the SDK has not read: never reaches Claude Code; else, from its queue
    const ok = x.unsent.has(messageId) ? (x.withdrawn.add(messageId), true)
      : x.input?.remove(u => u.uuid === messageId) || await ((x.q as any)?.cancelAsyncMessage?.(messageId) as Promise<boolean> | undefined)?.catch(() => false);
    if (!ok) return false;
    x.queue = x.queue.filter(q => q.id !== messageId);
    this.play(x);
    return true;
  }

  /** Enviar ya: takes a queued message back, interrupts the turn (as Ctrl C, which also cancels what else is queued) and
   *  sends it as a new one once the turn has stopped; false when it was already taken */
  async sendNow(id: string, messageId: string): Promise<boolean> {
    const x = this.must(id);
    const m = x.queue.find(q => q.id === messageId);
    if (!m || !(await this.withdraw(id, messageId))) return false;
    await this.interrupt(id);
    // the turn that was stopped may still be ending: wait for it, so the message starts a turn of its own
    for (let i = 0; i < 100 && x.alive && ['starting', 'working', 'waiting'].includes(x.r.state); i++) await new Promise(r => setTimeout(r, 100));
    this.send(id, m.text, m.attachments, m.origin);
    return true;
  }

  // a message the Overseer didn't type (another room, a scheduled one, CI): an idle conversation already past the urge
  // threshold is compacted first, so the new turn and the ones after it don't re-read the whole old context
  deliver(id: string, text: string, origin: MessageOrigin = { kind: 'game' }) {
    const x = this.must(id);
    if (['finished', 'idle'].includes(x.r.state) && (x.r.context?.used ?? 0) >= COMPACT_URGE) this.send(id, '/compact', [], { kind: 'game' });
    this.send(id, text, [], origin);
  }

  private async consume(x: Session, q: Query) {
    try { for await (const m of q) this.handle(x, m); }
    catch (err) {
      if (!x.closing) {
        const queue = x.stderr.trim().split('\n').slice(-6).join('\n');
        x.r.error = (err as Error).message;
        this.add(x, this.input('error', `${(err as Error).message}${queue ? `\n\n\`\`\`\n${queue}\n\`\`\`` : ''}`));
      }
    } finally {
      if (x.q === q) {
        x.alive = false;
        this.emptyPending(x, t('server.sessionEnded'));
        if (x.queue.length && !x.closing) this.add(x, this.input('system', t('server.queueNotDelivered', { texts: quotedList(x.queue.map(q => q.text)) })));
        x.queue = [];
        for (const a of x.helpers.values()) if (a.state === 'working') a.state = 'failed';
        if (x.awaitingBackground && x.r.state === 'working') x.r.state = 'finished';   // el turno ya había acabado bien
        this.forgetBackground(x);
        if (x.closing) { x.r.state = 'closed'; setTimeout(() => { this.s.delete(x.r.id); this.emit('removed', x.r.id); }, 30_000).unref(); }
        else if (x.r.state !== 'finished' && x.r.state !== 'idle' && x.limitHit !== undefined) this.limitStop(x);
        else if (x.r.state !== 'finished' && x.r.state !== 'idle') { x.r.state = 'error'; x.r.unread = true; x.r.error ??= t('server.sessionStoppedUnexpectedly'); }
        x.r.activity = undefined;
        this.play(x);
      }
    }
  }

  private handle(x: Session, m: SDKMessage) {
    const r = x.r;
    // not in the SDK's message types yet: what became of each message sent (queued, started, cancelled, completed)
    if ((m as any).type === 'command_lifecycle') { this.lifecycle(x, (m as any).command_uuid, (m as any).state); return; }
    switch (m.type) {
      case 'system': this.system(x, m as any); break;
      case 'stream_event': {
        // los fragmentos de texto viajan aparte (evento 'texto'); el resumen solo se emite si cambia la actividad
        const ev = (m as any).event;
        if ((m as any).parent_tool_use_id) return;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { x.partialText += ev.delta.text; if (ev.delta.text.trim()) x.textInTurn = true; this.emit('text', r.id, ev.delta.text); }
        else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') { if (r.activity?.mode !== 'think') { r.activity = { tool: '', text: t('windows.thinking'), mode: 'think' }; this.play(x); } }
        return;
      }
      case 'assistant': {
        const parent = m.parent_tool_use_id;
        for (const b of ((m.message?.content ?? []) as any[])) {
          if (b.type === 'text' && !parent && String(b.text).trim()) { x.partialText = ''; x.textInTurn = true; this.add(x, this.input('asistente', b.text)); r.lastText = b.text; }
          else if (b.type === 'thinking' && !parent) r.activity = { tool: '', text: t('windows.thinking'), mode: 'think' };
          else if (b.type === 'tool_use') this.onUseTool(x, b.id, b.name, b.input ?? {}, parent);
        }
        if ((m as any).error && !parent) {
          const error = String((m as any).error);
          const text = ((m.message?.content ?? []) as any[]).filter(b => b.type === 'text').map(b => String(b.text)).join('\n').trim();
          x.apiErrorInTurn = { error, text: text || error };
          if (error === 'rate_limit') x.limitHit ??= this.lastReset ?? 0;
          else this.add(x, this.input('error', t('server.apiError', { error })));
        }
        // un turno que empieza sin que lo mande el intercomunicador (lo que quedaba en cola, el aviso de una tarea en
        // segundo plano) también es trabajar: si no, se ve parado y Ctrl+C no lo para
        if (!parent && ['starting', 'finished', 'idle', 'error'].includes(r.state)) r.state = 'working';
        if (!parent) this.stopAwaiting(x);
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id) break;
        const c = m.message?.content;
        if (!Array.isArray(c)) break;
        for (const b of c as any[]) {
          if (b.type !== 'tool_result') continue;
          const h = x.tools.get(b.tool_use_id);
          if (h && isAgent(h.name)) { const a = x.helpers.get(b.tool_use_id); const res = (m as any).tool_use_result; if (a && res?.status !== 'async_launched') this.helperEnd(x, a.id, b.is_error ? 'failed' : 'done'); }
          if (b.is_error) {
            const txt = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((y: any) => y.text ?? '').join('\n') : '';
            const e = this.input('tool', t('server.toolFailed', { tool: h?.name ?? t('server.theTool') }), { tool: h?.name, isError: true });
            // the whole output on disk, the log only its size and first line (server/toolOutputs.ts)
            if (txt.trim()) { try { e.output = this.outputs ? this.outputs.save(r.id, e.id, txt) : undefined; } catch {} if (!e.output) e.detail = txt.slice(0, 2000); }
            this.add(x, e);
          }
        }
        break;
      }
      case 'result': {
        const res = m as any;
        r.turns += 1;
        x.textInTurn = x.askHeld = false;
        // for CLIs without lifecycle frames: what this turn consumed
        const consumed = takeConsumed(x.queue, res.user_message_uuids);
        if (consumed.taken.length) { x.queue = consumed.queue; for (const q of consumed.taken) this.add(x, this.logged(q.text, q.origin, q.attachments)); }
        if (typeof res.total_cost_usd === 'number') r.cost = res.total_cost_usd;
        // consumo: los tokens acumulados de todos los modelos y, aparte, cuánto contexto ocupa ya la conversación
        const uses = Object.values((res.modelUsage ?? {}) as Record<string, any>);
        if (uses.length) r.tokens = uses.reduce((n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0);
        this.measureContext(x);
        const seg = Math.round((res.duration_ms ?? 0) / 1000);
        const interrupted = x.interrupting;
        const apiError = x.apiErrorInTurn; x.apiErrorInTurn = undefined;
        if (x.interrupting) { x.interrupting = false; r.state = 'finished'; this.add(x, this.input('system', t('server.interrupted'))); }
        // the SDK may end a turn that only got an API error as a success: the error decides
        else if (x.limitHit !== undefined && (apiError || res.subtype !== 'success' || res.is_error)) this.limitStop(x);
        else if (apiError) { r.state = 'error'; r.error = apiError.text; this.add(x, this.input('error', t('server.theJobGotStuck', { by: apiError.text }))); }
        else if (res.subtype === 'success' && !res.is_error) { r.state = 'finished'; x.limitHit = undefined; if (res.result) r.lastText = res.result; this.add(x, this.input('result', t('server.doneInS', { sec: seg }))); }
        else { r.state = 'error'; const by = (res.errors as string[] | undefined)?.join('\n') || res.result || res.subtype; r.error = by; this.add(x, this.input('error', t('server.theJobGotStuck', { by: by }))); }
        r.unread = true; r.activity = undefined; x.partialText = '';
        if (x.pending.length) r.state = 'waiting';
        // con subagentes o terminales aún en segundo plano no ha terminado: sigue trabajando hasta que acaben
        else if (r.state === 'finished' && !interrupted && x.background.size) { r.state = 'working'; r.unread = false; x.awaitingBackground = true; }
        if (r.handoff === 'writing') {
          r.handoff = undefined;
          if (r.state !== 'error' && !interrupted && res.result?.trim()) this.emit('handoff', { ...r }, String(res.result));
        }
        this.refreshTitle(x);
        // la recompensa del refugio solo cuenta las herramientas de este turno y nunca un turno interrumpido o fallido
        const ofCurrent = interrupted || r.state === 'error' || r.limit ? 0 : r.tools - (x.toolsOnStartTurn ?? 0);
        x.toolsOnStartTurn = r.tools;
        this.emit('turn', { ...r, turnTools: ofCurrent });
        break;
      }
      case 'rate_limit_event': {
        const i = (m as any).rate_limit_info;
        if (stopsWork(i)) { this.lastReset = resetMs(i.resetsAt) ?? this.lastReset; x.limitHit = this.lastReset ?? 0; }
        this.emit('limit', i);
        break;
      }
    }
    this.play(x);
  }

  // la ventana de contexto ocupada (la del /context de Claude Code, en resumen: sin pedir recuentos a la API)
  private measureContext(x: Session) {
    x.q?.getContextUsage({ detail: 'summary' }).then(c => {
      if (!c?.maxTokens) return;
      x.r.context = { used: c.totalTokens, max: c.maxTokens, percentage: Math.round(c.percentage) };
      this.offerHandoff(x);
      this.play(x);
    }).catch(() => {});
  }

  // past the threshold, the intercom suggests a new session with a handoff, once per conversation and only once the turn
  // has ended (never mid-turn: the measure after a result lands when the state is already settled)
  private offerHandoff(x: Session) {
    const r = x.r, h = this.resolver.handoff;
    if (!h || !r.claudeId || r.handoff || !['finished', 'idle'].includes(r.state) || x.pending.length || x.queue.length) return;
    if (!handoffDue(r.context, h.threshold()) || h.offered(r.claudeId)) return;
    r.handoff = 'offered'; h.mark(r.claudeId);
  }

  /** «New session with a handoff»: the dweller writes the handoff summary in this conversation; when that turn ends the
   *  game starts the new session with it (the `handoff` event) and closes this one */
  handoff(id: string) {
    const x = this.must(id);
    if (!['finished', 'idle', 'error'].includes(x.r.state) || x.pending.length) throw new Error(t('server.handoffBusy'));
    this.send(id, t('prompt.handoff.write'), [], { kind: 'game' });
    x.r.handoff = 'writing'; this.play(x);
  }

  // the plan's usage windows, read through any live session (the /usage data, without its transcript scan): a
  // read-only call with the player's own login, no inference. null with no live session or if the SDK lacks it
  async planUsage(): Promise<Record<string, unknown> | null> {
    const q = this.live().find(x => x.q)?.q as any;
    const f = q?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof f !== 'function') return null;
    try { const r = await f.call(q, { skipBehaviors: true }); return r?.rate_limits_available ? r.rate_limits ?? null : null; } catch { return null; }
  }

  private stopAwaiting(x: Session) { x.awaitingBackground = false; clearTimeout(x.backgroundTimer); }
  private forgetBackground(x: Session) { this.stopAwaiting(x); x.background.clear(); x.r.background = undefined; }

  private system(x: Session, m: any) {
    const r = x.r;
    switch (m.subtype) {
      case 'init':
        if (m.apiKeySource && m.apiKeySource !== 'none') {
          this.add(x, this.input('error', t('server.thisSessionWasGoingTo', { apiKeySource: m.apiKeySource })));
          x.closing = true; x.q?.close(); return;
        }
        r.claudeId = m.session_id; r.cwd = m.cwd; r.model = m.model; r.permissionMode = m.permissionMode;
        r.worktree = worktreeRoot(m.cwd) ?? r.worktree;
        if (r.state === 'starting') r.state = 'working';
        this.measureContext(x);   // al retomar una conversación ya llega con contexto
        x.q?.supportedCommands().then(cs => { x.commands = cs.map(c => ({ name: c.name, description: c.description, hint: c.argumentHint || undefined })); this.emit('commands', r.id, x.commands); }).catch(() => {});
        break;
      case 'task_started': this.helperStart(x, m.tool_use_id ?? m.task_id, m.task_id, m.description, m.subagent_type); break;
      case 'task_progress': { const a = x.helpers.get(m.tool_use_id ?? x.taskAHelper.get(m.task_id) ?? ''); if (a) { if (m.last_tool_name) a.lastTool = a.lastTool ?? m.last_tool_name; if (m.usage?.tool_uses) a.tools = Math.max(a.tools, m.usage.tool_uses); } break; }
      case 'task_notification': { const id = m.tool_use_id ?? x.taskAHelper.get(m.task_id); if (id) this.helperEnd(x, id, m.status === 'completed' ? 'done' : 'failed'); break; }
      case 'task_updated': { const st = m.patch?.status; const id = x.taskAHelper.get(m.task_id); if (id && ['completed', 'failed', 'killed'].includes(st)) this.helperEnd(x, id, st === 'completed' ? 'done' : 'failed'); break; }
      case 'background_tasks_changed': {
        x.background = new Set(((m.tasks ?? []) as { task_id: string; ambient?: boolean }[]).filter(t => !t.ambient).map(t => t.task_id));
        r.background = x.background.size || undefined;
        // al acabar la última, Claude Code suele retomar el turno con su aviso (y ese turno acaba como siempre): solo si
        // no lo retoma enseguida se da por terminado aquí
        clearTimeout(x.backgroundTimer);
        if (!x.background.size && x.awaitingBackground) x.backgroundTimer = setTimeout(() => {
          if (!x.awaitingBackground || x.background.size || r.state !== 'working') return;
          x.awaitingBackground = false; r.state = 'finished'; r.unread = true; this.play(x);
        }, 5000).unref();
        break;
      }
      case 'session_state_changed': if (m.state === 'running' && r.state !== 'waiting') r.state = 'working'; break;
      case 'compact_boundary': this.add(x, this.input('system', t('server.conversationCompacted'))); this.measureContext(x); break;
      case 'local_command_output': this.add(x, this.input('system', String(m.content ?? ''))); break;
      case 'commands_changed': x.commands = (m.commands ?? []).map((c: any) => ({ name: c.name, description: c.description, hint: c.argumentHint || undefined })); this.emit('commands', r.id, x.commands); break;
    }
  }

  private onUseTool(x: Session, id: string, name: string, e: Record<string, unknown>, parent: string | null) {
    const r = x.r;
    const text = describeTool(name, e, r.cwd);
    x.tools.set(id, { name });
    r.tools += 1;
    if (parent) {
      const a = x.helpers.get(parent);
      if (a) {
        const filePath = toolPath(name, e, r.cwd);
        const room = filePath ? this.resolver.pathRoom(filePath) : undefined;
        if (room) a.roomId = room;
        if (toolMode(name, e) === 'write' || toolMode(name, e) === 'terminal') a.mode = 'write';
        a.lastTool = text; a.tools += 1;
      }
      this.add(x, this.input('tool', text, { tool: name, helper: parent }));
    } else {
      r.activity = { tool: name, text, mode: toolMode(name, e) };
      this.add(x, this.input('tool', text, { tool: name }));
    }
    if (isAgent(name)) this.helperStart(x, id, undefined, String(e.description ?? t('server.helpingOut')), e.subagent_type as string | undefined);
    this.emit('tool', r.id, r.roomId);
  }

  private helperStart(x: Session, id: string, task: string | undefined, description: string, type?: string) {
    if (task) x.taskAHelper.set(task, id);
    const already = x.helpers.get(id);
    if (already) { if (type) already.type = type; return; }
    x.helpers.set(id, { id, description, type, state: 'working', mode: 'read', roomId: x.r.roomId, tools: 0 });
  }
  private helperEnd(x: Session, id: string, state: 'done' | 'failed') {
    const a = x.helpers.get(id); if (!a || a.state !== 'working') return;
    a.state = state;
    setTimeout(() => { x.helpers.delete(id); this.play(x); }, 8000).unref();
  }

  // ---------------- permisos, preguntas y planes → jugador
  private canUse(x: Session): CanUseTool {
    return (name, e, op) => new Promise<PermissionResult>(resolver => {
      // the game's self-gated tools don't ask (mcpServers.ts): decor only touches that room's decor (validated data),
      // assignment confirms what it launches itself (confirmar()), review only reads the repo and writes its page in the
      // game's folder, and plan reads the plan and proposes changes to the planning room
      if (SELF_GATED.some(s => name.startsWith(`mcp__${s}__`))) { resolver({ behavior: 'allow', updatedInput: e }); return; }
      // a question with nothing written before it: the Overseer would answer without the results, conclusions or links
      // that only come after. Held back once per turn, so a real clarifying question still goes through on retry
      if (name === 'AskUserQuestion' && !op.agentID && !x.textInTurn && !x.askHeld) { x.askHeld = true; resolver({ behavior: 'deny', message: t('server.writeBeforeAsking') }); return; }
      const id = randomUUID();
      const ofHelper = op.agentID ? [...x.helpers.values()].find(a => a.id === op.agentID || x.taskAHelper.get(op.agentID!) === a.id)?.description ?? t('server.aHelper') : undefined;
      let pet: PendingRequest;
      if (name === 'AskUserQuestion') pet = { id, type: 'question', tool: name, title: t('server.iHaveAQuestion'), questions: (e.questions as Question[]) ?? [], canAlways: false, ofHelper };
      else if (name === 'ExitPlanMode') pet = { id, type: 'plan', tool: name, title: t('server.myPlanIsReady'), detail: String(e.plan ?? ''), canAlways: false, ofHelper };
      else pet = { id, type: 'permission', tool: name, title: permissionTitle(name, e), input: describeInput(name, e), reason: op.decisionReason || undefined, canAlways: Boolean(op.suggestions?.length) && !op.suppressAlwaysAllowRule, ofHelper };
      const p: Pending = { pet, input: e, suggestions: op.suggestions, resolver };
      x.pending.push(p);
      op.signal.addEventListener('abort', () => { const i = x.pending.indexOf(p); if (i >= 0) { x.pending.splice(i, 1); resolver({ behavior: 'deny', message: t('server.cancelled') }); this.refreshPending(x); } });
      this.add(x, this.input('system', `❓ ${pet.title}`));
      this.refreshPending(x);
      this.emit('wait', { ...x.r });
    });
  }

  /** Una confirmación del Supervisor que piden las herramientas del juego (sí o no), en el diálogo de permisos */
  private confirm(x: Session, title: string, input: InputView[]): Promise<boolean> {
    return new Promise(res => {
      const pet: PendingRequest = { id: randomUUID(), type: 'permission', tool: 'shelter', title, input, canAlways: false };
      x.pending.push({ pet, input: {}, resolver: r => res(r.behavior === 'allow') });
      this.add(x, this.input('system', `❓ ${title}`));
      this.refreshPending(x);
      this.emit('wait', { ...x.r });
    });
  }

  private refreshPending(x: Session) {
    if (x.pending.length) { x.r.state = 'waiting'; x.r.unread = true; }
    else if (x.r.state === 'waiting') x.r.state = x.alive ? 'working' : 'error';
    this.play(x);
  }
  private emptyPending(x: Session, message: string) { for (const p of x.pending.splice(0)) p.resolver({ behavior: 'deny', message: message }); }

  respond(id: string, requestId: string, decision: 'si' | 'always' | 'no', message?: string, responses?: Record<string, string>) {
    const x = this.must(id);
    const i = x.pending.findIndex(p => p.pet.id === requestId);
    if (i < 0) return;
    const [p] = x.pending.splice(i, 1);
    const type = p.pet.type;
    if (decision === 'no') {
      const by = message?.trim();
      p.resolver({ behavior: 'deny', message: by || (type === 'plan' ? t('server.userWantsToKeepPlanning') : t('server.userSaidNo')) });
      this.add(x, this.input('usuario', type === 'trust' ? t('server.noWorkWithoutFolderConfig') : by ? `🚫 ${by}` : t('server.no')));
    } else if (type === 'trust') {
      if (decision === 'always') this.resolver.trust?.(x.r.cwd);
      p.resolver({ behavior: 'allow', updatedInput: {} });
      this.add(x, this.input('usuario', decision === 'always' ? t('server.trustAlways') : t('server.trustOnce')));
    } else if (type === 'question') {
      p.resolver({ behavior: 'allow', updatedInput: { ...p.input, answers: responses ?? {} } });
      this.add(x, this.input('usuario', Object.entries(responses ?? {}).map(([q, a]) => `**${q}** → ${a}`).join('\n') || t('server.answered'), { question: true }));
    } else if (type === 'plan') {
      p.resolver({ behavior: 'allow', updatedInput: p.input });
      const mode = decision === 'always' ? 'acceptEdits' : 'auto';
      x.q?.setPermissionMode(mode as any).catch(() => {});
      x.r.permissionMode = mode;
      this.add(x, this.input('usuario', mode === 'acceptEdits' ? t('server.planApprovedAcceptEdits') : t('server.planApproved')));
    } else {
      p.resolver({ behavior: 'allow', updatedInput: p.input, updatedPermissions: decision === 'always' ? (p.suggestions as any) : undefined });
      this.add(x, this.input('usuario', decision === 'always' ? t('server.yesAlways') : t('server.yes')));
    }
    this.refreshPending(x);
  }

  async interrupt(id: string) {
    const x = this.must(id);
    if (!x.alive || (x.r.state !== 'working' && x.r.state !== 'waiting' && x.r.state !== 'starting')) return;
    // sin turno en marcha, solo con tareas en segundo plano: parar es pararlas (no llegará ningún «result»)
    if (x.awaitingBackground) {
      this.stopAwaiting(x);
      await Promise.all([...x.background].map(id => x.q?.stopTask(id).catch(() => {})));
      x.r.state = 'finished'; this.add(x, this.input('system', t('server.interrupted'))); this.play(x);
      return;
    }
    x.interrupting = true;
    this.emptyPending(x, t('server.interruptedByUser'));
    // parar es parar, como Esc en Claude Code: también se anula lo que se le mandó mientras trabajaba (si no, en
    // cuanto se interrumpe lo coge y sigue). `cancelQueued` lo admite el SDK aunque sus tipos aún no lo declaren.
    let receipt: { cancelled?: string[] } | undefined;
    try { receipt = await (x.q?.interrupt as (o?: { cancelQueued: boolean }) => Promise<typeof receipt>)?.call(x.q, { cancelQueued: true }); }
    catch { x.interrupting = false; return; }
    const voided = (receipt?.cancelled ?? []).map(u => x.sent.get(u)).filter((t): t is string => !!t);
    const cancelled = new Set(receipt?.cancelled ?? []);
    if (x.queue.some(q => cancelled.has(q.id))) { x.queue = x.queue.filter(q => !cancelled.has(q.id)); this.play(x); }
    if (voided.length) this.add(x, this.input('system', t('server.notSentDueToInterruption', { texts: quotedList(voided) })));
  }

  close(id: string) {
    const x = this.s.get(id); if (!x) return;
    x.closing = true; this.emptyPending(x, t('server.sessionClosed'));
    if (x.alive) { x.input?.close(); try { x.q?.close(); } catch {} }
    else { x.r.state = 'closed'; this.play(x); setTimeout(() => { this.s.delete(id); this.emit('removed', id); }, 1000).unref(); }
  }
  // the Overseer closing a conversation also stops what it started (dev servers, watchers, test runs), found while its
  // `claude` still lives; not when the game closes one (idle, a removed worktree), goes to the surface or restarts
  async closeAndStop(id: string) {
    const x = this.s.get(id); if (!x) return;
    const procs = x.alive && !x.closing ? await processesOf(id).catch(() => []) : [];
    stopProcesses(procs);
    if (procs.length) this.add(x, this.input('system', t('server.stoppedItsProcesses', { n: procs.length })));
    this.close(id);
  }
  closeAll() { for (const x of this.s.values()) this.close(x.r.id); }

  // Salir a la superficie: la conversación deja el juego para seguir en una terminal de tu escritorio. Si trabajaba
  // (o te esperaba), se interrumpe y fuera se le pide que siga; se cierra aquí y se espera a que su proceso termine,
  // porque dos Claude Code escribiendo la misma conversación la corromperían.
  async takeOut(id: string, where = t('server.aDesktopTerminal')) {
    const x = this.must(id);
    if (!x.r.claudeId) throw new Error(t('server.isStillStartingTakeIt', { title: x.r.title }));
    const busy = () => x.alive && ['starting', 'working', 'waiting'].includes(x.r.state);
    const continueLast = busy();
    if (continueLast) { await this.interrupt(id); await wait(() => !busy(), 10_000); }
    this.add(x, this.input('system', t('server.continuesIn', { where })));
    this.close(id);
    if (!(await wait(() => !x.alive, 8000))) throw new Error(t('server.isNotFinishingClosingIn', { title: x.r.title }));
    return { claudeId: x.r.claudeId, cwd: x.r.cwd, title: x.r.title, dwellerId: x.r.dwellerId, continueLast, model: x.options.model || undefined, effort: x.options.effort || undefined, permissions: x.r.permissionMode };
  }

  markRead(id: string) { const x = this.s.get(id); if (!x) return; x.r.unread = false; if (x.r.state === 'finished') x.r.state = 'idle'; this.play(x); }

  async mode(id: string, mode: string) { const x = this.must(id); try { await x.q?.setPermissionMode(mode as any); x.r.permissionMode = mode; this.play(x); } catch {} }

  // Pregunta lateral: no interrumpe ni entra en el historial. Usa el control interno side_question y, si no existe,
  // una bifurcación efímera sin herramientas.
  async lateral(id: string, question: string) {
    const x = this.must(id);
    x.r.lateral = { question, ts: Date.now() }; this.play(x);
    let answer: string | undefined;
    try {
      const f = (x.q as any)?.askSideQuestion;
      if (x.alive && typeof f === 'function') { const r = await f.call(x.q, question, {}); answer = r?.response; }
    } catch {}
    if (!answer && x.r.claudeId) {
      try {
        const q = query({ prompt: question, options: { ...this.optionsBase(x, x.r.claudeId), permissionMode: 'plan', allowDangerouslySkipPermissions: undefined, tools: [], disallowedTools: ['mcp__*'], forkSession: true, persistSession: false, maxTurns: 1, includePartialMessages: false, canUseTool: async () => ({ behavior: 'deny', message: t('server.sideQuestionNoTools') }) } as Options });
        for await (const m of q) if (m.type === 'result' && (m as any).subtype === 'success') answer = (m as any).result;
      } catch (e) { answer = t('server.couldNotAnswerSideQuestion', { error: (e as Error).message }); }
    }
    x.r.lateral = { question, answer: answer ?? t('server.noAnswer'), ts: Date.now() };
    this.add(x, this.input('lateral', `**${question}**\n\n${x.r.lateral.answer}`));
    this.play(x);
  }

  private async refreshTitle(x: Session) {
    if (!x.r.claudeId) return;
    try { const i = await getSessionInfo(x.r.claudeId, { dir: x.r.cwd }); const t = i?.customTitle || i?.summary; if (t && t !== x.r.title) { x.r.title = t; this.play(x); } } catch {}
  }

  // ---------------- historial (conversaciones reales de Claude Code de esa carpeta, también las de terminal)
  async history(dir: string, limit = 40): Promise<HistoryElement[]> {
    const list = await listSessions({ dir, limit: limit, includeProgrammatic: true });
    const live = new Map([...this.s.values()].filter(x => x.alive && x.r.claudeId).map(x => [x.r.claudeId!, x.r.id]));
    return list.filter(s => s.firstPrompt || s.summary || s.customTitle).map(s => ({
      claudeId: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || t('server.untitledConversation'), firstPrompt: s.firstPrompt,
      // la fecha del último mensaje, no la del archivo (abrirla en la app de Claude la toca sin escribir nada)
      // (puede estar en dos proyectos: la carpeta del repo y la del worktree donde se retomó; cuenta la más reciente)
      modified: Math.max(0, ...[...new Set([dir, s.cwd].filter(Boolean))].map(d => lastActivity(path.join(projectFolder(d!), s.sessionId + '.jsonl')) ?? 0)) || s.lastModified,
      // la que Claude Code se llevó de su worktree al repo principal sigue siendo de ese worktree (cwdBeforeRelocation)
      branch: s.gitBranch, cwd: (s.cwd && cwdBeforeRelocation(path.join(projectFolder(s.cwd), s.sessionId + '.jsonl'))) || s.cwd, inProgress: live.get(s.sessionId),
      ...s.tag === FORK_TAG ? { fork: true } : {},
    })).sort((a, b) => b.modified - a.modified);
  }

  // the last transcript read, for a while: paging up a long conversation reads it once, not once per page
  private lastTranscript?: { key: string; at: number; entries: Promise<LogInput[]> };
  /** A conversation's whole log, read from its transcript on disk; each entry's id comes from its message, the same in
   *  every reading (older pages follow on from the entries held) */
  transcript(claudeId: string, dir: string): Promise<LogInput[]> {
    const key = `${claudeId}\n${dir}`, now = Date.now();
    if (this.lastTranscript?.key === key && now - this.lastTranscript.at < TRANSCRIPT_CACHE_MS) return this.lastTranscript.entries;
    const entries = this.readTranscript(claudeId, dir);
    this.lastTranscript = { key, at: now, entries };
    entries.catch(() => { if (this.lastTranscript?.entries === entries) this.lastTranscript = undefined; });
    return entries;
  }
  private async readTranscript(claudeId: string, dir: string): Promise<LogInput[]> {
    const msgs = await getSessionMessages(claudeId, { dir });
    // cada mensaje con su hora real, no la de ahora: las páginas que enlazó y ya se revisaron no vuelven a quedar
    // pendientes al retomarla (shared/sessionPages.ts)
    const times = messageTimes(claudeId, dir);
    const out: LogInput[] = [];
    for (const m of msgs) {
      if (m.parent_tool_use_id) continue;
      const c = (m.message as any)?.content;
      const ts = times.get(m.uuid) ?? Date.now();
      if (m.type === 'user') { const t = userText(c); if (t) { const { text, attachments } = separateAttachments(t); out.push(this.input('usuario', text, { id: m.uuid, ts, ...(attachments.length ? { attachments } : {}) })); } }
      else if (m.type === 'assistant' && Array.isArray(c)) {
        c.forEach((b: any, k: number) => {
          const id = `${m.uuid}-${k}`;
          if (b.type === 'text' && b.text?.trim()) out.push(this.input('asistente', b.text, { id, ts }));
          else if (b.type === 'tool_use' && b.name) out.push(this.input('tool', describeTool(b.name, b.input ?? {}, dir), { id, tool: b.name, ts }));
        });
      }
    }
    return out;
  }
}

/** La hora de cada mensaje de una conversación (uuid → ms), del .jsonl de Claude Code: la carpeta del proyecto o, si
 *  se retomó en otra (un worktree), cualquiera que la tenga */
function messageTimes(claudeId: string, dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const root = path.dirname(projectFolder(dir));
  let file = path.join(projectFolder(dir), claudeId + '.jsonl');
  if (!existsSync(file)) { try { const d = readdirSync(root).find(x => existsSync(path.join(root, x, claudeId + '.jsonl'))); if (d) file = path.join(root, d, claudeId + '.jsonl'); } catch {} }
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"uuid"')) continue;
      try { const j = JSON.parse(line), ts = Date.parse(j.timestamp); if (typeof j.uuid === 'string' && Number.isFinite(ts)) out.set(j.uuid, ts); } catch {}
    }
  } catch {}
  return out;
}

async function wait(f: () => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (f()) return true;
  return f();
}

function userText(c: unknown): string | null {
  const t = typeof c === 'string' ? c : Array.isArray(c) ? (c as any[]).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n') : '';
  if (!t.trim()) return null;
  if (t.includes('<bash-input>')) return t.replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, (_, x: string) => '`! ' + x.trim() + '`').replace(/<bash-(stdout|stderr)>[\s\S]*?<\/bash-\1>/g, '').trim() || null;
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) return '`' + cmd[1].trim() + '`';
  if (/^\s*<(local-command|system-reminder|command-|task-notification)/.test(t) || t.startsWith('Caveat:')) return null;
  return t;
}
