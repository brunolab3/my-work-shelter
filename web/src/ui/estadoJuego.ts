// Estado visible de la partida que pinta la interfaz (lo alimentan el mundo y el servidor).
import { Store } from './almacen';
import { GAME_NAME } from '@shared/protocolo';

export type DwellerState = 'durmiendo' | 'ocioso' | 'pensando' | 'trabajando' | 'esperando' | 'terminado' | 'error';

export interface DwellerSummary { id: string; nombre: string; mote: string; tipo: string; bio: string; sala: string; nameRoom: string; ruta?: string; carpeta?: string; estado: DwellerState; detalle?: string; sesionId?: string; robot?: boolean; copia?: CopyData }

// una copia holográfica (worktree) habla con su propio intercomunicador; trabaja como su autor, dentro del worktree
export interface CopyData { ruta: string; rama: string; authorId: string; nameAuthor: string; nicknameAuthor: string; cambios: number; advanced: number }

export interface StateUI {
  refugio: string;
  scrap: number;
  habitantes: DwellerSummary[];
  copias: DwellerSummary[];     // copias holográficas (worktrees): interlocutores propios, con id «holo:<ruta>»
  notificationsWithoutSee: number;
  eventNext: { titulo: string; inicio: number } | null;
  hint: { tecla: string; texto: string } | null;
  currentRoom: string;
  demo: boolean;
  talkingWith: string | null;     // id del habitante (o de la copia holográfica) con el que hay un diálogo abierto
  panel: Panel | null;            // aparato abierto (plano, ocupados, ayuda, opciones, salir, cámara acorazada, puerta…)
  panelData: any;
  workIn: { cwd: string; rama: string } | null;   // empezar el próximo trabajo dentro de un worktree
}

export type Panel = 'plano' | 'ocupados' | 'ayuda' | 'opciones' | 'menu' | 'salir' | 'camara' | 'puerta' | 'inventario' | 'cuaderno' | 'comunicaciones' | 'planificacion' | 'logistica' | 'galeria' | 'hidroponia' | 'bienvenida' | 'despedida' | 'reiniciar' | 'radio' | 'expedicion' | 'sala' | 'generador' | 'terminal' | 'worktree' | 'visitante' | 'git' | 'spotify' | 'chapa' | 'organizar';

export const juego = new Store<StateUI>({
  refugio: GAME_NAME, scrap: 0, habitantes: [], copias: [], notificationsWithoutSee: 0, eventNext: null,
  hint: null, currentRoom: '', demo: true, talkingWith: null, panel: null, panelData: null, workIn: null,
});
