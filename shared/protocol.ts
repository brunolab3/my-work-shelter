// Protocolo entre el cliente (juego) y el servidor local (127.0.0.1). JSON sobre WebSocket con discriminante `t`.

export type SessionState = 'arrancando' | 'trabajando' | 'esperando' | 'terminada' | 'ociosa' | 'error' | 'cerrada';

export interface Activity { tool: string; text: string; mode: 'leer' | 'escribir' | 'pensar' | 'terminal' | 'web' }

export interface Helper {           // subagente → robot ayudante en la sala del repo que toca
  id: string; description: string; type?: string;
  state: 'trabajando' | 'hecho' | 'fallo';
  mode: 'leer' | 'escribir';
  roomId?: string;                     // repo real al que pertenecen los archivos que toca
  lastTool?: string; tools: number;
}

export interface QuestionOption { label: string; description?: string }
export interface Question { question: string; header?: string; multiSelect?: boolean; options: QuestionOption[] }

// Vista previa de lo que una herramienta pide hacer: SIEMPRE texto plano (el cliente nunca la pasa por markdown ni
// HTML), para que nada dentro de un comando o de un contenido pueda cerrar su bloque y esconder parte de sí mismo.
//   ruta: archivo o dirección; codigo: comando, contenido o JSON (con su lenguaje); diff: líneas «- » y «+ »; texto: el resto
export interface InputView { type: 'ruta' | 'codigo' | 'diff' | 'texto'; text: string; language?: string }

export interface PendingRequest {
  id: string;
  type: 'permiso' | 'pregunta' | 'plan' | 'confianza';   // confianza: cargar o no la configuración de Claude Code de la carpeta
  tool: string;
  title: string;           // frase en español
  input?: InputView[]; // permiso: lo que va a hacer la herramienta, exacto y en texto plano; confianza: lo que trae
  reason?: string;          // permiso: por qué lo pregunta Claude Code (texto plano)
  detail?: string;         // plan: el plan, en markdown
  questions?: Question[];
  canAlways: boolean;    // ofrecer «sí, y no vuelvas a preguntar»
  ofHelper?: string;      // descripción del subagente que pregunta
}

// archivo que el Supervisor adjunta en el intercomunicador (guardado en la carpeta de adjuntos del refugio)
export interface Attachment { path: string; name: string; image: boolean }

export interface LogInput {
  id: string; ts: number;
  type: 'usuario' | 'asistente' | 'herramienta' | 'sistema' | 'error' | 'resultado' | 'lateral';
  text: string;
  attachments?: Attachment[];
  tool?: string;
  detail?: string;
  output?: ToolOutput;     // herramienta: a failed tool's output, kept on disk (server/toolOutputs.ts): read when opened
  helper?: string;
  isError?: boolean;
  question?: boolean;      // usuario: la respuesta a una pregunta del habitante (lleva sus preguntas: pueden enlazar páginas)
  origin?: MessageOrigin;   // usuario: who sent it when it was not the Overseer typing (another room, a scheduled message, the game)
}

export interface ToolOutput { size: number; first: string }   // bytes and the first line

// who sent a message to a conversation: the Overseer, another room's dweller (send_to_room, the cleanup thread), a
// scheduled message, or the game itself (PR reviews, CI failures, plan notices)
export type MessageOrigin = { kind: 'overseer' } | { kind: 'room'; roomId: string; room: string; dweller?: string } | { kind: 'scheduled' } | { kind: 'game' };
// a message sent to a busy conversation that Claude Code has not taken yet (shared/messageQueue.ts): it moves into the
// log when the conversation takes it, at its next tool boundary or once its turn ends
export interface QueuedMessage { id: string; ts: number; text: string; origin: MessageOrigin; attachments?: Attachment[] }

export interface SessionSummary {
  id: string;                    // id del refugio (no el de Claude Code)
  dwellerId: string;
  roomId: string;
  claudeId?: string;             // session_id real de Claude Code
  cwd: string;
  state: SessionState;
  background?: number;         // tareas en segundo plano vivas (subagentes, terminales): mientras, sigue trabajando
  unread: boolean;
  title: string;
  lastText?: string;          // última narración / respuesta (markdown)
  activity?: Activity;
  pending?: PendingRequest;
  pendingCount: number;
  queue?: QueuedMessage[];   // messages waiting for the conversation to take them, oldest first
  helpers: Helper[];
  tools: number;          // nº de llamadas a herramientas (crece la actividad de la sala)
  turns: number;
  model?: string;
  effort?: string;
  permissionMode?: string;
  worktree?: string;
  error?: string;
  limit?: { resetsAt: number; resumeAt?: number };   // stopped by the usage limit: resumes on its own (server/limitResume.ts)
  cost?: number;                // estimación del SDK (con plan no se factura; informativa)
  tokens?: number;               // tokens de la sesión hasta ahora (entrada, salida y caché, todos los modelos)
  context?: { used: number; max: number; percentage: number };   // ventana de contexto ocupada tras el último turno
  lateral?: { question: string; answer?: string; ts: number };
  // past the handoff threshold (shared/compact.ts): 'offered' while the intercom suggests a new session, 'writing' while
  // the dweller writes the handoff summary that will start it
  handoff?: 'offered' | 'writing';
  handoffFrom?: string;          // the conversation this one took over from with a handoff (its intercom tab follows)
  created: number;
  updated: number;
}

