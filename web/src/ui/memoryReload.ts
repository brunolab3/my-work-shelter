// Window memory's wiring (logic: memoryWatchdog.ts): the latest sample in `windowMemory`, and `reloadForMemory` for the
// «Reload now» button of the running-things indicator, with `memoryReloadButton` for its state.
import { live } from '../net/client';
import { intercoms, saveIntercoms } from './Dialog';
import { Store } from './store';
import { memoryLimit, memoryWatch, reloadButton, type ReloadInput, type WindowMemory } from './memoryWatchdog';

/** The game window's renderer memory in MB (null: not reported, outside the app or before the first sample) */
export const windowMemory = new Store<{ mb: number | null }>({ mb: null });
const input = (mb: number | null): ReloadInput => ({ mb, limit: memoryLimit(), sessions: live.get().sessions, intercoms: intercoms.get().list });
let watch: ReturnType<typeof memoryWatch> | undefined;

export function watchMemory() {
  watch = memoryWatch((window as any).shelterVentana as WindowMemory | undefined, { report: mb => windowMemory.set({ mb }), input, save: saveIntercoms });
}
/** The button's state now (re-read it on changes of `windowMemory`, `live` and `intercoms`) */
export const memoryReloadButton = () => reloadButton(input(windowMemory.get().mb));
/** The click on «Reload now»: false if it can't reload now */
export const reloadForMemory = () => watch?.reload() ?? false;
