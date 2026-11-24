// Estado visible de la partida que pinta la interfaz (lo alimentan el mundo y el servidor).
import { Store } from './store';
import { GAME_NAME } from '@shared/protocol';

export type DwellerState = 'sleeping' | 'idle' | 'thinking' | 'working' | 'waiting' | 'finished' | 'error';

export interface DwellerSummary { id: string; name: string; nickname: string; type: string; bio: string; room: string; nameRoom: string; path?: string; folder?: string; state: DwellerState; detail?: string; sessionId?: string; robot?: boolean; copy?: CopyData }

// una copia holográfica (worktree) habla con su propio intercomunicador; trabaja como su autor, dentro del worktree
import type { ReviewCopy } from '@shared/protocol';
export interface CopyData { path: string; branch: string; authorId: string; nameAuthor: string; nicknameAuthor: string; changes: number; advanced: number; review?: ReviewCopy }

export interface StateUI {
  shelter: string;
  scrap: number;
  dwellers: DwellerSummary[];
  copies: DwellerSummary[];     // copias holográficas (worktrees): interlocutores propios, con id «holo:<ruta>»
  unseenNotifications: number;
  hint: { key: string; text: string } | null;
  currentRoom: string;
  demo: boolean;
  talkingWith: string | null;     // id del habitante (o de la copia holográfica) con el que hay un diálogo abierto
  panel: Panel | null;            // aparato abierto (plano, ocupados, ayuda, opciones, salir, cámara acorazada, puerta…)
  panelData: any;
  workIn: { cwd: string; branch: string } | null;   // empezar el próximo trabajo dentro de un worktree
}

export type Panel = 'map' | 'busy' | 'help' | 'options' | 'menu' | 'exit' | 'vault' | 'gate' | 'inventory' | 'log' | 'comms' | 'calendar' | 'logistics' | 'gallery' | 'hydroponics' | 'welcome' | 'farewell' | 'restart' | 'radio' | 'expedicion' | 'room' | 'generator' | 'terminal' | 'worktree' | 'visitor' | 'git' | 'spotify' | 'bodyshop' | 'organize' | 'review';

export const juego = new Store<StateUI>({
  shelter: GAME_NAME, scrap: 0, dwellers: [], copies: [], unseenNotifications: 0,
  hint: null, currentRoom: '', demo: true, talkingWith: null, panel: null, panelData: null, workIn: null,
});