export interface HistoryElement { claudeId: string; title: string; firstPrompt?: string; modified: number; branch?: string; cwd?: string; inProgress?: string; outside?: boolean; fork?: boolean }   // fuera: sigue abierta en una terminal de tu escritorio; fork: a read-only fork older versions made (room messages), never resumed
export interface RecentConversation extends HistoryElement { roomId: string; dwellerId: string }   // las del buscador (⌘K), de todas las salas
export interface Command { name: string; description?: string; hint?: string }

export interface InfoRepo {
  path: string; exists: boolean; isGit: boolean;
  branch?: string; changes: number; lastCommit?: { hash: string; message: string; author: string; date: number };
  type: string;                  // web, vídeo, marca, landing, node, python…
  worktrees: InfoWorktree[];
  commits?: { hash: string; message: string; author: string; date: number }[];   // los últimos (para las pantallas de la sala)
  subrepos?: string[];           // carpeta con varios repos: ala con sala de coordinación
  example?: boolean;             // copia de un repo de ejemplo del refugio de serie (la clona el juego: al retirarla va a la papelera)
}
// autor: el habitante que lo creó (su holograma es una copia de él); sin autor conocido, el refugio elige uno de la sala
export interface InfoWorktree { path: string; branch: string; main: boolean; changes: number; advanced: number; busy?: string; external?: boolean; author?: string; review?: ReviewCopy }
/** A started review's hologram in the Review room (shared/reviews.ts): its folder stands in for a worktree */
export interface ReviewCopy { key: string; title: string; repos: string[] }

// La música del refugio (la discoteca): Spotify web, que suena dentro del juego en su navegador. No pasa por el
// servidor: el cliente la lee de la página (web/src/ui/Disco.tsx) y la deja en vivo.musica
export interface MusicTrack { title: string; artist: string; album: string; duration: number; cover?: string }
export interface MusicState {
  state: 'sonando' | 'pausa' | 'parada';
  hint?: MusicTrack;
  position: number;                // segundos, medidos en `medido` (la pletina la adelanta mientras suena)
  measured: number;
  volume: number;                 // 0..100
  silence: boolean;
  seek: boolean;                 // la página deja saltar a un punto del tema
}

// worktree: la copia de la sala donde trabaja (si no, en su carpeta principal)
export interface Visitor { claudeId: string; roomId: string; cwd: string; title: string; modified: number; worktree?: string }

// ---------------------------------------------------------------- mensajes
export interface WorkOptions { model?: string; effort?: string; permissions?: string; worktree?: boolean | string; resume?: string; cwd?: string; handoffFrom?: string }

/** The handshake and the reload of the client from before the English message names: a tab still running it after
 *  «Restart the game» greets with `hola` and is told to reload, in the words it understands */
export const LEGACY_WIRE = { hello: 'hola', reload: 'recargar' } as const;

export type ClientMessage =
  | { t: 'hello'; version: string }
  | { t: 'start'; dwellerId: string; roomId: string; prompt: string; options: WorkOptions; attachments?: string[]; request?: string }
  | { t: 'send'; sessionId: string; text: string; attachments?: string[] }   // adjuntos: rutas que ha devuelto la acción «subir»
  | { t: 'withdraw'; sessionId: string; messageId: string; request: string }   // take back a queued message of the Overseer's (data: whether it was)
  | { t: 'sendNow'; sessionId: string; messageId: string; request: string }   // interrupt the turn and send a queued message of the Overseer's now (data: whether it was)
  | { t: 'answer'; sessionId: string; requestId: string; decision: 'si' | 'siempre' | 'no'; message?: string; responses?: Record<string, string> }
  | { t: 'interrupt'; sessionId: string }
  | { t: 'closeSession'; sessionId: string }
  | { t: 'read'; sessionId: string }
  | { t: 'inUse'; sessions: string[] }   // las que el Supervisor está viendo o tienen algo suyo escrito: no se cierran solas
  | { t: 'sideQuestion'; sessionId: string; question: string }
  | { t: 'permissionMode'; sessionId: string; mode: string }
  | { t: 'history'; roomId: string; cwd?: string; request: string }   // cwd: un worktree de la sala (el archivo de una copia holográfica)
  | { t: 'loadConversation'; roomId: string; claudeId: string; limit?: number; request: string }   // limit: only the last ones
  | { t: 'log'; sessionId: string; request: string }
  | { t: 'logPage'; sessionId: string; limit: number; before?: { id: string; ts: number }; request: string }   // a page of the log (shared/logPages.ts): LogPage
  | { t: 'commands'; sessionId?: string; roomId?: string; request: string }
  | { t: 'terminalOpen'; id: string; cwd: string; cols: number; rows: number }
  | { t: 'terminalInput'; id: string; data: string }
  | { t: 'terminalResize'; id: string; cols: number; rows: number }
  | { t: 'terminalClose'; id: string }
  | { t: 'saveState'; patch: Record<string, unknown> }
  | { t: 'quit' }
  // dictado (server/voice.ts): audio PCM de 16 bits, 16 kHz, mono, en base64, por trozos; vozFin, transcribir lo que queda
  | { t: 'voiceStart'; id: string; language?: string }
  | { t: 'voiceAudio'; id: string; data: string }
  | { t: 'voiceEnd'; id: string }
  | { t: 'voiceCancel'; id: string }
  | { t: 'action'; name: string; data?: Record<string, unknown>; request?: string };

