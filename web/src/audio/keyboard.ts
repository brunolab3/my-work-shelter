// Teclado mecánico: las teclas del Supervisor (intercomunicador y terminales) y el repiqueteo de los habitantes que
// teclean en su puesto. Muestras de un Keychron K10 de interruptores lineales (CC0, ver LICENSES/AUDIO.md): doce teclas
// normales distintas, espacio, intro y borrar; nunca la misma muestra dos veces seguidas, con variación de tono y
// volumen y un paneo muy leve según dónde está la tecla en el teclado.
import { sound, type TouchOptions } from './sound';

const KEYS = Array.from({ length: 12 }, (_, i) => `mec_tecla_${String(i + 1).padStart(2, '0')}`);
const ERASE = ['mec_borrar_01', 'mec_borrar_02'];
const random = (a: number, b: number) => a + Math.random() * (b - a);

type Kind = 'tecla' | 'espacio' | 'intro' | 'borrar';
const SAMPLES: Record<Kind, string[]> = { tecla: KEYS, espacio: ['mec_espacio'], intro: ['mec_intro'], borrar: ERASE };
const VOL: Record<Kind, number> = { tecla: 0.5, espacio: 0.5, intro: 0.55, borrar: 0.5 };
// precargadas: la primera tecla tiene que sonar ya, no cuando acabe de bajar y decodificarse
sound.whenReady(() => { for (const l of Object.values(SAMPLES)) for (const n of l) void sound.buffer(n); });

// fila y columna de cada tecla en un teclado español: a la izquierda suena un pelo a la izquierda
const ROWS = ['º1234567890\'¡', 'qwertyuiop`+', 'asdfghjklñ´ç', '<zxcvbnm,.-'];
function panOf(key: string, kind: Kind) {
  if (kind === 'espacio') return 0;
  if (kind === 'intro' || kind === 'borrar') return 0.3;
  const k = key.toLowerCase();
  for (const f of ROWS) { const i = f.indexOf(k); if (i >= 0) return (i / (f.length - 1) - 0.5) * 0.5; }
  return 0;
}

function kindOf(key: string): Kind | null {
  if (key === ' ' || key === 'Spacebar') return 'espacio';
  if (key === 'Enter') return 'intro';
  if (key === 'Backspace' || key === 'Delete') return 'borrar';
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'OS', 'Process', 'Unidentified'].includes(key)) return null;
  return 'tecla';
}

/** Pulsa una tecla del teclado mecánico (la clase sale de `tecla`, el `key` de un KeyboardEvent) */
export function press(key: string, o: TouchOptions = {}) {
  const c = kindOf(key); if (!c) return;
  void sound.play(SAMPLES[c], { bus: 'teclado', vol: VOL[c] * random(0.82, 1.08), var: 0.035, pan: panOf(key, c), ...o });
}

let last = 0;
/** Sonido de una tecla física que ha pulsado el Supervisor (keydown). Sin modificadores sueltos ni atajos de ⌘ */
export function physicsKey(e: KeyboardEvent) {
  if (e.type !== 'keydown') return;
  if (e.metaKey && e.key !== 'Backspace' && e.key !== 'Enter') return;
  const now = performance.now();
  if (e.repeat && now - last < 55) return;   // tecla mantenida: repite, pero sin ametrallar
  last = now;
  press(e.key, e.repeat ? { vol: 0.32 } : {});
}

/**
 * Alguien tecleando a su ritmo: ráfagas de pulsaciones (con espacios, algún borrar y un intro de vez en cuando) y
 * pausas para pensar. Se llama en cada fotograma mientras teclea; programa lo de los próximos 150 ms en el reloj de
 * audio, así que el ritmo no depende de los fotogramas.
 */
export class Typist {
  private next = 0;
  private remain = 0;
  private rhythm = random(6.5, 10.5);    // pulsaciones por segundo de esta persona
  constructor(private fine = Math.random() < 0.5) {}
  play(o: { target?: AudioNode; vol: number; pan: number; underStep?: number; slow?: boolean }) {
    const ctx = sound.ctx; if (!ctx || o.vol < 0.004) { this.next = 0; return; }
    const t = ctx.currentTime;
    if (this.next < t) this.next = t + random(0.05, 0.4);
    while (this.next < t + 0.15) {
      if (this.remain <= 0) {
        this.remain = 3 + Math.floor(Math.random() * 14);
        this.next += (Math.random() < 0.15 ? random(2.5, 5) : random(0.25, 1.6)) * (o.slow ? 1.8 : 1);
        continue;
      }
      const r = Math.random();
      const key = this.remain === 1 && r < 0.25 ? 'Enter' : r < 0.16 ? ' ' : r < 0.2 ? 'Backspace' : 'x';
      const c = kindOf(key)!;
      void sound.play(SAMPLES[c], { bus: 'sfx', target: o.target, vol: o.vol * VOL[c] * random(0.6, 1.05) * (this.fine ? 0.8 : 1), var: 0.05, pan: o.pan, underStep: o.underStep ?? 6500, delay: Math.max(0, this.next - t) });
      this.next += (1 / this.rhythm) * random(0.55, 1.5) * (o.slow ? 1.7 : 1);
      this.remain--;
    }
  }
}
