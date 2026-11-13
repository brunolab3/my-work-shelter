// Protocolo entre el cliente (juego) y el servidor local (127.0.0.1). JSON sobre WebSocket con discriminante `t`.

export type SessionState = 'arrancando' | 'trabajando' | 'esperando' | 'terminada' | 'ociosa' | 'error' | 'cerrada';

export interface Activity { herramienta: string; texto: string; modo: 'leer' | 'escribir' | 'pensar' | 'terminal' | 'web' }

export interface Helper {           // subagente → robot ayudante en la sala del repo que toca
  id: string; descripcion: string; tipo?: string;
  estado: 'trabajando' | 'hecho' | 'fallo';
  modo: 'leer' | 'escribir';
  salaId?: string;                     // repo real al que pertenecen los archivos que toca
  lastTool?: string; herramientas: number;
}

export interface QuestionOption { label: string; description?: string }
export interface Question { question: string; header?: string; multiSelect?: boolean; options: QuestionOption[] }

// Vista previa de lo que una herramienta pide hacer: SIEMPRE texto plano (el cliente nunca la pasa por markdown ni
// HTML), para que nada dentro de un comando o de un contenido pueda cerrar su bloque y esconder parte de sí mismo.
//   ruta: archivo o dirección; codigo: comando, contenido o JSON (con su lenguaje); diff: líneas «- » y «+ »; texto: el resto
export interface InputView { tipo: 'ruta' | 'codigo' | 'diff' | 'texto'; texto: string; lenguaje?: string }

export interface PendingRequest {
  id: string;
  tipo: 'permiso' | 'pregunta' | 'plan' | 'confianza';   // confianza: cargar o no la configuración de Claude Code de la carpeta
  herramienta: string;
  titulo: string;           // frase en español
  entrada?: InputView[]; // permiso: lo que va a hacer la herramienta, exacto y en texto plano; confianza: lo que trae
  motivo?: string;          // permiso: por qué lo pregunta Claude Code (texto plano)
  detalle?: string;         // plan: el plan, en markdown
  preguntas?: Question[];
  canAlways: boolean;    // ofrecer «sí, y no vuelvas a preguntar»
  ofHelper?: string;      // descripción del subagente que pregunta
}

// archivo que el Supervisor adjunta en el intercomunicador (guardado en la carpeta de adjuntos del refugio)
export interface Attachment { ruta: string; nombre: string; imagen: boolean }

export interface LogInput {
  id: string; ts: number;
  tipo: 'usuario' | 'asistente' | 'herramienta' | 'sistema' | 'error' | 'resultado' | 'lateral';
  texto: string;
  adjuntos?: Attachment[];
  herramienta?: string;
  detalle?: string;
  ayudante?: string;
  esError?: boolean;
}

export interface SessionSummary {
  id: string;                    // id del refugio (no el de Claude Code)
  dwellerId: string;
  salaId: string;
  claudeId?: string;             // session_id real de Claude Code
  cwd: string;
  estado: SessionState;
  segundoPlano?: number;         // tareas en segundo plano vivas (subagentes, terminales): mientras, sigue trabajando
  sinLeer: boolean;
  titulo: string;
  lastText?: string;          // última narración / respuesta (markdown)
  actividad?: Activity;
  pending?: PendingRequest;
  pendientes: number;
  ayudantes: Helper[];
  herramientas: number;          // nº de llamadas a herramientas (crece la actividad de la sala)
  turns: number;
  modelo?: string;
  esfuerzo?: string;
  modoPermisos?: string;
  worktree?: string;
  error?: string;
  coste?: number;                // estimación del SDK (con plan no se factura; informativa)
  tokens?: number;               // tokens de la sesión hasta ahora (entrada, salida y caché, todos los modelos)
  contexto?: { usados: number; maximo: number; porcentaje: number };   // ventana de contexto ocupada tras el último turno
  lateral?: { pregunta: string; respuesta?: string; ts: number };
  created: number;
  actualizada: number;
}

