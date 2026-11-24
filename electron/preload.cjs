// Puente mínimo entre el juego y su ventana: el juego sabe si la ventana tiene el foco del sistema, para no pintar
// cuando está detrás de otra aplicación (ver web/src/engine/focus.ts), pide el permiso del micrófono para dictar, da los
// avisos de macOS de quien te espera (web/src/ui/systemNotices.ts) y maneja el Chrome donde suena Spotify.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shelterVentana', {
  onChangeFocus: f => { ipcRenderer.on('foco', (_e, withFocus) => f(withFocus)); },
  askMicrophone: () => ipcRenderer.invoke('microfono'),   // para dictar en el intercomunicador
  notify: (id, title, body) => ipcRenderer.invoke('aviso', id, title, body),
  removeNotice: id => ipcRenderer.invoke('aviso:quitar', id),
  setBadge: text => ipcRenderer.invoke('insignia', text),   // Dock badge: a number of questions or a dot
  onNoticeClick: f => { ipcRenderer.on('aviso:clic', (_e, id) => f(id)); },
  setLanguage: i => ipcRenderer.invoke('idioma', i),   // Electron's menus and dialogs in the game's language (texts.cjs)
  onMemory: f => { ipcRenderer.on('memoria', (_e, mb) => f(mb)); },   // the renderer's memory, every minute (web/src/ui/memoryWatchdog.ts)
  reloadForMemory: () => ipcRenderer.invoke('memoria:recargar'),   // only from the «Reload now» click
});
// Spotify suena en un Chrome sin ventana (electron/remoteChrome.cjs): el navegador de Spotify del juego enseña su
// página y le pasa ratón y teclado; la pletina le pregunta qué suena (Browsers.tsx, Disco.tsx)
contextBridge.exposeInMainWorld('shelterRemoto', {
  orden: (orden, ...a) => ipcRenderer.invoke('remoto', orden, ...a),
  onFrame: f => { ipcRenderer.on('remoto:fotograma', (_e, jpeg, width, height) => f(jpeg, width, height)); },
  onState: f => { ipcRenderer.on('remoto:estado', (_e, state) => f(state)); },
});
