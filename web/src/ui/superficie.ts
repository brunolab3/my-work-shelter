// Salir a la superficie desde el juego: una conversación o una terminal sigue en una terminal de tu escritorio
// (iTerm, o Terminal). Lo hace el servidor (server/escritorio.ts); aquí solo se pide y se avisa si no se puede.
import { cliente, vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';

// `remoto`: las conversaciones salen con Remote Control (se siguen también desde el móvil)
export function takeASurface(que: { sesiones?: string[]; terminales?: string[]; todo?: boolean; remoto?: boolean; windowNew?: boolean }) {
  SFX.clic();
  cliente.accion('superficie.sacar', que).catch((e: Error) => {
    SFX.noAllowed();
    vivo.set(x => ({ avisos: [...x.avisos.slice(-4), { id: Date.now() + Math.random(), nivel: 'error', texto: e.message }] }));
  });
}

// A la app de Claude: la conversación (abierta, que se cierra aquí antes, o del archivo) sigue en su lista
export function aAppClaude(que: { sesionId?: string; claudeId?: string }) {
  SFX.clic();
  cliente.accion('superficie.appClaude', que).catch((e: Error) => {
    SFX.noAllowed();
    vivo.set(x => ({ avisos: [...x.avisos.slice(-4), { id: Date.now() + Math.random(), nivel: 'error', texto: e.message }] }));
  });
}
