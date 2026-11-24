// What is running (the top bar's memory chip, web/src/ui/RunningThings.tsx): the game's own processes, each dweller's
// `claude` with what it started, and the servers listening on a local port. The server reads `ps` and `lsof` only when
// asked (server/runningThings.ts), never on its own.

export interface ProcessInfo { pid: number; ppid: number; mb: number; ageS: number; command: string; ports?: number[]; depth?: number }
/** server: the game's server; supervisor: what relaunches it; main, renderer, gpu: the Electron app; terminals: the host of
 *  the game's terminals; helper: any other process of the game (Electron utilities, the launcher, git runs) */
export type GamePart = 'server' | 'supervisor' | 'main' | 'renderer' | 'gpu' | 'terminals' | 'helper';
export interface GameProcess extends ProcessInfo { part: GamePart }
/** a dweller's `claude`; children: its descendants (depth 1 = started by it), the only processes the game may stop */
export interface DwellerProcess extends ProcessInfo { sessionId: string; children: ProcessInfo[] }
/** a server listening on a local port; by: the dweller whose `claude` it descends from, if any; parent: who started it */
export interface DevServer extends ProcessInfo { sessionId?: string; parent?: { pid: number; command: string } }
/** game: its processes but the helpers, which go as one line (helpers: how many and their memory); gameMb: the section's total, helpers included */
export interface RunningSnapshot { at: number; game: GameProcess[]; helpers: { count: number; mb: number }; gameMb: number; dwellers: DwellerProcess[]; devServers: DevServer[]; totalMb: number }

/** While the popover is open it asks again every this many ms; closed, never */
export const RUNNING_REFRESH_MS = 4000;
/** The chip's threshold, chosen in Options (MB): amber from 75 % of it, red over it */
export const MEMORY_THRESHOLDS = [4096, 6144, 8192, 12288, 16384];
export const DEFAULT_MEMORY_THRESHOLD = 8192;
export function memoryLight(totalMb: number | undefined, thresholdMb: number): 'gris' | 'verde' | 'amarillo' | 'rojo' {
  if (totalMb == null) return 'gris';
  return totalMb > thresholdMb ? 'rojo' : totalMb > thresholdMb * 0.75 ? 'amarillo' : 'verde';
}
export const formatMb = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;

/** `ps` etime (`[[dd-]hh:]mm:ss`) → seconds */
export function parseEtime(s: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim());
  return m ? (Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4])) : 0;
}