export type ServerMessage =
  | { t: 'welcome'; versionClaude?: string; claudeOk: boolean; state: Record<string, unknown>; sessions: SessionSummary[]; repos: Record<string, InfoRepo>; demo: boolean }
  | { t: 'session'; session: SessionSummary }
  | { t: 'sessionRemoved'; sessionId: string }
  | { t: 'entries'; sessionId: string; entries: LogInput[] }
  | { t: 'text'; sessionId: string; delta: string }   // narración en streaming
  | { t: 'response'; request: string; data?: unknown; error?: string }
  | { t: 'repos'; repos: Record<string, InfoRepo> }
  | { t: 'visitors'; visitors: Visitor[] }
  | { t: 'terminalData'; id: string; data: string; repaint?: boolean }
  | { t: 'terminalState'; id: string; inPrompt: boolean; program?: string; live: boolean; outside?: number }   // fuera: terminales de tu escritorio enganchadas a esta
  | { t: 'notifications'; list: unknown[] }
  | { t: 'events'; list: unknown[] }
  | { t: 'integration'; id: string; state: unknown }
  | { t: 'state'; state: Record<string, unknown> }
  | { t: 'notice'; level: 'info' | 'aviso' | 'error'; text: string; question?: NoticeQuestion }   // con pregunta, se queda hasta contestarla
  | { t: 'voice'; id: string; state: 'descargando' | 'listo' | 'parcial' | 'final' | 'error'; text?: string }   // lo transcrito de un dictado
  | { t: 'messenger'; since: string; a: string[]; reason: 'reparto' | 'cambio' | 'propuesta' | 'revision' | 'ci'; worktree?: string }   // el robot que lleva el plan de sala en sala (o una revisión o un fallo de CI de un PR desde Control de Versiones, en mano al holograma de su worktree)
  | { t: 'delivery'; room: string; worktree?: string; sessionId?: string }   // un mensaje dentro de la misma sala: el habitante se lo da en mano al holograma de la tarea (messenger.ts)
  | { t: 'reviews'; board: ReviewBoard }   // the Review room's PRs (server/reviewRoom.ts)
  | { t: 'verifications'; states: Record<string, VerificationSummary> }   // each task's production verification (shared/verification.ts)
  | { t: 'limits'; limits: PlanLimits }   // the Claude plan's usage windows (server/planLimits.ts)
  | { t: 'scheduled'; list: ScheduledMessage[] }   // los mensajes programados pendientes (shared/scheduled.ts)
  | { t: 'reload' }
  | { t: 'restarting' };

import type { VerificationSummary } from './verification.ts';
import type { ScheduledMessage } from './scheduled.ts';
import type { PlanLimits } from './planLimits.ts';
import type { ReviewBoard } from './reviews.ts';

// el nombre del juego y, por defecto, del refugio
export const GAME_NAME = 'work-shelter';

export const MODELS = [
  { value: '', text: 'El de tus ajustes' },
  { value: 'opus', text: 'Opus' },
  { value: 'fable', text: 'Fable' },
  { value: 'sonnet', text: 'Sonnet' },
  { value: 'haiku', text: 'Haiku' },
];
export const EFFORTS = [
  { value: '', text: 'Por defecto' }, { value: 'low', text: 'Bajo' }, { value: 'medium', text: 'Medio' },
  { value: 'high', text: 'Alto' }, { value: 'xhigh', text: 'Muy alto' }, { value: 'max', text: 'Máximo' },
];
export const PERMISSION_MODES = [
  { value: 'default', text: 'Pregúntame', hint: 'Pide permiso antes de editar o ejecutar' },
  { value: 'acceptEdits', text: 'Edita sin preguntar', hint: 'Acepta ediciones; pregunta antes de ejecutar comandos' },
  { value: 'plan', text: 'Primero un plan', hint: 'Solo lectura hasta que apruebes un plan' },
  { value: 'auto', text: 'Automático', hint: 'Decide el clasificador del modo automático' },
  { value: 'bypassPermissions', text: 'Sin límites', hint: 'Se salta todos los permisos (cuidado)' },
];

/** Un aviso que pregunta sí o no al Supervisor (p. ej. quitar un worktree con cambios sin guardar): la respuesta vuelve
 *  con la acción `aviso.responder` */
export interface NoticeQuestion { id: string; si: string; no: string }
