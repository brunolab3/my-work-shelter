// Puente mínimo entre el juego y su ventana: el juego sabe si la ventana tiene el foco del sistema, para no pintar
// cuando está detrás de otra aplicación (ver web/src/motor/foco.ts), pide el permiso del micrófono para dictar, da los
// avisos de macOS de quien te espera (web/src/ui/avisosSistema.ts) y maneja el Chrome donde suena Spotify.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shelterVentana', {
  onChangeFocus: f => { ipcRenderer.on('foco', (_e, withFocus) => f(withFocus)); },
  askMicrophone: () => ipcRenderer.invoke('microfono'),   // para dictar en el intercomunicador
  notify: (id, titulo, cuerpo) => ipcRenderer.invoke('aviso', id, titulo, cuerpo),
  removeNotice: id => ipcRenderer.invoke('aviso:quitar', id),
  onNoticeClick: f => { ipcRenderer.on('aviso:clic', (_e, id) => f(id)); },
});
// Spotify suena en un Chrome sin ventana (electron/chromeRemoto.cjs): el navegador de Spotify del juego enseña su
// página y le pasa ratón y teclado; la pletina le pregunta qué suena (Navegadores.tsx, Discoteca.tsx)
contextBridge.exposeInMainWorld('shelterRemoto', {
  orden: (orden, ...a) => ipcRenderer.invoke('remoto', orden, ...a),
  onFrame: f => { ipcRenderer.on('remoto:fotograma', (_e, jpeg, ancho, alto) => f(jpeg, ancho, alto)); },
  onState: f => { ipcRenderer.on('remoto:estado', (_e, estado) => f(estado)); },
});
