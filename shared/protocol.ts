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
  helper?: string;
  isError?: boolean;
  question?: boolean;      // usuario: la respuesta a una pregunta del habitante (lleva sus preguntas: pueden enlazar páginas)
}

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
export interface InfoWorktree { path: string; branch: string; main: boolean; changes: number; advanced: number; busy?: string; external?: boolean; author?: string }

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
export interface WorkOptions { model?: string; effort?: string; permissions?: string; worktree?: boolean | string; resume?: string; cwd?: string }

export type ClientMessage =
  | { t: 'hola'; version: string }
  | { t: 'empezar'; dwellerId: string; roomId: string; prompt: string; options: WorkOptions; attachments?: string[]; request?: string }
  | { t: 'enviar'; sessionId: string; text: string; attachments?: string[] }   // adjuntos: rutas que ha devuelto la acción «subir»
  | { t: 'responder'; sessionId: string; requestId: string; decision: 'si' | 'siempre' | 'no'; message?: string; responses?: Record<string, string> }
  | { t: 'interrumpir'; sessionId: string }
  | { t: 'cerrarSesion'; sessionId: string }
  | { t: 'leida'; sessionId: string }
  | { t: 'enUso'; sessions: string[] }   // las que el Supervisor está viendo o tienen algo suyo escrito: no se cierran solas
  | { t: 'lateral'; sessionId: string; question: string }
  | { t: 'modoPermisos'; sessionId: string; mode: string }
  | { t: 'historial'; roomId: string; cwd?: string; request: string }   // cwd: un worktree de la sala (el archivo de una copia holográfica)
  | { t: 'cargarConversacion'; roomId: string; claudeId: string; request: string }
  | { t: 'cuaderno'; sessionId: string; request: string }
  | { t: 'comandos'; sessionId?: string; roomId?: string; request: string }
  | { t: 'terminalAbrir'; id: string; cwd: string; cols: number; rows: number }
  | { t: 'terminalEntrada'; id: string; data: string }
  | { t: 'terminalTamano'; id: string; cols: number; rows: number }
  | { t: 'terminalCerrar'; id: string }
  | { t: 'estadoGuardar'; patch: Record<string, unknown> }
  | { t: 'salir' }
  // dictado (server/voice.ts): audio PCM de 16 bits, 16 kHz, mono, en base64, por trozos; vozFin, transcribir lo que queda
  | { t: 'vozEmpezar'; id: string; language?: string }
  | { t: 'vozAudio'; id: string; data: string }
  | { t: 'vozFin'; id: string }
  | { t: 'vozCancelar'; id: string }
  | { t: 'accion'; name: string; data?: Record<string, unknown>; request?: string };

export type ServerMessage =
  | { t: 'bienvenida'; versionClaude?: string; claudeOk: boolean; state: Record<string, unknown>; sessions: SessionSummary[]; repos: Record<string, InfoRepo>; demo: boolean }
  | { t: 'sesion'; session: SessionSummary }
  | { t: 'sesionFuera'; sessionId: string }
  | { t: 'entradas'; sessionId: string; entries: LogInput[] }
  | { t: 'texto'; sessionId: string; delta: string }   // narración en streaming
  | { t: 'respuesta'; request: string; data?: unknown; error?: string }
  | { t: 'repos'; repos: Record<string, InfoRepo> }
  | { t: 'visitantes'; visitors: Visitor[] }
  | { t: 'terminalDatos'; id: string; data: string; repaint?: boolean }
  | { t: 'terminalEstado'; id: string; inPrompt: boolean; program?: string; live: boolean; outside?: number }   // fuera: terminales de tu escritorio enganchadas a esta
  | { t: 'notificaciones'; list: unknown[] }
  | { t: 'eventos'; list: unknown[] }
  | { t: 'integracion'; id: string; state: unknown }
  | { t: 'estado'; state: Record<string, unknown> }
  | { t: 'aviso'; level: 'info' | 'aviso' | 'error'; text: string; question?: NoticeQuestion }   // con pregunta, se queda hasta contestarla
  | { t: 'voz'; id: string; state: 'descargando' | 'listo' | 'parcial' | 'final' | 'error'; text?: string }   // lo transcrito de un dictado
  | { t: 'mensajero'; since: string; a: string[]; reason: 'reparto' | 'cambio' | 'propuesta' | 'revision' | 'ci'; worktree?: string }   // el robot que lleva el plan de sala en sala (o una revisión o un fallo de CI de un PR desde Control de Versiones, en mano al holograma de su worktree)
  | { t: 'entrega'; room: string; worktree?: string; sessionId?: string }   // un mensaje dentro de la misma sala: el habitante se lo da en mano al holograma de la tarea (messenger.ts)
  | { t: 'verificaciones'; states: Record<string, VerificationSummary> }   // each task's production verification (shared/verification.ts)
  | { t: 'limites'; limits: PlanLimits }   // the Claude plan's usage windows (server/planLimits.ts)
  | { t: 'programados'; list: ScheduledMessage[] }   // los mensajes programados pendientes (shared/scheduled.ts)
  | { t: 'recargar' }
  | { t: 'reiniciando' };

import type { VerificationSummary } from './verification.ts';
import type { ScheduledMessage } from './scheduled.ts';
import type { PlanLimits } from './planLimits.ts';

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
