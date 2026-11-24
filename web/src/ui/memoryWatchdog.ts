// Window memory: Electron (electron/main.cjs) reports the game window's renderer memory every minute; over the limit
// chosen in Options, the memory row of the running-things indicator offers «Reload now». The game never reloads by
// itself: only that click does, and not while a turn is starting or in progress or an attachment is still uploading.
// What is typed and attached in the intercoms is written down first and comes back after the reload (savedIntercoms in
// intercomSync.ts). The limit is kept in this browser.
import type { SessionSummary } from '@shared/protocol';
import type { WindowCom } from './intercomSync';

/** Limits offered in Options, in MB (0: never offer the reload) */
export const MEMORY_LIMITS = [0, 1024, 1536, 2048, 3072, 4096];
const DEFAULT_LIMIT = 2048;
const KEY = 'refugio.memoryLimit';

let current = (() => {
  try { const v = localStorage.getItem(KEY); if (v !== null && MEMORY_LIMITS.includes(Number(v))) return Number(v); } catch {}
  return DEFAULT_LIMIT;
})();
/** Only the game's own window (Electron) reports its memory */
export const hasMemoryWatch = () => typeof window !== 'undefined' && !!(window as any).shelterVentana?.onMemory;
export function memoryLimit(): number { return current; }
export function setMemoryLimit(mb: number) { current = mb; try { localStorage.setItem(KEY, String(mb)); } catch {} }

export interface ReloadInput { mb: number | null; limit: number; sessions: Record<string, SessionSummary>; intercoms: WindowCom[] }
/** The «Reload now» button: shown over the limit; disabled, with the text key of its reason, while a turn is starting
 *  or in progress or an attachment is still uploading (it would not survive the reload) */
export function reloadButton({ mb, limit, sessions, intercoms }: ReloadInput): { show: boolean; reason?: string } {
  if (!limit || mb == null || !(mb > limit)) return { show: false };
  if (Object.values(sessions).some(s => s.state === 'trabajando' || s.state === 'arrancando')) return { show: true, reason: 'menu.memoryReloadTurnRunning' };
  if (intercoms.some(v => v.tabs.some(p => (p.attachments ?? []).some(a => !a.path && !a.error)))) return { show: true, reason: 'menu.memoryReloadUploading' };
  return { show: true };
}

export interface WindowMemory { onMemory?: (f: (mb: number) => void) => void; reloadForMemory?: () => Promise<unknown> }
/** The window's memory as Electron reports it (`report` on each sample, never a reload) and the click on «Reload now»:
 *  only when the button is enabled, after writing the intercoms down */
export function memoryWatch(w: WindowMemory | undefined, { report, input, save }: { report: (mb: number) => void; input: (mb: number | null) => ReloadInput; save: () => void }) {
  let mb: number | null = null;
  w?.onMemory?.(x => { mb = x; report(x); });
  return {
    reload(): boolean {
      const b = reloadButton(input(mb));
      if (!b.show || b.reason || !w?.reloadForMemory) return false;
      save();
      w.reloadForMemory().catch(() => {});
      return true;
    },
  };
}
