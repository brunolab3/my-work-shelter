// Núcleo de sesiones: cada habitante que trabaja es una sesión REAL de Claude Code lanzada con el Agent SDK
// usando el binario `claude` instalado (hereda login, ajustes, CLAUDE.md, hooks y MCP del usuario).
// Una query() por sesión con entrada en streaming; los eventos se convierten en estado del habitante;
// canUseTool se enruta al jugador. Diseño inspirado en code-town/server/sessions.ts (MIT).
import os from 'node:os';
import path from 'node:path';
import { cwdBeforeRelocation, lastActivity, projectFolder } from './repos.ts';
import { mcpReview } from './comparar.ts';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { query, listSessions, getSessionMessages, getSessionInfo, type Query, type SDKMessage, type SDKUserMessage, type CanUseTool, type PermissionResult, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionSummary, LogInput, PendingRequest, Helper, WorkOptions, HistoryElement, Command, Question, Attachment, InputView } from '../shared/protocolo.ts';
import { separateAttachments, type Attachments } from './adjuntos.ts';
import { ROOMS_FOLDERS } from './estado.ts';
import { activa } from '../shared/fuentes.ts';
import { describeTool, describeInput, permissionTitle, toolMode, toolPath, isAgent } from './herramientas.ts';
import { t } from '../shared/idioma.ts';

const ANNEX = [
  'You are being driven from «work-shelter», a vault-management game UI where the user (the Overseer) talks to you through a dweller character.',
  'Your final message of each turn is shown in an in-world speech panel that the user can expand, so open it with a one-line summary of the outcome.',
  'Reply in the language the user writes in. Everything else works exactly like a normal Claude Code session.',
  'There is no tool to send files here: to share one (an HTML page, a screenshot, a PDF, a report), write its absolute path as a Markdown link, e.g. [compare](/Users/name/repo/tmp/compare.html).',
  'The user clicks it in the speech panel and the game opens it on the Mac (HTML in the browser, images and PDF in Preview, code in the editor, folders in the Finder), so never say a file could not be shared: link it.',
  'When the next step waits on the user (approve a push, post review comments or replies, make a commit, send or publish something, pick between options), do not end the turn with a statement:',
  'ask it with the AskUserQuestion tool, so the game shows it as a question waiting for them instead of finished work.',
].join(' ');

// el habitante del Puente de Mando trabaja en el repo del propio juego
const BRIDGE_ANNEX = [
  'This repository IS the game you are being driven from. Client changes (web/, shared/) can be applied live without killing sessions:',
  'when you finish such changes, tell the user to use «Aplicar los cambios del juego» in the panel of the «Puente de Mando» room (it rebuilds and reloads the client).',
  'Server changes (server/) need a restart: tell the user to choose «Reiniciar el juego» in the game menu (Esc) (it restarts the server and reloads the window without closing the game terminals); say so explicitly.',
  'Changes to electron/, the supervisor or ./shelter are also applied by «Reiniciar el juego» (the app reopens itself), and nothing is ever cached stale (the game revalidates every asset and clears its cache on launch):',
  'never ask the user to clear caches, reopen the app, reinstall it or run commands to see changes; those two options (or opening the app) are all they need, and if something still would not update, fix that in the game instead.',
  'Run `npx tsc --noEmit -p .` and `npm test` before finishing.',
].join(' ');

// La Octocat, en Control de Versiones, trabaja con git y GitHub en todos los repos del refugio (su carpeta es una propia)
const annexGit = (repos: string[]) => [
  'You live in the «Control de Versiones» room, the git and GitHub room of the game. The user\'s repositories in the game are:', (repos.join(', ') || 'none yet') + '.',
  'Work on them with git and the GitHub CLI (gh) when asked: commits, branches, history, conflicts, pull requests and reviews.',
  'Never force-push to a main branch, and ask before pushing, opening or merging pull requests, or publishing anything.',
].join(' ');

class Cola<T> implements AsyncIterable<T> {
  private items: T[] = []; private waits: ((r: IteratorResult<T>) => void)[] = []; private fin = false;
  meter(x: T) { if (this.fin) return; const w = this.waits.shift(); if (w) w({ value: x, done: false }); else this.items.push(x); }
  cerrar() { this.fin = true; for (const w of this.waits) w({ value: undefined as any, done: true }); this.waits = []; }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false }) : this.fin ? Promise.resolve({ value: undefined as any, done: true }) : new Promise(r => this.waits.push(r)) };
  }
}

interface Pending { pet: PendingRequest; entrada: Record<string, unknown>; sugerencias?: unknown[]; resolver: (r: PermissionResult) => void }

interface Session {
  r: SessionSummary;
  q?: Query; entrada?: Cola<SDKUserMessage>;
  viva: boolean; closing: boolean; interrupting: boolean; toolsOnStartTurn?: number;
  // lo último que se le ha mandado (uuid → texto), para decir qué mensajes en cola anula una interrupción
  sent: Map<string, string>;
  pendientes: Pending[];
  entradas: LogInput[];
  herramientas: Map<string, { nombre: string }>;
  ayudantes: Map<string, Helper>;
  taskAHelper: Map<string, string>;
  // tareas en segundo plano vivas (subagentes, terminales, monitores): con alguna, el turno acaba pero el trabajo no
  fondo: Set<string>; awaitingBackground: boolean; fondoTimer?: NodeJS.Timeout;
  comandos: Command[];
  stderr: string;
  opciones: WorkOptions;
  partialText: string;
  shipments: Promise<void>;   // los mensajes con imágenes tardan un poco en prepararse: salen en orden
  trustWaiting?: boolean; loadProject?: boolean;   // ver preguntarConfianza()
}