export interface HistoryElement { claudeId: string; titulo: string; primerPrompt?: string; modified: number; rama?: string; cwd?: string; enCurso?: string; fuera?: boolean }   // fuera: sigue abierta en una terminal de tu escritorio
export interface RecentConversation extends HistoryElement { salaId: string; dwellerId: string }   // las del buscador (⌘K), de todas las salas
export interface Command { nombre: string; descripcion?: string; pista?: string }

export interface InfoRepo {
  ruta: string; existe: boolean; isGit: boolean;
  rama?: string; cambios: number; lastCommit?: { hash: string; mensaje: string; autor: string; fecha: number };
  tipo: string;                  // web, vídeo, marca, landing, node, python…
  worktrees: InfoWorktree[];
  commits?: { hash: string; mensaje: string; autor: string; fecha: number }[];   // los últimos (para las pantallas de la sala)
  subrepos?: string[];           // carpeta con varios repos: ala con sala de coordinación
  ejemplo?: boolean;             // copia de un repo de ejemplo del refugio de serie (la clona el juego: al retirarla va a la papelera)
}
// autor: el habitante que lo creó (su holograma es una copia de él); sin autor conocido, el refugio elige uno de la sala
export interface InfoWorktree { ruta: string; rama: string; principal: boolean; cambios: number; advanced: number; ocupado?: string; external?: boolean; autor?: string }

// La música del refugio (la discoteca): Spotify web, que suena dentro del juego en su navegador. No pasa por el
// servidor: el cliente la lee de la página (web/src/ui/Discoteca.tsx) y la deja en vivo.musica
export interface MusicTrack { titulo: string; artista: string; album: string; duracion: number; cover?: string }
export interface MusicState {
  estado: 'sonando' | 'pausa' | 'parada';
  pista?: MusicTrack;
  posicion: number;                // segundos, medidos en `medido` (la pletina la adelanta mientras suena)
  medido: number;
  volumen: number;                 // 0..100
  silence: boolean;
  saltar: boolean;                 // la página deja saltar a un punto del tema
}

// worktree: la copia de la sala donde trabaja (si no, en su carpeta principal)
export interface Visitante { claudeId: string; salaId: string; cwd: string; titulo: string; modified: number; worktree?: string }

// ---------------------------------------------------------------- mensajes
export interface WorkOptions { modelo?: string; esfuerzo?: string; permisos?: string; worktree?: boolean | string; reanudar?: string; cwd?: string }

export type ClientMessage =
  | { t: 'hola'; version: string }
  | { t: 'empezar'; dwellerId: string; salaId: string; prompt: string; opciones: WorkOptions; adjuntos?: string[]; peticion?: string }
  | { t: 'enviar'; sesionId: string; texto: string; adjuntos?: string[] }   // adjuntos: rutas que ha devuelto la acción «subir»
  | { t: 'responder'; sesionId: string; peticionId: string; decision: 'si' | 'siempre' | 'no'; mensaje?: string; responses?: Record<string, string> }
  | { t: 'interrumpir'; sesionId: string }
  | { t: 'cerrarSesion'; sesionId: string }
  | { t: 'leida'; sesionId: string }
  | { t: 'enUso'; sesiones: string[] }   // las que el Supervisor está viendo o tienen algo suyo escrito: no se cierran solas
  | { t: 'lateral'; sesionId: string; pregunta: string }
  | { t: 'modoPermisos'; sesionId: string; modo: string }
  | { t: 'historial'; salaId: string; cwd?: string; peticion: string }   // cwd: un worktree de la sala (el archivo de una copia holográfica)
  | { t: 'cargarConversacion'; salaId: string; claudeId: string; peticion: string }
  | { t: 'cuaderno'; sesionId: string; peticion: string }
  | { t: 'comandos'; sesionId?: string; salaId?: string; peticion: string }
  | { t: 'terminalAbrir'; id: string; cwd: string; cols: number; filas: number }
  | { t: 'terminalEntrada'; id: string; datos: string }
  | { t: 'terminalTamano'; id: string; cols: number; filas: number }
  | { t: 'terminalCerrar'; id: string }
  | { t: 'estadoGuardar'; parche: Record<string, unknown> }
  | { t: 'salir' }
  // dictado (server/voz.ts): audio PCM de 16 bits, 16 kHz, mono, en base64, por trozos; vozFin, transcribir lo que queda
  | { t: 'vozEmpezar'; id: string; idioma?: string }
  | { t: 'vozAudio'; id: string; datos: string }
  | { t: 'vozFin'; id: string }
  | { t: 'vozCancelar'; id: string }
  | { t: 'accion'; nombre: string; datos?: Record<string, unknown>; peticion?: string };

