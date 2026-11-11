// Estado del teclado para el movimiento y atajos del juego. Ignora pulsaciones mientras se escribe en un campo.
type Handler = (e: KeyboardEvent) => boolean | void;

class Keyboard {
  pressed = new Set<string>();
  private pila: Handler[] = [];
  constructor() {
    addEventListener('keydown', e => {
      if (writing(e)) { return; }
      // copiar, cortar, pegar, seleccionar y deshacer son del sistema: ningún menú del juego se las come (⌘C copia lo
      // seleccionado en el intercomunicador, en un panel o en el tablón)
      if (e.metaKey && !e.ctrlKey && !e.altKey && /^Key[ACVXZ]$/.test(e.code)) return;
      // con ⌘ (o Ctrl/⌥) es un atajo, no andar: y en macOS, lo pulsado con ⌘ apretado nunca recibe su keyup, así que
      // la flecha de ⌘↑ o la W de ⌘W se quedaban «pulsadas» y el Supervisor corría solo
      if (!e.metaKey && !e.ctrlKey && !e.altKey) this.pressed.add(e.code);
      for (let i = this.pila.length - 1; i >= 0; i--) if (this.pila[i](e)) { e.preventDefault(); return; }
    });
    addEventListener('keyup', e => { this.pressed.delete(e.code); if (e.key === 'Meta') this.pressed.clear(); });
    // al perder el foco (otra app, un navegador del refugio, una terminal o un campo de texto) nada sigue pulsado
    const dropAll = () => this.pressed.clear();
    addEventListener('blur', dropAll);
    document.addEventListener('visibilitychange', dropAll);
    addEventListener('focusin', e => { if (writing(e)) dropAll(); });
  }
  // El último manejador registrado tiene prioridad (diálogos sobre el mundo). Devuelve función para quitarlo.
  escuchar(f: Handler) { this.pila.push(f); return () => { this.pila = this.pila.filter(x => x !== f); }; }
  eje() {
    const p = this.pressed;
    const x = (p.has('KeyD') || p.has('ArrowRight') ? 1 : 0) - (p.has('KeyA') || p.has('ArrowLeft') ? 1 : 0);
    const z = (p.has('KeyS') || p.has('ArrowDown') ? 1 : 0) - (p.has('KeyW') || p.has('ArrowUp') ? 1 : 0);
    return { x, z, correr: p.has('ShiftLeft') || p.has('ShiftRight') };
  }
  bloqueado = false;
}

export function writing(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || !!t.closest?.('.ventana-terminal, .ventana-navegador, .ventana-git, .ventana-archivos'));
}

export const teclado = new Keyboard();
