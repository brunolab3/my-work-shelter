// Estado de la ventana del cliente de git: una sola, como un navegador del refugio (centrada; ampliar a toda la pantalla;
// minimizar a la barra, fila GIT). Se abre desde el puesto de Control de Versiones, con G en el refugio (en una sala de
// repo, con ese repo) o desde el panel de cualquier sala de repo.
import { Store } from '../store';
import { SFX } from '../../audio/sound';
import { nextZ } from '../windows';

export type ViewGit = 'changes' | 'history' | 'branches' | 'github' | 'prs';
export interface WindowGit { open: boolean; minimized: boolean; maximized: boolean; z: number; path: string | null; view: ViewGit; busy: boolean }
export const windowGit = new Store<WindowGit>({ open: false, minimized: false, maximized: false, z: 0, path: null, view: 'changes', busy: false });

const REMEMBERED = 'refugio.git';
const LAST = 'refugio.git.ruta';
export const lastPath = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
export function choosePath(path: string) { windowGit.set({ path }); try { localStorage.setItem(LAST, path); } catch {} }

export function openGit(o: { path?: string; view?: ViewGit } = {}) {
  const v = windowGit.get();
  if (!v.open || v.minimized) SFX.open();
  if (o.path) choosePath(o.path);
  windowGit.set({ open: true, minimized: false, z: nextZ(), ...(o.view ? { view: o.view } : {}) });
}
export function minimizeGit() { const v = windowGit.get(); if (!v.open || v.minimized) return; (document.activeElement as HTMLElement | null)?.blur?.(); windowGit.set({ minimized: true }); SFX.close(); }
export function closeGit() { if (!windowGit.get().open) return; (document.activeElement as HTMLElement | null)?.blur?.(); windowGit.set({ open: false, minimized: false }); SFX.close(); }
export function onFrontGit() { const v = windowGit.get(); if (!v.open) return openGit(); if (v.minimized) SFX.open(); windowGit.set({ minimized: false, z: nextZ() }); }
export function toggleMaximizeGit() { windowGit.set(v => ({ maximized: !v.maximized })); SFX.click(); }

// tras una recarga (aplicar cambios del juego, reiniciar), vuelve como estaba
addEventListener('pagehide', () => { try { const { open, minimized, maximized, path, view } = windowGit.get(); sessionStorage.setItem(REMEMBERED, JSON.stringify({ open, minimized, maximized, path, view })); } catch {} });
try {
  const r = JSON.parse(sessionStorage.getItem(REMEMBERED) || 'null'); sessionStorage.removeItem(REMEMBERED);
  if (r?.open) windowGit.set({ open: true, minimized: !!r.minimized, maximized: !!r.maximized, path: typeof r.path === 'string' ? r.path : null, view: ['changes', 'history', 'branches', 'github', 'prs'].includes(r.view) ? r.view : 'changes', z: nextZ() });
} catch {}
