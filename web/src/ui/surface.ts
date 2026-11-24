// Salir a la superficie desde el juego: una conversación o una terminal sigue en una terminal de tu escritorio
// (iTerm, o Terminal). Lo hace el servidor (server/desktop.ts); aquí solo se pide y se avisa si no se puede.
import { client, addNotice } from '../net/client';
import { SFX } from '../audio/sound';

// `remoto`: las conversaciones salen con Remote Control (se siguen también desde el móvil)
export function takeASurface(what: { sessions?: string[]; terminals?: string[]; all?: boolean; remote?: boolean; windowNew?: boolean }) {
  SFX.click();
  client.action('surface.takeOut', what).catch((e: Error) => {
    SFX.notAllowed();
    addNotice('error', e.message);
  });
}

// A la app de Claude: la conversación (abierta, que se cierra aquí antes, o del archivo) sigue en su lista
export function toClaudeApp(what: { sessionId?: string; claudeId?: string }) {
  SFX.click();
  client.action('surface.claudeApp', what).catch((e: Error) => {
    SFX.notAllowed();
    addNotice('error', e.message);
  });
}
