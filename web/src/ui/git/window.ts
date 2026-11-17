// Estado de la ventana del cliente de git: una sola, como un navegador del refugio (centrada; ampliar a toda la pantalla;
// minimizar a la barra, fila GIT). Se abre desde el puesto de Control de Versiones, con G en el refugio (en una sala de
// repo, con ese repo) o desde el panel de cualquier sala de repo.
import { Store } from '../almacen';
import { SFX } from '../../audio/sonido';
import { nextZ } from '../ventanas';

export type ViewGit = 'cambios' | 'historial' | 'ramas' | 'github' | 'prs';
export interface WindowGit { abierta: boolean; minimizada: boolean; maximizada: boolean; z: number; ruta: string | null; vista: ViewGit; ocupado: boolean }
export const windowGit = new Store<WindowGit>({ abierta: false, minimizada: false, maximizada: false, z: 0, ruta: null, vista: 'cambios', ocupado: false });

const REMEMBERED = 'refugio.git';
const LAST = 'refugio.git.ruta';
export const lastPath = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
export function choosePath(ruta: string) { windowGit.set({ ruta }); try { localStorage.setItem(LAST, ruta); } catch {} }

export function openGit(o: { ruta?: string; vista?: ViewGit } = {}) {
  const v = windowGit.get();
  if (!v.abierta || v.minimizada) SFX.abrir();
  if (o.ruta) choosePath(o.ruta);
  windowGit.set({ abierta: true, minimizada: false, z: nextZ(), ...(o.vista ? { vista: o.vista } : {}) });
}
export function minimizeGit() { const v = windowGit.get(); if (!v.abierta || v.minimizada) return; (document.activeElement as HTMLElement | null)?.blur?.(); windowGit.set({ minimizada: true }); SFX.cerrar(); }
export function closeGit() { if (!windowGit.get().abierta) return; (document.activeElement as HTMLElement | null)?.blur?.(); windowGit.set({ abierta: false, minimizada: false }); SFX.cerrar(); }
export function onFrontGit() { const v = windowGit.get(); if (!v.abierta) return openGit(); if (v.minimizada) SFX.abrir(); windowGit.set({ minimizada: false, z: nextZ() }); }
export function toggleMaximizeGit() { windowGit.set(v => ({ maximizada: !v.maximizada })); SFX.clic(); }

// tras una recarga (aplicar cambios del juego, reiniciar), vuelve como estaba
addEventListener('pagehide', () => { try { const { abierta, minimizada, maximizada, ruta, vista } = windowGit.get(); sessionStorage.setItem(REMEMBERED, JSON.stringify({ abierta, minimizada, maximizada, ruta, vista })); } catch {} });
try {
  const r = JSON.parse(sessionStorage.getItem(REMEMBERED) || 'null'); sessionStorage.removeItem(REMEMBERED);
  if (r?.abierta) windowGit.set({ abierta: true, minimizada: !!r.minimizada, maximizada: !!r.maximizada, ruta: typeof r.ruta === 'string' ? r.ruta : null, vista: ['cambios', 'historial', 'ramas', 'github', 'prs'].includes(r.vista) ? r.vista : 'cambios', z: nextZ() });
} catch {}