export interface RoomsResolver {
  pathRoom(ruta: string): string | undefined; reposOfShelter?(): string[];
  // las herramientas del juego para decorar la sala (server/decoradoSala.ts), en las salas de repo: un servidor MCP por sesión
  mcpRoom?(salaId: string): NonNullable<Options['mcpServers']>[string] | undefined;
  // las de repartir el trabajo (server/reparto.ts), en las salas de coordinación; preguntar: confirmación del Supervisor
  mcpAssignment?(salaId: string, preguntar: (titulo: string, entrada: InputView[]) => Promise<boolean>, sesionId: string): NonNullable<Options['mcpServers']>[string] | undefined;
  // las del plan compartido (leerlo y proponer cambios), en las salas que trabajan en una parte de un plan repartido
  mcpPlan?(salaId: string): NonNullable<Options['mcpServers']>[string] | undefined;
  // carpetas que el Supervisor ha marcado de confianza en el juego (ver confianza())
  trustedFolders?(): string[]; trust?(ruta: string): void;
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
const GAME_ROOT = path.resolve(import.meta.dirname, '..');
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
export function confianza(cwd: string, fileClaude = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json'), trusted: string[] = []): 'sin-config' | 'confiada' | 'sin-confianza' {
  const dir = path.resolve(cwd);
  if (!projectConfig(dir).length) return 'sin-config';
  if ([GAME_ROOT, ...FOLDERS_OF_GAME].some(r => dir === r || dir.startsWith(r + path.sep))) return 'confiada';
  let proyectos: Record<string, any> = {};
  try { proyectos = JSON.parse(readFileSync(fileClaude, 'utf8')).projects ?? {}; } catch {}
  const inGame = new Set(trusted.map(c => path.resolve(c)));
  for (let d = dir; ; d = path.dirname(d)) {
    if (proyectos[d]?.hasTrustDialogAccepted === true || inGame.has(d)) return 'confiada';
    if (path.dirname(d) === d) return 'sin-confianza';
  }
}

/** Nombre del worktree de un trabajo nuevo: la tarea en pocas palabras (se lee en la rama y en el holograma) y un
 *  sufijo para no chocar con otro de la misma tarea. */
export function nombreWorktree(tarea: string, ahora = Date.now()) {
  const palabras = tarea.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const p of palabras) { const n = slug ? `${slug}-${p}` : p; if (n.length > 32) break; slug = n; }
  const suffix = (ahora % 36 ** 4).toString(36).padStart(4, '0');
  return `shelter-${slug ? slug.slice(0, 32) + '-' : ''}${suffix}`;
}

export class Sessions extends EventEmitter {
  private s = new Map<string, Session>();
  claude = pathClaude();
  version = versionClaude(this.claude);
  constructor(private resolutor: RoomsResolver, private adjuntos?: Attachments) { super(); }

  lista() { return [...this.s.values()].map(x => x.r); }
  get(id: string) { return this.s.get(id); }
  vivas() { return [...this.s.values()].filter(x => x.viva); }
  private must(id: string) { const x = this.s.get(id); if (!x) throw new Error(t('server.unknownSession')); return x; }

  private lastEmission = new Map<string, { t: number; clave: string; timer?: NodeJS.Timeout }>();
  private tocar(x: Session) {
    x.r.actualizada = Date.now(); x.r.pendientes = x.pendientes.length; x.r.pending = x.pendientes[0]?.pet; x.r.ayudantes = [...x.ayudantes.values()];
    const clave = JSON.stringify([x.r.estado, x.r.actividad, x.r.pending?.id, x.r.pendientes, x.r.ayudantes, x.r.lastText?.length, x.r.sinLeer, x.r.titulo, x.r.error, x.r.lateral, x.r.modoPermisos, x.r.modelo, x.r.claudeId, x.r.turns, x.r.segundoPlano]);
    const u = this.lastEmission.get(x.r.id);
    if (u && u.clave === clave) return;
    const ahora = Date.now();
    const emitir = () => { const e = this.lastEmission.get(x.r.id); if (e) e.timer = undefined; this.lastEmission.set(x.r.id, { t: Date.now(), clave: JSON.stringify([x.r.estado, x.r.actividad, x.r.pending?.id, x.r.pendientes, x.r.ayudantes, x.r.lastText?.length, x.r.sinLeer, x.r.titulo, x.r.error, x.r.lateral, x.r.modoPermisos, x.r.modelo, x.r.claudeId, x.r.turns, x.r.segundoPlano]) }); this.emit('sesion', { ...x.r, ayudantes: x.r.ayudantes.map(a => ({ ...a })) }); };
    // los cambios de estado salen al momento; los de actividad, como mucho 8 por segundo
    if (!u || u.clave.split(',')[0] !== clave.split(',')[0] || ahora - u.t > 125) { if (u?.timer) clearTimeout(u.timer); emitir(); }
    else if (!u.timer) u.timer = setTimeout(emitir, 125);
  }
  private entrada(tipo: LogInput['tipo'], texto: string, extra: Partial<LogInput> = {}): LogInput { return { id: randomUUID(), ts: Date.now(), tipo, texto, ...extra }; }
  private anadir(x: Session, e: LogInput) { x.entradas.push(e); if (x.entradas.length > 1500) x.entradas.splice(0, x.entradas.length - 1500); this.emit('entradas', x.r.id, [e]); }

  cuaderno(id: string) { return this.must(id).entradas; }
  comandos(id: string) { return this.must(id).comandos; }

