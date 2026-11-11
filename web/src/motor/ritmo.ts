// Ritmo de pintado con el juego en primer plano. Pintar el refugio cuesta lo mismo con poca o mucha resolución (unas
// 650 llamadas de dibujo por fotograma): lo que gasta CPU es cuántos fotogramas se pintan. En automático, 60 fps mientras
// algo se mueve por tu mano (anda el Supervisor, se mueve la cámara, ratón o teclas sobre el refugio), 30 si solo se mira
// (los habitantes se ven igual de fluidos) y 10 con una ventana maximizada encima. Se guarda en este navegador.

export type FrameRate = 'auto' | '60' | '30';
export const FRAME_RATES: FrameRate[] = ['auto', '60', '30'];
const KEY = 'refugio.ritmo';

let actual: FrameRate = (() => {
  try { const v = localStorage.getItem(KEY); if (FRAME_RATES.includes(v as FrameRate)) return v as FrameRate; } catch {}
  return 'auto';
})();
export function frameRate(): FrameRate { return actual; }
export function setFrameRate(v: FrameRate) { actual = v; try { localStorage.setItem(KEY, v); } catch {} }

/** la cámara se ha movido (con margen: su suavizado se acerca al objetivo sin llegar nunca del todo) */
export function cameraMoved(a: ArrayLike<number>, b: ArrayLike<number>, margen = 1e-4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > margen) return true;
  return false;
}

/** fps a los que pintar: con una ventana maximizada encima, 10 en automático; si no, 60 moviéndose y 30 quieto */
export function targetFps(modo: FrameRate, s: { moving: boolean; covered: boolean }): number {
  if (modo === '60') return 60;
  if (modo === '30') return 30;
  if (s.covered) return 10;
  return s.moving ? 60 : 30;
}
