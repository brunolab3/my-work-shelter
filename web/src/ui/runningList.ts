// The running-things chip's logic (component: RunningThings.tsx): the snapshot asked while its popover is open, the
// chip's threshold kept in this browser, and how a process is named.
import { DEFAULT_MEMORY_THRESHOLD, MEMORY_THRESHOLDS } from '@shared/runningThings';

/** Asks `read` at once on open and again `everyMs` after each answer while open; closed, nothing runs */
export function pollWhileOpen(read: () => Promise<unknown>, everyMs: number) {
  let open = false, timer: ReturnType<typeof setTimeout> | undefined, run = 0;
  const tick = (n: number) => {
    read().catch(() => {}).finally(() => { if (open && n === run) timer = setTimeout(() => tick(n), everyMs); });
  };
  return {
    open() { if (open) return; open = true; tick(++run); },
    close() { open = false; run++; clearTimeout(timer); },
  };
}

const KEY = 'shelter.memoryThreshold';
let threshold = (() => {
  try { const v = Number(localStorage.getItem(KEY)); if (MEMORY_THRESHOLDS.includes(v)) return v; } catch {}
  return DEFAULT_MEMORY_THRESHOLD;
})();
export const memoryThreshold = () => threshold;
export function setMemoryThreshold(mb: number) { threshold = mb; try { localStorage.setItem(KEY, String(mb)); } catch {} }

/** A process's name: the app's executable (`Electron Helper (Renderer)`) or the command without its path */
export function shortCommand(command: string): string {
  const app = /\.app\/Contents\/MacOS\/(.+?)(?= --|$)/.exec(command);
  if (app) return app[1];
  const [first, ...rest] = command.split(' ');
  const s = [first.split('/').pop(), ...rest].join(' ');
  return s.length > 90 ? s.slice(0, 89) + '…' : s;
}

/** How long it has been running: 45 s, 12 min, 3 h 5 min, 2 d 3 h */
export function formatAge(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
  return h ? `${d} d ${h} h` : `${d} d`;
}