  // el init (que dice qué credencial se usa) no llega hasta el primer mensaje: antes de lanzar se mira que ningún
  // ajuste de Claude Code imponga una clave de API, para que ni el primer turno salga con ella
  private keyInSettings(cwd: string): string | null {
    const casa = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    for (const f of [path.join(casa, 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]) {
      try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j.apiKeyHelper) return `apiKeyHelper en ${f}`; if (j.env && (j.env.ANTHROPIC_API_KEY || j.env.ANTHROPIC_AUTH_TOKEN)) return `una clave en «env» de ${f}`; } catch {}
    }
    return null;
  }

  async empezar(dwellerId: string, salaId: string, cwd: string, prompt: string, o: WorkOptions, adjuntos: Attachment[] = []): Promise<SessionSummary> {
    const clave = this.keyInSettings(o.cwd || cwd);
    if (clave) throw new Error(t('server.yourClaudeCodeSettingsForce', { clave }));
    if (o.reanudar && [...this.s.values()].some(x => x.viva && x.r.claudeId === o.reanudar)) throw new Error(t('server.thatConversationIsAlreadyRunning'));
    if (!existsSync(o.cwd || cwd)) throw new Error(t('server.theFolderDoesNotExist', { cwd: o.cwd || cwd }));
    const id = randomUUID();
    const r: SessionSummary = {
      id, dwellerId, salaId, cwd: o.cwd || cwd, estado: 'arrancando', sinLeer: false, titulo: prompt.slice(0, 80) || (adjuntos[0] ? `Mira ${adjuntos[0].nombre}` : 'Trabajo nuevo'),
      pendientes: 0, ayudantes: [], herramientas: 0, turns: 0, modelo: o.modelo || undefined, esfuerzo: o.esfuerzo || undefined,
      modoPermisos: o.permisos || 'auto', created: Date.now(), actualizada: Date.now(), claudeId: o.reanudar,
    };
    const x: Session = { r, viva: false, closing: false, interrupting: false, sent: new Map(), pendientes: [], entradas: [], herramientas: new Map(), ayudantes: new Map(), taskAHelper: new Map(), fondo: new Set(), awaitingBackground: false, comandos: [], stderr: '', opciones: o, partialText: '', shipments: Promise.resolve() };
    this.s.set(id, x);
    if (o.reanudar) {
      try { x.entradas = await this.transcripcion(o.reanudar, r.cwd); } catch {}
      x.entradas.push(this.entrada('sistema', t('server.conversationResumed')));
      try { const info = await getSessionInfo(o.reanudar, { dir: r.cwd }); if (info) r.titulo = info.customTitle || info.summary || r.titulo; } catch {}
    }
    if (this.confianza(r.cwd) === 'sin-confianza') this.askTrust(x, o.reanudar);
    else this.lanzar(x, o.reanudar).catch(e => console.error('No se pudo lanzar la sesión:', e));
    if (prompt.trim() || adjuntos.length) { this.anadir(x, this.entrada('usuario', prompt, adjuntos.length ? { adjuntos } : {})); this.enqueue(x, prompt, adjuntos); }
    this.tocar(x);
    return r;
  }

  private optionsBase(x: Session, reanudar?: string): Options {
    const o = x.opciones;
    return {
      cwd: x.r.cwd,
      // la configuración de proyecto de una carpeta que no es de confianza (hooks, MCP, permisos) solo se carga si el
      // Supervisor lo ha dicho al empezar: ver confianza()
      settingSources: this.confianza(x.r.cwd) === 'sin-confianza' && !x.loadProject ? ['user'] : ['user', 'project', 'local'],
      pathToClaudeCodeExecutable: this.claude,
      model: x.r.modelo || undefined,
      effort: (o.esfuerzo || undefined) as Options['effort'],
      permissionMode: (x.r.modoPermisos || 'auto') as Options['permissionMode'],
      allowDangerouslySkipPermissions: x.r.modoPermisos === 'bypassPermissions' ? true : undefined,
      resume: reanudar,
      extraArgs: o.worktree && !reanudar ? { worktree: nombreWorktree(x.r.titulo) } : {},
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ANNEX + (x.r.salaId === 'puente' ? ' ' + BRIDGE_ANNEX : x.r.salaId === 'git' ? ' ' + annexGit(this.resolutor.reposOfShelter?.() ?? []) : '') },
      ...(x.r.salaId === 'git' ? { additionalDirectories: this.resolutor.reposOfShelter?.() ?? [] } : {}),
      includePartialMessages: true,
      env: cleanEnvironment(),
      stderr: d => { x.stderr = (x.stderr + d).slice(-4000); },
    };
  }

  private confianza(cwd: string) { return confianza(cwd, undefined, this.resolutor.trustedFolders?.()); }

  // la carpeta trae configuración de proyecto y no es de confianza: se pregunta antes de lanzar (lo que se escriba
  // mientras tanto espera en la cola)
  private askTrust(x: Session, reanudar?: string) {
    const queue = new Cola<SDKUserMessage>();
    x.entrada = queue; x.trustWaiting = true;
    const pet: PendingRequest = {
      id: randomUUID(), tipo: 'confianza', herramienta: 'confianza', canAlways: true,
      titulo: '¿Te fías de esta carpeta? Trae configuración de Claude Code',
      entrada: [
        { tipo: 'texto', texto: t('server.itCanRunCommandsWithout') },
        ...projectConfig(x.r.cwd).map(f => ({ tipo: 'ruta' as const, texto: path.join(x.r.cwd, f) })),
      ],
    };
    const seguir = (cargar: boolean) => {
      x.trustWaiting = false; x.loadProject = cargar;
      if (!x.closing) this.lanzar(x, reanudar, queue).catch(e => console.error('No se pudo lanzar la sesión:', e));
    };
    x.pendientes.push({ pet, entrada: {}, resolver: r => seguir(r.behavior === 'allow') });
    this.anadir(x, this.entrada('sistema', `❓ ${pet.titulo}`));
    this.refreshPending(x);
    this.emit('espera', { ...x.r });
  }

  private async lanzar(x: Session, reanudar?: string, queue = new Cola<SDKUserMessage>()) {
    x.entrada = queue; x.viva = true; this.forgetBackground(x);
    const opciones: Options = { ...this.optionsBase(x, reanudar), canUseTool: this.canUse(x) };
    // el habitante de Planificación (el tablero de tareas) trabaja con el MCP oficial de Linear (la clave, si la hay, va por el entorno)
    if (x.r.salaId === 'logistica' && activa('linear')) {
      try { const { mcpLinear, environmentMcpLinear } = await import('./integraciones/linear.ts'); opciones.mcpServers = { ...(opciones.mcpServers ?? {}), ...(await mcpLinear()) }; opciones.env = { ...opciones.env, ...(await environmentMcpLinear()) }; }
      catch (e) { console.warn('MCP de Linear no disponible:', (e as Error).message); }
    }
    const decorar = this.resolutor.mcpRoom?.(x.r.salaId);
    if (decorar) opciones.mcpServers = { ...(opciones.mcpServers ?? {}), refugio: decorar };
    const repartir = this.resolutor.mcpAssignment?.(x.r.salaId, (titulo, entrada) => this.confirmar(x, titulo, entrada), x.r.id);
    if (repartir) opciones.mcpServers = { ...(opciones.mcpServers ?? {}), reparto: repartir };
    const plan = this.resolutor.mcpPlan?.(x.r.salaId);
    if (plan) opciones.mcpServers = { ...(opciones.mcpServers ?? {}), plan };
    // la página de comparación de sus cambios, para revisarlos con notas en el juego antes de subirlos (server/comparar.ts)
    opciones.mcpServers = { ...(opciones.mcpServers ?? {}), revision: mcpReview(() => x.r.cwd) };
    x.q = query({ prompt: queue, options: opciones });
    x.viva = true; x.closing = false;
    this.consume(x, x.q);
  }

  private mensaje(contenido: string | Record<string, unknown>[]): SDKUserMessage {
    return { type: 'user', message: { role: 'user', content: contenido as any }, parent_tool_use_id: null, uuid: randomUUID() as any, origin: { kind: 'human' } as any } as SDKUserMessage;
  }
  // a la cola de entrada de la sesión; con adjuntos, las imágenes van dentro del mensaje (adjuntos.ts)
  private enqueue(x: Session, texto: string, adjuntos: Attachment[]) {
    const queue = x.entrada!;
    const meter = (m: SDKUserMessage) => {
      x.sent.set(m.uuid as string, texto);
      if (x.sent.size > 20) x.sent.delete(x.sent.keys().next().value!);
      queue.meter(m);
    };
    if (!adjuntos.length || !this.adjuntos) { x.shipments = x.shipments.then(() => meter(this.mensaje(texto))); return; }
    const adj = this.adjuntos;
    x.shipments = x.shipments.then(async () => meter(this.mensaje(await adj.contenido(texto, adjuntos).catch(() => texto))));
  }

  enviar(id: string, texto: string, adjuntos: Attachment[] = []) {
    const x = this.must(id);
    if (x.r.estado === 'cerrada') throw new Error(t('server.thatConversationIsClosedResume'));
    if (texto.trim() === '/stop') return this.interrumpir(id);
    if (!x.viva && !x.trustWaiting) this.lanzar(x, x.r.claudeId).catch(e => console.error('No se pudo reanudar la sesión:', e));
    this.anadir(x, this.entrada('usuario', texto, adjuntos.length ? { adjuntos } : {}));
    this.enqueue(x, texto, adjuntos);
    x.r.estado = x.pendientes.length ? 'esperando' : 'trabajando'; x.r.sinLeer = false;
    this.tocar(x);
  }

  private async consume(x: Session, q: Query) {
    try { for await (const m of q) this.manejar(x, m); }
    catch (err) {
      if (!x.closing) {
        const queue = x.stderr.trim().split('\n').slice(-6).join('\n');
        x.r.error = (err as Error).message;
        this.anadir(x, this.entrada('error', `${(err as Error).message}${queue ? `\n\n\`\`\`\n${queue}\n\`\`\`` : ''}`));
      }
    } finally {
      if (x.q === q) {
        x.viva = false;
        this.emptyPending(x, 'La sesión ha terminado.');
        for (const a of x.ayudantes.values()) if (a.estado === 'trabajando') a.estado = 'fallo';
        if (x.awaitingBackground && x.r.estado === 'trabajando') x.r.estado = 'terminada';   // el turno ya había acabado bien
        this.forgetBackground(x);
        if (x.closing) { x.r.estado = 'cerrada'; setTimeout(() => { this.s.delete(x.r.id); this.emit('fuera', x.r.id); }, 30_000).unref(); }
        else if (x.r.estado !== 'terminada' && x.r.estado !== 'ociosa') { x.r.estado = 'error'; x.r.sinLeer = true; x.r.error ??= 'La sesión se detuvo inesperadamente.'; }
        x.r.actividad = undefined;
        this.tocar(x);
      }
    }
  }

  private manejar(x: Session, m: SDKMessage) {
    const r = x.r;
    switch (m.type) {
      case 'system': this.sistema(x, m as any); break;
      case 'stream_event': {
        // los fragmentos de texto viajan aparte (evento 'texto'); el resumen solo se emite si cambia la actividad
        const ev = (m as any).event;
        if ((m as any).parent_tool_use_id) return;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { x.partialText += ev.delta.text; this.emit('texto', r.id, ev.delta.text); }
        else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') { if (r.actividad?.modo !== 'pensar') { r.actividad = { herramienta: '', texto: 'Pensando…', modo: 'pensar' }; this.tocar(x); } }
        return;
      }
      case 'assistant': {
        const padre = m.parent_tool_use_id;
        for (const b of ((m.message?.content ?? []) as any[])) {
          if (b.type === 'text' && !padre && String(b.text).trim()) { x.partialText = ''; this.anadir(x, this.entrada('asistente', b.text)); r.lastText = b.text; }
          else if (b.type === 'thinking' && !padre) r.actividad = { herramienta: '', texto: 'Pensando…', modo: 'pensar' };
          else if (b.type === 'tool_use') this.onUseTool(x, b.id, b.name, b.input ?? {}, padre);
        }
        if ((m as any).error && !padre) this.anadir(x, this.entrada('error', t('server.apiError', { error: (m as any).error })));
        // un turno que empieza sin que lo mande el intercomunicador (lo que quedaba en cola, el aviso de una tarea en
        // segundo plano) también es trabajar: si no, se ve parado y Ctrl+C no lo para
        if (!padre && ['arrancando', 'terminada', 'ociosa', 'error'].includes(r.estado)) r.estado = 'trabajando';
        if (!padre) this.stopAwaiting(x);
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id) break;
        const c = m.message?.content;
        if (!Array.isArray(c)) break;
        for (const b of c as any[]) {
          if (b.type !== 'tool_result') continue;
          const h = x.herramientas.get(b.tool_use_id);
          if (h && isAgent(h.nombre)) { const a = x.ayudantes.get(b.tool_use_id); const res = (m as any).tool_use_result; if (a && res?.status !== 'async_launched') this.helperEnd(x, a.id, b.is_error ? 'fallo' : 'hecho'); }
          if (b.is_error) {
            const t = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((y: any) => y.text ?? '').join('\n') : '';
            this.anadir(x, this.entrada('herramienta', `${h?.nombre ?? 'La herramienta'} ha fallado`, { herramienta: h?.nombre, detalle: t.slice(0, 2000), esError: true }));
          }
        }
        break;
      }
      case 'result': {
        const res = m as any;
        r.turns += 1;
        if (typeof res.total_cost_usd === 'number') r.coste = res.total_cost_usd;
        // consumo: los tokens acumulados de todos los modelos y, aparte, cuánto contexto ocupa ya la conversación
        const usos = Object.values((res.modelUsage ?? {}) as Record<string, any>);
        if (usos.length) r.tokens = usos.reduce((n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0);
        this.measureContext(x);
        const seg = Math.round((res.duration_ms ?? 0) / 1000);
        const interrupted = x.interrupting;
        if (x.interrupting) { x.interrupting = false; r.estado = 'terminada'; this.anadir(x, this.entrada('sistema', '✋ Interrumpido')); }
        else if (res.subtype === 'success' && !res.is_error) { r.estado = 'terminada'; if (res.result) r.lastText = res.result; this.anadir(x, this.entrada('resultado', t('server.doneInS', { seg }))); }
        else { r.estado = 'error'; const por = (res.errors as string[] | undefined)?.join('\n') || res.result || res.subtype; r.error = por; this.anadir(x, this.entrada('error', t('server.theJobGotStuck', { por }))); }
        r.sinLeer = true; r.actividad = undefined; x.partialText = '';
        if (x.pendientes.length) r.estado = 'esperando';
        // con subagentes o terminales aún en segundo plano no ha terminado: sigue trabajando hasta que acaben
        else if (r.estado === 'terminada' && !interrupted && x.fondo.size) { r.estado = 'trabajando'; r.sinLeer = false; x.awaitingBackground = true; }
        this.refreshTitle(x);
        // la recompensa del refugio solo cuenta las herramientas de este turno y nunca un turno interrumpido o fallido
        const ofCurrent = interrupted || r.estado === 'error' ? 0 : r.herramientas - (x.toolsOnStartTurn ?? 0);
        x.toolsOnStartTurn = r.herramientas;
        this.emit('turno', { ...r, turnTools: ofCurrent });
        break;
      }
      case 'rate_limit_event': this.emit('limite', (m as any).rate_limit_info); break;
    }
    this.tocar(x);
  }

  // la ventana de contexto ocupada (la del /context de Claude Code, en resumen: sin pedir recuentos a la API)
  private measureContext(x: Session) {
    x.q?.getContextUsage({ detail: 'summary' }).then(c => {
      if (!c?.maxTokens) return;
      x.r.contexto = { usados: c.totalTokens, maximo: c.maxTokens, porcentaje: Math.round(c.percentage) };
      this.tocar(x);
    }).catch(() => {});
  }

  private stopAwaiting(x: Session) { x.awaitingBackground = false; clearTimeout(x.fondoTimer); }
  private forgetBackground(x: Session) { this.stopAwaiting(x); x.fondo.clear(); x.r.segundoPlano = undefined; }

  private sistema(x: Session, m: any) {
    const r = x.r;
    switch (m.subtype) {
      case 'init':
        if (m.apiKeySource && m.apiKeySource !== 'none') {
          this.anadir(x, this.entrada('error', t('server.thisSessionWasGoingTo', { apiKeySource: m.apiKeySource })));
          x.closing = true; x.q?.close(); return;
        }
        r.claudeId = m.session_id; r.cwd = m.cwd; r.modelo = m.model; r.modoPermisos = m.permissionMode;
        if (m.cwd && /\/\.claude\/worktrees\//.test(m.cwd)) r.worktree = m.cwd;
        if (r.estado === 'arrancando') r.estado = 'trabajando';
        this.measureContext(x);   // al retomar una conversación ya llega con contexto
        x.q?.supportedCommands().then(cs => { x.comandos = cs.map(c => ({ nombre: c.name, descripcion: c.description, pista: c.argumentHint || undefined })); this.emit('comandos', r.id, x.comandos); }).catch(() => {});
        break;
      case 'task_started': this.helperStart(x, m.tool_use_id ?? m.task_id, m.task_id, m.description, m.subagent_type); break;
      case 'task_progress': { const a = x.ayudantes.get(m.tool_use_id ?? x.taskAHelper.get(m.task_id) ?? ''); if (a) { if (m.last_tool_name) a.lastTool = a.lastTool ?? m.last_tool_name; if (m.usage?.tool_uses) a.herramientas = Math.max(a.herramientas, m.usage.tool_uses); } break; }
      case 'task_notification': { const id = m.tool_use_id ?? x.taskAHelper.get(m.task_id); if (id) this.helperEnd(x, id, m.status === 'completed' ? 'hecho' : 'fallo'); break; }
      case 'task_updated': { const st = m.patch?.status; const id = x.taskAHelper.get(m.task_id); if (id && ['completed', 'failed', 'killed'].includes(st)) this.helperEnd(x, id, st === 'completed' ? 'hecho' : 'fallo'); break; }
      case 'background_tasks_changed': {
        x.fondo = new Set(((m.tasks ?? []) as { task_id: string; ambient?: boolean }[]).filter(t => !t.ambient).map(t => t.task_id));
        r.segundoPlano = x.fondo.size || undefined;
        // al acabar la última, Claude Code suele retomar el turno con su aviso (y ese turno acaba como siempre): solo si
        // no lo retoma enseguida se da por terminado aquí
        clearTimeout(x.fondoTimer);
        if (!x.fondo.size && x.awaitingBackground) x.fondoTimer = setTimeout(() => {
          if (!x.awaitingBackground || x.fondo.size || r.estado !== 'trabajando') return;
          x.awaitingBackground = false; r.estado = 'terminada'; r.sinLeer = true; this.tocar(x);
        }, 5000).unref();
        break;
      }
      case 'session_state_changed': if (m.state === 'running' && r.estado !== 'esperando') r.estado = 'trabajando'; break;
      case 'compact_boundary': this.anadir(x, this.entrada('sistema', t('server.conversationCompacted'))); this.measureContext(x); break;
      case 'local_command_output': this.anadir(x, this.entrada('sistema', String(m.content ?? ''))); break;
      case 'commands_changed': x.comandos = (m.commands ?? []).map((c: any) => ({ nombre: c.name, descripcion: c.description, pista: c.argumentHint || undefined })); this.emit('comandos', r.id, x.comandos); break;
    }
  }

  private onUseTool(x: Session, id: string, nombre: string, e: Record<string, unknown>, padre: string | null) {
    const r = x.r;
    const texto = describeTool(nombre, e, r.cwd);
    x.herramientas.set(id, { nombre });
    r.herramientas += 1;
    if (padre) {
      const a = x.ayudantes.get(padre);
      if (a) {
        const ruta = toolPath(nombre, e, r.cwd);
        const sala = ruta ? this.resolutor.pathRoom(ruta) : undefined;
        if (sala) a.salaId = sala;
        if (toolMode(nombre, e) === 'escribir' || toolMode(nombre, e) === 'terminal') a.modo = 'escribir';
        a.lastTool = texto; a.herramientas += 1;
      }
      this.anadir(x, this.entrada('herramienta', texto, { herramienta: nombre, ayudante: padre }));
    } else {
      r.actividad = { herramienta: nombre, texto, modo: toolMode(nombre, e) };
      this.anadir(x, this.entrada('herramienta', texto, { herramienta: nombre }));
    }
    if (isAgent(nombre)) this.helperStart(x, id, undefined, String(e.description ?? 'Echando una mano'), e.subagent_type as string | undefined);
    this.emit('herramienta', r.id, r.salaId);
  }

  private helperStart(x: Session, id: string, tarea: string | undefined, descripcion: string, tipo?: string) {
    if (tarea) x.taskAHelper.set(tarea, id);
    const ya = x.ayudantes.get(id);
    if (ya) { if (tipo) ya.tipo = tipo; return; }
    x.ayudantes.set(id, { id, descripcion, tipo, estado: 'trabajando', modo: 'leer', salaId: x.r.salaId, herramientas: 0 });
  }
  private helperEnd(x: Session, id: string, estado: 'hecho' | 'fallo') {
    const a = x.ayudantes.get(id); if (!a || a.estado !== 'trabajando') return;
    a.estado = estado;
    setTimeout(() => { x.ayudantes.delete(id); this.tocar(x); }, 8000).unref();
  }

  // ---------------- permisos, preguntas y planes → jugador
  private canUse(x: Session): CanUseTool {
    return (nombre, e, op) => new Promise<PermissionResult>(resolver => {
      // las del juego para decorar la propia sala no piden permiso: solo tocan el decorado de esa sala (datos validados)
      if (nombre.startsWith('mcp__refugio__')) { resolver({ behavior: 'allow', updatedInput: e }); return; }
      // las de reparto confirman ellas mismas lo que lanzan (confirmar()), con el trabajo ya resuelto a sus salas
      if (nombre.startsWith('mcp__reparto__')) { resolver({ behavior: 'allow', updatedInput: e }); return; }
      // la comparación solo lee el repo y escribe su página en la carpeta del juego
      if (nombre.startsWith('mcp__revision__')) { resolver({ behavior: 'allow', updatedInput: e }); return; }
      if (nombre.startsWith('mcp__plan__')) { resolver({ behavior: 'allow', updatedInput: e }); return; }   // leer el plan y proponer cambios: a la sala de planificación, no fuera
      const id = randomUUID();
      const ofHelper = op.agentID ? [...x.ayudantes.values()].find(a => a.id === op.agentID || x.taskAHelper.get(op.agentID!) === a.id)?.descripcion ?? 'un ayudante' : undefined;
      let pet: PendingRequest;
      if (nombre === 'AskUserQuestion') pet = { id, tipo: 'pregunta', herramienta: nombre, titulo: 'Tengo una pregunta para ti', preguntas: (e.questions as Question[]) ?? [], canAlways: false, ofHelper };
      else if (nombre === 'ExitPlanMode') pet = { id, tipo: 'plan', herramienta: nombre, titulo: 'Mi plan está listo para que lo revises', detalle: String(e.plan ?? ''), canAlways: false, ofHelper };
      else pet = { id, tipo: 'permiso', herramienta: nombre, titulo: permissionTitle(nombre, e), entrada: describeInput(nombre, e), motivo: op.decisionReason || undefined, canAlways: Boolean(op.suggestions?.length) && !op.suppressAlwaysAllowRule, ofHelper };
      const p: Pending = { pet, entrada: e, sugerencias: op.suggestions, resolver };
      x.pendientes.push(p);
      op.signal.addEventListener('abort', () => { const i = x.pendientes.indexOf(p); if (i >= 0) { x.pendientes.splice(i, 1); resolver({ behavior: 'deny', message: 'Cancelado.' }); this.refreshPending(x); } });
      this.anadir(x, this.entrada('sistema', `❓ ${pet.titulo}`));
      this.refreshPending(x);
      this.emit('espera', { ...x.r });
    });
  }

  /** Una confirmación del Supervisor que piden las herramientas del juego (sí o no), en el diálogo de permisos */
  private confirmar(x: Session, titulo: string, entrada: InputView[]): Promise<boolean> {
    return new Promise(res => {
      const pet: PendingRequest = { id: randomUUID(), tipo: 'permiso', herramienta: 'refugio', titulo, entrada, canAlways: false };
      x.pendientes.push({ pet, entrada: {}, resolver: r => res(r.behavior === 'allow') });
      this.anadir(x, this.entrada('sistema', `❓ ${titulo}`));
      this.refreshPending(x);
      this.emit('espera', { ...x.r });
    });
  }

  private refreshPending(x: Session) {
    if (x.pendientes.length) { x.r.estado = 'esperando'; x.r.sinLeer = true; }
    else if (x.r.estado === 'esperando') x.r.estado = x.viva ? 'trabajando' : 'error';
    this.tocar(x);
  }
  private emptyPending(x: Session, mensaje: string) { for (const p of x.pendientes.splice(0)) p.resolver({ behavior: 'deny', message: mensaje }); }

  responder(id: string, peticionId: string, decision: 'si' | 'siempre' | 'no', mensaje?: string, responses?: Record<string, string>) {
    const x = this.must(id);
    const i = x.pendientes.findIndex(p => p.pet.id === peticionId);
    if (i < 0) return;
    const [p] = x.pendientes.splice(i, 1);
    const t = p.pet.tipo;
    if (decision === 'no') {
      const por = mensaje?.trim();
      p.resolver({ behavior: 'deny', message: por || (t === 'plan' ? 'El usuario quiere seguir planificando.' : 'El usuario ha dicho que no.') });
      this.anadir(x, this.entrada('usuario', t === 'confianza' ? '🚫 No: se trabaja sin la configuración de la carpeta' : por ? `🚫 ${por}` : '🚫 No'));
    } else if (t === 'confianza') {
      if (decision === 'siempre') this.resolutor.trust?.(x.r.cwd);
      p.resolver({ behavior: 'allow', updatedInput: {} });
      this.anadir(x, this.entrada('usuario', decision === 'siempre' ? '✅ Me fío de esta carpeta (no vuelvas a preguntar)' : '✅ Me fío, esta vez'));
    } else if (t === 'pregunta') {
      p.resolver({ behavior: 'allow', updatedInput: { ...p.entrada, answers: responses ?? {} } });
      this.anadir(x, this.entrada('usuario', Object.entries(responses ?? {}).map(([q, a]) => `**${q}** → ${a}`).join('\n') || '(respondido)'));
    } else if (t === 'plan') {
      p.resolver({ behavior: 'allow', updatedInput: p.entrada });
      const modo = decision === 'siempre' ? 'acceptEdits' : 'auto';
      x.q?.setPermissionMode(modo as any).catch(() => {});
      x.r.modoPermisos = modo;
      this.anadir(x, this.entrada('usuario', modo === 'acceptEdits' ? '✅ Plan aprobado (edita sin preguntar)' : '✅ Plan aprobado'));
    } else {
      p.resolver({ behavior: 'allow', updatedInput: p.entrada, updatedPermissions: decision === 'siempre' ? (p.sugerencias as any) : undefined });
      this.anadir(x, this.entrada('usuario', decision === 'siempre' ? '✅ Sí, y no vuelvas a preguntar' : '✅ Sí'));
    }
    this.refreshPending(x);
  }

  async interrumpir(id: string) {
    const x = this.must(id);
    if (!x.viva || (x.r.estado !== 'trabajando' && x.r.estado !== 'esperando' && x.r.estado !== 'arrancando')) return;
    // sin turno en marcha, solo con tareas en segundo plano: parar es pararlas (no llegará ningún «result»)
    if (x.awaitingBackground) {
      this.stopAwaiting(x);
      await Promise.all([...x.fondo].map(id => x.q?.stopTask(id).catch(() => {})));
      x.r.estado = 'terminada'; this.anadir(x, this.entrada('sistema', '✋ Interrumpido')); this.tocar(x);
      return;
    }
    x.interrupting = true;
    this.emptyPending(x, 'Interrumpido por el usuario.');
    // parar es parar, como Esc en Claude Code: también se anula lo que se le mandó mientras trabajaba (si no, en
    // cuanto se interrumpe lo coge y sigue). `cancelQueued` lo admite el SDK aunque sus tipos aún no lo declaren.
    let receipt: { cancelled?: string[] } | undefined;
    try { receipt = await (x.q?.interrupt as (o?: { cancelQueued: boolean }) => Promise<typeof receipt>)?.call(x.q, { cancelQueued: true }); }
    catch { x.interrupting = false; return; }
    const voided = (receipt?.cancelled ?? []).map(u => x.sent.get(u)).filter((t): t is string => !!t);
    if (voided.length) this.anadir(x, this.entrada('sistema', `Sin enviar por la interrupción (mándalo otra vez si quieres): ${voided.map(t => `«${t.length > 120 ? `${t.slice(0, 120)}…` : t}»`).join(', ')}`));
  }

  cerrar(id: string) {
    const x = this.s.get(id); if (!x) return;
    x.closing = true; this.emptyPending(x, 'Sesión cerrada.');
    if (x.viva) { x.entrada?.cerrar(); try { x.q?.close(); } catch {} }
    else { x.r.estado = 'cerrada'; this.tocar(x); setTimeout(() => { this.s.delete(id); this.emit('fuera', id); }, 1000).unref(); }
  }
  cerrarTodas() { for (const x of this.s.values()) this.cerrar(x.r.id); }

  // Salir a la superficie: la conversación deja el juego para seguir en una terminal de tu escritorio. Si trabajaba
  // (o te esperaba), se interrumpe y fuera se le pide que siga; se cierra aquí y se espera a que su proceso termine,
  // porque dos Claude Code escribiendo la misma conversación la corromperían.
  async sacar(id: string, where = 'una terminal de tu escritorio') {
    const x = this.must(id);
    if (!x.r.claudeId) throw new Error(t('server.isStillStartingTakeIt', { titulo: x.r.titulo }));
    const busy = () => x.viva && ['arrancando', 'trabajando', 'esperando'].includes(x.r.estado);
    const continuar = busy();
    if (continuar) { await this.interrumpir(id); await wait(() => !busy(), 10_000); }
    this.anadir(x, this.entrada('sistema', t('server.continuesIn', { where })));
    this.cerrar(id);
    if (!(await wait(() => !x.viva, 8000))) throw new Error(t('server.isNotFinishingClosingIn', { titulo: x.r.titulo }));
    return { claudeId: x.r.claudeId, cwd: x.r.cwd, titulo: x.r.titulo, dwellerId: x.r.dwellerId, continuar, modelo: x.opciones.modelo || undefined, esfuerzo: x.opciones.esfuerzo || undefined, permisos: x.r.modoPermisos };
  }

  leida(id: string) { const x = this.s.get(id); if (!x) return; x.r.sinLeer = false; if (x.r.estado === 'terminada') x.r.estado = 'ociosa'; this.tocar(x); }

  async modo(id: string, modo: string) { const x = this.must(id); try { await x.q?.setPermissionMode(modo as any); x.r.modoPermisos = modo; this.tocar(x); } catch {} }

  // Pregunta lateral: no interrumpe ni entra en el historial. Usa el control interno side_question y, si no existe,
  // una bifurcación efímera sin herramientas.
  async lateral(id: string, pregunta: string) {
    const x = this.must(id);
    x.r.lateral = { pregunta, ts: Date.now() }; this.tocar(x);
    let respuesta: string | undefined;
    try {
      const f = (x.q as any)?.askSideQuestion;
      if (x.viva && typeof f === 'function') { const r = await f.call(x.q, pregunta, {}); respuesta = r?.response; }
    } catch {}
    if (!respuesta && x.r.claudeId) {
      try {
        const q = query({ prompt: pregunta, options: { ...this.optionsBase(x, x.r.claudeId), permissionMode: 'plan', allowDangerouslySkipPermissions: undefined, tools: [], disallowedTools: ['mcp__*'], forkSession: true, persistSession: false, maxTurns: 1, includePartialMessages: false, canUseTool: async () => ({ behavior: 'deny', message: 'Pregunta lateral: sin herramientas.' }) } as Options });
        for await (const m of q) if (m.type === 'result' && (m as any).subtype === 'success') respuesta = (m as any).result;
      } catch (e) { respuesta = `No he podido responder la pregunta lateral: ${(e as Error).message}`; }
    }
    x.r.lateral = { pregunta, respuesta: respuesta ?? '(sin respuesta)', ts: Date.now() };
    this.anadir(x, this.entrada('lateral', `**${pregunta}**\n\n${x.r.lateral.respuesta}`));
    this.tocar(x);
  }

  private async refreshTitle(x: Session) {
    if (!x.r.claudeId) return;
    try { const i = await getSessionInfo(x.r.claudeId, { dir: x.r.cwd }); const t = i?.customTitle || i?.summary; if (t && t !== x.r.titulo) { x.r.titulo = t; this.tocar(x); } } catch {}
  }

  // ---------------- historial (conversaciones reales de Claude Code de esa carpeta, también las de terminal)
  async historial(dir: string, limite = 40): Promise<HistoryElement[]> {
    const lista = await listSessions({ dir, limit: limite, includeProgrammatic: true });
    const vivas = new Map([...this.s.values()].filter(x => x.viva && x.r.claudeId).map(x => [x.r.claudeId!, x.r.id]));
    return lista.filter(s => s.firstPrompt || s.summary || s.customTitle).map(s => ({
      claudeId: s.sessionId, titulo: s.customTitle || s.summary || s.firstPrompt || 'Conversación sin título', primerPrompt: s.firstPrompt,
      // la fecha del último mensaje, no la del archivo (abrirla en la app de Claude la toca sin escribir nada)
      // (puede estar en dos proyectos: la carpeta del repo y la del worktree donde se retomó; cuenta la más reciente)
      modified: Math.max(0, ...[...new Set([dir, s.cwd].filter(Boolean))].map(d => lastActivity(path.join(projectFolder(d!), s.sessionId + '.jsonl')) ?? 0)) || s.lastModified,
      // la que Claude Code se llevó de su worktree al repo principal sigue siendo de ese worktree (cwdBeforeRelocation)
      rama: s.gitBranch, cwd: (s.cwd && cwdBeforeRelocation(path.join(projectFolder(s.cwd), s.sessionId + '.jsonl'))) || s.cwd, enCurso: vivas.get(s.sessionId),
    })).sort((a, b) => b.modified - a.modified);
  }

  async transcripcion(claudeId: string, dir: string): Promise<LogInput[]> {
    const msgs = await getSessionMessages(claudeId, { dir });
    // cada mensaje con su hora real, no la de ahora: las páginas que enlazó y ya se revisaron no vuelven a quedar
    // pendientes al retomarla (shared/paginasSesion.ts)
    const horas = messageTimes(claudeId, dir);
    const out: LogInput[] = [];
    for (const m of msgs) {
      if (m.parent_tool_use_id) continue;
      const c = (m.message as any)?.content;
      const ts = horas.get(m.uuid) ?? Date.now();
      if (m.type === 'user') { const t = userText(c); if (t) { const { texto, adjuntos } = separateAttachments(t); out.push(this.entrada('usuario', texto, { ts, ...(adjuntos.length ? { adjuntos } : {}) })); } }
      else if (m.type === 'assistant' && Array.isArray(c)) {
        for (const b of c) {
          if (b.type === 'text' && b.text?.trim()) out.push(this.entrada('asistente', b.text, { ts }));
          else if (b.type === 'tool_use' && b.name) out.push(this.entrada('herramienta', describeTool(b.name, b.input ?? {}, dir), { herramienta: b.name, ts }));
        }
      }
    }
    return out.slice(-800);
  }
}

/** La hora de cada mensaje de una conversación (uuid → ms), del .jsonl de Claude Code: la carpeta del proyecto o, si
 *  se retomó en otra (un worktree), cualquiera que la tenga */
function messageTimes(claudeId: string, dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const raiz = path.dirname(projectFolder(dir));
  let archivo = path.join(projectFolder(dir), claudeId + '.jsonl');
  if (!existsSync(archivo)) { try { const d = readdirSync(raiz).find(x => existsSync(path.join(raiz, x, claudeId + '.jsonl'))); if (d) archivo = path.join(raiz, d, claudeId + '.jsonl'); } catch {} }
  try {
    for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
      if (!linea.includes('"uuid"')) continue;
      try { const j = JSON.parse(linea), ts = Date.parse(j.timestamp); if (typeof j.uuid === 'string' && Number.isFinite(ts)) out.set(j.uuid, ts); } catch {}
    }
  } catch {}
  return out;
}

async function wait(f: () => boolean, ms: number) {
  for (const fin = Date.now() + ms; Date.now() < fin; await new Promise(r => setTimeout(r, 100))) if (f()) return true;
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