export type ServerMessage =
  | { t: 'bienvenida'; versionClaude?: string; claudeOk: boolean; estado: Record<string, unknown>; sesiones: SessionSummary[]; repos: Record<string, InfoRepo>; demo: boolean }
  | { t: 'sesion'; sesion: SessionSummary }
  | { t: 'sesionFuera'; sesionId: string }
  | { t: 'entradas'; sesionId: string; entradas: LogInput[] }
  | { t: 'texto'; sesionId: string; delta: string }   // narración en streaming
  | { t: 'respuesta'; peticion: string; datos?: unknown; error?: string }
  | { t: 'repos'; repos: Record<string, InfoRepo> }
  | { t: 'visitantes'; visitantes: Visitante[] }
  | { t: 'terminalDatos'; id: string; datos: string; repaint?: boolean }
  | { t: 'terminalEstado'; id: string; inPrompt: boolean; program?: string; vivo: boolean; fuera?: number }   // fuera: terminales de tu escritorio enganchadas a esta
  | { t: 'notificaciones'; lista: unknown[] }
  | { t: 'eventos'; lista: unknown[] }
  | { t: 'integracion'; id: string; estado: unknown }
  | { t: 'estado'; estado: Record<string, unknown> }
  | { t: 'aviso'; nivel: 'info' | 'aviso' | 'error'; texto: string; pregunta?: NoticeQuestion }   // con pregunta, se queda hasta contestarla
  | { t: 'voz'; id: string; estado: 'descargando' | 'listo' | 'parcial' | 'final' | 'error'; texto?: string }   // lo transcrito de un dictado
  | { t: 'mensajero'; desde: string; a: string[]; motivo: 'reparto' | 'cambio' | 'propuesta' | 'revision'; worktree?: string }   // el robot que lleva el plan de sala en sala (o una revisión de un PR desde Control de Versiones, en mano al holograma de su worktree)
  | { t: 'recargar' }
  | { t: 'reiniciando' };

// el nombre del juego y, por defecto, del refugio
export const GAME_NAME = 'work-shelter';

export const MODELS = [
  { valor: '', texto: 'El de tus ajustes' },
  { valor: 'opus', texto: 'Opus' },
  { valor: 'fable', texto: 'Fable' },
  { valor: 'sonnet', texto: 'Sonnet' },
  { valor: 'haiku', texto: 'Haiku' },
];
export const EFFORTS = [
  { valor: '', texto: 'Por defecto' }, { valor: 'low', texto: 'Bajo' }, { valor: 'medium', texto: 'Medio' },
  { valor: 'high', texto: 'Alto' }, { valor: 'xhigh', texto: 'Muy alto' }, { valor: 'max', texto: 'Máximo' },
];
export const PERMISSION_MODES = [
  { valor: 'default', texto: 'Pregúntame', pista: 'Pide permiso antes de editar o ejecutar' },
  { valor: 'acceptEdits', texto: 'Edita sin preguntar', pista: 'Acepta ediciones; pregunta antes de ejecutar comandos' },
  { valor: 'plan', texto: 'Primero un plan', pista: 'Solo lectura hasta que apruebes un plan' },
  { valor: 'auto', texto: 'Automático', pista: 'Decide el clasificador del modo automático' },
  { valor: 'bypassPermissions', texto: 'Sin límites', pista: 'Se salta todos los permisos (cuidado)' },
];

/** Un aviso que pregunta sí o no al Supervisor (p. ej. quitar un worktree con cambios sin guardar): la respuesta vuelve
 *  con la acción `aviso.responder` */
export interface NoticeQuestion { id: string; si: string; no: string }
