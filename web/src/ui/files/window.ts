// Estado de la ventana de Archivos: una sola, como el cliente de git (centrada; ampliar a toda la pantalla; minimizar a
// la barra, fila ARCH). Se abre con F en el refugio (en una sala con carpeta, con la suya), desde el panel de la sala o
// desde el cliente de git, con el repo que se está viendo.
import { Store } from '../store';
import { SFX } from '../../audio/sound';
import { nextZ } from '../windows';

export interface FilesWindow { isOpen: boolean; minimized: boolean; maximized: boolean; z: number; root: string | null; open: { rel: string; line?: number } | null }
export const filesWindow = new Store<FilesWindow>({ isOpen: false, minimized: false, maximized: false, z: 0, root: null, open: null });

const LAST = 'shelter.files.root';
export const lastRoot = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
export function chooseRoot(root: string) { filesWindow.set({ root }); try { localStorage.setItem(LAST, root); } catch {} }

/** Abre la ventana (con esa carpeta y, si se pide, ese archivo, relativo a la carpeta). */
export function openFiles(o: { root?: string; rel?: string; line?: number } = {}) {
  const v = filesWindow.get();
  if (!v.isOpen || v.minimized) SFX.open();
  if (o.root) chooseRoot(o.root);
  filesWindow.set({ isOpen: true, minimized: false, z: nextZ(), ...(o.rel ? { open: { rel: o.rel, line: o.line } } : {}) });
}
export function minimizeFiles() { const v = filesWindow.get(); if (!v.isOpen || v.minimized) return; (document.activeElement as HTMLElement | null)?.blur?.(); filesWindow.set({ minimized: true }); SFX.close(); }
export function onFrontFiles() { const v = filesWindow.get(); if (!v.isOpen) return openFiles(); if (v.minimized) SFX.open(); filesWindow.set({ minimized: false, z: nextZ() }); }
export function toggleMaximizeFiles() { filesWindow.set(v => ({ maximized: !v.maximized })); SFX.click(); }
// cerrar con archivos sin guardar pregunta: lo decide la ventana (Explorer.tsx), que es quien los conoce
export const askClosing = new Store<{ n: number }>({ n: 0 });
export function closeFiles() { if (filesWindow.get().isOpen) askClosing.set(p => ({ n: p.n + 1 })); }
export function closeFilesAlready() { (document.activeElement as HTMLElement | null)?.blur?.(); filesWindow.set({ isOpen: false, minimized: false, open: null }); SFX.close(); }
