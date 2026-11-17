// Estado de la ventana de Archivos: una sola, como el cliente de git (centrada; ampliar a toda la pantalla; minimizar a
// la barra, fila ARCH). Se abre con F en el refugio (en una sala con carpeta, con la suya), desde el panel de la sala o
// desde el cliente de git, con el repo que se está viendo.
import { Store } from '../almacen';
import { SFX } from '../../audio/sonido';
import { nextZ } from '../ventanas';

export interface FilesWindow { abierta: boolean; minimizada: boolean; maximizada: boolean; z: number; raiz: string | null; abrir: { rel: string; linea?: number } | null }
export const filesWindow = new Store<FilesWindow>({ abierta: false, minimizada: false, maximizada: false, z: 0, raiz: null, abrir: null });

const LAST = 'refugio.archivos.raiz';
export const lastRoot = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
export function chooseRoot(raiz: string) { filesWindow.set({ raiz }); try { localStorage.setItem(LAST, raiz); } catch {} }

/** Abre la ventana (con esa carpeta y, si se pide, ese archivo, relativo a la carpeta). */
export function openFiles(o: { raiz?: string; rel?: string; linea?: number } = {}) {
  const v = filesWindow.get();
  if (!v.abierta || v.minimizada) SFX.abrir();
  if (o.raiz) chooseRoot(o.raiz);
  filesWindow.set({ abierta: true, minimizada: false, z: nextZ(), ...(o.rel ? { abrir: { rel: o.rel, linea: o.linea } } : {}) });
}
export function minimizeFiles() { const v = filesWindow.get(); if (!v.abierta || v.minimizada) return; (document.activeElement as HTMLElement | null)?.blur?.(); filesWindow.set({ minimizada: true }); SFX.cerrar(); }
export function onFrontFiles() { const v = filesWindow.get(); if (!v.abierta) return openFiles(); if (v.minimizada) SFX.abrir(); filesWindow.set({ minimizada: false, z: nextZ() }); }
export function toggleMaximizeFiles() { filesWindow.set(v => ({ maximizada: !v.maximizada })); SFX.clic(); }
// cerrar con archivos sin guardar pregunta: lo decide la ventana (Explorador.tsx), que es quien los conoce
export const askClosing = new Store<{ n: number }>({ n: 0 });
export function closeFiles() { if (filesWindow.get().abierta) askClosing.set(p => ({ n: p.n + 1 })); }
export function closeFilesAlready() { (document.activeElement as HTMLElement | null)?.blur?.(); filesWindow.set({ abierta: false, minimizada: false, abrir: null }); SFX.cerrar(); }
